import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/sellerLogicApi.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'seller-logic-api-fixture', setup(builder) {
    builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const isSupabaseConfigured = true;
      export const requireSupabase = () => ({ functions: {
        invoke: (...args) => globalThis.sellerLogicApiFixture.invoke(...args)
      }});`,
    }));
  } }],
});
const { analyzeSellerLogic, analyzeSellerLogicEvidence, getSellerLogicSlots } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const success = (data) => ({ data: { ok: true, data }, error: null });
const failed = (message) => ({ data: { ok: false, error: { code: 'AI_PROVIDER_ERROR', message } }, error: null });
const pending = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const input = (slotNumber = 2) => ({
  sessionId: 'session-api-test', slotNumber,
  comments: [{ id: 'c0', sessionId: 'session-api-test', nickname: '😚JJEONG😚', content: '저용', capturedAt: '2026-10-05T14:00:01Z' }],
  transcripts: [{ id: 's0', text: '정원이 언니 바지 이만원 드릴게요.', recognizedAt: '2026-10-05T14:00:02Z', isFinal: true, utteranceEnded: true, revision: 1 }],
});
const detected = (packet, signals = true) => ({
  signals: signals ? [{ id: 'slsig:api-fixture', summary: '구매 댓글과 판매자 호명이 이어짐',
    commentIds: packet.freshCommentIds, transcriptIds: packet.freshTranscriptIds }] : [],
  carry: [], summary: '1차 탐지 완료', provider: 'TEST', model: `saved-slot-${packet.slotNumber}`, appliedVersion: 7,
});
const response = (packet) => ({
  decisions: [...(packet.previousDecisions || [])],
  purchaseIntentCommentIds: packet.analysisState?.purchaseIntentCommentIds || [],
  summary: '확인 완료', provider: 'TEST', model: `saved-slot-${packet.slotNumber}`, hasMore: false,
  analysisState: {
    processedCommentIds: packet.comments.map((row) => row.id), processedTranscriptIds: packet.transcripts.map((row) => row.id),
    memory: packet.analysisState?.memory || [], purchaseIntentCommentIds: packet.analysisState?.purchaseIntentCommentIds || [],
    slotNumber: packet.slotNumber, appliedVersion: 7,
  },
});
const linked = (packet) => ({
  ...response(packet), purchaseIntentCommentIds: ['c0'],
  decisions: [{ id: 'transaction-api-fixture', status: 'CONFIRMED', nickname: '😚JJEONG😚', unitPrice: 20_000,
    quantity: 1, productName: '바지', reason: '원문 댓글과 판매자 확정 발화를 연결함',
    commentIds: ['c0'], transcriptIds: ['s0'], decidedAt: '2026-10-05T14:00:02Z' }],
  signalLinks: packet.linkSignals.map((signal) => ({ signalId: signal.id, outcome: 'MATCHED', decisionIds: ['transaction-api-fixture'] })),
});
function fixture(respond) {
  const calls = [];
  let active = 0, maximumActive = 0;
  globalThis.sellerLogicApiFixture = {
    async invoke(name, options) {
      calls.push({ name, options }); active++; maximumActive = Math.max(maximumActive, active);
      try { return await respond(options.body, calls.length - 1, options); } finally { active--; }
    },
  };
  return { calls, get maximumActive() { return maximumActive; } };
}

for (const slotNumber of [1, 2]) {
  test(`selected saved slot ${slotNumber} is sent through exactly one detect and one link action`, async () => {
    const original = input(slotNumber), before = JSON.stringify(original), progress = [];
    const f = fixture(async ({ action, input: packet }) => success(action === 'seller-logic-detect' ? detected(packet) : linked(packet)));
    const result = await analyzeSellerLogic(original, { onProgress: (value) => progress.push(value) });
    assert.deepEqual(f.calls.map((call) => call.options.body.action), ['seller-logic-detect', 'seller-logic-analysis']);
    for (const call of f.calls) {
      assert.equal(call.name, 'sales-api');
      assert.deepEqual(Object.keys(call.options.body).sort(), ['action', 'input']);
      assert.equal(call.options.body.input.slotNumber, slotNumber);
      assert.equal(call.options.body.input.sessionId, original.sessionId);
      assert.deepEqual(call.options.body.input.comments, original.comments);
      assert.deepEqual(call.options.body.input.transcripts, original.transcripts);
    }
    const detectPacket = f.calls[0].options.body.input, linkPacket = f.calls[1].options.body.input;
    assert.deepEqual(detectPacket.freshCommentIds, ['c0']);
    assert.deepEqual(detectPacket.freshTranscriptIds, ['s0']);
    assert.deepEqual(detectPacket.existingSignals, []);
    assert.deepEqual(detectPacket.carry, []);
    assert.deepEqual(linkPacket.linkSignals, detected(detectPacket).signals);
    assert.deepEqual(linkPacket.incremental.newCommentIds, ['c0']);
    assert.deepEqual(linkPacket.incremental.newTranscriptIds, ['s0']);
    assert.equal(result.decisions[0].unitPrice, 20_000);
    assert.equal(result.model, `saved-slot-${slotNumber}`);
    assert.equal(result.pipeline.stats.detectCalls, 1);
    assert.equal(result.pipeline.stats.linkCalls, 1);
    assert.deepEqual(progress.map((item) => item.decisions.length), [0, 1]);
    assert.equal(f.maximumActive, 1);
    assert.equal(JSON.stringify(original), before);
  });
}

test('no detector signal skips stage two and a completed pipeline sends no duplicate request', async () => {
  const f = fixture(async ({ action, input: packet }) => {
    assert.equal(action, 'seller-logic-detect'); return success(detected(packet, false));
  });
  const original = input(), first = await analyzeSellerLogic(original);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(first.decisions, []);
  assert.equal(first.hasMore, false);
  const repeated = await analyzeSellerLogic({ ...original, pipeline: first.pipeline, analysisState: first.analysisState });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(repeated.analysisState.processedCommentIds, ['c0']);
  assert.deepEqual(repeated.analysisState.processedTranscriptIds, ['s0']);
});

test('unfinished source is preserved in carry without inventing a second-stage sale', async () => {
  const carry = [{ reason: '가격 발화가 다음 조각에 이어짐', commentIds: [], transcriptIds: ['s0'] }];
  const f = fixture(async ({ input: packet }) => success({ ...detected(packet, false), carry }));
  const result = await analyzeSellerLogic(input());
  assert.equal(f.calls.length, 1);
  assert.deepEqual(result.pipeline.carry, carry);
  assert.deepEqual(result.decisions, []);
});

test('abort before analysis causes no transport call', async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture(async () => { throw new Error('unexpected call'); });
  await assert.rejects(analyzeSellerLogic(input(), { signal: controller.signal }), (error) => error.name === 'AbortError');
  assert.equal(f.calls.length, 0);
});

test('abort during detector transport passes the signal and prevents publication or stage two', async () => {
  const controller = new AbortController(), reply = pending(), progress = [];
  const f = fixture(() => reply.promise);
  const task = analyzeSellerLogic(input(), { signal: controller.signal, onProgress: (value) => progress.push(value) });
  assert.equal(f.calls[0].options.signal, controller.signal);
  controller.abort(); reply.resolve(success(detected(f.calls[0].options.body.input)));
  await assert.rejects(task, (error) => error.name === 'AbortError');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(progress, []);
});

test('abort in the detector progress callback prevents the link request', async () => {
  const controller = new AbortController();
  const f = fixture(async ({ input: packet }) => success(detected(packet)));
  await assert.rejects(analyzeSellerLogic(input(), { signal: controller.signal, onProgress() { controller.abort(); } }), (error) => error.name === 'AbortError');
  assert.equal(f.calls.length, 1);
});

test('abort during the link response preserves only the already published detection checkpoint', async () => {
  const controller = new AbortController(), reply = pending(), progress = [];
  let startedLink;
  const linkStarted = new Promise((resolve) => { startedLink = resolve; });
  const f = fixture(async ({ action, input: packet }, _index, options) => {
    assert.equal(options.signal, controller.signal);
    if (action === 'seller-logic-detect') return success(detected(packet));
    startedLink(packet); return reply.promise;
  });
  const task = analyzeSellerLogic(input(), { signal: controller.signal, onProgress: (value) => progress.push(value) });
  const packet = await linkStarted;
  controller.abort(); reply.resolve(success(linked(packet)));
  await assert.rejects(task, (error) => error.name === 'AbortError');
  assert.equal(f.calls.length, 2);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].pipeline.signals[0].needsAnalysis, true);
  assert.deepEqual(progress[0].decisions, []);
});

for (const failureStage of ['seller-logic-detect', 'seller-logic-analysis']) {
  test(`provider error at ${failureStage} is preserved and never silently retried by transport`, async () => {
    const message = 'HTTP 400: Context size exceeded (provider detail)', progress = [];
    const f = fixture(async ({ action, input: packet }) => action === failureStage ? failed(message) : success(detected(packet)));
    await assert.rejects(analyzeSellerLogic(input(), { onProgress: (value) => progress.push(value) }), { message });
    assert.equal(f.calls.length, failureStage === 'seller-logic-detect' ? 1 : 2);
    assert.equal(progress.length, failureStage === 'seller-logic-detect' ? 0 : 1);
    assert.ok(progress.every((item) => item.decisions.length === 0));
  });
}

test('HTTP transport errors expose the server envelope message and preserve fallback when its body is unreadable', async () => {
  fixture(async () => ({ data: null, error: { message: 'Edge returned non-2xx', context: { json: async () => ({ error: { message: '선택한 슬롯의 API 키가 없습니다.' } }) } } }));
  await assert.rejects(analyzeSellerLogic(input()), { message: '선택한 슬롯의 API 키가 없습니다.' });
  fixture(async () => ({ data: null, error: { message: 'Network disconnected', context: { json: async () => { throw new Error('not JSON'); } } } }));
  await assert.rejects(analyzeSellerLogic(input()), { message: 'Network disconnected' });
});

test('an empty successful envelope is rejected without starting stage two', async () => {
  const f = fixture(async () => ({ data: { ok: true }, error: null }));
  await assert.rejects(analyzeSellerLogic(input()), /AI 판매 분석 결과가 없습니다/);
  assert.equal(f.calls.length, 1);
});

test('slot labels are a single metadata read without analysis evidence or new configuration', async () => {
  const metadata = { appliedVersion: 7, primarySlot: 2, slots: [
    { slotNumber: 1, provider: 'LOCAL', model: 'saved-local' }, { slotNumber: 2, provider: 'CLOUD', model: 'saved-cloud' },
  ] };
  const f = fixture(async () => success(metadata));
  assert.deepEqual(await getSellerLogicSlots(), metadata);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'sales-api');
  assert.deepEqual(f.calls[0].options.body, { action: 'seller-logic-slots' });
});

const archive = (count = 300) => {
  const value = { ...input(), comments: [], transcripts: [] }, time = Date.parse('2026-10-05T14:00:00Z');
  for (let index = 0; index < count; index++) {
    value.comments.push({ id: `c${index}`, sessionId: value.sessionId, nickname: `구매자${index}`, content: '저요', capturedAt: new Date(time + index * 2000).toISOString() });
    value.transcripts.push({ id: `s${index}`, text: '상품 설명입니다.', recognizedAt: new Date(time + index * 2000 + 1000).toISOString(), isFinal: true });
  }
  return value;
};

test('archival evidence transport sends 600 events in 20 bounded sequential packets with each fresh ID once', async () => {
  const original = archive(), before = JSON.stringify(original), progress = [], seen = new Set();
  const f = fixture(async ({ action, input: packet }) => {
    assert.equal(action, 'seller-logic-analysis');
    assert.ok(JSON.stringify(packet).length <= 32_000);
    assert.ok(packet.comments.length + packet.transcripts.length < 600);
    const fresh = [...packet.incremental.newCommentIds.map((id) => `C:${id}`), ...packet.incremental.newTranscriptIds.map((id) => `S:${id}`)];
    assert.equal(fresh.length, 30);
    for (const key of fresh) { assert.ok(!seen.has(key), `fresh source repeated: ${key}`); seen.add(key); }
    return success(response(packet));
  });
  const final = await analyzeSellerLogicEvidence(original, { onProgress: (value) => progress.push(value) });
  assert.equal(f.calls.length, 20);
  assert.equal(f.maximumActive, 1);
  assert.equal(seen.size, 600);
  assert.deepEqual(progress.map((item) => item.analysisState.processedCommentIds.length + item.analysisState.processedTranscriptIds.length), Array.from({ length: 20 }, (_, index) => (index + 1) * 30));
  assert.equal(final.hasMore, false);
  assert.equal(final.analysisState.memory.length, 0);
  assert.equal(JSON.stringify(original), before);
});

test('a failed archive packet resumes from the published checkpoint without replaying acknowledged fresh source', async () => {
  const original = archive(30), progress = [];
  const f = fixture(async ({ input: packet }, index) => index === 0 ? success(response(packet)) : failed('second packet failed'));
  await assert.rejects(analyzeSellerLogicEvidence(original, { onProgress: (value) => progress.push(value) }), /second packet failed/);
  assert.equal(f.calls.length, 2);
  assert.equal(progress.length, 1);
  const done = new Set(progress[0].analysisState.processedCommentIds);
  const resumed = fixture(async ({ input: packet }) => {
    assert.ok(packet.incremental.newCommentIds.every((id) => !done.has(id)));
    return success(response(packet));
  });
  const final = await analyzeSellerLogicEvidence({ ...original, analysisState: progress[0].analysisState, previousDecisions: progress[0].decisions });
  assert.equal(resumed.calls.length, 1);
  assert.equal(final.analysisState.processedCommentIds.length, 30);
  assert.equal(final.analysisState.processedTranscriptIds.length, 30);
});

test('archival transport rejects an unacknowledged fresh source before publishing progress', async () => {
  const progress = [];
  const f = fixture(async ({ input: packet }) => {
    const value = response(packet); value.analysisState.processedTranscriptIds = []; return success(value);
  });
  await assert.rejects(analyzeSellerLogicEvidence(input(), { onProgress: (value) => progress.push(value) }), /진행 정보/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(progress, []);
});
