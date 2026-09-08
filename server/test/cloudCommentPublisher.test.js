const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudCommentPublisher } = require('../cloudCommentPublisher');

test('CloudCommentPublisher: preserves platform message ID, user ID, nickname, and content', async () => {
  const dispatchedBatches = [];

  const publisher = new CloudCommentPublisher({
    apiUrl: 'https://api.voicecap.local/functions/v1/sales-api',
    deviceToken: 'test-device-token',
    workspaceId: 'ws-123',
    sessionId: 'session-456',
    collectorId: 'device-789',
    batchSize: 2,
    flushIntervalMs: 50,
    fetchFn: async (url, opts) => {
      dispatchedBatches.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });

  publisher.enqueue({
    id: 'msg-tiktok-001',
    userId: 'tt-user-100',
    uniqueId: 'cheolsu_id',
    nickname: '철수',
    content: '123번 저요',
    receivedAt: '2026-09-08T09:00:00.000Z',
  });

  publisher.enqueue({
    id: 'msg-tiktok-002',
    userId: 'tt-user-200',
    uniqueId: 'younghee_id',
    nickname: '영희',
    content: '구매할게요',
    receivedAt: '2026-09-08T09:00:01.000Z',
  });

  // Batch size of 2 should trigger flush immediately
  // Wait a microtask
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(dispatchedBatches.length, 1);
  const payload = dispatchedBatches[0];
  assert.equal(payload.action, 'ingest-comments');
  assert.equal(payload.sessionId, 'session-456');
  assert.equal(payload.collectorId, 'device-789');
  assert.equal(payload.comments.length, 2);

  const c1 = payload.comments[0];
  assert.equal(c1.platformMessageId, 'msg-tiktok-001');
  assert.equal(c1.platformUserId, 'tt-user-100');
  assert.equal(c1.platformUniqueId, 'cheolsu_id');
  assert.equal(c1.nickname, '철수');
  assert.equal(c1.content, '123번 저요');
  assert.equal(c1.ingestSequence, 1);

  const stats = publisher.getStats();
  assert.equal(stats.queuedCount, 2);
  assert.equal(stats.sentCount, 2);
  assert.equal(stats.failedCount, 0);

  publisher.stop();
});

test('CloudCommentPublisher: retries with backoff upon server error', async () => {
  let callCount = 0;
  const publisher = new CloudCommentPublisher({
    apiUrl: 'https://api.voicecap.local/functions/v1/sales-api',
    batchSize: 1,
    maxRetries: 2,
    fetchFn: async () => {
      callCount += 1;
      if (callCount < 2) {
        return { ok: false, status: 500, text: async () => 'Internal Server Error' };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    logger: { warn: () => {}, error: () => {} },
  });

  publisher.enqueue({
    id: 'msg-retry-1',
    content: '테스트',
  });

  await new Promise((r) => setTimeout(r, 400));

  assert.equal(callCount, 2);
  const stats = publisher.getStats();
  assert.equal(stats.sentCount, 1);
  assert.equal(stats.retryCount, 1);
  assert.equal(stats.failedCount, 0);

  publisher.stop();
});

test('CloudCommentPublisher: timer flushes partial batch if batchSize is not reached', async () => {
  let dispatched = false;
  const publisher = new CloudCommentPublisher({
    apiUrl: 'https://api.voicecap.local/functions/v1/sales-api',
    batchSize: 5,
    flushIntervalMs: 30,
    fetchFn: async () => {
      dispatched = true;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });

  publisher.enqueue({
    id: 'msg-timer-1',
    content: '단독 댓글',
  });

  assert.equal(dispatched, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(dispatched, true);

  publisher.stop();
});
