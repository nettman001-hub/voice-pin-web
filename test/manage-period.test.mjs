import test from 'node:test';
import assert from 'node:assert/strict';
import { inManagePeriod, readManagePeriod, withManagePeriod } from '../src/services/manage/period.ts';
import { buildShipmentBoard } from '../src/services/manage/shipmentBoard.ts';

test('period links retain stage/filter and accept only supported periods including all', () => {
  for (const days of [0, 1, 7, 30]) {
    const path = withManagePeriod('/manage/orders?stage=READY_TO_BILL', days);
    const params = new URL(path, 'https://voicecap.shop').searchParams;
    assert.equal(params.get('stage'), 'READY_TO_BILL');
    assert.equal(readManagePeriod(params.get('period')), days);
    assert.equal(withManagePeriod('/manage/ship?filter=refund', days), `/manage/ship?filter=refund&period=${days}`);
  }
  assert.equal(readManagePeriod(null, 0), 0);
  assert.equal(readManagePeriod('365'), 7);
  assert.equal(readManagePeriod(''), 7);
});

test('period filters shipment views while retaining older kept items in the atomic shipment plan', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const sale = (id, nickname, recognizedAt) => ({ id, buyerNickname: nickname, sessionId: id, recognizedAt, amount: 10000, status: '확정', recordState: 'ACTIVE', rawTranscript: '' });
  const sales = [sale('old-kept', '가가가', '2026-10-01T00:00:00Z'), sale('new', '가가가', '2026-11-03T00:00:00Z'), sale('old-refund', '나나나', '2026-10-01T00:00:00Z'), sale('new-refund', '다다다', '2026-11-03T00:00:00Z')];
  const input = {
    sales, paidSaleIds: new Set(sales.map((s) => s.id)),
    items: new Map([['old-kept', { saleId: 'old-kept', state: 'KEPT' }], ['old-refund', { saleId: 'old-refund', state: 'CANCELLED' }], ['new-refund', { saleId: 'new-refund', state: 'CANCELLED' }]]),
    shipments: [], invoices: [], now,
    shippingConfig: { type: 'CONDITIONAL_FREE', defaultFee: 3000, freeThreshold: 50000, remoteAreaFee: 3000, includeKeepingInThreshold: true, updatedAt: '' },
  };
  const week = buildShipmentBoard({ ...input, periodDays: 7 });
  assert.equal(week.ready.length, 1);
  assert.deepEqual(new Set(week.ready[0].plan.saleIds), new Set(['old-kept', 'new']));
  assert.deepEqual(week.refundNeeded.map((item) => item.saleId), ['new-refund']);
  assert.equal(week.keptOnly.length, 0);
  const all = buildShipmentBoard({ ...input, periodDays: 0 });
  assert.equal(all.refundNeeded.length, 2);
  assert.equal(all.keptOnly.length, 1);
  assert.equal(inManagePeriod('2026-10-01T00:00:00Z', 0, now), true);
  assert.equal(inManagePeriod('2026-10-01T00:00:00Z', 7, now), false);
});
