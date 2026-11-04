import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBuyerThreads, buildPaymentReview, reviewInvoiceSelection } from '../src/services/manage/inboxWorklist.ts';
import { summaryInvoiceFromRow, SUMMARY_INVOICE_COLUMNS } from '../src/services/manage/manageSummary.ts';
import { buildContactBook } from '../src/services/manage/contactLink.ts';
import { buildManageTodos } from '../src/services/manage/todos.ts';

const now = new Date('2026-11-03T00:00:00Z');
const inv = (id, nick, amount, status = 'SENT', createdAt = '2026-11-01T00:00:00Z') => ({ id, customerNickname: nick, amount, status, createdAt, saleIds: [] });

test('payment review: server candidates first, else open invoices with the same amount; matched and old ones skipped', () => {
  const invoices = [inv('i1', '꽃심이', 33000), inv('i2', '달', 33000, 'SENT', '2026-11-02T00:00:00Z'), inv('i3', '별', 33000, 'PAID'), inv('i4', '구름', 18000)];
  const payments = [
    { id: 'p1', payerName: '김꽃', amount: 33000, paidAt: '2026-11-02T10:00:00Z', matchStatus: 'NEEDS_REVIEW', candidateIds: ['i1', 'i3'] },
    { id: 'p2', payerName: '모름', amount: 33000, paidAt: '2026-11-02T11:00:00Z', matchStatus: 'UNMATCHED' },
    { id: 'p3', payerName: '끝', amount: 18000, paidAt: '2026-11-02T11:00:00Z', matchStatus: 'MATCHED' },
    { id: 'p4', payerName: '옛날', amount: 18000, paidAt: '2026-09-01T00:00:00Z', matchStatus: 'UNMATCHED' },
  ];
  const review = buildPaymentReview(payments, invoices, { now });
  assert.deepEqual(review.map((item) => item.payment.id), ['p1', 'p2']);
  assert.deepEqual(review[0].candidates.map((item) => item.id), ['i1'], 'paid invoice is not a candidate');
  assert.deepEqual(review[1].candidates.map((item) => item.id), ['i2', 'i1'], 'same amount, newest first');
});

test('switching sessions cannot confirm an invoice selected under the prior session', () => {
  const payment = { id: 'p1', payerName: '꽃심이', amount: 33000, paidAt: '2026-11-02T10:00:00Z',
    matchStatus: 'NEEDS_REVIEW', candidateIds: ['invoice-a', 'invoice-b'] };
  const a = { ...inv('invoice-a', '꽃심이', 33000), sessionId: 'session-a' };
  const b = { ...inv('invoice-b', '꽃심이', 33000), sessionId: 'session-b' };
  const before = buildPaymentReview([payment], [a], { now })[0];
  assert.deepEqual(reviewInvoiceSelection(before), ['invoice-a']);
  const after = buildPaymentReview([payment], [b], { now })[0];
  assert.deepEqual(reviewInvoiceSelection(after, ['invoice-a']), []);
  assert.deepEqual(reviewInvoiceSelection(after), ['invoice-b'], 'only a new untouched selection defaults to the first candidate');
  assert.deepEqual(reviewInvoiceSelection(after, []), [], 'explicitly clearing selection must not restore a default');
  assert.deepEqual(reviewInvoiceSelection(after, ['invoice-a', 'invoice-b', 'invoice-b']), ['invoice-b']);
});

test('a paid or removed candidate is rejected when the payment review changes', () => {
  const payment = { id: 'p1', payerName: '꽃심이', amount: 33000, paidAt: '2026-11-02T10:00:00Z',
    matchStatus: 'NEEDS_REVIEW', candidateIds: ['i1', 'i2'] };
  const first = inv('i1', '꽃심이', 33000);
  const second = inv('i2', '꽃심이', 33000);
  const before = buildPaymentReview([payment], [first, second], { now })[0];
  assert.deepEqual(reviewInvoiceSelection(before, ['i1']), ['i1']);
  const afterPaid = buildPaymentReview([payment], [{ ...first, status: 'PAID' }, second], { now })[0];
  assert.deepEqual(reviewInvoiceSelection(afterPaid, ['i1']), []);
  const afterRemoved = buildPaymentReview([payment], [second], { now })[0];
  assert.deepEqual(reviewInvoiceSelection(afterRemoved, ['i1']), []);
  assert.deepEqual(reviewInvoiceSelection({ ...before, candidates: [{ ...first, status: 'PAID' }] }, ['i1']), [],
    'a candidate status change is also checked at confirmation time');
});

test('invoice review and server summary keep session, buyer and invoice kind metadata', () => {
  const invoice = { ...inv('i1', '꽃심이', 33000), sessionId: 'session-a', buyerKey: 'buyer:flower', kind: 'ORDER' };
  const payment = { id: 'p1', payerName: '꽃심이', amount: 33000, paidAt: '2026-11-02T10:00:00Z',
    matchStatus: 'NEEDS_REVIEW', candidateIds: ['i1'] };
  const item = buildPaymentReview([payment], [invoice], { now })[0];
  assert.equal(item.candidates[0], invoice);
  const summary = summaryInvoiceFromRow({ id: invoice.id, status: invoice.status, sale_ids: [], customer_nickname: invoice.customerNickname,
    created_at: invoice.createdAt, session_id: invoice.sessionId, buyer_key: invoice.buyerKey, kind: invoice.kind });
  assert.equal(summary.sessionId, invoice.sessionId);
  assert.equal(summary.buyerKey, invoice.buyerKey);
  assert.equal(summary.kind, invoice.kind);
  assert.equal(summaryInvoiceFromRow({ id: 'old', status: 'SENT', sale_ids: [] }).sessionId, undefined);
  for (const column of ['session_id', 'buyer_key', 'kind']) assert.ok(SUMMARY_INVOICE_COLUMNS.split(',').includes(column));
});

test('buyer threads group recent incoming texts by phone and name linked buyers', () => {
  const book = buildContactBook([{ buyerKey: 'nickname:꽃심이', nickname: '꽃심이' }],
    [{ phone: '01011112222', buyerKey: 'nickname:꽃심이', nickname: '꽃심이', linkedAt: '2026-10-01T00:00:00Z' }], []);
  const threads = buildBuyerThreads([
    { id: 'm1', phone: '010-1111-2222', body: '주소 바뀌었어요', direction: 'INCOMING', at: '2026-11-02T10:00:00Z' },
    { id: 'm2', phone: '01011112222', body: '감사합니다', direction: 'INCOMING', at: '2026-11-02T12:00:00Z' },
    { id: 'm3', phone: '01011112222', body: '정산서', direction: 'OUTGOING', at: '2026-11-02T13:00:00Z' },
    { id: 'm4', phone: '01099990000', body: '누구게', direction: 'INCOMING', at: '2026-11-02T09:00:00Z' },
    { id: 'm5', phone: '01088880000', body: '옛 문자', direction: 'INCOMING', at: '2026-10-01T09:00:00Z' },
  ], book, { now });
  assert.equal(threads.length, 2);
  assert.equal(threads[0].nickname, '꽃심이');
  assert.equal(threads[0].incomingCount, 2);
  assert.equal(threads[0].lastBody, '감사합니다');
  assert.equal(threads[1].nickname, undefined);
});

test('payment review shows up as a to-do pointing to the inbox', () => {
  const todos = buildManageTodos({ orders: [], paymentReviewCount: 2 });
  assert.deepEqual(todos.map((todo) => [todo.kind, todo.path]), [['PAYMENT_REVIEW', '/manage/inbox']]);
  const page = fs.readFileSync('src/pages/manage/ManageInboxPage.tsx', 'utf8');
  assert.match(page, /confirmPayment/);
  assert.match(page, /dismissPayment/);
});
