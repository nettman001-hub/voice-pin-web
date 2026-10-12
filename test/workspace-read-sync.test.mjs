import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createWorkspaceReadSync } from '../src/services/workspaceReadSync.ts';
import * as commerceChanges from '../src/services/commerceChanges.ts';

const tick = () => new Promise(setImmediate);
const empty = () => ({ messages: [], claims: [], invoices: [], payments: [], shipments: [], verifiedSaleIds: [] });
const clone = (value) => JSON.parse(JSON.stringify(value));
function load(path, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, crypto, console, ...globals,
    require(name) { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name]; },
  }, { filename: path });
  return module.exports;
}
const { SalesSyncController } = load('../src/services/salesSyncController.ts');

function clientFixture({ autoSubscribe = true } = {}) {
  const calls = [], channels = [], removed = [];
  const rows = {
    customer_messages: [{ id: 'message-1', body: '주소', sale_ids: [], attachments: [], created_at: '2026-10-01' }],
    purchase_claims: [], payment_receipts: [], invoices: [], shipments: [], verified_sales: [{ sale_id: 'sale-1' }],
  };
  let failure, release;
  const client = {
    from(table) {
      calls.push(table);
      const query = {
        select() { return this; }, eq(column, value) { assert.equal(column, 'workspace_id'); assert.equal(value, 'workspace-1'); return this; },
        order() { return this; },
        then(resolve, reject) {
          const result = { data: clone(rows[table] || []), error: failure?.table === table ? failure.error : null };
          const complete = () => resolve(result);
          if (release) release.push(complete); else complete();
          return Promise.resolve().then(() => undefined).catch(reject);
        },
      };
      return query;
    },
    channel() {
      const channel = {
        bindings: [],
        on(_type, filter, callback) { this.bindings.push({ filter, callback }); return this; },
        subscribe(callback) { this.status = callback; if (autoSubscribe) callback('SUBSCRIBED'); return this; },
        emit(table, eventType, row) {
          const binding = this.bindings.find((item) => item.filter.table === table && item.filter.event === eventType);
          assert.ok(binding, `${table} ${eventType} must be subscribed`);
          binding.callback({ eventType, new: eventType === 'DELETE' ? {} : row, old: eventType === 'DELETE' ? row : {} });
        },
      };
      channels.push(channel); return channel;
    },
    removeChannel(channel) { removed.push(channel); return Promise.resolve(); },
  };
  const module = load('../src/services/remoteWorkspaceService.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => client },
    './commerceChanges': commerceChanges, './sttVocabularyService': {}, './voiceSaleValidation': {}, './paymentMatching': {},
    '../utils/textCleaner': { cleanMessageBody: (body) => body },
  });
  return { ...module, calls, channels, removed, rows,
    fail(table, error) { failure = { table, error }; }, clearFailure() { failure = null; },
    defer() { release = []; }, release() { const callbacks = release; release = null; callbacks.forEach((callback) => callback()); },
  };
}

test('commerce boot reads six tables once; an invoice event reads only invoices', async () => {
  const fixture = clientFixture();
  const initial = await fixture.remoteWorkspaceService.loadCommerce('workspace-1');
  assert.equal(fixture.calls.length, 6);
  assert.deepEqual(clone(initial.verifiedSaleIds), ['sale-1']);
  fixture.calls.length = 0;
  const patch = await fixture.remoteWorkspaceService.loadCommerceTables('workspace-1', ['invoices', 'invoices']);
  assert.deepEqual(fixture.calls, ['invoices']);
  assert.deepEqual(Object.keys(patch), ['invoices']);
  assert.equal('messages' in patch, false);
});

test('overlapping table reads reuse the in-flight request, then fresh invalidations read again', async () => {
  const fixture = clientFixture(); fixture.defer();
  const one = fixture.remoteWorkspaceService.loadCommerceTables('workspace-1', ['invoices']);
  const two = fixture.remoteWorkspaceService.loadCommerceTables('workspace-1', ['invoices']);
  await tick();
  assert.deepEqual(fixture.calls, ['invoices']);
  fixture.release(); await Promise.all([one, two]);
  await fixture.remoteWorkspaceService.loadCommerceTables('workspace-1', ['invoices']);
  assert.deepEqual(fixture.calls, ['invoices', 'invoices']);
});

test('failed authorization does not retry or publish empty history', async () => {
  const fixture = clientFixture(); fixture.fail('payment_receipts', { code: '42501', message: 'denied' });
  await assert.rejects(fixture.remoteWorkspaceService.loadCommerceTables('workspace-1', ['payment_receipts']), (error) => error.code === '42501');
  assert.deepEqual(fixture.calls, ['payment_receipts']);
});

test('sales and commerce share one channel but unrelated events do not trigger sales', () => {
  const fixture = clientFixture(), sales = [], commerce = [];
  const stopSales = fixture.remoteWorkspaceService.subscribe('workspace-1', (change) => sales.push(change), { tables: ['sales', 'buyer_promise_defaults'] });
  const stopCommerce = fixture.remoteWorkspaceService.subscribe('workspace-1', (change) => commerce.push(change), { tables: fixture.COMMERCE_TABLES });
  assert.equal(fixture.channels.length, 1);
  const channel = fixture.channels[0];
  channel.emit('customer_messages', 'INSERT', { workspace_id: 'workspace-1', id: 'message-2' });
  channel.emit('verified_sales', 'DELETE', { workspace_id: 'workspace-1', sale_id: 'sale-1' });
  assert.equal(sales.length, 0);
  assert.deepEqual(commerce.map((change) => change.table), ['customer_messages', 'verified_sales']);
  channel.emit('sales', 'UPDATE', { workspace_id: 'workspace-1', id: 'sale-1' });
  assert.equal(sales.length, 1);
  channel.emit('shipments', 'DELETE', { workspace_id: 'another-workspace', id: 'foreign' });
  assert.equal(commerce.length, 2);
  assert.equal(channel.bindings.find((binding) => binding.filter.table === 'verified_sales' && binding.filter.event === 'DELETE').filter.filter, undefined);
  stopSales(); assert.equal(fixture.removed.length, 0);
  stopCommerce(); assert.equal(fixture.removed.length, 1);
});

test('recovery requests join a running snapshot, while newer table events get one follow-up read', async () => {
  let release; const first = new Promise((resolve) => { release = resolve; });
  const calls = [], applied = [];
  const sync = createWorkspaceReadSync({ tables: ['messages', 'invoices'], available: () => true,
    load: async (tables) => { calls.push(tables); if (calls.length === 1) await first; return tables; }, apply: (value) => applied.push(value) });
  const pending = sync.request();
  assert.equal(sync.request(), pending);
  sync.request(['messages'], true); sync.request(['messages'], true);
  release(); await pending;
  assert.deepEqual(calls, [['messages', 'invoices'], ['messages']]);
  assert.equal(applied.length, 2);
});

test('hidden/offline screens queue invalidation without calls and reconcile on return', async () => {
  let available = false; const calls = [];
  const sync = createWorkspaceReadSync({ tables: ['messages', 'invoices'], available: () => available,
    load: async (tables) => { calls.push(tables); return tables; }, apply() {} });
  assert.equal(await sync.request(['messages'], true), false);
  assert.deepEqual(calls, []);
  available = true; await sync.request();
  assert.deepEqual(calls, [['messages', 'invoices']]);
  sync.dispose(); await sync.request(); assert.equal(calls.length, 1);
});

test('failed sync retains previous state and retries only after a later recovery request', async () => {
  let failure = true, count = 0, state = 'old';
  const sync = createWorkspaceReadSync({ tables: ['messages'], available: () => true,
    load: async () => { count++; if (failure) throw new Error('offline'); return 'new'; }, apply: (value) => { state = value; } });
  assert.equal(await sync.request(), false); assert.equal(count, 1); assert.equal(state, 'old');
  failure = false; await sync.request(); assert.equal(count, 2); assert.equal(state, 'new');
});

test('a table patch reflects remote edits/deletes while preserving other tables and local in-flight changes', () => {
  const before = { ...empty(), invoices: [{ id: 'i1', amount: 1 }, { id: 'i2', amount: 2 }],
    shipments: [{ id: 'shipment-old', status: 'SHIPPED' }], verifiedSaleIds: ['sale-1'] };
  const current = { ...before, invoices: [{ id: 'i1', amount: 99 }, { id: 'i2', amount: 2 }, { id: 'i-local', amount: 10 }],
    verifiedSaleIds: ['sale-local'] };
  const next = commerceChanges.mergeRemoteCommerce(current, before, { invoices: [{ id: 'i1', amount: 20 }, { id: 'i3', amount: 30 }], verifiedSaleIds: ['sale-1', 'sale-remote'] });
  assert.deepEqual(next.invoices, [{ id: 'i1', amount: 99 }, { id: 'i3', amount: 30 }, { id: 'i-local', amount: 10 }]);
  assert.equal(next.shipments, before.shipments);
  assert.deepEqual(next.verifiedSaleIds, ['sale-remote', 'sale-local']);
});

function providerFixture(remote, { ready = false } = {}) {
  const effects = [], timeouts = new Map(), intervals = new Map(), listeners = new Map();
  const document = { visibilityState: 'visible', addEventListener(name, callback) { listeners.set(`document:${name}`, callback); }, removeEventListener() {} };
  const navigator = { onLine: true };
  let id = 0, stateIndex = 0, state = empty();
  const scheduledTimeouts = [];
  const window = {
    setTimeout(callback, ms) { const key = ++id; scheduledTimeouts.push(key); timeouts.set(key, { callback, ms }); return key; }, clearTimeout(key) { timeouts.delete(key); },
    setInterval(callback, ms) { const key = ++id; intervals.set(key, { callback, ms }); return key; }, clearInterval(key) { intervals.delete(key); },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener() {},
  };
  const react = {
    createContext: () => ({ Provider: 'provider' }), createElement: (_type, props) => ({ props }),
    useRef: (current) => ({ current }), useCallback: (callback) => callback, useMemo: (factory) => factory(),
    useState: (value) => [ready && stateIndex++ === 4 ? true : typeof value === 'function' ? value() : value, () => {}], useEffect: (effect) => { effects.push(effect); },
  };
  const syncModule = load('../src/services/workspaceReadSync.ts', {}, { document, navigator });
  const { CommerceProvider } = load('../src/context/CommerceContext.tsx', {
    react: { ...react, default: react }, './AuthContext': { useAuth: () => ({ user: { id: 'user-1' }, workspaceId: 'workspace-1', isRemoteAuth: true }) },
    './SalesContext': { useSales: () => ({ sales: [] }) }, '../services/customerMessageParser': {},
    '../services/smsBridgeService': { smsBridgeService: { getConfig: () => ({ sellerId: 'workspace-1' }) } },
    '../services/storageService': { storageService: { getCommerceState: () => state, saveCommerceState: (value) => { state = value; } } },
    '../services/remoteWorkspaceService': remote, '../services/commerceChanges': commerceChanges,
    '../services/workspaceReadSync': syncModule, '../services/paymentMatching': {},
  }, { window, document });
  const value = CommerceProvider({ children: null }).props.value;
  const cleanups = effects.map((effect) => effect());
  return { value, intervals, document, navigator, scheduledTimeouts, state: () => state,
    event(name) { listeners.get(name)?.(); },
    flushEvents() { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach(({ callback }) => callback()); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

test('remote provider has no 15-second polling: idle reads zero, table events and reconnect work', async () => {
  const remote = clientFixture(), fixture = providerFixture(remote);
  await tick(); await tick();
  assert.equal(remote.calls.length, 6);
  assert.equal([...fixture.intervals.values()].some(({ ms }) => ms === 15_000), false);
  remote.calls.length = 0;
  for (let i = 0; i < 10; i++) for (const { callback } of fixture.intervals.values()) callback();
  await tick(); assert.deepEqual(remote.calls, []);
  remote.rows.verified_sales = [];
  remote.channels[0].emit('verified_sales', 'DELETE', { sale_id: 'sale-1' });
  fixture.flushEvents(); await tick(); await tick();
  assert.deepEqual(remote.calls, ['verified_sales']);
  assert.deepEqual(clone(fixture.state().verifiedSaleIds), []);
  remote.calls.length = 0;
  fixture.document.visibilityState = 'hidden';
  remote.channels[0].emit('customer_messages', 'UPDATE', { workspace_id: 'workspace-1', id: 'message-1' });
  fixture.flushEvents(); await tick(); assert.deepEqual(remote.calls, []);
  fixture.document.visibilityState = 'visible'; fixture.event('document:visibilitychange');
  await tick(); await tick(); assert.equal(remote.calls.length, 6);
  remote.calls.length = 0;
  remote.channels[0].status('CHANNEL_ERROR'); remote.channels[0].status('SUBSCRIBED');
  await tick(); await tick(); assert.equal(remote.calls.length, 6);
  fixture.dispose(); assert.equal(remote.removed.length, 1);
});

test('first subscription ACK repairs message/payment inserts and a deletion missed after initial REST', async () => {
  const remote = clientFixture({ autoSubscribe: false }), fixture = providerFixture(remote);
  await tick(); await tick();
  assert.equal(remote.calls.length, 6);
  assert.deepEqual(clone(fixture.state().verifiedSaleIds), ['sale-1']);
  // No Realtime callbacks are delivered while the socket is still connecting.
  remote.rows.customer_messages.push({ id: 'message-gap', body: '뒤늦은 주소', sale_ids: [], attachments: [], created_at: '2026-10-02' });
  remote.rows.payment_receipts.push({ id: 'payment-gap', payer_name: '구매자', amount: 10000, sale_ids: ['sale-1'], match_status: 'MATCHED' });
  remote.rows.verified_sales = [];
  remote.channels[0].status('SUBSCRIBED');
  await tick(); await tick();
  assert.equal(remote.calls.length, 12, 'One extra initial repair snapshot closes the subscription gap');
  assert.equal(fixture.state().messages.some((row) => row.id === 'message-gap'), true);
  assert.equal(fixture.state().payments.some((row) => row.id === 'payment-gap'), true);
  assert.deepEqual(clone(fixture.state().verifiedSaleIds), []);
  remote.calls.length = 0;
  for (const { callback } of fixture.intervals.values()) callback();
  await tick(); assert.deepEqual(remote.calls, [], 'Healthy idle must return to zero polling');
  fixture.dispose();
});

test('initial REST failure gets slow repair even with a healthy Realtime subscription', async () => {
  const remote = clientFixture(); remote.fail('payment_receipts', { code: 'XX000', message: 'temporary 500' });
  const fixture = providerFixture(remote);
  await tick(); await tick();
  assert.equal(remote.calls.length, 6);
  remote.clearFailure(); remote.calls.length = 0;
  for (const { callback } of fixture.intervals.values()) callback();
  await tick(); await tick();
  assert.equal(remote.calls.length, 6);
  assert.deepEqual(clone(fixture.state().verifiedSaleIds), ['sale-1']);
  remote.calls.length = 0;
  for (const { callback } of fixture.intervals.values()) callback();
  await tick(); assert.deepEqual(remote.calls, [], 'A successful repair clears the failure condition');
  fixture.dispose();
});

test('failed event read preserves history and repairs at the fallback interval without another event', async () => {
  const remote = clientFixture(), fixture = providerFixture(remote);
  await tick(); await tick();
  const oldBody = fixture.state().messages[0].body;
  remote.rows.customer_messages[0].body = '은행·주소 확인 완료';
  remote.fail('customer_messages', { code: 'XX000', message: 'temporary 500' });
  remote.calls.length = 0;
  remote.channels[0].emit('customer_messages', 'UPDATE', { workspace_id: 'workspace-1', id: 'message-1' });
  fixture.flushEvents(); await tick(); await tick();
  assert.deepEqual(remote.calls, ['customer_messages']);
  assert.equal(fixture.state().messages[0].body, oldBody);
  remote.clearFailure(); remote.calls.length = 0;
  for (const { callback } of fixture.intervals.values()) callback();
  await tick(); await tick();
  assert.equal(fixture.state().messages[0].body, '은행·주소 확인 완료');
  assert.equal(remote.calls.length, 6);
  remote.calls.length = 0;
  for (const { callback } of fixture.intervals.values()) callback();
  await tick(); assert.deepEqual(remote.calls, []);
  fixture.dispose();
});

function salesProviderFixture({ autoSubscribe = false, deferredReads = false } = {}) {
  const effects = [], intervals = [], timeouts = [], calls = [];
  const rows = [{ id: 'sale-1', sessionId: 'session-1', buyerNickname: '구매자', amount: 100,
    status: '확정', recognizedAt: '2026-10-12', revision: 1, syncStatus: 'SYNCED' }];
  let local = { records: [], pending: [] }, decisions = [], failure = false, listener, onStatus;
  let readReleases = deferredReads ? [] : null;
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const navigator = { onLine: true };
  const window = {
    setTimeout(callback) { timeouts.push(callback); return timeouts.length; }, clearTimeout() {},
    setInterval(callback, ms) { intervals.push({ callback, ms }); return intervals.length; }, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
  };
  const react = {
    createContext: () => ({ Provider: 'provider' }), createElement: (_type, props) => ({ props }),
    useRef: (current) => ({ current }), useCallback: (callback) => callback, useMemo: (factory) => factory(),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}], useEffect: (effect) => { effects.push(effect); },
  };
  const storageService = {
    getSales: () => local.records, getSalesLocalState: () => local, saveSalesLocalState: (_workspace, value) => { local = value; },
    updateSalesLocalState: async (_workspace, change) => { local = change(local); return local; },
    restoreWorkspace: async () => {}, getPromiseDefaults: () => decisions, savePromiseDefaults: (value) => { decisions = value; },
  };
  const remoteWorkspaceService = {
    async loadSales() {
      calls.push('sales'); if (failure) throw new Error('temporary 500');
      const snapshot = clone(rows);
      if (readReleases) await new Promise((resolve) => readReleases.push(resolve));
      return snapshot;
    },
    async loadPromiseDefaults() { calls.push('buyer_promise_defaults'); return []; },
    subscribe(_workspace, callback, options) { listener = callback; onStatus = options.onStatus; if (autoSubscribe) onStatus('SUBSCRIBED'); return () => {}; },
  };
  const syncModule = load('../src/services/workspaceReadSync.ts', {}, { document, navigator });
  const { SalesProvider } = load('../src/context/SalesContext.tsx', {
    react: { ...react, default: react }, '../services/storageService': { storageService },
    '../services/csvExporter': {}, './AuthContext': { useAuth: () => ({ workspaceId: 'workspace-1', user: { id: 'user-1' }, isRemoteAuth: true }) },
    '../services/remoteWorkspaceService': { remoteWorkspaceService }, '../services/commentStreamService': {}, '../services/aiSettingsApi': {},
    '../services/salesSyncController': { SalesSyncController }, '../services/workspaceReadSync': syncModule,
  }, { window, document });
  SalesProvider({ children: null });
  const cleanup = effects.map((effect) => effect());
  return { calls, rows, state: () => local, status: (value) => onStatus(value), scheduledTimeouts: timeouts,
    event: (change) => listener(change), fail: (value) => { failure = value; },
    flushEvents() { timeouts.splice(0).forEach((callback) => callback()); },
    releaseReads() { const callbacks = readReleases; readReleases = null; callbacks.forEach((callback) => callback()); },
    fallback() { intervals.filter(({ ms }) => ms === 5 * 60_000).forEach(({ callback }) => callback()); },
    dispose() { cleanup.forEach((callback) => callback?.()); },
  };
}

test('first sales subscription ACK repairs updates/deletes missed after initial REST', async () => {
  const fixture = salesProviderFixture(); await tick(); await tick();
  assert.equal(fixture.state().records[0].amount, 100);
  fixture.rows[0].amount = 300;
  fixture.rows.push({ ...fixture.rows[0], id: 'sale-gap', amount: 200 });
  fixture.rows.splice(0, 1);
  fixture.status('SUBSCRIBED'); await tick(); await tick();
  assert.deepEqual(clone(fixture.state().records.map((row) => [row.id, row.amount])), [['sale-gap', 200]]);
  assert.equal(fixture.calls.filter((table) => table === 'sales').length, 2);
  fixture.calls.length = 0; fixture.fallback(); await tick(); assert.deepEqual(fixture.calls, []);
  fixture.dispose();
});

test('sales event failure recovers with a subscribed socket then returns to idle zero reads', async () => {
  const fixture = salesProviderFixture({ autoSubscribe: true }); await tick(); await tick();
  fixture.rows[0].amount = 900; fixture.fail(true); fixture.calls.length = 0;
  fixture.event({ table: 'sales', eventType: 'UPDATE', new: { workspace_id: 'workspace-1', id: 'sale-1' }, old: {} });
  fixture.flushEvents(); await tick(); await tick();
  assert.deepEqual(fixture.calls, ['sales']);
  assert.equal(fixture.state().records[0].amount, 100);
  fixture.fail(false); fixture.calls.length = 0; fixture.fallback(); await tick(); await tick();
  assert.equal(fixture.state().records[0].amount, 900);
  assert.deepEqual(fixture.calls.sort(), ['buyer_promise_defaults', 'sales']);
  fixture.calls.length = 0; fixture.fallback(); await tick(); assert.deepEqual(fixture.calls, []);
  fixture.dispose();
});

test('PK-only DELETE during initial commerce read cannot leave a ghost row absent from local cache', async () => {
  const remote = clientFixture({ autoSubscribe: false }); remote.defer();
  const fixture = providerFixture(remote);
  await tick();
  assert.equal(remote.calls.length, 6);
  assert.equal(fixture.state().messages.length, 0);
  // The already-started REST response still contains message-1, but the
  // DELETE has no workspace_id under RLS and the cache has not seen it yet.
  remote.rows.customer_messages = [];
  remote.channels[0].emit('customer_messages', 'DELETE', { id: 'message-1' });
  fixture.flushEvents(); remote.release(); await tick(); await tick();
  assert.equal(fixture.state().messages.length, 0);
  assert.equal(remote.calls.filter((table) => table === 'customer_messages').length, 2);
  assert.equal(remote.calls.length, 7);
  fixture.dispose();
});

test('PK-only DELETE during a sales read triggers follow-up even before the row reaches local cache', async () => {
  const fixture = salesProviderFixture({ deferredReads: true });
  await tick();
  assert.equal(fixture.state().records.length, 0);
  fixture.rows.length = 0;
  fixture.event({ table: 'sales', eventType: 'DELETE', new: {}, old: { id: 'sale-1' } });
  fixture.flushEvents(); fixture.releaseReads(); await tick(); await tick();
  assert.equal(fixture.state().records.length, 0);
  assert.equal(fixture.calls.filter((table) => table === 'sales').length, 2);
  fixture.dispose();
});

test('commerce waits for writes appended while an earlier save is pending before taking a snapshot', async () => {
  const remote = clientFixture();
  let releaseFirst, releaseSecond;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const second = new Promise((resolve) => { releaseSecond = resolve; });
  let saves = 0;
  remote.remoteWorkspaceService.saveCommerceChanges = async (_workspace, changes) => {
    saves++;
    await (saves === 1 ? first : second);
    remote.rows.verified_sales.push(...changes.verifiedSaleIdsToAdd.map((sale_id) => ({ sale_id })));
  };
  const fixture = providerFixture(remote, { ready: true });
  await tick(); await tick();
  fixture.value.setVerified(['sale-Q1'], true); await tick();
  remote.calls.length = 0;
  const repair = fixture.value.syncBridge(); await tick();
  fixture.value.setVerified(['sale-Q2'], true);
  releaseFirst(); await tick(); await tick();
  assert.equal(saves, 2);
  assert.equal(remote.calls.length, 0, 'Snapshot must not start between Q1 and the newly queued Q2');
  releaseSecond(); await repair;
  assert.equal(remote.calls.length, 6);
  assert.equal(fixture.state().verifiedSaleIds.includes('sale-Q1'), true);
  assert.equal(fixture.state().verifiedSaleIds.includes('sale-Q2'), true);
  fixture.dispose();
});

test('continuous commerce events keep the first batch deadline rather than resetting a trailing debounce', async () => {
  const remote = clientFixture(), fixture = providerFixture(remote);
  await tick(); await tick(); remote.calls.length = 0;
  for (let i = 0; i < 100; i++) remote.channels[0].emit(i % 2 ? 'invoices' : 'customer_messages', 'UPDATE', { workspace_id: 'workspace-1', id: `row-${i}` });
  assert.equal(fixture.scheduledTimeouts.length, 1, 'A steady stream must retain the original 350ms deadline');
  fixture.flushEvents(); await tick(); await tick();
  assert.deepEqual(remote.calls.sort(), ['customer_messages', 'invoices']);
  remote.channels[0].emit('customer_messages', 'UPDATE', { workspace_id: 'workspace-1', id: 'next-batch' });
  assert.equal(fixture.scheduledTimeouts.length, 2, 'The following batch gets its own bounded deadline');
  fixture.dispose();
});

test('continuous sales events keep one bounded batch deadline', async () => {
  const fixture = salesProviderFixture({ autoSubscribe: true }); await tick(); await tick(); fixture.calls.length = 0;
  for (let i = 0; i < 100; i++) fixture.event({ table: 'sales', eventType: 'UPDATE', new: { workspace_id: 'workspace-1', id: 'sale-1' }, old: {} });
  assert.equal(fixture.scheduledTimeouts.length, 1);
  fixture.flushEvents(); await tick(); await tick();
  assert.deepEqual(fixture.calls, ['sales']);
  fixture.dispose();
});
