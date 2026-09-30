import test from 'node:test';
import assert from 'node:assert/strict';
import { getPromiseDefault, promiseDefaultBuyerKey, summarizePromiseDefaults } from '../src/services/promiseDefaultService.ts';

test('one buyer and broadcast is one explicit default, regardless of purchased items', () => {
  const buyerKey = promiseDefaultBuyerKey('buyer-123', '햇살');
  const records = [{ buyerKey, buyerNickname: '햇살', sessionId: 'broadcast-1',
    status: 'CONFIRMED', updatedAt: '2026-09-30T00:00:00Z' }];
  assert.equal(getPromiseDefault(records, buyerKey, 'broadcast-1')?.status, 'CONFIRMED');
  assert.equal(summarizePromiseDefaults(records, buyerKey).confirmedCount, 1);
  assert.equal(summarizePromiseDefaults(records, buyerKey).decidedSessionIds.size, 1);
});

test('cancelling a confirmed default keeps the decision but removes the count', () => {
  const buyerKey = promiseDefaultBuyerKey('buyer-123', '햇살');
  const records = [
    { buyerKey, buyerNickname: '햇살', sessionId: 'broadcast-1',
      status: 'CONFIRMED', updatedAt: '2026-09-30T00:00:00Z' },
    { buyerKey, buyerNickname: '햇살', sessionId: 'broadcast-1',
      status: 'CANCELLED', updatedAt: '2026-09-30T00:01:00Z' },
  ];
  const summary = summarizePromiseDefaults(records, buyerKey);
  assert.equal(summary.confirmedCount, 0);
  assert.equal(summary.decidedSessionIds.has('broadcast-1'), true);
});

test('equal nicknames with different buyer IDs never share a default', () => {
  const one = promiseDefaultBuyerKey('buyer-1', '햇살');
  const two = promiseDefaultBuyerKey('buyer-2', '햇살');
  assert.notEqual(one, two);
  const records = [{ buyerKey: one, buyerNickname: '햇살', sessionId: 'broadcast-1',
    status: 'CONFIRMED', updatedAt: '2026-09-30T00:00:00Z' }];
  assert.equal(summarizePromiseDefaults(records, one).confirmedCount, 1);
  assert.equal(summarizePromiseDefaults(records, two).confirmedCount, 0);
});

test('a separate broadcast adds another default and deleted sale rows cannot erase it', () => {
  const buyerKey = promiseDefaultBuyerKey(undefined, '햇살언니');
  const records = ['broadcast-1', 'broadcast-2'].map((sessionId) => ({
    buyerKey, buyerNickname: '햇살언니', sessionId,
    status: 'CONFIRMED', updatedAt: '2026-09-30T00:00:00Z',
  }));
  assert.equal(summarizePromiseDefaults(records, buyerKey).confirmedCount, 2);
});
