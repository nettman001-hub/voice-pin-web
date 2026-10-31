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
test('only failures without a server code read as an internet problem', async () => {
  const { touchCommitFailure } = await import('../src/services/touchLocalStore.ts');
  const net = touchCommitFailure(new Error('Failed to send a request to the Edge Function'));
  assert.equal(net.network, true);
  assert.equal(net.message, '인터넷 연결 후 자동으로 보냅니다.');
  const auth = touchCommitFailure(Object.assign(new Error('인증이 필요하거나 기기 연결이 해제되었습니다.'), { code: 'AUTH_REQUIRED' }));
  assert.equal(auth.network, false);
  assert.equal(auth.blocked, false, 'retried automatically after login');
  assert.match(auth.message, /로그인/);
  const db = touchCommitFailure(Object.assign(new Error('작업 상태를 확인한 뒤 다시 시도해 주세요.'), { code: 'DATABASE_ERROR' }));
  assert.equal(db.network, false);
  assert.match(db.message, /DATABASE_ERROR/);
  const ended = touchCommitFailure(Object.assign(new Error('회차 종료'), { code: 'SESSION_ENDED' }));
  assert.equal(ended.blocked, true);
  assert.equal(ended.message, '회차 종료');
});
