import { runtimeFixture } from './runtime-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { formatMultiSaleAmount } from '../src/services/salesExtractor.ts';
import { getSalePurchaseHistory, isCountedSale } from '../src/services/saleRowHistory.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sale = (id, extra = {}) => ({
  id, sessionId: 'broadcast-1', buyerNickname: `구매자-${id}`, amount: 15000,
  status: '자동저장', syncStatus: 'SYNCED', source: 'WEB_VOICE',
  recognizedAt: '2026-10-01T01:00:00Z', rawTranscript: '구매자님께 드릴게요 1.5', ...extra,
});

// Render the real page with controlled provider restoration and React hook lifecycles.
function pageFixture(testMode = false) {
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
    commentStops: 0,
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
      useCommentCapture: () => ({ liveComments: [], config: {}, isActive: false, isRunning: false,
        stopCapture: () => { state.commentStops++; } }),
    },
    '../../context/SalesContext': { useSales: () => ({
      sales: state.sales,
      refreshSales: async () => { state.sales = state.refreshedSales; return state.sales; },
    }) },
    '../../context/ProductSalesContext': { useProductSales: () => ({
      activeSession: state.activeSession, activeProduct: null, ...state.product,
    }) },
    '../../services/storageService': { storageService: {
      getAudioSourceMode: () => 'TAB_AUDIO', getPurchaseRequests: () => [],
    } },
    '../../services/purchaseFirstSales': { getPurchaseRequests: () => [] },
    '../../services/screenCaptureService': { screenCaptureService: {} },
    '../../components/live/ListeningStopControl': { ListeningStopControl: 'ListeningStopControl', ListeningStopStatus: 'ListeningStopStatus' },
    '../../services/salesExtractor': { formatMultiSaleAmount },
    '../../services/saleRowHistory': { getSalePurchaseHistory, isCountedSale },
    '../../services/nicknameMatcher': { areNicknamesSimilar: (a, b) => a === b },
    '../../services/salesDemoService': { salesDemoService: { stop() {} } },
    '../../services/customerKeepingService': { customerKeepingService: {
      getBuyerSummary: () => ({ hasActiveKeeping: false }),
    } },
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
    ['KeepingBadge', '../../components/shipping/KeepingBadge'],
  ]) dependencies[path] = { [name]: name };
  const source = fs.readFileSync(new URL('../src/pages/seller/LiveHomePage.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Uint8Array, Error,
    window: { location: { search: '' }, setTimeout: () => 1, clearTimeout() {} },
    require(name) { if (name.endsWith('WorkspaceRuntimeContext')) {
        const bound = runtimeFixture(dependencies);
        return { ...bound, useWorkspaceRuntime: () => ({ ...bound.useWorkspaceRuntime(), isTest: testMode,
          path: path => testMode ? (path === '/live' ? '/live-test' : `/live-test${path}`) : path }) };
      }
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
const textContent = (tree) => Array.isArray(tree) ? tree.map(textContent).join('')
  : typeof tree === 'string' || typeof tree === 'number' ? String(tree)
    : tree && typeof tree === 'object' ? textContent(tree.props?.children) : '';
const cardText = (tree, id) => {
  const card = nodes(tree).find((node) => node.type === 'link' && node.props.to === `/sales/${id}`);
  assert.ok(card, `Missing sale card ${id}`);
  return textContent(card);
};

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

test('a confirmed 하니 row does not add two separate pending rows to its amount', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  ctx.state.sales = [
    sale('sold', { buyerNickname: '하니', buyerId: 'buyer-hani', amount: 10000, sourceCommentIds: ['request-1'] }),
    sale('pending-12', { buyerNickname: '하니', amount: 12000, status: '보류' }),
    sale('pending-10', { buyerNickname: '하니', amount: 10000, status: '보류', aiVerification: { nicknameVerified: false } }),
  ];
  const tree = ctx.settle();
  assert.deepEqual(visibleSaleIds(tree), ['sold', 'pending-12', 'pending-10']);
  assert.match(cardText(tree, 'sold'), /10,000원/);
  assert.doesNotMatch(cardText(tree, 'sold'), /다건|32,000원|추정 닉네임/);
  for (const [id, amount] of [['pending-12', '12,000원'], ['pending-10', '10,000원']]) {
    assert.ok(cardText(tree, id).includes(amount));
    assert.match(cardText(tree, id), /추정 닉네임/);
    assert.doesNotMatch(cardText(tree, id), /다건|32,000원/);
  }
  assert.match(textContent(tree), /이번회차판매 :1건\/10,000원/);
});

test('each row totals completed purchases only up to that sale, leaving other statuses independent', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  const buyer = { buyerNickname: '하니', buyerId: 'buyer-hani', sourceCommentIds: ['comment'], aiVerification: { nicknameVerified: true } };
  ctx.state.sales = [
    sale('auto', { ...buyer, amount: 10000, recognizedAt:'2026-10-01T01:00:00Z' }),
    sale('confirmed', { ...buyer, buyerNickname: '하니 새이름', amount: 12000, status: '확정', recognizedAt:'2026-10-01T01:01:00Z' }),
    sale('edited', { ...buyer, amount: 10000, status: '수동수정', recognizedAt:'2026-10-01T01:02:00Z' }),
    sale('pending', { ...buyer, amount: 9000, status: '보류' }),
    sale('cancelled', { ...buyer, amount: 8000, status: '취소' }),
    sale('server-cancelled', { ...buyer, amount: 7000, recordState: 'CANCELLED' }),
    sale('unsynced', { ...buyer, amount: 6000, syncStatus: 'PENDING', recognizedAt:'2026-10-01T01:03:00Z' }),
  ];
  const tree = ctx.settle();
  assert.match(cardText(tree, 'auto'), /10,000원/);
  assert.doesNotMatch(cardText(tree, 'auto'), /다건|22,000원|32,000원/);
  assert.match(cardText(tree, 'confirmed'), /다건 2건/);
  assert.match(cardText(tree, 'confirmed'), /1\.0 \+ 1\.2 =22,000원/);
  assert.match(cardText(tree, 'edited'), /다건 3건/);
  assert.match(cardText(tree, 'edited'), /1\.0 \+ 1\.2 \+ 1\.0 =32,000원/);
  for (const [id, amount] of [['pending', '9,000원'], ['cancelled', '8,000원'], ['server-cancelled', '7,000원']]) {
    assert.ok(cardText(tree, id).includes(amount));
    assert.doesNotMatch(cardText(tree, id), /다건|32,000원/);
  }
  // A sale still waiting for the server is shown as 자동저장/확정, so it counts.
  assert.match(cardText(tree, 'unsynced'), /서버 저장 대기/);
  assert.match(cardText(tree, 'unsynced'), /38,000원/);
  assert.match(textContent(tree), /이번회차판매 :4건\/38,000원/);
});

test('matching display names do not combine different buyer IDs or an identified buyer with a legacy name', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  ctx.state.sales = [
    sale('buyer-a', { buyerNickname: '하니', buyerId: 'buyer-a', amount: 10000 }),
    sale('buyer-b', { buyerNickname: '하니', buyerId: 'buyer-b', amount: 12000 }),
    sale('legacy', { buyerNickname: '하니', amount: 13000 }),
  ];
  const tree = ctx.settle();
  for (const [id, amount] of [['buyer-a', '10,000원'], ['buyer-b', '12,000원'], ['legacy', '13,000원']]) {
    assert.ok(cardText(tree, id).includes(amount));
    assert.doesNotMatch(cardText(tree, id), /다건|35,000원/);
  }
});

test('legacy confirmed names can still show multiple purchases without absorbing an unverified name', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = { id: 'broadcast-1' };
  ctx.state.sales = [
    sale('legacy-a', { buyerNickname: '하니', amount: 10000, status: '확정', aiVerification: { nicknameVerified: true } }),
    sale('legacy-b', { buyerNickname: '하니', amount: 12000, status: '수동수정', recognizedAt:'2026-10-01T01:01:00Z' }),
    sale('unverified', { buyerNickname: '하니', amount: 9000, aiVerification: { nicknameVerified: false } }),
  ];
  const tree = ctx.settle();
  assert.match(cardText(tree, 'legacy-a'), /10,000원/);
  assert.doesNotMatch(cardText(tree, 'legacy-a'), /다건|22,000원/);
  assert.match(cardText(tree, 'legacy-b'), /다건 2건/);
  assert.match(cardText(tree, 'legacy-b'), /22,000원/);
  assert.doesNotMatch(cardText(tree, 'unverified'), /다건|22,000원/);
  assert.match(cardText(tree, 'unverified'), /9,000원/);
});

test('adding or correcting the current purchase never replaces earlier cards with the final total', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = {id:'broadcast-1'};
  ctx.state.live.isListening = true;
  const buyer = {buyerNickname:'하니',buyerId:'buyer-hani'};
  const first = sale('first', {...buyer, amount:10000});
  ctx.state.sales = [first];
  const firstCard = cardText(ctx.settle(), 'first');
  const second = sale('second', {...buyer, amount:12000, recognizedAt:'2026-10-01T01:01:00Z'});
  ctx.state.sales = [second, first];
  const secondTree = ctx.settle();
  const secondCard = cardText(secondTree, 'second');
  assert.equal(cardText(secondTree, 'first'), firstCard);
  assert.match(secondCard, /1\.0 \+ 1\.2 =22,000원/);
  const third = sale('third', {...buyer, amount:10000, recognizedAt:'2026-10-01T01:02:00Z'});
  ctx.state.sales = [third, second, first];
  const thirdTree = ctx.settle();
  assert.equal(cardText(thirdTree, 'first'), firstCard);
  assert.equal(cardText(thirdTree, 'second'), secondCard);
  assert.match(cardText(thirdTree, 'third'), /다건 3건/);
  assert.match(cardText(thirdTree, 'third'), /1\.0 \+ 1\.2 \+ 1\.0 =32,000원/);
  ctx.state.sales = [{...third, amount:15000}, second, first];
  const correctedTree = ctx.settle();
  assert.equal(cardText(correctedTree, 'first'), firstCard);
  assert.equal(cardText(correctedTree, 'second'), secondCard);
  assert.match(cardText(correctedTree, 'third'), /1\.0 \+ 1\.2 \+ 1\.5 =37,000원/);
});

test('equal timestamps and list reordering cannot add a later row to an earlier purchase', () => {
  const ctx = pageFixture();
  ctx.state.activeSession = {id:'broadcast-1'};
  const first = sale('first', {buyerNickname:'하니', buyerId:'buyer-hani',amount:10000});
  ctx.state.sales = [first];
  const before = cardText(ctx.settle(), 'first');
  const second = {...first, id:'second',amount:12000};
  for (const records of [[second, first], [first, second]]) {
    ctx.state.sales = records;
    const tree = ctx.settle();
    assert.equal(cardText(tree, 'first'), before);
    assert.match(cardText(tree, 'second'), /12,000원/);
    assert.doesNotMatch(cardText(tree, 'second'), /다건|22,000원/);
  }
});


test('test home starts a new microphone broadcast from 방송시작 without product or session setup', async () => {
  const ctx = pageFixture(true), calls = [];
  ctx.state.live.sttMode = 'LOCAL';
  ctx.state.live.startListening = async (...args) => calls.push(['listen', ...args]);
  ctx.state.product = {
    startNewSession: async () => { calls.push(['new']); return { id: 'test-broadcast' }; },
    loadBootstrap: async () => { throw new Error('An initial test must create its own session'); },
  };
  const tree = ctx.settle();
  const start = nodes(tree).find(node => node.type === 'button' && textContent(node) === '방송시작');
  assert.ok(start);
  start.props.onClick();
  await tick();
  assert.deepEqual(calls, [['new'], ['listen', 'MIC', 'test-broadcast']]);
  assert.equal(nodes(ctx.settle()).some(node => node.type === 'button' && textContent(node) === '🎬 데모보기'), false);
});

test('test home resumes the same session and keeps sales detail and review navigation in the test scope', async () => {
  const ctx = pageFixture(true), calls = [];
  ctx.state.live.sttMode = 'LOCAL';
  ctx.state.live.startListening = async (...args) => calls.push(args);
  ctx.state.activeSession = { id: 'broadcast-1', status: 'ACTIVE' };
  ctx.state.sales = [sale('sold'), sale('pending', { status: '보류' })];
  ctx.state.product = { loadBootstrap: async () => ({ activeSession: ctx.state.activeSession }),
    startNewSession: async () => { throw new Error('Stop/start must not create another session'); } };
  const tree = ctx.settle();
  nodes(tree).find(node => node.type === 'button' && textContent(node) === '방송시작').props.onClick();
  await tick();
  assert.deepEqual(calls, [['MIC', 'broadcast-1']]);
  const card = nodes(tree).find(node => node.type === 'link' && node.props.to === '/live-test/sales/sold');
  assert.equal(card.props.state.returnTo, '/live-test');
  assert.ok(nodes(tree).some(node => node.type === 'link' && node.props.to === '/live-test/sales/review'));
});

test('test home reports startup failure at the top and can cancel pending microphone startup', async () => {
  const ctx = pageFixture(true);
  ctx.state.live.sttMode = 'LOCAL';
  let rejectStartup;
  let stops = 0;
  ctx.state.live.startListening = () => new Promise((_resolve, reject) => { rejectStartup = reject; });
  ctx.state.live.stopListening = () => { stops++; };
  ctx.state.product = { startNewSession: async () => ({ id: 'test-broadcast' }) };
  nodes(ctx.settle()).find(node => node.type === 'button' && textContent(node) === '방송시작').props.onClick();
  await tick();
  const preparing = ctx.settle();
  assert.ok(nodes(preparing).some(node => node.type === 'button' && textContent(node) === '준비 취소'));
  assert.ok(nodes(preparing).some(node => node.props.role === 'status' && /방송 시작 준비 중/u.test(textContent(node))));
  nodes(preparing).find(node => node.type === 'button' && textContent(node) === '준비 취소').props.onClick();
  assert.equal(stops, 1);
  rejectStartup(new Error('마이크 권한이 거부되었습니다.'));
  await tick();
  assert.equal(nodes(ctx.settle()).some(node => node.props.role === 'alert' && /마이크 권한/u.test(textContent(node))), false);

  ctx.state.live.startListening = async () => { throw new Error('내 PC STT에 연결할 수 없습니다.'); };
  nodes(ctx.settle()).find(node => node.type === 'button' && textContent(node) === '방송시작').props.onClick();
  await tick();
  const failed = ctx.settle();
  assert.ok(nodes(failed).some(node => node.props.role === 'alert' && /내 PC STT에 연결할 수 없습니다/u.test(textContent(node))), textContent(failed).slice(0, 800));
});

test('test broadcast stop keeps comment capture enabled for a restart', () => {
  const ctx = pageFixture(true);
  let stops = 0;
  ctx.state.live.isListening = true;
  ctx.state.live.stopListening = () => { stops++; };
  const button = nodes(ctx.settle()).find(node => node.type === 'button' && textContent(node) === '방송중지');
  button.props.onClick();
  assert.equal(stops, 1);
  assert.equal(ctx.state.commentStops, 0);
});
