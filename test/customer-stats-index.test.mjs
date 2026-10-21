import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerStatsIndex,
  customerStatsLabel,
} from '../src/services/customerStatsIndex.ts';
const sale = (id, buyerId, sessionId, status = '자동저장') => ({
  id,
  buyerId,
  buyerNickname: '하니',
  sessionId,
  amount: 15000,
  status,
  recognizedAt: '2026-10-20T00:00:00Z',
  rawTranscript: '',
});
test('exact identities, historical item/session totals, per-broadcast defaults, explicit overrides', () => {
  const rows = [
    sale('a', 'b1', 'past'),
    sale('b', 'b1', 'past'),
    sale('c', 'b1', 'today'),
    sale('d', 'b1', 'bad', '취소'),
    sale('e', 'b1', 'bad', '취소'),
    sale('f', 'b2', 'past'),
  ];
  const buyers = [
    { id: 'b1', displayNickname: '하니', platformUserId: '123' },
    { id: 'b2', displayNickname: '하니', platformUserId: '456' },
  ];
  const index = new CustomerStatsIndex().reconcile({
    sales: rows,
    buyers,
    currentSessionId: 'today',
  });
  const one = index.lookup({ platformUserId: '123', nickname: '새닉네임' });
  assert.equal(one.purchaseCount, 2);
  assert.equal(one.purchaseSessionCount, 1);
  assert.equal(one.totalRevenue, 30000);
  assert.equal(one.defaultCount, 1);
  assert.equal(one.todayCount, 1);
  assert.equal(index.lookup({ nickname: '하니' }).ambiguous, true);
  assert.equal(index.lookup({ nickname: '하니이' }).purchaseCount, 0);
  index.reconcile({
    sales: rows,
    buyers,
    currentSessionId: 'today',
    promiseDefaults: [
      {
        buyerKey: 'buyer:b1',
        buyerNickname: '하니',
        sessionId: 'bad',
        status: 'CANCELLED',
        updatedAt: '2026-10-21',
      },
    ],
  });
  assert.equal(index.lookup({ buyerId: 'b1' }).defaultCount, 0);
  assert.match(customerStatsLabel(one), /2건\/1회 3.0만/);
});
test('legacy buyer duplicates with the same real platform account share stats; exact nickname decisions do not create false ambiguity', () => {
  const rows = [sale('one', 'old', 'past'), sale('two', 'new', 'past')];
  const buyers = [
    {
      id: 'old',
      displayNickname: '하니',
      platform: 'TIKTOK',
      platformUserId: '123',
    },
    {
      id: 'new',
      displayNickname: '바뀐이름',
      platform: 'TIKTOK',
      platformUserId: '123',
    },
  ];
  const index = new CustomerStatsIndex().reconcile({
    sales: rows,
    buyers,
    currentSessionId: 'today',
  });
  assert.equal(index.lookup({ platformUserId: '123' }).purchaseCount, 2);
  assert.equal(index.lookup({ buyerId: 'new' }).purchaseCount, 2);
  const legacy = [
    { ...sale('legacy', undefined, 'bad', '취소'), buyerNickname: '하니님' },
  ];
  index.reconcile({
    sales: legacy,
    currentSessionId: 'today',
    promiseDefaults: [
      {
        buyerKey: 'nickname:하니',
        buyerNickname: '하니님',
        sessionId: 'bad',
        status: 'CANCELLED',
        updatedAt: '2026-10-21',
      },
    ],
  });
  assert.equal(index.lookup({ nickname: '하니님' }).ambiguous, undefined);
  assert.equal(index.lookup({ nickname: '하니님' }).defaultCount, 0);
  assert.equal(index.lookup({ nickname: '하니' }).defaultCount, 0);
});
test('unchanged buyers reuse calculation when another buyer sells or cancels', () => {
  const a = sale('a', 'a', 'past'),
    b = sale('b', 'b', 'past');
  b.buyerNickname = '다른분';
  const index = new CustomerStatsIndex().reconcile({
    sales: [a, b],
    currentSessionId: 'today',
  });
  const before = index.lookup({ buyerId: 'b' });
  index.reconcile({
    sales: [a, { ...a, id: 'new', sessionId: 'today' }, b],
    currentSessionId: 'today',
  });
  assert.equal(index.lookup({ buyerId: 'b' }), before);
  assert.equal(index.lookup({ buyerId: 'a' }).todayCount, 1);
});
