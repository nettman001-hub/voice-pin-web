import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/services/customerKeepingService.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'isolated-remote', setup(b) {
    b.onResolve({ filter: /\/remoteWorkspaceService$/ }, () => ({ path: 'remote', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const remoteWorkspaceService = {};' }));
  } }] });
const { createCustomerKeepingService } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
test('keeping one sale appends, preserves previous items and does not duplicate retries', async () => {
  let records = [], writes = 0, fail = false;
  const storage = new Map();
  const service = createCustomerKeepingService({
    fetchWorkspaceSettings: async () => structuredClone(records),
    saveWorkspaceSettings: async (_w, _k, value) => { if (fail) throw new Error('offline'); records = structuredClone(value); writes++; },
  }, { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  const sale = { id: 'one', buyerId: 'buyer1', buyerNickname: '동명', sessionId: 's', amount: 10000, productName: '1번' };
  await service.keepSale(sale, '회차1', 'w');
  await service.keepSale(sale, '회차1', 'w');
  assert.equal(writes, 1);
  await service.keepSale({ ...sale, id: 'two', amount: 20000, productName: '2번' }, '회차1', 'w');
  assert.deepEqual(records[0].saleIds, ['one', 'two']);
  assert.equal(records[0].totalAmount, 30000);
  await service.keepSale({ ...sale, id: 'other', buyerId: 'buyer2' }, '회차1', 'w');
  assert.equal(records.length, 2, 'same nickname with different ID remains separate');
  const before = [...storage.entries()];
  fail = true;
  await assert.rejects(service.keepSale({ ...sale, id: 'three' }, '회차1', 'w'), /offline/);
  assert.deepEqual([...storage.entries()], before, 'failed cloud write must not appear saved locally');
});
