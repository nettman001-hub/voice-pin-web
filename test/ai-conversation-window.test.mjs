import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sale = (extra = {}) => ({
  id: 'sale-1', sessionId: 'broadcast-1', buyerNickname: '이뿌쥬~^^', amount: 8000,
  source: 'WEB_VOICE', status: '보류', syncStatus: 'SYNCED', history: [],
  aiVerification: { aiStatus: 'INSUFFICIENT_DATA', aiTaskId: 'task-old' },
  ...extra,
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree === null || tree === undefined || typeof tree === 'boolean') return [];
  return [tree, ...(typeof tree === 'object' ? nodes(tree.props?.children) : [])];
}
const visibleText = (tree) => nodes(tree).filter((node) => typeof node === 'string' || typeof node === 'number').join(' ');
const buttonWithText = (tree, label) => {
  const button = nodes(tree).find((node) => node?.type === 'button' && visibleText(node).includes(label));
  assert.ok(button, `Missing button: ${label}`);
  return button;
};
const clickEvent = () => ({
  prevented: false, stopped: false,
  preventDefault() { this.prevented = true; },
  stopPropagation() { this.stopped = true; },
});

function componentFixture(relativePath, imports, globals = {}) {
  const cells = [], effects = [];
  let index = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    createContext(value) { return { value, Provider: 'provider' }; },
    useContext(context) { return context.value; },
    useRef(initial) { const i = index++; cells[i] ||= { current: initial }; return cells[i]; },
    useState(initial) {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }];
    },
    useMemo(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) cells[i] = { deps, value: callback() };
      return cells[i].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) {
        const previous = cells[i]; cells[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
      }
    },
  };
  const modules = {
    react: { __esModule: true, ...react, default: react },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    ...imports,
  };
  const source = fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console,
    require(name) { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; },
    ...globals,
  }, { filename: relativePath });
  return {
    exports: module.exports,
    render(name, props = {}) {
      index = 0;
      const tree = module.exports[name](props);
      effects.splice(0).forEach((effect) => effect());
      return tree;
    },
    unmount() { cells.forEach((cell) => cell?.cleanup?.()); },
  };
}

test('the AI badge opens a read-only conversation without navigating the sale row', () => {
  const opened = [];
  const ctx = componentFixture('src/components/sales/AiSaleBadge.tsx', {
    './SaleAiConversationWindow': { useSaleAiConversationWindow: () => ({ openConversation: (...args) => opened.push(args) }) },
  });
  const record = sale();
  const button = buttonWithText(ctx.render('AiSaleBadge', { sale: record }), 'AI');
  const event = clickEvent();
  button.props.onClick(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], record);
  assert.notEqual(opened[0][1]?.reviewing, true);
  assert.equal(button.props.type, 'button');
});

test('ordinary sales without AI metadata do not gain an AI conversation badge', () => {
  const ctx = componentFixture('src/components/sales/AiSaleBadge.tsx', {
    './SaleAiConversationWindow': { useSaleAiConversationWindow: () => ({ openConversation() { throw new Error('Unexpected popup'); } }) },
  });
  assert.equal(ctx.render('AiSaleBadge', { sale: sale({ aiVerification: undefined }) }), null);
});

function actionFixture({ blocked = false, failure = null, skipped = false } = {}) {
  const calls = [];
  const ctx = componentFixture('src/components/sales/SaleAiActionButtons.tsx', {
    './SaleAiEvidenceModal': { SaleAiEvidenceModal: 'evidence-modal' },
    './SaleAiConversationWindow': { useSaleAiConversationWindow: () => ({
      openConversation(record, options) {
        calls.push({ action: 'open', record, options });
        return blocked ? null : { finishReview(message) { calls.push({ action: 'finish', message }); } };
      },
    }) },
    '../../context/AuthContext': { useAuth: () => ({ workspaceId: 'workspace-1' }) },
    '../../context/SalesContext': { useSales: () => ({
      updateSale() { throw new Error('Review must not manually update sale'); },
      refreshSales: async () => { calls.push({ action: 'refresh' }); },
    }) },
    '../../context/LiveContext': { useLive: () => ({
      syncCurrentTranscriptsToCloud: async (sessionId) => { calls.push({ action: 'sync', sessionId }); },
    }) },
    '../../services/aiSettingsApi': { aiSettingsApi: {
      triggerPendingAiResolution: async (id, options) => {
        calls.push({ action: 'review', id, options });
        if (failure) throw new Error(failure);
        return skipped ? { skipped: true, message: '추가 판매자 멘트를 기다립니다.' } : { sale: sale() };
      },
    } },
    '../../services/voiceCorrectionService': { rollbackCorrection() {} },
  });
  return { ...ctx, calls, renderAction(record = sale()) { return ctx.render('SaleAiActionButtons', { sale: record }); } };
}

test('AI review opens the window synchronously and still performs exactly one review', async () => {
  const ctx = actionFixture();
  const event = clickEvent();
  buttonWithText(ctx.renderAction(), 'AI 다시 검토').props.onClick(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(ctx.calls[0].action, 'open');
  assert.equal(ctx.calls[0].options?.reviewing, true);
  assert.equal(ctx.calls.filter((entry) => entry.action === 'review').length, 0);
  assert.equal(buttonWithText(ctx.renderAction(), 'AI 검토 중').props.disabled, true);
  await tick();
  assert.deepEqual(ctx.calls.slice(0, 3).map((entry) => entry.action), ['open', 'sync', 'review']);
  assert.equal(ctx.calls.filter((entry) => entry.action === 'refresh').length, 1);
  assert.equal(ctx.calls.filter((entry) => entry.action === 'finish').length, 1);
  assert.equal(ctx.calls[2].id, 'sale-1');
  assert.equal(ctx.calls[2].options.workspaceId, 'workspace-1');
  assert.equal(ctx.calls[2].options.forceReanalyze, true);
  assert.equal(buttonWithText(ctx.renderAction(), 'AI 다시 검토').props.disabled, false);
});

test('a blocked popup does not duplicate or suppress the intended AI review', async () => {
  const ctx = actionFixture({ blocked: true });
  buttonWithText(ctx.renderAction(), 'AI 다시 검토').props.onClick(clickEvent());
  await tick();
  assert.equal(ctx.calls.filter((entry) => entry.action === 'review').length, 1);
  assert.equal(ctx.calls.filter((entry) => entry.action === 'refresh').length, 1);
  assert.equal(ctx.calls.filter((entry) => entry.action === 'finish').length, 0);
});

test('failed and skipped reviews finish the viewer with their actual explanation', async () => {
  for (const options of [{ failure: 'AI 서버에 연결할 수 없습니다.' }, { skipped: true }]) {
    const ctx = actionFixture(options);
    buttonWithText(ctx.renderAction(), 'AI 다시 검토').props.onClick(clickEvent());
    await tick();
    const expected = options.failure || '추가 판매자 멘트를 기다립니다.';
    assert.ok(visibleText(ctx.renderAction()).includes(expected));
    assert.equal(ctx.calls.filter((entry) => entry.action === 'finish').length, 1);
    assert.equal(ctx.calls.find((entry) => entry.action === 'finish').message, expected);
  }
});

function conversationFixture({ getAiTasks = async () => ({ tasks: [] }), blocked = false } = {}) {
  const state = { auth: { workspaceId: 'workspace-1', user: { id: 'seller-1' }, isAuthenticated: true },
    popups: [], alerts: [], queries: [] };
  const windowListeners = new Map();
  const window = {
    alert(message) { state.alerts.push(message); },
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    removeEventListener(name, callback) { if (windowListeners.get(name) === callback) windowListeners.delete(name); },
    open() {
      if (blocked) return null;
      const listeners = new Map();
      const popup = {
        closed: false, focused: 0,
        document: { documentElement: {}, head: { append() {} }, body: { replaceChildren() {} },
          createElement: (tag) => ({ tag }) },
        addEventListener(name, callback) { listeners.set(name, callback); },
        close() { this.closed = true; listeners.get('pagehide')?.(); },
        focus() { this.focused++; },
      };
      state.popups.push(popup);
      return popup;
    },
  };
  const ctx = componentFixture('src/components/sales/SaleAiConversationWindow.tsx', {
    'react-dom': { createPortal: (children, container, key) => ({ type: 'portal', props: { children, container, key } }) },
    '../../context/AuthContext': { useAuth: () => state.auth },
    '../../services/aiSettingsApi': { aiSettingsApi: {
      getAiTasks: (query) => { state.queries.push(query); return getAiTasks(query); },
    } },
  }, { window, setTimeout, clearTimeout, Error });
  return { ...ctx, state, windowListeners,
    renderProvider() { return ctx.render('SaleAiConversationProvider', { children: 'Original app' }); } };
}

const attempt = (extra = {}) => ({
  attemptId: 'attempt-1', taskId: 'task-1', slotNumber: 2, status: 'COMPLETED', isValidAttempt: true,
  startedAt: '2026-10-01T01:00:00Z', latencyMs: 810, ...extra,
});
function asReact(tree) {
  if (Array.isArray(tree)) return tree.map(asReact);
  if (!tree || typeof tree !== 'object') return tree;
  const { children, ...props } = tree.props;
  return React.createElement(tree.type === 'fragment' ? React.Fragment : tree.type, props, ...[].concat(children).map(asReact));
}

test('captured questions, answers and model metadata are shown verbatim as escaped text', () => {
  const ctx = conversationFixture();
  const systemPrompt = '<script>alert("system")</script> 반드시 댓글 이름으로 답변하세요.';
  const userPrompt = '<img src=x onerror=alert(1)> 이뿌쥬~^^ ㅈㅇ';
  const responseText = '{"buyerNickname":"이뿌쥬~^^","amount":8000} <svg onload=alert(2)>';
  const tree = ctx.render('AiAttemptConversation', { attempt: attempt({ conversationTrace: {
    systemPrompt, userPrompt, responseText, provider: 'DeepSeek', model: 'deepseek-flash',
    requestStartedAt: '2026-10-01T01:00:00Z', responseKind: 'MODEL_OUTPUT', httpStatus: 200,
  } }) });
  assert.ok(visibleText(tree).includes(systemPrompt));
  assert.ok(visibleText(tree).includes(userPrompt));
  assert.ok(visibleText(tree).includes(responseText));
  assert.ok(visibleText(tree).includes('DeepSeek / deepseek-flash'));
  assert.ok(visibleText(tree).includes('HTTP 200'));
  assert.equal(nodes(tree).filter((node) => node?.props?.dangerouslySetInnerHTML).length, 0);
  const html = renderToStaticMarkup(asReact(tree));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<svg onload'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('legacy records explicitly say the sent prompt is absent while preserving any stored raw answer', () => {
  const ctx = conversationFixture();
  const tree = ctx.render('AiAttemptConversation', { attempt: attempt({
    result: { execution: { rawResponse: '이뿌쥬~^^ 8000' } },
  }) });
  assert.ok(visibleText(tree).includes('전송한 질문 원문이 저장되지 않은 기록입니다.'));
  assert.ok(visibleText(tree).includes('과거 질문을 현재 설정으로 재구성하지 않습니다.'));
  assert.ok(visibleText(tree).includes('이뿌쥬~^^ 8000'));
});

test('timeouts and HTTP failures keep separate slot/error/response details', () => {
  const ctx = conversationFixture();
  const timedOut = ctx.render('AiAttemptConversation', { attempt: attempt({ slotNumber: 1, status: 'FAILED',
    errorMessage: '첫 번째 AI가 4초 내에 응답하지 않았습니다.', conversationTrace: {
      systemPrompt: '시스템', userPrompt: '판매 질문', provider: 'local', model: 'gemma', requestStartedAt: '2026-10-01T01:00:00Z',
    },
  }) });
  assert.ok(visibleText(timedOut).includes('첫 번째 AI가 4초 내에 응답하지 않았습니다.'));
  assert.ok(visibleText(timedOut).includes('저장된 답변 원문이 없습니다.'));
  const failed = ctx.render('AiAttemptConversation', { attempt: attempt({ status: 'FAILED', conversationTrace: {
    systemPrompt: '시스템', userPrompt: '판매 질문', provider: 'cloud', model: 'flash', requestStartedAt: '2026-10-01T01:00:00Z',
    responseKind: 'HTTP_ERROR', responseText: 'Too many requests', httpStatus: 429,
  } }) });
  assert.ok(visibleText(failed).includes('AI 서버 오류 응답 원문'));
  assert.ok(visibleText(failed).includes('Too many requests'));
  assert.ok(visibleText(failed).includes('HTTP 429'));
});

test('the same sale reuses its popup and a blocked popup explains the browser setting', () => {
  const ctx = conversationFixture();
  let tree = ctx.renderProvider();
  tree.props.value.openConversation(sale());
  tree = ctx.renderProvider();
  assert.equal(nodes(tree).filter((node) => node?.type === 'portal').length, 1);
  tree.props.value.openConversation(sale());
  assert.equal(ctx.state.popups.length, 1);
  assert.equal(ctx.state.popups[0].focused, 1);
  const blocked = conversationFixture({ blocked: true });
  assert.equal(blocked.renderProvider().props.value.openConversation(sale()), null);
  assert.equal(blocked.state.alerts.length, 1);
  assert.ok(blocked.state.alerts[0].includes('팝업을 허용'));
  ctx.unmount();
});

test('logout, user replacement, workspace changes and parent close destroy conversation windows', () => {
  for (const nextAuth of [
    { workspaceId: 'workspace-1', user: null, isAuthenticated: false },
    { workspaceId: 'workspace-1', user: { id: 'seller-2' }, isAuthenticated: true },
    { workspaceId: 'workspace-2', user: { id: 'seller-1' }, isAuthenticated: true },
  ]) {
    const ctx = conversationFixture();
    const handle = ctx.renderProvider().props.value.openConversation(sale(), { reviewing: true });
    assert.equal(ctx.state.popups[0].closed, false);
    ctx.state.auth = nextAuth;
    ctx.renderProvider();
    assert.equal(ctx.state.popups[0].closed, true);
    handle.finishReview('late result');
    assert.equal(nodes(ctx.renderProvider()).filter((node) => node?.type === 'portal').length, 0);
    ctx.unmount();
  }
  const ctx = conversationFixture();
  ctx.renderProvider().props.value.openConversation(sale());
  ctx.windowListeners.get('pagehide')();
  assert.equal(ctx.state.popups[0].closed, true);
  ctx.unmount();
});

const task = (extra = {}) => ({
  taskId: 'task-1', workspaceId: 'workspace-1', saleId: 'sale-1', status: 'RESOLVED',
  taskType: 'PENDING_SALE', createdAt: '2026-10-01T01:00:00Z', saleRevision: 1, attempts: [], requestPayload: {}, ...extra,
});
const entry = (extra = {}) => ({ sale: sale(), workspaceId: 'workspace-1', refreshVersion: 0,
  reviewing: false, popup: { close() {} }, ...extra });

test('viewer refresh only fetches the sale-scoped history and never requests another AI analysis', async () => {
  const ctx = conversationFixture({ getAiTasks: async () => ({ tasks: [task()] }) });
  const props = { entry: entry() };
  ctx.render('SaleAiConversationView', props);
  await tick();
  let tree = ctx.render('SaleAiConversationView', props);
  assert.ok(visibleText(tree).includes('task-1'));
  assert.equal(ctx.state.queries[0].saleId, 'sale-1');
  assert.equal(ctx.state.queries[0].workspaceId, 'workspace-1');
  buttonWithText(tree, '기록 새로고침').props.onClick();
  ctx.render('SaleAiConversationView', props);
  await tick();
  tree = ctx.render('SaleAiConversationView', props);
  assert.equal(ctx.state.queries.length, 2);
  assert.ok(visibleText(tree).includes('기록 조회 전용'));
  ctx.unmount();
});

test('viewer refuses records from other sales or workspaces and ignores a response after unmount', async () => {
  for (const foreign of [task({ workspaceId: 'workspace-other' }), task({ saleId: 'sale-other' })]) {
    const ctx = conversationFixture({ getAiTasks: async () => ({ tasks: [foreign] }) });
    const props = { entry: entry() };
    ctx.render('SaleAiConversationView', props);
    await tick();
    const text = visibleText(ctx.render('SaleAiConversationView', props));
    assert.ok(text.includes('판매 내역에 연결되지 않은 AI 기록'));
    assert.ok(!text.includes('task-1'));
    ctx.unmount();
  }
  let resolve;
  const ctx = conversationFixture({ getAiTasks: () => new Promise((done) => { resolve = done; }) });
  const props = { entry: entry() };
  ctx.render('SaleAiConversationView', props);
  ctx.unmount();
  resolve({ tasks: [task({ taskId: 'should-never-render' })] });
  await tick();
  assert.ok(!visibleText(ctx.render('SaleAiConversationView', props)).includes('should-never-render'));
});
