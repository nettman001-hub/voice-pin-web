import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSalesListRevenue } from '../src/services/salesListRevenue.ts';
import { promiseDefaultBuyerKey } from '../src/services/promiseDefaultService.ts';

const sale = (id, buyerId, nickname, sessionId, amount, extra = {}) => ({
  id, buyerId, buyerNickname: nickname, sessionId, amount,
  status: '자동저장', syncStatus: 'SYNCED', ...extra,
});
const decision = (buyerId, nickname, sessionId, status, updatedAt = '2026-09-30T00:00:00Z') => ({
  buyerKey: promiseDefaultBuyerKey(buyerId, nickname), buyerNickname: nickname,
  sessionId, status, updatedAt,
});

test('confirmed revenue excludes all sales for a confirmed nonfulfilling buyer in one broadcast', () => {
  const sales = [
    sale('one', 'buyer-1', '햇살', 'broadcast-1', 13000),
    sale('two', 'buyer-1', '햇살', 'broadcast-1', 7000),
    sale('three', 'buyer-2', '별빛', 'broadcast-1', 5000),
  ];
  assert.deepEqual(calculateSalesListRevenue(sales, [decision('buyer-1', '햇살', 'broadcast-1', 'CONFIRMED')]), {
    totalAmount: 25000, confirmedAmount: 5000, uniqueBuyerCount: 2,
  });
});

test('cancelling nonfulfillment restores confirmed revenue', () => {
  const sales = [sale('one', 'buyer-1', '햇살', 'broadcast-1', 13000)];
  const decisions = [
    decision('buyer-1', '햇살', 'broadcast-1', 'CONFIRMED'),
    decision('buyer-1', '햇살', 'broadcast-1', 'CANCELLED', '2026-09-30T00:01:00Z'),
  ];
  assert.equal(calculateSalesListRevenue(sales, decisions).confirmedAmount, 13000);
});

test('a nonfulfillment decision affects only its broadcast and real buyer account', () => {
  const sales = [
    sale('one', 'buyer-1', '햇살', 'broadcast-1', 13000),
    sale('two', 'buyer-1', '햇살', 'broadcast-2', 9000),
    sale('three', 'buyer-2', '햇살', 'broadcast-1', 4000),
  ];
  const result = calculateSalesListRevenue(sales, [decision('buyer-1', '햇살', 'broadcast-1', 'CONFIRMED')]);
  assert.equal(result.totalAmount, 26000);
  assert.equal(result.confirmedAmount, 13000);
});

test('pending, cancelled and unsynced sales are not counted in either amount', () => {
  const sales = [
    sale('one', 'buyer-1', '햇살', 'broadcast-1', 13000),
    sale('two', 'buyer-1', '햇살', 'broadcast-1', 5000, { status: '보류' }),
    sale('three', 'buyer-1', '햇살', 'broadcast-1', 7000, { recordState: 'CANCELLED' }),
    sale('four', 'buyer-1', '햇살', 'broadcast-1', 9000, { syncStatus: 'PENDING' }),
  ];
  assert.equal(calculateSalesListRevenue(sales, []).totalAmount, 13000);
  assert.equal(calculateSalesListRevenue(sales, []).confirmedAmount, 13000);
});
