import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKoreanAmount, extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { parseKoreanNumber } from '../src/services/voiceSaleCandidate.ts';

test('소숫점 숫자 가격 확정 규칙 - 1.7 이면 17,000원 (* 10000 / * 10 * 1000)', () => {
  assert.equal(parseKoreanAmount('1.7'), 17000);
  assert.equal(parseKoreanAmount('1.7원'), 17000);
  assert.equal(parseKoreanAmount('1.7만'), 17000);
  assert.equal(parseKoreanAmount('1점7'), 17000);
  assert.equal(parseKoreanAmount('일점칠'), 17000);
});

test('다양한 소숫점 가격 변환 검증 (2.5, 0.8, 3.0, 15.5)', () => {
  assert.equal(parseKoreanAmount('2.5'), 25000);
  assert.equal(parseKoreanAmount('이점오'), 25000);
  assert.equal(parseKoreanAmount('0.8'), 8000);
  assert.equal(parseKoreanAmount('영점팔'), 8000);
  assert.equal(parseKoreanAmount('3.0'), 30000);
  assert.equal(parseKoreanAmount('15.5'), 155000);
});

test('날짜 및 버전 번호는 소숫점 가격으로 오인되지 않아야 함', () => {
  assert.equal(parseKoreanAmount('2026.09.10 오늘 방송'), null);
  assert.equal(parseKoreanAmount('버전 1.0.0'), null);
});

test('extractSaleFromTranscript - 소숫점 가격이 포함된 판매 멘트 자동 추출', () => {
  // 1. "구매확정 닉네임 코맹님 1.7"
  const sale1 = extractSaleFromTranscript('구매확정 닉네임 코맹님 1.7');
  assert.ok(sale1);
  assert.equal(sale1.buyerNickname, '코맹');
  assert.equal(sale1.amount, 17000);
  assert.equal(sale1.status, '자동저장');
  assert.equal(sale1.isPending, false);

  // 2. "닉네임 또로롱님 2.5"
  const sale2 = extractSaleFromTranscript('닉네임 또로롱님 2.5');
  assert.ok(sale2);
  assert.equal(sale2.buyerNickname, '또로롱');
  assert.equal(sale2.amount, 25000);
  assert.equal(sale2.status, '자동저장');

  // 3. "뒷번호 0517님 1.7"
  const sale3 = extractSaleFromTranscript('뒷번호 0517님 1.7');
  assert.ok(sale3);
  assert.equal(sale3.buyerNickname, '뒷번호 0517');
  assert.equal(sale3.amount, 17000);
  assert.equal(sale3.status, '자동저장');

  // 4. "마인드셋님 일점칠 구매확정"
  const sale4 = extractSaleFromTranscript('마인드셋님 일점칠 구매확정');
  assert.ok(sale4);
  assert.equal(sale4.buyerNickname, '마인드셋');
  assert.equal(sale4.amount, 17000);
  assert.equal(sale4.status, '자동저장');
});

test('voiceSaleCandidate - parseKoreanNumber 소숫점 가격 지원', () => {
  assert.equal(parseKoreanNumber('가격 1.7로 해줘'), 17000);
  assert.equal(parseKoreanNumber('단가 2.5'), 25000);
});
