import { runtimeFixture } from './runtime-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(path, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, console,
    require(name) { if (name.endsWith('WorkspaceRuntimeContext')) return runtimeFixture(dependencies);  assert.ok(name in dependencies, `Unexpected import: ${name}`); return dependencies[name]; },
    ...globals,
  }, { filename: path });
  return module.exports;
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree == null || typeof tree === 'boolean'
  ? [] : [tree, ...(typeof tree === 'object' ? nodes(tree.props?.children) : [])];
const text = (tree) => nodes(tree).filter((node) => typeof node === 'string' || typeof node === 'number').join('');
const badgeButton = (tree) => nodes(tree).find((node) => node?.type === 'button' && node.props.title?.startsWith('클릭하여'));

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { [...listeners.get(event.type) || []].forEach((listener) => listener(event)); },
  };
}
function clockFixture() {
  let now = Date.parse('2026-10-12T00:00:00Z'), nextId = 0;
  const timers = new Map();
  return {
    get now() { return now; },
    setTimer(callback, delay) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimer(id) { timers.delete(id); },
    get timerCount() { return timers.size; },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = end;
    },
  };
}
function summary(now, primarySlot = 1) {
  const slot = (slotNumber) => ({ slotNumber, overallStatus: 'AVAILABLE', isExpired: false,
    lastCheckedAt: new Date(now).toISOString(), location: 'EXTERNAL_IP', routingMode: 'SERVER_DIRECT',
    executorId: 'SERVER', model: `model-${slotNumber}`, endpointUrl: 'https://model.example.test',
    tier1: {}, tier2: {}, tier3: {}, consecutiveFailures: 0, consecutiveSuccesses: 1,
  });
  return {
    runtimeStatus: { activeSlot: primarySlot, activePrimarySlot: primarySlot,
      slot1CircuitBreaker: { isOpen: false }, slot2CircuitBreaker: { isOpen: false },
      queuedTaskCount: 0, processingTaskCount: 0, lastSwitchReason: null, checkedAt: new Date(now).toISOString() },
    healthSummary: { slot1: slot(1), slot2: slot(2), activePrimarySlot: primarySlot },
    settings: { primarySlot, appliedVersion: 1, slot1: { provider: 'OPENAI' }, slot2: { provider: 'OPENAI' } },
  };
}

// Mount the real badge, API, cache, and scheduler together. Fake hooks implement
// render/effect cleanup; only browser events/timers and the Edge transport differ.
function environment() {
  const clock = clockFixture(), window = eventTarget(), document = { ...eventTarget(), hidden: false, body: {} };
  const navigator = { onLine: true };
  const FakeDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  };
  const globals = { Date: FakeDate, window, document, navigator,
    setTimeout: clock.setTimer, clearTimeout: clock.clearTimer };
  const { SnapshotCache } = loadModule('src/services/aiStatusCache.ts', {}, globals);
  const cache = new SnapshotCache(60_000, () => clock.now);
  const { DEFAULT_AI_SETTINGS } = loadModule('src/types/aiSettings.ts');
  const env = { clock, window, document, navigator, cache, calls: [],
    auth: { user: { id: 'seller-1' }, workspaceId: 'workspace-1', isRemoteAuth: true },
    response: () => summary(clock.now),
  };
  const api = loadModule('src/services/aiSettingsApi.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => ({ functions: {
      invoke: async (name, options) => {
        env.calls.push({ name, body: options.body });
        return { data: { ok: true, data: structuredClone(await env.response(options.body)) }, error: null };
      },
    } }) },
    './aiStatusCache': { aiStatusCache: cache },
    '../utils/maskingUtils': { buildOpenAiModelsUrl: () => '' },
    '../types/aiSettings': { DEFAULT_AI_SETTINGS },
  }, globals);
  const scheduler = loadModule('src/services/visibleRefresh.ts', {}, globals);
  env.mount = (props = {}) => {
    const cells = [], effects = [];
    let index = 0;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
    const react = {
      Fragment: 'fragment',
      createElement(type, attributes, ...children) { return { type, props: { ...attributes, children } }; },
      useState(initial) {
        const i = index++;
        if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
        return [cells[i], (value) => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }];
      },
      useMemo(callback, dependencies) {
        const i = index++;
        if (!same(cells[i]?.dependencies, dependencies)) cells[i] = { dependencies, value: callback() };
        return cells[i].value;
      },
      useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
      useEffect(callback, dependencies) {
        const i = index++;
        if (!same(cells[i]?.dependencies, dependencies)) {
          const previous = cells[i]; cells[i] = { dependencies };
          effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
        }
      },
    };
    const component = loadModule('src/components/live/AiLiveStatusBadge.tsx', {
      react: { __esModule: true, default: react, ...react },
      'react-dom': { createPortal: (tree) => tree },
      'lucide-react': new Proxy({}, { get: (_target, name) => name }),
      '../../services/aiSettingsApi': api,
      '../../services/aiStatusCache': { aiStatusCache: cache },
      '../../services/visibleRefresh': scheduler,
      '../../types/aiSettings': { DEFAULT_AI_SETTINGS },
      '../../context/AuthContext': { useAuth: () => env.auth },
      '../../context/SalesContext': { useSales: () => ({ sales: [] }) },
      '../../utils/maskingUtils': { maskEndpointUrl: (url) => url || '' },
    }, globals);
    return {
      render() { index = 0; const tree = component.AiLiveStatusBadge(props); effects.splice(0).forEach((effect) => effect()); return tree; },
      async settle() { this.render(); await flush(); return this.render(); },
      unmount() { cells.forEach((cell) => cell?.cleanup?.()); },
    };
  };
  return env;
}

for (const status of ['EXPIRED', 'CHECKING', 'UNCONFIGURED']) {
  test(`real AI badge does not mark primary slot 2 ${status} as available`, async () => {
    const env = environment(), value = summary(env.clock.now, 2);
    Object.assign(value.healthSummary.slot2, { overallStatus: status, isExpired: status === 'EXPIRED' });
    env.response = () => value;
    const component = env.mount();
    const button = badgeButton(await component.settle());
    assert.equal(button.props.className.includes('emerald'), false);
    assert.equal(text(button).includes('사용 가능'), false);
    component.unmount();
  });
}

test('a current available primary is green but an open primary breaker is never green', async () => {
  const env = environment(), value = summary(env.clock.now, 2);
  env.response = () => value;
  const component = env.mount();
  assert.equal(badgeButton(await component.settle()).props.className.includes('emerald'), true);
  value.runtimeStatus.slot2CircuitBreaker.isOpen = true;
  env.cache.invalidateAll(); env.window.dispatchEvent({ type: 'voicecap_ai_settings_changed' }); await flush();
  const button = badgeButton(component.render());
  assert.equal(button.props.className.includes('emerald'), false);
  assert.equal(text(button).includes('사용 가능'), false);
  component.unmount();
});

for (const status of ['CHECKING', 'EXPIRED']) {
  test(`slot 1 open plus slot 2 ${status} does not advertise an available fallback`, async () => {
    const env = environment(), value = summary(env.clock.now);
    value.runtimeStatus.slot1CircuitBreaker.isOpen = true;
    Object.assign(value.healthSummary.slot2, { overallStatus: status, isExpired: status === 'EXPIRED' });
    env.response = () => value;
    const component = env.mount();
    const button = badgeButton(await component.settle());
    assert.equal(text(button).includes('2번 사용 가능'), false);
    assert.equal(text(button).includes('상태 확인 필요'), true);
    component.unmount();
  });
}

test('desktop/mobile badge mounts share one Edge request and closed details create no timer', async () => {
  const env = environment(), desktop = env.mount({ compact: true }), mobile = env.mount({ compact: true });
  desktop.render(); mobile.render(); await flush();
  assert.equal(text(badgeButton(desktop.render())).includes('판매 AI'), true);
  assert.equal(text(badgeButton(mobile.render())).includes('판매 AI'), true);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].body.action, 'get-ai-status-summary');
  assert.equal(env.clock.timerCount, 0);
  await env.clock.advance(10 * 60_000);
  assert.equal(env.calls.length, 1);
  assert.equal(env.clock.timerCount, 0);
  desktop.unmount(); mobile.unmount();
});

test('real detail modal polling pauses hidden/offline, resumes without duplicate requests, and ends on close', async () => {
  const env = environment(), component = env.mount();
  badgeButton(await component.settle()).props.onClick(); component.render(); await flush();
  assert.equal(env.clock.timerCount, 1);
  await env.clock.advance(60_000);
  assert.equal(env.calls.length, 2);
  env.document.hidden = true; env.document.dispatchEvent({ type: 'visibilitychange' });
  await env.clock.advance(10 * 60_000);
  assert.equal(env.calls.length, 2);
  env.navigator.onLine = false; env.document.hidden = false; env.document.dispatchEvent({ type: 'visibilitychange' });
  await env.clock.advance(10 * 60_000);
  assert.equal(env.calls.length, 2);
  env.navigator.onLine = true; env.window.dispatchEvent({ type: 'online' }); await flush();
  assert.equal(env.calls.length, 3, 'the badge and modal resume listeners must share one request');
  const close = nodes(component.render()).find((node) => node?.type === 'button' && text(node) === '닫기');
  close.props.onClick(); component.render();
  assert.equal(env.clock.timerCount, 0);
  await env.clock.advance(10 * 60_000);
  assert.equal(env.calls.length, 3);
  component.unmount();
});

test('a late previous-account response cannot replace the current account badge', async () => {
  const env = environment(), pending = [];
  env.response = (body) => new Promise((resolve) => pending.push({ body, resolve }));
  const component = env.mount(); component.render(); await flush();
  env.auth = { user: { id: 'seller-2' }, workspaceId: 'workspace-2', isRemoteAuth: true };
  component.render(); await flush();
  assert.equal(pending.length, 2);
  pending[1].resolve(summary(env.clock.now, 2)); await flush();
  assert.equal(text(badgeButton(component.render())).includes('AI 2번'), true);
  pending[0].resolve(summary(env.clock.now, 1)); await flush();
  assert.equal(text(badgeButton(component.render())).includes('AI 2번'), true);
  assert.equal(text(badgeButton(component.render())).includes('AI 1번'), false);
  component.unmount();
});
