import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { getPurchaseRequests, matchPurchaseRequest } from '../src/services/purchaseFirstSales.ts';
import { buildPendingReasons, buildEvidenceSnapshot } from '../src/services/pendingSalesService.ts';
import { getVoiceReviewRequests, shouldReviewVoiceSale, buildVoiceReviewRequest,
  isVoiceReviewReady } from '../src/services/voicePendingReviewService.ts';
import { generateSequentialProductName } from '../src/utils/productNaming.ts';

// Exercise the actual persistence callback. Only storage, UI, and capture
// boundaries are mocked; sale extraction and comment matching remain real.
const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'persistVoiceSale') {
    callback = node.initializer?.getText(file);
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(callback, 'The live persistence callback must be found in the source');
const compiled = ts.transpileModule(`const persistVoiceSale = ${callback}; module.exports = persistVoiceSale;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const speech = '언니, DM 왜 빵바지 보여줄게. 아니, 가까운 건 좋은데, 가윤 언니 챙겨줄게.';
const decoratedBuyerSpeech = '금액은 8,000원, 0.8. 이거 언니, 이뿌쥬 언니 챙겨드릴게요, 0.8.';
function comment(nickname = '가윤♡예준맘', id = 'purchase-comment', buyerId = 'buyer-account') {
  return { id, platformMessageId: id, buyerId, nickname, content: '저요', sessionId: 'broadcast',
    capturedAt: new Date(Date.now() - 1000).toISOString() };
}

function fixture(comments) {
  const stored = [];
  const reserved = new Set();
  const globals = {
    extractSaleFromTranscript, getPurchaseRequests, matchPurchaseRequest,
    buildPendingReasons, buildEvidenceSnapshot, getVoiceReviewRequests, generateSequentialProductName,
    workspaceId: 'workspace', sales: stored,
    productSalesRef: { current: { activeSession: { id: 'broadcast', displayCode: '20261001-1' },
      activeProduct: undefined, feed: { comments: [] } } },
    currentSessionIdRef: { current: 'broadcast' }, recentVoiceDecisionsRef: { current: new Map() },
    reservedPurchaseRequestsRef: { current: reserved }, lastSavedSaleRef: { current: null },
    storageService: { getCommentRecords: () => comments, getPurchaseRequests: () => [], getCaptures: () => [] },
    getNextProductCodeForSession: () => '001',
    addSale: (value) => { const saved = { id: `sale-${stored.length + 1}`, ...value }; stored.push(saved); return saved; },
    updateSale: (value) => { stored[stored.findIndex((entry) => entry.id === value.id)] = value; },
    screenCaptureService: { getActiveStream: () => null },
    captureCurrentScreen: () => assert.fail('No capture is requested by this example'),
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, ...globals });
  return { stored, reserved, save: async (text = speech) => {
    const extracted = extractSaleFromTranscript(text);
    assert.ok(extracted, 'The seller allocation must reach the live persistence callback');
    await module.exports(extracted, text, false, 1);
  } };
}

test('an abbreviated composite nickname persists the exact comment identity while the price remains pending', async () => {
  const buyer = comment();
  const ctx = fixture([buyer]);
  await ctx.save();
  assert.equal(ctx.stored.length, 1);
  const saved = ctx.stored[0];
  assert.equal(saved.source, 'WEB_VOICE');
  assert.equal(saved.status, '보류');
  assert.equal(saved.buyerNickname, '가윤♡예준맘');
  assert.equal(saved.buyerId, buyer.buyerId);
  assert.deepEqual(Array.from(saved.sourceCommentIds), [buyer.id]);
  assert.deepEqual(Array.from(saved.evidenceSnapshot.relevantCommentIds), [buyer.id]);
  assert.equal(saved.amount, 0);
  assert.equal(saved.unitPrice, 0);
  assert.ok(saved.pendingReasons.some((reason) => reason.code === 'MISSING_AMOUNT'));
  assert.equal(saved.pendingReasons.some((reason) => reason.code === 'DELAYED_COMMENT'), false);
  assert.equal(saved.purchaseRequestId, undefined, 'Missing price must not consume the purchase request');
  assert.equal(ctx.reserved.size, 0);
});

test('competing abbreviated buyers stay pending without assigning a guessed account', async () => {
  const comments = [comment(), comment('가윤♡지우맘', 'other-comment', 'other-account')];
  const ctx = fixture(comments);
  await ctx.save();
  assert.equal(ctx.stored.length, 1);
  const saved = ctx.stored[0];
  assert.equal(saved.status, '보류');
  assert.equal(saved.buyerNickname, '가윤');
  assert.equal(saved.buyerId, undefined);
  assert.equal(saved.purchaseRequestId, undefined);
  assert.deepEqual(Array.from(saved.sourceCommentIds), []);
  assert.match(saved.note, /후보가 여러 명/);
  assert.equal(ctx.reserved.size, 0);
  assert.equal(shouldReviewVoiceSale(saved, comments), true);
});

test('missing price remains eligible for timed AI review with the original purchase evidence', async () => {
  const buyer = comment();
  const ctx = fixture([buyer]);
  await ctx.save();
  const saved = ctx.stored[0];
  assert.equal(shouldReviewVoiceSale(saved, [buyer]), true);
  assert.equal(isVoiceReviewReady(saved, [buyer], Date.parse(buyer.capturedAt) + 69_999), false);
  assert.equal(isVoiceReviewReady(saved, [buyer], Date.parse(buyer.capturedAt) + 70_000), true);
  const request = buildVoiceReviewRequest(saved, [buyer]);
  assert.equal(request.currentUtterance, speech);
  assert.equal(request.saleCandidates[0].buyerNickname, '가윤♡예준맘');
  assert.equal(request.saleCandidates[0].amount, 0);
  assert.equal(request.relevantComments[0].commentId, buyer.id);
  assert.equal(request.relevantComments[0].nickname, '가윤♡예준맘');
  assert.equal(request.relevantComments[0].isPurchaseIntent, true);
});

test('allocation binds the spoken buyer to the exact decorated comment identity instead of an earlier filler', async () => {
  const buyer = { ...comment('이뿌쥬~^^', 'ippuju-comment', 'ippuju-account'), content: 'ㅈㅇ' };
  const fillerBuyer = comment('이거', 'filler-comment', 'filler-account');
  const ctx = fixture([fillerBuyer, buyer]);
  await ctx.save(decoratedBuyerSpeech);
  assert.equal(ctx.stored.length, 1);
  const saved = ctx.stored[0];
  assert.equal(saved.status, '자동저장');
  assert.equal(saved.buyerNickname, '이뿌쥬~^^');
  assert.equal(saved.buyerId, buyer.buyerId);
  assert.equal(saved.amount, 8000);
  assert.equal(saved.unitPrice, 8000);
  assert.equal(saved.purchaseRequestId, `broadcast:${buyer.platformMessageId}`);
  assert.deepEqual(Array.from(saved.sourceCommentIds), [buyer.id]);
  assert.deepEqual(Array.from(saved.evidenceSnapshot.relevantCommentIds), [buyer.id]);
  assert.equal(saved.rawTranscript, decoratedBuyerSpeech);
  assert.equal(ctx.reserved.has(saved.purchaseRequestId), true);
  assert.equal(ctx.reserved.has(`broadcast:${fillerBuyer.platformMessageId}`), false);
});
