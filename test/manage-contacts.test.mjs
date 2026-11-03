import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildContactBook } from '../src/services/manage/contactLink.ts';
import { buildContactWorklist, callListText, formatPhone, phoneSnippets } from '../src/services/manage/contactWorklist.ts';
import { buildManageTodos } from '../src/services/manage/todos.ts';

const msg = (phone, body, receivedAt) => ({ phone, direction: 'INCOMING', body, receivedAt });

test('worklist splits save, confirm, missing, unknown and linked', () => {
  const buyers = ['꽃심이', '달', '하늘이', '새손님', '누구'].map((nickname) => ({ buyerKey: `nickname:${nickname}`, nickname }));
  const messages = [
    msg('01011110000', '꽃심이입니다 주소 보내요', '2026-11-02T10:00:00Z'),
    msg('01022220000', '달 입금했어요', '2026-11-02T10:01:00Z'),
    msg('01033330000', '안녕하세요 택배 언제 와요?', '2026-11-02T10:02:00Z'),
    msg('01033330000', '아까 산 거요', '2026-11-02T10:05:00Z'),
  ];
  const book = buildContactBook(buyers, [{ phone: '01044440000', nickname: '하늘이', linkedAt: '2026-10-01T00:00:00Z' }], messages);
  const list = buildContactWorklist(book, messages);
  assert.deepEqual(list.toSave.map((c) => [c.nickname, c.phone]), [['꽃심이', '01011110000']]);
  assert.deepEqual(list.confirm.map((c) => c.nickname), ['달']);
  assert.equal(list.confirm[0].snippets[0].lastBody, '달 입금했어요');
  assert.deepEqual(list.missing.map((c) => c.nickname).sort(), ['누구', '새손님']);
  assert.deepEqual(list.unknown.map((u) => [u.phone, u.count, u.lastBody]), [['01033330000', 2, '아까 산 거요']]);
  assert.deepEqual(list.linked.map((c) => c.nickname), ['하늘이']);
});

test('call list text, phone format and snippets ignore outgoing messages', () => {
  assert.equal(callListText([{ nickname: '새손님' }, { nickname: '누구' }]), '새손님님, 누구님 문자로 틱톡 닉네임과 연락처 보내 주세요.');
  assert.equal(callListText([]), '');
  assert.equal(formatPhone('+82 10 1234 5678'), '010-1234-5678');
  assert.equal(formatPhone('0311234567'), '031-123-4567');
  const snippets = phoneSnippets([{ phone: '010-1', direction: 'OUTGOING', body: 'x' }, msg('010 5555 6666', '안녕', '')]);
  assert.deepEqual([...snippets.keys()], ['01055556666']);
});

test('contact to-dos open the contact screen; page writes only through the server API', () => {
  const todos = buildManageTodos({
    orders: [{ stage: 'NEEDS_CONTACT', contact: { state: 'NONE' }, duplicateOpenInvoiceIds: [] }],
    contactBook: { unassignedPhones: ['01000000000'], byBuyer: new Map(), callList: [] },
  });
  assert.deepEqual(todos.map((t) => [t.kind, t.path]), [['CONTACT_MISSING', '/manage/contacts'], ['UNKNOWN_SENDER', '/manage/contacts']]);
  const page = fs.readFileSync(new URL('../src/pages/manage/ContactLinkPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /api!\.linkContact/);
  assert.match(page, /api!\.blockContact/);
  assert.doesNotMatch(page, /buyerPhoneLinkService|saveWorkspaceSettings/);
  assert.match(page, /navigator\.onLine === false/);
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('path="/manage/contacts"'));
});
