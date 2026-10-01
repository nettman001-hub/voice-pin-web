import test from 'node:test';
import assert from 'node:assert/strict';
import { getPurchaseRequests, matchPurchaseRequest } from '../src/services/purchaseFirstSales.ts';
import { extractSaleFromTranscript, parseBuyerNickname } from '../src/services/salesExtractor.ts';
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

test('a demonstrative honorific cannot hide the actual buyer addressed later in the allocation', () => {
  const text = '금액은 8,000원, 0.8. 이거 언니, 이뿌쥬 언니 챙겨드릴게요, 0.8.';
  const sale = extractSaleFromTranscript(text);
  assert.equal(parseBuyerNickname(text), '이뿌쥬');
  assert.equal(sale.buyerNickname, '이뿌쥬');
  assert.equal(sale.amount, 8000);
  const request = match(sale.buyerNickname, [comment('이뿌쥬~^^'), comment('이거')]);
  assert.equal(request.kind, 'MATCH');
  assert.equal(request.request.nickname, '이뿌쥬~^^');
  assert.equal(parseBuyerNickname('잠시 언니, 요거 언니, 이뿌쥬 언니 챙겨드릴게요.'), '이뿌쥬');
  assert.equal(parseBuyerNickname('이뿌쥬 언니, 이뿌쥬 언니 0.8 챙겨드릴게요.'), '이뿌쥬');
  assert.equal(parseBuyerNickname('하늘씨 언니께 0.8 챙겨드릴게요.'), '하늘씨', 'do not strip a character belonging to the name twice');
});

test('non-name words are excluded from every nickname fallback', () => {
  for (const word of ['이거', '요거', '그거', '저거', '잠시', '구매자', '다음']) {
    for (const text of [`${word} 언니`, `${word}님`, `${word}씨`, `닉네임 ${word}`, `닉네임은 ${word}님`]) {
      assert.equal(parseBuyerNickname(text), null, text);
    }
  }
  const sale = extractSaleFromTranscript('이거 언니 0.8 챙겨드릴게요.');
  assert.equal(sale.status, '보류');
  assert.equal(sale.buyerNickname, '미확인(보류)');
});

test('multiple real addressed names retain a pending allocation instead of selecting by position', () => {
  for (const text of ['햇살언니, 구름언니 0.8 챙겨드릴게요.',
    '햇살언니 0.8 챙겨드릴게요, 구름언니 잠시만요.', '햇살언니, 구름언니 챙겨드릴게요.']) {
    const sale = extractSaleFromTranscript(text);
    assert.equal(parseBuyerNickname(text), null, text);
    assert.equal(sale.intent, 'ALLOCATION', text);
    assert.equal(sale.status, '보류', text);
    assert.equal(sale.buyerNickname, '미확인(보류)', text);
  }
});

test('a priced allocation remains pending when STT fails to extract any nickname', () => {
  const sale = extractSaleFromTranscript('1.5에 넣어드릴게요');
  assert.equal(sale.intent, 'ALLOCATION');
  assert.equal(sale.buyerNickname, '미확인(보류)');
  assert.equal(sale.amount, 15000);
  assert.equal(sale.status, '보류');
});

test('casual 챙겨줄게 is an allocation, while an unrelated 아니 is not a correction or cancellation', () => {
  const speech = '언니, DM 왜 빵바지 보여줄게. 아니, 가까운 건 좋은데, 가윤 언니 챙겨줄게.';
  const sale = extractSaleFromTranscript(speech);
  assert.equal(sale.buyerNickname, '가윤');
  assert.equal(sale.intent, 'ALLOCATION');
  assert.equal(sale.amount, 0, 'a missing price is never invented');
  assert.equal(sale.status, '보류');
  assert.equal(sale.rawTranscript, speech);
  for (const action of ['챙겨줄게', '챙겨 줄게요', '챙겨줄께', '챙겨 줄께요']) {
    assert.equal(extractSaleFromTranscript(`가윤 언니 ${action}. 금액은 1.0입니다.`)?.amount, 10000, action);
  }
});

test('casual descriptions, questions, conditional promises and negatives never allocate a sale', () => {
  for (const speech of [
    '가윤 언니 보여줄게.', '가윤 언니 1.5 보여 줄게.', '가윤 언니 가단 재줄게.',
    '가윤 언니 챙겨줄게?', '가윤 언니 챙겨줄까요?', '가윤 언니 안 챙겨줄게.',
    '가윤 언니 못 챙겨줄게.', '가윤 언니 챙겨 못 줄게.', '입금하면 가윤 언니 챙겨줄게.',
    '남으면 가윤 언니 챙겨줄게.', '아까 가윤 언니 챙겨줄게 라고 했잖아.',
    '가윤 언니 1.0 챙겨줄게 하고 말했어요.', '아까 가윤 언니 1.0 챙겨줄게 했잖아.',
    '가윤 언니 1.0 챙겨줄게, 아니 취소할게.', '가윤 언니 1.0 챙겨줄게요, 취소할게요.',
    '원하시면 가윤 언니 1.0 챙겨줄게.', '원하면 가윤 언니 1.0 챙겨줄게.',
    '구매하시면 가윤 언니 1.0 챙겨줄게.', '사시면 가윤 언니 1.0 챙겨줄게.',
  ]) assert.equal(extractSaleFromTranscript(speech), null, speech);
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

test('an immediately following explicit price belongs to the buyer allocation, not the measurements', () => {
  const speech = '택배 많을걸? 이제 언박싱 하십시오. 구름 언니, 이거 챙겨드릴게요. 금액은 1.0, 가단 60에 총장 89. 이렇게. 허리 스트링 채워도 돼?';
  const sale = extractSaleFromTranscript(speech);
  assert.equal(sale.buyerNickname, '구름');
  assert.equal(sale.amount, 10000);
  assert.equal(sale.isPending, false);
  assert.equal(sale.rawTranscript, speech);
  assert.equal(sale.allocationTranscript, '구름 언니, 이거 챙겨드릴게요. 금액은 1.0');
  assert.equal(extractSpeechPrice(sale.allocationTranscript)?.amount, 10000, 'server price evidence uses the same amount');
  assert.equal(match(sale.buyerNickname, [comment('구름', '저요')]).request.nickname, '구름');
  for (const price of ['금액은 1.0, 가단 60.5에 총장 89.5.', '금액은 1.0, 사이즈 66입니다.',
    '가격은 10,000원입니다.', '단가: 만 원이에요.', '판매가는 일 점 영이고요.']) {
    assert.equal(extractSaleFromTranscript(`구름언니 챙겨드릴게요. ${price}`)?.amount, 10000, price);
  }
});

test('allocation prices never cross a buyer, product, question, or ambiguous price boundary', () => {
  for (const following of [
    '햇살언니 금액은 1.5입니다.', '다음 상품 가격은 1.5입니다.', '금액은 다음 상품이 1.5입니다.',
    '가단 60.5에 총장 89.5입니다.', '금액은 1.5미터입니다.', '금액은 1.5 cm입니다.',
    '금액은 1.5사이즈.', '금액은 1.5 사이즈.',
    '금액은 1.0인가요?', '괜찮으세요? 금액은 1.0입니다.',
    '이 옷 예쁘죠. 금액은 1.0입니다.', '금액은 1.0이 아니고 1.5입니다.',
    '금액은 1.0, 아니 1.5입니다.', '금액은 1.0이면 됩니다.',
    '금액은 1.0, 햇살언니께 드릴게요.', '금액은 1.0, 가단 60에 다음 상품은 1.5입니다.',
    '금액은 1.0, 가단 60에 가격은 1.5입니다.',
    '금액은 1.0, 가단 60에 별빛언니, 햇살언니.',
  ]) {
    const sale = extractSaleFromTranscript(`구름언니 챙겨드릴게요. ${following}`);
    assert.equal(sale.amount, 0, following);
    assert.equal(sale.isPending, true, following);
  }
  assert.equal(extractSaleFromTranscript('구름언니 1.0 챙겨드릴게요. 금액은 1.5입니다.').amount, 10000);
});
