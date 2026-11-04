import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeManageInbox } from '../src/services/manage/scopedInbox.ts';
import { buildContactBook } from '../src/services/manage/contactLink.ts';

const book = buildContactBook(
  [{ buyerKey: 'buyer:a', nickname: '가가가' }],
  [{ buyerKey: 'buyer:a', nickname: '가가가', phone: '01011112222', linkedAt: '2026-11-03T12:00:00Z' }],
  [],
);
const base = {
  sales: [{ id: 'a1', sessionId: 'session-a' }, { id: 'b1', sessionId: 'session-b' }],
  selectedSessionIds: new Set(['session-a']),
  invoices: [
    { id: 'invoice-a', saleIds: ['a1'] },
    { id: 'invoice-b', saleIds: ['b1'] },
    { id: 'invoice-a-direct', sessionId: 'session-a', saleIds: [] },
  ],
  payments: [], messages: [], contactBook: book, allSessions: false,
};
const payment = (id, extra = {}) => ({
  id, saleIds: [], payerName: '가가가', amount: 10000, paidAt: '2026-11-10T12:00:00Z',
  matchStatus: 'UNMATCHED', ...extra,
});
const message = (id, extra = {}) => ({
  id, phoneNumber: '010-1111-2222', direction: 'INCOMING', body: '방송이 끝난 뒤 보낸 주소',
  receivedAt: '2026-11-10T12:00:00Z', ...extra,
});

test('late payments and messages remain visible through sale, invoice and buyer phone links', () => {
  const payments = [
    payment('by-sale', { saleIds: ['a1'], matchStatus: 'MATCHED' }),
    payment('by-invoice', { invoiceId: 'invoice-a', matchStatus: 'MATCHED' }),
    payment('by-invoices', { invoiceIds: ['invoice-a-direct'], matchStatus: 'MATCHED' }),
  ];
  const messages = [message('by-phone'), message('international-phone', { phoneNumber: '+82 10 1111 2222' }),
    message('by-sale', { phoneNumber: '01099990000', saleIds: ['a1'] })];
  const result = scopeManageInbox({ ...base, payments, messages });
  assert.deepEqual(result.payments, payments);
  assert.deepEqual(result.messages, messages);
  assert.deepEqual(result.unassignedPayments, []);
  assert.deepEqual(result.unassignedMessages, []);
  assert.equal(result.payments[0], payments[0], 'original payment object and status are preserved');
  assert.equal(result.messages[0], messages[0]);
});

test('payments exactly linked to another known session do not enter the unassigned queue or selected candidates', () => {
  const result = scopeManageInbox({ ...base, payments: [
    payment('other-sale', { saleIds: ['b1'] }),
    payment('other-invoice', { invoiceId: 'invoice-b' }),
    payment('other-exact-wins', { saleIds: ['b1'], candidateIds: ['invoice-a'] }),
    payment('here-exact-wins', { saleIds: ['a1'], candidateIds: ['invoice-b'] }),
  ] });
  assert.deepEqual(result.payments.map((item) => item.id), ['here-exact-wins']);
  assert.deepEqual(result.unassignedPayments, []);
});

test('candidate-only links enter review without becoming confirmed payments', () => {
  const selected = payment('candidate', { candidateIds: ['invoice-b', 'invoice-a'], matchStatus: 'NEEDS_REVIEW' });
  const result = scopeManageInbox({ ...base, payments: [selected,
    payment('other-candidate', { candidateIds: ['invoice-b'], matchStatus: 'NEEDS_REVIEW' }),
  ] });
  assert.deepEqual(result.payments, [selected]);
  assert.equal(result.payments[0].matchStatus, 'NEEDS_REVIEW');
  assert.deepEqual(result.payments[0].candidateIds, ['invoice-b', 'invoice-a']);
  assert.deepEqual(result.unassignedPayments, []);
});

test('unlinked records are kept separate without inferring a session from payer name, amount or message body', () => {
  const unknown = payment('unknown');
  const dangling = payment('missing-reference', { invoiceId: 'removed-invoice' });
  const unknownMessage = message('unknown-phone', { phoneNumber: '01033334444', body: 'session-a 가가가 입금했어요' });
  const result = scopeManageInbox({ ...base, payments: [unknown, dangling], messages: [unknownMessage] });
  assert.deepEqual(result.payments, []);
  assert.deepEqual(result.unassignedPayments, [unknown, dangling]);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.unassignedMessages, [unknownMessage]);
});

test('an invoice that has no resolvable sale or session remains unassigned', () => {
  const payments = [payment('orphan-exact', { invoiceId: 'orphan-invoice' }),
    payment('orphan-candidate', { candidateIds: ['orphan-invoice'] })];
  const result = scopeManageInbox({ ...base, invoices: [...base.invoices, { id: 'orphan-invoice', saleIds: [] }], payments });
  assert.deepEqual(result.payments, []);
  assert.deepEqual(result.unassignedPayments, payments);
});

test('a message exact link to another session takes precedence over a shared buyer phone', () => {
  const result = scopeManageInbox({ ...base, messages: [
    message('other-sale', { saleIds: ['b1'] }),
    message('mixed-shipment', { saleIds: ['b1', 'a1'] }),
  ] });
  assert.deepEqual(result.messages.map((item) => item.id), ['mixed-shipment']);
  assert.deepEqual(result.unassignedMessages, []);
});

test('all-session mode includes every record, preserving generics with optional ids and no writes', () => {
  const payments = [{ saleIds: [], matchStatus: 'UNMATCHED', extra: 'summary row' }];
  const messages = [{ phone: '01033334444', direction: 'INCOMING', body: 'id 없는 요약 행' }];
  const result = scopeManageInbox({ ...base, allSessions: true, payments, messages });
  assert.deepEqual(result, { payments, messages, unassignedPayments: [], unassignedMessages: [] });
  assert.equal(result.payments[0], payments[0]);
  assert.equal(result.messages[0], messages[0]);
});
