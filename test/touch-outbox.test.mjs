import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {TouchLocalStore,flushTouchOutbox} from '../src/services/touchLocalStore.ts';
globalThis.indexedDB=indexedDB;
test('phone outbox survives reload, is scoped by workspace and retries the exact operation',async()=>{
  const workspace=crypto.randomUUID(),other=crypto.randomUUID(),operationId=crypto.randomUUID();
  const item={id:`${workspace}:${operationId}`,workspaceId:workspace,sale:{operationId,inputPrice:'1.5',unitPrice:15000},createdAt:Date.now()};
  const store=new TouchLocalStore();await store.putOutbox(item);await store.putOutbox({...item,id:'other',workspaceId:other});
  const reloaded=new TouchLocalStore(),sent=[];
  await flushTouchOutbox(reloaded,workspace,async sale=>{sent.push(sale);throw new Error('network timeout after server stored');});
  assert.equal((await reloaded.listOutbox(workspace)).length,1);
  await flushTouchOutbox(reloaded,workspace,async sale=>sent.push(sale));
  assert.equal(sent[0].operationId,operationId);assert.equal(sent[1].operationId,operationId);
  assert.equal((await reloaded.listOutbox(workspace)).length,0);assert.equal((await reloaded.listOutbox(other)).length,1);
});
test('ended sessions and duplicate comments stay reviewable and do not retry forever',async()=>{
  const workspace=crypto.randomUUID(),store=new TouchLocalStore();
  await store.putOutbox({id:workspace,workspaceId:workspace,sale:{operationId:crypto.randomUUID()},createdAt:Date.now()});
  let attempts=0;await flushTouchOutbox(store,workspace,async()=>{attempts++;throw Object.assign(new Error('회차 종료'),{code:'SESSION_ENDED'});});
  await flushTouchOutbox(store,workspace,async()=>{attempts++;});assert.equal(attempts,1);
  assert.equal((await store.listOutbox(workspace))[0].blocked,true);
});
