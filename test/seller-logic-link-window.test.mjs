import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSellerLogicLinkWindow } from '../src/services/sellerLogicLinkWindow.ts';

function source(count = 120, characters = 500) {
  const input = { sessionId: 'link-window', slotNumber: 1, comments: [], transcripts: [],
    previousDecisions: [],
    analysisState: { processedCommentIds: [], processedTranscriptIds: [], memory: [], purchaseIntentCommentIds: [], slotNumber: 1, appliedVersion: 33 },
  };
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(2026, 9, 5, 10, 0, i)).toISOString();
    if (i % 2 === 0) input.comments.push({ id: `c${i}`, sessionId: input.sessionId, nickname: `고객${i}`, content: `${i}:` + '가'.repeat(characters), capturedAt: at });
    else input.transcripts.push({ id: `s${i}`, text: `${i}:` + '나'.repeat(characters), recognizedAt: at, isFinal: true });
  }
  input.linkSignals = [{ id: 'signal-1', summary: '판매자 후보 발화', commentIds: [], transcriptIds: [input.transcripts.at(-1).id] }];
  return input;
}

function decision(id = 'sale-1', c = 'c0', s = 's1') {
  return { id, status: 'PENDING', nickname: '고객0', unitPrice: null, quantity: 1, reason: 'AI 테스트 판단',
    commentIds: [c], transcriptIds: [s], decidedAt: '2026-10-05T10:00:01Z' };
}

function answer(packet, extra = {}) {
  const decisions = packet.previousDecisions || [];
  return { decisions, purchaseIntentCommentIds: packet.analysisState.purchaseIntentCommentIds,
    summary: '해당 페이지 분석', provider: 'TEST', model: 'TEST', hasMore: false,
    analysisState: { ...packet.analysisState, processedCommentIds: packet.comments.map((row) => row.id),
      processedTranscriptIds: packet.transcripts.map((row) => row.id) },
    signalLinks: (packet.linkSignals || []).map((signal) => ({ signalId: signal.id,
      outcome: decisions.length ? 'MATCHED' : 'UNMATCHED', decisionIds: decisions.map((row) => row.id) })),
    ...extra };
}

const clone = (value) => structuredClone(value);
const freeze = (value) => {
  Object.freeze(value);
  Object.values(value).forEach((child) => { if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child); });
  return value;
};

test('a 120-second window above 32k is covered completely in serial bounded pages with all anchors and state references', async () => {
  const input = source();
  input.previousDecisions = [decision()];
  input.analysisState.memory = [{ text: '이전 가격 근거', commentIds: ['c4'], transcriptIds: ['s5'] }];
  input.analysisState.purchaseIntentCommentIds = ['c0'];
  freeze(input);
  const original = JSON.stringify(input), calls = [], fresh = [];
  let active = 0, maximum = 0;
  const result = await analyzeSellerLogicLinkWindow(input, async (packet) => {
    active++; maximum = Math.max(maximum, active);
    calls.push(clone(packet));
    await Promise.resolve();
    assert.ok(JSON.stringify(packet).length <= 32000);
    assert.equal(packet.linkWindow.page, calls.length);
    assert.equal(packet.linkWindow.totalEvents, 120);
    assert.deepEqual(packet.linkSignals, input.linkSignals);
    const c = new Map(packet.comments.map((row) => [row.id, row])), s = new Map(packet.transcripts.map((row) => [row.id, row]));
    for (const item of [...packet.linkSignals, ...packet.previousDecisions, ...packet.analysisState.memory]) {
      item.commentIds.forEach((id) => assert.ok(c.has(id), id));
      item.transcriptIds.forEach((id) => assert.ok(s.has(id), id));
    }
    const newRows = [...packet.incremental.newCommentIds.map((id) => c.get(id)), ...packet.incremental.newTranscriptIds.map((id) => s.get(id))];
    assert.ok(newRows.length <= 30);
    assert.ok(newRows.reduce((n, row) => n + JSON.stringify(row).length, 0) <= 10000);
    fresh.push(...newRows.map((row) => row.id));
    assert.equal(packet.linkWindow.analyzedEvents, fresh.length);
    assert.equal(packet.linkWindow.hasMore, fresh.length < 120);
    assert.ok(packet.analysisState.processedCommentIds.every((id) => !packet.incremental.newCommentIds.includes(id)));
    assert.ok(packet.analysisState.processedTranscriptIds.every((id) => !packet.incremental.newTranscriptIds.includes(id)));
    for (const row of packet.comments) assert.deepEqual(row, input.comments.find((original) => original.id === row.id));
    for (const row of packet.transcripts) assert.deepEqual(row, input.transcripts.find((original) => original.id === row.id));
    active--;
    return answer(packet);
  });
  assert.ok(calls.length > 1);
  assert.equal(maximum, 1);
  assert.equal(fresh.length, 120);
  assert.equal(new Set(fresh).size, 120);
  assert.equal(result.analysisState.processedCommentIds.length, 60);
  assert.equal(result.analysisState.processedTranscriptIds.length, 60);
  assert.deepEqual(result.decisions, input.previousDecisions);
  assert.deepEqual(result.purchaseIntentCommentIds, ['c0']);
  assert.equal(result.hasMore, false);
  assert.equal(JSON.stringify(input), original, 'all original source and prior state remain unchanged');
});

test('a complete window under 32k uses one call even when it has more than thirty rows', async () => {
  const input = source(40, 20), calls = [];
  const result = await analyzeSellerLogicLinkWindow(input, async (packet) => { calls.push(packet); return answer(packet); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].comments.length + calls[0].transcripts.length, 40);
  assert.equal(calls[0].linkWindow.hasMore, false);
  assert.equal(result.analysisState.processedCommentIds.length + result.analysisState.processedTranscriptIds.length, 40);
});

test('fresh pages shrink to fit mandatory state without dropping its cited rows', async () => {
  const input = source(120, 300);
  input.previousDecisions = Array.from({ length: 7 }, (_, index) => ({ ...decision(`sale-${index}`), reason: '가'.repeat(3600) }));
  const calls = [];
  await analyzeSellerLogicLinkWindow(input, async (packet) => {
    calls.push(packet);
    assert.ok(JSON.stringify(packet).length <= 32000);
    assert.equal(packet.previousDecisions[0].reason, input.previousDecisions[0].reason);
    return answer(packet);
  });
  assert.ok(calls[0].incremental.newCommentIds.length + calls[0].incremental.newTranscriptIds.length < 15,
    'the packet cap shrinks fresh evidence further than the thirty-row/10k limits');
  assert.ok(calls.every((packet) => packet.comments.some((row) => row.id === 'c0') && packet.transcripts.some((row) => row.id === 's1')));
});

test('new AI memory references and revised decisions remain mandatory on subsequent pages', async () => {
  const input = source();
  let calls = 0;
  const result = await analyzeSellerLogicLinkWindow(input, async (packet) => {
    calls++;
    if (calls === 1) {
      const prior = decision();
      return answer(packet, { decisions: [prior], purchaseIntentCommentIds: ['c0'],
        analysisState: { ...answer(packet).analysisState, purchaseIntentCommentIds: ['c0'],
          memory: [{ text: 'AI가 연결한 상품', commentIds: ['c2'], transcriptIds: ['s3'] }] },
        signalLinks: [{ signalId: 'signal-1', outcome: 'MATCHED', decisionIds: [prior.id] }] });
    }
    assert.ok(packet.comments.some((row) => row.id === 'c2'));
    assert.ok(packet.transcripts.some((row) => row.id === 's3'));
    assert.equal(packet.previousDecisions[0].id, 'sale-1');
    return answer(packet, { decisions: packet.previousDecisions.map((row) => ({ ...row, reason: '이후 근거 확인' })) });
  });
  assert.ok(calls > 1);
  assert.equal(result.decisions[0].reason, '이후 근거 확인');
  assert.deepEqual(result.analysisState.memory[0].transcriptIds, ['s3']);
  assert.deepEqual(result.purchaseIntentCommentIds, ['c0']);
});

test('purchase retractions from an earlier page survive the final page response', async () => {
  const input = source();
  input.previousDecisions = [decision()];
  input.analysisState.purchaseIntentCommentIds = ['c0'];
  let calls = 0;
  const result = await analyzeSellerLogicLinkWindow(input, async (packet) => {
    calls++;
    const output = answer(packet);
    if (calls === 1) return { ...output, purchaseIntentCommentIds: [], retractedPurchaseIntentCommentIds: ['c0'],
      analysisState: { ...output.analysisState, purchaseIntentCommentIds: [] } };
    assert.deepEqual(packet.analysisState.purchaseIntentCommentIds, []);
    return output;
  });
  assert.deepEqual(result.purchaseIntentCommentIds, []);
  assert.deepEqual(result.retractedPurchaseIntentCommentIds, ['c0']);
});

test('history requests bubble immediately without exposing completed intermediate pages as a final result', async () => {
  const input = source(); let calls = 0, requested;
  const result = await analyzeSellerLogicLinkWindow(input, async (packet) => {
    if (++calls === 1) return answer(packet);
    requested = { ...answer(packet), historyRequests: ['이전 니트'], hasMore: true };
    return requested;
  });
  assert.equal(calls, 2);
  assert.equal(result, requested);
  assert.deepEqual(input.analysisState.processedCommentIds, []);
});

test('abort before dispatch performs no call and abort during a call prevents another page', async () => {
  const before = new AbortController(); before.abort();
  let calls = 0;
  await assert.rejects(analyzeSellerLogicLinkWindow(source(), async () => { calls++; }, { signal: before.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(analyzeSellerLogicLinkWindow(source(), async (packet) => {
    calls++; during.abort(); return answer(packet);
  }, { signal: during.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('a failure after a successful page rejects the window without mutating external checkpoints', async () => {
  const input = source(), before = JSON.stringify(input); let calls = 0;
  await assert.rejects(analyzeSellerLogicLinkWindow(input, async (packet) => {
    if (++calls === 2) throw new Error('second page failed');
    return answer(packet);
  }), /second page failed/);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(input), before);
});

for (const scenario of ['missing acknowledgement', 'unknown acknowledgement', 'unknown decision evidence', 'unknown memory evidence', 'missing prior decision']) {
  test(`invalid page response stops without continuing: ${scenario}`, async () => {
    const input = source(); input.previousDecisions = [decision()]; let calls = 0;
    await assert.rejects(analyzeSellerLogicLinkWindow(input, async (packet) => {
      calls++; const output = clone(answer(packet));
      if (scenario === 'missing acknowledgement') output.analysisState.processedTranscriptIds.pop();
      if (scenario === 'unknown acknowledgement') output.analysisState.processedCommentIds.push('unknown');
      if (scenario === 'unknown decision evidence') output.decisions[0].commentIds = ['unknown'];
      if (scenario === 'unknown memory evidence') output.analysisState.memory = [{ text: 'wrong', commentIds: ['unknown'], transcriptIds: [] }];
      if (scenario === 'missing prior decision') output.decisions = [];
      return output;
    }));
    assert.equal(calls, 1);
  });
}

test('missing mandatory references and oversized mandatory context fail before any call', async () => {
  for (const mode of ['missing', 'oversized']) {
    const input = source();
    if (mode === 'missing') input.linkSignals[0].transcriptIds = ['not-in-this-window'];
    else input.linkSignals[0].transcriptIds = input.transcripts.map((row) => row.id);
    let calls = 0;
    await assert.rejects(analyzeSellerLogicLinkWindow(input, async () => { calls++; }), /원문|필수 근거/);
    assert.equal(calls, 0);
  }
});

test('an oversized individual row is preserved and causes an explicit error without sending a truncated row', async () => {
  const input = source(4, 20); input.comments[0].content = '큰 원문'.repeat(10000);
  const original = input.comments[0].content; let calls = 0;
  await assert.rejects(analyzeSellerLogicLinkWindow(input, async () => { calls++; }), /한 행|전송 한도/);
  assert.equal(calls, 0);
  assert.equal(input.comments[0].content, original);
});
