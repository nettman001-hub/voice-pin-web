import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildManageDashboard } from '../src/services/manage/dashboard.ts';
import {
  buildManageSummary, contactLinksFromRows, fulfillmentItemsFromRows, normalizeSummaryPeriod, overrideLookup,
  summaryInvoiceFromRow, summaryMessageFromRow, summaryPaymentFromRow, summarySaleFromRow, SUMMARY_SALE_COLUMNS,
} from '../src/services/manage/manageSummary.ts';
import { normalizeKeepingAlertDays } from '../src/services/manage/fulfillment.ts';

const CONFIG = { type: 'CONDITIONAL_FREE', defaultFee: 3000, freeThreshold: 50000, remoteAreaFee: 3000, includeKeepingInThreshold: true, updatedAt: '' };
const NOW = new Date('2026-11-03T10:00:00Z');

// 운영 DB 행 모양 그대로
const saleRows = [
  { id: 's1', session_id: 'r1', buyer_nickname: '가가가', buyer_id: 'b1', record_state: 'ACTIVE', amount: 20000, recognized_at: '2026-11-03T08:00:00Z', status: '확정', quantity: 1 },
  { id: 's2', session_id: 'r1', buyer_nickname: '가가가', buyer_id: 'b1', record_state: 'ACTIVE', amount: 15000, recognized_at: '2026-11-03T08:05:00Z', status: '확정', quantity: 1 },
  { id: 's3', session_id: 'r1', buyer_nickname: '나나', buyer_id: null, record_state: 'ACTIVE', amount: 30000, recognized_at: '2026-11-03T08:10:00Z', status: '확정', quantity: 1 },
  { id: 's4', session_id: 'r1', buyer_nickname: '다다', buyer_id: 'b3', record_state: 'ACTIVE', amount: 9000, recognized_at: '2026-11-03T08:20:00Z', status: '보류', quantity: 1 },
  { id: 's5', session_id: 'r0', buyer_nickname: '라라', buyer_id: 'b4', record_state: 'ACTIVE', amount: 40000, recognized_at: '2026-10-01T08:00:00Z', status: '확정', quantity: 1 },
  { id: 's6', session_id: 'r1', buyer_nickname: '마마', buyer_id: 'b5', record_state: 'ACTIVE', amount: 12000, recognized_at: '2026-11-03T08:30:00Z', status: '확정', quantity: 1, ai_verification: { reviewDecision: 'NOT_SALE' } },
];
const invoiceRows = [
  { id: 'i1', status: 'SENT', sale_ids: ['s1', 's2'], customer_nickname: '가가가', created_at: '2026-11-03T09:00:00Z' },
  { id: 'i5', status: 'PAID', sale_ids: ['s5'], customer_nickname: '라라', created_at: '2026-10-01T09:00:00Z' },
];
const paymentRows = [
  { sale_ids: ['s5'], match_status: 'MATCHED', paid_at: '2026-10-02T00:00:00Z' },
  { sale_ids: [], match_status: 'UNMATCHED', paid_at: '2026-11-03T01:00:00Z' },
];
const messageRows = [{ phone_number: '01012345678', direction: 'INCOMING', body: '나나 01012345678', received_at: '2026-11-03T09:10:00Z' }];
const contactRows = [
  { phone: '01099998888', buyer_key: 'buyer:b1', nickname: '가가가', state: 'LINKED', linked_at: '2026-11-03T09:00:00Z' },
  { phone: '01000000000', buyer_key: null, nickname: null, state: 'BLOCKED', linked_at: '2026-11-03T09:00:00Z' },
  { phone: '01011112222', buyer_key: null, nickname: '옛기록', state: 'LINKED', linked_at: '2026-01-01T00:00:00Z' },
];
const itemRows = [{ sale_id: 's5', buyer_key: 'buyer:b4', state: 'KEPT', kept_at: '2026-10-02T00:00:00Z', shipment_id: null, cancelled_by: null, refunded_at: null }];

function inputFor(periodDays) {
  return {
    sales: saleRows.map(summarySaleFromRow),
    invoices: invoiceRows.map(summaryInvoiceFromRow),
    payments: paymentRows.map(summaryPaymentFromRow),
    messages: messageRows.map((row) => summaryMessageFromRow(row, (body) => String(body || '').trim())),
    contactLinks: contactLinksFromRows(contactRows),
    fulfillmentItems: fulfillmentItemsFromRows(itemRows),
    shippingConfig: CONFIG,
    getOverride: overrideLookup({ 'r1_나나': { shippingFee: 0, reason: '무료' } }),
    alertDays: normalizeKeepingAlertDays(null),
    now: NOW,
    periodDays,
  };
}

test('server summary = the same numbers the phone computes, for every period', () => {
  for (const periodDays of [0, 1, 7, 30]) {
    const input = inputFor(periodDays);
    const local = buildManageDashboard(input);
    const summary = buildManageSummary(input);
    for (const field of ['salesAmount', 'paidAmount', 'unpaidAmount', 'orderCount', 'sessionCount', 'buyerCount', 'stages', 'goods', 'todos', 'keeping']) {
      assert.deepEqual(summary[field], local[field], `${field} @ ${periodDays}일`);
    }
    assert.equal(summary.periodDays, periodDays);
    assert.equal(summary.computedAt, NOW.toISOString());
    // 무거운 목록은 보내지 않는다
    for (const heavy of ['orders', 'contactBook', 'contactMessages', 'paidSaleIds', 'fulfillmentItems']) assert.equal(heavy in summary, false);
    assert.doesNotThrow(() => JSON.stringify(summary));
  }
});

test('summary counts: 보류·NOT_SALE excluded, old kept item excluded by period, unmatched payment is a to-do', () => {
  const summary = buildManageSummary(inputFor(1));
  assert.equal(summary.salesAmount, 65000); // s1+s2+s3 (보류 s4, NOT_SALE s6 제외, s5 는 기간 밖)
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.sessionCount, 1);
  assert.equal(summary.buyerCount, 2);
  assert.equal(summary.goods.kept, 0);
  assert.equal(summary.keeping.items, 0);
  assert.ok(summary.todos.some((todo) => todo.kind === 'PAYMENT_REVIEW' && todo.count === 1));
});

test('repeat buyer across sessions counts once as a buyer and twice as orders', () => {
  const input = inputFor(0);
  input.sales.push({ ...input.sales[0], id: 's7', sessionId: 'r2' });
  const summary = buildManageSummary(input);
  assert.equal(summary.orderCount, 4);
  assert.equal(summary.sessionCount, 3);
  assert.equal(summary.buyerCount, 3);
});

test('row mapping: contacts without buyer key are used only when BLOCKED; override key is 회차_닉네임', () => {
  const links = contactLinksFromRows(contactRows);
  assert.deepEqual(links.map((link) => [link.phone, link.blocked]), [['01099998888', false], ['01000000000', true]]);
  const lookup = overrideLookup({ 'r1_나나': { shippingFee: 0 } });
  assert.deepEqual(lookup(' 나나 ', 'r1'), { shippingFee: 0 });
  assert.equal(lookup('나나', 'r2'), null);
  assert.equal(overrideLookup(null)('나나', 'r1'), null);
  assert.equal(fulfillmentItemsFromRows(itemRows)[0].refunded, false);
});

test('period must be one of the home tabs', () => {
  assert.deepEqual([0, 1, 7, 30, '7'].map(normalizeSummaryPeriod), [0, 1, 7, 30, 7]);
  assert.deepEqual([2, -1, 'x', null, 365].map(normalizeSummaryPeriod), [null, null, null, null, null]);
});

test('sales-api: manage-summary is a seller-only read routed before manage writes', () => {
  const index = fs.readFileSync(new URL('../supabase/functions/sales-api/index.ts', import.meta.url), 'utf8');
  assert.match(index, /if \(action === 'manage-summary'\) \{\s*requireCapability\('SALES_READ'\)\s*return await handleManageSummary\(auth, body\)/);
  const handler = fs.readFileSync(new URL('../supabase/functions/sales-api/handlers/manageSummary.ts', import.meta.url), 'utf8');
  assert.match(handler, /auth\.actorType !== 'USER'/);
  assert.match(handler, /\.eq\('workspace_id', workspaceId\)/);
  assert.match(handler, /\.range\(offset, offset \+ PAGE - 1\)/);
  assert.doesNotMatch(handler, /\.(insert|update|upsert|delete|rpc)\(/);
  // 서버는 사진 경로·원문을 읽지 않는다
  assert.doesNotMatch(SUMMARY_SALE_COLUMNS, /capture|image|raw_transcript|\*/);
  // 서버가 가져오는 src 모듈은 Deno 가 읽도록 .ts 확장자를 쓴다
  for (const file of ['manageSummary', 'dashboard', 'orderPipeline', 'fulfillment', 'contactLink', 'todos', 'shippingFee']) {
    const source = fs.readFileSync(new URL(`../src/services/manage/${file}.ts`, import.meta.url), 'utf8');
    for (const [, spec] of source.matchAll(/^import [^;]*? from '([^']+)';/gms)) assert.match(spec, /\.ts$/, `${file}: ${spec}`);
  }
});

test('home uses the server summary first and falls back to the phone numbers', () => {
  const page = fs.readFileSync(new URL('../src/pages/manage/ManageHomePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const dashboard = summary \|\| local;/);
  const hook = fs.readFileSync(new URL('../src/services/manage/useManageData.ts', import.meta.url), 'utf8');
  assert.match(hook, /api\.summary\(periodDays\)/);
  assert.match(hook, /SUMMARY_REFRESH_DELAY_MS = 3000/);
});
