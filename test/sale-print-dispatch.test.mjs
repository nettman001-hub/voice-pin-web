import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const syncModule = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(
  new URL('../src/services/salesSyncController.ts', import.meta.url), 'utf8',
)), { module: syncModule, exports: syncModule.exports, crypto: globalThis.crypto });
const { SalesSyncController } = syncModule.exports;

// Exercise the provider's actual callbacks with its actual sync controller.
// Only React rendering, cloud I/O and the physical printer are replaced.
const source = fs.readFileSync(new URL('../src/context/SalesContext.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SalesContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set([
  'replaceSale', 'updateSaleCapture', 'isPrintableSale', 'hasSellerEditChanged',
  'sendToPrinter', 'queueSalePrint', 'addSale', 'updateSale', 'retrySalePrint',
]);
const declarations = [];
let changed;
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(ast))) {
    declarations.push(`const ${node.name.getText(ast)} = ${node.initializer.getText(ast)};`);
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'changed') {
    changed = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(declarations.length, names.size);
assert.ok(changed);
const callbacks = compile(`${declarations.join('\n')}
module.exports = { addSale, updateSale, updateSaleCapture, retrySalePrint, changed: ${changed} };`);

const saleData = (status = '확정') => ({
  sessionId: 'session', source: 'WEB_VOICE', status,
  buyerNickname: '햇살', buyerId: 'buyer-local', amount: 15000,
  recognizedAt: '2026-10-17T00:00:00.000Z',
  rawTranscript: '햇살님 1.5 드릴게요 캡처하세요',
  productCode: '001', productName: '001-20261017-1',
  purchaseRequestId: 'session:comment', sourceCommentIds: ['comment-local'],
  note: '구매 댓글 연결 (100점)',
});

function fixture({ save = async () => {} } = {}) {
  const requests = [], printResults = [], saved = [], errors = [];
  const salesRef = { current: [] };
  let state = { records: [], pending: [] }, sync;
  const module = { exports: {} };
  vm.runInNewContext(callbacks, {
    module, salesRef, sales: [], workspaceId: 'workspace', crypto: globalThis.crypto,
    identityRef: { current: 'workspace' }, identityGenerationRef: { current: 0 },
    dispatchedPrintsRef: { current: new Set() },
    setSales() {}, setSyncError: (error) => errors.push(error),
    getController: () => sync, getNextProductCodeForSession: () => '001',
    commentStreamService: {
      printSale(payload) {
        requests.push(clone(payload));
        const result = deferred();
        printResults.push(result);
        return result.promise;
      },
    },
  });
  sync = new SalesSyncController({
    read: () => clone(state), persist: (next) => { state = clone(next); },
    update: async (change) => {
      state = clone(change(clone(state)));
      return clone(state);
    },
    save: async (row) => { saved.push(clone(row)); await save(row); },
    remove: async () => {}, load: async () => [],
    changed: module.exports.changed, error: (error) => { if (error) errors.push(error); },
    active: () => true,
  });
  return {
    ...module.exports, sync, requests, saved, errors,
    async finishPrint(index = 0, ok = true) {
      printResults[index].resolve({ ok, status: ok ? 'PRINTED' : 'FAILED',
        printedAt: ok ? '2026-10-17T00:00:01.000Z' : undefined,
        error: ok ? undefined : 'printer offline' });
      await tick();
      await sync.flush();
    },
  };
}

for (const status of ['자동저장', '확정']) {
  test(`${status}: a capture before the first save acknowledgement produces one receipt`, async () => {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
    const added = ctx.addSale(saleData(status));
    await tick();
    assert.equal(writes, 1);
    ctx.updateSaleCapture(added.id, 'capture-1');
    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.sync.records.length, 1);
    assert.equal(ctx.sync.records[0].printRevision, 1);
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.requests[0].saleId, added.id);
    assert.equal(ctx.errors.length, 0);
  });

  test(`${status}: image acknowledgements cannot dispatch an in-flight print revision twice`, async () => {
    const ctx = fixture();
    const added = ctx.addSale(saleData(status));
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);

    ctx.updateSaleCapture(added.id, 'capture-1');
    await ctx.sync.flush();
    ctx.updateSaleCapture(added.id, 'capture-2');
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.sync.records[0].printRevision, 1);
    assert.deepEqual(clone(ctx.sync.records[0].captureImageUrls), ['capture-1', 'capture-2']);

    await ctx.finishPrint();
    ctx.updateSaleCapture(added.id, 'capture-3');
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.sync.records[0].printStatus, 'PRINTED');
  });
}

test('a late capture preserves reconciled server fields and the completed print', async () => {
  const ctx = fixture();
  const added = ctx.addSale(saleData());
  await ctx.sync.flush();
  await ctx.finishPrint();
  const canonical = {
    ...ctx.sync.records[0], buyerId: 'buyer-server', productId: 'product-server',
    sourceCommentIds: ['comment-server'], note: '구매 댓글 및 판매자 음성 가격 연결: 1.5',
    productCode: 'server-001', productName: '서버 상품명',
    recognizedAt: '2026-10-17T00:00:00+00:00',
    __voicecapStoragePaths: ['workspace/sales/existing.png'],
  };
  ctx.sync.applyConfirmed([canonical]);
  ctx.updateSaleCapture(added.id, 'capture-1');
  await ctx.sync.flush();
  const captured = ctx.sync.records[0];
  for (const key of ['buyerId', 'productId', 'sourceCommentIds', 'note', 'productCode',
    'productName', 'recognizedAt', 'printStatus', 'printRevision', 'printedAt', '__voicecapStoragePaths']) {
    assert.deepEqual(clone(captured[key]), clone(canonical[key]), key);
  }
  assert.equal(ctx.requests.length, 1);
  assert.equal(captured.productImageUrl, 'capture-1');
  assert.equal(ctx.sync.records.length, 1);
});

test('canonical refresh followed by capture while printing still dispatches only one receipt', async () => {
  const ctx = fixture();
  const added = ctx.addSale(saleData('자동저장'));
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.sync.records[0].printStatus, 'QUEUED');

  const canonical = { ...ctx.sync.records[0], recognizedAt: '2026-10-17T00:00:00+00:00',
    note: '구매 댓글 및 판매자 음성 가격 연결: 1.5', productName: '서버 상품명' };
  ctx.sync.applyConfirmed([canonical]);
  ctx.updateSaleCapture(added.id, 'capture-before-print-response');
  await ctx.sync.flush();

  assert.equal(ctx.sync.records.length, 1);
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.sync.records[0].printRevision, 1);
  assert.equal(ctx.sync.records[0].printStatus, 'QUEUED');
  assert.equal(ctx.sync.records[0].recognizedAt, canonical.recognizedAt);
  assert.equal(ctx.sync.records[0].note, canonical.note);
  assert.equal(ctx.sync.records[0].productName, canonical.productName);

  await ctx.finishPrint();
  assert.equal(ctx.sync.records[0].printStatus, 'PRINTED');
  assert.deepEqual(clone(ctx.sync.records[0].captureImageUrls), ['capture-before-print-response']);
  assert.equal(ctx.requests.length, 1);
});

test('capturing an already attached image is a no-op and a deleted sale is not recreated', async () => {
  const ctx = fixture();
  const added = ctx.addSale(saleData());
  await ctx.sync.flush();
  ctx.updateSaleCapture(added.id, 'capture-1');
  await ctx.sync.flush();
  const writes = ctx.saved.length;
  ctx.updateSaleCapture(added.id, 'capture-1');
  await ctx.sync.flush();
  assert.equal(ctx.saved.length, writes);
  assert.deepEqual(clone(ctx.sync.records[0].captureImageUrls), ['capture-1']);

  ctx.sync.delete(added.id);
  await ctx.sync.flush();
  assert.equal(ctx.updateSaleCapture(added.id, 'late-capture'), undefined);
  assert.equal(ctx.sync.records.length, 0);
});

test('an equivalent server timestamp is not an edit but an actual time change still reprints', async () => {
  const ctx = fixture();
  ctx.addSale(saleData());
  await ctx.sync.flush();
  await ctx.finishPrint();
  ctx.updateSale({ ...ctx.sync.records[0], recognizedAt: '2026-10-17T00:00:00+00:00' });
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.sync.records[0].printRevision, 1);

  ctx.updateSale({ ...ctx.sync.records[0], recognizedAt: '2026-10-17T00:00:02+00:00' });
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.requests[1].printRevision, 2);
});

test('manual price edits and explicit reprints each create a new print revision', async () => {
  const ctx = fixture();
  const added = ctx.addSale(saleData());
  await ctx.sync.flush();
  await ctx.finishPrint();
  ctx.updateSale({ ...ctx.sync.records[0], amount: 20000 });
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.requests[1].amount, 20000);
  assert.equal(ctx.requests[1].printRevision, 2);

  ctx.updateSaleCapture(added.id, 'capture-after-edit');
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.sync.records[0].amount, 20000);
  assert.equal(ctx.sync.records[0].printRevision, 2);

  await ctx.finishPrint(1);
  ctx.retrySalePrint(added.id);
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 3);
  assert.equal(ctx.requests[2].printRevision, 3);
  assert.equal(ctx.requests[2].amount, 20000);
});

test('a failed print can be retried explicitly without metadata automatically repeating it', async () => {
  const ctx = fixture();
  const added = ctx.addSale(saleData());
  await ctx.sync.flush();
  await ctx.finishPrint(0, false);
  ctx.updateSaleCapture(added.id, 'capture-after-failure');
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.sync.records[0].printStatus, 'FAILED');

  ctx.retrySalePrint(added.id);
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.requests[1].printRevision, 2);
});

for (const status of ['자동저장', '확정']) {
  test(`one STT transaction can complete an uploading pending row as ${status} without a purchase request`, async () => {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
    const added = ctx.addSale({ ...saleData('보류'), amount: 0, buyerId: undefined,
      purchaseRequestId: undefined, sourceCommentIds: [], rawTranscript: '햇살님 드릴게요' });
    await tick();

    const priced = ctx.updateSale({ ...ctx.sync.records[0], amount: 15000,
      rawTranscript: '햇살님 드릴게요 1.5' }, { voiceTransactionContinuation: true });
    assert.equal(priced.id, added.id);
    assert.equal(priced.status, '보류');
    assert.equal(ctx.requests.length, 0);
    const confirmed = ctx.updateSale({ ...priced, status,
      rawTranscript: '햇살님 드릴게요 1.5 캡처하세요' }, { voiceTransactionContinuation: true });
    assert.equal(confirmed.printRevision, 1);
    assert.equal(ctx.sync.records.length, 1);

    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.errors.length, 0);
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.requests[0].saleId, added.id);
    assert.equal(ctx.requests[0].amount, 15000);
    assert.equal(ctx.sync.records[0].status, status);
    assert.equal(ctx.sync.records[0].purchaseRequestId, undefined);
  });

  test(`${status}: a final capture phrase during upload keeps the original receipt revision`, async () => {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
    const added = ctx.addSale(saleData(status));
    await tick();
    const completed = ctx.updateSale({ ...ctx.sync.records[0], status: '확정',
      rawTranscript: `${added.rawTranscript}\n캡처하세요`, note: '4단 멘트 확인',
      captureImageUrls: ['final-capture'] }, { voiceTransactionContinuation: true });
    assert.equal(completed.printRevision, 1);
    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.errors.length, 0);
    await ctx.finishPrint();

    ctx.updateSale({ ...ctx.sync.records[0], rawTranscript: `${completed.rawTranscript}\n네`,
      captureImageUrls: ['final-capture', 'another-capture'] }, { voiceTransactionContinuation: true });
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.sync.records[0].printStatus, 'PRINTED');
    assert.equal(ctx.sync.records[0].printRevision, 1);
  });
}

test('transaction continuation does not bypass upload protection for another transaction or cancellation', async () => {
  for (const patch of [
    { sessionId: 'another-session' }, { recognizedAt: '2026-10-17T00:00:02.000Z' },
    { productId: 'another-product' }, { productCode: '002' }, { productName: 'another-product' },
    { source: 'MANUAL' }, { status: '취소' }, { recordState: 'CANCELLED' },
  ]) {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
    ctx.addSale({ ...saleData('보류'), amount: 0, purchaseRequestId: undefined,
      sourceCommentIds: [], rawTranscript: '햇살님 드릴게요' });
    await tick();
    const before = clone(ctx.sync.records[0]);
    const result = ctx.updateSale({ ...before, amount: 15000, status: '확정',
      rawTranscript: '햇살님 드릴게요 1.5 캡처하세요', ...patch }, { voiceTransactionContinuation: true });
    assert.equal(result, undefined, JSON.stringify(patch));
    assert.deepEqual(clone(ctx.sync.records[0]), before);
    assert.equal(ctx.errors.length, 1);
    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 0);
  }
});

test('transaction continuation still prints a changed amount and ordinary edits stay blocked during upload', async () => {
  const firstSave = deferred();
  let writes = 0;
  const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
  ctx.addSale(saleData('자동저장'));
  await tick();
  assert.equal(ctx.updateSale({ ...ctx.sync.records[0], amount: 20000 }), undefined);
  assert.equal(ctx.sync.records[0].amount, 15000);
  assert.equal(ctx.errors.length, 1);
  firstSave.resolve();
  await ctx.sync.flush();
  await ctx.finishPrint();

  const updated = ctx.updateSale({ ...ctx.sync.records[0], status: '확정', amount: 20000,
    rawTranscript: '햇살님 2.0 드릴게요 캡처하세요' }, { voiceTransactionContinuation: true });
  assert.equal(updated.printRevision, 2);
  await ctx.sync.flush();
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.requests[1].amount, 20000);
});

for (const phase of ['uploading', 'printing', 'printed']) {
  test(`late comment identity while ${phase} preserves an already printable receipt`, async () => {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => phase === 'uploading' && ++writes === 1
      ? firstSave.promise : Promise.resolve() });
    const added = ctx.addSale({ ...saleData('확정'), buyerNickname: '하니 추정', buyerId: undefined,
      sourceCommentIds: [], purchaseRequestId: undefined });
    if (phase === 'uploading') await tick();
    else await ctx.sync.flush();
    if (phase === 'printed') await ctx.finishPrint();

    const linked = ctx.updateSale({ ...ctx.sync.records[0], buyerNickname: '하니', buyerId: 'buyer-hani',
      sourceCommentIds: ['author-comment'], note: '댓글 작성자 하니 연결' }, { voiceCommentIdentity: true });
    assert.equal(linked.id, added.id);
    assert.equal(linked.printRevision, 1);
    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.errors.length, 0);
    assert.equal(ctx.sync.records[0].buyerNickname, '하니');
    assert.equal(ctx.sync.records[0].buyerId, 'buyer-hani');
    if (phase === 'printed') assert.equal(ctx.sync.records[0].printStatus, 'PRINTED');
    else await ctx.finishPrint();
    assert.equal(ctx.sync.records[0].printRevision, 1);
    assert.equal(ctx.requests.length, 1);
  });
}

for (const status of ['자동저장', '확정']) {
  test(`late comment identity can release an uploading pending row as ${status} with one receipt`, async () => {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
    const added = ctx.addSale({ ...saleData('보류'), buyerNickname: '하니 추정', buyerId: undefined,
      sourceCommentIds: [], purchaseRequestId: undefined });
    await tick();
    const linked = ctx.updateSale({ ...ctx.sync.records[0], status, buyerNickname: '하니', buyerId: 'buyer-hani',
      sourceCommentIds: ['author-comment'] }, { voiceCommentIdentity: true });
    assert.equal(linked.id, added.id);
    assert.equal(linked.printRevision, 1);
    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.requests[0].buyerNickname, '하니');
    assert.equal(ctx.errors.length, 0);
  });
}

test('late comment identity cannot change voice evidence or replace an existing buyer during upload', async () => {
  for (const patch of [
    { amount: 20000 }, { rawTranscript: '다른 발화' }, { recognizedAt: '2026-10-17T00:00:02.000Z' },
    { productId: 'another-product' }, { productCode: '002' }, { productName: 'another-product' },
    { unitPrice: 20000 }, { quantity: 2 }, { sourceCommentIds: [] }, { sourceCommentIds: [' '] },
    { buyerId: 'another-buyer' }, { status: '취소' }, { recordState: 'CANCELLED' },
  ]) {
    const firstSave = deferred();
    let writes = 0;
    const ctx = fixture({ save: () => ++writes === 1 ? firstSave.promise : Promise.resolve() });
    ctx.addSale({ ...saleData('보류'), purchaseRequestId: undefined });
    await tick();
    const before = clone(ctx.sync.records[0]);
    const result = ctx.updateSale({ ...before, status: '확정', buyerNickname: '햇살언니',
      sourceCommentIds: ['author-comment'], ...patch }, { voiceCommentIdentity: true });
    assert.equal(result, undefined, JSON.stringify(patch));
    assert.deepEqual(clone(ctx.sync.records[0]), before);
    assert.equal(ctx.errors.length, 1);
    firstSave.resolve();
    await ctx.sync.flush();
    assert.equal(ctx.requests.length, 0);
  }
});

for (const option of ['voiceTransactionContinuation', 'voiceCommentIdentity']) {
  test(`${option} preserves a print acknowledgement newer than the caller snapshot`, async () => {
    const ctx = fixture();
    ctx.addSale({ ...saleData('확정'), buyerId: undefined });
    await ctx.sync.flush();
    const snapshot = clone(ctx.sync.records[0]);
    assert.equal(snapshot.printStatus, 'QUEUED');
    await ctx.finishPrint();
    const printedAt = ctx.sync.records[0].printedAt;

    ctx.updateSale({ ...snapshot, buyerId: 'buyer-linked', sourceCommentIds: ['author-comment'],
      note: '댓글 작성자 확인' }, { [option]: true });
    await ctx.sync.flush();
    assert.equal(ctx.sync.records[0].printStatus, 'PRINTED');
    assert.equal(ctx.sync.records[0].printedAt, printedAt);
    assert.equal(ctx.sync.records[0].printRevision, 1);
    assert.equal(ctx.requests.length, 1);
  });
}
