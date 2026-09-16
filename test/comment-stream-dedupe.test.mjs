import test from 'node:test';
import assert from 'node:assert/strict';

// commentDedupeKey 로직 검증
const normalizeForDedupe = (text) => text.replace(/\s+/g, ' ').trim();
const commentDedupeKey = (nickname, content, messageId, timestamp) => {
  if (messageId && String(messageId).trim()) {
    return `msg:${String(messageId).trim()}`;
  }
  return `${normalizeForDedupe(nickname)}␟${normalizeForDedupe(content)}␟${timestamp || ''}`;
};

test('Comment Deduplication: Repeated identical comments with different message IDs are preserved', () => {
  const seenKeys = new Set();

  const comment1 = { nickname: '구매자A', content: '1', messageId: 'msg-101', time: '2026-09-17T00:00:01Z' };
  const comment2 = { nickname: '구매자A', content: '1', messageId: 'msg-102', time: '2026-09-17T00:00:02Z' };
  const comment3 = { nickname: '구매자A', content: '1', messageId: 'msg-103', time: '2026-09-17T00:00:03Z' };

  const key1 = commentDedupeKey(comment1.nickname, comment1.content, comment1.messageId, comment1.time);
  assert.equal(seenKeys.has(key1), false);
  seenKeys.add(key1);

  const key2 = commentDedupeKey(comment2.nickname, comment2.content, comment2.messageId, comment2.time);
  assert.equal(seenKeys.has(key2), false, 'Same user typing "1" again must NOT be dropped');
  seenKeys.add(key2);

  const key3 = commentDedupeKey(comment3.nickname, comment3.content, comment3.messageId, comment3.time);
  assert.equal(seenKeys.has(key3), false, 'Same user typing "1" 3rd time must NOT be dropped');
  seenKeys.add(key3);

  assert.equal(seenKeys.size, 3);
});

test('Comment Deduplication: Exact same message ID duplicate is correctly dropped', () => {
  const seenKeys = new Set();
  const key = commentDedupeKey('구매자B', '저요', 'msg-dup-1', '2026-09-17T00:00:01Z');
  assert.equal(seenKeys.has(key), false);
  seenKeys.add(key);

  // Duplicate network packet arrival
  assert.equal(seenKeys.has(key), true, 'Duplicate packet with same message ID must be dropped');
});

test('Lossless Feed Merge: Cloud feed does not wipe out existing local comments', () => {
  // Existing comments currently displayed on the screen
  const prevComments = [
    { id: 'stream-1', platformMessageId: 'msg-1', sessionId: 'sess-1', nickname: 'user1', content: '첫번째 댓글', capturedAt: '2026-09-17T00:00:01Z' },
    { id: 'stream-2', platformMessageId: 'msg-2', sessionId: 'sess-1', nickname: 'user2', content: '두번째 댓글', capturedAt: '2026-09-17T00:00:02Z' },
    { id: 'stream-3', platformMessageId: 'msg-3', sessionId: 'sess-1', nickname: 'user3', content: '세번째 댓글', capturedAt: '2026-09-17T00:00:03Z' },
  ];

  // Cloud feed only returned the newest 1 comment (e.g. limit or pagination)
  const sessionRecords = [
    { id: 'cloud-uuid-3', platformMessageId: 'msg-3', sessionId: 'sess-1', nickname: 'user3', content: '세번째 댓글', capturedAt: '2026-09-17T00:00:03Z' },
    { id: 'cloud-uuid-4', platformMessageId: 'msg-4', sessionId: 'sess-1', nickname: 'user4', content: '네번째 댓글', capturedAt: '2026-09-17T00:00:04Z' },
  ];

  const byMsgId = new Map();
  const byRecordId = new Map();

  // 1. Preserve existing
  for (const item of prevComments) {
    if (item.platformMessageId) byMsgId.set(item.platformMessageId, item);
    else byRecordId.set(item.id, item);
  }

  // 2. Overwrite / add from cloud
  for (const cloudRec of sessionRecords) {
    if (cloudRec.platformMessageId && byMsgId.has(cloudRec.platformMessageId)) {
      const existing = byMsgId.get(cloudRec.platformMessageId);
      byMsgId.set(cloudRec.platformMessageId, {
        ...existing,
        id: cloudRec.id,
      });
    } else if (cloudRec.platformMessageId) {
      byMsgId.set(cloudRec.platformMessageId, cloudRec);
    } else {
      byRecordId.set(cloudRec.id, cloudRec);
    }
  }

  const merged = [...Array.from(byMsgId.values()), ...Array.from(byRecordId.values())]
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  // Result must contain all 4 comments! (Lossless merge)
  assert.equal(merged.length, 4, 'All 4 comments must be preserved without loss');
  assert.equal(merged[0].id, 'stream-1');
  assert.equal(merged[1].id, 'stream-2');
  assert.equal(merged[2].id, 'cloud-uuid-3', 'Cloud UUID should update the temporary stream ID');
  assert.equal(merged[3].id, 'cloud-uuid-4');
});
