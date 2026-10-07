import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmPaymentInvoices,
  decideAliasUpdate,
  generateDepositCode,
  isUnknownPayer,
  matchPayment,
  normalizePayerName,
} from '../src/services/paymentMatching.ts';

const paidAt = '2026-10-07T10:00:00.000Z';
const invoice = (id, overrides = {}) => ({
  id,
  customerNickname: '성훈맘',
  amount: 30000,
  status: 'SENT',
  saleIds: [`sale-${id}`],
  depositCode: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  ...overrides,
});
const pay = (payerName, amount = 30000) => ({ payerName, amount, paidAt });

test('입금자명에 입금코드가 있으면 자동 확정', () => {
  const result = matchPayment(pay('김철수 A7K2'), [
    invoice('a', { customerNickname: '성훈맘', depositCode: 'A7K2' }),
    invoice('b', { customerNickname: '하늘이', depositCode: 'B8M3' }),
  ]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reason, 'DEPOSIT_CODE');
  assert.equal(result.invoiceId, 'a');
  assert.deepEqual(result.saleIds, ['sale-a']);
});

test('입금코드는 괄호 안에 있어도 읽는다', () => {
  const result = matchPayment(pay('김철수(a7k2)'), [invoice('a', { depositCode: 'A7K2' }), invoice('b')]);
  assert.equal(result.invoiceId, 'a');
});

test('입금자명이 닉네임과 같으면(공백 무시) 자동 확정', () => {
  const result = matchPayment(pay('성훈 맘'), [invoice('a'), invoice('b', { customerNickname: '하늘이' })]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reason, 'NICKNAME');
  assert.equal(result.invoiceId, 'a');
});

test('학습된 별칭으로 자동 확정', () => {
  const aliases = new Map([[normalizePayerName('김철수'), '성훈맘']]);
  const result = matchPayment(pay('김철수'), [invoice('a'), invoice('b', { customerNickname: '하늘이' })], aliases);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reason, 'ALIAS');
  assert.equal(result.invoiceId, 'a');
});

test('모호한 별칭(빈 닉네임)은 자동 확정에 쓰지 않는다', () => {
  const aliases = new Map([[normalizePayerName('김민지'), '']]);
  const result = matchPayment(pay('김민지'), [invoice('a'), invoice('b', { customerNickname: '하늘이' })], aliases);
  assert.equal(result.status, 'NEEDS_REVIEW');
});

test('금액만 같은 후보가 1건이면 자동 확정하지 않고 그 후보를 추천', () => {
  const result = matchPayment(pay('김철수'), [invoice('a'), invoice('b', { amount: 15000 })]);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'AMOUNT_ONLY');
  assert.deepEqual(result.candidateIds, ['a']);
  assert.equal(result.invoiceId, undefined);
});

test('금액만 같은 후보가 여러 건이면 확인 필요 + 후보 목록', () => {
  const result = matchPayment(pay('김철수'), [invoice('a'), invoice('b', { customerNickname: '하늘이' })]);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'MULTIPLE');
  assert.deepEqual([...result.candidateIds].sort(), ['a', 'b']);
});

test('같은 구매자의 같은 금액 정산서가 둘이면 자동 확정하지 않는다', () => {
  const result = matchPayment(pay('성훈맘'), [invoice('a'), invoice('b')]);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'NICKNAME');
});

test('후보가 없으면 미확인', () => {
  const result = matchPayment(pay('김철수', 12000), [invoice('a')]);
  assert.equal(result.status, 'UNMATCHED');
  assert.deepEqual(result.candidateIds, []);
});

test('같은 구매자의 정산서 합계와 같으면 합산 입금으로 제안', () => {
  const result = matchPayment(pay('성훈맘', 45000), [
    invoice('a', { amount: 30000 }),
    invoice('b', { amount: 15000 }),
    invoice('c', { amount: 45000, status: 'PAID' }),
  ]);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'COMBINED');
  assert.deepEqual([...result.candidateIds].sort(), ['a', 'b']);
});

test('입금코드는 맞는데 금액이 다르면 확인 필요', () => {
  const result = matchPayment(pay('A7K2', 29000), [invoice('a', { depositCode: 'A7K2' })]);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'CODE_AMOUNT_MISMATCH');
  assert.deepEqual(result.candidateIds, ['a']);
});

test('입금완료·취소·작성중 정산서와 14일보다 오래된 정산서는 후보가 아니다', () => {
  const result = matchPayment(pay('성훈맘'), [
    invoice('paid', { status: 'PAID' }),
    invoice('cancelled', { status: 'CANCELLED' }),
    invoice('draft', { status: 'DRAFT' }),
    invoice('old', { createdAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  assert.equal(result.status, 'UNMATCHED');
});

test('입금자명을 못 읽은 입금(미확인)은 이름 규칙을 건너뛴다', () => {
  assert.equal(isUnknownPayer('미확인'), true);
  assert.equal(isUnknownPayer(''), true);
  const result = matchPayment(pay('미확인'), [invoice('a', { customerNickname: '미확인' })]);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'AMOUNT_ONLY');
});

test('입금코드는 헷갈리는 글자 없이 4자리, 미결 코드와 겹치지 않는다', () => {
  let calls = 0;
  const sequence = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  const code = generateDepositCode(['AAAA'], () => sequence[calls++ % sequence.length]);
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}$/);
  assert.notEqual(code, 'AAAA');
  for (let index = 0; index < 200; index += 1) {
    assert.doesNotMatch(generateDepositCode([]), /[01OIL]/);
  }
});

test('별칭 갱신: 처음이면 추가, 같으면 유지, 다른 닉네임이면 모호함으로', () => {
  assert.equal(decideAliasUpdate(undefined, '성훈맘'), 'insert');
  assert.equal(decideAliasUpdate('성훈 맘', '성훈맘'), 'keep');
  assert.equal(decideAliasUpdate('성훈맘', '하늘이'), 'ambiguous');
  assert.equal(decideAliasUpdate('', '하늘이'), 'keep');
});

test('합산 확정 시 판매 id를 합친다', () => {
  const confirmed = confirmPaymentInvoices([invoice('a'), invoice('b')]);
  assert.equal(confirmed.invoiceId, 'a');
  assert.deepEqual(confirmed.saleIds, ['sale-a', 'sale-b']);
});
