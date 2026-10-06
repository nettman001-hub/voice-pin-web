import test from 'node:test';
import assert from 'node:assert/strict';
import { runSellerLogicDeep } from '../src/services/sellerLogicDeepEngine.ts';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const at = (seconds) => new Date(epoch + seconds * 1000).toISOString();
const comment = (id, seconds, content) => ({ id, sessionId: 'deep-engine', nickname: '루비', content, capturedAt: at(seconds) });
const speech = (id, seconds, text, extra = {}) => ({ id, text, recognizedAt: at(seconds), isFinal: true, ...extra });
const decision = (id, nickname, unitPrice, commentIds, transcriptIds, decidedAt) => ({
  id, status: 'CONFIRMED', nickname, unitPrice, quantity: 1, reason: '판매자 확정 발화와 구매 댓글을 연결했습니다.',
  commentIds, transcriptIds, decidedAt,
});
const archive = (transcripts) => ({
  sessionId: 'deep-engine', slotNumber: 1,
  comments: [comment('c1', 0, '저요'), comment('c2', 70, 'ㅈㅇ')],
  transcripts,
});

const decisionA = decision('sld:a', '루비', 15000, ['c1'], ['s1'], at(2));
const decisionB = decision('sld:b', '루비', 20000, ['c2'], ['s2'], at(75));

function recorder() {
  const calls = [];
  return { calls, call: async (packet) => {
    calls.push(packet);
    if (packet.segment.index === 0) {
      return { decisions: [decisionA], signals: [], context: [
        { text: '맨투맨 1.5 안내', commentIds: [], transcriptIds: ['s1'] },
        { text: '근거 없는 후속 후보', commentIds: [], transcriptIds: [] },
      ], summary: '1구간 심층 판단', provider: 'EXISTING', model: 'deep-model', appliedVersion: 9 };
    }
    return { decisions: [decisionB], signals: [], context: [], summary: '2구간 심층 판단', provider: 'EXISTING', model: 'deep-model', appliedVersion: 9 };
  } };
}

test('each changed time bucket is one deep call and later bucket receives prior decisions and carry', async () => {
  const input = archive([speech('s1', 2, '루비 언니 1.5에 드릴게요'), speech('s2', 75, '루비 언니 2만 원에 드릴게요')]);
  const { calls, call } = recorder();
  const first = await runSellerLogicDeep(input, call, { now: epoch + 600_000 });
  assert.equal(calls.length, 2, 'one deep call per time bucket');
  assert.equal(calls[0].segment.index, 0);
  assert.equal(calls[1].segment.index, 1);
  assert.deepEqual(calls[1].previousDecisions.map((row) => row.id), ['sld:a']);
  assert.ok(calls[1].transcripts.some((row) => row.id === 's1'), 'carry evidence reaches the next bucket');
  assert.equal(calls[1].context.length, 1, 'evidence-less carry never reaches the AI');
  assert.equal(first.unreviewedContext.length, 1, 'evidence-less carry stays on screen for review');
  assert.equal(first.unreviewedContext[0].sourcesMissing, true);
  assert.deepEqual(first.decisions.map((row) => row.id), ['sld:a', 'sld:b']);
  assert.equal(first.stats.segmentCalls, 2);
  assert.equal(Object.keys(first.state.processedSegments).length, 2);
  assert.equal(first.provider, 'EXISTING');
});

test('re-running the same archive with the saved state makes no paid call', async () => {
  const input = archive([speech('s1', 2, '루비 언니 1.5에 드릴게요'), speech('s2', 75, '루비 언니 2만 원에 드릴게요')]);
  const { call } = recorder();
  const first = await runSellerLogicDeep(input, call, { now: epoch + 600_000 });
  const quiet = recorder();
  const second = await runSellerLogicDeep({ ...input, state: first.state }, quiet.call, { now: epoch + 600_000 });
  assert.equal(quiet.calls.length, 0);
  assert.deepEqual(second.decisions.map((row) => row.id), ['sld:a', 'sld:b']);
  assert.equal(second.unreviewedContext.length, 1, 'manual-review carry survives quiet runs');
});

test('a revised transcript re-opens only its own bucket', async () => {
  const input = archive([speech('s1', 2, '루비 언니 1.5에 드릴게요'), speech('s2', 75, '루비 언니 2만 원에 드릴게요')]);
  const first = await runSellerLogicDeep(input, recorder().call, { now: epoch + 600_000 });
  const revised = archive([speech('s1', 2, '루비 언니 1.5에 드릴게요', { revision: 2 }), speech('s2', 75, '루비 언니 2만 원에 드릴게요')]);
  const again = recorder();
  const second = await runSellerLogicDeep({ ...revised, state: first.state }, again.call, { now: epoch + 600_000 });
  assert.equal(again.calls.length, 1, 'only the bucket whose evidence changed is re-analyzed');
  assert.equal(again.calls[0].segment.index, 0);
  assert.equal(second.stats.segmentCalls, 3);
});
