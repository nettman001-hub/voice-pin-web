import test from 'node:test';
import assert from 'node:assert/strict';
import { runSellerLogicPipeline } from '../src/services/sellerLogicPipeline.ts';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const at = (seconds) => new Date(epoch + seconds * 1000).toISOString();
const comment = (id, seconds, content = '댓글 원문') => ({ id, sessionId: 'pipeline-test', nickname: '루비👻', content, capturedAt: at(seconds) });
const speech = (id, seconds, text = '판매자 원문', extra = {}) => ({ id, text, recognizedAt: at(seconds), isFinal: true, ...extra });
const input = (comments = [], transcripts = [], extra = {}) => ({ sessionId: 'pipeline-test', slotNumber: 2, comments, transcripts, ...extra });
const candidate = (id, commentIds = [], transcriptIds = []) => ({ id, summary: `${id} 판매 발화`, commentIds, transcriptIds });
const detection = (signals = [], carry = []) => ({ signals, carry, summary: '발화 탐지 결과', provider: 'EXISTING', model: 'selected-model', appliedVersion: 7 });
const transaction = (id, commentIds, transcriptIds, extra = {}) => ({
  id, nickname: '루비👻', status: 'CONFIRMED', unitPrice: 20000, quantity: 1, productName: '니트',
  reason: 'AI가 구매 요청과 판매자 확답을 연결함', commentIds, transcriptIds, decidedAt: at(0), ...extra,
});
function linked(packet, decisions = [], links = packet.linkSignals.map((signal) => ({ signalId: signal.id, outcome: 'UNMATCHED', decisionIds: [] }))) {
  return {
    decisions, signalLinks: links, purchaseIntentCommentIds: [...new Set(decisions.flatMap((row) => row.commentIds))],
    summary: '판매 연결 결과', provider: 'EXISTING', model: 'selected-model', hasMore: false,
    analysisState: { processedCommentIds: packet.comments.map((row) => row.id), processedTranscriptIds: packet.transcripts.map((row) => row.id),
      memory: [], purchaseIntentCommentIds: [], slotNumber: packet.slotNumber, appliedVersion: 7 },
  };
}
const matched = (packet, decision) => linked(packet, [decision], packet.linkSignals.map((signal) => ({ signalId: signal.id, outcome: 'MATCHED', decisionIds: [decision.id] })));
const resume = (archive, result, extra = {}) => ({ ...archive, previousDecisions: result.decisions, analysisState: result.analysisState, pipeline: result.pipeline, ...extra });
function recorder(detect = () => detection(), link = (packet) => linked(packet)) {
  const detections = [], links = [];
  return { detections, links, calls: {
    async detect(packet) { detections.push(packet); return detect(packet, detections.length); },
    async link(packet) { links.push(packet); return link(packet, links.length); },
  } };
}
const live = (seconds) => ({ live: true, now: epoch + seconds * 1000 });

test('a seller-first order-code signal remains visible without inventing a buyer or transaction', async () => {
  const archive = input([], [speech('number-announcement', 0, '그레이 니트 7,000원, 1번입니다.')]);
  const r = recorder(() => detection([candidate('order-code', [], ['number-announcement'])]));
  const first = await runSellerLogicPipeline(archive, r.calls, live(1));
  assert.equal(r.links.length, 1, 'a seller-only signal must immediately reach stage two');
  assert.deepEqual(r.links[0].comments, []);
  assert.deepEqual(first.decisions, [], 'an unmatched product announcement is not a pending purchase');
  assert.deepEqual(first.purchaseIntentCommentIds, []);
  assert.equal(first.pipeline.signals[0].status, 'WATCHING');
  assert.equal(first.pipeline.signals[0].startedAt, at(0));
  assert.deepEqual(first.pipeline.signals[0].transcriptIds, ['number-announcement']);

  const closed = await runSellerLogicPipeline(resume(archive, first), r.calls, live(61));
  assert.equal(closed.pipeline.signals[0].status, 'UNMATCHED');
  assert.equal(closed.pipeline.signals[0].id, 'order-code');
  assert.deepEqual(closed.decisions, []);
  assert.equal(r.detections.length, 1);
  assert.equal(r.links.length, 1, 'quiet observation expiry must not repeat a paid inference');
});

test('a seller-first order code links a later buyer and confirmation to the same signal', async () => {
  const archive = input([], [speech('number-announcement', 0, '그레이 니트 7,000원, 1번입니다.')]);
  const first = await runSellerLogicPipeline(archive, recorder(() => detection([
    candidate('order-code', [], ['number-announcement']),
  ])).calls, live(1));
  const buyerArchive = input([comment('number-order', 25, '1번 저요')], archive.transcripts);
  const pendingSale = transaction('number-sale', ['number-order'], ['number-announcement'], {
    status: 'PENDING', unitPrice: 7000, orderCode: '1', productName: '그레이 니트',
  });
  const buyer = recorder((packet) => {
    assert.equal(packet.existingSignals[0].id, 'order-code');
    assert.ok(packet.transcripts.some((row) => row.id === 'number-announcement'), 'retain the number mapping after short overlap expires');
    return detection([candidate('order-code', ['number-order'], ['number-announcement'])]);
  }, (packet) => matched(packet, pendingSale));
  const pending = await runSellerLogicPipeline(resume(buyerArchive, first), buyer.calls, live(26));
  assert.equal(pending.decisions.length, 1);
  assert.equal(pending.decisions[0].status, 'PENDING');
  assert.equal(pending.pipeline.signals.length, 1);
  assert.equal(pending.pipeline.signals[0].id, 'order-code');

  const finalArchive = input(buyerArchive.comments, [...archive.transcripts,
    speech('number-confirmation', 35, '루비 언니 1번 그레이 니트 7,000원 드릴게요.'),
  ]);
  const confirmation = recorder((packet) => {
    assert.equal(packet.existingSignals[0].id, 'order-code');
    return detection([candidate('order-code', ['number-order'], ['number-announcement', 'number-confirmation'])]);
  }, (packet) => {
    assert.equal(packet.previousDecisions[0].id, 'number-sale');
    return matched(packet, { ...pendingSale, status: 'CONFIRMED', transcriptIds: ['number-announcement', 'number-confirmation'] });
  });
  const confirmed = await runSellerLogicPipeline(resume(finalArchive, pending), confirmation.calls, live(36));
  assert.equal(confirmed.decisions.length, 1);
  assert.equal(confirmed.decisions[0].id, 'number-sale');
  assert.equal(confirmed.decisions[0].status, 'CONFIRMED');
  assert.equal(confirmed.decisions[0].unitPrice, 7000);
  assert.equal(confirmed.pipeline.signals.length, 1);
  assert.deepEqual(confirmed.pipeline.signals[0].decisionIds, ['number-sale']);
});

test('a broadcast with no detected sale calls only stage one and preserves every processed source', async () => {
  const archive = input([comment('question', 2, '가슴 단면이 얼마인가요?')], [speech('greeting', 0, '안녕하세요'), speech('description', 8, '부드러운 소재예요')]);
  const r = recorder();
  const result = await runSellerLogicPipeline(archive, r.calls);
  assert.equal(r.detections.length, 2);
  assert.equal(r.links.length, 0);
  assert.equal(result.pipeline.stats.detectCalls, 2);
  assert.equal(result.pipeline.stats.linkCalls, 0);
  assert.deepEqual(result.analysisState.processedCommentIds, ['question']);
  assert.deepEqual(result.analysisState.processedTranscriptIds, ['greeting', 'description']);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.decisions, []);
});

test('AI carry keeps a split utterance beyond the short overlap and its complete cited source travels with it', async () => {
  const old = input([], [speech('opening', 0, '루비 언니 그거')]);
  const first = recorder(() => detection([], [{ reason: '아직 문장이 끝나지 않음', commentIds: [], transcriptIds: ['opening'] }]));
  const partial = await runSellerLogicPipeline(old, first.calls, live(1));
  const archive = resume(input([], [...old.transcripts, speech('ending', 40, '이만원에 드릴게요')]), partial);
  const next = recorder((packet) => {
    assert.equal(packet.carry.length, 1);
    assert.deepEqual(packet.freshTranscriptIds, ['ending']);
    assert.ok(packet.transcripts.some((row) => row.id === 'opening'));
    return detection([candidate('offer', [], ['opening', 'ending'])]);
  });
  const result = await runSellerLogicPipeline(archive, next.calls, live(41));
  assert.equal(next.detections.length, 1);
  assert.equal(next.links.length, 1);
  assert.deepEqual(result.pipeline.carry, [], 'only the AI decides whether a carried fragment is resolved');
  assert.equal(result.pipeline.signals[0].status, 'WATCHING');
});

test('the next detection receives recent split-speech overlap without presenting it as fresh again', async () => {
  const original = input([], [speech('part-a', 0, '루비 언니')]);
  const r = recorder();
  const first = await runSellerLogicPipeline(original, r.calls, live(1));
  await runSellerLogicPipeline(resume(input([], [...original.transcripts, speech('part-b', 10, '드릴게요')]), first), r.calls, live(11));
  assert.deepEqual(r.detections[1].freshTranscriptIds, ['part-b']);
  assert.deepEqual(r.detections[1].transcripts.map((row) => row.id), ['part-a', 'part-b']);
});

test('same-id text/finality revisions are detected again without duplicating the source or transaction', async () => {
  const original = input([], [speech('utterance', 0, '루비 언니', { isFinal: false, revision: 1 })]);
  const r = recorder();
  const first = await runSellerLogicPipeline(original, r.calls, live(1));
  const revised = resume(input([], [speech('utterance', 0, '루비 언니 드릴게요', { revision: 2 })]), first);
  const second = await runSellerLogicPipeline(revised, r.calls, live(2));
  assert.equal(r.detections.length, 2);
  assert.deepEqual(r.detections[1].freshTranscriptIds, ['utterance']);
  assert.equal(r.detections[1].transcripts.length, 1);
  assert.deepEqual(second.analysisState.processedTranscriptIds, ['utterance']);
  await runSellerLogicPipeline(resume(revised, second), r.calls, live(3));
  assert.equal(r.detections.length, 2, 'an unchanged revision does not repeat detection');
});

test('an adequately grounded AI confirmation is published immediately while the future observation remains open', async () => {
  const archive = input([comment('buy', 0, '저요')], [speech('allocation', 1, '루비 언니 이만원에 드릴게요')]);
  const sale = transaction('stable-sale', ['buy'], ['allocation']);
  const r = recorder(() => detection([candidate('offer', ['buy'], ['allocation'])]), (packet) => matched(packet, sale));
  const progress = [];
  const result = await runSellerLogicPipeline(archive, r.calls, { ...live(2), onProgress: (partial) => progress.push(partial) });
  assert.equal(r.links.length, 1);
  assert.equal(result.decisions[0].status, 'CONFIRMED');
  assert.equal(result.pipeline.signals[0].status, 'LINKED');
  assert.equal(result.pipeline.signals[0].observationClosed, false);
  assert.ok(progress.some((partial) => partial.decisions[0]?.status === 'CONFIRMED'));
  assert.equal(result.decisions[0].nickname, '루비👻');
});

test('AI-detected follow-up confirms a pending sale using the same transaction ID', async () => {
  const original = input([comment('buy', 0)], [speech('offer', 1)]);
  const pending = transaction('same-sale', ['buy'], ['offer'], { status: 'PENDING', unitPrice: null });
  const first = recorder(() => detection([candidate('same-signal', ['buy'], ['offer'])]), (packet) => matched(packet, pending));
  const partial = await runSellerLogicPipeline(original, first.calls, live(2));
  const archive = resume(input(original.comments, [...original.transcripts, speech('confirm', 20)]), partial);
  const next = recorder((packet) => {
    assert.equal(packet.existingSignals[0].id, 'same-signal');
    return detection([candidate('same-signal', ['buy'], ['confirm'])]);
  }, (packet) => {
    assert.equal(packet.previousDecisions[0].id, 'same-sale');
    return matched(packet, { ...pending, status: 'CONFIRMED', unitPrice: 18000, transcriptIds: ['offer', 'confirm'] });
  });
  const result = await runSellerLogicPipeline(archive, next.calls, live(21));
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].id, 'same-sale');
  assert.equal(result.decisions[0].unitPrice, 18000);
  assert.equal(result.pipeline.signals.length, 1);
  assert.equal(result.pipeline.signals[0].status, 'LINKED');
});

test('new raw evidence missed by detection receives exactly one closing link pass at the deadline', async () => {
  const original = input([], [speech('offer', 0)]);
  const r = recorder((_packet, index) => detection(index === 1 ? [candidate('signal', [], ['offer'])] : []));
  const first = await runSellerLogicPipeline(original, r.calls, live(1));
  const archive = input([comment('followup', 20)], original.transcripts);
  const changed = await runSellerLogicPipeline(resume(archive, first), r.calls, live(21));
  assert.equal(r.links.length, 1, 'new unrelated data alone does not invoke stage two immediately');
  const closed = await runSellerLogicPipeline(resume(archive, changed), r.calls, live(60));
  assert.equal(r.links.length, 2);
  assert.equal(closed.pipeline.signals[0].observationClosed, true);
  assert.equal(closed.pipeline.signals[0].status, 'UNMATCHED');
  const again = await runSellerLogicPipeline(resume(archive, closed), r.calls, live(120));
  assert.equal(r.links.length, 2);
  assert.equal(r.detections.length, 2);
  assert.equal(again.pipeline.stats.linkCalls, 2);
});

test('a quiet deadline closes observation without repeating either AI stage', async () => {
  const archive = input([], [speech('offer', 0)]);
  const r = recorder(() => detection([candidate('signal', [], ['offer'])]));
  const first = await runSellerLogicPipeline(archive, r.calls, live(1));
  const closed = await runSellerLogicPipeline(resume(archive, first), r.calls, live(60));
  assert.equal(r.detections.length, 1);
  assert.equal(r.links.length, 1);
  assert.equal(closed.pipeline.signals[0].status, 'UNMATCHED');
  assert.equal(closed.pipeline.signals[0].observationClosed, true);
});

test('a late source with an old event timestamp reopens a closed window for evidence-based revision', async () => {
  const original = input([], [speech('offer', 0)]);
  const first = recorder(() => detection([candidate('signal', [], ['offer'])]));
  const closed = await runSellerLogicPipeline(original, first.calls, live(61));
  assert.equal(closed.pipeline.signals[0].observationClosed, true);
  const archive = resume(input([comment('late-buy', 20, '아까 그거 저요')], original.transcripts), closed);
  const next = recorder(() => detection(), (packet) => matched(packet, transaction('late-sale', ['late-buy'], ['offer'])));
  const result = await runSellerLogicPipeline(archive, next.calls, live(90));
  assert.equal(next.links.length, 1);
  assert.equal(result.pipeline.signals[0].id, 'signal');
  assert.equal(result.pipeline.signals[0].status, 'LINKED');
  assert.equal(result.decisions[0].id, 'late-sale');
});

test('import replay does not reveal later source rows in the first linking request', async () => {
  const archive = input([comment('later-buy', 40)], [speech('offer', 0), speech('future-product', 80)]);
  const r = recorder((packet, index) => detection(index === 1 ? [candidate('signal', [], ['offer'])]
    : index === 2 ? [candidate('signal', ['later-buy'], ['offer'])] : []));
  const result = await runSellerLogicPipeline(archive, r.calls, { live: false });
  assert.deepEqual(r.links[0].comments, []);
  assert.deepEqual(r.links[0].transcripts.map((row) => row.id), ['offer']);
  assert.ok(r.links[1].comments.some((row) => row.id === 'later-buy'));
  assert.ok(!r.links[1].transcripts.some((row) => row.id === 'future-product'));
  assert.equal(result.hasMore, false);
  assert.equal(result.pipeline.signals[0].observationClosed, true);
});

test('a failure after detection resumes its pending link checkpoint without repeating detection', async () => {
  const archive = input([], [speech('offer', 0)]);
  const first = recorder(() => detection([candidate('signal', [], ['offer'])]), () => { throw new Error('link unavailable'); });
  let checkpoint;
  await assert.rejects(runSellerLogicPipeline(archive, first.calls, { ...live(1), onProgress: (partial) => { checkpoint = partial; } }), /link unavailable/);
  assert.equal(checkpoint.pipeline.signals[0].needsAnalysis, true);
  assert.deepEqual(checkpoint.analysisState.processedTranscriptIds, ['offer']);
  const next = recorder(() => { throw new Error('detection must not repeat'); });
  const result = await runSellerLogicPipeline(resume(archive, checkpoint), next.calls, live(2));
  assert.equal(next.detections.length, 0);
  assert.equal(next.links.length, 1);
  assert.equal(result.pipeline.signals[0].needsAnalysis, false);
});

test('ten thousand locally stored events send only fresh five-second packets and bounded overlap', async () => {
  const comments = Array.from({ length: 10_000 }, (_, index) => comment(`comment-${index}`, index));
  const seenRevisions = Object.fromEntries(comments.slice(0, 9990).map((row) => [`C:${row.id}`, JSON.stringify([row.content, row.nickname, row.capturedAt])]));
  const pipeline = { slotNumber: 2, seenRevisions, carry: [], signals: [], observedThrough: epoch + 9989_000,
    stats: { detectCalls: 0, linkCalls: 0, detectMs: 0, linkMs: 0 } };
  const archive = input(comments, [], { pipeline });
  const before = JSON.stringify(archive);
  const r = recorder((packet) => {
    assert.ok(packet.comments.length <= 60);
    assert.ok(packet.freshCommentIds.length <= 30);
    assert.ok(JSON.stringify(packet).length <= 32_000);
    assert.equal(packet.pipeline, undefined, 'the complete local state is never a request field');
    return detection();
  });
  const result = await runSellerLogicPipeline(archive, r.calls, live(10_001));
  assert.equal(r.detections.length, 2);
  assert.equal(r.detections.flatMap((packet) => packet.freshCommentIds).length, 10);
  assert.equal(result.analysisState.processedCommentIds.length, 10_000);
  assert.equal(JSON.stringify(archive), before, 'preparing requests never mutates the browser archive or previous checkpoint');
});

test('a same-time burst is divided into at most thirty fresh events without omission', async () => {
  const archive = input(Array.from({ length: 95 }, (_, index) => comment(`burst-${index}`, 0)));
  const r = recorder();
  await runSellerLogicPipeline(archive, r.calls);
  assert.equal(r.detections.length, 4);
  assert.ok(r.detections.every((packet) => packet.freshCommentIds.length <= 30));
  const delivered = r.detections.flatMap((packet) => packet.freshCommentIds);
  assert.equal(new Set(delivered).size, 95);
  assert.equal(delivered.length, 95);
});

test('overlapping sale signals share one deduplicated linking packet with distinct signal IDs', async () => {
  const archive = input([comment('buyer', 1)], [speech('offer-a', 0), speech('offer-b', 2)]);
  const r = recorder(() => detection([candidate('a', ['buyer'], ['offer-a']), candidate('b', ['buyer'], ['offer-b'])]));
  const result = await runSellerLogicPipeline(archive, r.calls, live(3));
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.links[0].linkSignals.map((row) => row.id), ['a', 'b']);
  assert.equal(r.links[0].comments.length, 1);
  assert.equal(r.links[0].transcripts.length, 2);
  assert.equal(result.pipeline.signals.length, 2);
});

test('a later AI price correction updates the existing confirmed transaction instead of inserting a duplicate', async () => {
  const original = input([comment('buyer', 0)], [speech('offer', 1)]);
  const sale = transaction('stable-sale', ['buyer'], ['offer'], { unitPrice: 18000 });
  const first = recorder(() => detection([candidate('signal', ['buyer'], ['offer'])]), (packet) => matched(packet, sale));
  const partial = await runSellerLogicPipeline(original, first.calls, live(2));
  const archive = resume(input(original.comments, [...original.transcripts, speech('correction', 15, '아니 만오천원')]), partial);
  const next = recorder(() => detection([candidate('signal', [], ['correction'])]), (packet) => matched(packet, {
    ...sale, unitPrice: 15000, transcriptIds: ['offer', 'correction'], reason: 'AI가 판매자의 가격 정정을 확인함',
  }));
  const result = await runSellerLogicPipeline(archive, next.calls, live(16));
  assert.equal(next.links[0].previousDecisions[0].unitPrice, 18000);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].id, 'stable-sale');
  assert.equal(result.decisions[0].unitPrice, 15000);
});

test('aborting inside progress keeps the detection checkpoint and prevents a subsequent linking request', async () => {
  const archive = input([], [speech('offer', 0)]);
  const controller = new AbortController();
  const r = recorder(() => detection([candidate('signal', [], ['offer'])]));
  let checkpoint;
  await assert.rejects(runSellerLogicPipeline(archive, r.calls, { ...live(1), signal: controller.signal,
    onProgress: (partial) => { checkpoint = partial; controller.abort(); } }), { name: 'AbortError' });
  assert.equal(r.links.length, 0);
  assert.equal(checkpoint.pipeline.signals[0].needsAnalysis, true);
  assert.deepEqual(checkpoint.analysisState.processedTranscriptIds, ['offer']);
});

test('an oversized indivisible source fails explicitly and keeps the local original unchanged', async () => {
  const archive = input([comment('too-large', 0, '원문'.repeat(6000))]);
  const before = JSON.stringify(archive);
  const r = recorder();
  await assert.rejects(runSellerLogicPipeline(archive, r.calls), /원문.*한도/);
  assert.equal(r.detections.length, 0);
  assert.equal(r.links.length, 0);
  assert.equal(JSON.stringify(archive), before);
});

test('a corrected STT timestamp is a new evidence revision even when its text is unchanged', async () => {
  const archive = input([], [speech('timing', 0)]);
  const r = recorder();
  const first = await runSellerLogicPipeline(archive, r.calls, live(1));
  await runSellerLogicPipeline(resume(input([], [speech('timing', 3)]), first), r.calls, live(4));
  assert.equal(r.detections.length, 2);
});

test('signal observation is anchored to seller utterance times rather than an earlier cited buyer comment', async () => {
  const archive = input([comment('buyer', -10)], [speech('offer', 0, '이만원 드릴게요', { startedAt: at(0), endedAt: at(2) })]);
  const r = recorder((packet) => detection(packet.freshTranscriptIds.includes('offer') ? [candidate('signal', ['buyer'], ['offer'])] : []));
  const result = await runSellerLogicPipeline(archive, r.calls, live(3));
  assert.equal(result.pipeline.signals[0].startedAt, at(0));
  assert.equal(result.pipeline.signals[0].endedAt, at(2));
  assert.equal(result.pipeline.signals[0].observedUntil, at(62));
});

test('invalid reversed utterance intervals fail before either AI stage is called', async () => {
  const r = recorder();
  await assert.rejects(runSellerLogicPipeline(input([], [speech('invalid', 2, '원문', { startedAt: at(2), endedAt: at(1) })]), r.calls), /시각/);
  assert.equal(r.detections.length, 0);
});

test('a no-op heartbeat preserves the provider and model shown by the last completed analysis', async () => {
  const archive = input([], [speech('offer', 0)]);
  const r = recorder();
  const first = await runSellerLogicPipeline(archive, r.calls, live(1));
  const quiet = await runSellerLogicPipeline(resume(archive, first), r.calls, live(2));
  assert.equal(r.detections.length, 1);
  assert.equal(quiet.provider, first.provider);
  assert.equal(quiet.model, first.model);
});

function denseLinkArchive() {
  const comments = Array.from({ length: 120 }, (_, index) => comment(`dense-c${index}`, index, `${index}: ${'댓글 원문 '.repeat(85)}`));
  const transcripts = Array.from({ length: 120 }, (_, index) => speech(`dense-s${index}`, index + 0.25, `${index}: ${'판매 원문 '.repeat(85)}`));
  const seenRevisions = Object.fromEntries([
    ...comments.map((row) => [`C:${row.id}`, JSON.stringify([row.content, row.nickname, row.capturedAt])]),
    ...transcripts.map((row) => [`S:${row.id}`, JSON.stringify([row.text, row.recognizedAt, row.startedAt, row.endedAt,
      row.isFinal, row.utteranceId, row.utteranceEnded, row.revision, row.endReason])]),
  ]);
  // A newly arrived utterance in the middle of an already observed two-minute
  // interval triggers a full local linking window, without replaying detection.
  transcripts.push(speech('dense-trigger', 60, '루비 언니 이만원 드릴게요'));
  return input(comments, transcripts, { pipeline: { slotNumber: 2, seenRevisions, carry: [], signals: [],
    observedThrough: epoch + 119250, stats: { detectCalls: 0, linkCalls: 0, detectMs: 0, linkMs: 0 } } });
}

function densePageReply(packet) {
  const finalPage = !packet.linkWindow.hasMore;
  const sale = transaction('dense-sale', ['dense-c0'], ['dense-trigger', ...(finalPage ? ['dense-s119'] : [])],
    { status: finalPage ? 'CONFIRMED' : 'PENDING', unitPrice: finalPage ? 20000 : null });
  return matched(packet, sale);
}

test('a dense two-minute linking window reads every original row in bounded pages and publishes its sale only after the final page', async () => {
  const archive = denseLinkArchive(), original = JSON.stringify(archive), progress = [], fresh = [];
  assert.ok(original.length > 32000);
  const r = recorder((packet) => {
    assert.deepEqual(packet.freshTranscriptIds, ['dense-trigger']);
    return detection([candidate('dense-signal', [], ['dense-trigger'])]);
  }, async (packet) => {
    assert.equal(progress.length, 1, 'page results do not replace the externally saved detection checkpoint');
    assert.equal(progress[0].decisions.length, 0, 'the intermediate PENDING decision remains private to the linking window');
    assert.equal(progress[0].pipeline.signals[0].needsAnalysis, true);
    assert.ok(JSON.stringify(packet).length <= 32000);
    assert.equal(packet.linkWindow.totalEvents, 241);
    assert.ok(packet.transcripts.some((row) => row.id === 'dense-trigger'), 'every page retains the triggering utterance');
    const rows = [...packet.comments, ...packet.transcripts];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const pageFresh = [...packet.incremental.newCommentIds, ...packet.incremental.newTranscriptIds];
    assert.ok(pageFresh.length <= 30);
    assert.ok(pageFresh.reduce((sum, id) => sum + JSON.stringify(byId.get(id)).length, 0) <= 10000);
    fresh.push(...pageFresh);
    for (const row of packet.comments) assert.deepEqual(row, archive.comments.find((original) => original.id === row.id));
    for (const row of packet.transcripts) assert.deepEqual(row, archive.transcripts.find((original) => original.id === row.id));
    await Promise.resolve();
    return densePageReply(packet);
  });
  const result = await runSellerLogicPipeline(archive, r.calls, { ...live(121), onProgress: (partial) => progress.push(partial) });
  assert.equal(r.detections.length, 1);
  assert.ok(r.links.length > 1);
  assert.equal(fresh.length, 241);
  assert.equal(new Set(fresh).size, 241);
  assert.deepEqual(new Set(fresh), new Set([...archive.comments, ...archive.transcripts].map((row) => row.id)));
  assert.equal(progress.length, 2, 'one detection checkpoint and one final linking result are published');
  assert.equal(progress.filter((partial) => partial.decisions.length).length, 1);
  assert.equal(progress[1].decisions[0].status, 'CONFIRMED');
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].id, 'dense-sale');
  assert.equal(result.pipeline.signals[0].needsAnalysis, false);
  assert.equal(result.pipeline.signals[0].status, 'LINKED');
  assert.equal(result.pipeline.stats.linkCalls, r.links.length);
  assert.equal(result.hasMore, false);
  assert.equal(JSON.stringify(archive), original);
});

test('a failed middle page leaves the dense linking window pending and resumes from the saved detection checkpoint', async () => {
  const archive = denseLinkArchive(), before = JSON.stringify(archive), published = [];
  const first = recorder(() => detection([candidate('dense-signal', [], ['dense-trigger'])]), (packet, index) => {
    if (index === 2) throw new Error('dense middle page failed');
    return densePageReply(packet);
  });
  await assert.rejects(runSellerLogicPipeline(archive, first.calls, { ...live(121), onProgress: (partial) => published.push(partial) }), /dense middle page failed/);
  assert.equal(first.links.length, 2);
  assert.equal(published.length, 1);
  const checkpoint = published[0];
  assert.equal(checkpoint.decisions.length, 0, 'a successful first page is not published as a completed sale');
  assert.equal(checkpoint.pipeline.signals[0].needsAnalysis, true);
  assert.equal(checkpoint.pipeline.signals[0].status, 'WATCHING');
  assert.equal(checkpoint.hasMore, true);
  assert.equal(checkpoint.analysisState.processedTranscriptIds.length, archive.transcripts.length, 'stage-one progress remains resumable');
  assert.equal(JSON.stringify(archive), before);

  const completed = [], seen = [];
  const next = recorder(() => { throw new Error('stage one must not repeat'); }, (packet) => {
    assert.equal(completed.length, 0, 'no page is externally complete before the last response');
    seen.push(...packet.incremental.newCommentIds, ...packet.incremental.newTranscriptIds);
    return densePageReply(packet);
  });
  const result = await runSellerLogicPipeline(resume(archive, checkpoint), next.calls,
    { ...live(122), onProgress: (partial) => completed.push(partial) });
  assert.equal(next.detections.length, 0);
  assert.ok(next.links.length > 1);
  assert.deepEqual(next.links[0].incremental.newCommentIds, first.links[0].incremental.newCommentIds);
  assert.deepEqual(next.links[0].incremental.newTranscriptIds, first.links[0].incremental.newTranscriptIds);
  assert.equal(seen.length, 241);
  assert.equal(new Set(seen).size, 241);
  assert.equal(completed.length, 1);
  assert.equal(result.decisions[0].status, 'CONFIRMED');
  assert.equal(result.pipeline.signals[0].needsAnalysis, false);
  assert.equal(result.hasMore, false);
  assert.equal(checkpoint.pipeline.signals[0].needsAnalysis, true, 'resume never mutates the caller checkpoint');
});
