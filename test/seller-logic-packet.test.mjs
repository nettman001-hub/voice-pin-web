import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSellerLogicPacket } from '../src/services/sellerLogicPacket.ts';

const sessionId = 'packet-session';
const at = (seconds) => new Date(Date.parse('2026-10-05T10:00:00Z') + seconds * 1000).toISOString();
const comment = (id, seconds, content = '댓글 원문', nickname = '😚JJEONG😚') => ({
  id, sessionId, nickname, content, capturedAt: at(seconds), uniqueId: `account-${nickname}`,
});
const speech = (id, seconds, text = '판매자 원문') => ({ id, text, recognizedAt: at(seconds), isFinal: true });
const state = (comments = [], transcripts = [], extra = {}) => ({
  processedCommentIds: comments, processedTranscriptIds: transcripts, memory: [], purchaseIntentCommentIds: [],
  slotNumber: 2, appliedVersion: 7, ...extra,
});
const archive = (extra = {}) => ({ sessionId, slotNumber: 2, comments: [], transcripts: [], ...extra });
const decision = (id, c, s, status = 'CONFIRMED', extra = {}) => ({
  id, status, nickname: c.nickname, unitPrice: 20000, quantity: 1, reason: 'AI가 이전 구간에서 판단한 거래',
  commentIds: [c.id], transcriptIds: [s.id], decidedAt: s.recognizedAt, productName: `상품-${id}`, ...extra,
});
const freeze = (value) => {
  Object.freeze(value);
  Object.values(value).forEach((child) => { if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child); });
  return value;
};
function assertClosedReferences(packet) {
  const comments = new Set(packet.comments.map((row) => row.id));
  const transcripts = new Set(packet.transcripts.map((row) => row.id));
  for (const item of [...packet.analysisState.memory, ...packet.previousDecisions]) {
    assert.ok(item.commentIds.every((id) => comments.has(id)));
    assert.ok(item.transcriptIds.every((id) => transcripts.has(id)));
  }
  assert.ok(packet.analysisState.processedCommentIds.every((id) => comments.has(id) && !packet.incremental.newCommentIds.includes(id)));
  assert.ok(packet.analysisState.processedTranscriptIds.every((id) => transcripts.has(id) && !packet.incremental.newTranscriptIds.includes(id)));
  assert.ok(packet.analysisState.purchaseIntentCommentIds.every((id) => comments.has(id)
    && packet.previousDecisions.some((row) => row.commentIds.includes(id))));
  assert.ok(JSON.stringify(packet).length <= 32000);
}

test('a 10,000-event broadcast sends only bounded new source and local context without changing its archive', () => {
  const comments = Array.from({ length: 5000 }, (_, i) => comment(`c${i}`, i * 2));
  const transcripts = Array.from({ length: 5000 }, (_, i) => speech(`s${i}`, i * 2 + 1));
  const input = freeze(archive({ comments, transcripts, analysisState: state(comments.slice(0, 4995).map((row) => row.id), transcripts.slice(0, 4995).map((row) => row.id)) }));
  const before = JSON.stringify(input);
  const packet = prepareSellerLogicPacket(input);
  assert.equal(packet.incremental.newCommentIds.length + packet.incremental.newTranscriptIds.length, 10);
  assert.ok(packet.comments.length + packet.transcripts.length <= 70);
  assert.ok(packet.incremental.omittedEvents >= 9930);
  assert.ok(JSON.stringify(packet).length < 32000);
  assert.equal(JSON.stringify(input), before);
  assertClosedReferences(packet);
});

test('the fresh batch is chronological, at most 30 events, and keeps exact source identity and text', () => {
  const input = archive({
    comments: Array.from({ length: 40 }, (_, i) => comment(`c${i}`, i * 2, `1 베이지: ${i}`, '민영🩷( 육투비 )')),
    transcripts: Array.from({ length: 40 }, (_, i) => speech(`s${i}`, i * 2 + 1, `원문 ${i}`)),
  });
  const packet = prepareSellerLogicPacket(input);
  assert.equal(packet.incremental.newCommentIds.length, 15);
  assert.equal(packet.incremental.newTranscriptIds.length, 15);
  assert.equal(packet.comments[0].nickname, '민영🩷( 육투비 )');
  assert.equal(packet.comments[0].content, '1 베이지: 0');
  assert.equal(packet.comments[0], input.comments[0]);
  assert.equal(packet.incremental.omittedEvents, 50);
  assert.deepEqual(packet.analysisState.processedCommentIds, []);
  assert.deepEqual(packet.analysisState.processedTranscriptIds, []);
});

test('seller-only source is processed and its AI memory keeps a preceding offer for a later buyer', () => {
  const offer = speech('offer', 0, '검정 가디건은 1만8천원입니다.');
  const first = prepareSellerLogicPacket(archive({ transcripts: [offer] }));
  assert.deepEqual(first.incremental.newTranscriptIds, ['offer']);
  const memory = [{ text: '가디건 가격 안내', commentIds: [], transcriptIds: ['offer'] }];
  const next = prepareSellerLogicPacket(archive({
    comments: [comment('buyer', 500, '가디건 저요')], transcripts: [offer],
    analysisState: state([], ['offer'], { memory }),
  }));
  assert.deepEqual(next.incremental.newCommentIds, ['buyer']);
  assert.deepEqual(next.incremental.newTranscriptIds, []);
  assert.deepEqual(next.analysisState.processedTranscriptIds, ['offer']);
  assert.equal(next.transcripts[0].text, offer.text);
  assert.equal(next.analysisState.memory[0], memory[0]);
  assertClosedReferences(next);
});

test('late seller STT can see a nearby already-processed buyer without acknowledging that buyer again', () => {
  const buyer = comment('buyer', 110, '저요');
  const late = speech('late', 100, '가디건 가격 만원입니다.');
  const packet = prepareSellerLogicPacket(archive({ comments: [buyer], transcripts: [late], analysisState: state(['buyer']) }));
  assert.deepEqual(packet.incremental.newTranscriptIds, ['late']);
  assert.deepEqual(packet.incremental.newCommentIds, []);
  assert.deepEqual(packet.analysisState.processedCommentIds, ['buyer']);
  assert.equal(packet.comments[0], buyer);
  assertClosedReferences(packet);
});

test('AI literal history queries restore old product evidence, linked decisions and neighboring source', () => {
  const oldComment = comment('old-c', 1, '그 제품 저요');
  const oldSpeech = speech('old-s', 0, '빙하코트 가격은 22000원입니다.');
  const neighbor = speech('old-neighbor', 2, '아이보리 색상이 있어요.');
  const oldDecision = decision('old-d', oldComment, oldSpeech, 'CONFIRMED', { productName: '빙하코트' });
  const comments = [oldComment, ...Array.from({ length: 31 }, (_, i) => comment(`new-${i}`, 5000 + i, i === 30 ? '빙하코트 미래 댓글' : '새 대화'))];
  const input = freeze(archive({ comments, transcripts: [oldSpeech, neighbor], previousDecisions: [oldDecision],
    analysisState: state(['old-c'], ['old-s', 'old-neighbor'], { purchaseIntentCommentIds: ['old-c'] }),
  }));
  const ordinary = prepareSellerLogicPacket(input);
  assert.ok(!ordinary.transcripts.some((row) => row.id === 'old-s'));
  assert.equal(ordinary.previousDecisions.length, 0);
  const packet = prepareSellerLogicPacket(input, ['빙하코트']);
  assert.ok(packet.transcripts.some((row) => row.id === 'old-s'));
  assert.ok(packet.transcripts.some((row) => row.id === 'old-neighbor'));
  assert.equal(packet.previousDecisions[0], oldDecision);
  assert.deepEqual(packet.analysisState.purchaseIntentCommentIds, ['old-c']);
  assert.deepEqual(packet.incremental.historyQueries, ['빙하코트']);
  assert.equal(packet.incremental.historyExhausted, true);
  assert.deepEqual(packet.incremental.newCommentIds, ordinary.incremental.newCommentIds, 'history lookup must retry the same fresh batch');
  assert.ok(!packet.comments.some((row) => row.id === 'new-30'), 'unprocessed later evidence is not retrieved as history');
  assertClosedReferences(packet);
});

test('history lookup can use AI-written decision metadata when the literal term is absent from source', () => {
  const buyer = comment('old-c', 1, '저요');
  const seller = speech('old-s', 0, '이것은 만원입니다.');
  const prior = decision('prior', buyer, seller, 'CONFIRMED', { productName: 'AI가 기록한 삼각 가디건' });
  const packet = prepareSellerLogicPacket(archive({
    comments: [buyer, comment('fresh', 1000)], transcripts: [seller], previousDecisions: [prior],
    analysisState: state(['old-c'], ['old-s']),
  }), ['삼각 가디건']);
  assert.equal(packet.previousDecisions[0], prior);
  assert.ok(packet.comments.some((row) => row.id === 'old-c'));
  assert.ok(packet.transcripts.some((row) => row.id === 'old-s'));
  assertClosedReferences(packet);
});

test('fresh source keeps priority when many unresolved transactions and AI memory compete for space', () => {
  const comments = Array.from({ length: 100 }, (_, i) => comment(`old-c${i}`, i * 2, 'x'.repeat(200)));
  const transcripts = Array.from({ length: 100 }, (_, i) => speech(`old-s${i}`, i * 2 + 1, 'y'.repeat(200)));
  const decisions = comments.map((row, i) => decision(`d${i}`, row, transcripts[i], i % 2 ? 'PENDING' : 'REVIEW', { reason: '근거'.repeat(500) }));
  const memory = transcripts.map((row) => ({ text: 'AI의 기억'.repeat(180), commentIds: [], transcriptIds: [row.id] }));
  const fresh = comment('fresh', 10000, '최근 원문을 누락하면 안 됩니다.');
  const input = freeze(archive({ comments: [...comments, fresh], transcripts, previousDecisions: decisions,
    analysisState: state(comments.map((row) => row.id), transcripts.map((row) => row.id), { memory }),
  }));
  const packet = prepareSellerLogicPacket(input);
  assert.deepEqual(packet.incremental.newCommentIds, ['fresh']);
  assert.ok(packet.comments.includes(fresh));
  assert.ok(packet.analysisState.memory.length <= 20);
  assert.ok(packet.previousDecisions.length <= 20);
  assert.ok(packet.incremental.omittedDecisions > 0);
  assert.equal(input.previousDecisions.length, 100);
  assert.equal(input.analysisState.memory.length, 100);
  assertClosedReferences(packet);
});

test('context groups whose complete evidence does not fit are omitted atomically', () => {
  const old = speech('oversized-history', 0, 'x'.repeat(40000));
  const buyer = comment('old-buyer', 1);
  const prior = decision('too-large', buyer, old, 'PENDING');
  const memory = { text: '큰 원문을 인용한 기억', commentIds: [], transcriptIds: [old.id] };
  const packet = prepareSellerLogicPacket(archive({ comments: [buyer, comment('fresh', 5000)], transcripts: [old],
    previousDecisions: [prior], analysisState: state([buyer.id], [old.id], { memory: [memory] }),
  }));
  assert.deepEqual(packet.incremental.newCommentIds, ['fresh']);
  assert.equal(packet.analysisState.memory.length, 0);
  assert.equal(packet.previousDecisions.length, 0);
  assert.equal(packet.transcripts.length, 0);
  assert.equal(packet.comments.length, 1);
  assert.equal(packet.incremental.omittedDecisions, 1);
  assertClosedReferences(packet);
});

test('unknown or not-yet-processed references never leak into a memory or transaction group', () => {
  const comments = Array.from({ length: 31 }, (_, i) => comment(`c${i}`, i));
  const memory = [{ text: '잘못된 근거', commentIds: ['missing'], transcriptIds: [] },
    { text: '미래 미처리 근거', commentIds: ['c30'], transcriptIds: [] }];
  const packet = prepareSellerLogicPacket(archive({ comments, analysisState: state([], [], { memory }) }));
  assert.equal(packet.analysisState.memory.length, 0);
  assert.ok(!packet.comments.some((row) => row.id === 'c30'));
  assertClosedReferences(packet);
});

test('a fresh row over the 10,000-character source budget fails clearly and is never truncated', () => {
  const oversized = speech('large', 1, '음성'.repeat(5100));
  const input = freeze(archive({ transcripts: [oversized] }));
  assert.throws(() => prepareSellerLogicPacket(input), /한 행.*한도.*자르지/);
  assert.equal(input.transcripts[0].text.length, 10200);
});

test('the fresh source budget sends a smaller exact batch and leaves the remaining rows local', () => {
  const comments = Array.from({ length: 30 }, (_, i) => comment(`c${i}`, i, 'a'.repeat(1000)));
  const input = freeze(archive({ comments }));
  const packet = prepareSellerLogicPacket(input);
  assert.ok(packet.incremental.newCommentIds.length > 0 && packet.incremental.newCommentIds.length < 30);
  assert.ok(packet.comments.every((row) => row.content.length === 1000));
  assert.ok(packet.comments.reduce((sum, row) => sum + JSON.stringify(row).length, 0) <= 10000);
  assert.equal(input.comments.length, 30);
  assertClosedReferences(packet);
});

test('history queries are literal, limited to three and cannot classify source as purchase intent', () => {
  const packet = prepareSellerLogicPacket(archive({ comments: [comment('new', 10, '66 가능?')] }), ['  .*  ', '가디건', '니트', '네번째']);
  assert.deepEqual(packet.incremental.historyQueries, ['.*', '가디건', '니트']);
  assert.deepEqual(packet.analysisState.purchaseIntentCommentIds, []);
  assert.deepEqual(packet.previousDecisions, []);
});

test('a completed archive returns null while a selected slot change starts a fresh pass', () => {
  const source = comment('c', 0);
  const input = archive({ comments: [source], analysisState: state(['c']) });
  assert.equal(prepareSellerLogicPacket(input), null);
  const packet = prepareSellerLogicPacket({ ...input, slotNumber: 1 });
  assert.deepEqual(packet.incremental.newCommentIds, ['c']);
  assert.deepEqual(packet.analysisState.processedCommentIds, []);
  assert.equal(packet.analysisState.slotNumber, 1);
  assert.equal(packet.analysisState.appliedVersion, 7);
});

test('old confirmed history is not attached without recency, a search hit or a direct evidence link', () => {
  const comments = Array.from({ length: 50 }, (_, i) => comment(`c${i}`, i));
  const transcripts = comments.map((_, i) => speech(`s${i}`, i));
  const previousDecisions = comments.map((row, i) => decision(`d${i}`, row, transcripts[i]));
  const packet = prepareSellerLogicPacket(archive({ comments: [...comments, comment('fresh', 5000)], transcripts, previousDecisions,
    analysisState: state(comments.map((row) => row.id), transcripts.map((row) => row.id)),
  }));
  assert.equal(packet.previousDecisions.length, 0);
  assert.equal(packet.incremental.omittedDecisions, 50);
  assert.equal(packet.comments.length, 1);
  assert.equal(packet.transcripts.length, 0);
});
