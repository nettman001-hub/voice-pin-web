const koreanPeriod = value => value.replace(/\bAM\b/gu, '오전').replace(/\bPM\b/gu, '오후');
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Execute the real edge handler with an in-memory DB and task transport. This
// tests the API envelope and register -> execute -> persist connection.
// A held sale is asked with the seller's plain-text prompt (never JSON), and
// the model answers "닉네임: …\n가격: …".
const bundle = await build({ entryPoints: ['supabase/functions/sales-api/handlers/voicePendingReview.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'review-fixtures', setup(builder) {
    builder.onResolve({ filter: /(?:_shared\/productSales|\.\/aiTasks|\.\/aiOperationalSettings)\.ts$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.includes('productSales') ? `
      export const admin = { from: (name) => globalThis.voiceReviewFixture.from(name) };
      export const successResponse = (data) => new Response(JSON.stringify({ ok: true, data }));
      export const errorResponse = (code,message,status=400) => new Response(JSON.stringify({ok:false,error:{code,message}}), {status});
    ` : path.includes('aiOperationalSettings') ? `
      export const getOperationalAiSetting = async () => globalThis.voiceReviewFixture.setting;
    ` : `
      export const handleCreateAiTask = async (...args) => globalThis.voiceReviewFixture.create(...args);
      export const handleProcessAiTask = async (...args) => globalThis.voiceReviewFixture.process(...args);
    ` }));
  } }] });
const answer = (text) => ({ resolvable: /닉네임/u.test(text) && /가격/u.test(text), action: 'UPDATE_SALE',
  targetSaleId: 's-one', changes: {}, evidenceIds: [], evidenceSummary: text, missingInfo: [], conflictReason: null });
const answered = (text, task = {}) => async () => new Response(JSON.stringify({ ok: true, data: { task: {
  taskId: 'task', activeSlot: 2, status: 'RESOLVED', attempts: [{}], resolutionResult: answer(text), ...task } } }));
const { handleReviewVoicePendingSale } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(overrides = {}) {
  const row = { id: 's-one', workspace_id: 'ws', session_id: 'session', source: 'WEB_VOICE',
    buyer_nickname: '햇살', amount: 15000, status: '보류', raw_transcript: '햇살언니 1.5',
    recognized_at: '2026-09-15T01:00:03Z', revision: 1, updated_at: '2026-09-15T01:00:03Z', ...overrides };
  const comments = [{ id: 'comment', session_id: 'session', workspace_id: 'ws', platform_message_id: 'comment', buyer_id: 'account',
    nickname_snapshot: '햇살', content: 'ㅈㅇ', captured_at: '2026-09-15T01:00:00Z' }];
  const calls = [];
  const current = structuredClone(row);
  const archives = [{ workspace_id: 'ws', namespace: 'session_transcripts_session', value: { workspaceId: 'ws', sessionId: 'session', logs: [] } }];
  const state = { row, current, comments, calls, archives, otherSales: [], setting: { primary_slot: 2, applied_version: 7 },
    from(name) {
      let update;
      const filters = [];
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; },
        eq(key, value) { filters.push((r) => r[key] === value); return query; },
        neq(key, value) { filters.push((r) => r[key] !== value); return query; },
        gte(key, value) { filters.push((r) => r[key] >= value); return query; },
        lte(key, value) { filters.push((r) => r[key] <= value); return query; },
        update(value) { update = value; return query; },
        async maybeSingle() { const value = await query; return { ...value, data: value.data[0] || null }; },
        then(resolve, reject) {
          try {
            const data = (name === 'sales' ? [current, ...state.otherSales] : name === 'workspace_settings' ? archives : comments)
              .filter((r) => filters.every((matches) => matches(r)));
            if (update) for (const r of data) Object.assign(r, update);
            return Promise.resolve({ data: structuredClone(data), count: data.length, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    },
    async create(_ws, _actor, _auth, body) {
      calls.push('create');
      state.request = body.request;
      assert.equal(body.settingVersion, 7);
      assert.equal(body.request.saleCandidates[0].saleId, row.id);
      return new Response(JSON.stringify({ ok: true, data: { task: { taskId: 'task', activeSlot: 2 } } }));
    },
    async process() {
      calls.push('process');
      state.beforeResult?.();
      return new Response(JSON.stringify({ ok: true, data: { task: { taskId: 'task', activeSlot: 1,
        status: 'RESOLVED', attempts: [{}, {}], switchReason: '3초 경과로 대체',
        resolutionResult: answer('닉네임: 햇살\n가격: 15,000원') } } }));
    },
  };
  globalThis.voiceReviewFixture = state;
  return state;
}

test('pending voice review registers and executes AI, then persists validated advisory results', async () => {
  const state = fixture();
  const response = await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {});
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(state.calls, ['create', 'process']);
  assert.match(koreanPeriod(state.request.plainTextPrompt), /^아래 내용은 라이브방송에서 판매자의 멘트와 구매자의 댓글 내용이다/u);
  assert.match(koreanPeriod(state.request.plainTextPrompt), /<고객댓글>\n시각\t닉네임\t멘트\n2026\. 9\. 15\. 오전 10:00:00\t햇살\tㅈㅇ/u);
  assert.match(koreanPeriod(state.request.plainTextPrompt), /<판매자멘트>\n시각 멘트 \n\[오전 10:00:03\] 햇살언니 1\.5/u);
  assert.doesNotMatch(state.request.plainTextPrompt, /[{}]/u, 'The prompt carries no JSON');
  assert.equal(state.current.ai_verification.aiStatus, 'RESOLVED');
  assert.equal(state.current.ai_verification.reviewMode, 'TEXT_PROMPT');
  assert.equal(state.current.ai_verification.saleConfirmed, true);
  assert.equal(state.current.ai_verification.nicknameVerified, true);
  assert.equal(state.current.purchase_request_id, 'session:comment');
  assert.equal(state.current.ai_verification.appliedSlot, 1);
  assert.equal(state.current.status, '보류');
  assert.equal(state.current.history[0].failoverAttempted, true);
  const repeated = await (await handleReviewVoicePendingSale('ws', 'actor', {}, structuredClone(state.current), {})).json();
  assert.equal(repeated.data.skipped, true);
  assert.equal(state.calls.length, 2);
});

test('a sale edited while AI runs rejects the late result', async () => {
  const state = fixture();
  state.beforeResult = () => Object.assign(state.current, { revision: 2, status: '확정', updated_at: 'seller-edit' });
  const body = await (await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {})).json();
  assert.equal(body.data.skipped, true);
  assert.equal(state.current.status, '확정');
  assert.equal(state.current.history, undefined);
});

test('missing comments and disabled AI do not call the models', async () => {
  for (const kind of ['no-comments', 'disabled']) {
    const state = fixture();
    if (kind === 'no-comments') state.comments.length = 0;
    if (kind === 'disabled') state.setting.enabled_pending_resolution = false;
    const body = await (await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {})).json();
    assert.equal(body.data.skipped, true);
    assert.equal(state.calls.length, 0);
  }
});

test('model execution failure is recorded on the pending sale and can be retried', async () => {
  const state = fixture();
  state.process = async () => { throw new Error('both models unavailable'); };
  await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {});
  assert.equal(state.current.status, '보류');
  assert.equal(state.current.ai_verification.aiStatus, 'INSUFFICIENT_DATA');
  assert.match(state.current.ai_verification.errorMessage, /unavailable/);
});

test('the edge handler puts archived speech from the minute around the sale in the prompt and stores the answered nickname plus price', async () => {
  const state = fixture({ buyer_nickname: '케이치', amount: 0,
    raw_transcript: '케이치 언니는 연핑 넣어드릴게요', recognized_at: '2026-09-15T12:41:10Z' });
  Object.assign(state.comments[0], { nickname_snapshot: 'KH', content: '연핑 저요', captured_at: '2026-09-15T12:40:19Z' });
  state.archives[0].value.logs = [
    { id: 'allocation', recognizedAt: '2026-09-15T12:41:10Z', text: 'KH 언니는 연핑 넣어드릴게요', isFinal: true },
    { id: 'price', recognizedAt: '2026-09-15T12:41:26Z', text: 'KH 언니는 연핑 1.5에 넣어드렸어요', isFinal: true },
    { id: 'other-product', recognizedAt: '2026-09-15T12:41:30Z', text: '다음 상품 3.5', isFinal: true },
    { id: 'too-late', recognizedAt: '2026-09-15T12:42:20Z', text: '이건 1분 뒤 멘트', isFinal: true },
  ];
  state.process = answered('닉네임: KH\n가격: 15,000원');
  const body = await (await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {})).json();
  assert.equal(body.ok, true);
  const seller = state.request.plainTextPrompt.split('<판매자멘트>\n')[1];
  assert.equal(koreanPeriod(seller), '시각 멘트 \n[오후 9:41:10] KH 언니는 연핑 넣어드릴게요\n[오후 9:41:10] 케이치 언니는 연핑 넣어드릴게요\n[오후 9:41:26] KH 언니는 연핑 1.5에 넣어드렸어요\n[오후 9:41:30] 다음 상품 3.5');
  assert.equal(state.current.buyer_nickname, 'KH');
  assert.equal(state.current.buyer_id, 'account');
  assert.equal(state.current.amount, 15000);
  assert.equal(state.current.unit_price, 15000);
  assert.equal(state.current.status, '보류');
  assert.equal(state.current.purchase_request_id, 'session:comment');
  assert.equal(state.current.ai_verification.nicknameVerified, true);
  const repeated = await (await handleReviewVoicePendingSale('ws', 'actor', {}, structuredClone(state.current), {})).json();
  assert.equal(repeated.data.skipped, true, 'Canonicalizing the result must not start an endless AI review loop');
});

test('a proven sale with an unmatched nickname remains pending with the verified amount', async () => {
  const state = fixture({ buyer_nickname: '네스트', amount: 0, raw_transcript: '네스트언니 1.5 넣어드릴게요' });
  state.process = answered('닉네임: 네스트\n가격: 15,000원');
  await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {});
  assert.equal(state.current.buyer_nickname, '네스트');
  assert.equal(state.current.amount, 15000);
  assert.equal(state.current.status, '보류');
  assert.equal(state.current.ai_verification.nicknameVerified, false);
  assert.equal(state.current.ai_verification.aiStatus, 'NEEDS_SELLER_CONFIRM');
  assert.equal(state.current.purchase_request_id, null);
});

test('AI waits for the minute after the held sale and does not run on an incomplete window', async () => {
  const time = new Date(Date.now() - 1000).toISOString();
  const state = fixture({ recognized_at: time });
  state.comments[0].captured_at = time;
  const body = await (await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {})).json();
  assert.equal(body.data.waitingForWindow, true);
  assert.equal(state.calls.length, 0);
  assert.equal(state.current.ai_verification, undefined);
});

test('one purchase comment cannot be attached to two separate sales by AI', async () => {
  const state = fixture();
  state.otherSales.push({ ...state.row, id: 'already-assigned', purchase_request_id: 'session:comment', status: '확정' });
  await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {});
  assert.equal(state.current.status, '보류');
  assert.equal(state.current.ai_verification.nicknameVerified, false);
  assert.equal(state.current.purchase_request_id, undefined);
});

test('an answer without 닉네임/가격 leaves the sale held for the seller', async () => {
  const state = fixture({ amount: 0 });
  state.process = answered('판매 확정 근거가 부족합니다.');
  await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, {});
  assert.equal(state.current.status, '보류');
  assert.equal(state.current.amount, 0);
  assert.equal(state.current.ai_verification.aiStatus, 'INSUFFICIENT_DATA');
});

test('ordinary chat sent by the browser is in the prompt but only stored comments are linked', async () => {
  const state = fixture();
  state.comments.length = 0;
  state.process = answered('닉네임: 햇살\n가격: 15,000원');
  await handleReviewVoicePendingSale('ws', 'actor', {}, state.row, { comments: [
    { id: 'local-1', platformMessageId: 'm1', nickname: '햇살', content: '저요', capturedAt: '2026-09-15T01:00:00Z' },
    { id: 'local-2', platformMessageId: 'm2', nickname: '구경꾼', content: '예뻐요', capturedAt: '2026-09-15T01:00:20Z' },
  ] });
  assert.match(koreanPeriod(state.request.plainTextPrompt), /구경꾼\t예뻐요/u);
  assert.equal(state.current.ai_verification.aiStatus, 'RESOLVED');
  assert.equal(state.current.ai_verification.candidateCommentId, undefined);
  assert.deepEqual(state.current.source_comment_ids, []);
});
