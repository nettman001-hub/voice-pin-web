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
  ]) {
    const sale = extractSaleFromTranscript(speech);
    assert.ok(sale, speech);
    assert.equal(sale.amount, 15000);
    const result = match(sale.buyerNickname, [comment(buyer)]);
    assert.equal(result.kind, 'MATCH', speech);
    assert.equal(result.request.nickname, buyer);
  }
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
