import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Run the real edge handler and its shared speech/comment validators. Only the
// database transport is replaced, so this never calls a live backend or RPC.
const bundle = await build({
  entryPoints: ['supabase/functions/sales-api/handlers/voiceSales.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'voice-sale-commit-fixture', setup(builder) {
    builder.onResolve({ filter: /_shared\/productSales\.ts$/ }, (args) => ({
      path: args.path, namespace: 'fixture',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const admin = {
        from: (...args) => globalThis.voiceSaleCommitFixture.from(...args),
        rpc: (...args) => globalThis.voiceSaleCommitFixture.rpc(...args),
      };
      export const successResponse = (data) => new Response(JSON.stringify({ ok: true, data }));
      export const errorResponse = (code, message, status = 400, details = {}) =>
        new Response(JSON.stringify({ ok: false, error: { code, message, details } }), { status });
    ` }));
  } }],
});
const { handleCommitVoiceSale } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const sessionId = '11111111-1111-4111-8111-111111111111';
const transcript = '택배 많을걸? 이제 언박싱 하십시오. 구름 언니, 이거 챙겨드릴게요. 금액은 1.0, 가단 60에 총장 89. 이렇게. 허리 스트링 채워도 돼?';
const sale = {
  id: 's-22222222-2222-4222-8222-222222222222', sessionId,
  purchaseRequestId: `${sessionId}:message-cloud`, buyerNickname: '구름',
  amount: 10000, unitPrice: 10000, rawTranscript: transcript,
  recognizedAt: '2026-10-01T01:00:10.000Z', productCode: '001', productName: '상품 001',
};
const operationId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const state = {
    reads: [], calls: [],
    comments: [{ id: 'comment-cloud', workspace_id: 'workspace', session_id: sessionId,
      platform_message_id: 'message-cloud', buyer_id: 'buyer-cloud', nickname_snapshot: '구름',
      content: '저요', captured_at: '2026-10-01T01:00:00.000Z' }],
    from(name) {
      assert.equal(name, 'live_comments');
      state.reads.push(name);
      const filters = [];
      let maximum = Infinity;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        gte(key, value) { filters.push((row) => row[key] >= value); return query; },
        lte(key, value) { filters.push((row) => row[key] <= value); return query; },
        limit(value) { maximum = value; return query; },
        then(resolve, reject) {
          const matches = state.comments.filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data: matches.slice(0, maximum), count: matches.length, error: null })
            .then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'voicecap_commit_voice_sale');
      state.calls.push(structuredClone(args));
      return { data: { ok: true, saleId: args.p_sale_id }, error: null };
    },
  };
  globalThis.voiceSaleCommitFixture = state;
  return state;
}

test('voice sale commit links the adjacent explicit price to 구름 and sends its exact evidence to the atomic RPC', async () => {
  const state = fixture();
  const response = await handleCommitVoiceSale('workspace', 'actor', { operationId, sale });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0], {
    p_workspace_id: 'workspace', p_actor_id: 'actor', p_operation_id: operationId,
    p_sale_id: sale.id, p_session_id: sessionId, p_request_id: sale.purchaseRequestId,
    p_platform_message_id: 'message-cloud', p_product_id: null,
    p_product_code: '001', p_product_name: '상품 001', p_amount: 10000,
    p_raw_transcript: transcript, p_recognized_at: sale.recognizedAt, p_price_quote: '1.0',
  });
});

test('voice sale commit rejects mismatched or unverified prices before accessing the database', async () => {
  for (const overrides of [
    { amount: 15000, unitPrice: 15000 },
    { unitPrice: 15000 },
    { rawTranscript: '구름 언니, 이거 챙겨드릴게요. 가단 60에 총장 89.' },
    { rawTranscript: '구름 언니, 이거 챙겨드릴게요. 금액은 1.0인가요?' },
  ]) {
    const state = fixture();
    const response = await handleCommitVoiceSale('workspace', 'actor', {
      operationId, sale: { ...sale, ...overrides },
    });
    const body = await response.json();
    assert.equal(response.status, 422, JSON.stringify(overrides));
    assert.equal(body.error.code, 'PRICE_OR_INTENT_UNVERIFIED');
    assert.deepEqual(state.reads, []);
    assert.deepEqual(state.calls, []);
  }
});

test('a casual allocation uses the canonical decorated nickname only when its comment and price are verified', async () => {
  const state = fixture();
  state.comments[0].nickname_snapshot = '가윤♡예준맘';
  const rawTranscript = '가윤 언니 챙겨줄게. 금액은 1.0입니다.';
  const response = await handleCommitVoiceSale('workspace', 'actor', {
    operationId, sale: { ...sale, buyerNickname: '가윤♡예준맘', rawTranscript },
  });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(state.calls[0].p_amount, 10000);
  assert.equal(state.calls[0].p_platform_message_id, 'message-cloud');
  assert.equal(state.calls[0].p_price_quote, '1.0');
});

const decoratedBuyerSpeech = '금액은 8,000원, 0.8. 이거 언니, 이뿌쥬 언니 챙겨드릴게요, 0.8.';
function decoratedBuyerFixture() {
  const state = fixture();
  state.comments[0] = { ...state.comments[0], id: 'comment-ippuju',
    platform_message_id: 'message-ippuju', buyer_id: 'buyer-ippuju',
    nickname_snapshot: '이뿌쥬~^^', content: 'ㅈㅇ' };
  state.comments.unshift({ ...state.comments[0], id: 'comment-filler',
    platform_message_id: 'message-filler', buyer_id: 'buyer-filler', nickname_snapshot: '이거' });
  return state;
}

test('voice sale commit verifies the allocation target against the decorated buyer comment rather than the earlier filler', async () => {
  const state = decoratedBuyerFixture();
  const response = await handleCommitVoiceSale('workspace', 'actor', {
    operationId, sale: { ...sale, buyerNickname: '이뿌쥬~^^',
      purchaseRequestId: `${sessionId}:message-ippuju`, amount: 8000, unitPrice: 8000,
      rawTranscript: decoratedBuyerSpeech },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].p_request_id, `${sessionId}:message-ippuju`);
  assert.equal(state.calls[0].p_platform_message_id, 'message-ippuju');
  assert.equal(state.calls[0].p_amount, 8000);
  assert.equal(state.calls[0].p_price_quote, '0.8');
  assert.equal(state.calls[0].p_raw_transcript, decoratedBuyerSpeech);
});

test('voice sale commit rejects an earlier filler account even when that account has a purchase comment', async () => {
  const state = decoratedBuyerFixture();
  const response = await handleCommitVoiceSale('workspace', 'actor', {
    operationId, sale: { ...sale, buyerNickname: '이거',
      purchaseRequestId: `${sessionId}:message-filler`, amount: 8000, unitPrice: 8000,
      rawTranscript: decoratedBuyerSpeech },
  });
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, 'BUYER_AMBIGUOUS');
  assert.deepEqual(state.calls, []);
});
