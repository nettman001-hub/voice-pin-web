import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sale = (id, extra = {}) => ({
  id, sessionId: 'broadcast-1', buyerNickname: `구매자-${id}`, amount: 15000,
  status: '자동저장', syncStatus: 'SYNCED', source: 'WEB_VOICE',
  recognizedAt: '2026-10-01T01:00:00Z', rawTranscript: '구매자님께 드릴게요 1.5', ...extra,
});

// Render the real page with controlled provider restoration and React hook lifecycles.
function pageFixture() {
  const cells = [], effects = [];
  let index = 0;
  const state = {
    auth: { workspaceId: 'workspace-1', user: { id: 'seller-1', role: '판매자' } },
    live: { isListening: false, currentSessionId: 'local-session-after-reload',
      liveTranscriptFlow: [], transcriptLogs: [], recentCaptures: [],
      currentInterimTranscript: '', totalSessionTranscriptCount: 0, audioLevel: 0,
      waveform: new Uint8Array(128), sttMode: 'CLOUD', sttProvider: 'SONIOX',
      localSttModel: 'base', localSttStatus: { message: '로컬 연결 대기' },
      sttEngineStatus: 'DISCONNECTED', sttEngineMessage: '', pipelineDiagnostics: null,
      setSttMode() {} },
    activeSession: null,
    sales: [],
    refreshedSales: [],
  };
  const same = (left, right) => left && right && left.length === right.length
    && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useRef(value) { const i = index++; cells[i] ||= { current: value }; return cells[i]; },
    useState(value) {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof value === 'function' ? value() : value;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }];
    },
    useMemo(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) cells[i] = { deps, value: callback() };
      return cells[i].value;
    },
    useEffect(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) {
        const previous = cells[i]; cells[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
      }
    },
  };
  const dependencies = {
    react: { ...react, default: react },
    'react-router-dom': { Link: 'link' },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    '../../context/AuthContext': { useAuth: () => state.auth },
    '../../context/LiveContext': { useLive: () => state.live },
    '../../context/CommentCaptureContext': {
      useCommentCapture: () => ({ liveComments: [], config: {}, isActive: false, isRunning: false }),
    },
    '../../context/SalesContext': { useSales: () => ({
      sales: state.sales,
      refreshSales: async () => { state.sales = state.refreshedSales; return state.sales; },
    }) },
    '../../context/ProductSalesContext': { useProductSales: () => ({
      activeSession: state.activeSession, activeProduct: null,
    }) },
    '../../services/storageService': { storageService: {
      getAudioSourceMode: () => 'TAB_AUDIO', getPurchaseRequests: () => [],
    } },
    '../../services/purchaseFirstSales': { getPurchaseRequests: () => [] },
    '../../services/screenCaptureService': { screenCaptureService: {} },
    '../../components/live/ListeningStopControl': { ListeningStopControl: 'ListeningStopControl', ListeningStopStatus: 'ListeningStopStatus' },
    '../../services/salesExtractor': { formatMultiSaleAmount: () => ({ isMulti: false }) },
    '../../services/nicknameMatcher': { areNicknamesSimilar: (a, b) => a === b },
    '../../services/salesDemoService': { salesDemoService: { stop() {} } },
    '../../utils/sessionFormatter': { formatSessionDisplay: (value) => value },
    '../../types/comment': { COMMENT_HELPER_DOWNLOAD_URL: '' },
  };
  for (const [name, path] of [
    ['AudioVisualizer', '../../components/common/AudioVisualizer'],
    ['CustomerStatsBadge', '../../components/sales/CustomerStatsBadge'],
    ['SaleAiActionButtons', '../../components/sales/SaleAiActionButtons'],
    ['AiSaleBadge', '../../components/sales/AiSaleBadge'],
    ['ImageViewerModal', '../../components/common/ImageViewerModal'],
    ['CommentHelperModal', '../../components/helper/CommentHelperModal'],
    ['SellerSettingsModal', '../../components/seller/SellerSettingsModal'],
  ]) dependencies[path] = { [name]: name };
  const source = fs.readFileSync(new URL('../src/pages/seller/LiveHomePage.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Uint8Array,
    window: { location: { search: '' }, setTimeout: () => 1, clearTimeout() {} },
    require(name) {
      assert.ok(name in dependencies, `Unexpected import ${name}`);
      return dependencies[name];
    },
    alert(message) { throw new Error(message); },
  });
  const render = () => {
    index = 0;
    const tree = module.exports.LiveHomePage();
    effects.splice(0).forEach((effect) => effect());
    return tree;
  };
  return { state, render, settle() { render(); return render(); } };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
const visibleSaleIds = (tree) => nodes(tree).filter((node) =>
  node.type === 'link' && /^\/sales\/[^/]+$/.test(node.props.to) && node.props.to !== '/sales/review')
  .map((node) => node.props.to.slice('/sales/'.length));
const refreshButton = (tree) => nodes(tree).find((node) => node.props.title === '판매 내역 새로고침');

test('a stopped live page keeps the STT failure visible and wires the engine selector to persisted settings', () => {
  const ctx = pageFixture();
  ctx.state.live.sttEngineStatus = 'ERROR';
  ctx.state.live.sttEngineMessage = '내 PC STT에 연결할 수 없습니다';
  const tree = ctx.settle();
  const alert = nodes(tree).find((node) => node.props.role === 'alert' && node.props.children.includes(ctx.state.live.sttEngineMessage));
  assert.ok(alert, 'stopping after a failure must not hide its cause');
  const modal = nodes(tree).find((node) => node.type === 'SellerSettingsModal');
  assert.equal(modal.props.onChangeSttMode, ctx.state.live.setSttMode);
  assert.equal(modal.props.isListening, false);
  assert.equal(modal.props.canUseCloudStt, false);
});

for (const restorationOrder of ['sales-first', 'session-first']) {
  test(`reloading the stopped live page restores sales and pending rows (${restorationOrder})`, () => {
    const ctx = pageFixture();
    assert.deepEqual(visibleSaleIds(ctx.settle()), []);
    const records = [sale('sold'), sale('pending', { status: '보류' }),
      sale('other-session', { sessionId: 'broadcast-2' }),
      sale('not-sale', { aiVerification: { reviewDecision: 'NOT_SALE' } })];
    if (restorationOrder === 'sales-first') ctx.state.sales = records;
    else ctx.state.activeSession = { id: 'broadcast-1' };
    assert.deepEqual(visibleSaleIds(ctx.settle()), []);
    ctx.state.sales = records;
    ctx.state.activeSession = { id: 'broadcast-1' };
    assert.deepEqual(visibleSaleIds(ctx.settle()), ['sold', 'pending']);
  });
}

test('only an actual listening stop freezes the list, and manual refresh preserves the non-sale filter', async () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  ctx.state.sales = [sale('first')];
  assert.deepEqual(visibleSaleIds(ctx.settle()), ['first']);
  ctx.state.sales = [...ctx.state.sales, sale('restored-pending', { status: '보류' })];
  assert.deepEqual(visibleSaleIds(ctx.settle()), ['first', 'restored-pending']);
  ctx.state.live.isListening = true;
  ctx.settle();
  ctx.state.live.isListening = false;
  ctx.settle();
  ctx.state.sales = [...ctx.state.sales, sale('late-update')];
  assert.deepEqual(visibleSaleIds(ctx.settle()), ['first', 'restored-pending']);
  ctx.state.refreshedSales = [...ctx.state.sales, sale('not-sale', { aiVerification: { reviewDecision: 'NOT_SALE' } })];
  refreshButton(ctx.render()).props.onClick();
  await tick();
  assert.deepEqual(visibleSaleIds(ctx.settle()), ['first', 'restored-pending', 'late-update']);
  ctx.state.live.isListening = true;
  ctx.state.sales = [...ctx.state.sales, sale('resumed')];
  assert.deepEqual(visibleSaleIds(ctx.settle()), ['first', 'restored-pending', 'late-update', 'resumed']);
});

test('changing broadcast or account discards the stopped list from the previous scope', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  ctx.state.sales = [sale('previous')];
  ctx.state.live.isListening = true;
  ctx.settle();
  ctx.state.live.isListening = false;
  ctx.settle();
  ctx.state.activeSession = { id: 'broadcast-2' };
  ctx.state.sales = [sale('next', { sessionId: 'broadcast-2' })];
  assert.deepEqual(visibleSaleIds(ctx.settle()), ['next']);
  ctx.state.live.isListening = true;
  ctx.settle();
  ctx.state.live.isListening = false;
  ctx.settle();
  ctx.state.auth = { workspaceId: 'workspace-2', user: { id: 'seller-2', role: '판매자' } };
  ctx.state.activeSession = null;
  ctx.state.sales = [];
  assert.deepEqual(visibleSaleIds(ctx.render()), []);
});

test('AI updates the nickname and price of an existing stopped row without appending unrelated new sales', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  ctx.state.sales = [sale('pending', { buyerNickname: '케이치', amount: 0, status: '보류' })];
  ctx.state.live.isListening = true;
  ctx.settle();
  ctx.state.live.isListening = false;
  ctx.settle();
  const verified = sale('pending', { buyerNickname: 'KH', amount: 15000, status: '보류',
    sourceCommentIds: ['comment'], aiVerification: { aiStatus: 'NEEDS_SELLER_CONFIRM', nicknameVerified: true } });
  ctx.state.sales = [verified, sale('later')];
  const tree = ctx.settle();
  assert.deepEqual(visibleSaleIds(tree), ['pending']);
  const card = nodes(tree).find((node) => node.props.to === '/sales/pending');
  assert.equal(nodes(card).some((node) => node.props.children.includes('KH')), true);
  assert.equal(nodes(card).some((node) => node.props.children.includes('15,000원')), true);
});
