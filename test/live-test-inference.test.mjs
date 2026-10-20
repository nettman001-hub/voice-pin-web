import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Execute the real inference endpoint, prompt adapter, task engine and failover.
// Its Supabase client offers SELECT/auth only; a mutation fails the test.
const bundle = await build({ entryPoints: ['api/live-test-inference.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'read-only-client', setup(builder) {
    builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'client', namespace: 'read-only-client' }));
    builder.onLoad({ filter: /.*/, namespace: 'read-only-client' }, () => ({ contents: 'export const createClient = (...args) => globalThis.testInferenceClient(...args);' }));
  } }] });
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
process.env.SUPABASE_URL = 'https://local-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';

function fixture({ member = true, draft = false, disabled = false, secret = 'provider-test-secret' } = {}) {
  const state = { selects: [], providerRequests: [], logs: [], token: null };
  const slot = number => ({ slotNumber: number, type: 'CLOUD', provider: 'DEEPSEEK', model: 'deepseek-chat',
    endpointUrl: 'https://api.deepseek.com/chat/completions', authType: 'API_KEY', timeoutSeconds: 1 });
  const applied = { id: 'setting', scope: 'GLOBAL', applied_version: 3, version: 3, primary_slot: 2, enabled_pending_resolution: !disabled,
    slot1: slot(1), slot2: slot(2) };
  const tables = {
    workspaces: [{ id: 'operating-workspace', owner_id: 'seller' }],
    workspace_members: member ? [{ workspace_id: 'operating-workspace', user_id: 'seller' }] : [],
    ai_settings: [{ ...applied, ...(draft ? { version: 4, is_draft: true, primary_slot: 1 } : {}) }],
    ai_settings_history: [{ setting_id: 'setting', version: 3, snapshot: applied }],
    ai_secrets: [{ setting_id: 'setting', slot_number: 2, secret_value: secret }],
  };
  globalThis.testInferenceClient = () => ({
    auth: { async getUser(token) { state.token = token; return { data: { user: token === 'valid-token' ? { id: 'seller', app_metadata: {} } : null } }; } },
    from(table) {
      assert.ok(table in tables, `Inference must not touch test data table ${table}`);
      state.selects.push(table);
      const filters = [];
      const query = { select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; }, order() { return query; }, limit() { return query; },
        async maybeSingle() { return { data: tables[table].find(row => filters.every(f => f(row))) || null, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: tables[table].filter(row => filters.every(f => f(row))), error: null }).then(resolve, reject); },
        insert() { assert.fail('Test inference attempted INSERT'); }, update() { assert.fail('Test inference attempted UPDATE'); },
        upsert() { assert.fail('Test inference attempted UPSERT'); }, delete() { assert.fail('Test inference attempted DELETE'); },
      };
      return query;
    },
  });
  globalThis.fetch = async (url, init) => {
    state.providerRequests.push({ url, body: JSON.parse(init.body), authorization: init.headers.Authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: '닉네임: 민트\n가격: 15,000원' } }] }), { status: 200 });
  };
  state.invoke = async ({ token = 'valid-token', method = 'POST', changes = {} } = {}) => {
    const response = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, headers: { authorization: `Bearer ${token}` }, body: {
      sourceWorkspaceId: 'operating-workspace', sale: { id: 'test-sale', sessionId: 'test-session', revision: 1, rawTranscript: '민트님 드릴게요 1.5' },
      request: { taskType: 'PENDING_RESOLUTION', workspaceId: 'local-test:workspace', sessionId: 'test-session', currentUtterance: '민트님 드릴게요 1.5', plainTextPrompt: '테스트 댓글과 판매자 멘트', saleCandidates: [{ saleId: 'test-sale', buyerNickname: '민트', amount: 15000, productCode: '1', quantity: 1, status: '보류' }] }, ...changes,
    } }, response);
    return response;
  };
  return state;
}

test('test inference uses the applied operational slot and real adapter, returning traces without saving test data or secrets', async () => {
  const f = fixture({ draft: true });
  const response = await f.invoke();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.task.activeSlot, 2);
  assert.equal(response.body.data.task.settingVersion, 3);
  assert.equal(response.body.data.task.resolutionResult.evidenceSummary, '닉네임: 민트\n가격: 15,000원');
  assert.equal(f.providerRequests.length, 1);
  assert.equal(f.providerRequests[0].authorization, 'Bearer provider-test-secret');
  assert.equal(f.providerRequests[0].body.messages[0].content, '테스트 댓글과 판매자 멘트');
  assert.equal(JSON.stringify(response.body).includes('provider-test-secret'), false);
  assert.ok(f.selects.includes('ai_settings_history'));
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('authentication, membership and method checks run before any test inference', async () => {
  const f = fixture({ member: false });
  assert.equal((await f.invoke({ token: 'bad-token' })).statusCode, 401);
  assert.equal((await f.invoke()).statusCode, 403);
  assert.equal((await f.invoke({ method: 'GET' })).statusCode, 405);
  assert.equal(f.providerRequests.length, 0);
});

test('disabled operational AI skips test inference rather than returning a made-up success', async () => {
  const f = fixture({ disabled: true });
  const response = await f.invoke();
  assert.equal(response.body.data.skipped, true);
  assert.equal(response.body.data.task, undefined);
  assert.equal(f.providerRequests.length, 0);
});
