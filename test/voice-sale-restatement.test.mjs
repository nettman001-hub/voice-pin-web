import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { advanceVoiceSaleTransaction } from '../src/services/voiceSaleTransaction.ts';
import { announcesAdditionalPurchase, findRestatedVoiceSale } from '../src/services/voiceSaleRestatement.ts';

const at = (seconds) => new Date(Date.UTC(2026, 9, 17, 10, 58, 0) + seconds * 1000).toISOString();
const sale = (overrides = {}) => ({
  id: 'sale-012', sessionId: 'S', buyerNickname: '꽃심이', amount: 10000, recognizedAt: at(33),
  rawTranscript: '가방을 이거 꼬심이님 드릴게요', status: '자동저장', source: 'WEB_VOICE', ...overrides,
});
const candidate = (overrides = {}) => ({
  sessionId: 'S', recognizedAt: at(43), buyerNickname: '꽃심이', amount: 10000, ...overrides,
});

test('닉네임 앞에 말한 "가격은 1.0"도 그 배정의 가격으로 읽는다', () => {
  const result = extractSaleFromTranscript('캡처해 주시고, 가방, 아니, 가격은 1.0 드릴게요. 꼬심이님 드릴게요.');
  assert.equal(result.buyerNickname, '꼬심이');
  assert.equal(result.amount, 10000);
  assert.equal(result.intent, 'ALLOCATION');
  assert.equal(extractSaleFromTranscript('가격은 1.2. 하니님 드릴게요.').amount, 12000);
});

test('앞 문장의 가격이 다른 구매자나 다음 상품 것이면 가져오지 않는다', () => {
  assert.equal(extractSaleFromTranscript('하니님 가격은 1.2. 꼬심이님 드릴게요.').amount, 0);
  assert.equal(extractSaleFromTranscript('다음 상품 가격은 1.2. 꼬심이님 드릴게요.').amount, 0);
  assert.equal(extractSaleFromTranscript('가격은 1.2인가요? 꼬심이님 드릴게요.').amount, 0);
});

test('10/17 꽃심이 가방: 10초 뒤 재언급은 같은 거래나 직전 거래의 반복으로 표시된다', () => {
  const first = advanceVoiceSaleTransaction(null, { sessionId: 'S', eventId: 'e1', recognizedAt: at(33),
    text: '가방을 제가. 아, 네. 가방을 이거 꼬심이님 드릴게요. 1.0' });
  const second = advanceVoiceSaleTransaction(first.state, { sessionId: 'S', eventId: 'e2', recognizedAt: at(43),
    text: '캡처해 주시고, 가방, 아니, 가격은 1.0 드릴게요. 꼬심이님 드릴게요.' });
  assert.equal(first.emission.result.amount, 10000);
  // The restatement is either absorbed or marked as repeating the first sale.
  assert.ok(!second.emission || second.emission.transactionId === first.emission.transactionId
    || second.emission.precedingTransactionId === first.emission.transactionId);
});

test('10초 안에 같은 구매자에게 같은 가격으로 다시 말하면 직전 판매를 재언급한 것으로 본다', () => {
  assert.equal(findRestatedVoiceSale([sale()], candidate())?.id, 'sale-012');
  assert.equal(findRestatedVoiceSale([sale()], candidate({ amount: 0 }))?.id, 'sale-012', '가격을 못 읽은 재언급');
  assert.equal(findRestatedVoiceSale([sale({ buyerNickname: '꽃 심이' })], candidate())?.id, 'sale-012', '띄어쓰기 무시');
  assert.equal(findRestatedVoiceSale([sale({ buyerId: 'b1' })], candidate({ buyerId: 'b1', buyerNickname: '다른표시' }))?.id, 'sale-012');
});

test('다른 구매자·다른 가격·10초 초과·사이에 다른 판매가 있으면 새 판매로 둔다', () => {
  assert.equal(findRestatedVoiceSale([sale()], candidate({ buyerNickname: '하니' })), undefined);
  assert.equal(findRestatedVoiceSale([sale()], candidate({ amount: 12000 })), undefined);
  assert.equal(findRestatedVoiceSale([sale()], candidate({ recognizedAt: at(44) })), undefined);
  assert.equal(findRestatedVoiceSale([sale({ buyerId: 'b1' })], candidate({ buyerId: 'b2' })), undefined);
  assert.equal(findRestatedVoiceSale([sale(), sale({ id: 'other', buyerNickname: '하니', recognizedAt: at(38) })], candidate()), undefined);
  assert.equal(findRestatedVoiceSale([sale({ productId: 'p1' })], candidate({ productId: 'p2' })), undefined);
  assert.equal(findRestatedVoiceSale([sale({ status: '취소' })], candidate()), undefined);
  assert.equal(findRestatedVoiceSale([sale({ sessionId: 'T' })], candidate()), undefined);
});

test('"하나 더"처럼 추가 구매를 말하면 재언급으로 보지 않는다', () => {
  assert.equal(announcesAdditionalPurchase('꼬심이님 하나 더 드릴게요'), true);
  assert.equal(announcesAdditionalPurchase('꼬심이님 두 개 드릴게요'), true);
  assert.equal(announcesAdditionalPurchase('꼬심이님 추가로 드릴게요'), true);
  assert.equal(announcesAdditionalPurchase('저요, 한번만 더 해 주세요. 이거 꼬심이님 드릴게요'), false);
  assert.equal(announcesAdditionalPurchase('캡처해 주시고, 가방, 아니, 가격은 1.0 드릴게요. 꼬심이님 드릴게요.'), false);
});
