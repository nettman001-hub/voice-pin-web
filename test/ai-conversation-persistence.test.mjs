import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['supabase/functions/sales-api/handlers/aiTasks.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'ai-conversation-persistence-fixtures', setup(builder) {
    builder.onResolve({ filter: /(?:_shared\/productSales|\.\/aiTaskCore|\.\/aiOperationalSettings)\.ts$/ },
      ({ path }) => ({ path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
      path.includes('productSales') ? `
        export const admin = { from: (name) => globalThis.aiConversationFixture.from(name) };
        export const successResponse = (data) => new Response(JSON.stringify({ ok: true, data }));
        export const errorResponse = (code, message, status = 400) => new Response(JSON.stringify({ ok: false, error: { code, message } }), { status });
      ` : path.includes('aiOperationalSettings') ? `
        export const getOperationalAiSetting = async () => ({});
        export const getPrimaryAiSlot = () => 1;
      ` : `
        export const createAiTaskObject = () => { throw new Error('Unused by these tests'); };
        export const processAiTask = async (task) => globalThis.aiConversationFixture.process(task);
      `,
    }));
  } }],
});
const { handleGetAiTasks, handleProcessAiTask } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const trace = {
  systemPrompt: '실제 시스템 질문', userPrompt: '{"판매자":"이뿌쥬 언니 챙겨드릴게요"}',
  provider: 'DEEPSEEK', model: 'deepseek-chat', requestStartedAt: '2026-10-01T00:00:00Z',
  responseReceivedAt: '2026-10-01T00:00:01Z', responseText: '{"닉네임":"이뿌쥬~^^","가격":8000}',
  httpStatus: 200, responseKind: 'MODEL_OUTPUT',
};

function fixture() {
  const tables = {
    ai_tasks: [{ task_id: 'mine', workspace_id: 'workspace', session_id: 'session', sale_id: 'sale',
      status: 'QUEUED', active_slot: 1, current_attempt_id: 'initial', request_payload: { workspaceId: 'workspace' },
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
    { task_id: 'other', workspace_id: 'other-workspace', session_id: 'other-session', sale_id: 'sale',
      status: 'RESOLVED', active_slot: 2, request_payload: { private: true } }],
    ai_task_attempts: [], ai_circuit_breaker: [],
  };
  const state = {
    tables, fail: null, processCalls: 0, loadedTask: null,
    async process(task) {
      state.processCalls++;
      state.loadedTask = structuredClone(task);
      return {
        task: { ...task, status: 'RESOLVED', attempts: [...task.attempts, {
          taskId: task.taskId, attemptId: 'recorded-attempt', slotNumber: 1, status: 'COMPLETED',
          isValidAttempt: true, startedAt: trace.requestStartedAt, completedAt: trace.responseReceivedAt,
          latencyMs: 1000, conversationTrace: trace,
        }] },
        slot1CircuitBreaker: { isOpen: false }, slot2CircuitBreaker: { isOpen: false },
      };
    },
    from(name) {
      let op = 'select';
      let values;
      const filters = [];
      const query = {
        select() { return query; }, order() { return query; }, range() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        update(value) { op = 'update'; values = value; return query; },
        upsert(value) { op = 'upsert'; values = value; return query; },
        async maybeSingle() { const result = await query; return { ...result, data: result.data?.[0] || null }; },
        then(resolve, reject) {
          if (state.fail === `${name}:${op}`) {
            return Promise.resolve({ data: null, error: { message: `failed ${name} ${op}` } }).then(resolve, reject);
          }
          const rows = tables[name] || [];
          if (op === 'upsert') {
            for (const row of Array.isArray(values) ? values : [values]) {
              const index = rows.findIndex((current) => current.attempt_id && current.attempt_id === row.attempt_id);
              if (index < 0) rows.push(structuredClone(row));
              else rows[index] = structuredClone(row);
            }
          }
          const matched = rows.filter((row) => filters.every((match) => match(row)));
          if (op === 'update') matched.forEach((row) => Object.assign(row, values));
          return Promise.resolve({ data: structuredClone(matched), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  globalThis.aiConversationFixture = state;
  return state;
}

test('AI attempt conversation traces persist and round trip through the workspace-scoped history endpoint', async () => {
  const state = fixture();
  const processed = await (await handleProcessAiTask('workspace', 'actor', {}, { taskId: 'mine' })).json();
  assert.equal(processed.ok, true);
  assert.deepEqual(state.tables.ai_task_attempts[0].conversation_trace, trace);
  state.tables.ai_task_attempts.push({ task_id: 'other', attempt_id: 'private', conversation_trace: { userPrompt: 'private' } });
  const response = await (await handleGetAiTasks('workspace', 'actor', {}, { saleId: 'sale' })).json();
  assert.deepEqual(response.data.tasks.map((task) => task.taskId), ['mine']);
  assert.deepEqual(response.data.tasks[0].attempts[0].conversationTrace, trace);
  assert.equal(response.data.tasks[0].attempts.length, 1);
});

test('legacy attempts remain readable without fabricating an original prompt', async () => {
  const state = fixture();
  state.tables.ai_task_attempts.push({ task_id: 'mine', attempt_id: 'legacy', result: { old: true } });
  const response = await (await handleGetAiTasks('workspace', 'actor', {}, {})).json();
  assert.equal(response.data.tasks[0].attempts[0].conversationTrace, null);
  assert.deepEqual(response.data.tasks[0].attempts[0].result, { old: true });
});

test('failed and expired attempt prompts remain available when another AI slot succeeds', async () => {
  const state = fixture();
  state.tables.ai_task_attempts.push({ task_id: 'mine', attempt_id: 'expired', slot_number: 2,
    status: 'EXPIRED', is_valid_attempt: false, error_message: '응답 시간 초과', conversation_trace: {
      ...trace, responseText: undefined, responseReceivedAt: undefined, httpStatus: undefined, responseKind: undefined,
    } });
  await handleProcessAiTask('workspace', 'actor', {}, { taskId: 'mine' });
  assert.equal(state.loadedTask.attempts[0].conversationTrace.userPrompt, trace.userPrompt);
  const response = await (await handleGetAiTasks('workspace', 'actor', {}, {})).json();
  assert.equal(response.data.tasks[0].attempts.length, 2);
  assert.equal(response.data.tasks[0].attempts[0].status, 'EXPIRED');
  assert.equal(response.data.tasks[0].attempts[0].conversationTrace.responseText, undefined);
});

test('attempt query failure is surfaced rather than displayed as an empty conversation', async () => {
  const state = fixture();
  state.fail = 'ai_task_attempts:select';
  const response = await handleGetAiTasks('workspace', 'actor', {}, {});
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'DATABASE_ERROR');
  const processResponse = await handleProcessAiTask('workspace', 'actor', {}, { taskId: 'mine' });
  assert.equal(processResponse.status, 500);
  assert.equal(state.processCalls, 0);
});

test('failed task or conversation writes are not reported as successful saves', async () => {
  for (const fail of ['ai_tasks:update', 'ai_task_attempts:upsert']) {
    const state = fixture();
    state.fail = fail;
    const response = await handleProcessAiTask('workspace', 'actor', {}, { taskId: 'mine' });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error.message, /저장 실패/);
  }
});

test('a forged inline task cannot overwrite or disclose another workspace conversation', async () => {
  const state = fixture();
  const response = await handleProcessAiTask('workspace', 'actor', {}, { task: {
    taskId: 'other', workspaceId: 'workspace', attempts: [{ attemptId: 'private', taskId: 'other' }],
  } });
  assert.equal(response.status, 404);
  assert.equal(state.processCalls, 0);
  assert.deepEqual(state.tables.ai_task_attempts, []);
});

test('inline task compatibility resolves its ID to trusted workspace data', async () => {
  const state = fixture();
  const response = await handleProcessAiTask('workspace', 'actor', {}, { task: {
    taskId: 'mine', workspaceId: 'workspace', attempts: [{ attemptId: 'private', taskId: 'other' }],
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(state.loadedTask.attempts, []);
  assert.equal(state.tables.ai_task_attempts[0].task_id, 'mine');
});

test('conversation migration removes permissive writes and restricts both tables to workspace member reads', async () => {
  const sql = await readFile('supabase/migrations/202610010001_ai_conversation_trace.sql', 'utf8');
  assert.match(sql, /add column if not exists conversation_trace jsonb default null/);
  assert.match(sql, /drop policy if exists ai_tasks_write_policy/);
  assert.match(sql, /drop policy if exists ai_attempts_write_policy/);
  assert.match(sql, /using \(public\.is_workspace_member\(workspace_id\)\)/);
  assert.match(sql, /task\.task_id = ai_task_attempts\.task_id/);
  assert.match(sql, /public\.is_workspace_member\(task\.workspace_id\)/);
  assert.doesNotMatch(sql, /using \(true\)/);
});
