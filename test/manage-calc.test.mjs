import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildContactBook, normalizePhone } from '../src/services/manage/contactLink.ts';
import { buildOrders, summarizeStages, ordersProductTotal, saleBuyerKey } from '../src/services/manage/orderPipeline.ts';
import {
  canKeep, goodsStateOf, planShipment, keepingAlerts, normalizeKeepingAlertDays, DEFAULT_KEEPING_ALERT_DAYS,
} from '../src/services/manage/fulfillment.ts';
import { buildManageTodos } from '../src/services/manage/todos.ts';
import { computeShippingFee } from '../src/services/manage/shippingFee.ts';
import { calculateSalesListRevenue } from '../src/services/salesListRevenue.ts';

const CONFIG = {
  type: 'CONDITIONAL_FREE', defaultFee: 3000, freeThreshold: 50000, remoteAreaFee: 3000,
  includeKeepingInThreshold: true, updatedAt: '2026-11-01T00:00:00Z',
};

let seq = 0;
function sale(over = {}) {
  seq += 1;
  return {
    id: `s-${seq}`, sessionId: 'r1', buyerNickname: '꽃심이', amount: 10000, status: '확정',
    recordState: 'ACTIVE', syncStatus: 'SYNCED', recognizedAt: `2026-10-17T12:${String(seq % 60).padStart(2, '0')}:00Z`,
    rawTranscript: '', ...over,
  };
}
const msg = (phone, body) => ({ phone, direction: 'INCOMING', body });

// ── 연락처 연결 ─────────────────────────────────────────────

test('contact: previous link by buyer key wins, legacy link matches exact nickname only', () => {
  const buyers = [
    { buyerKey: 'buyer:1', nickname: '꽃심이' },
    { buyerKey: 'nickname:하늘이', nickname: '하늘이' },
    { buyerKey: 'nickname:하늘이네', nickname: '하늘이네' },
  ];
  const book = buildContactBook(buyers, [
    { phone: '010-1111-2222', buyerKey: 'buyer:1', nickname: '꽃심이', linkedAt: '2026-10-01T00:00:00Z' },
    { phone: '01033334444', nickname: '하늘 이', linkedAt: '2026-10-01T00:00:00Z' },
  ], []);
  assert.equal(book.byBuyer.get('buyer:1').state, 'LINKED');
  assert.equal(book.byBuyer.get('buyer:1').source, 'PREVIOUS');
  assert.equal(book.byBuyer.get('buyer:1').phone, '01011112222');
  assert.equal(book.byBuyer.get('nickname:하늘이').phone, '01033334444');
  // 비슷한 닉네임(하늘이네)에는 붙이지 않는다
  assert.equal(book.byBuyer.get('nickname:하늘이네').state, 'NONE');
  assert.deepEqual(book.callList.map((b) => b.buyerKey), ['nickname:하늘이네']);
});

test('contact: exact nickname in a new SMS links and asks to save; unknown sender stays unassigned', () => {
  const book = buildContactBook([{ buyerKey: 'buyer:1', nickname: '꽃심이' }], [], [
    msg('+82 10-5555-6666', '안녕하세요 꽃심이 입니다 주소 보내요'),
    msg('01077778888', '입금했어요'),
  ]);
  const contact = book.byBuyer.get('buyer:1');
  assert.equal(contact.state, 'LINKED');
  assert.equal(contact.phone, '01055556666');
  assert.equal(contact.shouldSave, true);
  assert.deepEqual(book.unassignedPhones, ['01077778888']);
  assert.equal(normalizePhone('+82-10-1234-5678'), '01012345678');
});

test('contact: 1-2 letter nicknames need context; standalone word needs confirmation', () => {
  const intro = buildContactBook([{ buyerKey: 'nickname:달', nickname: '달' }], [], [msg('01011110000', '닉네임 달이에요')]);
  assert.equal(intro.byBuyer.get('nickname:달').state, 'LINKED');
  const loose = buildContactBook([{ buyerKey: 'nickname:달', nickname: '달' }], [], [msg('01011110000', '달 입금했어요')]);
  assert.equal(loose.byBuyer.get('nickname:달').state, 'NEEDS_CONFIRM');
  assert.equal(loose.byBuyer.get('nickname:달').shouldSave, false);
  const word = buildContactBook([{ buyerKey: 'nickname:달', nickname: '달' }], [], [msg('01011110000', '달력 주세요')]);
  assert.equal(word.byBuyer.get('nickname:달').state, 'NONE');
});

test('contact: similar nickname is only a candidate, never linked', () => {
  const book = buildContactBook([{ buyerKey: 'nickname:꽃심이', nickname: '꽃심이' }], [], [msg('01011110000', '꼿심이에요 주소요')]);
  assert.equal(book.byBuyer.get('nickname:꽃심이').state, 'NEEDS_CONFIRM');
});

test('contact: blocked number is not re-attached; a number linked to someone else is not proposed', () => {
  const buyers = [{ buyerKey: 'nickname:꽃심이', nickname: '꽃심이' }, { buyerKey: 'nickname:다른분', nickname: '다른분' }];
  const book = buildContactBook(buyers, [
    { phone: '01011110000', nickname: '꽃심이', linkedAt: '2026-10-01T00:00:00Z', blocked: true },
    { phone: '01022220000', nickname: '다른분', linkedAt: '2026-10-01T00:00:00Z' },
  ], [msg('01011110000', '꽃심이에요'), msg('01022220000', '꽃심이 대신 보내요')]);
  assert.equal(book.byBuyer.get('nickname:꽃심이').state, 'NONE');
  assert.equal(book.byBuyer.get('nickname:다른분').phone, '01022220000');
});

test('contact: two numbers sending the same nickname need confirmation', () => {
  const book = buildContactBook([{ buyerKey: 'nickname:꽃심이', nickname: '꽃심이' }], [],
    [msg('01011110000', '꽃심이에요'), msg('01022220000', '꽃심이 언니 대신 보내요')]);
  const contact = book.byBuyer.get('nickname:꽃심이');
  assert.equal(contact.state, 'NEEDS_CONFIRM');
  assert.equal(contact.candidates.length, 2);
});

// ── 돈 단계 ─────────────────────────────────────────────────

function linkedBook(keys) {
  return { byBuyer: new Map(keys.map((key) => [key, { buyerKey: key, nickname: '', state: 'LINKED', candidates: [], reason: '', shouldSave: false }])), unassignedPhones: [], callList: [] };
}

test('money stages: contact first, then bill, then payment', () => {
  const sales = [
    sale({ buyerNickname: '가가가' }), sale({ buyerNickname: '나나나' }),
    sale({ buyerNickname: '다다다' }), sale({ buyerNickname: '라라라' }), sale({ buyerNickname: '마마마' }),
  ];
  const ids = Object.fromEntries(sales.map((s) => [s.buyerNickname, s.id]));
  const orders = buildOrders({
    sales, shippingConfig: CONFIG,
    contactBook: linkedBook(['nickname:나나나', 'nickname:다다다', 'nickname:라라라', 'nickname:마마마']),
    invoices: [
      { id: 'i1', sessionId: 'r1', buyerNickname: '다다다', status: 'SENT' },
      { id: 'i2', saleIds: [ids['라라라']], status: 'PAID' },
      { id: 'i3', sessionId: 'r1', buyerNickname: '마마마', status: 'DRAFT' },
      { id: 'i4', sessionId: 'r1', buyerNickname: '마마마', status: 'CANCELLED' },
    ],
  });
  const stage = Object.fromEntries(orders.map((o) => [o.nickname, o.stage]));
  assert.deepEqual(stage, {
    가가가: 'NEEDS_CONTACT', 나나나: 'READY_TO_BILL', 다다다: 'AWAITING_PAYMENT', 라라라: 'PAID', 마마마: 'READY_TO_BILL',
  });
  const summary = summarizeStages(orders);
  assert.deepEqual(summary.map((s) => s.orderCount), [1, 2, 1, 1]);
  assert.equal(summary[0].label, '연락처 연결');
});

test('money stages: payment matched to every sale counts as paid; partial payment does not', () => {
  const a = sale({ buyerNickname: '가가가' });
  const b = sale({ buyerNickname: '가가가' });
  const full = buildOrders({ sales: [a, b], shippingConfig: CONFIG, paidSaleIds: new Set([a.id, b.id]) });
  assert.equal(full[0].stage, 'PAID');
  const partial = buildOrders({ sales: [a, b], shippingConfig: CONFIG, paidSaleIds: new Set([a.id]) });
  assert.equal(partial[0].stage, 'NEEDS_CONTACT');
});

test('two open invoices on one order are flagged', () => {
  const s = sale({ buyerNickname: '가가가' });
  const [order] = buildOrders({
    sales: [s], shippingConfig: CONFIG,
    invoices: [
      { id: 'a', saleIds: [s.id], status: 'DRAFT', createdAt: '2026-10-17T13:00:00Z' },
      { id: 'b', saleIds: [s.id], status: 'SENT', createdAt: '2026-10-17T14:00:00Z' },
    ],
  });
  assert.deepEqual(order.duplicateOpenInvoiceIds.sort(), ['a', 'b']);
  assert.equal(order.stage, 'AWAITING_PAYMENT');
  const todos = buildManageTodos({ orders: [order] });
  assert.equal(todos[0].kind, 'DUPLICATE_INVOICE');
});

// ── 꽃심이 83,000원 ────────────────────────────────────────

const flowerSales = (excluded = {}) => [10000, 15000, 10000, 10000, 10000, 10000, 2000, 8000, 8000]
  .map((amount, index) => sale({ buyerId: 'buyer-1', amount, ...(index >= 7 ? excluded : {}) }));

test('꽃심이 2회차 fixture totals 83,000 with free shipping; held/cancelled sales drop out', () => {
  const [order] = buildOrders({ sales: flowerSales(), shippingConfig: CONFIG });
  assert.equal(order.productAmount, 83000);
  assert.equal(order.shipping.fee, 0);
  assert.equal(order.totalAmount, 83000);
  assert.equal(order.buyerKey, 'buyer:buyer-1');
  assert.equal(buildOrders({ sales: flowerSales({ status: '보류' }), shippingConfig: CONFIG })[0].productAmount, 67000);
  assert.equal(buildOrders({ sales: flowerSales({ recordState: 'CANCELLED' }), shippingConfig: CONFIG })[0].productAmount, 67000);
  // 서버 확인 필요·저장 대기는 합계에 들어간다
  assert.equal(buildOrders({ sales: flowerSales({ syncStatus: 'PENDING' }), shippingConfig: CONFIG })[0].productAmount, 83000);
});

test('keep customer invoice is product only; manual shipping override still wins', () => {
  const sales = [sale({ buyerNickname: '가가가', amount: 20000 })];
  const keep = new Set(['nickname:가가가']);
  const [order] = buildOrders({ sales, shippingConfig: CONFIG, keepingBuyerKeys: keep });
  assert.equal(order.shipping.fee, 0);
  assert.equal(order.shipping.deferredToShipment, true);
  assert.equal(order.totalAmount, 20000);
  const [normal] = buildOrders({ sales, shippingConfig: CONFIG });
  assert.equal(normal.shipping.fee, 3000);
  const [manual] = buildOrders({
    sales, shippingConfig: CONFIG, keepingBuyerKeys: keep,
    getOverride: (nickname, sessionId) => (nickname === '가가가' && sessionId === 'r1'
      ? { buyerNickname: nickname, sessionId, mode: 'MANUAL', manualFee: 2500, updatedAt: '' } : null),
  });
  assert.equal(manual.shipping.fee, 2500);
  assert.equal(manual.shipping.deferredToShipment, false);
});

test('new order totals equal the 판매내역 total', () => {
  const statuses = ['확정', '자동저장', '수동수정', '보류', '취소'];
  const sales = Array.from({ length: 400 }, (_, i) => sale({
    buyerNickname: `닉${i % 37}`, buyerId: i % 5 === 0 ? `id-${i % 11}` : undefined,
    sessionId: `r${i % 4}`, amount: 1000 * ((i % 13) + 1), status: statuses[i % statuses.length],
    syncStatus: i % 7 === 0 ? 'PENDING' : 'SYNCED',
    aiVerification: i % 29 === 0 ? { reviewDecision: 'NOT_SALE' } : undefined,
  }));
  const orders = buildOrders({ sales, shippingConfig: CONFIG });
  assert.equal(ordersProductTotal(orders), calculateSalesListRevenue(sales, []).totalAmount);
});

test('computeShippingFee matches shippingService.calculateShippingFee', () => {
  const source = fs.readFileSync(new URL('../src/services/shippingService.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => (name === './remoteWorkspaceService' ? { remoteWorkspaceService: {} } : {}),
    localStorage: { getItem: () => null },
  });
  const legacy = module.exports.createShippingService({}, { getItem: () => null, setItem() {} });
  const configs = [CONFIG, { ...CONFIG, type: 'FIXED' }, { ...CONFIG, type: 'FREE' }];
  const overrides = [null, { mode: 'MANUAL', manualFee: 0 }, { mode: 'MANUAL', manualFee: 4000, reason: '도서산간' }, { mode: 'AUTO', manualFee: 1 }];
  for (const config of configs) for (const override of overrides) for (const total of [0, 49999, 50000, 120000]) {
    assert.deepEqual(computeShippingFee(total, config, override), { ...legacy.calculateShippingFee(total, config, override) });
  }
});

// ── 보관·출고 ───────────────────────────────────────────────

test('keeping needs payment first', () => {
  assert.equal(canKeep(false).ok, false);
  assert.equal(canKeep(true).ok, true);
  assert.equal(canKeep(true, { saleId: 'x', state: 'KEPT' }).ok, false);
  assert.equal(goodsStateOf(true, { saleId: 'x', state: 'CANCELLED', cancelledBy: 'CUSTOMER' }), 'REFUND_NEEDED');
  assert.equal(goodsStateOf(true, { saleId: 'x', state: 'CANCELLED', refunded: true }), 'CANCELLED');
  assert.equal(goodsStateOf(false, { saleId: 'x', state: 'CANCELLED' }), 'CANCELLED');
});

test('출고 ships every kept item plus paid new items; only customer-cancelled and unpaid stay out', () => {
  const kept1 = sale({ buyerNickname: '가가가', sessionId: 'r1', amount: 20000 });
  const kept2 = sale({ buyerNickname: '가가가', sessionId: 'r2', amount: 15000 });
  const fresh = sale({ buyerNickname: '가가가', sessionId: 'r3', amount: 10000 });
  const unpaid = sale({ buyerNickname: '가가가', sessionId: 'r3', amount: 9000 });
  const cancelled = sale({ buyerNickname: '가가가', sessionId: 'r2', amount: 7000 });
  const elsewhere = sale({ buyerNickname: '가가가', sessionId: 'r1', amount: 5000 });
  const shipped = sale({ buyerNickname: '가가가', sessionId: 'r1', amount: 4000 });
  const other = sale({ buyerNickname: '나나나', amount: 99000 });
  const all = [kept1, kept2, fresh, unpaid, cancelled, elsewhere, shipped, other];
  const items = new Map([
    [kept1.id, { saleId: kept1.id, state: 'KEPT', keptAt: '2026-10-01T00:00:00Z' }],
    [kept2.id, { saleId: kept2.id, state: 'KEPT', keptAt: '2026-10-10T00:00:00Z' }],
    [cancelled.id, { saleId: cancelled.id, state: 'CANCELLED', cancelledBy: 'CUSTOMER' }],
    [elsewhere.id, { saleId: elsewhere.id, state: 'RESERVED', shipmentId: 'sh-1' }],
    [shipped.id, { saleId: shipped.id, state: 'SHIPPED' }],
  ]);
  const paid = new Set(all.filter((s) => s !== unpaid).map((s) => s.id));
  const plan = planShipment({ buyerKey: 'nickname:가가가', sales: all, paidSaleIds: paid, items, shippingConfig: CONFIG });
  assert.deepEqual(plan.keptSaleIds, [kept1.id, kept2.id]);
  assert.deepEqual(plan.newSaleIds, [fresh.id]);
  assert.equal(plan.productAmount, 45000);
  assert.equal(plan.shipping.fee, 3000);
  assert.equal(plan.feeDue, 3000);
  assert.deepEqual(plan.conflicts, [elsewhere.id]);
  assert.deepEqual(Object.fromEntries(plan.excluded.map((e) => [e.saleId, e.reason])), {
    [unpaid.id]: '결제 전', [cancelled.id]: '고객 취소', [elsewhere.id]: '다른 출고에 이미 들어 있음',
  });
  assert.equal(plan.canReserve, true);

  // 배송비는 한 번: 회차 정산서에서 받은 배송비를 뺀다
  assert.equal(planShipment({ buyerKey: 'nickname:가가가', sales: all, paidSaleIds: paid, items, shippingConfig: CONFIG, shippingAlreadyCharged: 3000 }).feeDue, 0);
  // 보관 금액 합산으로 무료배송 기준을 넘는다
  const big = sale({ buyerNickname: '가가가', sessionId: 'r3', amount: 10000 });
  const withBig = planShipment({ buyerKey: 'nickname:가가가', sales: [...all, big], paidSaleIds: new Set([...paid, big.id]), items, shippingConfig: CONFIG });
  assert.equal(withBig.productAmount, 55000);
  assert.equal(withBig.shipping.fee, 0);
  const notIncluded = planShipment({ buyerKey: 'nickname:가가가', sales: [...all, big], paidSaleIds: new Set([...paid, big.id]), items, shippingConfig: { ...CONFIG, includeKeepingInThreshold: false } });
  assert.equal(notIncluded.shipping.fee, 3000);
});

test('nothing to ship when everything is unpaid', () => {
  const s = sale({ buyerNickname: '가가가' });
  const plan = planShipment({ buyerKey: 'nickname:가가가', sales: [s], paidSaleIds: new Set(), items: new Map(), shippingConfig: CONFIG });
  assert.equal(plan.canReserve, false);
  assert.equal(plan.feeDue, 0);
});

test('keeping alert days are the seller setting, 14/30 by default', () => {
  assert.deepEqual(normalizeKeepingAlertDays(undefined), DEFAULT_KEEPING_ALERT_DAYS);
  assert.deepEqual(normalizeKeepingAlertDays({ warnDays: 7, alertDays: 10 }), { warnDays: 7, alertDays: 10 });
  assert.deepEqual(normalizeKeepingAlertDays({ warnDays: 'x', alertDays: -3 }), { warnDays: 14, alertDays: 30 });
  assert.deepEqual(normalizeKeepingAlertDays({ warnDays: 20, alertDays: 10 }), { warnDays: 20, alertDays: 21 });

  const a = sale({ buyerNickname: '가가가', amount: 10000 });
  const b = sale({ buyerNickname: '가가가', amount: 5000 });
  const c = sale({ buyerNickname: '나나나' });
  const d = sale({ buyerNickname: '다다다' });
  const items = new Map([
    [a.id, { saleId: a.id, state: 'KEPT', keptAt: '2026-10-01T00:00:00Z' }],
    [b.id, { saleId: b.id, state: 'KEPT', keptAt: '2026-10-25T00:00:00Z' }],
    [c.id, { saleId: c.id, state: 'KEPT', keptAt: '2026-10-15T00:00:00Z' }],
    [d.id, { saleId: d.id, state: 'KEPT', keptAt: '2026-10-30T00:00:00Z' }],
  ]);
  const now = new Date('2026-11-02T00:00:00Z');
  const levels = (settings) => Object.fromEntries(keepingAlerts([a, b, c, d], items, now, settings).map((x) => [x.nickname, x.level]));
  assert.deepEqual(levels(), { 가가가: 'ALERT', 나나나: 'WARN', 다다다: 'OK' });
  assert.deepEqual(levels({ warnDays: 3, alertDays: 60 }), { 가가가: 'WARN', 나나나: 'WARN', 다다다: 'WARN' });
  assert.deepEqual(levels({ warnDays: 4, alertDays: 20 }), { 가가가: 'ALERT', 나나나: 'WARN', 다다다: 'OK' });
  const [first] = keepingAlerts([a, b], items, now);
  assert.equal(first.itemCount, 2);
  assert.equal(first.keptAmount, 15000);
  assert.equal(first.days, 32);

  const todos = buildManageTodos({ orders: [], keepingAlerts: keepingAlerts([a, b, c, d], items, now) });
  assert.deepEqual(todos.map((t) => t.kind), ['KEEPING_ALERT', 'KEEPING_WARN']);
});

test('to-dos put contact before billing', () => {
  const sales = [sale({ buyerNickname: '가가가' }), sale({ buyerNickname: '나나나' }), sale({ buyerNickname: '다다다' })];
  const book = buildContactBook(
    sales.map((s) => ({ buyerKey: saleBuyerKey(s), nickname: s.buyerNickname })),
    [{ phone: '01000000001', nickname: '나나나', linkedAt: '2026-10-01T00:00:00Z' }],
    [msg('01000000002', '가가 입니다'), msg('01000000003', '누구게요')],
  );
  const orders = buildOrders({ sales, shippingConfig: CONFIG, contactBook: book });
  const todos = buildManageTodos({ orders, contactBook: book, readyToShipBuyerCount: 2, refundNeededCount: 1 });
  assert.deepEqual(todos.map((t) => t.kind), ['REFUND_NEEDED', 'CONTACT_MISSING', 'UNKNOWN_SENDER', 'READY_TO_BILL', 'READY_TO_SHIP']);
  assert.equal(todos.find((t) => t.kind === 'CONTACT_MISSING').count, 2);
});

test('2,000 sales across 300 buyers stay fast', () => {
  const sales = Array.from({ length: 2000 }, (_, i) => sale({
    buyerNickname: `구매자${i % 300}`, sessionId: `r${i % 7}`, amount: 1000 + (i % 50) * 100,
  }));
  const buyers = [...new Map(sales.map((s) => [saleBuyerKey(s), { buyerKey: saleBuyerKey(s), nickname: s.buyerNickname }])).values()];
  const links = buyers.slice(0, 150).map((b, i) => ({ phone: `0101000${String(i).padStart(4, '0')}`, nickname: b.nickname, linkedAt: '2026-10-01T00:00:00Z' }));
  const messages = Array.from({ length: 300 }, (_, i) => msg(`0102000${String(i).padStart(4, '0')}`, `안녕하세요 구매자${150 + (i % 150)}입니다`));
  const started = performance.now();
  const book = buildContactBook(buyers, links, messages);
  const orders = buildOrders({ sales, shippingConfig: CONFIG, contactBook: book });
  const items = new Map(sales.filter((_, i) => i % 3 === 0).map((s) => [s.id, { saleId: s.id, state: 'KEPT', keptAt: '2026-10-01T00:00:00Z' }]));
  keepingAlerts(sales, items, new Date('2026-11-02T00:00:00Z'));
  buildManageTodos({ orders, contactBook: book });
  const elapsed = performance.now() - started;
  assert.equal(orders.length, new Set(sales.map((s) => `${s.sessionId}:${s.buyerNickname}`)).size);
  assert.equal(ordersProductTotal(orders), calculateSalesListRevenue(sales, []).totalAmount);
  assert.ok(elapsed < 2000, `took ${elapsed}ms`);
});
