import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/sales-api/handlers/sessions.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function handlerFixture(rows, failOffset) {
  const pages = [];
  const responses = [];
  const admin = {
    from(table) {
      const page = { table, columns: null, filters: [], orders: [], range: null };
      pages.push(page);
      const query = {
        select(columns) { page.columns = columns; return query; },
        eq(column, value) { page.filters.push([column, value]); return query; },
        order(column, options) { page.orders.push([column, options.ascending]); return query; },
        async range(from, to) {
          page.range = [from, to];
          if (from === failOffset) return { data: [{ id: 'must-not-leak-partial-page' }], error: { message: 'second page unavailable' } };
          const selected = rows.filter((row) => page.filters.every(([column, value]) => row[column] === value));
          selected.sort((left, right) => {
            for (const [column, ascending] of page.orders) {
              if (left[column] === right[column]) continue;
              const result = left[column] < right[column] ? -1 : 1;
              return ascending ? result : -result;
            }
            return 0;
          });
          return { data: selected.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  const shared = {
    admin,
    successResponse(data) { const response = { ok: true, data }; responses.push(response); return response; },
    errorResponse(code, message, status) { const response = { ok: false, code, message, status }; responses.push(response); return response; },
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === '../../_shared/productSales.ts') return shared;
      assert.equal(name, './common.ts');
      return { getWorkspaceSettings() { throw new Error('list-sessions must not read settings'); } };
    },
  });
  return { run: module.exports.handleListSessions, pages, responses };
}

function sessionRow(index, workspaceId = 'workspace-a') {
  const id = `session-${String(index).padStart(4, '0')}`;
  return {
    id, workspace_id: workspaceId, display_code: `${id} 방송`, status: 'ENDED',
    active_product_id: null, revision: 1,
    // Several sessions share a timestamp, so id is required to make page boundaries stable.
    started_at: new Date(Date.UTC(2026, 9, 1) + Math.floor(index / 3) * 60000).toISOString(),
    ended_at: null,
  };
}

test('the actual list-sessions handler reads 1,001 sessions across pages with workspace filtering and stable ordering', async () => {
  const own = Array.from({ length: 1001 }, (_, index) => sessionRow(index));
  const foreign = Array.from({ length: 13 }, (_, index) => sessionRow(2000 + index, 'workspace-b'));
  const fixture = handlerFixture([...foreign, ...own]);
  const response = await fixture.run('workspace-a');
  assert.equal(response.ok, true);
  assert.equal(response.data.sessions.length, 1001);
  assert.equal(new Set(response.data.sessions.map((session) => session.id)).size, 1001);
  assert.equal(response.data.sessions[0].id, 'session-1000');
  assert.equal(response.data.sessions.at(-1).id, 'session-0000');
  assert.equal(response.data.sessions.some((session) => session.id === 'session-2000'), false);
  assert.deepEqual(fixture.pages.map((page) => page.range), [[0, 999], [1000, 1999]]);
  for (const page of fixture.pages) {
    assert.equal(page.table, 'live_sessions');
    assert.deepEqual(page.filters, [['workspace_id', 'workspace-a']]);
    assert.deepEqual(page.orders, [['started_at', false], ['id', false]]);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(response.data.sessions[0])), {
    id: 'session-1000', displayCode: 'session-1000 방송', status: 'ENDED', activeProductId: null,
    revision: 1, startedAt: own[1000].started_at, endedAt: null,
  });
  assert.equal(fixture.responses.length, 1);
});

test('a later page error returns a database error instead of publishing the first page as a partial success', async () => {
  const fixture = handlerFixture(Array.from({ length: 1001 }, (_, index) => sessionRow(index)), 1000);
  const response = await fixture.run('workspace-a');
  assert.equal(response.ok, false);
  assert.equal(response.code, 'DATABASE_ERROR');
  assert.equal(response.status, 500);
  assert.match(response.message, /second page unavailable/);
  assert.equal('data' in response, false);
  assert.equal(fixture.responses.some((result) => result.ok), false);
  assert.deepEqual(fixture.pages.map((page) => page.range), [[0, 999], [1000, 1999]]);
  assert.ok(fixture.pages.every((page) => page.filters.some(([column, value]) => column === 'workspace_id' && value === 'workspace-a')));
});

test('an empty workspace returns an empty list without exposing sessions belonging to another workspace', async () => {
  const fixture = handlerFixture([sessionRow(1, 'workspace-b')]);
  const response = await fixture.run('workspace-a');
  assert.equal(response.ok, true);
  assert.equal(response.data.sessions.length, 0);
  assert.equal(fixture.pages.length, 1);
  assert.deepEqual(fixture.pages[0].filters, [['workspace_id', 'workspace-a']]);
});
