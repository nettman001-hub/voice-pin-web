import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

const { SnapshotCache } = loadModule('../src/services/aiStatusCache.ts');
const { startVisibleRefresh } = loadModule('../src/services/visibleRefresh.ts');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('AI sidebar consumers share one request; idle time generates no further requests', async () => {
  let now = 100;
  let requests = 0;
  let release;
  const cache = new SnapshotCache(60_000, () => now);
  const load = () => { requests++; return new Promise((resolve) => { release = resolve; }); };
  const desktop = [];
  const mobile = [];
  cache.subscribe('seller:workspace', (value) => desktop.push(value));
  cache.subscribe('seller:workspace', (value) => mobile.push(value));
  const first = cache.refresh('seller:workspace', load);
  const second = cache.refresh('seller:workspace', load);
  await flush();
  assert.equal(requests, 1);
  release({ queued: 2 });
  await Promise.all([first, second]);
  await cache.refresh('seller:workspace', load);
  assert.equal(requests, 1);
  assert.deepEqual(desktop, [{ queued: 2 }]);
  assert.deepEqual(mobile, desktop);
  now += 10 * 60_000;
  assert.deepEqual(cache.peek('seller:workspace'), { queued: 2 });
  assert.equal(requests, 1, 'an idle cache must not start a polling timer');
  assert.equal(cache.peek('other-seller:other-workspace'), undefined);
});

test('AI setting application invalidates snapshots and cannot publish an old in-flight result', async () => {
  const cache = new SnapshotCache();
  let release;
  const received = [];
  cache.subscribe('seller:workspace', (value) => received.push(value));
  const old = cache.refresh('seller:workspace', () => new Promise((resolve) => { release = resolve; }));
  await flush();
  cache.invalidateAll();
  await cache.refresh('seller:workspace', async () => ({ version: 2 }));
  release({ version: 1 });
  await old;
  assert.deepEqual(received, [{ version: 2 }]);
  assert.deepEqual(cache.peek('seller:workspace'), { version: 2 });
});

function scheduler() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimer(callback, delay) { const key = ++id; timers.set(key, { at: now + delay, callback }); return key; },
    clearTimer(key) { timers.delete(key); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
    },
    get size() { return timers.size; },
  };
}

test('AI detail refresh pauses hidden/offline, resumes once, and stops on close', async () => {
  const clock = scheduler();
  let visible = true;
  let online = true;
  let resume;
  let requests = 0;
  const stop = startVisibleRefresh({
    refresh: async () => { requests++; },
    isVisible: () => visible, isOnline: () => online,
    listen: (callback) => { resume = callback; return () => { resume = undefined; }; },
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  await flush();
  await clock.advance(60_000);
  assert.equal(requests, 2);
  visible = false; resume();
  await clock.advance(10 * 60_000);
  assert.equal(requests, 2);
  online = false; visible = true; resume();
  await clock.advance(10 * 60_000);
  assert.equal(requests, 2);
  online = true; resume();
  await flush();
  assert.equal(requests, 3);
  stop();
  await clock.advance(10 * 60_000);
  assert.equal(requests, 3);
  assert.equal(clock.size, 0);
});

test('Slow AI responses never overlap and failed refreshes back off', async () => {
  const clock = scheduler();
  let release;
  let resume;
  let requests = 0;
  const stop = startVisibleRefresh({
    refresh: () => { requests++; return new Promise((resolve, reject) => { release = { resolve, reject }; }); },
    isVisible: () => true, isOnline: () => true,
    listen: (callback) => { resume = callback; return () => {}; },
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  await clock.advance(5 * 60_000);
  resume(); resume();
  assert.equal(requests, 1);
  release.reject(new Error('temporarily offline'));
  await flush();
  await clock.advance(119_999);
  assert.equal(requests, 1);
  await clock.advance(1);
  assert.equal(requests, 2);
  stop(); release.resolve();
  await flush();
  assert.equal(clock.size, 0);
});

test('AI summary client invokes a single Edge action with workspace scope', async () => {
  const calls = [];
  const response = { runtimeStatus: { queuedTaskCount: 1 }, healthSummary: {}, settings: {} };
  const { aiSettingsApi } = loadModule('../src/services/aiSettingsApi.ts', {
    './supabaseClient': {
      isSupabaseConfigured: true,
      requireSupabase: () => ({ functions: { invoke: async (name, options) => {
        calls.push({ name, body: options.body });
        return { data: { ok: true, data: response }, error: null };
      } } }),
    },
    './aiStatusCache': { aiStatusCache: new SnapshotCache() },
    '../utils/maskingUtils': { buildOpenAiModelsUrl: () => '' },
    '../types/aiSettings': { DEFAULT_AI_SETTINGS: {} },
  });
  assert.equal(await aiSettingsApi.getAiStatusSummary('workspace-1'), response);
  assert.deepEqual(calls, [{ name: 'sales-api', body: { action: 'get-ai-status-summary', workspaceId: 'workspace-1' } }]);
});
