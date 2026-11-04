import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MANAGE_APP_TABS, manageTabFor, appScreenTitle, APP_TABS } from '../src/services/appShellState.ts';
import { isNewManageUiEnabled, setNewManageUiEnabled } from '../src/services/manage/manageUiSetting.ts';
import { applyViewportZoom, ZOOM_ALLOWED, ZOOM_BLOCKED } from '../src/services/manage/viewportZoom.ts';
import { buildManageDashboard, paidSaleIdsOf } from '../src/services/manage/dashboard.ts';
import { calculateSalesListRevenue } from '../src/services/salesListRevenue.ts';

const CONFIG = { type: 'CONDITIONAL_FREE', defaultFee: 3000, freeThreshold: 50000, remoteAreaFee: 3000, includeKeepingInThreshold: true, updatedAt: '' };
const NOW = new Date('2026-11-03T03:00:00Z');
let seq = 0;
const sale = (over = {}) => ({
  id: `s${++seq}`, sessionId: 'r1', buyerNickname: '가가가', amount: 10000, status: '확정', recordState: 'ACTIVE',
  recognizedAt: '2026-11-02T12:00:00Z', rawTranscript: '', ...over,
});

test('new bottom nav: 홈 · 주문 · 문자·입금 · 정산 · 더보기; old nav unchanged', () => {
  assert.deepEqual(MANAGE_APP_TABS.map((tab) => tab.name), ['홈', '주문', '문자·입금', '정산', '더보기']);
  assert.deepEqual(APP_TABS.map((tab) => tab.name), ['판매내역', '정산서', '문자비교', '정산', '더보기']);
  assert.equal(manageTabFor('/manage'), 'home');
  assert.equal(manageTabFor('/manage/orders'), 'orders');
  assert.equal(manageTabFor('/invoices'), 'orders');
  assert.equal(manageTabFor('/customer-messages'), 'inbox');
  assert.equal(manageTabFor('/manage/inbox'), 'inbox');
  assert.equal(manageTabFor('/settlement'), 'settlement');
  assert.equal(manageTabFor('/shipments'), 'more');
  assert.equal(manageTabFor('/manage/settings/keeping'), 'more');
  assert.equal(manageTabFor('/sales/abc'), 'home');
  assert.equal(appScreenTitle('/manage'), '관리 홈');
  assert.equal(appScreenTitle('/manage/settings/keeping'), '보관 설정');
});

test('새 관리 화면 사용 is off by default and kept per workspace', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(isNewManageUiEnabled('ws1', storage), false);
  setNewManageUiEnabled('ws1', true, storage);
  assert.equal(isNewManageUiEnabled('ws1', storage), true);
  assert.equal(isNewManageUiEnabled('ws2', storage), false);
  setNewManageUiEnabled('ws1', false, storage);
  assert.equal(isNewManageUiEnabled('ws1', storage), false);
  assert.equal(isNewManageUiEnabled('ws1', { getItem: () => { throw new Error('blocked'); } }), false);
});

test('zoom: index.html allows it; the selling screen blocks it', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/);
  let content = ZOOM_ALLOWED;
  const doc = { querySelector: () => ({ getAttribute: () => content, setAttribute: (_, value) => { content = value; } }) };
  applyViewportZoom(false, doc);
  assert.equal(content, ZOOM_BLOCKED);
  applyViewportZoom(true, doc);
  assert.equal(content, ZOOM_ALLOWED);
  const shell = fs.readFileSync(new URL('../src/components/common/SalesAppShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /applyViewportZoom\(!\(integrated && selling\)\)/);
  // 판매 화면은 숨김만 (댓글·프린터 연결 유지)
  assert.match(shell, /hidden=\{!selling\} data-sales-app-page="sell"/);
});

test('dashboard: numbers, money stages, goods and keeping card', () => {
  const a1 = sale({ buyerNickname: '가가가', amount: 20000 });
  const a2 = sale({ buyerNickname: '가가가', amount: 15000, sessionId: 'r0', recognizedAt: '2026-10-01T00:00:00Z' });
  const b1 = sale({ buyerNickname: '나나나', amount: 12000 });
  const c1 = sale({ buyerNickname: '다다다', amount: 8000 });
  const held = sale({ buyerNickname: '라라라', amount: 5000, status: '보류' });
  const sales = [a1, a2, b1, c1, held];
  const dashboard = buildManageDashboard({
    sales,
    invoices: [{ id: 'i1', status: 'SENT', saleIds: [b1.id] }],
    payments: [{ saleIds: [a1.id, a2.id], matchStatus: 'MATCHED' }, { saleIds: [c1.id], matchStatus: 'NEEDS_REVIEW' }],
    messages: [{ phone: '01011112222', direction: 'INCOMING', body: '다다다입니다 주소 보내요' }],
    contactLinks: [{ phone: '01033334444', nickname: '나나나', linkedAt: '2026-10-01T00:00:00Z' }],
    fulfillmentItems: [{ saleId: a2.id, state: 'KEPT', keptAt: '2026-10-01T00:00:00Z' }],
    shippingConfig: CONFIG,
    alertDays: { warnDays: 14, alertDays: 30 },
    now: NOW,
    periodDays: 7,
  });
  // 7일 안: a1, b1, c1 (a2 는 10/01, 보류 제외)
  assert.equal(dashboard.salesAmount, 40000);
  assert.equal(dashboard.salesAmount, calculateSalesListRevenue([a1, b1, c1, held], []).totalAmount);
  // 가가가는 킵 고객 → 배송비 출고 때, 결제 완료
  assert.equal(dashboard.paidAmount, 20000);
  assert.equal(dashboard.unpaidAmount, 12000 + 3000 + 8000 + 3000);
  assert.deepEqual(dashboard.stages.map((s) => [s.label, s.orderCount]), [['연락처 연결', 0], ['청구 전', 1], ['입금 대기', 1], ['결제 완료', 1]]);
  assert.deepEqual(dashboard.goods, { readyToShip: 1, kept: 0, inProgress: 0, refundNeeded: 0, readyToShipBuyers: 1 });
  assert.equal(dashboard.keeping.buyers, 0);
  assert.equal(dashboard.keeping.alert, 0);
  assert.equal(dashboard.keeping.top.length, 0);
  assert.deepEqual(dashboard.todos.map((t) => t.kind), ['PAYMENT_REVIEW', 'READY_TO_BILL', 'AWAITING_PAYMENT', 'READY_TO_SHIP']);

  const all = buildManageDashboard({ sales, invoices: [], payments: [], messages: [], contactLinks: [], fulfillmentItems: [], shippingConfig: CONFIG, alertDays: { warnDays: 14, alertDays: 30 }, now: NOW, periodDays: 0 });
  assert.equal(all.salesAmount, 55000);
  assert.equal(all.stages[0].orderCount, 4);
});

test('paid sales come from matched payments and paid invoices only', () => {
  const paid = paidSaleIdsOf(
    [{ saleIds: ['a'], matchStatus: 'MATCHED' }, { saleIds: ['b'], matchStatus: 'NEEDS_REVIEW' }],
    [{ status: 'PAID', saleIds: ['c'] }, { status: 'SENT', saleIds: ['d'] }],
  );
  assert.deepEqual([...paid].sort(), ['a', 'c']);
});

test('routes and menus are wired', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const path of ['/manage', '/manage/orders', '/manage/inbox', '/manage/settings/keeping']) assert.ok(app.includes(`path="${path}"`), path);
  const more = fs.readFileSync(new URL('../src/pages/seller/AppMorePage.tsx', import.meta.url), 'utf8');
  assert.match(more, /새 관리 화면 사용/);
  assert.match(more, /보관 설정/);
  assert.match(more, /출고 \(보관함·합배송\)/);
  const sidebar = fs.readFileSync(new URL('../src/components/common/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /관리 홈 \(새 화면\)/);
  assert.match(sidebar, /택배발송 관리/);
});
