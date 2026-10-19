import test from 'node:test';
import assert from 'node:assert/strict';
import * as smsNicknameLink from '../src/services/smsNicknameLink.ts';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { formatAmountAsDecimal, formatMultiSaleAmount } from '../src/services/salesExtractor.ts';
import { getSalePurchaseHistory } from '../src/services/saleRowHistory.ts';
import { getPromiseDefault, promiseDefaultBuyerKey, summarizePromiseDefaults } from '../src/services/promiseDefaultService.ts';
import * as billableSales from '../src/services/billableSales.ts';
import { calculateSalesListRevenue } from '../src/services/salesListRevenue.ts';

const sale = (id, amount, second, extra = {}) => ({
  id, amount, sessionId: 'broadcast-1', buyerId: 'buyer-hani', buyerNickname: '하니',
  status: '자동저장', syncStatus: 'SYNCED', source: 'WEB_VOICE', rawTranscript: '하니님 드릴게요',
  recognizedAt: `2026-10-17T01:00:${String(second).padStart(2, '0')}Z`, ...extra,
});

// Render the actual page's React elements and invoke its real view/sort handlers.
// Network loading and unrelated provider/components are replaced with fixtures.
function pageFixture() {
  const cells = [];
  let index = 0;
  const state = { sales: [], searchParams: new URLSearchParams('session=ALL') };
  const react = { ...React,
    useState(value) {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof value === 'function' ? value() : value;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }];
    },
    useMemo: (callback) => callback(),
    useEffect() {},
  };
  const dependencies = {
    react: { ...react, default: react },
    'react-router-dom': { Link: 'link', useSearchParams: () => [state.searchParams,
      (next) => { state.searchParams = next; }] },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    '../../context/AuthContext': { useAuth: () => ({ workspaceId: 'workspace' }) },
    '../../context/SalesContext': { useSales: () => ({ sales: state.sales, promiseDefaults: [],
      setPromiseDefault() {}, exportCsv() {}, refreshSales: async () => state.sales }) },
    '../../context/CommerceContext': { useCommerce: () => ({ messages: [], payments: [], claims: [], invoices: [], shipments: [] }) },
    '../../services/productSalesApi': { productSalesApi: { listSessions: async () => ({ sessions: [] }) } },
    '../../services/customerKeepingService': { customerKeepingService: { getBuyerSummary: () => ({ hasActiveKeeping: false }) } },
    '../../services/shippingService': { shippingService: {
      getConfig: () => ({ enabled: false }),
      calculateShippingFee: () => ({ fee: 0 }),
      getOverride: () => null,
      getOverrideForSales: () => null,
      fetchRemoteOverrides: async () => {},
    } },
    '../../services/smsNicknameLink': smsNicknameLink,
    '../../hooks/useBuyerPhoneLinks': { useBuyerPhoneLinks: () => ({ phoneToNickname: new Map(), rememberLinks() {} }) },
    '../../services/salesExtractor': { formatAmountAsDecimal, formatMultiSaleAmount },
    '../../services/saleRowHistory': { getSalePurchaseHistory },
    '../../services/promiseDefaultService': { getPromiseDefault, promiseDefaultBuyerKey, summarizePromiseDefaults },
    '../../services/salesListRevenue': { calculateSalesListRevenue },
    '../../services/billableSales': billableSales,
    '../../utils/textCleaner': { cleanMessageBody: (value) => value },
    '../../utils/sessionFormatter': { formatSessionDisplay: (value) => value },
    '../../components/sales/BuyerReconciliationPanel': { BuyerReconciliationPanel: 'BuyerReconciliationPanel', BuyerStatusBadges: 'BuyerStatusBadges' },
  };
  for (const [name, path] of [
    ['AiSaleBadge', '../../components/sales/AiSaleBadge'],
    ['ShippingConfigModal', '../../components/shipping/ShippingConfigModal'],
    ['KeepingBadge', '../../components/shipping/KeepingBadge'],
    ['ImageViewerModal', '../../components/common/ImageViewerModal'],
  ]) dependencies[path] = { [name]: name };
  const source = fs.readFileSync(new URL('../src/pages/seller/SalesListPage.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, URLSearchParams,
    require(name) { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
  });
  const render = () => { index = 0; return module.exports.SalesListPage(); };
  const setView = (label) => {
    const button = nodes(render()).find((node) => node.type === 'button' && textContent(node).includes(label));
    assert.ok(button, `Missing view button ${label}`);
    button.props.onClick();
    return render();
  };
  return { state, render, setView };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
const textContent = (tree) => Array.isArray(tree) ? tree.map(textContent).join('')
  : typeof tree === 'string' || typeof tree === 'number' ? String(tree)
    : tree && typeof tree === 'object' ? textContent(tree.props?.children) : '';
const cardText = (tree, id) => {
  const card = nodes(tree).find((node) => node.type === 'link' && node.props.to === `/sales/${id}`);
  assert.ok(card, `Missing sale card ${id}`);
  return textContent(card);
};

test('additional purchases update only the new individual row while the buyer summary remains a current total', () => {
  const ctx = pageFixture();
  const first = sale('first', 10000, 1), second = sale('second', 12000, 2), third = sale('third', 10000, 3);
  ctx.state.sales = [first];
  let tree = ctx.setView('건별 보기');
  const firstText = cardText(tree, 'first');
  assert.match(firstText, /10,000원/);
  assert.doesNotMatch(firstText, /다건/);

  ctx.state.sales = [second, first];
  tree = ctx.render();
  const secondText = cardText(tree, 'second');
  assert.equal(cardText(tree, 'first'), firstText);
  assert.match(secondText, /다건 2건/);
  assert.match(secondText, /1\.0 \+ 1\.2 =22,000원/);

  ctx.state.sales = [third, second, first];
  tree = ctx.render();
  assert.equal(cardText(tree, 'first'), firstText);
  assert.equal(cardText(tree, 'second'), secondText);
  assert.match(cardText(tree, 'third'), /다건 3건/);
  assert.match(cardText(tree, 'third'), /1\.0 \+ 1\.2 \+ 1\.0 =32,000원/);
  tree = ctx.setView('구매자별');
  assert.match(textContent(tree), /총 구매 합계1\.0 \+ 1\.2 \+ 1\.0 =32,000원/);
});

test('individual purchase histories stay the same when display order changes', () => {
  const ctx = pageFixture();
  ctx.state.sales = [sale('third', 10000, 3), sale('first', 10000, 1), sale('second', 12000, 2)];
  let tree = ctx.setView('건별 보기');
  const expected = Object.fromEntries(['first', 'second', 'third'].map((id) => [id, cardText(tree, id)]));
  for (const order of ['LATEST', 'OLDEST', 'AMOUNT_DESC']) {
    const sort = nodes(tree).find((node) => node.type === 'select' && nodes(node)
      .some((child) => child.type === 'option' && child.props.value === 'LATEST'));
    assert.ok(sort);
    sort.props.onChange({ target: { value: order } });
    tree = ctx.render();
    for (const id of Object.keys(expected)) assert.equal(cardText(tree, id), expected[id], `${order}/${id}`);
  }
});

test('equal or invalid timestamps do not make a newly arrived row part of an older row', () => {
  const ctx = pageFixture();
  const first = sale('first', 10000, 1);
  ctx.state.sales = [first];
  const firstText = cardText(ctx.setView('건별 보기'), 'first');
  ctx.state.sales = [sale('same-time', 12000, 1), sale('invalid', 13000, 2, { recognizedAt: 'invalid' }), first];
  const tree = ctx.render();
  assert.equal(cardText(tree, 'first'), firstText);
  assert.match(cardText(tree, 'same-time'), /12,000원/);
  assert.match(cardText(tree, 'invalid'), /13,000원/);
  for (const id of ['first', 'same-time', 'invalid']) assert.doesNotMatch(cardText(tree, id), /다건/);
});

test('individual histories exclude another buyer, broadcast, and held or cancelled sales', () => {
  const ctx = pageFixture();
  ctx.state.sales = [
    sale('current', 10000, 9), sale('prior', 12000, 1, { status: '확정', buyerNickname: '하니 새이름' }),
    sale('other-buyer', 20000, 2, { buyerId: 'another-buyer' }),
    sale('legacy-name', 21000, 3, { buyerId: undefined }),
    sale('other-session', 22000, 4, { sessionId: 'broadcast-2' }),
    sale('pending', 23000, 5, { status: '보류' }), sale('cancelled', 24000, 6, { status: '취소' }),
    sale('server-cancelled', 25000, 7, { recordState: 'CANCELLED' }),
    sale('unsynced', 26000, 8, { syncStatus: 'PENDING' }),
  ];
  const tree = ctx.setView('건별 보기');
  // A sale still waiting for the server counts like any other 자동저장 sale.
  assert.match(cardText(tree, 'current'), /다건 3건/);
  assert.match(cardText(tree, 'current'), /1\.2 \+ 2\.6 \+ 1\.0 =48,000원/);
  for (const id of ['prior', 'other-buyer', 'legacy-name', 'other-session', 'pending', 'cancelled', 'server-cancelled']) {
    assert.doesNotMatch(cardText(tree, id), /다건/, id);
  }
});
