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

test('when AI cites another buyer comment, auto-recovers matching comment from evidence (e.g. 오1유3 with 키티 comment)', async () => {
  const base = payload();
  base.comments.push({ id: 'c3', sessionId: 'deep-contract', nickname: '키티', content: '블랙엑라', capturedAt: at(15) });
  base.comments[1] = { ...base.comments[1], nickname: '오1유3', content: '저 된거죠?' };
  const input = normalizeSellerLogicDeepInput(base);
  const aiAnswer = answer();
  // AI sets nickname to '오1유3' but cited C2 (which is c3, 키티)
  aiAnswer.decisions[0].nickname = '오1유3';
  aiAnswer.decisions[0].commentIds = ['C2']; // C2 is '키티'
  const parsed = await parse(aiAnswer, input);
  assert.equal(parsed.decisions[0].nickname, '오1유3');
  assert.deepEqual(parsed.decisions[0].commentIds, ['c2'], 'automatically recovered to c2 (오1유3)');
  assert.equal(parsed.decisions[0].status, 'CONFIRMED');
});

test('CONFIRMED requires price and a final seller utterance or demotes to REVIEW', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const noPrice = answer();
  noPrice.decisions[0].unitPrice = null;
  const parsed = await parse(noPrice, input);
  assert.equal(parsed.decisions[0].status, 'REVIEW');
  assert.ok(parsed.decisions[0].reason.includes('확정 가격'));
  const noSpeech = answer();
  noSpeech.decisions[0].transcriptIds = [];
  noSpeech.decisions[0].commentIds = [];
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

test('updating a previous decision merges prior evidence when AI cites only newly recognized evidence', async () => {
  const base = payload();
  const prior = {
    id: 'sld:["deep-contract","c1","s2",""]', status: 'PENDING', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
    reason: '판매자 확정 대기', commentIds: ['c1'], transcriptIds: ['s2'], decidedAt: at(5),
  };
  const evidence = normalizeSellerLogicDeepInput({ ...base, previousDecisions: [prior] });
  const updatedOnlyNewSpeech = answer();
  // AI cites D0 with the same buyer, but cites only new transcript S0 instead of repeating prior C0/S1
  updatedOnlyNewSpeech.decisions[0] = {
    id: 'D0', status: 'CONFIRMED', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
    reason: '판매자가 18,000원에 확정 발화함', commentIds: [], transcriptIds: ['S0'],
  };
  const parsed = await parse(updatedOnlyNewSpeech, evidence);
  assert.equal(parsed.decisions[0].id, prior.id);
  // prior comment c1 and prior speech s2 are merged with new speech s1 (S0)
  assert.deepEqual(parsed.decisions[0].commentIds, ['c1']);
  assert.deepEqual(parsed.decisions[0].transcriptIds.sort(), ['s1', 's2']);
});

test('prompt instructs decimal price x10,000 calculation and casual confirmation like 샤넬 언니 그레이', () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const prompt = sellerLogicDeepPrompt(input);
  assert.ok(prompt.systemPrompt.includes('소수점에 10,000원을 곱해'));
  assert.ok(prompt.systemPrompt.includes('3.9 -> 39,000원'));
  assert.ok(prompt.systemPrompt.includes('샤넬 언니 그레이'));
  assert.ok(prompt.systemPrompt.includes('그레이 주세요'));
  assert.ok(prompt.systemPrompt.includes('단순 문의/스펙 질문은 구매 의사가 아님'));
  assert.ok(prompt.systemPrompt.includes('판매자의 질문 답변은 배정 확정이 아님'));
});

test('pure inquiry comments (e.g. 55반인데, 허리가 밴딩) demote from CONFIRMED to REVIEW', async () => {
  const base = payload();
  base.comments = [
    { id: 'c_dorothy_1', sessionId: 'deep-contract', nickname: '도로시💕', content: '55반인데', capturedAt: at(0) },
    { id: 'c_dorothy_2', sessionId: 'deep-contract', nickname: '도로시💕', content: '허리가 밴딩', capturedAt: at(20) },
  ];
  base.transcripts = [
    { id: 's_dorothy_1', text: ', 3.9 드립니다. 밴딩 쪼여서 5반이야? 5반 될 것 같은데, 언니.', recognizedAt: at(2), isFinal: true },
    { id: 's_dorothy_2', text: '자, 허리 밴딩이에요.', recognizedAt: at(25), isFinal: true },
  ];
  base.segment = {
    id: 'dseg:0:dorothy', index: 0,
    startedAt: at(0), endedAt: at(30), closed: true,
    commentIds: ['c_dorothy_1', 'c_dorothy_2'],
    transcriptIds: ['s_dorothy_1', 's_dorothy_2'],
  };
  const input = normalizeSellerLogicDeepInput(base);
  const erroneousAiAnswer = answer();
  // AI erroneously set CONFIRMED citing pure inquiry comments
  erroneousAiAnswer.decisions[0] = {
    id: null,
    status: 'CONFIRMED',
    nickname: '도로시💕',
    unitPrice: 39000,
    quantity: 1,
    reason: '고객 도로시가 허리 밴딩 여부를 확인했고 판매자가 확정함',
    commentIds: ['C0', 'C1'],
    transcriptIds: ['S0', 'S1'],
  };

  const parsed = await parse(erroneousAiAnswer, input);
  assert.equal(parsed.decisions[0].status, 'REVIEW', 'demoted to REVIEW because comment was only a question');
  assert.ok(parsed.decisions[0].reason.includes('단순 문의/질문'));
});

test('auto-recovers nickname when AI returns string "null" but cited comments belong to a single buyer (e.g. 키티)', async () => {
  const base = payload();
  base.comments[0] = { id: 'c1', sessionId: 'deep-contract', nickname: '키티', content: '저요 1번', capturedAt: at(3) };
  const input = normalizeSellerLogicDeepInput(base);
  const aiAnswer = answer();
  // AI sets nickname to string "null" while citing C0 (키티)
  aiAnswer.decisions[0].nickname = 'null';
  aiAnswer.decisions[0].commentIds = ['C0'];
  aiAnswer.decisions[0].unitPrice = '18000'; // string price test
  const parsed = await parse(aiAnswer, input);
  assert.equal(parsed.decisions[0].nickname, '키티', 'string "null" is auto-recovered to the cited comment nickname "키티"');
  assert.equal(parsed.decisions[0].unitPrice, 18000, 'string price is parsed to integer');
  assert.equal(parsed.decisions[0].status, 'CONFIRMED');
});

test('demotes to REVIEW when AI returns string "null" and nickname cannot be identified without throwing INVALID error', async () => {
  const base = payload();
  base.comments = [
    { id: 'c1', sessionId: 'deep-contract', nickname: '키티', content: '저요 1번', capturedAt: at(3) },
    { id: 'c2', sessionId: 'deep-contract', nickname: '루비', content: '저요 1번', capturedAt: at(4) },
  ];
  base.segment.commentIds = ['c1', 'c2'];
  const input = normalizeSellerLogicDeepInput(base);
  const aiAnswer = answer();
  // AI cites multiple buyers comments with string "null"
  aiAnswer.decisions[0].nickname = 'null';
  aiAnswer.decisions[0].commentIds = ['C0', 'C1'];
  const parsed = await parse(aiAnswer, input);
  assert.equal(parsed.decisions[0].nickname, null);
  assert.equal(parsed.decisions[0].status, 'REVIEW', 'safely demotes to REVIEW instead of halting analysis with 502');
  assert.ok(parsed.decisions[0].reason.includes('구매자 닉네임'));
});

test('handles decision with string "null" or arbitrary id as new decision without throwing "이전에 없던 거래" error', async () => {
  const input = normalizeSellerLogicDeepInput(payload());
  const aiAnswer = answer();
  // AI sets decision id to string "null"
  aiAnswer.decisions[0].id = 'null';
  const parsed = await parse(aiAnswer, input);
  assert.ok(parsed.decisions[0].id.startsWith('sld:'), 'derived new sld: id for new decision');

  // AI sets decision id to arbitrary string like 'new'
  const aiAnswer2 = answer();
  aiAnswer2.decisions[0].id = 'new';
  const parsed2 = await parse(aiAnswer2, input);
  assert.ok(parsed2.decisions[0].id.startsWith('sld:'), 'derived new sld: id for arbitrary id');
});

test('pure acknowledgment comment (e.g. 네) without seller allocation speech is filtered out from decisions', async () => {
  const base = payload();
  base.comments = [
    { id: 'c_woong_1', sessionId: 'deep-contract', nickname: '웅이맘', content: '네', capturedAt: at(6) },
  ];
  base.transcripts = [
    { id: 's_woong_1', text: '이거 마지막 한 장 남았어.', recognizedAt: at(3), isFinal: true },
    { id: 's_woong_2', text: '어, 오케이. 이거 마지막 한 장. 얼른 가져가세요, 언니.', recognizedAt: at(15), isFinal: true },
  ];
  base.segment = {
    id: 'dseg:0:woong', index: 0,
    startedAt: at(0), endedAt: at(30), closed: true,
    commentIds: ['c_woong_1'],
    transcriptIds: ['s_woong_1', 's_woong_2'],
  };
  const input = normalizeSellerLogicDeepInput(base);
  const erroneousAiAnswer = answer();
  // AI erroneously created PENDING decision on "네"
  erroneousAiAnswer.decisions = [{
    id: null,
    status: 'PENDING',
    nickname: '웅이맘',
    unitPrice: 24000,
    quantity: 1,
    reason: "고객 '웅이맘'의 구매 의사(C0)가 있었으나 배정 멘트가 없어 PENDING으로 보류함",
    commentIds: ['C0'],
    transcriptIds: ['S0', 'S1'],
  }];

  const parsed = await parse(erroneousAiAnswer, input);
  assert.equal(parsed.decisions.length, 0, 'pure "네" without seller allocation speech must be excluded from decisions');
});

test('pure acknowledgment comment (e.g. 네) WITH seller allocation speech (e.g. 웅이맘 언니 드릴게요 / 캡처) is confirmed', async () => {
  const base = payload();
  base.comments = [
    { id: 'c_woong_1', sessionId: 'deep-contract', nickname: '웅이맘', content: '네', capturedAt: at(6) },
  ];
  base.transcripts = [
    { id: 's_woong_1', text: '이거 마지막 한 장 남았어.', recognizedAt: at(3), isFinal: true },
    { id: 's_woong_2', text: '웅이맘 언니 드릴게요. 캡처하세요!', recognizedAt: at(15), isFinal: true },
  ];
  base.segment = {
    id: 'dseg:0:woong_confirm', index: 0,
    startedAt: at(0), endedAt: at(30), closed: true,
    commentIds: ['c_woong_1'],
    transcriptIds: ['s_woong_1', 's_woong_2'],
  };
  const input = normalizeSellerLogicDeepInput(base);
  const aiAnswer = answer();
  aiAnswer.decisions = [{
    id: null,
    status: 'CONFIRMED',
    nickname: '웅이맘',
    unitPrice: 24000,
    quantity: 1,
    reason: "고객 '웅이맘'의 구매 의사(C0)와 판매자의 배정 확정 및 캡처 지시(S1)로 확정",
    commentIds: ['C0'],
    transcriptIds: ['S0', 'S1'],
  }];

  const parsed = await parse(aiAnswer, input);
  assert.equal(parsed.decisions.length, 1);
  assert.equal(parsed.decisions[0].status, 'CONFIRMED');
  assert.equal(parsed.decisions[0].nickname, '웅이맘');
});

test('auto-merges duplicate decision to existing prior ID when AI returns id null on next segment', async () => {
  const base = payload();
  base.comments = [
    { id: 'c_woong_1', sessionId: 'deep-contract', nickname: '웅이맘', content: '저요', capturedAt: at(6) },
  ];
  base.transcripts = [
    { id: 's_woong_1', text: '웅이맘한테 얘기 캡처!', recognizedAt: at(19), isFinal: true },
    { id: 's_woong_2', text: '우리가 24,000원에 2개가 가는 거야.', recognizedAt: at(34), isFinal: true },
  ];
  const priorDecision = {
    id: 'sld:prior-woong-1',
    status: 'CONFIRMED',
    nickname: '웅이맘',
    unitPrice: 24000,
    quantity: 1,
    reason: '고객 웅이맘 구매 의사 및 배정 확정',
    commentIds: ['c_woong_1'],
    transcriptIds: ['s_woong_1'],
    decidedAt: at(19),
  };
  base.previousDecisions = [priorDecision];
  base.segment = {
    id: 'dseg:1:woong', index: 1,
    startedAt: at(20), endedAt: at(40), closed: true,
    commentIds: ['c_woong_1'],
    transcriptIds: ['s_woong_1', 's_woong_2'],
  };

  const input = normalizeSellerLogicDeepInput(base);
  const aiAnswer = answer();
  // AI returned id: null instead of 'D0', but it is the same buyer and comment C0
  aiAnswer.decisions = [{
    id: null,
    status: 'CONFIRMED',
    nickname: '웅이맘',
    unitPrice: 24000,
    quantity: 1,
    reason: '고객 웅이맘 구매 의사 및 배정 확정',
    commentIds: ['C0'],
    transcriptIds: ['S0', 'S1'],
  }];

  const parsed = await parse(aiAnswer, input);
  assert.equal(parsed.decisions.length, 1);
  assert.equal(parsed.decisions[0].id, priorDecision.id, 'auto-mapped to prior ID instead of creating duplicate');
  assert.deepEqual(parsed.decisions[0].transcriptIds.sort(), ['s_woong_1', 's_woong_2'].sort(), 'merged all transcripts');
});

test('a new purchase is not rewritten to a prior ID just because the buyer or order code matches', async () => {
  for (const fields of [{}, { orderCode: '1' }, { productName: '티셔츠' }]) {
    const base = payload();
    base.comments[1] = { ...base.comments[1], nickname: 'xou.3z', content: '바지 저요' };
    const prior = {
      id: 'sld:old-purchase', status: 'CONFIRMED', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
      reason: '먼저 구매한 상품', commentIds: ['c1'], transcriptIds: ['s1', 's2'], decidedAt: at(5), ...fields,
    };
    const input = normalizeSellerLogicDeepInput({ ...base, previousDecisions: [prior] });
    const next = answer();
    next.decisions[0] = { ...next.decisions[0], ...fields, commentIds: ['C1'], transcriptIds: ['S2'] };
    const parsed = await parse(next, input);
    assert.notEqual(parsed.decisions[0].id, prior.id, JSON.stringify(fields));
    assert.deepEqual(parsed.decisions[0].commentIds, ['c2']);
    assert.deepEqual(parsed.decisions[0].transcriptIds, ['s3']);
  }
});

test('separate product lines sharing one buyer comment remain separate purchases', async () => {
  const base = payload();
  const prior = {
    id: 'sld:first-line', status: 'CONFIRMED', nickname: 'xou.3z', unitPrice: 18000, quantity: 1,
    reason: '티셔츠 확정', productName: '티셔츠', lineKey: 'shirt', commentIds: ['c1'], transcriptIds: ['s1'], decidedAt: at(3),
  };
  const input = normalizeSellerLogicDeepInput({ ...base, previousDecisions: [prior] });
  const next = answer();
  next.decisions[0] = { ...next.decisions[0], productName: '바지', lineKey: 'pants' };
  const parsed = await parse(next, input);
  assert.notEqual(parsed.decisions[0].id, prior.id);
  assert.equal(parsed.decisions[0].productName, '바지');
});

test('acknowledgments retain explicit allocations with decorated nicknames and split final speech', async () => {
  const cases = [
    { nickname: '도로시💕', speeches: ['도로시 언니 15000원 드릴게요'] },
    { nickname: '루비', speeches: ['루비 언니.', '15000원 드릴게요'] },
    { nickname: '루비', speeches: ['루비 언니', '1.5에 드릴게요'] },
    { nickname: '도로시💕', speeches: ['도로시 언니', '캡처하세요'] },
    { nickname: 'xou.3z', spokenNickname: '엑소', speeches: ['엑소 언니 드릴게요'] },
  ];
  for (const fixture of cases) {
    const base = payload();
    base.comments = [{ ...base.comments[0], nickname: fixture.nickname, content: '네' }];
    base.transcripts = fixture.speeches.map((text, index) => ({ id: `s${index}`, text, recognizedAt: at(5 + index), isFinal: true }));
    base.segment.commentIds = ['c1'];
    base.segment.transcriptIds = base.transcripts.map((row) => row.id);
    const next = answer();
    next.decisions[0] = {
      ...next.decisions[0], nickname: fixture.nickname, spokenNickname: fixture.spokenNickname,
      transcriptIds: base.transcripts.map((_, index) => `S${index}`),
    };
    const parsed = await parse(next, normalizeSellerLogicDeepInput(base));
    assert.equal(parsed.decisions.length, 1, JSON.stringify(fixture));
    assert.equal(parsed.decisions[0].status, 'CONFIRMED');
    assert.equal(parsed.decisions[0].nickname, fixture.nickname);
  }
});

test('acknowledgments do not connect a remote name or another buyer to an allocation', async () => {
  for (const speeches of [
    [{ text: '루비 언니', at: 1 }, { text: '15000원 드릴게요', at: 90 }],
    [{ text: '도로시 언니 15000원 드릴게요', at: 5 }],
    [{ text: '루비 언니 드릴까요?', at: 5 }],
    [{ text: '루비 언니 드릴게요?', at: 5 }],
    [{ text: '루비 언니 안 드릴게요', at: 5 }],
    [{ text: '루비 언니', at: 5 }, { text: '도로시 언니 드릴게요', at: 6 }],
    [{ text: '루비 언니?', at: 5 }, { text: '드릴게요', at: 6 }],
    [{ text: '루비 언니', at: 5 }, { text: '도로시 언니', at: 6, omitCitation: true }, { text: '드릴게요', at: 7 }],
  ]) {
    const base = payload();
    base.comments = [{ ...base.comments[0], nickname: '루비', content: '네' }];
    base.transcripts = speeches.map((row, index) => ({ id: `s${index}`, text: row.text, recognizedAt: at(row.at), isFinal: true }));
    base.segment.commentIds = ['c1'];
    base.segment.transcriptIds = base.transcripts.map((row) => row.id);
    const next = answer();
    next.decisions[0] = { ...next.decisions[0], nickname: '루비', transcriptIds: speeches.flatMap((row, index) => row.omitCitation ? [] : [`S${index}`]) };
    assert.deepEqual((await parse(next, normalizeSellerLogicDeepInput(base))).decisions, []);
  }
});






