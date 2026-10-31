import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import {
  TouchLocalStore,
  flushTouchOutbox,
} from '../src/services/touchLocalStore.ts';
globalThis.indexedDB = indexedDB;
test('phone outbox survives reload, is scoped by workspace and retries the exact operation', async () => {
  const workspace = crypto.randomUUID(),
    other = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  const item = {
    id: `${workspace}:${operationId}`,
    workspaceId: workspace,
    sale: { operationId, inputPrice: '1.5', unitPrice: 15000 },
    createdAt: Date.now(),
  };
  const store = new TouchLocalStore();
  await store.putOutbox(item);
  await store.putOutbox({ ...item, id: 'other', workspaceId: other });
  const reloaded = new TouchLocalStore(),
    sent = [];
  await flushTouchOutbox(reloaded, workspace, async (sale) => {
    sent.push(sale);
    throw new Error('network timeout after server stored');
  });
  assert.equal((await reloaded.listOutbox(workspace)).length, 1);
  await flushTouchOutbox(reloaded, workspace, async (sale) => sent.push(sale));
  assert.equal(sent[0].operationId, operationId);
  assert.equal(sent[1].operationId, operationId);
  assert.equal((await reloaded.listOutbox(workspace)).length, 0);
  assert.equal((await reloaded.listOutbox(other)).length, 1);
});
test('ended sessions and duplicate comments stay reviewable and do not retry forever', async () => {
  const workspace = crypto.randomUUID(),
    store = new TouchLocalStore();
  await store.putOutbox({
    id: workspace,
    workspaceId: workspace,
    sale: { operationId: crypto.randomUUID() },
    createdAt: Date.now(),
  });
  let attempts = 0;
  await flushTouchOutbox(store, workspace, async () => {
    attempts++;
    throw Object.assign(new Error('회차 종료'), { code: 'SESSION_ENDED' });
  });
  await flushTouchOutbox(store, workspace, async () => {
    attempts++;
  });
  assert.equal(attempts, 1);
  assert.equal((await store.listOutbox(workspace))[0].blocked, true);
});

test('server and authentication failures survive reload and retry the original operation until recovery', async () => {
  for (const code of ['DATABASE_ERROR', 'AUTH_REQUIRED', 'CAPABILITY_DENIED']) {
    const workspace = crypto.randomUUID(), operationId = crypto.randomUUID();
    const item = {
      id: `${workspace}:${operationId}`,
      workspaceId: workspace,
      sale: { operationId, inputPrice: '1.5', unitPrice: 15000 },
      createdAt: Date.now(),
    };
    await new TouchLocalStore().putOutbox(item);
    const sent = [];
    await flushTouchOutbox(new TouchLocalStore(), workspace, async (sale) => {
      sent.push(sale);
      throw Object.assign(new Error('temporary server response'), { code });
    });
    const reloaded = new TouchLocalStore();
    const pending = await reloaded.listOutbox(workspace);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].blocked, false);
    assert.equal(pending[0].code, code);
    assert.equal(pending[0].id, item.id);
    assert.deepEqual(pending[0].sale, item.sale);
    await flushTouchOutbox(reloaded, workspace, async (sale) => sent.push(sale));
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
    assert.equal((await reloaded.listOutbox(workspace)).length, 0);
  }
});

test('identity and operation payload conflicts stop automatic retries without losing the queued request', async () => {
  for (const code of ['COMMENT_IDENTITY_CONFLICT', 'OPERATION_PAYLOAD_MISMATCH']) {
    const workspace = crypto.randomUUID(), operationId = crypto.randomUUID();
    const store = new TouchLocalStore();
    await store.putOutbox({ id: workspace, workspaceId: workspace, sale: { operationId }, createdAt: Date.now() });
    let attempts = 0;
    await flushTouchOutbox(store, workspace, async () => {
      attempts++;
      throw Object.assign(new Error('needs review'), { code });
    });
    await flushTouchOutbox(store, workspace, async () => { attempts++; });
    const pending = await store.listOutbox(workspace);
    assert.equal(attempts, 1);
    assert.equal(pending[0].blocked, true);
    assert.equal(pending[0].sale.operationId, operationId);
  }
});
