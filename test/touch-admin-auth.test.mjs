import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { touchMonthRange } from '../supabase/functions/sales-api/handlers/touchSalesAdminCore.ts';
const source = fs.readFileSync(
  new URL(
    '../supabase/functions/sales-api/handlers/touchSalesAdmin.ts',
    import.meta.url,
  ),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
test('phone connection monitoring requires actual global ADMIN role, not workspace owner capability', async () => {
  let reads = 0;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Date,
    Set,
    Map,
    Object,
    require: (name) =>
      name.includes('touchSalesAdminCore')
        ? { touchMonthRange }
        : {
            admin: {
              rpc() {
                reads++;
                throw new Error('should not read');
              },
            },
            errorResponse: (code, message, status) => ({
              code,
              message,
              status,
            }),
          },
  });
  for (const auth of [
    { actorType: 'USER', role: 'OWNER', capabilities: new Set(['ADMIN']) },
    { actorType: 'USER', role: 'STAFF' },
    { actorType: 'DEVICE', role: 'ADMIN' },
  ]) {
    const result = await module.exports.handleTouchSalesAdmin(auth, {});
    assert.equal(result.status, 403);
  }
  assert.equal(reads, 0);
});
test('monitoring month boundaries include the full Korean calendar month, including the last day', () => {
  assert.deepEqual(touchMonthRange('2026-10'), {
    from: '2026-09-30T15:00:00.000Z',
    until: '2026-10-31T15:00:00.000Z',
  });
  assert.deepEqual(touchMonthRange('2028-02'), {
    from: '2028-01-31T15:00:00.000Z',
    until: '2028-02-29T15:00:00.000Z',
  });
  assert.deepEqual(touchMonthRange('2026-12'), {
    from: '2026-11-30T15:00:00.000Z',
    until: '2026-12-31T15:00:00.000Z',
  });
});
test('self-editable user_metadata cannot grant global administrator role', async () => {
  let appMetadata = {},
    userMetadata = { role: 'ADMIN' };
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: crypto.randomUUID(),
            app_metadata: appMetadata,
            user_metadata: userMetadata,
          },
        },
      }),
    },
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      async maybeSingle() {
        return { data: { workspace_id: 'own', role: 'OWNER' } };
      },
    }),
  };
  const shared = fs.readFileSync(
    new URL('../supabase/functions/_shared/productSales.ts', import.meta.url),
    'utf8',
  );
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(shared, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      Deno: { env: { get: () => 'fixture' } },
      require: () => ({ createClient: () => client }),
      Request,
      Response,
      Set,
      crypto,
      TextEncoder,
    },
  );
  const req = new Request('https://example.invalid', {
    headers: { authorization: 'Bearer fixture' },
  });
  assert.equal((await module.exports.authenticateRequest(req)).role, 'OWNER');
  appMetadata = { role: 'ADMIN' };
  userMetadata = {};
  assert.equal((await module.exports.authenticateRequest(req)).role, 'ADMIN');
});
