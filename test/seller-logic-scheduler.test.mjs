import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/services/sellerLogicScheduler.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function fixture(execute, options = { intervalMs: 100 }) {
  const timers = new Map();
  const delays = new Map();
  let timerId = 0;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, callback); delays.set(id, delay); return id; },
    clearTimeout(id) { timers.delete(id); delays.delete(id); },
  }, { filename: 'sellerLogicScheduler.ts' });
  const results = [], errors = [], states = [];
  const scheduler = new module.exports.SellerLogicScheduler({
    execute,
    result(output, input) { results.push({ output, input }); },
    error(error) { errors.push(error); },
    state(state) { states.push({ ...state }); },
    ...options,
  });
  return {
    scheduler, results, errors, states, timers, delays,
    fire() {
      const due = [...timers.values()];
      timers.clear();
      delays.clear();
      due.forEach((callback) => callback());
    },
  };
}

test('automatic analysis defaults to five seconds and does not repeat completed evidence', async () => {
  const calls = [];
  const f = fixture(async (input) => { calls.push(input); return 'done'; }, {});
  f.scheduler.setAutomatic(true);
  assert.equal(f.timers.size, 0);
  f.scheduler.submit('new');
  assert.deepEqual([...f.delays.values()], [5000]);
  f.fire(); await tick();
  f.scheduler.setIntervalMs(10000);
  f.scheduler.setAutomatic(true);
  f.fire(); await tick();
  assert.deepEqual(calls, ['new']);
  assert.equal(f.timers.size, 0);
  f.scheduler.dispose();
});

test('changing the interval reschedules waiting work once with its newest evidence', async () => {
  const calls = [];
  const f = fixture(async (input) => { calls.push(input); return 'done'; });
  f.scheduler.setAutomatic(true);
  f.scheduler.submit('first');
  f.scheduler.setIntervalMs(15000);
  f.scheduler.submit('latest');
  assert.equal(f.timers.size, 1);
  assert.deepEqual([...f.delays.values()], [15000]);
  assert.equal(calls.length, 0);
  f.fire(); await tick();
  assert.deepEqual(calls, ['latest']);
  assert.equal(f.timers.size, 0);
  f.scheduler.dispose();
});

test('changing the interval during analysis preserves the active request and delays queued work', async () => {
  const calls = [], pending = [];
  const f = fixture((input) => { calls.push(input); const work = deferred(); pending.push(work); return work.promise; });
  f.scheduler.setAutomatic(true);
  f.scheduler.submit('active'); f.fire();
  f.scheduler.submit('queued');
  f.scheduler.setIntervalMs(30000);
  f.scheduler.analyzeNow(); f.fire();
  assert.deepEqual(calls, ['active']);
  assert.equal(f.timers.size, 0);
  pending[0].resolve('first'); await tick();
  assert.deepEqual(f.results, [{ input: 'active', output: 'first' }]);
  assert.deepEqual([...f.delays.values()], [30000]);
  f.fire();
  assert.deepEqual(calls, ['active', 'queued']);
  pending[1].resolve('second'); await tick();
  assert.equal(f.timers.size, 0);
  f.scheduler.dispose();
});

test('automatic execution coalesces queued updates to the newest snapshot without overlap', async () => {
  const pending = [], calls = [];
  let active = 0, maximumActive = 0;
  const f = fixture(async (input) => {
    calls.push(input);
    active++;
    maximumActive = Math.max(maximumActive, active);
    const work = deferred(); pending.push(work);
    try { return await work.promise; } finally { active--; }
  });
  f.scheduler.setAutomatic(true);
  f.scheduler.submit({ revision: 1 });
  f.scheduler.submit({ revision: 2 });
  assert.equal(f.timers.size, 1);
  f.fire();
  assert.equal(calls[0].revision, 2);
  f.scheduler.submit({ revision: 3 });
  f.scheduler.submit({ revision: 4 });
  f.scheduler.analyzeNow();
  assert.equal(calls.length, 1);
  assert.equal(f.timers.size, 0);
  pending[0].resolve('first'); await tick();
  assert.equal(f.results[0].input.revision, 2);
  assert.equal(f.timers.size, 1);
  f.fire();
  assert.equal(calls[1].revision, 4);
  pending[1].resolve('latest'); await tick();
  assert.equal(f.results[1].input.revision, 4);
  assert.equal(f.timers.size, 0);
  assert.equal(maximumActive, 1);
  assert.deepEqual(f.errors, []);
  f.scheduler.dispose();
});

test('a provider error pauses automatic work and the same snapshot remains manually retryable', async () => {
  const calls = [], pending = [];
  const f = fixture((input) => { calls.push(input); const work = deferred(); pending.push(work); return work.promise; });
  f.scheduler.submit('evidence');
  f.scheduler.setAutomatic(true); f.fire();
  const error = new Error('provider unavailable');
  pending[0].reject(error); await tick();
  assert.deepEqual(f.errors, [error]);
  assert.deepEqual(f.states.at(-1), { running: false, automatic: false });
  assert.equal(f.timers.size, 0);
  f.scheduler.analyzeNow();
  assert.deepEqual(calls, ['evidence', 'evidence']);
  pending[1].resolve('recovered'); await tick();
  assert.deepEqual(f.results, [{ input: 'evidence', output: 'recovered' }]);
  assert.equal(f.timers.size, 0);
  f.scheduler.setAutomatic(true);
  assert.equal(f.timers.size, 0, 'successful evidence is not re-requested automatically');
  f.scheduler.dispose();
});

test('new evidence received during a failing request waits for manual retry after the failure', async () => {
  const calls = [], pending = [];
  const f = fixture((input) => { calls.push(input); const work = deferred(); pending.push(work); return work.promise; });
  f.scheduler.setAutomatic(true);
  f.scheduler.submit('old'); f.fire();
  f.scheduler.submit('new');
  pending[0].reject(new Error('timeout')); await tick();
  assert.equal(f.timers.size, 0);
  f.scheduler.analyzeNow();
  assert.deepEqual(calls, ['old', 'new']);
  pending[1].resolve('new result'); await tick();
  assert.equal(f.results[0].input, 'new');
  f.scheduler.dispose();
});

test('disabling automatic execution cancels scheduled work but preserves manual analysis', async () => {
  const calls = [];
  const f = fixture(async (input) => { calls.push(input); return 'done'; });
  f.scheduler.setAutomatic(true);
  f.scheduler.submit('saved');
  assert.equal(f.timers.size, 1);
  f.scheduler.setAutomatic(false);
  assert.equal(f.timers.size, 0);
  f.fire();
  assert.equal(calls.length, 0);
  f.scheduler.analyzeNow(); await tick();
  assert.deepEqual(calls, ['saved']);
  assert.equal(f.results[0].output, 'done');
  f.scheduler.dispose();
});

for (const outcome of ['resolve', 'reject']) {
  test(`dispose suppresses late ${outcome} callbacks and subsequent submissions`, async () => {
    const work = deferred(), calls = [];
    const f = fixture((input) => { calls.push(input); return work.promise; });
    f.scheduler.setAutomatic(true);
    f.scheduler.submit('before'); f.fire();
    f.scheduler.submit('queued');
    const stateCount = f.states.length;
    f.scheduler.dispose();
    work[outcome](outcome === 'resolve' ? 'late' : new Error('late')); await tick();
    f.scheduler.submit('after');
    f.scheduler.setAutomatic(true);
    f.scheduler.analyzeNow(); f.fire();
    assert.deepEqual(calls, ['before']);
    assert.equal(f.results.length, 0);
    assert.equal(f.errors.length, 0);
    assert.equal(f.states.length, stateCount);
    assert.equal(f.timers.size, 0);
  });
}

test('dispose cancels an automatic request that has not started', () => {
  let calls = 0;
  const f = fixture(async () => { calls++; });
  f.scheduler.setAutomatic(true);
  f.scheduler.submit('pending');
  f.scheduler.dispose(); f.fire();
  assert.equal(calls, 0);
  assert.equal(f.timers.size, 0);
});
