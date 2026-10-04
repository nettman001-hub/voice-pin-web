import test from 'node:test';
import assert from 'node:assert/strict';
import { runSellerLogicPipeline } from '../src/services/sellerLogicPipeline.ts';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const at = (second) => new Date(epoch + second * 1000).toISOString();
const options = (second) => ({ live: true, now: epoch + second * 1000 });
const comment = (id, second, content = '구매자 원문') => ({ id, sessionId: 'followup-test', nickname: '루비👻', content, capturedAt: at(second) });
const speech = (id, start, end, text = '판매 발화') => ({ id, text, recognizedAt: at(start), startedAt: at(start), endedAt: at(end),
  utteranceId: id, isFinal: true, utteranceEnded: true, revision: end, endReason: 'endpoint' });
const original = () => ({ sessionId: 'followup-test', slotNumber: 2,
  comments: [comment('buyer', 0, '저요')], transcripts: [speech('offer', 1, 2)] });
const detected = (signals = []) => ({ signals, carry: [], summary: 'AI 탐지', provider: 'MOCK', model: 'test', appliedVersion: 7 });
const signal = (transcriptIds = ['offer']) => ({ id: 'signal-main', summary: '구매와 후속 발화', commentIds: ['buyer'], transcriptIds });
const resume = (archive, result) => ({ ...archive, previousDecisions: result.decisions, analysisState: result.analysisState, pipeline: result.pipeline });

function linking(packet, status = 'PENDING') {
  const previous = new Map((packet.previousDecisions || []).map((row) => [row.id, row]));
  const signalLinks = packet.linkSignals.map((item) => {
    const id = `sale:${item.id}`;
    previous.set(id, { id, status, nickname: '루비👻', unitPrice: status === 'CONFIRMED' ? 20000 : null, quantity: 1,
      productName: '니트', reason: 'AI의 판매 판단', commentIds: item.commentIds, transcriptIds: item.transcriptIds, decidedAt: at(2) });
    return { signalId: item.id, outcome: 'MATCHED', decisionIds: [id] };
  });
  return { decisions: [...previous.values()], signalLinks, purchaseIntentCommentIds: ['buyer'],
    provider: 'MOCK', model: 'test', summary: 'AI 연결', hasMore: false,
    analysisState: { processedCommentIds: packet.comments.map((row) => row.id), processedTranscriptIds: packet.transcripts.map((row) => row.id),
      memory: [], purchaseIntentCommentIds: ['buyer'], slotNumber: 2, appliedVersion: 7 } };
}
function recorder(detect, status = 'PENDING') {
  const detectionInputs = [], linkInputs = [];
  return { detectionInputs, linkInputs, calls: {
    async detect(packet) { detectionInputs.push(packet); return detect(packet); },
    async link(packet) { linkInputs.push(packet); return linking(packet, status); },
  } };
}

test('continuing the same utterance extends its deadline from the new end and keeps the past boundary', async () => {
  const archive = original();
  archive.comments.unshift(comment('old-context', -58));
  const r = recorder((packet) => detected(packet.freshTranscriptIds.includes('offer') ? [signal()] : []));
  const first = await runSellerLogicPipeline(archive, r.calls, options(3));
  const old = structuredClone(first.pipeline);
  const revised = { ...archive, transcripts: [speech('offer', 1, 20, '판매 발화가 이어져 이제 끝남')] };
  const second = await runSellerLogicPipeline(resume(revised, first), r.calls, options(21));
  const updated = second.pipeline.signals[0];
  assert.equal(updated.id, first.pipeline.signals[0].id);
  assert.equal(updated.startedAt, at(1));
  assert.equal(updated.endedAt, at(20));
  assert.equal(updated.observedUntil, at(80));
  assert.equal(updated.observationClosed, false);
  assert.ok(r.linkInputs.at(-1).comments.some((row) => row.id === 'old-context'), 'the original preceding minute must stay available');
  assert.deepEqual(first.pipeline, old, 'saved checkpoints remain immutable');
  assert.equal(second.decisions.length, 1);
  assert.equal(second.decisions[0].id, first.decisions[0].id);
});

test('a continuation longer than the original deadline still retains the same utterance start', async () => {
  const archive = original();
  const r = recorder(() => detected([signal()]));
  const first = await runSellerLogicPipeline(archive, r.calls, options(3));
  const revised = { ...archive, transcripts: [speech('offer', 1, 80, '같은 발화의 긴 연속 원문')] };
  const result = await runSellerLogicPipeline(resume(revised, first), r.calls, options(81));
  assert.equal(result.pipeline.signals[0].startedAt, at(1));
  assert.equal(result.pipeline.signals[0].endedAt, at(80));
  assert.equal(result.pipeline.signals[0].observedUntil, at(140));
});

test('new evidence between the old and extended deadlines is linked once at the actual closing time', async () => {
  const archive = original();
  const r = recorder((packet) => detected(packet.freshTranscriptIds.includes('offer') ? [signal()] : []));
  const first = await runSellerLogicPipeline(archive, r.calls, options(3));
  const revised = { ...archive, transcripts: [speech('offer', 1, 20)] };
  const second = await runSellerLogicPipeline(resume(revised, first), r.calls, options(21));
  const stillOpen = await runSellerLogicPipeline(resume(revised, second), r.calls, options(63));
  assert.equal(stillOpen.pipeline.signals[0].observationClosed, false);
  const withLaterComment = { ...revised, comments: [...revised.comments, comment('late-followup', 75)] };
  const changed = await runSellerLogicPipeline(resume(withLaterComment, stillOpen), r.calls, options(76));
  assert.equal(r.linkInputs.length, 2, 'an undetected follow-up waits for the corrected deadline');
  const closed = await runSellerLogicPipeline(resume(withLaterComment, changed), r.calls, options(80));
  assert.equal(r.linkInputs.length, 3);
  assert.ok(r.linkInputs.at(-1).comments.some((row) => row.id === 'late-followup'));
  assert.equal(closed.pipeline.signals[0].observationClosed, true);
  await runSellerLogicPipeline(resume(withLaterComment, closed), r.calls, options(90));
  assert.equal(r.linkInputs.length, 3);
});

for (const status of ['PENDING', 'REVIEW']) {
  test(`an old ${status} transaction remains eligible for detection and a late confirmation retains its ID`, async () => {
    const archive = original();
    const first = recorder(() => detected([signal()]), status);
    const partial = await runSellerLogicPipeline(archive, first.calls, options(3));
    const later = { ...archive, transcripts: [...archive.transcripts, speech('late-confirmation', 180, 182, '루비 언니 이제 드릴게요')] };
    const next = recorder((packet) => {
      assert.equal(packet.existingSignals.length, 1);
      assert.equal(packet.existingSignals[0].id, 'signal-main');
      assert.ok(packet.transcripts.some((row) => row.id === 'offer'), 'the old source must accompany the pending signal');
      return detected([signal(['offer', 'late-confirmation'])]);
    }, 'CONFIRMED');
    const result = await runSellerLogicPipeline(resume(later, partial), next.calls, options(183));
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].id, 'sale:signal-main');
    assert.equal(result.decisions[0].status, 'CONFIRMED');
    assert.equal(result.pipeline.signals.length, 1);
    assert.equal(result.pipeline.signals[0].id, 'signal-main');
    assert.equal(result.pipeline.signals[0].startedAt, at(180));
    assert.equal(result.pipeline.signals[0].observedUntil, at(242));
    assert.deepEqual(next.linkInputs[0].previousDecisions.map((row) => row.id), ['sale:signal-main']);
  });
}

test('a separate follow-up beyond the old window moves the past boundary but keeps explicitly cited earlier evidence', async () => {
  const archive = original();
  const first = recorder(() => detected([signal()]));
  const partial = await runSellerLogicPipeline(archive, first.calls, options(3));
  const later = { ...archive,
    comments: [...archive.comments, comment('between-windows', 80), comment('near-followup', 130)],
    transcripts: [...archive.transcripts, speech('late-confirmation', 180, 182)] };
  const next = recorder((packet) => detected(packet.freshTranscriptIds.includes('late-confirmation') ? [signal(['offer', 'late-confirmation'])] : []));
  const result = await runSellerLogicPipeline(resume(later, partial), next.calls, options(183));
  const packet = next.linkInputs.at(-1);
  assert.equal(result.pipeline.signals[0].startedAt, at(180));
  assert.ok(packet.comments.some((row) => row.id === 'near-followup'));
  assert.ok(!packet.comments.some((row) => row.id === 'between-windows'), 'the gap must not become an ever-growing complete broadcast window');
  assert.ok(packet.transcripts.some((row) => row.id === 'offer'));
  assert.ok(packet.comments.some((row) => row.id === 'buyer'));
});

test('old confirmed transactions are not all reattached to every future detection request', async () => {
  const archive = original();
  const first = recorder(() => detected([signal()]), 'CONFIRMED');
  const completed = await runSellerLogicPipeline(archive, first.calls, options(3));
  const later = { ...archive, transcripts: [...archive.transcripts, speech('unrelated', 180, 182)] };
  const next = recorder((packet) => { assert.deepEqual(packet.existingSignals, []); return detected(); });
  const result = await runSellerLogicPipeline(resume(later, completed), next.calls, options(183));
  assert.equal(result.decisions.length, 1, 'unselected historical transactions remain in local storage');
});

test('a buyer-only late follow-up opens a window around the new comment while preserving the old spoken proof', async () => {
  const archive = original();
  const first = recorder(() => detected([signal()]));
  const partial = await runSellerLogicPipeline(archive, first.calls, options(3));
  const later = { ...archive, comments: [...archive.comments, comment('near-buyer', 130), comment('late-buy', 180, '네 그 상품 주세요')] };
  const next = recorder((packet) => detected(packet.freshCommentIds.includes('late-buy')
    ? [{ ...signal(), commentIds: ['buyer', 'late-buy'] }] : []));
  const result = await runSellerLogicPipeline(resume(later, partial), next.calls, options(181));
  assert.equal(result.pipeline.signals[0].startedAt, at(180));
  assert.equal(result.pipeline.signals[0].endedAt, at(180));
  assert.equal(result.pipeline.signals[0].observedUntil, at(240));
  assert.ok(next.linkInputs.at(-1).comments.some((row) => row.id === 'near-buyer'));
  assert.ok(next.linkInputs.at(-1).transcripts.some((row) => row.id === 'offer'));
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].id, 'sale:signal-main');
});

test('different source rows sharing a long utterance ID move the active window instead of expanding it indefinitely', async () => {
  const archive = original();
  archive.transcripts[0].utteranceId = 'long-utterance';
  const first = recorder(() => detected([signal()]));
  let result = await runSellerLogicPipeline(archive, first.calls, options(3));
  let current = archive;
  for (const seconds of [30, 60, 90, 120, 150]) {
    const id = `fragment-${seconds}`;
    current = { ...current,
      comments: [...current.comments, comment(`context-${seconds}`, seconds - 1)],
      transcripts: [...current.transcripts, { ...speech(id, seconds, seconds + 2), utteranceId: 'long-utterance' }] };
    const next = recorder((packet) => detected(packet.freshTranscriptIds.includes(id) ? [signal(['offer', id])] : []));
    result = await runSellerLogicPipeline(resume(current, result), next.calls, options(seconds + 3));
    assert.equal(result.pipeline.signals[0].startedAt, at(seconds));
    assert.equal(result.pipeline.signals[0].observedUntil, at(seconds + 62));
    const expectedNear = current.comments.filter((row) => Date.parse(row.capturedAt) >= epoch + (seconds - 60) * 1000 || row.id === 'buyer').map((row) => row.id);
    assert.deepEqual(next.linkInputs.at(-1).comments.map((row) => row.id), expectedNear,
      'only the current minute and explicit previous proof should be sent, not every comment since the utterance began');
  }
  assert.equal(result.pipeline.signals[0].id, 'signal-main');
  assert.equal(result.decisions.length, 1);
});

test('a new signal citing old carry starts from its fresh source rather than the beginning of the carry history', async () => {
  const archive = original();
  const first = recorder(() => ({ ...detected(), carry: [{ reason: '후속 발화 대기', commentIds: ['buyer'], transcriptIds: ['offer'] }] }));
  const partial = await runSellerLogicPipeline(archive, first.calls, options(3));
  const later = { ...archive, comments: [...archive.comments, comment('unrelated-middle', 80)],
    transcripts: [...archive.transcripts, speech('new-offer', 180, 182)] };
  const next = recorder((packet) => packet.freshTranscriptIds.includes('new-offer')
    ? detected([signal(['offer', 'new-offer'])])
    : { ...detected(), carry: packet.carry });
  const result = await runSellerLogicPipeline(resume(later, partial), next.calls, options(183));
  assert.equal(result.pipeline.signals[0].startedAt, at(180));
  assert.equal(result.pipeline.signals[0].observedUntil, at(242));
  assert.ok(next.linkInputs[0].transcripts.some((row) => row.id === 'offer'));
  assert.ok(!next.linkInputs[0].comments.some((row) => row.id === 'unrelated-middle'));
});

test('retaining old unresolved transactions still respects twenty-signal and 32000-character request bounds', async () => {
  const archive = original();
  const first = recorder(() => detected([signal()]));
  const initial = await runSellerLogicPipeline(archive, first.calls, options(3));
  const expanded = structuredClone(initial);
  expanded.pipeline.signals = Array.from({ length: 35 }, (_, index) => ({ ...initial.pipeline.signals[0],
    id: `signal-${index}`, summary: '기존 미해결 설명 '.repeat(150), decisionIds: [`sale-${index}`] }));
  expanded.decisions = Array.from({ length: 35 }, (_, index) => ({ ...initial.decisions[0], id: `sale-${index}` }));
  const later = { ...archive, transcripts: [...archive.transcripts, speech('new-source', 180, 182)] };
  const next = recorder((packet) => {
    assert.ok(packet.existingSignals.length > 0);
    assert.ok(packet.existingSignals.length <= 20);
    assert.ok(JSON.stringify(packet).length <= 32_000);
    assert.deepEqual(packet.freshTranscriptIds, ['new-source']);
    return detected();
  });
  const result = await runSellerLogicPipeline(resume(later, expanded), next.calls, options(183));
  assert.equal(result.pipeline.signals.length, 35);
  assert.equal(result.decisions.length, 35, 'the unsent unresolved transactions remain local');
});

for (const existing of [false, true]) {
  test(`${existing ? 'an existing' : 'a new'} carry-only signal anchors on its latest cited row and excludes unrelated intervening comments`, async () => {
    const archive = original();
    const first = recorder(() => existing ? detected([signal()]) : { ...detected(),
      carry: [{ reason: '이어질 발화를 기다림', commentIds: ['buyer'], transcriptIds: ['offer'] }] });
    const initial = await runSellerLogicPipeline(archive, first.calls, options(3));
    const historical = { ...archive,
      comments: [...archive.comments, comment('middle-40', 40), comment('middle-80', 80), comment('middle-100', 100),
        comment('near-latest', 130), comment('outside-latest', 270)],
      transcripts: [...archive.transcripts, speech('carry-old', 20, 22),
        speech('carry-latest-a', 180, 182), speech('carry-latest-b', 180, 184)] };
    const carryIds = new Set([...(existing ? [] : ['offer']), 'carry-old', 'carry-latest-a', 'carry-latest-b']);
    const warmup = recorder((packet) => ({ ...detected(), carry: [{ reason: '지난 조각들을 이어 읽어야 함', commentIds: ['buyer'],
      transcriptIds: packet.transcripts.filter((row) => carryIds.has(row.id)).map((row) => row.id) }] }));
    const carried = await runSellerLogicPipeline(resume(historical, initial), warmup.calls, options(271));
    const withUnrelatedFresh = { ...historical, comments: [...historical.comments, comment('unrelated-fresh', 300)] };
    const next = recorder((packet) => {
      assert.deepEqual(packet.freshCommentIds, ['unrelated-fresh']);
      assert.deepEqual(packet.freshTranscriptIds, []);
      assert.ok(packet.carry.some((item) => item.transcriptIds.includes('carry-old') && item.transcriptIds.includes('carry-latest-b')));
      // The AI resolves previously carried sources. It does not cite the new
      // unrelated comment, so none of this signal's grounds are fresh.
      return detected([signal(['offer', 'carry-old', 'carry-latest-a', 'carry-latest-b'])]);
    });
    const result = await runSellerLogicPipeline(resume(withUnrelatedFresh, carried), next.calls, options(301));
    assert.equal(result.pipeline.signals.length, 1);
    assert.equal(result.pipeline.signals[0].id, 'signal-main');
    assert.equal(result.pipeline.signals[0].startedAt, at(180));
    assert.equal(result.pipeline.signals[0].endedAt, at(184), 'all latest rows sharing the same start time remain eligible anchors');
    assert.equal(result.pipeline.signals[0].observedUntil, at(244));
    assert.equal(next.linkInputs.length, 1);
    const packet = next.linkInputs[0];
    assert.deepEqual(packet.comments.map((row) => row.id), ['buyer', 'near-latest']);
    assert.deepEqual(packet.transcripts.map((row) => row.id), ['offer', 'carry-old', 'carry-latest-a', 'carry-latest-b'],
      'old specifically cited speech is preserved without pulling in every intervening comment');
    assert.ok(JSON.stringify(packet).length <= 32_000);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].id, 'sale:signal-main');
  });
}
