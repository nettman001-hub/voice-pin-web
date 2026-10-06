import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSellerLogicDeepEvents, sellerLogicDeepSegmentSignature } from '../src/services/sellerLogicDeepSegmenter.ts';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const at = (seconds) => new Date(epoch + seconds * 1000).toISOString();
const comment = (id, seconds, content = '저요') => ({ id, sessionId: 'segment-test', nickname: '루비', content, capturedAt: at(seconds) });
const speech = (id, seconds, text = '드릴게요', extra = {}) => ({ id, text, recognizedAt: at(seconds), isFinal: true, ...extra });

test('an idle gap closes a bucket and the last bucket stays open until the idle window passes', () => {
  const comments = [comment('c1', 0)];
  const transcripts = [speech('s1', 2), speech('s2', 60)];
  const split = segmentSellerLogicDeepEvents(comments, transcripts, { now: epoch + 65_000 });
  assert.equal(split.length, 2);
  assert.deepEqual(split[0].commentIds, ['c1']);
  assert.deepEqual(split[0].transcriptIds, ['s1']);
  assert.equal(split[0].closed, true);
  assert.equal(split[1].closed, false, 'only 5 seconds passed after the last event');
  const closed = segmentSellerLogicDeepEvents(comments, transcripts, { now: epoch + 95_000 });
  assert.equal(closed[1].closed, true);
});

test('the event ceiling splits one bucket deterministically', () => {
  const comments = Array.from({ length: 5 }, (_, index) => comment(`c${index}`, index));
  const segments = segmentSellerLogicDeepEvents(comments, [], { maxEvents: 2, now: epoch + 600_000 });
  assert.deepEqual(segments.map((segment) => segment.commentIds), [['c0', 'c1'], ['c2', 'c3'], ['c4']]);
  assert.deepEqual(segments.map((segment) => segment.index), [0, 1, 2]);
});

test('long source text splits a bucket by the character budget before it reaches the AI', () => {
  const transcripts = Array.from({ length: 4 }, (_, index) => speech(`s${index}`, index, '가'.repeat(300)));
  const segments = segmentSellerLogicDeepEvents([], transcripts, { maxCharacters: 900, now: epoch + 600_000 });
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((segment) => segment.transcriptIds.length), [2, 2]);
});

test('a revised transcript changes its bucket signature without moving the bucket', () => {
  const first = segmentSellerLogicDeepEvents([], [speech('s1', 0, '초안')], { now: epoch + 60_000 })[0];
  const before = sellerLogicDeepSegmentSignature(first, [], [speech('s1', 0, '초안')]);
  const after = sellerLogicDeepSegmentSignature(first, [], [speech('s1', 0, '수정', { revision: 2 })]);
  assert.notEqual(before, after);
  assert.equal(sellerLogicDeepSegmentSignature(first, [], [speech('s1', 0, '초안')]), before, 'unchanged evidence keeps the same signature');
});

test('invalid event times are rejected instead of producing a bogus bucket', () => {
  assert.throws(() => segmentSellerLogicDeepEvents([{ ...comment('bad', 1), capturedAt: 'not-a-time' }], []), /시각/);
});
