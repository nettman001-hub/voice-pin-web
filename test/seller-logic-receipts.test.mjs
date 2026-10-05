import test from 'node:test';
import assert from 'node:assert/strict';
import { SellerLogicReceiptQueue, sellerLogicPrintable } from '../src/services/sellerLogicReceipts.ts';

const sale = (id = 'sale-1', extra = {}) => ({ id, status: 'CONFIRMED', nickname: '😚JJEONG😚',
  unitPrice: 7000, quantity: 2, productName: '니트', option: '그레이', decidedAt: '2026-10-05T06:26:36Z',
  reason: 'AI 확정', commentIds: ['buyer'], transcriptIds: ['seller'], ...extra });
const success = { ok: true, status: 'PRINTED', printedAt: '2026-10-05T06:26:40Z' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await tick();
  assert.ok(predicate(), 'queue did not settle');
}
function fixture() {
  const calls = [], snapshots = [];
  const queue = new SellerLogicReceiptQueue({ sessionId: 'analysis-session', change: (rows) => snapshots.push(rows),
    print(request) { let resolve; const promise = new Promise((fn) => { resolve = fn; }); calls.push({ request, resolve }); return promise; } });
  return { queue, calls, snapshots, row: (id = 'sale-1') => queue.snapshot().find((row) => row.decisionId === id) };
}

test('only complete AI confirmations print, serially, with exact nickname and quantity total; cumulative results never reprint', async () => {
  const f = fixture(); const rows = [sale(), sale('sale-2'), sale('pending', { status: 'PENDING' }), sale('no-price', { unitPrice: null })];
  f.queue.update(rows, true); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].request.buyerNickname, '😚JJEONG😚');
  assert.equal(f.calls[0].request.amount, 14000);
  f.queue.update(rows, true); assert.equal(f.calls.length, 1);
  f.calls[0].resolve(success); await until(() => f.calls.length === 2);
  f.calls[1].resolve(success); await until(() => f.row('sale-2').status === 'PRINTED');
  f.queue.update(rows, true); await tick(); assert.equal(f.calls.length, 2);
  assert.equal(f.row().status, 'PRINTED'); f.queue.dispose();
});

test('timeout retry keeps the helper idempotency key; explicit reprint increments its revision', async () => {
  const f = fixture(); f.queue.update([sale()], true); await until(() => f.calls.length === 1);
  f.calls[0].resolve({ ok: false, status: 'FAILED', error: 'timeout' }); await until(() => f.row().status === 'FAILED');
  f.queue.update([sale()], true); await tick(); assert.equal(f.calls.length, 1);
  assert.ok(f.queue.print('sale-1')); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].request.saleId, f.calls[0].request.saleId);
  assert.equal(f.calls[1].request.printRevision, 1);
  f.calls[1].resolve(success); await until(() => f.row().status === 'PRINTED');
  assert.equal(f.queue.print('sale-1'), false);
  assert.ok(f.queue.print('sale-1', true)); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].request.printRevision, 2); f.calls[2].resolve(success); f.queue.dispose();
});

test('price and option corrections print a new revision and preserve an older in-flight physical receipt', async () => {
  const f = fixture(); f.queue.update([sale()], true); await until(() => f.calls.length === 1);
  f.queue.update([sale('sale-1', { option: '블랙', unitPrice: 8000 })], true);
  f.calls[0].resolve(success); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].request.printRevision, 2); assert.equal(f.calls[1].request.amount, 16000);
  assert.equal(f.row().outdated, true);
  f.calls[1].resolve(success); await until(() => f.row().status === 'PRINTED');
  assert.equal(f.row().outdated, false); assert.equal(f.row().previousPrinted, true); f.queue.dispose();
});

test('cancellation skips a queued sale and permits a later AI reconfirmation without leaving it stuck', async () => {
  const f = fixture(); f.queue.update([sale('blocker'), sale()], true); await until(() => f.calls.length === 1);
  f.queue.update([sale('blocker'), sale('sale-1', { status: 'CANCELLED' })], true);
  f.calls[0].resolve(success); await until(() => f.row('blocker').status === 'PRINTED'); await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.row().status, 'READY');
  f.queue.update([sale('blocker'), sale()], true); await until(() => f.calls.length === 2);
  f.calls[1].resolve(success); f.queue.dispose();
});

test('cancellation during device output shows the already printed label as outdated', async () => {
  const f = fixture(); f.queue.update([sale()], true); await until(() => f.calls.length === 1);
  f.queue.update([sale('sale-1', { status: 'CANCELLED' })], true);
  f.calls[0].resolve(success); await until(() => f.row().outdated);
  assert.equal(f.row().previousPrinted, true); f.queue.dispose();
});

test('turning automatic output off cancels unsent jobs while keeping manual printing available', async () => {
  const f = fixture(); f.queue.update([sale('blocker'), sale()], true); await until(() => f.calls.length === 1);
  f.queue.update([sale('blocker'), sale()], false); f.calls[0].resolve(success);
  await until(() => f.row('blocker').status === 'PRINTED'); await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.row().status, 'READY');
  f.queue.print('sale-1'); await until(() => f.calls.length === 2); f.calls[1].resolve(success); f.queue.dispose();
});

test('turning off automatic output before the async identity calculation prevents device dispatch', async () => {
  const f = fixture(); f.queue.update([sale()], true); f.queue.update([sale()], false);
  await tick(); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.row().status, 'READY'); f.queue.dispose();
});

test('imported confirmations remain manual and full long identities never collide at the helper truncation boundary', async () => {
  const f = fixture(); const common = 'sla:' + 'x'.repeat(200);
  f.queue.update([sale(common + 'a'), sale(common + 'b')], false); await tick(); assert.equal(f.calls.length, 0);
  f.queue.print(common + 'a'); f.queue.print(common + 'b'); await until(() => f.calls.length === 1);
  f.calls[0].resolve(success); await until(() => f.calls.length === 2);
  assert.notEqual(f.calls[0].request.saleId, f.calls[1].request.saleId);
  assert.match(f.calls[0].request.saleId, /^codex:[0-9a-f]{64}$/); f.calls[1].resolve(success); f.queue.dispose();
});

test('dispose suppresses completion callbacks and remaining queued print jobs', async () => {
  const f = fixture(); f.queue.update([sale(), sale('sale-2')], true); await until(() => f.calls.length === 1);
  const published = f.snapshots.length; f.queue.dispose(); f.calls[0].resolve(success); await tick();
  assert.equal(f.snapshots.length, published); assert.equal(f.calls.length, 1);
});

test('print transport constraints reject invalid quantities and prices without classifying speech', () => {
  for (const extra of [{ status: 'REVIEW' }, { unitPrice: 0 }, { unitPrice: 7000.5 }, { quantity: 0 }, { quantity: 100 }, { decidedAt: 'invalid' }]) {
    assert.equal(sellerLogicPrintable(sale('invalid', extra)), false);
  }
});
