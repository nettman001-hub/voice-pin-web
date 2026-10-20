import { runtimeFixture, diagnosticGlobals } from './runtime-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as serverRejectedSale from '../src/services/serverRejectedSale.ts';

const { markServerReviewCompleted, needsServerReview } = serverRejectedSale;
const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let index = 0; index < 6; index++) await new Promise(setImmediate); };
const record = (extra = {}) => ({
  id: 'sale-1', sessionId: 'broadcast-2', buyerNickname: '꽃심이', amount: 10000,
  status: '자동저장', recordState: 'ACTIVE', source: 'WEB_VOICE',
  recognizedAt: '2026-10-17T12:23:13Z', rawTranscript: '꽃심이님 만 원 드릴게요',
  revision: 2, syncStatus: 'SYNCED', printStatus: 'NOT_REQUESTED', printRevision: 1,
  note: '판매 메모 / [서버 확인 필요] 구매 댓글 연결 확인 (BUYER_AMBIGUOUS)',
  ...extra,
});

function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, crypto, console,
    require(key) { if (key.endsWith('/sttDiagnostics')) return diagnosticGlobals; if (key.endsWith('WorkspaceRuntimeContext')) return runtimeFixture(dependencies);
      assert.ok(key in dependencies, `Unexpected import ${key}`);
      return dependencies[key];
    },
  });
  return module.exports;
}
const { SalesSyncController } = load('../src/services/salesSyncController.ts');

function providerFixture(initial) {
  let state = clone(initial), offline = false, saveOverride;
  const saved = [], prints = [];
  const storage = {
    getSales: () => state.records,
    getPromiseDefaults: () => [],
    getSalesLocalState: () => clone(state),
    saveSalesLocalState: (_workspace, next) => { state = clone(next); },
    updateSalesLocalState: async (_workspace, change) => {
      state = clone(change(clone(state)));
      return clone(state);
    },
  };
  const remote = { saveSale: async (_workspace, sale) => {
    saved.push(clone(sale));
    if (offline) throw new Error('offline');
    await saveOverride?.(sale);
  } };
  const mount = () => {
    const cells = [];
    let index = 0;
    const react = {
      createContext: () => ({ Provider: 'provider' }),
      createElement: (_type, props) => ({ props }),
      useRef(value) { const key = index++; cells[key] ||= { current: value }; return cells[key]; },
      useState(initialValue) {
        const key = index++;
        if (!(key in cells)) cells[key] = typeof initialValue === 'function' ? initialValue() : initialValue;
        return [cells[key], (value) => { cells[key] = typeof value === 'function' ? value(cells[key]) : value; }];
      },
      useCallback: (callback) => callback,
      useEffect() {},
    };
    const { SalesProvider } = load('../src/context/SalesContext.tsx', {
      react: { ...react, default: react },
      '../services/storageService': { storageService: storage },
      '../services/csvExporter': {},
      './AuthContext': { useAuth: () => ({ workspaceId: 'workspace-review', isRemoteAuth: true, user: { id: 'seller-1' } }) },
      '../services/remoteWorkspaceService': { remoteWorkspaceService: remote },
      '../services/commentStreamService': { commentStreamService: { printSale: async (sale) => { prints.push(sale); return { ok: true }; } } },
      '../services/aiSettingsApi': {},
      '../services/serverRejectedSale': serverRejectedSale,
      '../services/salesSyncController': { SalesSyncController },
      '../services/salesExtractor': {},
      '../services/workspaceReadSync': {},
    });
    return { render: () => { index = 0; return SalesProvider({ children: null }).props.value; } };
  };
  return { mount, saved, prints, state: () => clone(state), setOffline: (value) => { offline = value; },
    setSave: (callback) => { saveOverride = callback; } };
}

test('review completion replaces every exact marker and preserves the original reasons and sale fields', () => {
  const sale = record({ note: '메모 / [서버 확인 필요] 첫 사유 (CODE_A) / [서버 확인 필요] 둘째 사유 (CODE_B)' });
  const completed = markServerReviewCompleted(sale);
  assert.equal(completed.note, '메모 / [판매자 확인 완료] 첫 사유 (CODE_A) / [판매자 확인 완료] 둘째 사유 (CODE_B)');
  assert.deepEqual({ ...completed, note: sale.note }, sale);
  assert.equal(needsServerReview(completed), false);
  assert.equal(needsServerReview(sale), true);
  assert.equal(markServerReviewCompleted(completed), completed);
  const unmarked = record({ note: '서버 확인 필요 여부를 메모한 일반 기록' });
  assert.equal(markServerReviewCompleted(unmarked), unmarked);
  const withoutNote = record({ note: undefined });
  assert.equal(markServerReviewCompleted(withoutNote), withoutNote);
});

test('provider completion immediately clears the badge and persists only the note without another receipt', async () => {
  const sale = record({ status: '확정', printStatus: 'PRINTED', printRevision: 3, printedAt: '2026-10-18T03:00:00Z' });
  const ctx = providerFixture({ records: [sale], pending: [] });
  const provider = ctx.mount();
  const completed = provider.render().completeServerReview(sale.id);
  assert.equal(needsServerReview(completed), false);
  assert.equal(needsServerReview(provider.render().sales[0]), false);
  assert.equal(completed.syncStatus, 'PENDING');
  await settle();
  assert.equal(ctx.saved.length, 1);
  assert.deepEqual({ ...ctx.saved[0], note: sale.note, revision: sale.revision, syncStatus: sale.syncStatus }, sale);
  assert.equal(ctx.state().records[0].syncStatus, 'SYNCED');
  assert.equal(ctx.state().pending.length, 0);
  assert.equal(ctx.prints.length, 0);
  const before = ctx.state();
  assert.equal(provider.render().completeServerReview('missing'), undefined);
  provider.render().completeServerReview(sale.id);
  await settle();
  assert.equal(ctx.saved.length, 1);
  assert.deepEqual(ctx.state(), before);
});

test('completing a pending fallback replaces its durable operation and survives offline reload and retry', async () => {
  const sale = record({ syncStatus: 'PENDING' });
  const ctx = providerFixture({ records: [sale], pending: [{ id: sale.id, token: 'old-operation', kind: 'UPSERT', sale }] });
  ctx.setOffline(true);
  const provider = ctx.mount();
  provider.render().completeServerReview(sale.id);
  await settle();
  const pending = ctx.state();
  assert.equal(pending.pending.length, 1);
  assert.notEqual(pending.pending[0].token, 'old-operation');
  assert.equal(needsServerReview(pending.pending[0].sale), false);
  assert.equal(pending.pending[0].sale.printStatus, 'NOT_REQUESTED');
  assert.equal(pending.pending[0].sale.printRevision, 1);
  assert.equal(pending.pending[0].sale.amount, 10000);
  assert.equal(pending.pending[0].sale.status, '자동저장');
  assert.equal(pending.records[0].syncStatus, 'PENDING');
  const reloaded = ctx.mount();
  ctx.setOffline(false);
  reloaded.render().retrySync();
  await settle();
  assert.equal(ctx.state().pending.length, 0);
  assert.equal(ctx.state().records[0].syncStatus, 'SYNCED');
  assert.equal(needsServerReview(ctx.saved.at(-1)), false);
  assert.match(ctx.saved.at(-1).note, /\[판매자 확인 완료\].*BUYER_AMBIGUOUS/);
  assert.equal(ctx.prints.length, 0);
});

test('review completion merges the latest pending metadata and survives an older in-flight acknowledgement', async () => {
  const sale = record({ syncStatus: 'PENDING' });
  let release;
  const write = new Promise((resolve) => { release = resolve; });
  const ctx = providerFixture({ records: [sale], pending: [{ id: sale.id, token: 'old-operation', kind: 'UPSERT', sale }] });
  ctx.setSave(async () => { if (ctx.saved.length === 1) await write; });
  const provider = ctx.mount();
  const api = provider.render();
  api.retrySync();
  await settle();
  assert.equal(ctx.saved.length, 1);
  api.updateSaleCapture(sale.id, 'capture-image');
  const completed = api.completeServerReview(sale.id);
  assert.deepEqual(Array.from(completed.captureImageUrls), ['capture-image']);
  assert.equal(needsServerReview(completed), false);
  release();
  await settle();
  const final = ctx.state();
  assert.equal(final.pending.length, 0);
  assert.equal(final.records[0].syncStatus, 'SYNCED');
  assert.equal(needsServerReview(final.records[0]), false);
  assert.deepEqual(final.records[0].captureImageUrls, ['capture-image']);
  assert.equal(ctx.saved.length, 2);
  assert.equal(needsServerReview(ctx.saved[1]), false);
  assert.equal(ctx.prints.length, 0);
});
