import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_TABS,
  appScreenTitle,
  appTabFor,
  isPcOnlyPath,
  sellingSummary,
} from '../src/services/appShellState.ts';

test('하단 메뉴 5개: 판매내역·정산서·문자비교·정산·더보기', () => {
  assert.deepEqual(
    APP_TABS.map((t) => t.name),
    ['판매내역', '정산서', '문자비교', '정산', '더보기'],
  );
});

test('주소가 어느 하단 메뉴에 속하는지', () => {
  assert.equal(appTabFor('/sales'), 'sales');
  assert.equal(appTabFor('/sales/abc'), 'sales');
  assert.equal(appTabFor('/sales/abc/capture'), 'sales');
  assert.equal(appTabFor('/sales/review'), 'more');
  assert.equal(appTabFor('/invoices'), 'invoices');
  assert.equal(appTabFor('/customer-messages'), 'messages');
  assert.equal(appTabFor('/settlement'), 'settlement');
  assert.equal(appTabFor('/shipments'), 'more');
  assert.equal(appTabFor('/my'), 'more');
  assert.equal(appTabFor('/admin/sales'), 'more');
  assert.equal(appTabFor('/more'), 'more');
});

test('PC 전용 화면만 앱에서 막는다', () => {
  for (const p of ['/live', '/live-test/sales', '/stt-vocabulary', '/recognition-rules', '/devices', '/helper'])
    assert.equal(isPcOnlyPath(p), true, p);
  for (const p of ['/sales', '/sales/live', '/invoices', '/shipments', '/settlement', '/my', '/more', '/comments'])
    assert.equal(isPcOnlyPath(p), false, p);
});

test('화면 이름', () => {
  assert.equal(appScreenTitle('/sales/abc'), '판매내역');
  assert.equal(appScreenTitle('/sales/review'), '방송 후 일괄 확인');
  assert.equal(appScreenTitle('/shipments'), '택배발송');
  assert.equal(appScreenTitle('/more'), '더보기');
});

test('판매 중 띠: 실행 중이고 임대가 남았을 때만', () => {
  const now = Date.parse('2026-10-30T05:00:00Z');
  const live = (lease, extra = {}) => ({
    running: true,
    lease_expires_at: lease,
    last_state: { totalCount: 12, totalAmount: 455000 },
    ...extra,
  });
  assert.deepEqual(sellingSummary(live('2026-10-30T05:00:20Z'), now), { count: 12, amount: 455000 });
  assert.equal(sellingSummary(live('2026-10-30T04:59:00Z'), now), null);
  assert.equal(sellingSummary(live('2026-10-30T05:00:20Z', { running: false }), now), null);
  assert.equal(sellingSummary(null, now), null);
  assert.equal(sellingSummary(undefined, now), null);
  assert.equal(sellingSummary(live('not a date'), now), null);
  assert.deepEqual(
    sellingSummary({ running: true, lease_expires_at: '2026-10-30T05:00:20Z' }, now),
    { count: 0, amount: 0 },
  );
});
