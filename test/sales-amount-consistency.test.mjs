import { runtimeFixture } from './runtime-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as billableSales from '../src/services/billableSales.ts';
import * as serverRejectedSale from '../src/services/serverRejectedSale.ts';
import * as salesExtractor from '../src/services/salesExtractor.ts';
import * as saleRowHistory from '../src/services/saleRowHistory.ts';
import * as salesListRevenue from '../src/services/salesListRevenue.ts';
import * as promiseDefaults from '../src/services/promiseDefaultService.ts';
import * as smsNicknameLink from '../src/services/smsNicknameLink.ts';

const sessionId = '0becb132-298d-456c-a3a7-e8ca309be508';
// Reproduction data based on the screenshot amounts, not the customer's live records.
const screenshotSales = (excluded = {}) => [10000, 15000, 10000, 10000, 10000, 10000, 2000, 8000, 8000]
  .map((amount, index) => ({
    id: `sale-${index}`, sessionId, buyerId: 'buyer-1', buyerNickname: '꽃심이',
    amount, status: '확정', recordState: 'ACTIVE', syncStatus: 'SYNCED',
    recognizedAt: '2026-10-17T12:23:13Z', rawTranscript: '꽃심이님 드릴게요',
    ...(index >= 7 ? excluded : {}),
  }));

function loadSource(path, dependencies) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console,
    localStorage: { getItem: () => null },
    require(name) { if (name.endsWith('WorkspaceRuntimeContext')) return runtimeFixture(dependencies);
      assert.ok(name in dependencies, `Unexpected import ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

function fixture(records, configOverrides = {}) {
  const { shippingService, DEFAULT_SHIPPING_CONFIG } = loadSource('../src/services/shippingService.ts', {
    './remoteWorkspaceService': { remoteWorkspaceService: {} },
  });
  const config = { ...DEFAULT_SHIPPING_CONFIG, ...configOverrides };
  shippingService.getConfig = () => config;
  const emptyKeeping = { hasActiveKeeping: false, records: [], totalKeptAmount: 0 };
  const commerce = {
    messages: [], payments: [], claims: [], invoices: [], shipments: [],
    getClaimForSales: () => null, getMessagesForSales: () => [],
    isPaid: () => false, isVerified: () => false,
  };
  const NullComponent = () => null;
  const dependencies = {
    react: { ...React, default: React },
    'react-router-dom': {
      Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
      useSearchParams: () => [new URLSearchParams({ session: sessionId }), () => {}],
    },
    'lucide-react': new Proxy({}, { get: () => NullComponent }),
    '../../context/AuthContext': { useAuth: () => ({ workspaceId: 'workspace-1' }) },
    '../../context/SalesContext': { useSales: () => ({ sales: records, promiseDefaults: [] }) },
    '../../context/CommerceContext': { useCommerce: () => commerce },
    '../../services/productSalesApi': { productSalesApi: {} },
    '../../services/billableSales': billableSales,
    '../../services/serverRejectedSale': serverRejectedSale,
    '../../services/saleRowHistory': saleRowHistory,
    '../../services/salesExtractor': salesExtractor,
    '../../services/salesListRevenue': salesListRevenue,
    '../../services/promiseDefaultService': promiseDefaults,
    '../../services/shippingService': { shippingService },
    '../../services/smsNicknameLink': smsNicknameLink,
    '../../hooks/useBuyerPhoneLinks': { useBuyerPhoneLinks: () => ({ phoneToNickname: new Map(), rememberLinks() {} }) },
    '../../services/customerKeepingService': { customerKeepingService: {
      getBuyerSummary: () => emptyKeeping, getAllRecords: () => [],
    } },
    '../../services/nicknameMatcher': { areNicknamesSimilar: (a, b) => a === b },
    '../../utils/textCleaner': { cleanMessageBody: (value) => value },
    '../../utils/sessionFormatter': { formatSessionDisplay: () => '2026-10-17 라이브 2회차' },
    '../../components/common/ImageViewerModal': { ImageViewerModal: NullComponent },
    '../common/ImageViewerModal': { ImageViewerModal: NullComponent },
    './ConfirmedBuyerCard': { ConfirmedBuyerCard: NullComponent },
    '../../components/sales/AiSaleBadge': { AiSaleBadge: NullComponent },
    '../../components/sales/AppSaleMenu': { AppRowActions: ({ fallback }) => fallback, AppSaleMenuSheet: NullComponent, AppTotalsBar: NullComponent, appRowPress: () => ({}) },
    '../../components/shipping/ShippingConfigModal': { ShippingConfigModal: NullComponent },
    '../../components/shipping/KeepingBadge': { KeepingBadge: NullComponent },
  };
  const { BuyerShippingCard } = loadSource('../src/components/shipping/BuyerShippingCard.tsx', dependencies);
  dependencies['../shipping/BuyerShippingCard'] = { BuyerShippingCard };
  const panel = loadSource('../src/components/sales/BuyerReconciliationPanel.tsx', dependencies);
  dependencies['../../components/sales/BuyerReconciliationPanel'] = panel;
  const { SalesListPage } = loadSource('../src/pages/seller/SalesListPage.tsx', dependencies);
  const text = (component, props) => renderToStaticMarkup(React.createElement(component, props))
    .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
  return {
    page: () => text(SalesListPage),
    detail: () => text(panel.BuyerReconciliationPanel, {
      buyerNickname: '꽃심이', records, captureImageUrls: [], availableSessions: [{ id: sessionId }],
    }),
    shipping: () => text(BuyerShippingCard, { buyerNickname: '꽃심이', sessionId, currentSales: records }),
  };
}

for (const [name, excluded] of [
  ['cancelled status', { status: '취소' }],
  ['cancelled record state with confirmed status', { recordState: 'CANCELLED' }],
  ['held orders', { status: '보류' }],
]) {
  test(`purchase formula, detail and shipping agree for ${name}`, () => {
    const ctx = fixture(screenshotSales(excluded));
    const page = ctx.page();
    assert.ok(page.includes('총 구매 합계'));
    assert.ok(page.includes('67,000원'));
    assert.ok(page.includes('택비포함 : 67,000원'));
    assert.ok(page.includes('합계 제외 2건'));
    assert.ok(!page.includes('83,000'));
    assert.ok(!page.slice(page.indexOf('총 구매 합계')).includes('0.8'));
    assert.ok(ctx.detail().includes('판매금액67,000원'));
    assert.ok(ctx.shipping().includes('현재 회차 주문 금액67,000원'));
    assert.ok(ctx.shipping().includes('최종 청구 합계67,000원'));
  });
}

test('orders awaiting server confirmation still count in every total', () => {
  const ctx = fixture(screenshotSales({ syncStatus: 'PENDING' }));
  assert.ok(ctx.page().includes('택비포함 : 83,000원'));
  assert.ok(!ctx.page().includes('합계 제외'));
  assert.ok(ctx.detail().includes('판매금액83,000원'));
  assert.ok(ctx.shipping().includes('최종 청구 합계83,000원'));
});

test('all nine active orders still total 83000 without an exclusion notice', () => {
  const ctx = fixture(screenshotSales());
  assert.ok(ctx.page().includes('택비포함 : 83,000원'));
  assert.ok(!ctx.page().includes('합계 제외'));
  assert.ok(ctx.detail().includes('판매금액83,000원'));
  assert.ok(ctx.shipping().includes('최종 청구 합계83,000원'));
});

test('shipping threshold uses the same reduced purchase total as the visible amount', () => {
  const ctx = fixture(screenshotSales({ recordState: 'CANCELLED' }), { freeThreshold: 70000, defaultFee: 4000 });
  assert.ok(ctx.page().includes('택비포함 : 71,000원'));
  assert.ok(ctx.detail().includes('판매금액67,000원'));
  assert.ok(ctx.shipping().includes('현재 회차 주문 금액67,000원'));
  assert.ok(ctx.shipping().includes('최종 청구 합계71,000원'));
});

test('orders rejected as not a sale are excluded by all amount calculations', () => {
  const records = screenshotSales({ aiVerification: { reviewDecision: 'NOT_SALE' } });
  const ctx = fixture(records);
  assert.equal(billableSales.calculateBillableAmount(records), 67000);
  assert.equal(salesListRevenue.calculateSalesListRevenue(records, []).totalAmount, 67000);
  assert.ok(ctx.page().includes('택비포함 : 67,000원'));
  assert.ok(ctx.detail().includes('판매금액67,000원'));
  assert.ok(ctx.shipping().includes('현재 회차 주문 금액67,000원'));
});
