import test from 'node:test';
import { diagnosticGlobals } from './runtime-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { extractSpeechPrice } from '../src/services/priceEvidence.ts';
import { getPurchaseRequests, matchPurchaseRequest, matchCommentAuthor, areSameCommentAuthor } from '../src/services/purchaseFirstSales.ts';
import { advanceVoiceSaleTransaction, isProductChangeUtterance } from '../src/services/voiceSaleTransaction.ts';
import { announcesAdditionalPurchase, findRestatedVoiceSale } from '../src/services/voiceSaleRestatement.ts';
import { buildPendingReasons, buildEvidenceSnapshot } from '../src/services/pendingSalesService.ts';
import { getVoiceReviewRequests, shouldReviewVoiceSale, buildVoiceReviewRequest,
  isVoiceReviewReady } from '../src/services/voicePendingReviewService.ts';
import { generateSequentialProductName } from '../src/utils/productNaming.ts';
import { findCaptureForSale } from '../src/services/saleCapturePairing.ts';
import { resolveConfirmedBuyer, applyConfirmedBuyer, BUYER_LINK_PENDING, mergeBuyerComments } from '../src/services/confirmedBuyerResolver.ts';

// Exercise the actual persistence callback. Only storage, UI, and capture
// boundaries are mocked; sale extraction and comment matching remain real.
const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let reconcile;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'persistVoiceSale') {
    callback = node.initializer?.getText(file);
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'reconcileVoiceSaleComments') reconcile = node.initializer?.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(callback, 'The live persistence callback must be found in the source');
const compiled = ts.transpileModule(`const persistVoiceSale = ${callback}; const reconcile = ${reconcile}; module.exports = {persistVoiceSale, reconcile};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const speech = '언니, DM 왜 빵바지 보여줄게. 아니, 가까운 건 좋은데, 가윤 언니 챙겨줄게.';
const decoratedBuyerSpeech = '금액은 8,000원, 0.8. 이거 언니, 이뿌쥬 언니 챙겨드릴게요, 0.8.';
function comment(nickname = '가윤♡예준맘', id = 'purchase-comment', buyerId = 'buyer-account', content = '저요') {
  return { id, platformMessageId: id, buyerId, nickname, content, sessionId: 'broadcast',
    capturedAt: new Date(Date.now() - 1000).toISOString() };
}

function fixture(comments, activeProduct = undefined, captures = []) {
  const stored = [];
  const reserved = new Set();
  const captureRequests = [];
  const voiceSaleBoundaryAtRef = { current: '' };
  const globals = {
    ...diagnosticGlobals,
    extractSaleFromTranscript, extractSpeechPrice, getPurchaseRequests, matchPurchaseRequest, matchCommentAuthor, areSameCommentAuthor,
    resolveConfirmedBuyer, applyConfirmedBuyer, BUYER_LINK_PENDING, mergeBuyerComments, confirmedBuyerAliases: { get: () => [] },
    buildPendingReasons, buildEvidenceSnapshot, getVoiceReviewRequests, generateSequentialProductName, findCaptureForSale,
    announcesAdditionalPurchase, findRestatedVoiceSale,
    workspaceId: 'workspace', sales: [], currentWorkflowSalesRef: { current: stored },
    productSalesRef: { current: { activeSession: { id: 'broadcast', displayCode: '20261001-1' },
      activeProduct, feed: { comments: [] } } },
    currentSessionIdRef: { current: 'broadcast' }, recentVoiceDecisionsRef: { current: new Map() },
    reservedPurchaseRequestsRef: { current: reserved }, lastSavedSaleRef: { current: null },
    voiceTransactionSalesRef: {current: new Map()}, voiceSaleBoundaryAtRef,
    storageService: { getCommentRecords: () => comments, getPurchaseRequests: () => [], getCaptures: () => captures,
      linkCaptureToSale: (captureId, saleId) => { captures.find((entry) => entry.id === captureId).saleId = saleId; } },
    setRecentCaptures() {},
    getNextProductCodeForSession: () => '001',
    addSale: (value) => { const saved = { id: `sale-${stored.length + 1}`, syncStatus: 'PENDING', ...value }; stored.push(saved); return saved; },
    updateSale: (value) => { stored[stored.findIndex((entry) => entry.id === value.id)] = value; return value; },
    screenCaptureService: { getActiveStream: () => null },
    captureCurrentScreen: (...args) => { captureRequests.push(args); },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, ...globals });
  let transaction = null;
  let event = 0;
  return { stored, reserved, captureRequests, reconcile: module.exports.reconcile,
    fragment: async (text, at = new Date().toISOString()) => {
      if (isProductChangeUtterance(text)) voiceSaleBoundaryAtRef.current = at;
      const advanced = advanceVoiceSaleTransaction(transaction, {sessionId:'broadcast',eventId:String(++event),text,recognizedAt:at});
      transaction = advanced.state;
      if (advanced.emission) await module.exports.persistVoiceSale(advanced.emission.result,
        advanced.emission.result.rawTranscript, advanced.emission.captureRequested, 1, {
          id: advanced.emission.transactionId, startedAt: advanced.emission.startedAt,
          evidenceText: advanced.emission.evidenceText, continuation: advanced.emission.continuation,
          precedingTransactionId: advanced.emission.precedingTransactionId,
        });
    }, save: async (text = speech, capture = false, workflowContinuation) => {
    const extracted = extractSaleFromTranscript(text);
    assert.ok(extracted, 'The seller allocation must reach the live persistence callback');
    await module.exports.persistVoiceSale(extracted, text, capture, 1, undefined, workflowContinuation);
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

test('four-point confirmation consumes the matched purchase comment across repeated wording and reloads', async () => {
  const buyer = comment('러블리', 'lovely-comment', 'lovely-account');
  const live = fixture([buyer]);
  await live.save('러블리님 드릴게요 1.5. 캡처하세요.', true);
  const [saved] = live.stored;
  assert.equal(saved.status, '확정');
  assert.equal(saved.purchaseRequestId, 'broadcast:lovely-comment');
  assert.equal(live.reserved.has(saved.purchaseRequestId), true);
  await live.save('러블리님 확정이요 1.5. 캡처하세요.', true);
  assert.equal(live.stored.length, 1);
  // The stored identity must also suppress duplicates when the in-memory
  // reservation has gone away, as it does after restarting the listener.
  live.reserved.clear();
  await live.save('러블리님 드릴게요. 가격은 1.5. 캡처하세요.', true);
  assert.equal(live.stored.length, 1);
  assert.equal(live.captureRequests.length, 1);
});

test('four-point speech resolves the original nickname from a general comment anywhere in the same broadcast', async () => {
  const buyer = comment('꽃순이', 'flower-comment', 'flower-account', '안녕하세요');
  buyer.capturedAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const live = fixture([buyer]);
  await live.save('꼬순이님 1.0 드릴게요. 캡처하세요.', true);
  assert.equal(live.stored[0].status, '확정');
  assert.equal(live.stored[0].buyerNickname, '꽃순이');
  assert.equal(live.stored[0].buyerId, 'flower-account');
  assert.equal(live.stored[0].purchaseRequestId, undefined, 'never fabricate a purchase request from a greeting');
  assert.deepEqual(Array.from(live.stored[0].sourceCommentIds), ['flower-comment']);
  assert.equal(live.stored[0].evidenceSnapshot.buyerResolution.status, 'MATCHED');
  assert.equal(live.captureRequests.length, 1);
});

test('four-point speech retains sale confirmation when buyer identity is ambiguous or no comment has arrived', async () => {
  for (const comments of [[], [comment('꽃순이', 'one', 'one'), comment('꽃순이', 'two', 'two')]]) {
    const live = fixture(comments);
    await live.save('꼬순이님 1.0 드릴게요. 캡처하세요.', true);
    assert.equal(live.stored[0].status, '확정');
    assert.equal(live.stored[0].amount, 10000);
    assert.equal(live.stored[0].buyerNickname, BUYER_LINK_PENDING);
    assert.equal(live.stored[0].buyerId, undefined);
    assert.notEqual(live.stored[0].evidenceSnapshot.buyerResolution.status, 'MATCHED');
  }
});

for (const syncStatus of ['SYNCED', 'PENDING']) {
  test(`four-point continuation promotes the same ${syncStatus} pending purchase with fresh evidence and capture`, async () => {
    const buyer = comment('러블리', 'lovely-comment', 'lovely-account');
    const live = fixture([buyer]);
    await live.save('러블리님 드릴게요');
    const pending = live.stored[0];
    assert.equal(pending.status, '보류');
    assert.equal(pending.amount, 0);
    pending.syncStatus = syncStatus;
    const fullText = '러블리님 드릴게요 1.5. 캡처하세요.';
    await live.save(fullText, true);
    assert.equal(live.stored.length, 1);
    const [saved] = live.stored;
    assert.equal(saved.id, pending.id);
    assert.equal(saved.productCode, pending.productCode);
    assert.equal(saved.status, '확정');
    assert.equal(saved.amount, 15000);
    assert.equal(saved.purchaseRequestId, 'broadcast:lovely-comment');
    assert.equal(saved.pendingReasons.length, 0);
    assert.equal(saved.evidenceSnapshot.amount, 15000);
    assert.equal(saved.evidenceSnapshot.originalUtterance, fullText);
    assert.equal(saved.evidenceSnapshot.snapshotVersion, pending.evidenceSnapshot.snapshotVersion + 1);
    assert.equal(live.captureRequests.length, 1);
    assert.equal(live.captureRequests[0][3], pending.id);
    await live.save('러블리님 확정이요 1.5. 캡처하세요.', true);
    assert.equal(live.stored.length, 1);
    assert.equal(live.captureRequests.length, 1);
  });
}

test('ordinary price continuation still completes a pending purchase', async () => {
  const live = fixture([comment('러블리')]);
  await live.save('러블리님 드릴게요');
  const id = live.stored[0].id;
  await live.save('러블리님 15000원 드릴게요');
  assert.equal(live.stored.length, 1);
  assert.equal(live.stored[0].id, id);
  assert.equal(live.stored[0].status, '자동저장');
  assert.equal(live.stored[0].amount, 15000);
  assert.equal(live.captureRequests.length, 0);
});

for (const content of ['네', 'ㅇ', '안녕하세요']) {
  test(`four-point speech uses the comment author's real name without consuming "${content}" as a purchase`, async () => {
    const buyer = comment('하니💕', 'hani-comment', 'hani-account', content);
    const ctx = fixture([buyer]);
    await ctx.save('하니님 드릴게요 1.2. 캡처해주시고요.', true);
    assert.equal(ctx.stored[0].status, '확정');
    assert.equal(ctx.stored[0].buyerNickname, buyer.nickname);
    assert.equal(ctx.stored[0].buyerId, buyer.buyerId);
    assert.deepEqual(Array.from(ctx.stored[0].sourceCommentIds), [buyer.id]);
    assert.equal(ctx.stored[0].purchaseRequestId, undefined);
    assert.equal(ctx.reserved.size, 0);
  });
}

test('four-point identity ambiguity retains sale confirmation while waiting for the real account', async () => {
  const ctx = fixture([comment('하니', 'a', 'account-a', '네'), comment('하니', 'b', 'account-b', 'ㅇ')]);
  await ctx.save('하니님 드릴게요 1.2. 캡처해주세요.');
  assert.equal(ctx.stored[0].status, '확정');
  assert.equal(ctx.stored[0].evidenceSnapshot.buyerResolution.status, 'AMBIGUOUS');
  assert.equal(ctx.stored[0].buyerNickname, BUYER_LINK_PENDING);
  assert.equal(ctx.stored[0].buyerId, undefined);
  assert.equal(ctx.reserved.size, 0);
});

test('real Hani allocation, capture, and later price refine one row with the original speech time', async () => {
  const start = Date.now();
  const buyer = comment('하니💕', 'hani', 'hani-account', '네');
  const ctx = fixture([buyer], {id:'product', productCode:'001', name:'상품', unitPrice:10000});
  await ctx.fragment('네. 하니님, 이거 드릴게요. 캡처해 주시고요.', new Date(start).toISOString());
  assert.equal(ctx.stored[0].status, '보류');
  assert.equal(ctx.stored[0].amount, 0, 'Registered price must not preempt the following spoken price');
  const id = ctx.stored[0].id;
  await ctx.fragment("네. 맞으시면 'ᄋ' 한 번만. 하니님 드릴게요. 가격은 1.2, 캡처.", new Date(start + 18000).toISOString());
  assert.equal(ctx.stored.length, 1);
  assert.equal(ctx.stored[0].id, id);
  assert.equal(ctx.stored[0].status, '확정');
  assert.equal(ctx.stored[0].amount, 12000);
  assert.equal(ctx.stored[0].buyerNickname, buyer.nickname);
  assert.equal(ctx.stored[0].recognizedAt, new Date(start).toISOString());
  assert.match(ctx.stored[0].evidenceSnapshot.transactionUtterance, /캡처해 주시고요/);
  assert.match(ctx.stored[0].evidenceSnapshot.transactionUtterance, /가격은 1.2/);
  assert.equal(extractSaleFromTranscript(ctx.stored[0].rawTranscript).amount, 12000);
  assert.equal(ctx.captureRequests.length, 1);
});

test('split nickname, allocation, price and capture become one canonical sale; a new product remains separate', async () => {
  const ctx = fixture([comment('하니💕', 'hani', 'account', '네')]);
  for (const text of ['하니님.', '드릴게요.', '가격은 1.2입니다.', '캡처해주세요.']) await ctx.fragment(text);
  assert.equal(ctx.stored.length, 1);
  assert.equal(ctx.stored[0].status, '확정');
  assert.equal(ctx.stored[0].amount, 12000);
  assert.equal(ctx.stored[0].buyerNickname, '하니💕');
  await ctx.fragment('다음 상품입니다.');
  await ctx.fragment('하니님 드릴게요 1.0. 캡처해주시고요.');
  assert.equal(ctx.stored.length, 2);
  assert.deepEqual(ctx.stored.map(sale => sale.amount), [12000, 10000]);
});

test('capture continuation keeps the purchase request already allocated to this transaction', async () => {
  const comments = [comment('하니', 'first', 'account')];
  const ctx = fixture(comments);
  await ctx.fragment('하니님 드릴게요 1.2.');
  comments.push({...comment('하니', 'second', 'account'), capturedAt:new Date().toISOString()});
  await ctx.fragment('캡처해주세요.');
  assert.equal(ctx.stored.length, 1);
  assert.equal(ctx.stored[0].status, '확정');
  assert.equal(ctx.stored[0].purchaseRequestId, 'broadcast:first');
  assert.equal(ctx.reserved.has('broadcast:second'), false);
});

test('a later independent four-point transaction does not reuse or get blocked by a consumed purchase request', async () => {
  const ctx = fixture([comment('하니', 'first', 'account')]);
  await ctx.fragment('하니님 드릴게요 1.2. 캡처해주세요.');
  await ctx.fragment('다음 상품입니다.');
  await ctx.fragment('하니님 드릴게요 1.0.');
  await ctx.fragment('캡처해주세요.');
  assert.equal(ctx.stored.length, 2);
  assert.deepEqual(ctx.stored.map(sale => sale.amount), [12000, 10000]);
  assert.equal(ctx.stored[0].purchaseRequestId, 'broadcast:first');
  assert.equal(ctx.stored[1].purchaseRequestId, undefined);
  assert.equal(ctx.stored[1].buyerId, 'account');
  assert.equal(ctx.stored[1].status, '확정');
});

for (const content of ['ㅈㅇ', '네']) {
  test(`reworded four-point statements remain one transaction with ${content} evidence`, async () => {
    const ctx = fixture([comment('러블리', 'same-comment', 'same-account', content)]);
    await ctx.fragment('러블리님 드릴게요 1.5. 캡처해주세요.');
    await ctx.fragment('러블리님 확정이요 1.5. 캡처해주시고요.');
    assert.equal(ctx.stored.length, 1);
    assert.equal(ctx.captureRequests.length, 1);
    await ctx.fragment('다음 상품입니다.');
    await ctx.fragment('러블리님 드릴게요 1.5. 캡처해주세요.');
    assert.equal(ctx.stored.length, 2, 'The same customer and price still form a new sale after a product change');
  });
  test(`a priced ${content} sale is completed on its original row by a repeated four-point allocation`, async () => {
    const ctx = fixture([comment('하니', 'same-comment', 'same-account', content)]);
    await ctx.fragment('하니님 드릴게요 1.2.');
    const id = ctx.stored[0].id;
    await ctx.fragment('하니님 확정이요 1.2. 캡처해주세요.');
    assert.equal(ctx.stored.length, 1);
    assert.equal(ctx.stored[0].id, id);
    assert.equal(ctx.stored[0].status, '확정');
  });
}

for (const [gap, expected] of [[2_000, 1], [12_000, 2]]) {
  test(`a same-buyer same-price restatement ${gap / 1000}s later with a fresh "저요" makes ${expected} sale(s)`, async () => {
    // 10/17: the seller asked "저요, 한번만 더 해 주세요" and repeated the allocation
    // ten seconds later. Within 10 seconds that is the same sale, not a second one.
    const now = Date.now();
    const comments = [comment('하니', 'first', 'same-account')];
    const ctx = fixture(comments);
    await ctx.fragment('하니님 드릴게요 1.2. 캡처해주세요.', new Date(now).toISOString());
    comments.push({...comment('하니', 'new-purchase', 'same-account'), capturedAt:new Date(now + 1000).toISOString()});
    await ctx.fragment('하니님 확정이요 1.2. 캡처해주세요.', new Date(now + gap).toISOString());
    assert.equal(ctx.stored.length, expected);
    assert.equal(ctx.stored[0].purchaseRequestId, 'broadcast:first');
    if (expected === 1) assert.ok(ctx.reserved.has('broadcast:new-purchase'), 'The repeated comment is used up');
    else assert.equal(ctx.stored[1].purchaseRequestId, 'broadcast:new-purchase');
  });
}

test('"하나 더" within 10 seconds still makes a new sale for the same buyer', async () => {
  const now = Date.now();
  const comments = [comment('하니', 'first', 'same-account')];
  const ctx = fixture(comments);
  await ctx.fragment('하니님 드릴게요 1.2. 캡처해주세요.', new Date(now).toISOString());
  comments.push({...comment('하니', 'new-purchase', 'same-account'), capturedAt:new Date(now + 1000).toISOString()});
  await ctx.fragment('하니님 하나 더 드릴게요 1.2. 캡처해주세요.', new Date(now + 3000).toISOString());
  assert.equal(ctx.stored.length, 2);
});

test('10/17 꽃심이: a price spoken before the nickname, after a reset, stays on the first sale', async () => {
  const now = Date.now();
  const comments = [comment('꽃심이', 'first', 'kkot')];
  const ctx = fixture(comments);
  await ctx.fragment('가방을 이거 꼬심이님 드릴게요. 1.0', new Date(now).toISOString());
  await ctx.fragment('저요, 한번만 더 해 주세요.', new Date(now + 4000).toISOString());
  comments.push({...comment('꽃심이', 'again', 'kkot'), capturedAt:new Date(now + 6000).toISOString()});
  await ctx.fragment('캡처해 주시고, 가방, 아니, 가격은 1.0 드릴게요. 꼬심이님 드릴게요.', new Date(now + 10_000).toISOString());
  assert.equal(ctx.stored.length, 1);
  assert.equal(ctx.stored[0].buyerNickname, '꽃심이');
  assert.equal(ctx.stored[0].amount, 10000);
});

test('an exact ordinary commenter never receives another account\'s similar-name purchase request', async () => {
  const comments = [comment('넥스트', 'purchase', 'buyer-b', 'ㅈㅇ'), comment('네스트', 'ordinary', 'buyer-a', '네')];
  for (const fourPoint of [true, false]) {
    const ctx = fixture(comments);
    await ctx.save(`네스트님 드릴게요 1.2.${fourPoint ? ' 캡처해주세요.' : ''}`);
    assert.equal(ctx.stored[0].buyerNickname, '네스트');
    assert.equal(ctx.stored[0].buyerId, 'buyer-a');
    assert.equal(ctx.stored[0].purchaseRequestId, undefined);
    assert.equal(ctx.stored[0].status, fourPoint ? '확정' : '보류');
    assert.deepEqual(Array.from(ctx.stored[0].sourceCommentIds), ['ordinary']);
    assert.equal(ctx.reserved.size, 0);
  }
  const late = [];
  const ctx = fixture(late);
  await ctx.save('네스트님 드릴게요 1.2. 캡처해주세요.');
  late.push(...comments);
  ctx.reconcile();
  assert.equal(ctx.stored[0].buyerId, 'buyer-a');
  assert.equal(ctx.stored[0].purchaseRequestId, undefined);
});

test('late reconciliation cannot allocate a repeated thirty-second purchase comment to another sale', async () => {
  const now = Date.now();
  const comments = [
    {...comment('하니', 'first', 'account'), capturedAt:new Date(now - 5000).toISOString()},
    {...comment('하니', 'repeat', 'account'), capturedAt:new Date(now - 4000).toISOString()},
  ];
  const ctx = fixture(comments);
  await ctx.fragment('하니님 드릴게요 1.0.', new Date(now).toISOString());
  const pending = {...ctx.stored[0], id:'pending-other', purchaseRequestId:undefined,
    sourceCommentIds:[], status:'보류', rawTranscript:'하니님 드릴게요 1.2.', amount:12000, unitPrice:12000};
  ctx.stored.push(pending);
  ctx.reconcile();
  assert.equal(ctx.stored[1].status, '보류');
  assert.equal(ctx.stored[1].purchaseRequestId, undefined);
});

test('capture completion cannot transfer an allocated purchase to a newly appearing different exact-name account', async () => {
  const now = Date.now();
  const comments = [comment('넥스트', 'purchase', 'buyer-b', 'ㅈㅇ')];
  const ctx = fixture(comments);
  await ctx.fragment('네스트님 드릴게요 1.2.', new Date(now).toISOString());
  assert.equal(ctx.stored[0].buyerId, 'buyer-b');
  comments.push({...comment('네스트', 'ordinary', 'buyer-a', '네'), capturedAt:new Date(now + 1000).toISOString()});
  await ctx.fragment('캡처해주세요.', new Date(now + 2000).toISOString());
  assert.equal(ctx.stored.length, 1);
  assert.equal(ctx.stored[0].buyerId, 'buyer-b');
  assert.equal(ctx.stored[0].purchaseRequestId, 'broadcast:purchase');
  assert.equal(ctx.stored[0].sourceCommentIds.includes('ordinary'), false);
});

test('one reconciliation pass claims repeated comments before promoting another pending row', async () => {
  const now = Date.now();
  const comments = [];
  const ctx = fixture(comments);
  await ctx.fragment('하니님 드릴게요 1.0.', new Date(now).toISOString());
  await ctx.fragment('하니님 드릴게요 1.2.', new Date(now + 1000).toISOString());
  comments.push(
    {...comment('하니', 'first', 'account'), capturedAt:new Date(now - 5000).toISOString()},
    {...comment('하니', 'repeat', 'account'), capturedAt:new Date(now - 4000).toISOString()},
  );
  ctx.reconcile();
  assert.equal(ctx.stored.filter(sale => sale.status === '자동저장').length, 1);
  assert.equal(ctx.stored.filter(sale => sale.status === '보류').length, 1);
});

for (const offset of [-300000, -300001, 10000, 10001]) {
  test(`comment author time boundary ${offset}ms is evaluated against the original seller speech`, async () => {
    const start = Date.now();
    const comments = [{...comment('하니💕', 'timed', 'account', '네'), capturedAt:new Date(start + offset).toISOString()}];
    const ctx = fixture(comments);
    await ctx.fragment('하니님 드릴게요 1.2. 캡처해주세요.', new Date(start).toISOString());
    const allowed = offset <= 10000; // Four-point identity searches the entire current broadcast.
    assert.equal(ctx.stored[0].buyerId, allowed ? 'account' : undefined);
    assert.equal(ctx.stored[0].buyerNickname, allowed ? '하니💕' : BUYER_LINK_PENDING);
  });
}

test('a late-delivered ordinary reply verifies a four-point sale without a second row or purchase request', async () => {
  const start = Date.now();
  const comments = [];
  const ctx = fixture(comments);
  await ctx.fragment('하니님 드릴게요 1.2. 캡처해주세요.', new Date(start).toISOString());
  const id = ctx.stored[0].id;
  comments.push({...comment('하니💕', 'late', 'account', '네'), capturedAt:new Date(start + 8000).toISOString()});
  ctx.reconcile();
  assert.equal(ctx.stored.length, 1);
  assert.equal(ctx.stored[0].id, id);
  assert.equal(ctx.stored[0].buyerNickname, '하니💕');
  assert.equal(ctx.stored[0].buyerId, 'account');
  assert.equal(ctx.stored[0].purchaseRequestId, undefined);
  assert.equal(ctx.reserved.size, 0);
  const snapshot = ctx.stored[0].evidenceSnapshot.snapshotVersion;
  ctx.reconcile();
  assert.equal(ctx.stored[0].evidenceSnapshot.snapshotVersion, snapshot);
});

test('a late reply after ten seconds or an incomplete seller confirmation cannot promote a sale', async () => {
  for (const [speechText, offset] of [['하니님 드릴게요 1.2. 캡처해주세요.', 10001], ['하니님 드릴게요 1.2.', 8000]]) {
    const start = Date.now();
    const comments = [];
    const ctx = fixture(comments);
    await ctx.fragment(speechText, new Date(start).toISOString());
    const before = ctx.stored[0];
    comments.push({...comment('하니💕', 'late', 'account', '네'), capturedAt:new Date(start + offset).toISOString()});
    ctx.reconcile();
    assert.equal(ctx.stored[0], before);
  }
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

test('sales made during a broadcast see the latest list, not the list from listening start', async () => {
  const live = fixture([comment('햇살', 'first-comment', 'first-buyer'), comment('구름', 'second-comment', 'second-buyer')]);
  await live.save('햇살 언니 1.2 챙겨드릴게요.');
  await live.save('구름 언니 1.5 챙겨드릴게요.');
  assert.equal(live.stored.length, 2);
  assert.deepEqual(live.stored.map((sale) => sale.productCode), ['001', '002']);
  assert.deepEqual(live.stored.map((sale) => sale.status), ['자동저장', '자동저장']);
});

test('a quantity and option purchase comment is confirmed at the spoken amount', async () => {
  const live = fixture([comment('이뿌쥬', 'option-comment', 'option-buyer', '빨강 2개 저요')]);
  await live.save('이뿌쥬 언니 빨강 두 개 2만원 챙겨드릴게요.');
  assert.equal(live.stored.length, 1);
  const [sale] = live.stored;
  assert.equal(sale.status, '자동저장');
  assert.equal(sale.buyerNickname, '이뿌쥬');
  assert.equal(sale.amount, 20000);
  assert.match(sale.note, /빨강 2개 저요/u);
});

test('a spoken price wins over the registered product price, even after a repeated allocation', async () => {
  const product = { id: 'product', productCode: '001', name: '상품', unitPrice: 3000 };
  const linked = fixture([comment('햇반', 'c-1', 'buyer-1')], product);
  await linked.save('있는 이런 니트 가디건 1.2. 네. 네, 이거 햇반님 드릴게요. 햇반님 드릴게요. 가격은 1.2.');
  assert.equal(linked.stored[0].amount, 12000);
  assert.equal(linked.stored[0].status, '자동저장');

  // A price the extractor could not tie to this allocation must not silently
  // become the registered product price.
  const unlinked = fixture([comment('햇반', 'c-2', 'buyer-2')], product);
  await unlinked.save('햇반님 드릴게요. 니트는 원래 1.5인데요.');
  assert.notEqual(unlinked.stored[0]?.amount, 3000);
});

test('a spaced commenter nickname is confirmed whole, and an unmatched spoken name stays pending', async () => {
  const speech = '안녕하세요. 0.8, 이거 성훈 맘님 드릴게요. 가격은 0.8';
  const buyer = comment('성훈 맘', 'sunghoon-comment', 'sunghoon-account', 'ㅈㅇ');
  const matched = fixture([buyer]);
  await matched.save(speech);
  assert.equal(matched.stored[0].status, '자동저장');
  assert.equal(matched.stored[0].buyerNickname, '성훈 맘');
  assert.equal(matched.stored[0].amount, 8000);

  // No purchase comment matches the spoken name: never auto-save it.
  const unmatched = fixture([comment('다른고객', 'other-comment', 'other-account', 'ㅈㅇ')]);
  await unmatched.save(speech);
  assert.equal(unmatched.stored[0].status, '보류');
  assert.equal(unmatched.stored[0].buyerNickname, '맘');
  assert.equal(unmatched.stored[0].purchaseRequestId, undefined);
  assert.ok(unmatched.stored[0].pendingReasons.some((reason) => reason.code === 'DELAYED_COMMENT'));
});

test('a "capture" shot taken within 10 seconds before the sale becomes its image 1; older shots are ignored', async () => {
  const now = Date.now();
  const captures = [
    { id: 'recent', sessionId: 'broadcast', imageUrl: 'data:recent', capturedAt: new Date(now - 3000).toISOString(), purpose: 'SALE' },
    { id: 'previous-buyer', sessionId: 'broadcast', imageUrl: 'data:old', capturedAt: new Date(now - 30000).toISOString(), purpose: 'SALE' },
  ];
  const live = fixture([comment('햇반', 'c-1', 'buyer-1')], undefined, captures);
  await live.save('햇반님 드릴게요. 가격은 1.2.');
  assert.equal(live.stored[0].productImageUrl, 'data:recent');
  assert.deepEqual(Array.from(live.stored[0].captureImageUrls), ['data:recent']);
  assert.equal(captures[0].saleId, live.stored[0].id);

  const none = fixture([comment('햇반', 'c-2', 'buyer-2')], undefined, [captures[1]]);
  await none.save('햇반님 드릴게요. 가격은 1.2.');
  assert.equal(none.stored[0].productImageUrl, undefined);
  assert.equal(none.stored[0].captureImageUrls, undefined);
});
