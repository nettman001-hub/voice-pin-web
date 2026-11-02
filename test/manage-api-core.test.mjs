import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { MANAGE_ACTIONS, validateManageRequest, normalizeManagePhone } from '../supabase/functions/sales-api/handlers/manageCore.ts';

const op = '7d0f2c1e-2b8a-4c43-9a51-2f0c8a1b9e10';

test('every manage action maps to a DB action handled by voicecap_manage', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/202611030001_manage_fulfillment.sql', import.meta.url), 'utf8');
  for (const dbAction of Object.values(MANAGE_ACTIONS)) assert.ok(sql.includes(`'${dbAction}'`), dbAction);
  const router = fs.readFileSync(new URL('../supabase/functions/sales-api/index.ts', import.meta.url), 'utf8');
  assert.match(router, /MANAGE_ACTIONS, action\)\) \{\s+requireCapability\('SALES_WRITE'\)\s+return await handleManage/);
});

test('validation keeps only known fields and needs an operation id', () => {
  assert.deepEqual(validateManageRequest('manage-keep', { saleIds: ['a'] }), { ok: false, reason: 'operationId' });
  assert.deepEqual(validateManageRequest('manage-nope', { operationId: op }), { ok: false, reason: 'action' });
  const checked = validateManageRequest('manage-keep', {
    operationId: op.toUpperCase(), buyerKey: 'nickname:꽃심이', saleIds: ['b', 'a', 'b'], workspaceId: 'other', actorId: 'x',
  });
  assert.deepEqual(checked, { ok: true, dbAction: 'keep', payload: { operationId: op, saleIds: ['a', 'b'], buyerKey: 'nickname:꽃심이' } });
  assert.equal(validateManageRequest('manage-keep', { operationId: op, buyerKey: '꽃심이' }).reason, 'buyerKey');
  assert.equal(validateManageRequest('manage-keep', { operationId: op, saleIds: 'a' }).reason, 'saleIds');
  assert.equal(validateManageRequest('manage-keep', { operationId: op, saleIds: Array.from({ length: 501 }, (_, i) => `s${i}`) }).reason, 'saleIds');
  assert.equal(validateManageRequest('manage-shipment-reserve', { operationId: op, shippingFee: -1 }).reason, 'shippingFee');
  assert.equal(validateManageRequest('manage-shipment-status', { operationId: op, status: 'RESERVED' }).reason, 'status');
  assert.equal(validateManageRequest('manage-contact-link', { operationId: op, mode: 'DROP' }).reason, 'mode');
  assert.equal(validateManageRequest('manage-invoice-create', { operationId: op, dueDate: '11/3' }).reason, 'dueDate');
  assert.equal(normalizeManagePhone('+82 10-1234-5678'), '01012345678');
  assert.equal(validateManageRequest('manage-contact-link', { operationId: op, phone: '010-1234-5678' }).payload.phone, '01012345678');
});

function loadManageApi(invoke) {
  const source = fs.readFileSync(new URL('../src/services/manage/manageApi.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, crypto, Error, String,
    require: (name) => { assert.equal(name, '../productSalesApi'); return { invokeSalesApi: invoke }; },
  });
  return module.exports.ManageApi;
}

test('sendInvoiceOnce locks, sends once and records the outcome; a refused lock sends nothing', async () => {
  const calls = [];
  const invoke = async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'manage-invoice-begin-send') return { ok: true, sendOperationId: 'lease-1' };
    return { ok: true, status: 'QUEUED' };
  };
  const ManageApi = loadManageApi(invoke);
  const api = new ManageApi('ws-1');
  let sends = 0;
  const result = await api.sendInvoiceOnce('inv-1', async () => { sends += 1; return { sent: true, smsMessageId: 'm1' }; });
  assert.equal(sends, 1);
  assert.equal(result.status, 'QUEUED');
  assert.deepEqual(calls.map(([action]) => action), ['manage-invoice-begin-send', 'manage-invoice-finish-send']);
  assert.equal(calls[1][1].sendOperationId, 'lease-1');
  assert.equal(calls[1][1].workspaceId, 'ws-1');
  assert.notEqual(calls[0][1].operationId, calls[1][1].operationId);

  const refused = new ManageApi('ws-1', async () => { throw new Error('INVOICE_ALREADY_SENDING'); });
  let refusedSends = 0;
  await assert.rejects(refused.sendInvoiceOnce('inv-1', async () => { refusedSends += 1; return { sent: true }; }));
  assert.equal(refusedSends, 0);

  calls.length = 0;
  const failed = new ManageApi('ws-1', async (action, payload) => { calls.push([action, payload]); return { ok: true, sendOperationId: 'l2' }; });
  await failed.sendInvoiceOnce('inv-1', async () => { throw new Error('문자 앱 연결 없음'); });
  assert.equal(calls[1][1].sent, false);
  assert.equal(calls[1][1].error, '문자 앱 연결 없음');
});
