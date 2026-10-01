import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as reviewService from '../src/services/voicePendingReviewService.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reviewCallback;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect'
    && node.arguments[0]?.getText(file).includes('const reviewLogs =')) reviewCallback = node.arguments[0].getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(reviewCallback, 'The real LiveContext review scheduler exists');
const compiled = ts.transpileModule(`module.exports = ${reviewCallback};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function schedulerFixture() {
  let now = Date.parse('2026-09-15T12:41:29Z');
  const calls = [];
  const comment = { id: 'comment', platformMessageId: 'comment', sessionId: 'broadcast', buyerId: 'account',
    nickname: 'KH', content: '연핑 저요', capturedAt: '2026-09-15T12:40:19Z' };
  const sale = { id: 'pending', sessionId: 'broadcast', source: 'WEB_VOICE', status: '보류', syncStatus: 'SYNCED',
    buyerNickname: '케이치', amount: 0, revision: 1, recognizedAt: '2026-09-15T12:41:10Z',
    rawTranscript: '케이치 언니는 연핑 넣어드릴게요' };
  const logs = [{ id: 'price', isFinal: true, recognizedAt: '2026-09-15T12:41:26Z', text: 'KH 언니 연핑 1.5 넣어드렸어요' }];
  const globals = {
    ...reviewService, Date: class extends Date { static now() { return now; } },
    isVoiceReviewReady: (current, comments) => reviewService.isVoiceReviewReady(current, comments, now),
    isRemoteAuth: true, workspaceId: 'workspace', isListening: false,
    currentSessionId: 'temporary-session-after-reload', productSales: { feed: { comments: [] } }, sales: [sale],
    storageService: { getCommentRecords: () => [comment], getSessionTranscripts: () => logs },
    sessionTranscriptsRef: { current: new Map() }, pendingAiRunningRef: { current: false },
    pendingAiAttemptsRef: { current: new Map() }, currentUserIdRef: { current: 'seller' },
    authBoundaryGenerationRef: { current: 1 }, transcriptWorkspaceIdRef: { current: 'workspace' },
    window: { setTimeout: () => 1, clearTimeout() {} }, console: { error() {} },
    syncSessionTranscriptsToCloud: async (sessionId) => { calls.push(['upload', sessionId]); return true; },
    aiSettingsApi: { triggerPendingAiResolution: async (id, options) => { calls.push(['review', id, options]); return {}; } },
    refreshSales: async () => { calls.push(['refresh']); }, setPendingAiTick() {},
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, ...globals });
  return { globals, calls, sale, run: () => module.exports(), setNow: (value) => { now = value; } };
}

test('after reload or stopping, a mature purchase window uploads saved speech before invoking AI', async () => {
  const ctx = schedulerFixture();
  ctx.run(); await tick();
  assert.equal(ctx.globals.isListening, false);
  assert.deepEqual(ctx.calls.map((call) => call[0]), ['upload', 'review', 'refresh']);
  assert.equal(ctx.calls[0][1], 'broadcast');
  assert.equal(ctx.calls[1][1], 'pending');
  assert.equal(ctx.calls[1][2].workspaceId, 'workspace');
  assert.equal(ctx.sale.status, '보류');
});

test('the scheduler waits until the last second of the window and excludes concurrent duplicate reviews', async () => {
  const ctx = schedulerFixture();
  ctx.setNow(Date.parse('2026-09-15T12:41:28Z'));
  ctx.run(); await tick();
  assert.equal(ctx.calls.length, 0);
  ctx.setNow(Date.parse('2026-09-15T12:41:29Z'));
  ctx.run(); ctx.run(); await tick();
  assert.equal(ctx.calls.filter((call) => call[0] === 'review').length, 1);
});

test('an account change during archive upload prevents the old review request from executing', async () => {
  const ctx = schedulerFixture();
  // Switch identity while the scheduler awaits its archive upload.
  const original = ctx.globals.currentUserIdRef;
  ctx.run();
  original.current = 'other-seller';
  await tick();
  assert.equal(ctx.calls.filter((call) => call[0] === 'review').length, 0);
  assert.equal(ctx.globals.pendingAiRunningRef.current, false);
});
