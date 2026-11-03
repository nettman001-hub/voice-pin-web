import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  defaultDueDate, invoiceCreateRequest, invoiceSmsBody, orderPath, validateInvoiceForm,
} from '../src/services/manage/orderInvoice.ts';
import vm from 'node:vm';
import ts from 'typescript';

const loadManageApi = () => {
  const source = fs.readFileSync('src/services/manage/manageApi.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, crypto, require: () => ({ invokeSalesApi: () => { throw new Error('no network'); } }) });
  return module.exports.ManageApi;
};

const order = {
  key: 's1::nickname:꽃심이', sessionId: 's1', buyerKey: 'nickname:꽃심이', nickname: '꽃심이', saleIds: ['a', 'b'],
  itemCount: 2, productAmount: 30000, shipping: { fee: 3500, deferredToShipment: false }, totalAmount: 33500,
  stage: 'READY_TO_BILL', contact: { state: 'LINKED', phone: '01011112222' }, duplicateOpenInvoiceIds: [],
};
const form = { phone: '010-1111-2222', bankAccount: ' 국민 123 ', dueDate: '2026-11-06', depositCode: 'K7Q' };

test('invoice request keeps the order amounts and normalizes phone/bank', () => {
  const request = invoiceCreateRequest(order, form);
  assert.equal(request.phone, '01011112222');
  assert.equal(request.bankAccount, '국민 123');
  assert.equal(request.productAmount, 30000);
  assert.equal(request.shippingFee, 3500);
  assert.deepEqual(request.saleIds, ['a', 'b']);
  assert.equal(request.buyerKey, 'nickname:꽃심이');
});

test('invoice form refuses missing contact, bank, phone and bad dates', () => {
  assert.equal(validateInvoiceForm(order, form), null);
  assert.equal(validateInvoiceForm({ ...order, contact: { state: 'NEEDS_CONFIRM' } }, form), 'NO_CONTACT');
  assert.equal(validateInvoiceForm(order, { ...form, bankAccount: '  ' }), 'NO_BANK');
  assert.equal(validateInvoiceForm(order, { ...form, phone: '010' }), 'NO_PHONE');
  assert.equal(validateInvoiceForm(order, { ...form, dueDate: '11/06' }), 'BAD_DUE_DATE');
  assert.equal(validateInvoiceForm({ ...order, saleIds: [] }, form), 'NO_ITEMS');
});

test('SMS text: keeping buyer pays products only, others see shipping', () => {
  const normal = invoiceSmsBody({ nickname: '꽃심이', productAmount: 30000, shippingFee: 3500, deferredShipping: false, itemCount: 2, bankAccount: '국민 123', dueDate: '2026-11-06', depositCode: 'K7Q' });
  assert.match(normal, /배송비: 3,500원/);
  assert.match(normal, /청구금액: 33,500원/);
  assert.match(normal, /"K7Q"/);
  const kept = invoiceSmsBody({ nickname: '달', productAmount: 18000, shippingFee: 0, deferredShipping: true, itemCount: 1, bankAccount: '국민 123', dueDate: '2026-11-06' });
  assert.match(kept, /보관 상품과 함께 보낼 때 한 번/);
  assert.match(kept, /청구금액: 18,000원/);
  assert.doesNotMatch(kept, /또는/);
});

test('due date and order path', () => {
  assert.equal(defaultDueDate(new Date(2026, 10, 30, 12), 3), '2026-12-03');
  assert.equal(decodeURIComponent(orderPath('s1::nickname:꽃 심').split('/').pop()), 's1::nickname:꽃 심');
});

test('sendInvoiceOnce: refused lease never sends; failed send is recorded', async () => {
  const calls = [];
  let refuse = true;
  const invoke = async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'manage-invoice-begin-send') {
      if (refuse) throw new Error('이미 보낸 정산서입니다.');
      return { ok: true, sendOperationId: 'lease-1' };
    }
    return { ok: true, sendError: payload.sent ? null : payload.error };
  };
  const ManageApi = loadManageApi();
  const api = new ManageApi('w', invoke);
  let sends = 0;
  await assert.rejects(api.sendInvoiceOnce('inv', async () => { sends += 1; return { sent: true }; }));
  assert.equal(sends, 0);
  refuse = false;
  const result = await api.sendInvoiceOnce('inv', async () => { throw new Error('브리지 꺼짐'); });
  assert.match(result.sendError, /브리지 꺼짐/);
  const finish = calls.find(([action]) => action === 'manage-invoice-finish-send')[1];
  assert.equal(finish.sendOperationId, 'lease-1');
  assert.equal(finish.sent, false);
});

test('order detail page is routed and the order list links to it', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /path="\/manage\/orders\/:orderKey"/);
  const list = fs.readFileSync('src/pages/manage/ManageOrdersPage.tsx', 'utf8');
  assert.match(list, /orderPath\(order\.key\)/);
  const detail = fs.readFileSync('src/pages/manage/OrderDetailPage.tsx', 'utf8');
  assert.match(detail, /sendOrderInvoice|sendInvoiceOnce/);
  assert.doesNotMatch(detail, /commerce\.createInvoice|commerce\.sendInvoice/);
});
