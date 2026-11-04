import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManageDashboard } from '../src/services/manage/dashboard.ts';
import {
  buildManageSummary, summarySaleFromRow, summaryInvoiceFromRow, summaryPaymentFromRow,
  summaryMessageFromRow, summarySessionFromRow, contactLinksFromRows, fulfillmentItemsFromRows,
} from '../src/services/manage/manageSummary.ts';

const NOW = new Date('2026-11-04T12:00:00+09:00');
const CONFIG = { type: 'CONDITIONAL_FREE', defaultFee: 3000, freeThreshold: 50000, remoteAreaFee: 3000, includeKeepingInThreshold: true, updatedAt: '' };
const sale = (id, sessionId, buyerId, buyerNickname, recognizedAt, amount) => ({
  id, sessionId, buyerId, buyerNickname, recognizedAt, amount,
  status: '확정', recordState: 'ACTIVE', rawTranscript: '', quantity: 1,
});

function input(scope = { mode: 'session', sessionId: 'night' }) {
  return {
    scope,
    now: NOW,
    sessions: [
      { id: 'night', displayCode: '2026-11-03 라이브 2회차', startedAt: '2026-11-03T22:00:00+09:00', endedAt: '2026-11-04T02:00:00+09:00', status: 'ENDED' },
      { id: 'morning', displayCode: '2026-11-04 라이브 1회차', startedAt: '2026-11-04T09:00:00+09:00', status: 'ACTIVE' },
      { id: 'future', displayCode: '2026-11-05 라이브 1회차', startedAt: '2026-11-05T09:00:00+09:00', status: 'ENDED' },
    ],
    sales: [
      sale('a-before', 'night', 'buyer-a', '가가가', '2026-11-03T23:30:00+09:00', 10000),
      sale('a-after', 'night', 'buyer-a', '가가가', '2026-11-04T00:30:00+09:00', 20000),
      sale('b-first', 'morning', 'buyer-b', '나나나', '2026-11-04T09:30:00+09:00', 30000),
      sale('b-second', 'morning', 'buyer-b', '나나나', '2026-11-04T11:00:00+09:00', 5000),
      sale('c-future', 'future', 'buyer-c', '다다다', '2026-11-05T09:30:00+09:00', 1000),
    ],
    invoices: [], payments: [], messages: [], contactLinks: [], fulfillmentItems: [],
    shippingConfig: CONFIG, alertDays: { warnDays: 14, alertDays: 30 },
  };
}

const nightInvoice = () => ({
  id: 'invoice-night', status: 'SENT', saleIds: ['a-before', 'a-after'],
  buyerNickname: '가가가', createdAt: '2026-11-04T01:00:00+09:00',
});
const morningInvoice = () => ({
  id: 'invoice-morning', status: 'SENT', saleIds: ['b-first', 'b-second'],
  buyerNickname: '나나나', createdAt: '2026-11-04T11:30:00+09:00',
});

test('KST today includes whole broadcasts started today and excludes an overnight broadcast started yesterday', () => {
  const dashboard = buildManageDashboard(input({ mode: 'period', periodDays: 1 }));
  assert.deepEqual([...dashboard.selectedSessionIds], ['morning']);
  assert.equal(dashboard.sessionCount, 1);
  assert.equal(dashboard.orderCount, 1);
  assert.equal(dashboard.salesAmount, 35000);
  assert.deepEqual(dashboard.orders[0].saleIds, ['b-first', 'b-second']);
  assert.equal(dashboard.orders.some((order) => order.sessionId === 'night'), false);
  assert.equal(dashboard.orders.some((order) => order.sessionId === 'future'), false);
});

test('selecting an overnight session creates one complete session-by-buyer order across midnight', () => {
  const dashboard = buildManageDashboard(input());
  assert.equal(dashboard.orderCount, 1);
  assert.equal(dashboard.sessionCount, 1);
  assert.equal(dashboard.buyerCount, 1);
  assert.equal(dashboard.salesAmount, 30000);
  assert.equal(dashboard.orders[0].sessionId, 'night');
  assert.equal(dashboard.orders[0].productAmount, 30000);
  assert.deepEqual(dashboard.orders[0].saleIds, ['a-before', 'a-after']);
});

test('a next-day matched payment with invoiceId and empty saleIds marks the full prior session order paid', () => {
  const data = input();
  data.invoices = [nightInvoice()];
  data.payments = [{ id: 'late-payment', invoiceId: 'invoice-night', saleIds: [], matchStatus: 'MATCHED', paidAt: '2026-11-04T10:00:00+09:00' }];
  const dashboard = buildManageDashboard(data);
  assert.equal(dashboard.orders[0].stage, 'PAID');
  assert.equal(dashboard.paidAmount, dashboard.orders[0].totalAmount);
  assert.equal(dashboard.unpaidAmount, 0);
  assert.deepEqual([...dashboard.paidSaleIds].sort(), ['a-after', 'a-before']);
  assert.equal(dashboard.goods.readyToShip, 2);
  assert.equal(dashboard.todos.some((todo) => todo.kind === 'PAYMENT_REVIEW'), false);
});

test('an SMS exactly linked outside the selected session cannot become its contact suggestion or unknown-sender todo', () => {
  const data = input();
  data.messages = [{ phone: '01099998888', direction: 'INCOMING', body: '가가가 닉네임입니다', saleIds: ['b-first'], receivedAt: '2026-11-04T10:30:00+09:00' }];
  const dashboard = buildManageDashboard(data);
  assert.equal(dashboard.contactBook.byBuyer.get('buyer:buyer-a').state, 'NONE');
  assert.deepEqual(dashboard.contactBook.unassignedPhones, []);
  assert.deepEqual(dashboard.contactMessages, []);
  assert.equal(dashboard.todos.some((todo) => todo.kind === 'UNKNOWN_SENDER'), false);
});

test('candidate review and unassigned deposits are separate, while another session candidate stays outside the view', () => {
  const data = input();
  data.invoices = [nightInvoice(), morningInvoice()];
  data.payments = [
    { id: 'night-candidate', saleIds: [], candidateIds: ['invoice-night'], matchStatus: 'NEEDS_REVIEW', paidAt: '2026-11-04T10:00:00+09:00' },
    { id: 'unknown', saleIds: [], matchStatus: 'UNMATCHED', paidAt: '2026-11-04T10:05:00+09:00' },
    { id: 'other-session', saleIds: [], candidateIds: ['invoice-morning'], matchStatus: 'NEEDS_REVIEW', paidAt: '2026-11-04T11:45:00+09:00' },
  ];
  const dashboard = buildManageDashboard(data);
  assert.equal(dashboard.todos.find((todo) => todo.kind === 'PAYMENT_REVIEW').count, 1);
  assert.equal(dashboard.todos.find((todo) => todo.kind === 'PAYMENT_UNASSIGNED').count, 1);
  assert.equal(dashboard.orders[0].stage, 'AWAITING_PAYMENT');
  assert.equal(dashboard.paidAmount, 0);
});

/** Transform independent client-shaped fixtures into the rows read by manage-summary. */
function serverInput(data) {
  return {
    ...data,
    sales: data.sales.map((item) => summarySaleFromRow({
      id: item.id, session_id: item.sessionId, buyer_id: item.buyerId, buyer_nickname: item.buyerNickname,
      recognized_at: item.recognizedAt, amount: item.amount, status: item.status, record_state: item.recordState,
      quantity: item.quantity, ai_verification: item.aiVerification,
    })),
    sessions: data.sessions.map((item) => summarySessionFromRow({
      id: item.id, display_code: item.displayCode, started_at: item.startedAt, ended_at: item.endedAt, status: item.status,
    })),
    invoices: data.invoices.map((item) => summaryInvoiceFromRow({
      id: item.id, status: item.status, sale_ids: item.saleIds, customer_nickname: item.buyerNickname, created_at: item.createdAt,
    })),
    payments: data.payments.map((item) => summaryPaymentFromRow({
      sale_ids: item.saleIds, match_status: item.matchStatus, paid_at: item.paidAt,
      invoice_id: item.invoiceId, candidate_ids: item.candidateIds,
    })),
    messages: data.messages.map((item) => summaryMessageFromRow({
      phone_number: item.phone, direction: item.direction, body: item.body, received_at: item.receivedAt, sale_ids: item.saleIds,
    }, (body) => String(body || '').trim())),
    contactLinks: contactLinksFromRows(data.contactLinks.map((item) => ({
      buyer_key: item.buyerKey, nickname: item.nickname, phone: item.phone, linked_at: item.linkedAt, state: item.blocked ? 'BLOCKED' : 'LINKED',
    }))),
    fulfillmentItems: fulfillmentItemsFromRows(data.fulfillmentItems.map((item) => ({
      sale_id: item.saleId, buyer_key: item.buyerKey, state: item.state, kept_at: item.keptAt,
      shipment_id: item.shipmentId, cancelled_by: item.cancelledBy, refunded_at: item.refunded ? NOW.toISOString() : null,
    }))),
  };
}

test('server row mapping and client data produce identical summary totals and tasks for every new scope', () => {
  const scopes = [
    ...['night', 'morning', 'LATEST', 'ALL'].map((sessionId) => ({ mode: 'session', sessionId })),
    ...[0, 1, 7, 30].map((periodDays) => ({ mode: 'period', periodDays })),
  ];
  for (const scope of scopes) {
    const data = input(scope);
    data.invoices = [nightInvoice(), morningInvoice()];
    data.payments = [
      { id: 'late-payment', invoiceId: 'invoice-night', saleIds: [], matchStatus: 'MATCHED', paidAt: '2026-11-04T10:00:00+09:00' },
      { id: 'unknown', saleIds: [], matchStatus: 'UNMATCHED', paidAt: '2026-11-04T10:05:00+09:00' },
    ];
    data.messages = [{ phone: '01022223333', direction: 'INCOMING', body: '주소 보냅니다', saleIds: ['b-first'], receivedAt: '2026-11-04T11:45:00+09:00' }];
    data.contactLinks = [{ buyerKey: 'buyer:buyer-a', nickname: '가가가', phone: '01011112222', linkedAt: '2026-11-03T23:00:00+09:00' }];
    data.fulfillmentItems = [{ saleId: 'a-before', buyerKey: 'buyer:buyer-a', state: 'KEPT', keptAt: '2026-11-04T02:00:00+09:00' }];
    const local = buildManageDashboard(data);
    const summary = buildManageSummary(serverInput(data));
    for (const field of ['scope', 'salesAmount', 'paidAmount', 'unpaidAmount', 'orderCount', 'sessionCount', 'buyerCount', 'stages', 'goods', 'todos', 'keeping']) {
      assert.deepEqual(summary[field], local[field], `${field}: ${JSON.stringify(scope)}`);
    }
    assert.equal(summary.computedAt, NOW.toISOString());
  }
});
