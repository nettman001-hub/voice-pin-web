import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as voiceSaleValidation from '../src/services/voiceSaleValidation.ts';
import * as priceEvidence from '../src/services/priceEvidence.ts';
import * as salesExtractor from '../src/services/salesExtractor.ts';
import * as purchaseFirstSales from '../src/services/purchaseFirstSales.ts';

const quiet = { log() {}, warn() {}, error() {} };
function load(path, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console: quiet, crypto: globalThis.crypto, Event, ...globals,
    require(name) { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name]; },
  }, { filename: path });
  return module.exports;
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sale = (id = 'sale-1', amount = 100) => ({
  id, sessionId: 'session-1', buyerNickname: '구매자', amount, status: '확정',
  recognizedAt: '2026-09-29T01:00:00Z', rawTranscript: '', revision: 1, syncStatus: 'SYNCED',
});
const { SalesSyncController } = load('../src/services/salesSyncController.ts');
function controller(options = {}) {
  let state = clone(options.state || { records: [], pending: [] });
  const saved = [], removed = [], errors = [];
  let active = true;
  const sync = new SalesSyncController({
    scope: options.scope,
    read: () => options.read ? options.read() : state,
    persist: (next) => { state = clone(next); options.persist?.(next); },
    update: options.update,
    save: async (record) => { saved.push(clone(record)); await options.save?.(record); },
    remove: async (id) => { removed.push(id); await options.remove?.(id); },
    load: options.load || (async () => []), changed() {}, error: (message) => errors.push(message), active: () => active,
  });
  return { sync, saved, removed, errors, state: () => state, deactivate() { active = false; } };
}

test('older save acknowledgement cannot roll back a newer edit; writes stay ordered', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const ctx = controller({ save: () => (++calls === 1 ? first.promise : second.promise) });
  const before = ctx.sync.upsert(sale());
  ctx.sync.upsert({ ...before, amount: 200 });
  assert.equal(ctx.saved.length, 1);
  first.resolve(); await tick();
  assert.equal(ctx.saved.length, 2);
  assert.equal(ctx.sync.records[0].amount, 200);
  assert.equal(ctx.sync.records[0].revision, 2);
  assert.equal(ctx.sync.records[0].syncStatus, 'PENDING');
  second.resolve(); await ctx.sync.flush();
  assert.equal(ctx.sync.records[0].syncStatus, 'SYNCED');
  assert.equal(ctx.state().pending.length, 0);
});

test('a snapshot requested before a completed edit cannot overwrite the edit', async () => {
  const snapshot = deferred();
  const ctx = controller({ state: { records: [sale()], pending: [] }, load: () => snapshot.promise });
  const refresh = ctx.sync.refresh();
  ctx.sync.upsert(sale('sale-1', 300)); await ctx.sync.flush();
  snapshot.resolve([sale()]); await refresh;
  assert.equal(ctx.sync.records[0].amount, 300);
});

test('a snapshot requested before a completed deletion cannot resurrect the sale', async () => {
  const snapshot = deferred();
  const ctx = controller({ state: { records: [sale()], pending: [] }, load: () => snapshot.promise });
  const refresh = ctx.sync.refresh();
  ctx.sync.delete('sale-1'); await ctx.sync.flush();
  snapshot.resolve([sale()]); await refresh;
  assert.equal(ctx.sync.records.length, 0);
});

test('server-committed sales are protected from an already-running empty snapshot', async () => {
  const snapshot = deferred();
  const ctx = controller({ load: () => snapshot.promise });
  const refresh = ctx.sync.refresh();
  ctx.sync.applyConfirmed([sale()]);
  snapshot.resolve([]); await refresh;
  assert.equal(ctx.sync.records.length, 1);
  assert.equal(ctx.saved.length, 0);
});

test('fresh snapshots still remove genuinely deleted remote records', async () => {
  const ctx = controller({ state: { records: [sale()], pending: [] } });
  await ctx.sync.refresh();
  assert.equal(ctx.sync.records.length, 0);
});

for (const restored of [false, true]) {
  test(`a snapshot started during ${restored ? 'recovered' : 'new'} pending work cannot erase its acknowledged sale`, async () => {
    const write = deferred(), snapshot = deferred();
    const row = { ...sale(), syncStatus: 'PENDING' };
    const ctx = controller({ save: () => write.promise, load: () => snapshot.promise,
      state: restored ? { records: [row], pending: [{ id: row.id, token: 'recovered', kind: 'UPSERT', sale: row }] } : undefined });
    if (restored) void ctx.sync.flush(); else ctx.sync.upsert(row);
    const refresh = ctx.sync.refresh();
    write.resolve(); await ctx.sync.flush();
    snapshot.resolve([]); await refresh;
    assert.equal(ctx.sync.records.length, 1);
    assert.equal(ctx.sync.records[0].syncStatus, 'SYNCED');
  });
}

test('a snapshot started during a pending edit cannot roll it back after its ACK', async () => {
  const write = deferred(), snapshot = deferred();
  const ctx = controller({ state: { records: [sale()], pending: [] }, save: () => write.promise, load: () => snapshot.promise });
  ctx.sync.upsert(sale('sale-1', 300));
  const refresh = ctx.sync.refresh();
  write.resolve(); await ctx.sync.flush(); snapshot.resolve([sale()]); await refresh;
  assert.equal(ctx.sync.records[0].amount, 300);
});

test('a snapshot started during a pending deletion cannot resurrect it after its ACK', async () => {
  const write = deferred(), snapshot = deferred();
  const ctx = controller({ state: { records: [sale()], pending: [] }, remove: () => write.promise, load: () => snapshot.promise });
  ctx.sync.delete('sale-1');
  const refresh = ctx.sync.refresh();
  write.resolve(); await ctx.sync.flush(); snapshot.resolve([sale()]); await refresh;
  assert.equal(ctx.sync.records.length, 0);
});

test('failed deletes remain durable tombstones and resume after reload', async () => {
  const ctx = controller({ state: { records: [sale()], pending: [] }, remove: async () => { throw new Error('offline'); } });
  ctx.sync.delete('sale-1'); await ctx.sync.flush();
  assert.equal(ctx.state().records.length, 0);
  assert.equal(ctx.state().pending[0].kind, 'DELETE');
  const restarted = controller({ state: ctx.state() });
  await restarted.sync.flush();
  assert.deepEqual(restarted.removed, ['sale-1']);
  assert.equal(restarted.state().pending.length, 0);
});

test('account changes stop retries and discard old snapshots', async () => {
  const snapshot = deferred(), write = deferred();
  const ctx = controller({ load: () => snapshot.promise, save: () => write.promise });
  const refresh = ctx.sync.refresh();
  const first = ctx.sync.upsert(sale());
  ctx.sync.upsert({ ...first, amount: 200 });
  ctx.deactivate(); write.resolve(); snapshot.resolve([sale('other')]);
  await refresh; await ctx.sync.flush();
  assert.equal(ctx.saved.length, 1);
  assert.equal(ctx.state().pending[0].sale.amount, 200);
  assert.equal(ctx.sync.records[0].amount, 200);
});

test('a non-retryable sale remains pending without blocking later sales or retrying on a timer', async () => {
  const ctx = controller({ save: async (record) => {
    if (record.id === 'invalid') throw { code: 'VALIDATION_ERROR', retryable: false };
  } });
  ctx.sync.upsert(sale('invalid')); ctx.sync.upsert(sale('valid'));
  await ctx.sync.flush();
  assert.equal(ctx.state().records.find((row) => row.id === 'invalid').syncStatus, 'PENDING');
  assert.equal(ctx.state().records.find((row) => row.id === 'valid').syncStatus, 'SYNCED');
  assert.equal(ctx.state().pending[0].blockedError.code, 'VALIDATION_ERROR');
  const attempts = ctx.saved.length;
  await ctx.sync.flush();
  assert.equal(ctx.saved.length, attempts);
  const reloaded = controller({ state: ctx.state() });
  await reloaded.sync.flush();
  assert.equal(reloaded.saved.length, 0);
  await reloaded.sync.flush({ retryBlocked: true });
  assert.equal(reloaded.saved.length, 1);
  assert.equal(reloaded.state().pending.length, 0);
});

test('a rejection of an older sale cannot block a newer edit of the same sale', async () => {
  const first = deferred();
  let calls = 0;
  const ctx = controller({ save: () => ++calls === 1 ? first.promise : Promise.resolve() });
  ctx.sync.upsert(sale()); ctx.sync.upsert(sale('sale-1', 500));
  first.reject({ code: 'VALIDATION_ERROR', retryable: false });
  await ctx.sync.flush();
  assert.equal(ctx.state().records[0].amount, 500);
  assert.equal(ctx.state().records[0].syncStatus, 'SYNCED');
  assert.equal(ctx.state().pending.length, 0);
});

function storageFixture({ quota = false, durableFailure = false } = {}) {
  const local = new Map(), durable = new Map();
  const events = [];
  const eventTarget = new EventTarget();
  let durableQueue = Promise.resolve();
  const globals = {
    localStorage: { get length() { return local.size; }, key(index) { return [...local.keys()][index] ?? null; },
      getItem: (key) => local.get(key) ?? null, setItem(key, value) { if (quota) throw new Error('QuotaExceededError'); local.set(key, value); }, removeItem: (key) => local.delete(key) },
    window: {
      dispatchEvent: (event) => { events.push(event.type); return eventTarget.dispatchEvent(event); },
      addEventListener: (...args) => eventTarget.addEventListener(...args),
      removeEventListener: (...args) => eventTarget.removeEventListener(...args),
    },
  };
  const commentTypes = load('../src/types/comment.ts');
  const { StorageService, isTemporarySessionId } = load('../src/services/storageService.ts', {
    '../types/comment': commentTypes,
    './sttVocabularyService': { normalizeSttVocabulary: (words) => words },
    './durableStorage': { durableStorage: {
      async set(key, value) { if (durableFailure) throw new Error('IndexedDB unavailable'); durable.set(key, clone(value)); },
      async get(key) { await durableQueue; return durable.get(key) ?? null; },
      async entries(prefix) { await durableQueue; return [...durable.entries()].filter(([key]) => key.startsWith(prefix)); },
      update(key, change) {
        const flight = durableQueue.then(async () => {
          if (durableFailure) throw new Error('IndexedDB unavailable');
          const next = change(clone(durable.get(key) ?? null));
          await tick(); // Two callers can overlap, but read/write stays one transaction.
          durable.set(key, clone(next)); return clone(next);
        });
        durableQueue = flight.catch(() => {});
        return flight;
      },
    } },
  }, globals);
  const storage = new StorageService(); storage.setWorkspaceId('workspace-1');
  return { storage, StorageService, isTemporarySessionId, local, durable, events, globals,
    setQuota(value) { quota = value; }, setDurableFailure(value) { durableFailure = value; } };
}

test('quota fallback preserves all sales and comment evidence without destructive cleanup', async () => {
  const ctx = storageFixture({ quota: true });
  const rows = Array.from({ length: 120 }, (_, index) => sale(`sale-${index}`));
  const comments = [{ id: 'stream-1', sessionId: 'session-1', nickname: '구매자', content: '저요', capturedAt: '2026-09-29T01:00:00Z' }];
  ctx.storage.addCommentRecords(comments, 'workspace-1');
  assert.equal(ctx.storage.getPersistenceError(), false, 'IndexedDB 저장 결과를 기다리는 동안 실패 경고를 띄우지 않는다');
  ctx.storage.saveSalesLocalState('workspace-1', { records: rows, pending: [] });
  assert.equal(ctx.storage.getPersistenceError(), false, '판매 데이터도 대체 저장 중에는 실패로 표시하지 않는다');
  assert.equal(ctx.storage.getSales('workspace-1').length, 120);
  assert.equal(ctx.storage.getCommentRecords('workspace-1').length, 1);
  await tick();
  assert.equal(ctx.storage.getPersistenceError(), false); // IndexedDB safely holds the fallback.
  const reloaded = new ctx.StorageService();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getSales('workspace-1').length, 120);
  assert.equal(reloaded.getCommentRecords('workspace-1').length, 1);
});

test('two tabs preserve distinct offline sales and pending operations through a shared transaction', async () => {
  const ctx = storageFixture();
  const other = new ctx.StorageService(); other.setWorkspaceId('workspace-1');
  const make = (storage) => controller({ scope: 'two-tabs',
    read: () => storage.getSalesLocalState('workspace-1'),
    update: (change) => storage.updateSalesLocalState('workspace-1', change),
    save: async () => { throw new Error('offline'); },
  });
  const first = make(ctx.storage), second = make(other);
  first.sync.upsert(sale('tab-A')); second.sync.upsert(sale('tab-B'));
  await Promise.all([first.sync.flush(), second.sync.flush()]);
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  assert.deepEqual(clone(reloaded.getSales('workspace-1')).map((item) => item.id).sort(), ['tab-A', 'tab-B']);
  assert.deepEqual(clone(reloaded.getSalesLocalState('workspace-1').pending).map((item) => item.id).sort(), ['tab-A', 'tab-B']);
});

test('a blocked sale is persisted transactionally and stays blocked after IndexedDB restoration', async () => {
  const ctx = storageFixture();
  const sync = controller({ read: () => ctx.storage.getSalesLocalState('workspace-1'),
    update: (change) => ctx.storage.updateSalesLocalState('workspace-1', change),
    save: async (row) => { if (row.id === 'invalid') throw { code: 'VALIDATION_ERROR', retryable: false }; },
  });
  sync.sync.upsert(sale('invalid')); sync.sync.upsert(sale('valid'));
  await sync.sync.flush();
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  const state = reloaded.getSalesLocalState('workspace-1');
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].blockedError.code, 'VALIDATION_ERROR');
  assert.equal(state.records.find((row) => row.id === 'valid').syncStatus, 'SYNCED');
  const retry = controller({ read: () => reloaded.getSalesLocalState('workspace-1'),
    update: (change) => reloaded.updateSalesLocalState('workspace-1', change),
  });
  await retry.sync.flush({ retryBlocked: true });
  assert.equal(reloaded.getSalesLocalState('workspace-1').pending.length, 0);
  assert.equal(reloaded.getSales('workspace-1').find((row) => row.id === 'invalid').syncStatus, 'SYNCED');
});

test('two tabs preserve distinct operations when Web Storage is full and recover from IndexedDB alone', async () => {
  const ctx = storageFixture({ quota: true }), other = new ctx.StorageService();
  const make = (storage) => controller({
    read: () => storage.getSalesLocalState('workspace-1'),
    update: (change) => storage.updateSalesLocalState('workspace-1', change),
    save: async () => { throw new Error('offline'); },
  });
  const first = make(ctx.storage), second = make(other);
  first.sync.upsert(sale('tab-A')); second.sync.upsert(sale('tab-B'));
  await Promise.all([first.sync.flush(), second.sync.flush()]);
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getSales('workspace-1').length, 2);
  assert.equal(reloaded.getSalesLocalState('workspace-1').pending.length, 2);
});

test('one tab ACK cannot remove another tab pending sale', async () => {
  const ctx = storageFixture(), write = deferred();
  const other = new ctx.StorageService(); other.setWorkspaceId('workspace-1');
  const make = (storage, save) => controller({ scope: 'two-tabs-ack',
    read: () => storage.getSalesLocalState('workspace-1'),
    update: (change) => storage.updateSalesLocalState('workspace-1', change), save });
  const first = make(ctx.storage, (row) => row.id === 'tab-A' ? write.promise : Promise.reject(new Error('offline')));
  const second = make(other, async () => { throw new Error('offline'); });
  first.sync.upsert(sale('tab-A')); await tick(); await tick();
  second.sync.upsert(sale('tab-B')); await tick(); await tick();
  write.resolve(); await Promise.all([first.sync.flush(), second.sync.flush()]);
  const state = ctx.storage.getSalesLocalState('workspace-1');
  assert.equal(state.records.find((row) => row.id === 'tab-A').syncStatus, 'SYNCED');
  assert.equal(state.pending.some((operation) => operation.id === 'tab-B'), true);
  assert.equal(state.records.length, 2);
});

test('a stale snapshot from another tab cannot discard a newly committed local record', async () => {
  const ctx = storageFixture(), snapshot = deferred();
  const other = new ctx.StorageService(); other.setWorkspaceId('workspace-1');
  const make = (storage, load) => controller({
    read: () => storage.getSalesLocalState('workspace-1'),
    update: (change) => storage.updateSalesLocalState('workspace-1', change), load });
  const first = make(ctx.storage), second = make(other, () => snapshot.promise);
  const refresh = second.sync.refresh(); await tick();
  first.sync.applyConfirmed([sale('new-confirmed')]); await first.sync.flush(); await tick();
  snapshot.resolve([]); await refresh;
  assert.equal(ctx.storage.getSales('workspace-1').some((row) => row.id === 'new-confirmed'), true);
});

test('reload prefers newer IndexedDB data over stale localStorage after quota failures', async () => {
  const ctx = storageFixture();
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale()], pending: [] });
  await tick(); ctx.setQuota(true);
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale('sale-1', 500)], pending: [{ id: 'sale-1', token: 'latest', kind: 'UPSERT', sale: sale('sale-1', 500) }] });
  await tick();
  const reloaded = new ctx.StorageService();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getSales('workspace-1')[0].amount, 500);
  assert.equal(reloaded.getSalesLocalState('workspace-1').pending[0].token, 'latest');
});

test('a restored memory copy yields to a newer storage event from another tab', async () => {
  const ctx = storageFixture({ quota: true });
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale()], pending: [] }); await tick();
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  ctx.setQuota(false);
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale('sale-1', 500)], pending: [] }); await tick();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getSales('workspace-1')[0].amount, 500);
});

test('failure of both stores is reported; in-memory sales remain available', async () => {
  const ctx = storageFixture({ quota: true, durableFailure: true });
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale()], pending: [] });
  assert.equal(ctx.storage.getPersistenceError(), false, '대체 저장 결과를 기다리는 동안에는 오류를 확정하지 않는다');
  await tick();
  assert.equal(ctx.storage.getPersistenceError(), true);
  assert.equal(ctx.storage.getSales('workspace-1').length, 1);
  ctx.setDurableFailure(false);
  await ctx.storage.restoreWorkspace('workspace-1');
  assert.equal(ctx.storage.getSales('workspace-1').length, 1, '이전 저장본이 메모리의 미저장 판매를 덮으면 안 된다');
  ctx.storage.setWorkspaceId('workspace-2');
  assert.equal(ctx.storage.getPersistenceError(), false);
  assert.equal(ctx.storage.getSales('workspace-2').length, 0);
});

test('comment-only persistence failures are reported and can be retried durably', async () => {
  const ctx = storageFixture({ quota: true, durableFailure: true });
  ctx.storage.addCommentRecords([{ id: 'comment-1', sessionId: 'session-1', nickname: '구매자', content: '저요', capturedAt: sale().recognizedAt }], 'workspace-1');
  await tick();
  assert.equal(ctx.storage.getPersistenceError(), true);
  ctx.setDurableFailure(false); ctx.storage.retryPersistence(); await tick(); await tick();
  assert.equal(ctx.storage.getPersistenceError(), false);
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getCommentRecords('workspace-1').length, 1);
});

test('a restore cannot replace an unsaved in-memory edit with an older IndexedDB sale', async () => {
  const ctx = storageFixture();
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale('sale-1', 100)], pending: [] });
  await tick(); await tick();
  ctx.setDurableFailure(true); ctx.setQuota(true);
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale('sale-1', 500)], pending: [] });
  await tick();
  assert.equal(ctx.storage.getPersistenceError(), true);
  ctx.setDurableFailure(false);
  await ctx.storage.restoreWorkspace('workspace-1');
  assert.equal(ctx.storage.getSales('workspace-1')[0].amount, 500);
});

test('session transcripts survive a full Web Storage quota and reload from IndexedDB', async () => {
  const ctx = storageFixture({ quota: true });
  const rows = [{ id: 'spoken-1', text: '판매 확정', timestamp: '2026-10-01T12:00:00Z', isFinal: true }];
  ctx.storage.saveSessionTranscripts('workspace-1', 'session-1', rows);
  await tick();
  assert.equal(ctx.storage.getPersistenceError(), false);
  const restored = new ctx.StorageService();
  await restored.restoreWorkspace('workspace-1');
  assert.deepEqual(clone(restored.getSessionTranscripts('workspace-1', 'session-1')), rows);
  assert.equal(restored.getTranscriptHistory('workspace-1').length, 1);
});

test('legacy transcript copy moves only after IndexedDB confirms its write', async () => {
  const ctx = storageFixture();
  const key = 'voicecap_transcripts:workspace-1:session-legacy';
  const rows = [{ id: 'legacy-1', text: '옛 판매 멘트', timestamp: '2026-10-01T12:00:00Z', isFinal: true }];
  ctx.local.set(key, JSON.stringify(rows));
  const restored = new ctx.StorageService();
  await restored.restoreWorkspace('workspace-1');
  assert.equal(ctx.local.has(key), false);
  assert.deepEqual(clone(restored.getSessionTranscripts('workspace-1', 'session-legacy')), rows);
  assert.ok(ctx.durable.has(key));
});

test('new workspace records use IndexedDB without filling Web Storage', async () => {
  const ctx = storageFixture();
  const comment = { id: 'comment-1', sessionId: 'session-1', nickname: '구매자', content: '저요', capturedAt: sale().recognizedAt };
  ctx.storage.addCommentRecords([comment], 'workspace-1');
  ctx.storage.saveSalesLocalState('workspace-1', { records: [sale()], pending: [] });
  ctx.storage.saveCommentOutbox('workspace-1', [queued()]);
  await ctx.storage.awaitCommentOutboxPersistence('workspace-1');
  assert.equal([...ctx.local.keys()].some((key) => key.endsWith(':workspace-1')), false);
  const reloaded = new ctx.StorageService();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getCommentRecords('workspace-1').length, 1);
  assert.equal(reloaded.getSales('workspace-1').length, 1);
  assert.equal(reloaded.getCommentOutbox('workspace-1').length, 1);
});

test('old workspace records are removed from Web Storage only after IndexedDB commits', async () => {
  const ctx = storageFixture();
  const key = 'voicecap_comment_records:workspace-1';
  const records = [{ id: 'legacy-comment', sessionId: 'session-1', nickname: '구매자', content: '저요' }];
  ctx.local.set(key, JSON.stringify({ __voicecapRecovery: 1, updatedAt: 50, data: records }));
  const reloaded = new ctx.StorageService();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(ctx.local.has(key), false);
  assert.equal(ctx.durable.get(key).updatedAt, 50);
  assert.deepEqual(clone(reloaded.getCommentRecords('workspace-1')), records);
});

test('failed IndexedDB writes use Web Storage temporarily and migrate after recovery', async () => {
  const ctx = storageFixture({ durableFailure: true });
  const key = 'voicecap_comment_records:workspace-1';
  const records = [{ id: 'fallback-comment', sessionId: 'session-1', nickname: '구매자', content: '저요' }];
  ctx.storage.addCommentRecords(records, 'workspace-1');
  await tick();
  assert.equal(ctx.local.has(key), true);
  assert.equal(ctx.storage.getPersistenceError(), false);
  ctx.setDurableFailure(false);
  const reloaded = new ctx.StorageService();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(ctx.local.has(key), false);
  assert.deepEqual(clone(reloaded.getCommentRecords('workspace-1')), records);
});

test('transcript warning remains when neither IndexedDB nor Web Storage can save', async () => {
  const ctx = storageFixture({ quota: true, durableFailure: true });
  ctx.storage.saveSessionTranscripts('workspace-1', 'session-1', [{ id: 'spoken-1', text: '저장 실패' }]);
  await tick();
  assert.equal(ctx.storage.getPersistenceError(), true);
});

const session1 = '11111111-1111-1111-1111-111111111111';
const session2 = '22222222-2222-2222-2222-222222222222';
const voiceSale = () => ({ ...sale('s-33333333-3333-4333-8333-333333333333', 15000),
  sessionId: session1, purchaseRequestId: `${session1}:message-1`,
  rawTranscript: '햇살언니께 1.5 드리겠습니다', unitPrice: 15000,
  source: 'WEB_VOICE', status: '자동저장', printStatus: 'QUEUED', printRevision: 1,
});

test('voice sale validation identifies malformed IDs, mismatched comments and missing speech separately', () => {
  const valid = voiceSale();
  assert.deepEqual(voiceSaleValidation.invalidVoiceSaleFields(valid.id.slice(2), valid), []);
  for (const [field, value, issue] of [
    ['sessionId', '20261001_01', 'sale.sessionId'],
    ['id', 's-123456', 'sale.id'],
    ['purchaseRequestId', `${session2}:message-1`, 'sale.purchaseRequestId'],
    ['purchaseRequestId', `${session1}:`, 'sale.purchaseRequestId'],
    ['rawTranscript', null, 'sale.rawTranscript'],
  ]) assert.ok(voiceSaleValidation.invalidVoiceSaleFields(valid.id.slice(2), { ...valid, [field]: value }).includes(issue));
  assert.ok(voiceSaleValidation.invalidVoiceSaleFields('123456', valid).includes('operationId'));
});

test('voice sale API returns exact invalid fields before querying the database', async () => {
  const { handleCommitVoiceSale } = load('../supabase/functions/sales-api/handlers/voiceSales.ts', {
    '../../_shared/productSales.ts': {
      admin: { from() { throw new Error('Invalid evidence must not query the database'); } },
      errorResponse: (code, message, status, details) => ({ code, message, status, details }), successResponse: (value) => value,
    },
    '../../../../src/services/priceEvidence.ts': {}, '../../../../src/services/salesExtractor.ts': {},
    '../../../../src/services/purchaseFirstSales.ts': {},
    '../../../../src/services/voiceSaleValidation.ts': voiceSaleValidation,
  });
  const record = { ...voiceSale(), rawTranscript: null };
  const result = await handleCommitVoiceSale('workspace-1', 'actor', { operationId: record.id.slice(2), sale: record });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'VALIDATION_ERROR');
  assert.deepEqual(result.details.invalidFields, ['sale.rawTranscript']);
});

test('normal UUID voice sale evidence reaches the atomic commit and retains its product UUID', async () => {
  const record = { ...voiceSale(), productId: '55555555-5555-4555-8555-555555555555' };
  let committed;
  const comment = { id: '44444444-4444-4444-8444-444444444444', session_id: session1,
    platform_message_id: 'message-1', buyer_id: '66666666-6666-4666-8666-666666666666',
    nickname_snapshot: '햇살', content: 'ㅈㅇ', captured_at: '2026-09-29T00:59:59Z',
  };
  const { handleCommitVoiceSale } = load('../supabase/functions/sales-api/handlers/voiceSales.ts', {
    '../../_shared/productSales.ts': {
      admin: {
        from() { return { select() { return this; }, eq() { return this; }, gte() { return this; }, lte() { return this; },
          async limit() { return { data: [comment], count: 1, error: null }; },
        }; },
        async rpc(_name, args) { committed = args; return { data: { ok: true, saleId: args.p_sale_id }, error: null }; },
      },
      errorResponse: (code, message, status) => ({ code, message, status }), successResponse: (value) => value,
    },
    '../../../../src/services/priceEvidence.ts': priceEvidence,
    '../../../../src/services/salesExtractor.ts': salesExtractor,
    '../../../../src/services/purchaseFirstSales.ts': purchaseFirstSales,
    '../../../../src/services/voiceSaleValidation.ts': voiceSaleValidation,
  });
  const result = await handleCommitVoiceSale('workspace-1', 'actor', { operationId: record.id.slice(2), sale: record });
  assert.equal(result.ok, true, result.message);
  assert.equal(committed.p_session_id, session1);
  assert.equal(committed.p_operation_id, record.id.slice(2));
  assert.equal(committed.p_product_id, record.productId);
  assert.equal(committed.p_request_id, record.purchaseRequestId);
  assert.equal(committed.p_amount, 15000);
});

function voiceRemoteFixture(invoke) {
  return load('../src/services/remoteWorkspaceService.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => ({ functions: { invoke } }) },
    './commerceChanges': {}, './sttVocabularyService': {}, './voiceSaleValidation': voiceSaleValidation,
  }).remoteWorkspaceService;
}

test('invalid voice sale evidence fails locally without sending repeated HTTP 400 requests', async () => {
  let calls = 0;
  const remote = voiceRemoteFixture(async () => { calls++; return { data: { ok: true }, error: null }; });
  await assert.rejects(remote.saveSale('workspace-1', { ...voiceSale(), sessionId: '20261001_01' }), (error) => {
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.retryable, false);
    assert.ok(error.details.invalidFields.includes('sale.sessionId'));
    return true;
  });
  assert.equal(calls, 0);
});

test('server validation is non-retryable while a comment awaiting upload remains retryable', async () => {
  for (const [code, retryable] of [['VALIDATION_ERROR', false], ['COMMENT_NOT_SYNCED', true]]) {
    const remote = voiceRemoteFixture(async () => ({ data: null, error: {
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ ok: false, error: { code, message: '서버 확인 필요', retryable: false } }), { status: code === 'VALIDATION_ERROR' ? 400 : 409 }),
    } }));
    await assert.rejects(remote.saveSale('workspace-1', voiceSale()), (error) => error.code === code && error.retryable === retryable);
  }
});

const queued = (sessionId = session1, platformMessageId = 'message-1') => ({ sessionId, platformMessageId, nickname: '구매자', content: '저요', capturedAt: '2026-09-29T01:00:00Z', ingestSequence: 1 });
const canonical = (item) => ({ ...item, id: '33333333-3333-3333-3333-333333333333', buyerId: '44444444-4444-4444-4444-444444444444', nicknameSnapshot: item.nickname, collectorId: 'collector' });
function commentSyncFixture(ingest, list = async () => { throw new Error('Canonical acknowledgements must not need extra reads'); }) {
  const ctx = storageFixture();
  const api = { ingestComments: ingest, listLiveComments: list };
  const CustomEvent = class extends Event { constructor(name, options) { super(name); this.detail = options.detail; } };
  const sync = load('../src/services/commentSyncService.ts', {
    './productSalesApi': { productSalesApi: api }, './storageService': { storageService: ctx.storage, isTemporarySessionId: ctx.isTemporarySessionId },
  }, { window: ctx.globals.window, CustomEvent });
  return { ...ctx, ...sync };
}

test('canonical comment acknowledgements replace stream IDs and restore verified buyers without another read', async () => {
  let writes = 0;
  const ctx = commentSyncFixture(async (request) => { writes++; return { comments: request.comments.map((item) => canonical({ ...item, sessionId: request.sessionId })) }; });
  ctx.storage.addCommentRecords([{ ...queued(), id: 'stream-message-1', buyerId: null }], 'workspace-1');
  ctx.enqueueCloudComment('workspace-1', queued());
  await ctx.flushPendingComments('workspace-1');
  assert.equal(writes, 1);
  assert.equal(ctx.storage.getCommentRecords('workspace-1')[0].id, canonical(queued()).id);
  assert.equal(ctx.storage.getCommentRecords('workspace-1')[0].buyerId, canonical(queued()).buyerId);
  assert.equal(ctx.storage.getCommentOutbox('workspace-1').length, 0);
});

test('comment upload waits until its IndexedDB outbox write is committed', async () => {
  let ctx;
  ctx = commentSyncFixture(async (request) => {
    assert.equal(ctx.durable.get('voicecap_comment_outbox:workspace-1').data.length, 1);
    return { comments: request.comments.map((item) => canonical({ ...item, sessionId: request.sessionId })) };
  });
  ctx.enqueueCloudComment('workspace-1', queued());
  await ctx.flushPendingComments('workspace-1');
});

test('acknowledged comment evidence survives quota failure and reload with an empty outbox', async () => {
  const ctx = commentSyncFixture(async (request) => ({ comments: request.comments.map((item) => canonical({ ...item, sessionId: request.sessionId })) }));
  ctx.setQuota(true);
  ctx.storage.addCommentRecords([{ ...queued(), id: 'stream-message-1', buyerId: null }], 'workspace-1');
  ctx.enqueueCloudComment('workspace-1', queued()); await ctx.flushPendingComments('workspace-1'); await tick();
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getCommentOutbox('workspace-1').length, 0);
  assert.equal(reloaded.getCommentRecords('workspace-1')[0].id, canonical(queued()).id);
  assert.equal(reloaded.getCommentRecords('workspace-1')[0].buyerId, canonical(queued()).buyerId);
});

test('comment deletion tombstones survive reload and reject stale canonical or provisional records', async () => {
  const ctx = storageFixture({ quota: true });
  const row = { ...queued(), id: canonical(queued()).id };
  ctx.storage.addCommentRecords([row], 'workspace-1');
  ctx.storage.deleteCommentRecords([row.id], 'workspace-1'); await tick();
  const reloaded = new ctx.StorageService(); await reloaded.restoreWorkspace('workspace-1');
  reloaded.addCommentRecords([row, { ...row, id: 'stream-message-1' }], 'workspace-1');
  assert.equal(reloaded.getCommentRecords('workspace-1').length, 0);
  assert.equal(ctx.events.includes('voicecap_comments_deleted'), true);
});

test('old-session comments survive transition and are drained separately from new-session comments', async () => {
  const sessions = [];
  const ctx = commentSyncFixture(async (request) => { sessions.push(request.sessionId); return { comments: request.comments.map((item) => canonical({ ...item, sessionId: request.sessionId })) }; });
  ctx.enqueueCloudComment('workspace-1', queued(session1));
  ctx.enqueueCloudComment('workspace-1', queued(session2));
  await ctx.flushPendingComments('workspace-1');
  assert.deepEqual(sessions, [session1, session2]);
  assert.equal(ctx.storage.getCommentRecords('workspace-1').length, 2);
});

test('a failed comment batch survives reload; provisional sessions do not call Supabase', async () => {
  let writes = 0;
  const ctx = commentSyncFixture(async () => { writes++; throw new Error('offline'); });
  ctx.enqueueCloudComment('workspace-1', queued('temporary-session'));
  await ctx.flushPendingComments('workspace-1');
  assert.equal(writes, 0);
  ctx.promoteCommentOutbox('workspace-1', 'temporary-session', session1);
  await assert.rejects(ctx.flushPendingComments('workspace-1'), /offline/); await tick();
  const reloaded = new ctx.StorageService();
  await reloaded.restoreWorkspace('workspace-1');
  assert.equal(reloaded.getCommentOutbox('workspace-1')[0].sessionId, session1);
});

test('an acknowledgement after account switch updates only its original workspace', async () => {
  const reply = deferred();
  const ctx = commentSyncFixture(() => reply.promise);
  ctx.enqueueCloudComment('workspace-1', queued());
  const pending = ctx.flushPendingComments('workspace-1');
  ctx.storage.setWorkspaceId('workspace-2');
  reply.resolve({ comments: [canonical(queued())] }); await pending;
  assert.equal(ctx.storage.getCommentRecords('workspace-1').length, 1);
  assert.equal(ctx.storage.getCommentRecords('workspace-2').length, 0);
  assert.equal(ctx.storage.getCommentOutbox('workspace-2').length, 0);
});

test('rolling deployment reconciles the old API once after a write', async () => {
  let reads = 0;
  const ctx = commentSyncFixture(async () => ({ acceptedIds: [canonical(queued()).id] }), async () => { reads++; return { comments: [canonical(queued())] }; });
  ctx.enqueueCloudComment('workspace-1', queued()); await ctx.flushPendingComments('workspace-1');
  assert.equal(reads, 1);
  assert.equal(ctx.storage.getCommentOutbox('workspace-1').length, 0);
});

test('duplicate ingestion returns the existing canonical row and buyer ID', async () => {
  const row = { id: canonical(queued()).id, session_id: session1, platform_message_id: 'message-1', buyer_id: canonical(queued()).buyerId, nickname_snapshot: '구매자', content: '저요', captured_at: queued().capturedAt, ingest_sequence: 1 };
  const admin = { from() { return { insert: async () => ({ error: { code: '23505' } }), select() { return this; }, eq() { return this; }, single: async () => ({ data: row, error: null }) }; } };
  const { handleIngestComments } = load('../supabase/functions/sales-api/handlers/comments.ts', {
    '../../_shared/productSales.ts': { admin, successResponse: (data) => data, errorResponse: (code) => { throw new Error(code); } },
    './common.ts': {},
  });
  const reply = await handleIngestComments('workspace-1', 'actor', { sessionId: session1, comments: [queued()] });
  assert.equal(reply.duplicateIds[0], 'message-1');
  assert.equal(reply.comments[0].id, row.id);
  assert.equal(reply.comments[0].buyerId, row.buyer_id);
});

function reactFixture() {
  const cells = [], effects = [];
  let index = 0;
  const depsEqual = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    createContext: () => ({ Provider: 'provider' }), createElement: (_type, props) => ({ props }),
    useRef(value) { const i = index++; cells[i] ||= { current: value }; return cells[i]; },
    useState(initial) { const i = index++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useCallback(callback, deps) { const i = index++; if (!depsEqual(cells[i]?.deps, deps)) cells[i] = { deps, callback }; return cells[i].callback; },
    useEffect(callback, deps) { const i = index++; if (!depsEqual(cells[i]?.deps, deps)) {
      const previous = cells[i]; cells[i] = { deps, cleanup: null };
      effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
    } },
  };
  return { react,
    render(component) { index = 0; const value = component({ children: null }).props.value; effects.splice(0).forEach((effect) => effect()); return value; },
  };
}

test('SalesProvider receives other-tab changes without losing either offline operation', async () => {
  const ctx = storageFixture(), other = new ctx.StorageService(); other.setWorkspaceId('workspace-1');
  const window = { ...ctx.globals.window, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} };
  const remote = { subscribe: () => () => {}, loadSales: async () => [], saveSale: async () => { throw new Error('offline'); } };
  const make = (storage) => {
    const hooks = reactFixture(), { react } = hooks;
    const { SalesProvider } = load('../src/context/SalesContext.tsx', {
      react: { ...react, default: react }, '../services/storageService': { storageService: storage },
      '../services/csvExporter': {}, './AuthContext': { useAuth: () => ({ workspaceId: 'workspace-1', isRemoteAuth: true, user: { id: 'user-1' } }) },
      '../services/remoteWorkspaceService': { remoteWorkspaceService: remote },
      '../services/commentStreamService': {}, '../services/aiSettingsApi': {},
      '../services/salesSyncController': { SalesSyncController },
    }, { window });
    return { render: () => hooks.render(SalesProvider) };
  };
  const first = make(ctx.storage), second = make(other);
  first.render(); second.render(); await tick(); await tick();
  first.render().addSale({ ...sale('unused'), productCode: '1', status: '보류' });
  second.render().addSale({ ...sale('unused'), productCode: '2', status: '보류' });
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(ctx.storage.getSalesLocalState('workspace-1').pending.length, 2);
  assert.equal(first.render().sales.length, 2);
  assert.equal(second.render().sales.length, 2);
});

test('DurableStorage read/write transactions serialize updates from independent instances', async () => {
  const values = new Map(), modes = [];
  let tail = Promise.resolve();
  const database = { transaction(_name, mode = 'readonly') {
    modes.push(mode);
    let finish, completeScheduled = false, aborted = false;
    const finished = new Promise((resolve) => { finish = resolve; });
    const start = tail; tail = finished;
    const staged = new Map();
    const complete = () => {
      if (completeScheduled) return;
      completeScheduled = true;
      queueMicrotask(() => {
        if (aborted) transaction.onabort?.();
        else { for (const [key, value] of staged) values.set(key, value); transaction.oncomplete?.(); }
        finish();
      });
    };
    const transaction = { error: null, abort() { aborted = true; complete(); }, objectStore() { return {
      get(key) { const request = {}; start.then(() => {
        request.result = values.get(key); request.onsuccess?.(); complete();
      }); return request; },
      put(value, key) { staged.set(key, value); start.then(complete); },
    }; } };
    return transaction;
  } };
  const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess(); }); return request; } };
  const { DurableStorage } = load('../src/services/durableStorage.ts', {}, { indexedDB });
  const first = new DurableStorage(), second = new DurableStorage();
  await Promise.all([
    first.update('workspace-1', (state) => [...(state || []), 'operation-A']),
    second.update('workspace-1', (state) => [...(state || []), 'operation-B']),
  ]);
  assert.deepEqual(JSON.parse(values.get('workspace-1')), ['operation-A', 'operation-B']);
  assert.deepEqual(modes, ['readwrite', 'readwrite']);
  await assert.rejects(first.update('workspace-1', () => { throw new Error('aborted write'); }), /aborted write/);
  assert.deepEqual(JSON.parse(values.get('workspace-1')), ['operation-A', 'operation-B']);
});

function providerFixture({ bootstrapApi, hydrate = async (path) => path, feedApi, flush = async () => {} } = {}) {
  const hooks = reactFixture(), { react } = hooks;
  const intervals = new Map(), writes = [];
  let timer = 0;
  let auth = { workspaceId: 'workspace-1', user: { id: 'user-1' }, isAuthenticated: true };
  let currentData = { workspaceId: 'workspace-1', settings: { revision: 1 }, activeSession: { id: session1, revision: 1 }, activeProduct: { id: 'product-1', imagePath: 'image-1', revision: 1, salesRevision: 1 }, permissions: [], printerStatus: {} };
  let comments = [];
  let feedCalls = 0;
  const storage = {
    setWorkspaceId() {}, getSessionSalesSummary: () => ({ summary: { sessionAmount: 0, sessionQuantity: 0 }, buyerStats: {} }),
    getSessionCommentRecords: () => comments, getCommentRecords: () => comments,
    saveActiveProduct: (product, owner) => writes.push({ kind: 'product', product, owner }),
    saveActiveSession: (session, owner) => writes.push({ kind: 'session', session, owner }),
    saveBootstrapCache: (bootstrap, owner) => writes.push({ kind: 'bootstrap', bootstrap, owner }),
    getBootstrapCache: () => null, addCommentRecords() {},
    deleteCommentRecords: (ids, owner) => {
      if (ids.length) { comments = comments.filter((comment) => !ids.includes(comment.id)); writes.push({ kind: 'deletedComments', ids, owner }); }
    },
  };
  const emptyFeed = () => ({ comments: [], activeProduct: currentData.activeProduct, sessionRevision: currentData.activeSession.revision });
  const api = {
    getBootstrap: bootstrapApi || (async () => currentData),
    getSalesFeed: async (params) => { feedCalls++; return await (feedApi ? feedApi(params) : emptyFeed()); },
    commitSales: async (request) => { writes.push({ kind: 'saleRequest', request }); return { sales: [], status: 'SUCCEEDED' }; },
  };
  const window = {
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => ++timer, clearTimeout() {},
    setInterval: (fn, ms) => { const id = ++timer; intervals.set(id, { fn, ms }); return id; },
    clearInterval: (id) => intervals.delete(id),
  };
  const { ProductSalesProvider } = load('../src/context/ProductSalesContext.tsx', {
    react: { ...react, default: react }, 'react-router-dom': { useLocation: () => ({ pathname: '/live' }) },
    '../services/productSalesApi': { productSalesApi: api }, '../services/storageService': { storageService: storage },
    '../services/remoteWorkspaceService': { resolvePrivateImageUrl: hydrate },
    '../services/productImageService': {}, './AuthContext': { useAuth: () => auth },
    './SalesContext': { useSales: () => ({ applyCommittedSales: (_owner, rows) => writes.push({ kind: 'confirmed', rows }) }) },
    '../services/commentSyncService': { flushPendingComments: flush },
    '../services/voiceSaleCandidate': { VoiceCandidateController: class { cancel() {} }, parseVoiceCommand() {} },
  }, { window });
  return {
    writes, api, intervals,
    setAuth(next) { auth = next; }, setData(next) { currentData = next; }, data: () => currentData,
    setComments(next) { comments = next; }, feedCalls: () => feedCalls,
    render: () => hooks.render(ProductSalesProvider),
  };
}

test('account switch during image hydration discards the entire old bootstrap', async () => {
  const hydration = deferred(), newBootstrap = deferred();
  let first = true;
  const ctx = providerFixture({ hydrate: () => hydration.promise, bootstrapApi: async () => first ? ctx.data() : await newBootstrap.promise });
  ctx.render(); await tick();
  first = false;
  ctx.setAuth({ workspaceId: 'workspace-2', user: { id: 'user-2' }, isAuthenticated: true });
  ctx.render(); hydration.resolve('signed-old-image'); await tick();
  assert.equal(ctx.writes.length, 0);
  assert.equal(ctx.render().activeProduct, null);
});

test('a new bootstrap with no active product clears the old product and offline cache', async () => {
  const ctx = providerFixture(); ctx.render(); await tick();
  const before = ctx.render(); assert.equal(before.activeProduct.id, 'product-1');
  ctx.setData({ ...ctx.data(), activeSession: { id: session2, revision: 1 }, activeProduct: null });
  await before.loadBootstrap();
  const after = ctx.render();
  assert.equal(after.activeProduct, null);
  assert.equal(after.feed.activeProduct, null);
  assert.equal(ctx.writes.filter((row) => row.kind === 'bootstrap').at(-1).bootstrap.activeProduct, null);
});

test('two-second local feed refresh performs zero additional Supabase requests', async () => {
  const ctx = providerFixture(); ctx.render(); await tick(); const value = ctx.render();
  const initialCalls = ctx.feedCalls();
  for (let i = 0; i < 20; i++) await value.pollFeed();
  assert.equal(ctx.feedCalls(), initialCalls);
});

test('heartbeat null product is applied, but a late heartbeat cannot overwrite a newer session', async () => {
  const response = deferred(); let heartbeat = false;
  const ctx = providerFixture({ feedApi: async () => heartbeat ? await response.promise : { comments: [], sessionRevision: 1, activeProduct: ctx.data().activeProduct } });
  ctx.render(); await tick();
  const value = ctx.render(); value.setFeedPollingEnabled(true); ctx.render();
  heartbeat = true;
  const timer = [...ctx.intervals.values()].find((item) => item.ms === 60_000);
  timer.fn(); await tick();
  ctx.setData({ ...ctx.data(), activeSession: { id: session2, revision: 1 }, activeProduct: null });
  // The bootstrap's own initial feed is also in flight; it is irrelevant to product clearing.
  const reload = value.loadBootstrap(); await tick();
  response.resolve({ comments: [], sessionRevision: 10, activeProduct: { ...ctx.data().activeProduct, id: 'stale-product' } });
  await reload; await tick();
  const after = ctx.render();
  assert.equal(after.activeSession.id, session2);
  assert.equal(after.activeProduct, null);
  assert.equal(ctx.writes.some((row) => row.kind === 'product' && row.product?.id === 'stale-product'), false);
});

test('non-2xx permission errors keep their code so bootstrap cannot masquerade as offline success', async () => {
  const { productSalesApi } = load('../src/services/productSalesApi.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => ({ functions: { invoke: async () => ({ data: null, error: { message: 'Forbidden', context: new Response(JSON.stringify({ ok: false, error: { code: 'CAPABILITY_DENIED', message: '권한 없음' } }), { status: 403 }) } }) } }) },
  });
  await assert.rejects(productSalesApi.getBootstrap('workspace-1'), (error) => error.code === 'CAPABILITY_DENIED');
});

test('a same-workspace remount serializes writes and an obsolete acknowledgement cannot rewrite storage', async () => {
  const response = deferred();
  const first = controller({ scope: 'shared-workspace', save: () => response.promise });
  first.sync.upsert(sale()); await tick();
  first.deactivate();
  const second = controller({ scope: 'shared-workspace', state: first.state() });
  second.sync.upsert(sale('sale-1', 700)); await tick();
  assert.equal(second.saved.length, 0);
  response.resolve(); await first.sync.flush(); await second.sync.flush();
  assert.equal(first.state().pending.length, 1); // No stale publish after the identity changed.
  assert.equal(second.saved[0].amount, 700);
  assert.equal(second.state().records[0].amount, 700);
});

test('heartbeat with no active product clears the product rather than retaining an old one', async () => {
  let heartbeat = false;
  const ctx = providerFixture({ feedApi: async () => ({ comments: [], sessionRevision: 2, activeProduct: heartbeat ? null : ctx.data().activeProduct }) });
  ctx.render(); await tick(); const before = ctx.render();
  before.setFeedPollingEnabled(true); ctx.render(); heartbeat = true;
  [...ctx.intervals.values()].find((item) => item.ms === 60_000).fn(); await tick();
  assert.equal(ctx.render().activeProduct, null);
  assert.equal(ctx.writes.filter((row) => row.kind === 'bootstrap').at(-1).bootstrap.activeProduct, null);
});

test('heartbeat reconciles explicit comment deletions without discarding older comments outside its latest page', async () => {
  const deleted = canonical(queued()), retained = { ...canonical(queued(session1, 'message-2')), id: '55555555-5555-5555-5555-555555555555' };
  let heartbeat = false, requested;
  const ctx = providerFixture({ feedApi: async (params) => {
    requested = params;
    return { comments: [], deletedCommentIds: heartbeat ? [deleted.id] : [], sessionRevision: 1, activeProduct: ctx.data().activeProduct };
  } });
  ctx.setComments([deleted, retained]); ctx.render(); await tick();
  const before = ctx.render(); assert.equal(before.feed.comments.length, 2);
  before.setFeedPollingEnabled(true); ctx.render(); heartbeat = true;
  [...ctx.intervals.values()].find((item) => item.ms === 60_000).fn(); await tick();
  assert.equal(requested.knownCommentIds.length, 2);
  const after = ctx.render();
  assert.equal(after.feed.comments.length, 1);
  assert.equal(after.feed.comments[0].id, retained.id);
  assert.equal(ctx.writes.filter((row) => row.kind === 'deletedComments').at(-1).owner, 'workspace-1');
});

test('comment capture removes deleted rows and does not resurrect them from a stale feed', async () => {
  const ctx = storageFixture(), hooks = reactFixture(), { react } = hooks;
  const row = { ...canonical(queued()), nickname: '구매자' };
  ctx.storage.addCommentRecords([row], 'workspace-1');
  let feed = { comments: [row] };
  const commentTypes = load('../src/types/comment.ts');
  const stream = { onStatus: () => () => {}, onComment: () => () => {}, connect() {}, stopCollecting() {}, disconnect() {} };
  const { CommentCaptureProvider } = load('../src/context/CommentCaptureContext.tsx', {
    react: { ...react, default: react }, 'lucide-react': {},
    './AuthContext': { useAuth: () => ({ workspaceId: 'workspace-1' }) },
    './LiveContext': { useLive: () => ({ isListening: false, currentSessionId: session1, transcriptLogs: [] }) },
    './ProductSalesContext': { useProductSales: () => ({ activeSession: { id: session1 }, feed, pollFeed: async () => {} }) },
    '../services/storageService': { storageService: ctx.storage, isTemporarySessionId: ctx.isTemporarySessionId },
    '../services/remoteWorkspaceService': { remoteWorkspaceService: { loadCommentCaptureConfig: async () => null, saveCommentCaptureConfig: async () => {} } },
    '../services/commentSyncService': { flushPendingComments: async () => {}, promoteCommentOutbox() {} },
    '../services/commentStreamService': { commentStreamService: stream }, '../types/comment': commentTypes,
    '../services/purchaseFirstSales': { purchaseRequestFromComment: () => null, commentWithdrawsPurchase: () => false },
  }, { window: { ...ctx.globals.window, setTimeout: () => 1, clearTimeout() {} } });
  hooks.render(CommentCaptureProvider); await tick();
  assert.equal(hooks.render(CommentCaptureProvider).liveComments.length, 1);
  ctx.storage.deleteCommentRecords([row.id], 'workspace-1');
  assert.equal(hooks.render(CommentCaptureProvider).liveComments.length, 0);
  feed = { comments: [row] }; hooks.render(CommentCaptureProvider);
  assert.equal(hooks.render(CommentCaptureProvider).liveComments.length, 0);
});

test('feed deletion reconciliation checks known IDs in scope and keeps older existing rows outside the newest page', async () => {
  const existingId = canonical(queued()).id, deletedId = '55555555-5555-5555-5555-555555555555';
  const probes = [];
  const admin = { from(table) {
    const filters = [];
    return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, order() { return this; },
      single: async () => ({ data: { id: session1, revision: 1, active_product_id: null } }),
      limit: async () => ({ data: [], error: null }),
      async in(key, ids) { probes.push({ table, key, ids, filters }); return { data: [{ id: existingId }], error: null }; },
    };
  } };
  const { handleGetSalesFeed } = load('../supabase/functions/sales-api/handlers/comments.ts', {
    '../../_shared/productSales.ts': { admin, successResponse: (data) => data, errorResponse: (code) => { throw new Error(code); } },
    './common.ts': { calculateSummary: async () => ({}), calculateBuyerStats: async () => ({}) },
  });
  const response = await handleGetSalesFeed('workspace-1', { sessionId: session1, knownCommentIds: [existingId, deletedId, 'stream-message-1'] });
  assert.deepEqual(clone(response.deletedCommentIds), [deletedId]);
  assert.deepEqual(probes[0].filters, [['workspace_id', 'workspace-1'], ['session_id', session1]]);
  assert.equal(probes[0].ids.length, 2);
});

test('failed deletion probes cannot be interpreted as successful deletion', async () => {
  const admin = { from() { return { select() { return this; }, eq() { return this; }, order() { return this; },
    single: async () => ({ data: { revision: 1 } }), limit: async () => ({ data: [], error: null }),
    in: async () => ({ data: null, error: { message: 'offline' } }),
  }; } };
  const { handleGetSalesFeed } = load('../supabase/functions/sales-api/handlers/comments.ts', {
    '../../_shared/productSales.ts': { admin, successResponse: (data) => data, errorResponse: (code) => { throw new Error(code); } },
    './common.ts': {},
  });
  await assert.rejects(handleGetSalesFeed('workspace-1', { sessionId: session1, knownCommentIds: [canonical(queued()).id] }), /DATABASE_ERROR/);
});

test('selecting a provisional comment waits for acknowledgement and sends canonical IDs to commitSales', async () => {
  const ctx = providerFixture({ flush: async () => ctx.setComments([{ ...queued(), ...canonical(queued()) }]) });
  ctx.render(); await tick(); const value = ctx.render();
  await value.commitSales([{ buyerId: '구매자', quantity: 1, sourceCommentIds: ['stream-message-1'] }]);
  const request = ctx.writes.find((row) => row.kind === 'saleRequest').request;
  assert.equal(request.buyers[0].buyerId, canonical(queued()).buyerId);
  assert.equal(request.buyers[0].sourceCommentIds[0], canonical(queued()).id);
});

test('session statistics and lifetime buyer statistics are computed over their respective scopes', () => {
  const ctx = storageFixture();
  ctx.storage.saveSalesLocalState('workspace-1', { records: [
    { ...sale('sale-1', 100), buyerId: 'buyer-1', quantity: 2 },
    { ...sale('sale-2', 400), buyerId: 'buyer-1', sessionId: 'older-session' },
    { ...sale('cancelled', 900), buyerId: 'buyer-1', recordState: 'CANCELLED' },
    { ...sale('pending', 900), buyerId: 'buyer-1', status: '보류' },
  ], pending: [] });
  const { summary, buyerStats } = ctx.storage.getSessionSalesSummary('session-1', 'workspace-1');
  assert.equal(summary.sessionQuantity, 2);
  assert.equal(summary.sessionAmount, 100);
  assert.equal(buyerStats['buyer-1'].totalPurchaseCount, 2);
  assert.equal(buyerStats['buyer-1'].totalPurchaseAmount, 500);
});

test('bootstrap sale loading paginates beyond the PostgREST row cap', async () => {
  const requested = [];
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: `sale-${index}`, amount: 1, capture_image_paths: [] }));
  const client = { from() { return { select() { return this; }, eq() { return this; }, order() { return this; },
    async range(from, to) { requested.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; },
  }; } };
  const { remoteWorkspaceService } = load('../src/services/remoteWorkspaceService.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => client }, './commerceChanges': {},
    './sttVocabularyService': { normalizeSttVocabulary: (words) => words },
    './voiceSaleValidation': voiceSaleValidation,
  });
  const loaded = await remoteWorkspaceService.loadSales('workspace-1');
  assert.equal(loaded.length, 1001);
  assert.deepEqual(requested, [[0, 999], [1000, 1999]]);
});
