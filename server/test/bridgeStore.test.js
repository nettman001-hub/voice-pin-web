const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { BridgeStore } = require('../bridgeStore');
const { createBridgeRouter } = require('../bridgeApi');

const createFixture = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voicecap-bridge-'));
  const store = new BridgeStore(path.join(directory, 'bridge.json'));
  return { directory, store };
};

test('incoming SMS is idempotent and persists image attachments', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const payload = {
    sellerId: 'seller-1',
    externalId: 'device-message-1',
    phoneNumber: '01012345678',
    body: '닉네임: 테스트\n금액: 10,000원',
    attachments: [{ id: 'a1', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' }]
  };

  const first = fixture.store.addIncoming(payload);
  const second = fixture.store.addIncoming(payload);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.message.id, second.message.id);
  assert.equal(fixture.store.listMessages('seller-1').length, 1);
  assert.equal(fixture.store.listMessages('seller-1')[0].attachments[0].mimeType, 'image/png');
});

test('outgoing SMS moves from queue to sent state', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const queued = fixture.store.queueOutgoing({
    sellerId: 'seller-1',
    phoneNumber: '01099998888',
    body: '확인 부탁드립니다.',
    category: 'QUESTION',
    saleIds: ['sale-1']
  });

  assert.equal(fixture.store.listOutbox('seller-1').length, 1);
  const sent = fixture.store.updateOutgoing(queued.id, { status: 'SENT', sentAt: '2026-08-29T00:00:00.000Z' });
  assert.equal(sent.status, 'SENT');
  assert.equal(fixture.store.listOutbox('seller-1').length, 0);
});

test('registered customer inquiry keeps its conversation category', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  const inquiry = fixture.store.addIncoming({
    sellerId: 'seller-1',
    externalId: 'customer-inquiry-1',
    phoneNumber: '01012345678',
    body: '택배는 언제 도착하나요?',
    category: 'CUSTOMER_INQUIRY'
  });

  assert.equal(inquiry.created, true);
  assert.equal(inquiry.message.category, 'CUSTOMER_INQUIRY');
  assert.equal(fixture.store.listMessages('seller-1')[0].body, '택배는 언제 도착하나요?');
});

test('bridge API authenticates and exposes queued messages', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const app = express();
  app.use(express.json());
  app.use('/api', createBridgeRouter({ store: fixture.store, apiKey: 'test-key' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/api/bridge/status`);
  assert.equal(unauthorized.status, 401);

  const queuedResponse = await fetch(`${baseUrl}/api/sms/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VoiceCAP-Key': 'test-key' },
    body: JSON.stringify({ sellerId: 'seller-1', phoneNumber: '01011112222', body: '정산서', category: 'INVOICE' })
  });
  assert.equal(queuedResponse.status, 201);

  const outboxResponse = await fetch(`${baseUrl}/api/sms/outbox?sellerId=seller-1`, {
    headers: { 'X-VoiceCAP-Key': 'test-key' }
  });
  const outbox = await outboxResponse.json();
  assert.equal(outbox.messages.length, 1);
  assert.equal(outbox.messages[0].category, 'INVOICE');
});
