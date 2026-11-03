import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bulkSummary, runBulk, sendOrderInvoice } from '../src/services/manage/invoiceSender.ts';

const order = (nickname, over = {}) => ({
  key: `s1::nickname:${nickname}`, sessionId: 's1', buyerKey: `nickname:${nickname}`, nickname, saleIds: [`${nickname}-1`],
  itemCount: 1, productAmount: 10000, shipping: { fee: 3000, deferredToShipment: false }, totalAmount: 13000,
  stage: 'READY_TO_BILL', contact: { state: 'LINKED', phone: '01011112222' }, duplicateOpenInvoiceIds: [], ...over,
});
const form = { phone: '01011112222', bankAccount: '국민 1', dueDate: '2026-11-06', depositCode: 'AB1' };

function fakeApi({ existing = null, sendFails = false } = {}) {
  const calls = { create: 0, send: 0, sms: [] };
  return {
    calls,
    api: {
      async createInvoice(input) { calls.create += 1; return existing ? { ok: true, invoiceId: existing.id, existing: true, status: existing.status } : { ok: true, invoiceId: `inv-${input.buyerKey}`, existing: false, status: 'DRAFT' }; },
      async sendInvoiceOnce(id, send) { calls.send += 1; const out = await send(); return { ok: true, sendError: out.sent ? null : out.error }; },
    },
    sendSms: async (phone, body) => { calls.sms.push({ phone, body }); return sendFails ? { status: 'FAILED', id: 'x', error: '문자 앱 꺼짐' } : { status: 'QUEUED', id: 'sms-1' }; },
  };
}

test('sendOrderInvoice: new invoice is created and sent once with the new deposit code', async () => {
  const fake = fakeApi();
  const outcome = await sendOrderInvoice({ api: fake.api, order: order('꽃심이'), form, invoicesById: new Map(), sendSms: fake.sendSms });
  assert.deepEqual(outcome, { status: 'SENT' });
  assert.equal(fake.calls.sms.length, 1);
  assert.match(fake.calls.sms[0].body, /"AB1"/);
});

test('sendOrderInvoice: already-sent invoice and unknown existing invoice are skipped without SMS', async () => {
  let fake = fakeApi({ existing: { id: 'old', status: 'SENT' } });
  assert.equal((await sendOrderInvoice({ api: fake.api, order: order('달'), form, invoicesById: new Map(), sendSms: fake.sendSms })).status, 'SKIPPED');
  fake = fakeApi({ existing: { id: 'old', status: 'DRAFT' } });
  assert.equal((await sendOrderInvoice({ api: fake.api, order: order('달'), form, invoicesById: new Map(), sendSms: fake.sendSms })).status, 'SKIPPED');
  assert.equal(fake.calls.sms.length, 0);
  // 아는 정산서면 그 입금코드로 보낸다
  const known = new Map([['old', { id: 'old', status: 'DRAFT', phoneNumber: '01011112222', saleIds: ['달-1'], bankAccount: '신한 9', dueDate: '2026-11-05', depositCode: 'ZZ9' }]]);
  assert.equal((await sendOrderInvoice({ api: fake.api, order: order('달'), form, invoicesById: known, sendSms: fake.sendSms })).status, 'SENT');
  assert.match(fake.calls.sms[0].body, /"ZZ9"/);
  assert.match(fake.calls.sms[0].body, /신한 9/);
});

test('sendOrderInvoice: no contact is skipped before touching the server; SMS failure is FAILED', async () => {
  let fake = fakeApi();
  const skipped = await sendOrderInvoice({ api: fake.api, order: order('별', { contact: { state: 'NONE' } }), form, invoicesById: new Map(), sendSms: fake.sendSms });
  assert.equal(skipped.status, 'SKIPPED');
  assert.equal(fake.calls.create, 0);
  fake = fakeApi({ sendFails: true });
  const failed = await sendOrderInvoice({ api: fake.api, order: order('별'), form, invoicesById: new Map(), sendSms: fake.sendSms });
  assert.deepEqual(failed, { status: 'FAILED', reason: '문자 앱 꺼짐' });
});

test('runBulk: sent + failed + skipped always equals the number chosen, even when a worker throws', async () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const progress = [];
  const result = await runBulk(items, async (item) => {
    if (item === 'b') return { status: 'FAILED', reason: 'x' };
    if (item === 'c') return { status: 'SKIPPED', reason: 'y' };
    if (item === 'd') throw new Error('서버 오류');
    return { status: 'SENT' };
  }, (done, total) => progress.push(`${done}/${total}`));
  assert.equal(result.sent.length + result.failed.length + result.skipped.length, items.length);
  assert.deepEqual(result.sent, ['a', 'e']);
  assert.equal(result.failed.length, 2);
  assert.equal(bulkSummary(result), '보냄 2 · 실패 2 · 건너뜀 1');
  assert.deepEqual(progress, ['1/5', '2/5', '3/5', '4/5', '5/5']);
});

test('order list offers bulk send only for 청구 전 and uses the shared sender', () => {
  const page = fs.readFileSync('src/pages/manage/ManageOrdersPage.tsx', 'utf8');
  assert.match(page, /stage === 'READY_TO_BILL' && !duplicateOnly/);
  assert.match(page, /runBulk/);
  assert.match(page, /sendOrderInvoice/);
});
