import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTouchProductNumber, touchBuyerSessionTotal } from '../src/services/touchSalePresentation.ts';
test('number preview restarts per session and includes cancelled numbers', () => {
  const rows = [{ sessionId: 'a', productName: '1번' }, { sessionId: 'a', productName: '2번', status: '취소' }];
  assert.equal(nextTouchProductNumber(rows, 'a'), 3);
  assert.equal(nextTouchProductNumber(rows, 'b'), 1);
});
test('today totals separate customer IDs and exclude cancelled, held and other-session purchases', () => {
  const sale = { buyerId: 'x', buyerNickname: '동명', sessionId: 's', amount: 10000, status: '확정' };
  const rows = [sale, { ...sale, amount: 20000 }, { ...sale, buyerId: 'y', amount: 9999 }, { ...sale, status: '취소' }, { ...sale, status: '보류' }, { ...sale, sessionId: 'other' }];
  assert.deepEqual(touchBuyerSessionTotal(sale, rows), { count: 2, amount: 30000 });
});
