import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as billableSales from '../src/services/billableSales.ts';

const sessionId = 'broadcast-2';
// Synthetic reproduction: seven saved sales total 63,000 and two pending sales add 20,000.
const nineSales = () => [10000, 15000, 10000, 10000, 2000, 8000, 8000, 10000, 10000]
  .map((amount, index) => ({
    id: `sale-${index}`, sessionId, buyerNickname: '꽃심이', amount,
    status: index === 8 ? '확정' : '자동저장', recordState: 'ACTIVE',
    syncStatus: index >= 7 ? 'PENDING' : 'SYNCED',
    recognizedAt: '2026-10-17T12:23:13Z', rawTranscript: '꽃심이님 드릴게요',
  }));

function pageFixture(path, name, sales, selectedSession = sessionId) {
  const exports = [];
  const NullComponent = () => null;
  const react = {
    ...React,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useMemo: (calculate) => calculate(),
    useEffect() {},
  };
  const dependencies = {
    react: { ...react, default: react },
    'react-router-dom': {
      Link: ({ to, children }) => React.createElement('a', { href: to }, children),
      useSearchParams: () => [new URLSearchParams({ session: selectedSession }), () => {}],
    },
    'lucide-react': new Proxy({}, { get: () => NullComponent }),
    '../../context/SalesContext': { useSales: () => ({ sales, exportCsv: (rows, filename) => exports.push({ rows, filename }) }) },
    '../../context/AppDataContext': { useAppData: () => ({ allMembers: [], reports: [] }) },
    '../../context/LiveContext': { useLive: () => ({ deepgramApiKey: '', sonioxApiKey: '', sttProvider: 'SONIOX' }) },
    '../../services/billableSales': billableSales,
    '../../services/productSalesApi': { productSalesApi: {} },
    '../../services/remoteWorkspaceService': { remoteWorkspaceService: {} },
    '../../services/aiSettingsApi': { aiSettingsApi: {} },
    '../../utils/maskingUtils': { maskEndpointUrl: (value) => value },
    '../../utils/sessionFormatter': { formatSessionDisplay: () => '2026-10-17 라이브 2회차' },
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console,
    require(key) {
      assert.ok(key in dependencies, `Unexpected import ${key}`);
      return dependencies[key];
    },
  });
  const tree = module.exports[name]();
  const text = (node) => renderToStaticMarkup(node).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
  const buttons = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === 'button') buttons.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  return { text: text(tree), exports, click: (label) => {
    const button = buttons.find((node) => text(node).trim() === label)
      || buttons.find((node) => text(node).includes(label));
    assert.ok(button, `Missing button ${label}`);
    button.props.onClick();
  } };
}

test('settlement totals, groups and CSV retain both pending sales in the 83,000-won total', () => {
  const sales = nineSales();
  const ctx = pageFixture('../src/pages/seller/SettlementPage.tsx', 'SettlementPage', sales);
  assert.match(ctx.text, /총 판매 확정액83,000원/);
  assert.match(ctx.text, /총 확정 주문 건수9건/);
  assert.match(ctx.text, /총 9건 주문판매 합계83,000원/);
  assert.ok(!ctx.text.includes('63,000'));
  ctx.click('선택 회차 CSV 다운로드');
  ctx.click('CSV');
  for (const exported of ctx.exports) {
    assert.deepEqual(Array.from(exported.rows, (sale) => sale.id), sales.map((sale) => sale.id));
    assert.equal(exported.rows.reduce((sum, sale) => sum + sale.amount, 0), 83000);
  }
});

test('settlement applies the shared exclusion policy and selected broadcast to totals and CSV', () => {
  const sales = nineSales();
  const extra = (id, patch) => ({ ...sales[0], id, amount: 50000, ...patch });
  const records = [...sales,
    extra('held', { status: '보류' }),
    extra('cancelled', { status: '취소' }),
    extra('cancelled-state', { recordState: 'CANCELLED' }),
    extra('not-sale', { aiVerification: { reviewDecision: 'NOT_SALE' } }),
    extra('other-broadcast', { sessionId: 'broadcast-1' }),
  ];
  const ctx = pageFixture('../src/pages/seller/SettlementPage.tsx', 'SettlementPage', records);
  assert.match(ctx.text, /총 판매 확정액83,000원/);
  assert.match(ctx.text, /총 확정 주문 건수9건/);
  ctx.click('선택 회차 CSV 다운로드');
  assert.deepEqual(ctx.exports[0].rows.map((sale) => sale.id), sales.map((sale) => sale.id));
});

test('admin dashboard local revenue also includes pending sales under the shared total policy', () => {
  const sales = nineSales();
  const records = [...sales,
    { ...sales[0], id: 'cancelled', amount: 50000, recordState: 'CANCELLED' },
    { ...sales[0], id: 'not-sale', amount: 50000, aiVerification: { reviewDecision: 'NOT_SALE' } },
  ];
  const ctx = pageFixture('../src/pages/admin/AdminDashboardPage.tsx', 'AdminDashboardPage', records);
  assert.match(ctx.text, /83,000 원/);
  assert.ok(!ctx.text.includes('63,000'));
  assert.ok(!ctx.text.includes('183,000'));
});
