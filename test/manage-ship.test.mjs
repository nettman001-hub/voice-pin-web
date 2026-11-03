import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildShipmentBoard, nextShipmentSteps, shippingAlreadyCharged, shippingNoticeText } from '../src/services/manage/shipmentBoard.ts';
import { buildOrders } from '../src/services/manage/orderPipeline.ts';

const CONFIG = {
  type: 'CONDITIONAL_FREE', defaultFee: 3000, freeThreshold: 50000, remoteAreaFee: 3000,
  includeKeepingInThreshold: true, updatedAt: '2026-11-01T00:00:00Z',
};
let seq = 0;
const sale = (over = {}) => {
  seq += 1;
  return {
    id: `s-${seq}`, sessionId: 'r1', buyerNickname: '꽃심이', amount: 10000, status: '확정', recordState: 'ACTIVE',
    syncStatus: 'SYNCED', recognizedAt: `2026-10-17T12:${String(seq % 60).padStart(2, '0')}:00Z`, rawTranscript: '', ...over,
  };
};

test('board: new paid buyer is ready with kept items; kept-only buyer waits; unpaid and cancelled are left out', () => {
  const kept = sale({ sessionId: 'r0' });
  const fresh = sale();
  const unpaid = sale();
  const cancelled = sale();
  const onlyKept = sale({ buyerNickname: '달' });
  const items = new Map([
    [kept.id, { saleId: kept.id, state: 'KEPT', keptAt: '2026-10-10T00:00:00Z' }],
    [cancelled.id, { saleId: cancelled.id, state: 'CANCELLED', cancelledBy: 'CUSTOMER' }],
    [onlyKept.id, { saleId: onlyKept.id, state: 'KEPT', keptAt: '2026-10-01T00:00:00Z' }],
  ]);
  const board = buildShipmentBoard({
    sales: [kept, fresh, unpaid, cancelled, onlyKept],
    paidSaleIds: new Set([kept.id, fresh.id, cancelled.id, onlyKept.id]),
    items, shipments: [], shippingConfig: CONFIG,
    invoices: [{ status: 'PAID', saleIds: [fresh.id], amount: 13000, phoneNumber: '01011112222', address: '서울 어딘가', createdAt: '2026-10-18' }],
    contactPhones: new Map([['nickname:꽃심이', '01099998888']]),
  });
  assert.equal(board.ready.length, 1);
  const ready = board.ready[0];
  assert.deepEqual(ready.plan.saleIds.sort(), [kept.id, fresh.id].sort());
  assert.equal(ready.phone, '01099998888', 'linked contact wins over invoice phone');
  assert.equal(ready.address, '서울 어딘가');
  assert.equal(ready.plan.feeDue, 0, 'shipping already charged on the paid invoice (13,000 - 10,000)');
  assert.ok(ready.plan.excluded.some((item) => item.reason === '고객 취소'));
  assert.ok(ready.plan.excluded.some((item) => item.reason === '결제 전'));
  assert.deepEqual(board.keptOnly.map((buyer) => buyer.nickname), ['달']);
  assert.equal(board.refundNeeded.length, 1);
  assert.equal(board.refundNeeded[0].saleId, cancelled.id);
});

test('board: items already in a shipment do not show as ready; active and done shipments are split', () => {
  const a = sale({ buyerNickname: '하늘이' });
  const items = new Map([[a.id, { saleId: a.id, state: 'RESERVED', shipmentId: 'ship-1' }]]);
  const shipments = [
    { id: 'ship-1', saleIds: [a.id], recipientName: '하늘이', phoneNumber: '010', address: 'x', carrier: '', trackingNumber: '', status: 'RESERVED', createdAt: '2026-11-01T00:00:00Z' },
    { id: 'ship-0', saleIds: [], recipientName: '옛', phoneNumber: '010', address: 'x', carrier: 'CJ대한통운', trackingNumber: '1', status: 'SHIPPED', createdAt: '2026-11-01T00:00:00Z', shippedAt: '2026-11-02T00:00:00Z' },
  ];
  const board = buildShipmentBoard({
    sales: [a], paidSaleIds: new Set([a.id]), items, shipments, invoices: [], shippingConfig: CONFIG, now: new Date('2026-11-03T00:00:00Z'),
  });
  assert.equal(board.ready.length, 0);
  assert.equal(board.active.length, 1);
  assert.equal(board.active[0].productAmount, 10000);
  assert.equal(board.done.length, 1);
});

test('kept-only buyer pays the full shipping at shipment', () => {
  const a = sale({ buyerNickname: '별' });
  const board = buildShipmentBoard({
    sales: [a], paidSaleIds: new Set([a.id]), items: new Map([[a.id, { saleId: a.id, state: 'KEPT' }]]),
    shipments: [], invoices: [{ status: 'PAID', saleIds: [a.id], amount: 10000 }], shippingConfig: CONFIG,
  });
  assert.equal(board.keptOnly[0].plan.feeDue, 3000);
});

test('shipping already charged ignores unpaid invoices', () => {
  const amount = () => 10000;
  assert.equal(shippingAlreadyCharged(['a'], [{ status: 'SENT', saleIds: ['a'], amount: 13000 }], amount), 0);
  assert.equal(shippingAlreadyCharged(['a'], [{ status: 'PAID', saleIds: ['a', 'b'], amount: 23000 }], amount), 3000);
});

test('shipment steps follow the server rules', () => {
  assert.deepEqual(nextShipmentSteps('RESERVED'), ['PACKED', 'CANCELLED']);
  assert.deepEqual(nextShipmentSteps('PACKED'), ['SHIPPED', 'CANCELLED']);
  assert.deepEqual(nextShipmentSteps('SHIPPED'), ['DELIVERED']);
  assert.deepEqual(nextShipmentSteps('DELIVERED'), []);
  const sql = fs.readFileSync('supabase/migrations/202611030001_manage_fulfillment.sql', 'utf8');
  assert.match(sql, /v_shipment\.status in \('RESERVED', 'READY'\) and v_to in \('PACKED', 'CANCELLED'\)/);
  assert.match(shippingNoticeText('꽃심이', 'CJ대한통운', '123'), /CJ대한통운 123/);
});

test('customer-cancelled items leave the order bill', () => {
  const a = sale({ buyerNickname: '구름' });
  const b = sale({ buyerNickname: '구름' });
  const [order] = buildOrders({ sales: [a, b], shippingConfig: CONFIG, cancelledSaleIds: new Set([b.id]) });
  assert.deepEqual(order.saleIds, [a.id]);
  assert.equal(order.productAmount, 10000);
});

test('ship page is routed; home, more and to-dos point to it', () => {
  assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /path="\/manage\/ship"/);
  assert.match(fs.readFileSync('src/pages/manage/ManageHomePage.tsx', 'utf8'), /\/manage\/ship\?filter=refund/);
  assert.match(fs.readFileSync('src/pages/seller/AppMorePage.tsx', 'utf8'), /path: '\/manage\/ship'/);
  assert.match(fs.readFileSync('src/services/manage/todos.ts', 'utf8'), /'\/manage\/ship'/);
  const page = fs.readFileSync('src/pages/manage/ShipPage.tsx', 'utf8');
  assert.match(page, /reserveShipment/);
  assert.match(page, /setShipmentStatus/);
  assert.doesNotMatch(page, /updateShipment|createShipmentsForSales/);
});
