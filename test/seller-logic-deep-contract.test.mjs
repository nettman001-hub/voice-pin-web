import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSellerLogicDeepInput, parseSellerLogicDeepResult, sellerLogicDeepPrompt } from '../src/services/sellerLogicDeepContract.ts';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const at = (seconds) => new Date(epoch + seconds * 1000).toISOString();

const payload = () => ({
  sessionId: 'deep-contract', slotNumber: 2,
  comments: [
    { id: 'c1', sessionId: 'deep-contract', nickname: 'xou.3z', content: '저여 맨투맨', capturedAt: at(3) },
    { id: 'c2', sessionId: 'deep-contract', nickname: '루비', content: 'ㅈㅇ', capturedAt: at(10) },
  ],
  transcripts: [
    { id: 's1', text: '맨투맨 18,000원', recognizedAt: at(1), isFinal: true },
    { id: 's2', text: '엑소 언니 드릴게요', recognizedAt: at(5), isFinal: true },
    { id: 's3', text: '루비 언니 1.5에 드릴게요', recognizedAt: at(12), isFinal: true },
  ],
  segment: { id: 'dseg:0:C:c1', index: 0, startedAt: at(0), endedAt: at(13), closed: true, commentIds: ['c1', 'c2'], transcriptIds: ['s1', 's2', 's3'] },
  context: [], previousDecisions: [],
});
const answer = (extra = {}) => ({
  summary: '한 시간대의 심층 판단입니다.',
  signals: [{ kind: 'BUYER_INTENT', summary: '구매 의사 댓글이 있습니다.', commentIds: ['C0'], transcriptIds: [] }],
  decisions: [{
    id: null, status: 'CONFIRMED', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
    reason: 'STT 호칭 엑소를 상품·시각·문맥으로 xou.3z에 연결하고 판매자 확정을 확인했습니다.',
    commentIds: ['C0'], transcriptIds: ['S0', 'S1'],
  }],
  context: [{ text: '맨투맨 18,000원 안내', commentIds: [], transcriptIds: ['S0'] }],
  ...extra,
});
const parse = (raw, evidence) => parseSellerLogicDeepResult(JSON.stringify(raw), evidence);

test('deep schema exposes only the fields AI judges and constrains every source alias', () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const prompt = sellerLogicDeepPrompt(input);
  assert.equal(prompt.responseSchema.name, 'seller_logic_deep');
  assert.equal(prompt.maxOutputTokens, 8192);
  assert.deepEqual(prompt.responseSchema.schema.required, ['summary', 'signals', 'decisions', 'context']);
  const decisions = prompt.responseSchema.schema.properties.decisions;
  assert.deepEqual(decisions.items.properties.id.enum, [null]);
  assert.deepEqual(decisions.items.properties.status.enum, ['CONFIRMED', 'PENDING', 'REVIEW', 'CANCELLED']);
  assert.deepEqual(decisions.items.properties.unitPrice.type, ['integer', 'null']);
  assert.deepEqual(decisions.items.properties.commentIds.items.enum, ['C0', 'C1']);
  assert.equal(decisions.items.additionalProperties, false);
  const wire = JSON.parse(prompt.userPrompt);
  assert.equal(wire.timeline.length, 5);
  assert.equal(wire.segment.commentIds.length, 2);
  assert.equal(wire.timeline.find((row) => row.ref === 'S1').role, 'new');
  for (const phrase of ['구매 의사', '정확한 정본', '주문번호', '만원 단위', 'STT', '시간대']) {
    assert.ok(prompt.systemPrompt.includes(phrase), `system prompt must state ${phrase}`);
  }
});

test('a new decision keeps the exact cited nickname and derives time and identity from evidence', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const parsed = await parse(answer(), input);
  assert.equal(parsed.decisions.length, 1);
  const decision = parsed.decisions[0];
  assert.ok(decision.id.startsWith('sld:'));
  assert.equal(decision.nickname, 'xou.3z');
  assert.equal(decision.unitPrice, 18000);
  assert.equal(decision.decidedAt, at(5));
  assert.deepEqual(decision.commentIds, ['c1']);
  assert.deepEqual(decision.transcriptIds, ['s1', 's2']);
  assert.equal(parsed.signals[0].kind, 'BUYER_INTENT');
  assert.equal(parsed.context[0].transcriptIds[0], 's1');
});

test('nickname must be the literal text of a cited comment', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const aliased = answer();
  aliased.decisions[0].nickname = '엑소';
  await assert.rejects(() => parse(aliased, input), /정확한 원문 닉네임/);
});

test('CONFIRMED requires price and a final seller utterance', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const noPrice = answer();
  noPrice.decisions[0].unitPrice = null;
  await assert.rejects(() => parse(noPrice, input), /CONFIRMED/);
  const noSpeech = answer();
  noSpeech.decisions[0].transcriptIds = [];
  await assert.rejects(() => parse(noSpeech, input), /근거/);
});

test('previous decisions can only be revised with their own prior evidence', async () => {
  const base = payload();
  const prior = {
    id: 'sld:["deep-contract","c1","s2",""]', status: 'PENDING', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
    reason: '판매자 확정 대기', commentIds: ['c1'], transcriptIds: ['s2'], decidedAt: at(5),
  };
  const evidence = normalizeSellerLogicDeepInput({ ...base, previousDecisions: [prior] });
  const revised = answer();
  revised.decisions[0] = { ...revised.decisions[0], id: 'D0', commentIds: ['C0'], transcriptIds: ['S2'] };
  const parsed = await parse(revised, evidence);
  assert.equal(parsed.decisions[0].id, prior.id);
  const unrelated = answer();
  unrelated.decisions[0] = { ...unrelated.decisions[0], id: 'D0', nickname: '루비', commentIds: ['C1'], transcriptIds: ['S2'] };
  await assert.rejects(() => parse(unrelated, evidence), /기존 근거/);
  const unknown = answer();
  unknown.decisions[0] = { ...unknown.decisions[0], id: 'D9' };
  await assert.rejects(() => parse(unknown, evidence), /이전에 없던/);
});

test('transport validation rejects evidence that is not inside this time-bucket packet', () => {
  const base = payload();
  assert.throws(() => normalizeSellerLogicDeepInput({ ...base, segment: { ...base.segment, commentIds: ['c9'] } }), /원문 ID/);
  assert.throws(() => normalizeSellerLogicDeepInput({ ...base, context: [{ text: '없는 근거', commentIds: ['c9'], transcriptIds: [] }] }), /원문 ID/);
  assert.throws(() => normalizeSellerLogicDeepInput({ ...base, segment: { ...base.segment, commentIds: [], transcriptIds: [] } }), /원문 근거/);
});

test('an evidence-less context item is preserved for manual review instead of rejecting the deep result', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const withEmpty = answer();
  withEmpty.context = [
    { text: '근거 없는 요약', commentIds: [], transcriptIds: [] },
    { text: '맨투맨 18,000원 안내', commentIds: [], transcriptIds: ['S0'] },
  ];
  const parsed = await parse(withEmpty, input);
  assert.deepEqual(parsed.context.map((item) => item.text), ['근거 없는 요약', '맨투맨 18,000원 안내']);
  assert.equal(parsed.context[0].sourcesMissing, true);
  assert.equal(parsed.context[1].sourcesMissing, undefined);
});

test('swapped or unknown context aliases are recovered or shown for review instead of halting the analysis', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const swapped = answer();
  swapped.context = [
    { text: '전사 근거가 댓글 배열로 온 항목', commentIds: ['S0'], transcriptIds: [] },
    { text: '없는 별칭만 온 항목', commentIds: ['C99'], transcriptIds: [] },
  ];
  const parsed = await parse(swapped, input);
  assert.deepEqual(parsed.context[0].commentIds, []);
  assert.deepEqual(parsed.context[0].transcriptIds, ['s1']);
  assert.equal(parsed.context[1].sourcesMissing, true);
});

test('an auxiliary signal with unusable aliases never rejects the deep result', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const messy = answer();
  messy.signals = [
    { kind: 'BUYER_INTENT', summary: '별칭이 뒤바뀐 신호', commentIds: ['S1'], transcriptIds: ['C0'] },
    { kind: 'NOISE', summary: '알 수 없는 별칭 신호', commentIds: ['C99'], transcriptIds: ['S99'] },
  ];
  const parsed = await parse(messy, input);
  assert.equal(parsed.signals.length, 1);
  assert.deepEqual(parsed.signals[0].commentIds, ['c1']);
  assert.deepEqual(parsed.signals[0].transcriptIds, ['s2']);
});

test('the engine still may not import a context item without source evidence', () => {
  const base = payload();
  assert.throws(() => normalizeSellerLogicDeepInput({ ...base, context: [{ text: '근거 없는 문맥', commentIds: [], transcriptIds: [] }] }), /원문 근거/);
});

test('previous decision reasons are abbreviated on the wire while the browser keeps them', () => {
  const base = payload();
  const input = normalizeSellerLogicDeepInput({ ...base, previousDecisions: [{
    id: 'sld:["deep-contract","c1","s2",""]', status: 'CONFIRMED', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
    reason: '가'.repeat(1200), commentIds: ['c1'], transcriptIds: ['s2'], decidedAt: at(5),
  }] });
  const prompt = sellerLogicDeepPrompt(input);
  const wire = JSON.parse(prompt.userPrompt);
  assert.equal(wire.previousDecisions.length, 1);
  assert.equal(wire.previousDecisions[0].reason.length, 401);
  assert.ok(wire.previousDecisions[0].reason.endsWith('…'));
  assert.equal(input.previousDecisions[0].reason.length, 1200, 'the browser keeps the full reason');
  assert.ok(prompt.systemPrompt.includes('축약'));
});
