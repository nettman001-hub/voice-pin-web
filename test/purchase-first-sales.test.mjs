import test from 'node:test';
import assert from 'node:assert/strict';
import { getPurchaseRequests, matchPurchaseRequest } from '../src/services/purchaseFirstSales.ts';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { extractSpeechPrice } from '../src/services/priceEvidence.ts';

const at = '2026-09-30T12:00:00.000Z';
const comment = (nickname, content = 'ㅈㅇ', id = nickname) => ({
  id, platformMessageId: id, sessionId: 'session-1', nickname, content, capturedAt: at,
});
const match = (spoken, records) => matchPurchaseRequest(spoken, getPurchaseRequests(records, 'session-1'),
  '2026-09-30T12:00:03.000Z');

test('buyer comment starts a request; explanation comments do not', () => {
  assert.equal(getPurchaseRequests([comment('햇살'), comment('질문자', '보여주세요')], 'session-1').length, 1);
  assert.equal(getPurchaseRequests([comment('햇살', '저요 아니고 구경이요')], 'session-1').length, 0);
  assert.equal(match('햇살', [comment('햇살', '빨강 있으면 살게요')]).kind, 'NO_REQUEST');
  assert.equal(match('햇살', [comment('햇살', '두 개 주세요')]).kind, 'NO_REQUEST');
});

test('a buyer withdrawal closes the prior request before allocation', () => {
  const purchase = { ...comment('햇살'), platformUserId: 'user-1' };
  const withdrawal = { ...comment('햇살', '취소요', 'cancel-1'), platformUserId: 'user-1',
    capturedAt: '2026-09-30T12:00:01.000Z' };
  assert.equal(match('햇살', [purchase, withdrawal]).kind, 'NO_REQUEST');
});

test('natural seller allocations retain the spoken price and resolve the actual commenter', () => {
  for (const [buyer, speech] of [
    ['햇살', '네, 햇살언니께 1.5 드리겠습니다'],
    ['넥스트', '네스트언니 1.5 챙겨드릴게요'],
    ['이이돌1234', '이이돌언니께 1.5 드릴게요'],
    ['이이돌1234', '뒷자리1234언니께 1.5 드리겠습니다'],
    ['KH', 'KH 언니는 연핑 1.5에 넣어드렸어요'],
    ['KH', 'KH 언니는 연핑 1.5에 넣어드릴게요'],
    ['봄', '봄언니께 1.5 드리겠습니다'],
  ]) {
    const sale = extractSaleFromTranscript(speech);
    assert.ok(sale, speech);
    assert.equal(sale.amount, 15000);
    const result = match(sale.buyerNickname, [comment(buyer)]);
    assert.equal(result.kind, 'MATCH', speech);
    assert.equal(result.request.nickname, buyer);
  }
});

test('a priced allocation remains pending when STT fails to extract any nickname', () => {
  const sale = extractSaleFromTranscript('1.5에 넣어드릴게요');
  assert.equal(sale.intent, 'ALLOCATION');
  assert.equal(sale.buyerNickname, '미확인(보류)');
  assert.equal(sale.amount, 15000);
  assert.equal(sale.status, '보류');
});

test('similar accounts and explicit conflicting digits cannot auto-allocate', () => {
  assert.equal(match('이이돌', [comment('이이돌1234'), comment('이이돌5678')]).kind, 'AMBIGUOUS');
  assert.notEqual(match('이이돌5678', [comment('이이돌1234')]).kind, 'MATCH');
  assert.equal(match('네스트', [comment('넥스트'), comment('네스트')]).kind, 'MATCH');
  assert.equal(match('햇살', [comment('햇살', '보여주세요')]).kind, 'NO_REQUEST');
});

test('spoken decimal is ten-thousand won, not a length or a nickname digit', () => {
  assert.equal(extractSpeechPrice('햇살언니 1.5 드리겠습니다')?.amount, 15000);
  assert.equal(extractSpeechPrice('0.9에 드릴게요')?.amount, 9000);
  assert.equal(extractSpeechPrice('햇살언니 만 이천 원에 드리겠습니다')?.amount, 12000);
  assert.equal(extractSpeechPrice('1.2였는데 1.0에 드리겠습니다')?.amount, 10000);
  assert.equal(extractSpeechPrice('길이 1.5미터입니다'), null);
  assert.equal(extractSpeechPrice('뒷자리1234언니께 드리겠습니다'), null);
});

test('an ordinary spoken won price needs no pre-registered product price', () => {
  const sale = extractSaleFromTranscript('햇살언니 만 이천 원에 드리겠습니다');
  assert.equal(sale?.amount, 12000);
  assert.equal(match(sale.buyerNickname, [comment('햇살', '제가 살께요')]).kind, 'MATCH');
});

test('questions, negatives, conditions and demonstrations do not sell', () => {
  for (const speech of [
    '햇살언니께 드릴까요?', '햇살언니 보여드리겠습니다',
    '햇살언니께 드리는 거 아니에요', '입금하시면 햇살언니께 드리겠습니다',
  ]) assert.equal(extractSaleFromTranscript(speech), null, speech);
});

test('real seller measurement and demonstration transcripts never create sale candidates', () => {
  for (const speech of [
    ', 요 청 원피스도 이뻐요. 언니. 자, 1.5 가단 재 드릴게요. 팁 있는데 언니.',
    '요거 어, 조이 언니,. 잠시 언니, 가단 제 바로 재 드릴게요. 1.3이고 언니, 가단 재 드릴게요.',
    '오셨네요. 네. 연우 언니, 원피스. 아, 원피스 보여 드릴게요. 언니들. 자, 요거는 블라우스예요. 언니. 자, 응. 안에 여기 레이스로 다 돼 있어요. 밑단하고 전부 다 레이스로 돼 있습니다.',
    '쁘고 하고. 자, 뒤에도 이렇습니다. 언니, 가단하고 제 드릴게요. 요거는 박시하게 언니들이 셔츠로 이렇게 입는 겁니다. 언니. 빈티지 하면서도 너무 예뻐요. 언니.',
    '현이 언니, 캡처해서 언니한테 같이 보내 드릴게요. 1.5입니다.',
    '햇살언니 가슴단면 재드릴께요. 1.5예요.',
    '연우 언니 1.5 보여드릴게요',
  ]) assert.equal(extractSaleFromTranscript(speech), null, speech);
});

test('an allocation is evaluated in its own clause without borrowing a demonstration price or nickname', () => {
  const sale = extractSaleFromTranscript('연우 언니 보여 드릴게요. 햇살언니께 1.5 드리겠습니다.');
  assert.equal(sale?.buyerNickname, '햇살');
  assert.equal(sale?.amount, 15000);
  assert.equal(sale?.intent, 'ALLOCATION');
  assert.equal(extractSaleFromTranscript('연우 언니 보여 드릴게요. 1.5입니다. 햇살언니께 드리겠습니다.')?.amount, 0);
  assert.equal(extractSaleFromTranscript('햇살언니. 1.5 드리겠습니다.')?.buyerNickname, '햇살');
  assert.equal(extractSaleFromTranscript('박시하게 언니들이 입어요. 드릴게요.'), null);
  assert.equal(extractSaleFromTranscript('햇살님 1.5입니다')?.isPending, true);
});
