import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSellerLogicDetectionInput, sellerLogicDetectionPrompt, parseSellerLogicDetectionResult } from '../src/services/sellerLogicDetection.ts';

const input = () => ({
  sessionId: 'detect-session', slotNumber: 2,
  comments: [{ id: 'c1', sessionId: 'detect-session', nickname: '😚JJEONG😚', content: '저용', capturedAt: '2026-10-05T12:00:01Z' }],
  transcripts: [
    { id: 's1', text: '정원이 언니', recognizedAt: '2026-10-05T12:00:00Z', isFinal: true, utteranceId: 'utterance-1', utteranceEnded: false, revision: 1, endReason: 'flush' },
    { id: 's2', text: '바지 이만', recognizedAt: '2026-10-05T12:00:02Z', isFinal: true, utteranceId: 'utterance-1', utteranceEnded: false, revision: 1, startedAt: '2026-10-05T12:00:02Z' },
    { id: 's3', text: '원 드릴게요', recognizedAt: '2026-10-05T12:00:03Z', isFinal: true, utteranceId: 'utterance-1', utteranceEnded: true, revision: 2, endReason: 'endpoint', endedAt: '2026-10-05T12:00:04Z', receivedAt: '2026-10-05T12:00:04.100Z' },
  ],
  freshCommentIds: ['c1'], freshTranscriptIds: ['s2', 's3'], existingSignals: [],
  carry: [{ reason: '호명 다음 조각을 이어 읽어야 함', commentIds: [], transcriptIds: ['s1'] }],
});
const answer = (extra = {}) => ({ summary: '이어진 발화에 거래 연결 가능성이 있습니다.',
  signals: [{ id: null, summary: '구매 댓글 뒤 호명과 상품 배정으로 보이는 발화가 이어짐', commentIds: ['C0'], transcriptIds: ['S0', 'S1', 'S2'] }],
  carry: [], ...extra,
});
const parse = (raw, evidence = input()) => parseSellerLogicDetectionResult(JSON.stringify(raw), evidence);

test('detection schema requires complete signals and carry with only available source and existing signal aliases', () => {
  const evidence = input();
  evidence.existingSignals = [{ id: 'slsig:prior', summary: '이전 호명', commentIds: [], transcriptIds: ['s1'] }];
  const prompt = sellerLogicDetectionPrompt(evidence), format = prompt.responseSchema;
  assert.equal(format.name, 'seller_logic_detection');
  assert.equal(prompt.maxOutputTokens, 4096);
  assert.deepEqual(format.schema.required, ['summary', 'signals', 'carry']);
  assert.equal(format.schema.additionalProperties, false);
  const { signals, carry } = format.schema.properties;
  assert.deepEqual(signals.items.required, ['id', 'summary', 'commentIds', 'transcriptIds']);
  assert.deepEqual(signals.items.properties.id.enum, [null, 'G0']);
  assert.deepEqual(signals.items.properties.commentIds.items.enum, ['C0']);
  assert.deepEqual(signals.items.properties.transcriptIds.items.enum, ['S0', 'S1', 'S2']);
  assert.equal(signals.items.properties.commentIds.uniqueItems, true);
  assert.equal(signals.items.additionalProperties, false);
  assert.equal(signals.items.properties.unitPrice, undefined);
  assert.deepEqual(carry.items.required, ['reason', 'commentIds', 'transcriptIds']);
  assert.equal(carry.items.properties.reason.maxLength, 1500);
  const sellerOnly = { ...input(), comments: [], freshCommentIds: [] };
  const emptyRefs = sellerLogicDetectionPrompt(sellerOnly).responseSchema.schema.properties.signals.items.properties.commentIds;
  assert.equal(emptyRefs.maxItems, 0);
  assert.equal(emptyRefs.items.enum, undefined, 'empty source arrays must not produce an invalid empty enum');
});

test('detection preserves every source and utterance boundary revision without treating stable STT as sentence end', () => {
  const normalized = normalizeSellerLogicDetectionInput(input());
  const prompt = sellerLogicDetectionPrompt(normalized);
  const wire = JSON.parse(prompt.userPrompt);
  assert.equal(wire.timeline.length, 4);
  assert.equal(wire.timeline.find((row) => row[0] === 'C0')[2], '😚JJEONG😚');
  assert.equal(wire.timeline.find((row) => row[0] === 'S0')[3].isFinal, true);
  assert.equal(wire.timeline.find((row) => row[0] === 'S0')[3].utteranceEnded, false);
  assert.equal(wire.timeline.find((row) => row[0] === 'S2')[3].revision, 2);
  assert.equal(wire.timeline.find((row) => row[0] === 'S2')[3].endedAt, '2026-10-05T12:00:04Z');
  assert.equal(wire.timeline.find((row) => row[0] === 'S2')[3].receivedAt, '2026-10-05T12:00:04.100Z');
  assert.deepEqual(wire.freshTranscriptIds, ['S1', 'S2']);
  assert.deepEqual(wire.carry[0].transcriptIds, ['S0']);
  assert.match(prompt.systemPrompt, /isFinal=true.*끝났다는 뜻이 아닙니다/);
  assert.match(prompt.systemPrompt, /모든 의미 판단은 직접/);
  assert.match(prompt.systemPrompt, /거래 확정·가격 결정.*하지 않습니다/);
});

test('seller-start detection instructions distinguish announced product numbers from descriptive numbers without prefiltering source', async () => {
  const samples = ['7,000원, 1번.', '그레이 한 분, 7,000원. 번호 1번, 원단도 다 좋아',
    '이 니트는 부드러워요', '7천원', '44~55', '면 100%', '두 장 남았어요'];
  const evidence = { ...input(), comments: [], freshCommentIds: [], existingSignals: [], carry: [],
    transcripts: samples.map((text, index) => ({ id: `number-${index}`, text,
      recognizedAt: new Date(Date.parse('2026-10-05T12:00:00Z') + index * 1000).toISOString(), isFinal: true, utteranceEnded: true })),
    freshTranscriptIds: samples.map((_, index) => `number-${index}`) };
  const prompt = sellerLogicDetectionPrompt(normalizeSellerLogicDetectionInput(evidence));
  assert.deepEqual(JSON.parse(prompt.userPrompt).timeline.map((row) => row[2]), samples, 'all descriptive and numbered source reaches AI unchanged');
  assert.match(prompt.systemPrompt, /상품의 주문번호를 안내하는 말/);
  assert.match(prompt.systemPrompt, /구매자 댓글이 아직 없어도 signals로 반환/);
  assert.match(prompt.systemPrompt, /'주문하세요' 같은 명령이나 구매자 호명은 필수가 아닙니다/);
  assert.match(prompt.systemPrompt, /설명·가격·재질·사이즈·수량 숫자만.*signals에 넣지 마세요/);
  assert.match(prompt.systemPrompt, /숫자가 있다는 이유로 상품번호라고 간주하지/);
  assert.match(prompt.systemPrompt, /그 자체가 구매 요청이나 판매 확정은 아닙니다/);
  assert.match(prompt.systemPrompt, /이런 거래 행동에는 상품번호가 없어도 됩니다/);
  for (const phrase of samples) assert.ok(prompt.systemPrompt.includes(phrase));
  // This is a supplied AI result, not a local classifier: the contract must
  // permit number announcements before any buyer appears, and preserve only
  // the sources the AI selected from the complete input.
  const result = await parse(answer({ signals: [{ id: null, summary: '고객에게 1번 상품과 가격을 안내하여 후속 구매 연결을 기다림',
    commentIds: [], transcriptIds: ['S0', 'S1'] }] }), evidence);
  assert.equal(result.signals.length, 1);
  assert.deepEqual(result.signals[0].commentIds, []);
  assert.deepEqual(result.signals[0].transcriptIds, ['number-0', 'number-1']);
  assert.equal(result.signals[0].unitPrice, undefined);
});

test('AI-selected no-signal output for a complete plain description stays empty without inventing carry or a sale', async () => {
  const evidence = { ...input(), comments: [], freshCommentIds: [], existingSignals: [], carry: [],
    transcripts: [{ id: 'description', text: '이 니트는 부드러워요. 7천원이고 면 100%, 44~55 사이즈예요.',
      recognizedAt: '2026-10-05T12:00:00Z', isFinal: true, utteranceEnded: true }], freshTranscriptIds: ['description'] };
  const result = await parse({ summary: '상품 설명과 가격·재질·사이즈만 있으며 주문번호 안내나 거래 행동이 없음', signals: [], carry: [] }, evidence);
  assert.deepEqual(result.signals, []);
  assert.deepEqual(result.carry, []);
});

test('standalone buyer price and size questions are explicitly excluded from first-stage signals while remaining unfiltered AI input', async () => {
  for (const content of ['그레이 니트 얼마인가요?', '이 니트 44~55도 맞나요?']) {
    const evidence = { ...input(), comments: [{ ...input().comments[0], content }], transcripts: [],
      freshCommentIds: ['c1'], freshTranscriptIds: [], existingSignals: [], carry: [] };
    const prompt = sellerLogicDetectionPrompt(normalizeSellerLogicDetectionInput(evidence));
    assert.equal(JSON.parse(prompt.userPrompt).timeline[0][3], content);
    assert.match(prompt.systemPrompt, /구매 요청이나 기존 거래의 정정·협상 맥락 없이 단순 가격·사이즈 질문만 있으면 signals에 넣지 마세요/);
    assert.match(prompt.systemPrompt, /상품명이나 숫자가 포함돼도 단순 문의이면 해당 댓글은 signals에서 제외/);
    assert.match(prompt.systemPrompt, /입력 전체가 이런 문의뿐이면 signals:\[\]이며, 다른 후보의 구매·후속 신호는 유지/);
    assert.match(prompt.systemPrompt, /막연히 구매 가능성이 있다는 이유로 2차 후보에 넘기지/);
    // The model's no-signal response is accepted without adding a candidate.
    const result = await parse({ summary: '구매 요청이나 기존 거래 후속 없는 단순 문의', signals: [], carry: [] }, evidence);
    assert.deepEqual(result.signals, []);
  }
});

test('a price-correction question about an existing transaction remains an eligible AI-selected follow-up', async () => {
  const evidence = { ...input(), comments: [
    { ...input().comments[0], id: 'purchase', content: '저요' },
    { ...input().comments[0], id: 'correction', content: '아까 7천원이라면서요?', capturedAt: '2026-10-05T12:00:04Z' },
  ], freshCommentIds: ['correction'], freshTranscriptIds: [], carry: [],
    existingSignals: [{ id: 'slsig:existing-purchase', summary: '이미 구매 요청과 배정을 연결 중', commentIds: ['purchase'], transcriptIds: ['s1'] }] };
  const prompt = sellerLogicDetectionPrompt(evidence);
  assert.match(prompt.systemPrompt, /이미 요청·배정된 거래에 대해.*가격 정정을 요구하거나 기존 협상을 이어가는 질문은 거래 후속이므로 signals로 반환/);
  assert.match(prompt.systemPrompt, /질문형이라는 형식만으로 제외하지/);
  const result = await parse(answer({ signals: [{ id: 'G0', summary: '기존 거래의 가격 정정 요청',
    commentIds: ['C0', 'C1'], transcriptIds: ['S0'] }] }), evidence);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].id, 'slsig:existing-purchase');
  assert.deepEqual(result.signals[0].commentIds, ['purchase', 'correction']);
});

test('signal IDs are stable by session and source sets, independent of reference order or model wording', async () => {
  const first = await parse(answer());
  const reordered = answer();
  reordered.signals[0].summary = '같은 원문을 다시 표현한 탐지 요약';
  reordered.signals[0].transcriptIds.reverse();
  const second = await parse(reordered);
  assert.match(first.signals[0].id, /^slsig:[0-9a-f]{64}$/);
  assert.equal(first.signals[0].id, second.signals[0].id);
  assert.deepEqual(first.signals[0].commentIds, ['c1']);
  assert.deepEqual(first.signals[0].transcriptIds, ['s1', 's2', 's3']);
  const other = input(); other.sessionId = 'another-session';
  assert.notEqual((await parse(answer(), other)).signals[0].id, first.signals[0].id);
});

test('existing signal follow-up keeps the original ID and cites both old and fresh/carry evidence', async () => {
  const evidence = input();
  evidence.existingSignals = [{ id: 'slsig:prior', summary: '기존 호명 후보', commentIds: [], transcriptIds: ['s1'] }];
  const raw = answer(); raw.signals[0].id = 'G0';
  assert.equal((await parse(raw, evidence)).signals[0].id, 'slsig:prior');
  raw.signals[0].transcriptIds = ['S1']; raw.signals[0].commentIds = [];
  await assert.rejects(parse(raw, evidence), /기존 근거/);
});

test('changed metadata on the same STT ID can be fresh evidence and retains its existing signal identity', async () => {
  const evidence = input();
  evidence.existingSignals = [{ id: 'slsig:revision', summary: '끝나지 않은 배정 발화', commentIds: [], transcriptIds: ['s3'] }];
  evidence.freshCommentIds = []; evidence.freshTranscriptIds = ['s3']; evidence.carry = [];
  const raw = answer({ signals: [{ id: 'G0', summary: '발화 종료 경계가 도착해 다시 읽을 필요가 있음', commentIds: [], transcriptIds: ['S2'] }] });
  assert.equal((await parse(raw, normalizeSellerLogicDetectionInput(evidence))).signals[0].id, 'slsig:revision');
});

test('unchanged existing signal repeated with only a subset of its old references is ignored without losing fresh candidates', async () => {
  const evidence = input();
  evidence.freshCommentIds = []; evidence.carry = [];
  evidence.existingSignals = [{ id: 'slsig:prior', summary: '기존 호명 후보', commentIds: ['c1'], transcriptIds: ['s1'] }];
  const repeated = { id: 'G0', summary: '같은 호명을 다시 표현한 요약', commentIds: [], transcriptIds: ['S0'] };
  assert.deepEqual((await parse(answer({ signals: [repeated] }), evidence)).signals, []);
  const raw = answer({ signals: [repeated, { id: null, summary: '새 상품 배정 발화', commentIds: [], transcriptIds: ['S2'] }] });
  const result = await parse(raw, evidence);
  assert.equal(result.signals.length, 1);
  assert.deepEqual(result.signals[0].transcriptIds, ['s3']);
  assert.notEqual(result.signals[0].id, 'slsig:prior');
});

test('filtering old overlap never bypasses ID or source validation and existing signals still need their own evidence', async () => {
  const evidence = input();
  evidence.freshCommentIds = []; evidence.freshTranscriptIds = ['s3']; evidence.carry = [];
  evidence.existingSignals = [{ id: 'slsig:prior', summary: '기존 호명 후보', commentIds: [], transcriptIds: ['s1'] }];
  const repeated = { id: 'G0', summary: '변경 없는 신호', commentIds: [], transcriptIds: ['S0'] };
  for (const signal of [
    { ...repeated, transcriptIds: ['S0', 'S999'] },
    { ...repeated, commentIds: ['C999'] },
    { ...repeated, transcriptIds: ['S0', 'S0'] },
    { ...repeated, transcriptIds: ['S1'] },
    { ...repeated, commentIds: ['C0'], transcriptIds: [] },
    { ...repeated, id: 'G999' },
    { ...repeated, id: undefined },
    { ...repeated, id: 1 },
    { ...repeated, id: '' },
  ]) await assert.rejects(parse(answer({ signals: [signal] }), evidence));
  for (const signal of [
    { ...repeated, transcriptIds: ['S0', 'S1'] },
    { ...repeated, commentIds: ['C0'] },
    { ...repeated, id: null, transcriptIds: ['S1'] },
  ]) assert.deepEqual((await parse(answer({ signals: [signal] }), evidence)).signals, []);
});

test('null-ID old-only candidates are filtered for exact, partial and different old reference sets while fresh candidates survive', async () => {
  const evidence = input();
  evidence.comments.push({ ...evidence.comments[0], id: 'c2', nickname: '루비', content: '저요' });
  evidence.freshCommentIds = ['c2']; evidence.freshTranscriptIds = ['s3']; evidence.carry = [];
  // Filtering eligibility does not depend on a prior signal's identity or on
  // semantic similarity between the repeated and current reference sets.
  evidence.existingSignals = [{ id: 'slsig:retained-after-followup', summary: '기존 구매 후보', commentIds: ['c1'], transcriptIds: ['s2', 's1'] }];
  const repeated = { id: null, summary: '같은 과거 후보를 새 후보로 반복', commentIds: ['C0'], transcriptIds: ['S0', 'S1'] };
  const fresh = { id: null, summary: '새 구매자와 배정 발화', commentIds: ['C1'], transcriptIds: ['S2'] };
  assert.deepEqual((await parse(answer({ signals: [repeated] }), evidence)).signals, []);
  for (const replay of [
    repeated,
    { ...repeated, transcriptIds: ['S0'] },
    { ...repeated, commentIds: [] },
    { ...repeated, commentIds: [], transcriptIds: ['S1'] },
  ]) {
    const result = await parse(answer({ signals: [replay, fresh] }), evidence);
    assert.equal(result.signals.length, 1);
    assert.deepEqual(result.signals[0].commentIds, ['c2']);
    assert.deepEqual(result.signals[0].transcriptIds, ['s3']);
  }
  for (const invalid of [
    { ...repeated, id: 'G999' },
    { ...repeated, transcriptIds: ['S0', 'S1', 'S999'] },
    { ...repeated, transcriptIds: ['S0', 'S1', 'S1'] },
  ]) await assert.rejects(parse(answer({ signals: [invalid, fresh] }), evidence));
});

test('an existing signal using carried old evidence remains a follow-up rather than an ignored repetition', async () => {
  const evidence = input();
  evidence.existingSignals = [{ id: 'slsig:prior', summary: '기존 호명 후보', commentIds: [], transcriptIds: ['s1'] }];
  const raw = answer({ signals: [{ id: 'G0', summary: '이어 읽던 호명을 다시 연결할 필요', commentIds: [], transcriptIds: ['S0'] }] });
  const result = await parse(raw, evidence);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].id, 'slsig:prior');
});

test('old overlap alone cannot create a new signal; a carried boundary fragment can', async () => {
  const raw = answer({ signals: [{ id: null, summary: '호명 가능성', commentIds: [], transcriptIds: ['S0'] }] });
  assert.equal((await parse(raw)).signals.length, 1);
  const evidence = input(); evidence.carry = [];
  assert.deepEqual((await parse(raw, evidence)).signals, []);
});

test('no signal and unfinished speech are different valid outputs; carry can later clear', async () => {
  const unfinished = await parse(answer({ signals: [], carry: [{ reason: '금액 단위 뒤의 말을 더 읽어야 함', commentIds: [], transcriptIds: ['S1'] }] }));
  assert.deepEqual(unfinished.signals, []);
  assert.deepEqual(unfinished.carry[0].transcriptIds, ['s2']);
  const cleared = await parse(answer({ signals: [], carry: [] }));
  assert.deepEqual(cleared, { summary: answer().summary, signals: [], carry: [] });
});

test('seller-only and comment-only evidence can produce a candidate without buyer or price decisions', async () => {
  for (const refs of [{ commentIds: [], transcriptIds: ['S2'] }, { commentIds: ['C0'], transcriptIds: [] }]) {
    const raw = answer({ signals: [{ id: null, summary: '추가 연결 확인 필요', ...refs, nickname: '잘못된 호칭', unitPrice: 12345, status: 'CONFIRMED' }] });
    const signal = (await parse(raw)).signals[0];
    assert.deepEqual(Object.keys(signal).sort(), ['commentIds', 'id', 'summary', 'transcriptIds']);
  }
});

test('same nickname does not merge signals with different source sets', async () => {
  const raw = answer({ signals: [
    { id: null, summary: '첫 상품 후보', commentIds: ['C0'], transcriptIds: ['S1'] },
    { id: null, summary: '다른 상품 후보', commentIds: ['C0'], transcriptIds: ['S2'] },
  ] });
  const result = await parse(raw);
  assert.equal(result.signals.length, 2);
  assert.notEqual(result.signals[0].id, result.signals[1].id);
});

test('fabricated source aliases, missing evidence and duplicated candidates are rejected', async () => {
  for (const raw of [
    answer({ signals: [{ ...answer().signals[0], commentIds: ['C999'] }] }),
    answer({ signals: [{ ...answer().signals[0], id: 'G999' }] }),
    answer({ signals: [{ ...answer().signals[0], commentIds: [], transcriptIds: [] }] }),
    answer({ signals: [answer().signals[0], answer().signals[0]] }),
    answer({ carry: [{ reason: '불명확', commentIds: [], transcriptIds: ['S999'] }] }),
    answer({ carry: undefined }),
  ]) await assert.rejects(parse(raw));
});

test('null-ID same-source revision reuses the existing signal ID without requiring the model G alias', async () => {
  const evidence = input();
  evidence.existingSignals = (await parse(answer(), evidence)).signals;
  evidence.transcripts[2].revision = 3;
  evidence.transcripts[2].text = '원에 드릴게요';
  evidence.freshCommentIds = []; evidence.freshTranscriptIds = ['s3']; evidence.carry = [];
  const raw = answer(); raw.signals[0].transcriptIds.reverse();
  assert.equal((await parse(raw, evidence)).signals[0].id, evidence.existingSignals[0].id);
  // Exact current references take priority over a hash minted before evidence
  // was expanded, so retained IDs also work after earlier follow-up updates.
  evidence.existingSignals[0].id = 'slsig:retained-after-followup';
  assert.equal((await parse(raw, evidence)).signals[0].id, 'slsig:retained-after-followup');
  await assert.rejects(parse(answer({ signals: [raw.signals[0], { ...raw.signals[0], id: 'G0' }] }), evidence), /중복/);
});

test('null-ID stable hash can retain an earlier identity but unequal source sets are not semantically merged', async () => {
  const evidence = input();
  const initial = { id: null, summary: '초기 구매 후보', commentIds: ['C0'], transcriptIds: ['S1'] };
  const first = (await parse(answer({ signals: [initial] }), evidence)).signals[0];
  evidence.existingSignals = [{ ...first, transcriptIds: ['s1', 's2', 's3'] }];
  assert.equal((await parse(answer({ signals: [initial] }), evidence)).signals[0].id, first.id);
  evidence.existingSignals = [{ ...first, id: 'slsig:unrelated-retained', transcriptIds: ['s2'] }];
  const superset = { ...initial, transcriptIds: ['S1', 'S2'] };
  const second = (await parse(answer({ signals: [superset] }), evidence)).signals[0];
  assert.notEqual(second.id, evidence.existingSignals[0].id);
  assert.notEqual(second.id, first.id);
  evidence.existingSignals = [{ ...second, id: 'slsig:expanded-retained' }];
  assert.notEqual((await parse(answer({ signals: [initial] }), evidence)).signals[0].id, 'slsig:expanded-retained');
});

test('input rejects oversized packets, more than thirty fresh sources, invalid boundaries and absent prior references', () => {
  const packet = input(); packet.transcripts[0].text = '가'.repeat(32_001);
  const fresh = input(); fresh.transcripts = Array.from({ length: 31 }, (_, index) => ({ ...fresh.transcripts[0], id: `s${index}` }));
  fresh.freshCommentIds = []; fresh.freshTranscriptIds = fresh.transcripts.map((row) => row.id); fresh.carry = [];
  const metadata = input(); metadata.transcripts[0].revision = 0;
  const unknown = input(); unknown.existingSignals = [{ id: 'missing', summary: '원문 없음', commentIds: [], transcriptIds: ['missing-source'] }];
  const duplicate = input(); duplicate.freshTranscriptIds = ['s2', 's2'];
  for (const raw of [packet, fresh, metadata, unknown, duplicate]) assert.throws(() => normalizeSellerLogicDetectionInput(raw));
});
