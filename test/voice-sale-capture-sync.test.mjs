import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as voiceSaleValidation from '../src/services/voiceSaleValidation.ts';

function loadModule(relativePath, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, crypto: globalThis.crypto, console, ...globals,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  return module.exports;
}
const { SalesSyncController } = loadModule('../src/services/salesSyncController.ts');

const workspaceId = 'workspace-capture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const saleId = 's-22222222-2222-4222-8222-222222222222';
const image = 'data:image/png;base64,Y2FwdHVyZQ==';
const queuedSale = () => ({
  id: saleId, sessionId, source: 'WEB_VOICE', status: '자동저장',
  buyerNickname: '구매자', amount: 15000, unitPrice: 15000, quantity: 1,
  recognizedAt: '2026-10-17T08:00:00Z', rawTranscript: '구매자님 15000원 드릴게요',
  purchaseRequestId: `${sessionId}:comment-1`, printStatus: 'QUEUED', printRevision: 1,
  revision: 2, note: 'optimistic note', captureImageUrls: [image],
});

function fixture() {
  const calls = [], uploads = [], errors = { upload: null, update: null };
  const row = {
    id: saleId, workspace_id: workspaceId, session_id: sessionId, source: 'WEB_VOICE',
    status: '자동저장', buyer_nickname: '구매자', buyer_id: 'canonical-buyer',
    amount: 15000, unit_price: 15000, quantity: 1, product_id: 'canonical-product',
    product_name_snapshot: '서버 상품', product_code_snapshot: '001',
    product_image_path_snapshot: 'workspace-capture/product/main.png',
    note: 'canonical note', source_comment_ids: ['canonical-comment'],
    purchase_request_id: `${sessionId}:comment-1`, recognized_at: '2026-10-17T08:00:00Z',
    raw_transcript: '구매자님 15000원 드릴게요', print_status: 'PRINTED', print_revision: 1,
    printed_at: '2026-10-17T08:00:01Z', revision: 1, capture_image_paths: [],
  };
  const client = {
    functions: { async invoke(name, options) { calls.push({ kind: 'commit', name, body: options.body }); return { data: { ok: true, data: { saleId } }, error: null }; } },
    from(table) {
      let patch;
      const filters = [];
      return {
        select() { return this; }, order() { return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        update(value) { patch = value; return this; },
        async range() { return { data: [{ ...row }], error: null }; },
        then(resolve, reject) {
          calls.push({ kind: 'metadata', table, patch, filters });
          if (!errors.update) Object.assign(row, patch);
          return Promise.resolve({ error: errors.update }).then(resolve, reject);
        },
      };
    },
    storage: { from() { return {
      async upload(path) { uploads.push(path); return { error: errors.upload }; },
      async createSignedUrl(path) { return { data: { signedUrl: `https://images.invalid/${path}` }, error: null }; },
    }; } },
  };
  const dependencies = {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => client },
    './commerceChanges': {}, './sttVocabularyService': {}, './voiceSaleValidation': voiceSaleValidation,
    './paymentMatching': {}, '../utils/textCleaner': {},
  };
  const { remoteWorkspaceService } = loadModule('../src/services/remoteWorkspaceService.ts', dependencies, {
    fetch: async () => ({ blob: async () => new Blob(['capture'], { type: 'image/png' }) }),
  });
  return { service: remoteWorkspaceService, row, calls, uploads, errors };
}

test('queued voice-sale capture survives its save ACK and a canonical refresh without changing the receipt', async () => {
  const ctx = fixture();
  const canonical = structuredClone(ctx.row);
  let state = { records: [], pending: [] };
  const sync = new SalesSyncController({
    read: () => state, persist: (next) => { state = next; },
    save: (sale) => ctx.service.saveSale(workspaceId, sale), remove: async () => {},
    load: () => ctx.service.loadSales(workspaceId), changed() {}, error() {}, active: () => true,
  });
  sync.upsert(queuedSale());
  await sync.flush();
  assert.equal(state.pending.length, 0);
  const [refreshed] = await sync.refresh();
  assert.equal(refreshed.captureImageUrls.length, 1);
  assert.equal(refreshed.captureImageUrls[0], `https://images.invalid/${ctx.uploads[0]}`);
  assert.equal(refreshed.buyerId, canonical.buyer_id);
  assert.equal(refreshed.productId, canonical.product_id);
  assert.equal(refreshed.productName, canonical.product_name_snapshot);
  assert.equal(refreshed.productImagePath, canonical.product_image_path_snapshot);
  assert.equal(refreshed.note, canonical.note);
  assert.equal(refreshed.printStatus, 'PRINTED');
  assert.equal(refreshed.printRevision, 1);
  assert.equal(refreshed.printedAt, canonical.printed_at);
  const metadata = ctx.calls.find((call) => call.kind === 'metadata');
  assert.deepEqual(Object.keys(metadata.patch), ['capture_image_paths']);
  assert.deepEqual(metadata.filters, [['workspace_id', workspaceId], ['id', saleId]]);
});

test('capture persistence keeps existing private paths instead of storing expiring signed URLs', async () => {
  const ctx = fixture();
  const originalPath = `${workspaceId}/sales/${saleId}/original.png`;
  await ctx.service.saveSale(workspaceId, {
    ...queuedSale(), captureImageUrls: ['https://images.invalid/original?token=temporary', image],
    __voicecapStoragePaths: [originalPath],
  });
  assert.equal(ctx.uploads.length, 1);
  assert.deepEqual(Array.from(ctx.row.capture_image_paths), [originalPath, ctx.uploads[0]]);
});

for (const failure of ['upload', 'update']) {
  test(`capture ${failure} failure remains in the outbox until the metadata save succeeds`, async () => {
    const ctx = fixture();
    ctx.errors[failure] = new Error(`${failure} offline`);
    let state = { records: [], pending: [] };
    const sync = new SalesSyncController({
      read: () => state, persist: (next) => { state = next; },
      save: (sale) => ctx.service.saveSale(workspaceId, sale), remove: async () => {},
      load: async () => [], changed() {}, error() {}, active: () => true,
    });
    sync.upsert(queuedSale()); await sync.flush();
    assert.equal(state.pending.length, 1);
    assert.equal(state.records[0].syncStatus, 'PENDING');
    ctx.errors[failure] = null;
    await sync.flush();
    assert.equal(state.pending.length, 0);
    assert.equal(ctx.row.capture_image_paths.length, 1);
    assert.equal(ctx.row.print_status, 'PRINTED');
    assert.equal(ctx.row.print_revision, 1);
    assert.equal(ctx.calls.filter((call) => call.kind === 'commit').length, 2);
  });
}

test('a voice commit without captures performs no extra metadata write', async () => {
  const ctx = fixture();
  await ctx.service.saveSale(workspaceId, { ...queuedSale(), captureImageUrls: [] });
  assert.deepEqual(ctx.calls.map((call) => call.kind), ['commit']);
  assert.equal(ctx.uploads.length, 0);
});
