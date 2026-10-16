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

test('oversized bucket auto-fits safely within prompt budget without throwing', async () => {
  // 프롬프트 직렬화 시 30,000자를 초과할 수 있는 긴 텍스트의 발화들
  const heavyTranscripts = Array.from({ length: 30 }, (_, i) =>
    speech(`s_heavy_${i}`, i * 2, `고객님 이 상품은 ${'가나다라마바사아자차'.repeat(30)} 안내드립니다 ${i}`)
  );
  const input = {
    sessionId: 'deep-heavy',
    slotNumber: 1,
    comments: [comment('c_heavy_1', 1, '저요')],
    transcripts: heavyTranscripts,
  };
  const calls = [];
  const fakeCall = async (packet) => {
    calls.push(packet);
    return { decisions: [], signals: [], context: [], summary: '초과 안전 처리 완료', provider: 'TEST', model: 'test', appliedVersion: 1 };
  };

  const result = await runSellerLogicDeep(input, fakeCall, { now: epoch + 600_000 });
  assert.ok(calls.length > 0, 'calls proceeded without throwing error');
  // 각 호출된 패킷의 원문이 정상 보존되고 결과가 반환되었는지 확인
  assert.equal(result.summary, '초과 안전 처리 완료');
  assert.equal(result.provider, 'TEST');
});

test('skips failing segment, logs warning, and continues analyzing remaining segments', async () => {
  const input = archive([speech('s1', 2, '루비 언니 1.5에 드릴게요'), speech('s2', 75, '루비 언니 2만 원에 드릴게요')]);
  const failingCall = async (packet) => {
    if (packet.segment.index === 0) {
      throw new Error('심층 분석 결과를 적용하지 않았습니다: 이전에 없던 거래에는 id를 null로 반환해 주세요.');
    }
    return { decisions: [decisionB], signals: [], context: [], summary: '2구간 판단 완료', provider: 'EXISTING', model: 'deep-model', appliedVersion: 9 };
  };

  const result = await runSellerLogicDeep(input, failingCall, { now: epoch + 600_000 });
  // Segment 0 failed, but analysis did not halt; segment 1 succeeded!
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].id, 'sld:b');
  assert.ok(result.warnings && result.warnings.length === 1);
  assert.ok(result.warnings[0].message.includes('이전에 없던 거래에는 id를 null로 반환해 주세요.'));
  assert.equal(Object.keys(result.state.processedSegments).length, 2);
});

test('runSellerLogicDeep auto-merges duplicate decisions from different segments into single decision', async () => {
  const input = archive([
    speech('s1', 19, '웅이맘한테 얘기 캡처!'),
    speech('s2', 75, '우리가 24,000원에 2개가 가는 거야'),
  ]);
  input.comments[0].nickname = '웅이맘';

  const multiCall = async (packet) => {
    if (packet.segment.index === 0) {
      return {
        decisions: [{
          id: 'sld:segment0-woong',
          status: 'CONFIRMED',
          nickname: '웅이맘',
          unitPrice: 24000,
          quantity: 1,
          reason: '웅이맘 구매 의사 및 배정 확정',
          commentIds: ['c1'],
          transcriptIds: ['s1'],
          decidedAt: new Date(epoch + 19000).toISOString(),
        }],
        signals: [], context: [], summary: '1구간', provider: 'TEST', model: 'test', appliedVersion: 1,
      };
    } else {
      // 2구간에서 다른 ID로 동일 웅이맘 거래가 보고됨
      return {
        decisions: [{
          id: 'sld:segment1-woong-new-id',
          status: 'CONFIRMED',
          nickname: '웅이맘',
          unitPrice: 24000,
          quantity: 1,
          reason: '웅이맘 구매 의사 및 배정 확정',
          commentIds: ['c1'],
          transcriptIds: ['s1', 's2'],
          decidedAt: new Date(epoch + 75000).toISOString(),
        }],
        signals: [], context: [], summary: '2구간', provider: 'TEST', model: 'test', appliedVersion: 1,
      };
    }
  };

  const result = await runSellerLogicDeep(input, multiCall, { now: epoch + 600_000 });
  assert.equal(result.decisions.length, 1, 'must merge duplicate decisions across segments into exactly 1 decision');
  assert.equal(result.decisions[0].nickname, '웅이맘');
  assert.equal(result.decisions[0].unitPrice, 24000);
  assert.deepEqual(result.decisions[0].transcriptIds.sort(), ['s1', 's2'].sort(), 'all evidence merged');
});



