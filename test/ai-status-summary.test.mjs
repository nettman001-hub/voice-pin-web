import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { generateRouteKey } from '../supabase/functions/sales-api/handlers/aiHealthCore.ts';

// Exercise the real router, authentication helper, and status handlers. Only
// network/DB transports are mocked, so request counts include authorization.
globalThis.Deno = { env: { get: (name) => ({
  SUPABASE_URL: 'https://status-fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role',
  SUPABASE_ANON_KEY: 'fixture-anon',
})[name] } };
const bundle = await build({
  entryPoints: ['supabase/functions/sales-api/index.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{
    name: 'status-summary-transports',
    setup(builder) {
      builder.onResolve({ filter: /^https:\/\// }, ({ path }) => ({ path, namespace: 'transport' }));
      builder.onLoad({ filter: /.*/, namespace: 'transport' }, ({ path }) => ({ contents: path.includes('/http/server.ts')
        ? 'export const serve = handler => { globalThis.aiStatusSummaryHandler = handler; };'
        : `export const createClient = () => ({
            from: (...args) => globalThis.aiStatusSummaryFixture.from(...args),
            auth: { getUser: () => globalThis.aiStatusSummaryFixture.getUser() },
          });`,
      }));
    },
  }],
});
await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture({ draft = false } = {}) {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const unrelatedWorkspace = '22222222-2222-4222-8222-222222222222';
  const now = new Date().toISOString();
  const applied = {
    id: 'setting-1', scope: 'GLOBAL', version: 4, applied_version: 4,
    primary_slot: 2, is_draft: false,
    slot1: { type: 'LOCAL', provider: 'OLLAMA', routingMode: 'PC_HELPER', location: 'SAME_PC',
      model: 'local-model', endpointUrl: 'http://127.0.0.1:11434', secret_value: 'must-not-appear', maskedSecret: 'must-not-appear' },
    slot2: { type: 'CLOUD', provider: 'OPENAI', routingMode: 'SERVER_DIRECT', location: 'EXTERNAL_IP',
      model: 'cloud-model', endpointUrl: 'https://ai.example.test', newSecret: 'must-not-appear' },
  };
  const routeKey = (slot, executor = 'SERVER') => {
    const config = applied[`slot${slot}`];
    return generateRouteKey(slot, config.routingMode, config.location, executor, config.endpointUrl, config.model, 4);
  };
  const health = (slot, overrides = {}) => ({
    workspace_id: null, slot_number: slot, route_key: routeKey(slot),
    routing_mode: slot === 1 ? 'PC_HELPER' : 'SERVER_DIRECT', executor_id: 'SERVER',
    location: slot === 1 ? 'SAME_PC' : 'EXTERNAL_IP', endpoint_url: 'https://ai.example.test',
    model: `model-${slot}`, setting_version: 4, overall_status: 'AVAILABLE',
    tier1_connection: { ok: true, status: 'SUCCESS', testedAt: now },
    tier2_model_readiness: { ok: true, status: 'READY', testedAt: now },
    tier3_synthetic_inference: { ok: true, allPassed: true, scenarios: [], testedAt: now },
    consecutive_failures: 0, consecutive_successes: 1, last_checked_at: now,
    ...overrides,
  });
  const tables = {
    workspace_members: [{ user_id: 'user-1', workspace_id: workspaceId, role: 'OWNER', created_at: now }],
    ai_settings: [draft ? { ...applied, version: 5, is_draft: true, primary_slot: 1 } : applied],
    ai_settings_history: [{ setting_id: 'setting-1', version: 4, snapshot: applied, created_at: now }],
    ai_circuit_breaker: [{ workspace_id: workspaceId, slot_number: 2, is_open: true,
      cooldown_until: new Date(Date.now() + 30_000).toISOString(), consecutive_failures: 2 }],
    ai_tasks: ['QUEUED', 'PROCESSING', 'RESOLVED', 'INSUFFICIENT_DATA', 'FAILED', 'CANCELLED']
      .map((status, index) => ({ workspace_id: workspaceId, status,
        switch_reason: index === 1 ? 'PRIORITY_TIMEOUT' : null,
        updated_at: new Date(Date.now() - index * 1000).toISOString() })),
    ai_health_status: [
      health(1), health(2),
      health(1, { workspace_id: unrelatedWorkspace, route_key: 'other-workspace' }),
      health(1, { executor_id: 'DEVICE:other-device', route_key: 'other-device' }),
      ...Array.from({ length: 200 }, (_, index) => health(1, { executor_id: 'DEVICE:noise', route_key: `noise-${index}` })),
    ],
  };
  const calls = [];
  const ctx = {
    workspaceId, tables, calls, routeKey, authCalls: 0, networkCalls: 0, errors: {},
    async getUser() { ctx.authCalls++; return { data: { user: { id: 'user-1', app_metadata: {}, user_metadata: {} } }, error: null }; },
    from(table) {
      const filters = [], operations = [];
      let selected = '*', maxRows = Infinity, sort = null, single = false;
      const query = {
        select(columns) { selected = columns; return query; },
        eq(key, value) { filters.push((row) => row[key] === value); operations.push(['eq', key, value]); return query; },
        is(key, value) { filters.push((row) => row[key] === value); operations.push(['is', key, value]); return query; },
        or(expression) {
          const match = expression.match(/^workspace_id\.eq\.(".*"),workspace_id\.is\.null$/);
          assert.ok(match, `unexpected OR expression ${expression}`);
          const id = JSON.parse(match[1]);
          filters.push((row) => row.workspace_id === id || row.workspace_id === null);
          operations.push(['or', expression]); return query;
        },
        order(column, options = {}) { sort = { column, ascending: options.ascending !== false }; return query; },
        limit(count) { maxRows = count; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          calls.push({ table, selected, maxRows, operations });
          let rows = (tables[table] || []).filter((row) => filters.every((match) => match(row)));
          if (sort) rows.sort((left, right) => String(left[sort.column]).localeCompare(String(right[sort.column])) * (sort.ascending ? 1 : -1));
          rows = rows.slice(0, maxRows);
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: ctx.errors[table] || null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  globalThis.aiStatusSummaryFixture = ctx;
  return ctx;
}

async function request(ctx, overrides = {}, authenticated = true) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { ctx.networkCalls++; throw new Error('status reads must never execute an AI probe'); };
  try {
    return await globalThis.aiStatusSummaryHandler(new Request('https://fixture.test/sales-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer fixture-user-token' } : {}) },
      body: JSON.stringify({ action: 'get-ai-status-summary', workspaceId: ctx.workspaceId, ...overrides }),
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('AI summary makes one user/member/settings lookup without secrets, probes or task mutations', async () => {
  const ctx = fixture();
  const beforeTasks = JSON.stringify(ctx.tables.ai_tasks);
  const response = await request(ctx);
  assert.equal(response.status, 200);
  const { ok, data } = await response.json();
  assert.equal(ok, true);
  assert.equal(ctx.authCalls, 1);
  assert.equal(ctx.calls.filter((call) => call.table === 'workspace_members').length, 1);
  assert.equal(ctx.calls.filter((call) => call.table === 'ai_settings').length, 1);
  assert.equal(ctx.calls.filter((call) => call.table === 'ai_secrets').length, 0);
  assert.equal(ctx.networkCalls, 0);
  assert.equal(ctx.calls.length, 6); // membership + settings + breaker + tasks + two bounded slots
  assert.equal(data.settings.primarySlot, 2);
  assert.equal(data.runtimeStatus.activePrimarySlot, 2);
  assert.equal(data.runtimeStatus.activeSlot, 1); // applied priority 2 is cooling down
  for (const key of ['queuedTaskCount', 'processingTaskCount', 'resolvedTaskCount', 'insufficientDataTaskCount', 'failedTaskCount']) {
    assert.equal(data.runtimeStatus[key], 1);
  }
  assert.equal(data.runtimeStatus.lastSwitchReason, 'PRIORITY_TIMEOUT');
  assert.equal(data.healthSummary.slot1.routeKey, ctx.routeKey(1));
  assert.equal(data.healthSummary.slot2.routeKey, ctx.routeKey(2));
  assert.equal(JSON.stringify(data.settings).includes('must-not-appear'), false);
  assert.equal(JSON.stringify(ctx.tables.ai_tasks), beforeTasks);
  const queries = ctx.calls.filter((call) => call.table === 'ai_health_status');
  assert.equal(queries.length, 2);
  assert.ok(queries.every((call) => call.maxRows === 1 && call.selected !== '*'));
});

test('AI summary shares the last applied snapshot when a newer draft exists', async () => {
  const ctx = fixture({ draft: true });
  const { data } = await (await request(ctx)).json();
  assert.equal(data.settings.primarySlot, 2);
  assert.equal(data.settings.appliedVersion, 4);
  assert.equal(data.runtimeStatus.activePrimarySlot, 2);
  assert.equal(data.healthSummary.activePrimarySlot, 2);
  assert.equal(ctx.calls.filter((call) => call.table === 'ai_settings').length, 1);
  assert.equal(ctx.calls.filter((call) => call.table === 'ai_settings_history').length, 1);
});

test('AI health isolates PC helper executors and keeps shared GLOBAL health records', async () => {
  const ctx = fixture();
  const shared = ctx.tables.ai_health_status.find((row) => row.route_key === ctx.routeKey(1));
  ctx.tables.ai_health_status.push({ ...shared, executor_id: 'DEVICE:laptop', route_key: ctx.routeKey(1, 'DEVICE:laptop') });
  const { data } = await (await request(ctx, { deviceId: 'laptop' })).json();
  assert.equal(data.healthSummary.slot1.routeKey, ctx.routeKey(1, 'DEVICE:laptop'));
  assert.equal(data.healthSummary.slot1.executorId, 'DEVICE:laptop');
  assert.equal(data.healthSummary.slot2.routeKey, ctx.routeKey(2));
});

test('AI summary rejects unauthenticated and cross-workspace requests before any AI reads', async () => {
  let ctx = fixture();
  assert.equal((await request(ctx, {}, false)).status, 401);
  assert.equal(ctx.authCalls, 0);
  assert.equal(ctx.calls.length, 0);
  ctx = fixture();
  const response = await request(ctx, { workspaceId: '22222222-2222-4222-8222-222222222222' });
  assert.equal(response.status, 401);
  assert.equal(ctx.authCalls, 1);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].table, 'workspace_members');
});

test('AI summary reports DB failures rather than presenting healthy/default state', async () => {
  const ctx = fixture();
  ctx.errors.ai_health_status = { message: 'fixture health query unavailable' };
  const response = await request(ctx);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'DATABASE_ERROR');
});

test('existing health/runtime actions retain their response contracts after the shared-read refactor', async () => {
  let ctx = fixture();
  const healthResponse = await request(ctx, { action: 'get-ai-health' });
  assert.equal(healthResponse.status, 200);
  const { data: health } = await healthResponse.json();
  assert.equal(health.activePrimarySlot, 2);
  assert.equal(health.slot1.routeKey, ctx.routeKey(1));
  ctx = fixture();
  const runtimeResponse = await request(ctx, { action: 'get-ai-runtime-status' });
  assert.equal(runtimeResponse.status, 200);
  const { data: runtime } = await runtimeResponse.json();
  assert.equal(runtime.runtimeStatus.activePrimarySlot, 2);
  assert.equal(runtime.runtimeStatus.activeSlot, 1);
});

test('summary observes new applied settings without treating the previous route as healthy', async () => {
  const ctx = fixture();
  await request(ctx);
  Object.assign(ctx.tables.ai_settings[0], { primary_slot: 1, version: 5, applied_version: 5 });
  const { data } = await (await request(ctx)).json();
  assert.equal(data.settings.primarySlot, 1);
  assert.equal(data.settings.appliedVersion, 5);
  assert.equal(data.runtimeStatus.activePrimarySlot, 1);
  assert.equal(data.healthSummary.slot1.isExpired, false);
  assert.equal(data.healthSummary.slot1.overallStatus, 'CHECKING');
  assert.equal(data.healthSummary.slot1.settingVersion, 5);
  assert.notEqual(data.healthSummary.slot1.routeKey, ctx.routeKey(1));
});

test('summary expires old health records only for the currently applied route', async () => {
  const ctx = fixture();
  ctx.tables.ai_health_status.filter((row) => row.route_key === ctx.routeKey(1))
    .forEach((row) => { row.last_checked_at = new Date(Date.now() - 50_000).toISOString(); });
  const { data } = await (await request(ctx)).json();
  assert.equal(data.healthSummary.slot1.isExpired, true);
  assert.equal(data.healthSummary.slot1.overallStatus, 'EXPIRED');
});

test('changing the applied endpoint/model cannot borrow a fresh AVAILABLE result from the old route', async () => {
  const ctx = fixture();
  ctx.tables.ai_settings[0].slot1 = { ...ctx.tables.ai_settings[0].slot1, model: 'replacement-model', endpointUrl: 'https://replacement.example.test' };
  const { data } = await (await request(ctx)).json();
  assert.equal(data.healthSummary.slot1.overallStatus, 'CHECKING');
  assert.equal(data.healthSummary.slot1.model, 'replacement-model');
  assert.equal(data.healthSummary.slot1.endpointUrl, 'https://replacement.example.test');
});
