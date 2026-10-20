import test from 'node:test';
import { diagnosticGlobals } from './runtime-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { findSaleForCapture } from '../src/services/saleCapturePairing.ts';

// Run the production capture callback across the asynchronous frame boundary.
// SalesContext's image-only patch is exercised separately by its print tests.
const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'captureCurrentScreen') {
    callback = node.initializer?.getText(file);
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(callback, 'The production capture callback must exist');
const compiled = ts.transpileModule(`module.exports = ${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function sale(id = 'sale-1', overrides = {}) {
  return { id, sessionId: 'broadcast', recognizedAt: new Date().toISOString(),
    buyerNickname: '햇살', amount: 15000, status: '확정', note: 'local evidence',
    captureImageUrls: [], printRevision: 1, printStatus: 'QUEUED', ...overrides };
}

function fixture(records, lastSaved = records[0] ?? null) {
  let resolveFrame;
  const frame = new Promise((resolve) => { resolveFrame = resolve; });
  const captures = [];
  const patches = [];
  const currentWorkflowSalesRef = { current: records };
  const lastSavedSaleRef = { current: lastSaved };
  const currentUserIdRef = { current: 'user-1' };
  const listeningGenerationRef = { current: 1 };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    ...diagnosticGlobals,
    module, findSaleForCapture, currentWorkflowSalesRef, lastSavedSaleRef,
    currentUserIdRef, listeningGenerationRef,
    authBoundaryGenerationRef: { current: 1 },
    isAuthenticatedRef: { current: true }, isListeningRef: { current: true },
    activeListeningUserIdRef: { current: 'user-1' }, shareOwnerUserIdRef: { current: 'user-1' },
    currentSessionIdRef: { current: 'broadcast' },
    productSalesRef: { current: { activeSession: { id: 'broadcast' } } },
    screenCaptureService: { getActiveStream: () => ({}), captureArea: () => frame },
    storageService: { getCaptureAreaConfig: () => undefined, addCapture: (capture) => captures.push(capture) },
    setRecentCaptures() {},
    updateSale: () => assert.fail('Automatic captures must not replay a whole sale through the seller edit path'),
    updateSaleCapture: (...args) => {
      patches.push(args);
      return result.savedSale;
    },
  });
  const result = {
    captures, patches, currentWorkflowSalesRef, lastSavedSaleRef, currentUserIdRef, listeningGenerationRef,
    savedSale: records[0],
    capture: module.exports,
    resolveFrame: (image = 'data:image/png;base64,new-capture') => resolveFrame(image),
  };
  return result;
}

test('capture finishing after server reconciliation patches only the sale ID and image', async () => {
  const original = sale();
  const ctx = fixture([original]);
  const pending = ctx.capture(undefined, '캡처하세요', 1, original.id);
  const latest = sale(original.id, { note: 'server evidence', amount: 28000,
    recognizedAt: original.recognizedAt.replace('Z', '+00:00'),
    printStatus: 'PRINTED', printedAt: new Date().toISOString() });
  ctx.currentWorkflowSalesRef.current = [latest];
  ctx.savedSale = { ...latest, captureImageUrls: ['data:image/png;base64,new-capture'] };
  ctx.resolveFrame();
  assert.equal(await pending, 'data:image/png;base64,new-capture');
  assert.deepEqual(ctx.patches, [[original.id, 'data:image/png;base64,new-capture']]);
  assert.equal(ctx.lastSavedSaleRef.current, ctx.savedSale);
  assert.equal(ctx.lastSavedSaleRef.current.printStatus, 'PRINTED');
  assert.equal(ctx.lastSavedSaleRef.current.printRevision, 1);
  assert.equal(ctx.captures[0].saleId, original.id);
});

test('untargeted capture uses current image state instead of stale last-saved evidence', async () => {
  const stale = sale();
  const latest = { ...stale, captureImageUrls: ['existing-image'] };
  const next = sale('sale-2', { recognizedAt: new Date(Date.now() - 1000).toISOString() });
  const ctx = fixture([latest, next], stale);
  ctx.savedSale = { ...next, captureImageUrls: ['new-image'] };
  const pending = ctx.capture();
  ctx.resolveFrame('new-image');
  await pending;
  assert.deepEqual(ctx.patches, [[next.id, 'new-image']]);
  assert.equal(ctx.captures[0].saleId, next.id);
  assert.equal(ctx.lastSavedSaleRef.current, stale, 'Capturing another sale must not replace the last voice-sale reference');
});

test('a just-added sale can receive its capture before React renders the new sales list', async () => {
  const justAdded = sale();
  const ctx = fixture([], justAdded);
  ctx.savedSale = { ...justAdded, captureImageUrls: ['new-image'] };
  const pending = ctx.capture(undefined, '캡처하세요', 1, justAdded.id);
  ctx.resolveFrame('new-image');
  await pending;
  assert.deepEqual(ctx.patches, [[justAdded.id, 'new-image']]);
  assert.equal(ctx.captures[0].saleId, justAdded.id);
  assert.equal(ctx.lastSavedSaleRef.current, ctx.savedSale);
});

test('a deleted sale is not recreated or attached when a late capture has only its cached ID', async () => {
  const deleted = sale();
  const ctx = fixture([], deleted);
  ctx.savedSale = undefined;
  const pending = ctx.capture(undefined, '캡처하세요', 1, deleted.id);
  ctx.resolveFrame('new-image');
  await pending;
  assert.deepEqual(ctx.patches, [[deleted.id, 'new-image']]);
  assert.equal(ctx.captures.length, 1);
  assert.equal(ctx.captures[0].saleId, undefined);
  assert.equal(ctx.lastSavedSaleRef.current, deleted);
});

test('product registration capture remains separate from sale updates', async () => {
  const ctx = fixture([sale()]);
  const pending = ctx.capture(undefined, '상품 등록', undefined, null);
  ctx.resolveFrame();
  await pending;
  assert.equal(ctx.patches.length, 0);
  assert.equal(ctx.captures[0].saleId, undefined);
  assert.equal(ctx.captures[0].purpose, 'PRODUCT_REGISTER');
});

for (const boundary of ['account', 'listening']) {
  test(`a capture crossing the ${boundary} boundary cannot update or store a sale image`, async () => {
    const ctx = fixture([sale()]);
    const pending = ctx.capture(undefined, '캡처하세요', 1, 'sale-1');
    if (boundary === 'account') ctx.currentUserIdRef.current = 'user-2';
    else ctx.listeningGenerationRef.current += 1;
    ctx.resolveFrame();
    assert.equal(await pending, '');
    assert.equal(ctx.patches.length, 0);
    assert.equal(ctx.captures.length, 0);
  });
}
