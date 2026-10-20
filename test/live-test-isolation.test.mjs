import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { confirmVoiceTextReviewSale } from '../src/services/voicePendingReviewService.ts';

class WebStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] || null; }
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}
globalThis.localStorage = new WebStorage();
globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
globalThis.BroadcastChannel = undefined;
const forbidden = [];
globalThis.fetch = (...args) => { forbidden.push(args); throw new Error('A local test must not use a cloud transport'); };

const bundle = await build({ stdin: { contents: `
  export { LocalTestDatabase } from './src/services/liveTest/localTestDatabase';
  export { StorageService } from './src/services/storageService';
  export { createLocalTestRepositories, localOnlyAdapter } from './src/services/liveTest/localTestRepositories';
  export { createCommentSyncService } from './src/services/commentSyncService';
  export { SimulatedCommentSource } from './src/services/liveTest/simulatedCommentSource';
  export { prepareVoicePendingReview } from './src/services/voicePendingReviewCore';
  export { SalesSyncController } from './src/services/salesSyncController';
  export { heldAfterServerRejection } from './src/services/serverRejectedSale';
  export { extractSaleFromTranscript } from './src/services/salesExtractor';
  export { SttDiagnostics } from './src/services/sttDiagnostics';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'deny-cloud', setup(builder) {
    builder.onResolve({ filter: /supabaseClient$/ }, args => ({ path: args.path, namespace: 'deny-cloud' }));
    builder.onLoad({ filter: /.*/, namespace: 'deny-cloud' }, () => ({ contents: `
      export const isSupabaseConfigured = true;
      export const requireSupabase = () => { throw new Error('Operating Supabase was accessed'); };
    ` }));
  } }] });
const { LocalTestDatabase, StorageService, createLocalTestRepositories, localOnlyAdapter, createCommentSyncService,
  SimulatedCommentSource, prepareVoicePendingReview, SalesSyncController, heldAfterServerRejection, extractSaleFromTranscript, SttDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

async function fixture(infer = async () => { throw new Error('No AI answer configured'); }, owner = crypto.randomUUID()) {
  const db = new LocalTestDatabase(owner);
  await db.restore();
  const workspaceId = `local-test:${owner}`;
  const storage = new StorageService({ durable: db.durable, webStorage: db.web });
  storage.setWorkspaceId(workspaceId);
  await storage.restoreWorkspace(workspaceId);
  const repo = createLocalTestRepositories(db, storage, workspaceId, infer, () => null);
  const api = localOnlyAdapter(repo.product);
  const sync = createCommentSyncService(storage, api);
  const { session } = storage.getActiveSession(workspaceId) ? { session: storage.getActiveSession(workspaceId) }
    : await api.startSession(crypto.randomUUID());
  const comment = { sessionId: session.id, platformMessageId: crypto.randomUUID(), platformUserId: 'account-mint',
    nickname: '민트', content: '저요', capturedAt: new Date(Date.now() - 2000).toISOString(), ingestSequence: 1 };
  return { owner, db, storage, workspaceId, repo, api, sync, session, comment };
}
async function ingest(f, comment = f.comment) {
  f.sync.enqueueCloudComment(f.workspaceId, comment);
  await f.sync.flushPendingComments(f.workspaceId);
  return f.storage.getSessionCommentRecords(f.session.id, f.workspaceId).find(c => c.platformMessageId === comment.platformMessageId);
}
function sale(f, changes = {}) {
  return { id: `s-${crypto.randomUUID()}`, sessionId: f.session.id,
    buyerNickname: '민트', amount: 15000, unitPrice: 15000, quantity: 1,
    rawTranscript: '민트 언니, 이거 챙겨드릴게요. 금액은 1.5.', recognizedAt: new Date().toISOString(),
    source: 'WEB_VOICE', status: '자동저장', recordState: 'ACTIVE', revision: 1,
    purchaseRequestId: `${f.session.id}:${f.comment.platformMessageId}`, printStatus: 'QUEUED', printRevision: 1, ...changes };
}

test('a test session, canonical comment, transcript and validated sale persist only in the separate local DB', async () => {
  const before = [...localStorage.values];
  const f = await fixture();
  assert.match(f.session.displayCode, /테스트 1회차$/);
  const comment = await ingest(f);
  assert.ok(comment.buyerId);
  assert.equal(f.storage.getCommentOutbox(f.workspaceId).length, 0);
  const record = sale(f);
  assert.equal(extractSaleFromTranscript(record.rawTranscript).amount, 15000);
  await f.repo.commitSale(record);
  await f.repo.remote.saveCloudSessionTranscripts(f.workspaceId, f.session.id, [{ id: 'log', text: record.rawTranscript, timestamp: record.recognizedAt, isFinal: true, confidence: 1 }]);
  const restored = await fixture(undefined, f.owner);
  assert.equal(restored.session.id, f.session.id);
  assert.equal((await restored.repo.storedSales())[0].sourceCommentIds[0], comment.id);
  assert.equal(restored.storage.getSessionTranscripts(f.workspaceId, f.session.id).length, 1);
  assert.equal(restored.storage.getSessionCommentRecords(f.session.id, f.workspaceId).length, 1);
  assert.deepEqual([...localStorage.values], before);
  assert.equal(forbidden.length, 0);
});

test('test commits reject missing comments, incorrect prices and a reused purchase request', async () => {
  const f = await fixture();
  await assert.rejects(f.repo.commitSale(sale(f)), error => error.code === 'BUYER_AMBIGUOUS');
  await ingest(f);
  await assert.rejects(f.repo.commitSale(sale(f, { amount: 17000, unitPrice: 17000 })), error => error.code === 'PRICE_OR_INTENT_UNVERIFIED');
  await f.repo.commitSale(sale(f));
  await assert.rejects(f.repo.commitSale(sale(f)), error => ['REQUEST_ALREADY_ALLOCATED', 'REPEATED_INTENT_ALREADY_ALLOCATED'].includes(error.code));
  assert.equal((await f.repo.storedSales()).length, 1);
  assert.equal(forbidden.length, 0);
});

test('a successful voice commit is idempotent and a changed retry cannot rewrite its evidence', async () => {
  const f = await fixture();
  await ingest(f);
  const record = sale(f);
  await f.repo.commitSale(record);
  await f.repo.commitSale(record);
  assert.equal((await f.repo.storedSales()).length, 1);
  await assert.rejects(f.repo.commitSale({ ...record, amount: 17000, unitPrice: 17000 }), error => error.code === 'OPERATION_PAYLOAD_MISMATCH');
  assert.equal((await f.repo.storedSales())[0].amount, 15000);
});

test('the existing sync controller marks rejected test sales for review using the operating fallback', async () => {
  const f = await fixture();
  const diagnostics = new SttDiagnostics();
  const diagnosticScope = { workspaceId: f.workspaceId, sessionId: f.session.id, mode: 'TEST' };
  const controller = new SalesSyncController({ scope: f.workspaceId,
    read: () => f.storage.getSalesLocalState(f.workspaceId), persist: state => f.storage.saveSalesLocalState(f.workspaceId, state),
    update: change => f.storage.updateSalesLocalState(f.workspaceId, change),
    save: record => f.repo.remote.saveSale(f.workspaceId, record), load: f.repo.storedSales,
    remove: id => f.repo.remote.deleteSale(f.workspaceId, id), changed() {}, error() {},
    fallback: heldAfterServerRejection, active: () => true, diagnostic: diagnostics.sink(diagnosticScope) });
  controller.upsert(sale(f));
  await controller.flush();
  const saved = (await f.repo.storedSales())[0];
  assert.equal(saved.status, '자동저장');
  assert.equal(saved.printStatus, 'NOT_REQUESTED');
  assert.equal(saved.purchaseRequestId, undefined);
  assert.match(saved.note, /서버|검토|확인/);
  const report = await diagnostics.export(diagnosticScope);
  assert.equal(report.scope.mode, 'TEST');
  assert.ok(report.events.some(event => event.stage === 'sale.save.failed'));
  assert.ok(report.events.some(event => event.stage === 'sale.fallback.applied'));
  assert.equal(report.events.find(event => event.stage === 'sale.save.acknowledged').detail.saleId, saved.id);
  assert.equal((await diagnostics.export({ ...diagnosticScope, mode: 'PRODUCTION' })).eventCount, 0);
  assert.equal(forbidden.length, 0);
});

test('pending review waits for the same window, uses the same prompt, and saves actual AI outcomes locally', async () => {
  let calls = 0, received;
  const f = await fixture(async payload => {
    calls++; received = payload;
    return { task: { taskId: 'test-task', activeSlot: 1, status: 'RESOLVED', attempts: [],
      resolutionResult: { evidenceSummary: '닉네임: 민트\n가격: 15,000원' } } };
  });
  await ingest(f);
  let pending = sale(f, { status: '보류', printStatus: 'NOT_REQUESTED', printRevision: 0 });
  await f.repo.commitSale(pending);
  assert.equal((await f.repo.ai.triggerPendingAiResolution(pending.id)).waitingForWindow, true);
  assert.equal(calls, 0);
  pending = { ...pending, recognizedAt: new Date(Date.now() - 65_000).toISOString() };
  await f.repo.commitSale(pending);
  const comment = { ...f.comment, capturedAt: new Date(Date.now() - 66_000).toISOString(), platformMessageId: f.comment.platformMessageId };
  await f.api.ingestComments({ sessionId: f.session.id, comments: [comment] });
  const comments = f.storage.getSessionCommentRecords(f.session.id, f.workspaceId);
  const expected = prepareVoicePendingReview(pending, comments, [], '', f.workspaceId);
  const result = await f.repo.ai.triggerPendingAiResolution(pending.id);
  assert.equal(calls, 1);
  assert.equal(received.request.plainTextPrompt, expected.request.plainTextPrompt);
  assert.equal(result.sale.aiVerification.candidateAmount, 15000);
  assert.equal(result.sale.aiVerification.nicknameVerified, true);
  assert.equal((await f.db.read('ai-tasks', []))[0].taskId, 'test-task');
  assert.equal(forbidden.length, 0);
});

test('a late AI response cannot overwrite a corrected sale or a deleted record', async () => {
  let finish;
  const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  await ingest(f);
  const pending = sale(f, { status: '보류', printStatus: 'NOT_REQUESTED', printRevision: 0 });
  await f.repo.commitSale(pending);
  const review = f.repo.ai.triggerPendingAiResolution(pending.id, { forceReanalyze: true });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await f.repo.commitSale({ ...pending, revision: 2, amount: 17000, status: '수동수정' });
  finish({ task: { taskId: 'late', activeSlot: 1, status: 'RESOLVED', attempts: [], resolutionResult: { evidenceSummary: '닉네임: 민트\n가격: 15,000원' } } });
  assert.equal((await review).skipped, true);
  assert.equal((await f.repo.storedSales())[0].amount, 17000);
});

test('AI transport errors remain review failures with local task history and can be retried', async () => {
  const f = await fixture(async () => { throw new Error('테스트 AI 연결 실패'); });
  await ingest(f);
  const pending = sale(f, { status: '보류', printStatus: 'NOT_REQUESTED', printRevision: 0 });
  await f.repo.commitSale(pending);
  const result = await f.repo.ai.triggerPendingAiResolution(pending.id, { forceReanalyze: true });
  assert.equal(result.sale.status, '보류');
  assert.equal(result.sale.aiVerification.errorMessage, '테스트 AI 연결 실패');
  const tasks = await f.db.read('ai-tasks', []);
  assert.equal(tasks[0].status, 'FAILED');
  assert.equal(tasks[0].failureReason, '테스트 AI 연결 실패');
  assert.equal(forbidden.length, 0);
});

test('the simulated source emits comment inputs only, stops promptly, and keeps physical print requests local', async () => {
  const f = await fixture();
  const prints = [], comments = [];
  const stream = new SimulatedCommentSource(async request => { prints.push(request); });
  stream.onComment(comment => comments.push(comment));
  stream.connect('unused'); stream.startCollecting('unused'); stream.stopCollecting();
  assert.equal(comments.length, 1);
  assert.equal(comments[0].content, '저요');
  assert.ok(comments[0].uniqueId);
  assert.equal('sale' in comments[0], false);
  const printed = await stream.printSale({ saleId: 'local', amount: 15000, printRevision: 1, buyerNickname: '민트', recognizedAt: new Date().toISOString() });
  assert.equal(printed.ok, true); assert.equal(prints.length, 1);
  stream.disconnect();
  assert.equal(stream.isConnectedToServer, false);
  assert.equal(forbidden.length, 0);
});

test('local adapters fail closed for unimplemented operations and account data stays separate', async () => {
  assert.throws(() => localOnlyAdapter({}).saveOperatingData(), /테스트 환경/);
  const first = await fixture(); await ingest(first); await first.repo.commitSale(sale(first));
  const second = await fixture();
  assert.deepEqual(await second.repo.storedSales(), []);
  assert.deepEqual(second.storage.getCommentRecords(second.workspaceId), []);
  assert.equal(forbidden.length, 0);
});

test('test-mode AI cannot replace a star trade with sky; the correct split price can resolve it locally', async () => {
  let answer = '닉네임: 하늘\n가격: 50000원';
  const f = await fixture(async payload => ({ task: { taskId: payload.taskId, saleId: payload.sale.id,
    sessionId: payload.sale.sessionId, saleRevision: payload.sale.revision, activeSlot: 1, status: 'RESOLVED',
    attempts: [], resolutionResult: { targetSaleId: payload.sale.id, evidenceSummary: answer } } }));
  const when = Date.now() - 10_000;
  f.comment = { ...f.comment, nickname: '별이', capturedAt: new Date(when - 1000).toISOString() };
  const canonical = await ingest(f);
  await ingest(f, { ...f.comment, nickname: '하늘', platformUserId: 'sky-account', platformMessageId: 'sky-message' });
  const pending = sale(f, { buyerNickname: '별이', buyerId: canonical.buyerId, sourceCommentIds: [canonical.id],
    status: '보류', amount: 0, unitPrice: 0, printStatus: 'NOT_REQUESTED', printRevision: 0,
    rawTranscript: '네, 이거 별이님 드릴게요. 감사합니다.', recognizedAt: new Date(when).toISOString() });
  await f.repo.commitSale(pending);
  await f.repo.remote.saveCloudSessionTranscripts(f.workspaceId, f.session.id, [
    { id: 'sky', text: '하늘님 5.0 드릴게요.', timestamp: new Date(when - 5000).toISOString(), isFinal: true },
    { id: 'star-price', text: '가격 1.2 캡처해주세요.', timestamp: new Date(when + 3000).toISOString(), isFinal: true },
  ]);
  const rejected = await f.repo.ai.triggerPendingAiResolution(pending.id, { forceReanalyze: true });
  assert.equal(rejected.sale.buyerNickname, '별이');
  assert.equal(rejected.sale.amount, 0);
  assert.equal(rejected.sale.purchaseRequestId, pending.purchaseRequestId);
  assert.equal(confirmVoiceTextReviewSale(rejected.sale), null);
  answer = '닉네임: 별이\n가격: 12000원';
  const accepted = await f.repo.ai.triggerPendingAiResolution(pending.id, { forceReanalyze: true });
  assert.equal(accepted.sale.buyerNickname, '별이');
  assert.equal(accepted.sale.amount, 12000);
  assert.equal(accepted.sale.purchaseRequestId, pending.purchaseRequestId);
  assert.equal(confirmVoiceTextReviewSale({ ...accepted.sale, syncStatus: 'SYNCED' }).status, '확정');
  assert.equal(forbidden.length, 0);
});

test('a legacy confirmed test sale is previewed and corrected locally without calling AI or changing production', async () => {
  let inferenceCalls = 0;
  const f = await fixture(async () => { inferenceCalls++; throw new Error('Recovery must not call AI'); });
  const when = Date.now() - 10_000;
  f.comment = { ...f.comment, nickname: '별이', capturedAt: new Date(when - 1000).toISOString() };
  const star = await ingest(f);
  const sky = await ingest(f, { ...f.comment, nickname: '하늘', platformUserId: 'sky-account', platformMessageId: 'sky-request' });
  const original = sale(f, { status: '보류', amount: 0, buyerNickname: '별이', rawTranscript: '네, 이거 별이님 드릴게요. 감사합니다.',
    recognizedAt: new Date(when).toISOString() });
  await f.repo.commitSale(original);
  const history = [{ revision: 2, changedBy: 'AI', changeType: 'AI_RESOLVE',
    before: { buyerNickname: '별이', amount: 0, status: '보류' }, after: { buyerNickname: '하늘', amount: 50000, status: '보류' } },
    { revision: 3, changedBy: 'AI', changeType: 'AI_RESOLVE', before: { buyerNickname: '하늘', amount: 50000, status: '보류' },
      after: { buyerNickname: '하늘', amount: 50000, status: '확정' } }];
  await f.db.update('sales', [], records => records.map(s => ({ ...s, status: '확정', revision: 4, buyerNickname: '하늘', buyerId: sky.buyerId,
    amount: 50000, unitPrice: 50000, purchaseRequestId: `${f.session.id}:sky-request`, sourceCommentIds: [sky.id],
    printStatus: 'PRINTED', printRevision: 1, history, aiVerification: { reviewMode: 'TEXT_PROMPT', aiStatus: 'RESOLVED' } })));
  await f.repo.remote.saveCloudSessionTranscripts(f.workspaceId, f.session.id, [{ id: 'star-price', text: '가격 1.2 캡처해주세요.',
    timestamp: new Date(when + 3000).toISOString(), isFinal: true }]);
  const reviewed = await f.repo.ai.triggerPendingAiResolution(original.id, { confirmedAiRecovery: 'PREVIEW', expectedRevision: 4 });
  assert.equal(reviewed.sale.buyerNickname, '하늘');
  assert.equal(reviewed.sale.amount, 50000);
  assert.equal(reviewed.sale.status, '확정');
  assert.equal(reviewed.sale.aiVerification.candidateBuyer.nickname, '별이');
  assert.equal(reviewed.sale.aiVerification.candidateAmount, 12000);
  const fp = reviewed.sale.aiVerification.recoveryReview.candidateFingerprint;
  // The candidate survives a local DB reload before seller approval.
  const restored = await fixture(undefined, f.owner);
  const corrected = await restored.repo.ai.triggerPendingAiResolution(original.id, { confirmedAiRecovery: 'APPLY', expectedRevision: 4,
    expectedRecoveryFingerprint: fp });
  assert.equal(corrected.sale.id, original.id);
  assert.equal(corrected.sale.buyerNickname, '별이');
  assert.equal(corrected.sale.buyerId, star.buyerId);
  assert.equal(corrected.sale.amount, 12000);
  assert.equal(corrected.sale.purchaseRequestId, original.purchaseRequestId);
  assert.deepEqual(corrected.sale.sourceCommentIds, [star.id]);
  assert.equal(corrected.sale.status, '확정');
  assert.equal(corrected.sale.revision, 5);
  assert.equal(corrected.sale.history.at(-1).changedBy, 'SELLER');
  assert.equal((await restored.repo.storedSales()).length, 1);
  await assert.rejects(restored.repo.ai.triggerPendingAiResolution(original.id, { confirmedAiRecovery: 'APPLY', expectedRevision: 4,
    expectedRecoveryFingerprint: fp }), error => error.code === 'RECOVERY_CONFLICT');
  assert.equal(inferenceCalls, 0);
  assert.equal(forbidden.length, 0);
});
