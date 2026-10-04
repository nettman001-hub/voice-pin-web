import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSellerLogicInput, parseSellerLogicResult, parseSellerLogicWireResult, sellerLogicPrompt, sellerLogicWireInput, prepareSellerLogicWindow, parseSellerLogicWindowResult, sellerLogicWindowPrompt } from "../src/services/sellerLogicContract.ts";

const input = () => ({
  sessionId: "live", slotNumber: 2,
  comments: [
    { id: "c1", sessionId: "live", nickname: "😚JJEONG😚", content: "6", capturedAt: "2026-10-04T14:58:02Z", platformUserId: "p1" },
    { id: "c2", sessionId: "live", nickname: "😚JJEONG😚", content: "1.8", capturedAt: "2026-10-04T14:58:06Z", platformUserId: "p1" },
    { id: "c3", sessionId: "live", nickname: "😚JJEONG😚", content: "네", capturedAt: "2026-10-04T14:58:10Z", platformUserId: "p1" },
  ],
  transcripts: [
    { id: "t1", text: "이 상품 6번, 2만원", recognizedAt: "2026-10-04T14:58:00Z", isFinal: true },
    { id: "t2", text: "정원이 언니 1.8 안돼요. 2만원에 가져갑시다", recognizedAt: "2026-10-04T14:58:08Z", isFinal: true },
  ],
});
const decision = () => ({
  id: null, status: "CONFIRMED", nickname: "😚JJEONG😚", unitPrice: 20000, quantity: 1,
  reason: "6번 구매 댓글에 정원이 호명을 연결. 1.8 제안 거절 후 판매자 2만원 제안을 동일 구매자가 수락함.",
  commentIds: ["c1", "c2", "c3"], transcriptIds: ["t1", "t2"], spokenNickname: "정원이", orderCode: "6",
});
const result = (d = decision()) => JSON.stringify({ summary: "가격 협상과 호명을 분석했습니다.", purchaseIntentCommentIds: ["c1"], decisions: [d] });

test('window response schema types nullable transaction fields, optional descriptions, evidence, memory and candidate links', () => {
  const evidence = input();
  evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  evidence.linkSignals = [{ id: 'slsig:one', summary: '호명 후속', commentIds: ['c1'], transcriptIds: ['t2'] }];
  const window = prepareSellerLogicWindow(evidence, 7), prompt = sellerLogicWindowPrompt(window);
  const schema = prompt.responseSchema.schema, properties = schema.properties;
  assert.equal(prompt.responseSchema.name, 'seller_logic_analysis');
  assert.equal(prompt.maxOutputTokens, 8192);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['summary', 'decisions', 'purchaseIntentCommentIds', 'retractedPurchaseIntentCommentIds', 'memory', 'signalLinks']);
  const item = properties.decisions.items, d = item.properties;
  assert.deepEqual(d.id.enum, [null, 'D0']);
  assert.deepEqual(d.status.enum, ['CONFIRMED', 'PENDING', 'REVIEW', 'CANCELLED']);
  assert.deepEqual(d.nickname.enum, [null, '😚JJEONG😚']);
  assert.deepEqual(d.unitPrice, { type: ['integer', 'null'], minimum: 1, maximum: 99_999_999 });
  assert.deepEqual(d.quantity, { type: 'integer', minimum: 1, maximum: 99 });
  assert.equal(d.reason.maxLength, 4000);
  for (const key of ['productName', 'orderCode', 'spokenNickname', 'lineKey']) {
    assert.ok(!item.required.includes(key));
    assert.deepEqual(d[key], { type: ['string', 'null'], maxLength: 500 });
  }
  assert.deepEqual(d.commentIds.items.enum, ['C0', 'C1', 'C2']);
  assert.deepEqual(d.transcriptIds.items.enum, ['S0', 'S1']);
  assert.equal(d.commentIds.uniqueItems, true);
  assert.deepEqual(properties.memory.items.required, ['text', 'commentIds', 'transcriptIds']);
  assert.equal(properties.memory.items.properties.text.maxLength, 3000);
  const links = properties.signalLinks;
  assert.equal(links.minItems, 1); assert.equal(links.maxItems, 1);
  assert.deepEqual(links.items.properties.signalId.enum, ['F0']);
  assert.deepEqual(links.items.properties.outcome.enum, ['MATCHED', 'UNMATCHED', 'NOT_SALE']);
  assert.deepEqual(links.items.properties.previousDecisionIds.items.enum, ['D0']);
  assert.equal(links.items.properties.decisionIndexes.items.minimum, 0);
  assert.equal(d.decidedAt, undefined, 'the source clock stays server-owned');
  const raw = { summary: '유지', decisions: [], purchaseIntentCommentIds: [], retractedPurchaseIntentCommentIds: [], memory: [],
    signalLinks: [{ signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [], previousDecisionIds: ['D0'] }] };
  assert.equal(parseSellerLogicWindowResult(JSON.stringify(raw), window).decisions[0].id, evidence.previousDecisions[0].id);
});

test('history-only output is a separate schema branch only before lookup exhaustion or partial link continuation', () => {
  const evidence = input();
  evidence.incremental = { newCommentIds: ['c1', 'c2', 'c3'], newTranscriptIds: ['t1', 't2'],
    historyQueries: [], historyExhausted: false, omittedEvents: 10, omittedDecisions: 1 };
  const window = prepareSellerLogicWindow(evidence, 7), schema = sellerLogicWindowPrompt(window).responseSchema.schema;
  assert.equal(schema.type, 'object');
  assert.equal(schema.anyOf.length, 2);
  const [analysis, history] = schema.anyOf;
  assert.ok(analysis.required.includes('decisions'));
  assert.deepEqual(history.required, ['historyRequests']);
  assert.deepEqual(history.properties.historyRequests, { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 80 } });
  assert.equal(history.additionalProperties, false);
  assert.deepEqual(parseSellerLogicWindowResult('{"historyRequests":["이전 니트"]}', window).historyRequests, ['이전 니트']);
  evidence.incremental.historyExhausted = true;
  const exhausted = sellerLogicWindowPrompt(prepareSellerLogicWindow(evidence, 7)).responseSchema.schema;
  assert.equal(exhausted.anyOf, undefined);
  assert.equal(exhausted.properties.historyRequests, undefined);
  evidence.incremental.historyExhausted = false;
  evidence.linkWindow = { hasMore: true };
  const continuation = sellerLogicWindowPrompt(prepareSellerLogicWindow(evidence, 7)).responseSchema.schema;
  assert.equal(continuation.anyOf, undefined);
});

test('seller-only review schema permits actual JSON null and omitted or empty optional descriptions', () => {
  const evidence = input(); evidence.comments = [];
  const window = prepareSellerLogicWindow(evidence, 7), schema = sellerLogicWindowPrompt(window).responseSchema.schema;
  const properties = schema.properties.decisions.items.properties;
  assert.deepEqual(properties.nickname.enum, [null]);
  assert.equal(properties.commentIds.maxItems, 0);
  assert.equal(properties.commentIds.items.enum, undefined);
  for (const optional of [{}, { productName: null, orderCode: '', spokenNickname: '정원이', lineKey: null }]) {
    const raw = { summary: '계정 미식별', decisions: [{ id: null, status: 'REVIEW', nickname: null, unitPrice: null, quantity: 1,
      reason: '판매자가 호명했으나 댓글 계정 근거가 없음', commentIds: [], transcriptIds: ['S1'], ...optional }],
      purchaseIntentCommentIds: [], retractedPurchaseIntentCommentIds: [], memory: [] };
    assert.equal(parseSellerLogicWindowResult(JSON.stringify(raw), window).decisions[0].nickname, null);
  }
});

test('first-link prompts forbid invented prior aliases and only show a prior-link example when an actual prior decision exists', () => {
  const evidence = input();
  evidence.linkSignals = [{ id: 'slsig:one', summary: '처음 구매 후보', commentIds: ['c1'], transcriptIds: ['t2'] }];
  for (const hasMore of [false, true]) {
    evidence.linkWindow = { hasMore };
    const prompt = sellerLogicWindowPrompt(prepareSellerLogicWindow(evidence, 7));
    assert.deepEqual(JSON.parse(prompt.userPrompt).previousDecisions, []);
    assert.match(prompt.systemPrompt, /이전 거래가 없으므로 모든 신규 decisions.id는 null/);
    assert.match(prompt.systemPrompt, /모든 signalLinks.previousDecisionIds는 \[\]/);
    assert.match(prompt.systemPrompt, /D별칭 사용은 금지/);
    assert.doesNotMatch(prompt.systemPrompt, /기존 D0 거래에 연결|"previousDecisionIds":\["D0"\]/);
  }
  evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  const prompt = sellerLogicWindowPrompt(prepareSellerLogicWindow(evidence, 7));
  const actualAlias = JSON.parse(prompt.userPrompt).previousDecisions[0].id;
  assert.match(prompt.systemPrompt, new RegExp(`실제로 제공된 기존 ${actualAlias} 거래`));
  assert.ok(prompt.systemPrompt.includes(JSON.stringify({ signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [], previousDecisionIds: [actualAlias] })));
  assert.doesNotMatch(prompt.systemPrompt, /이전 거래가 없으므로/);
});

test("entire evidence goes to AI without keyword, price or nickname preclassification", () => {
  const evidence = normalizeSellerLogicInput(input());
  const prompt = sellerLogicPrompt(evidence);
  const sent = JSON.parse(prompt.userPrompt);
  assert.equal(sent.timeline.length, evidence.comments.length + evidence.transcripts.length);
  for (const [alias, seconds, nickname, content, identity] of sent.timeline.filter((e) => e[0].startsWith("C"))) {
    const original = evidence.comments[Number(alias.slice(1))];
    assert.equal(content, original.content);
    assert.equal(nickname, original.nickname);
    assert.equal(Date.parse(sent.baseTime) + seconds * 1000, Date.parse(original.capturedAt));
    assert.equal(identity.platformUserId, original.platformUserId);
  }
  for (const [alias, seconds, text, isFinal] of sent.timeline.filter((e) => e[0].startsWith("S"))) {
    const original = evidence.transcripts[Number(alias.slice(1))];
    assert.equal(text, original.text);
    assert.equal(Date.parse(sent.baseTime) + seconds * 1000, Date.parse(original.recognizedAt));
    assert.equal(isFinal, original.isFinal);
  }
  assert.deepEqual(sent.timeline.map((e) => e[1]), [...sent.timeline.map((e) => e[1])].sort((a,b)=>a-b));
  assert.equal(prompt.maxOutputTokens, 8192);
  assert.match(prompt.systemPrompt, /모든 의미 판단을 직접/);
  assert.match(prompt.systemPrompt, /숫자 1\/6/);
  assert.match(prompt.systemPrompt, /거절된 제안과 최종 합의 가격/);
  assert.match(prompt.systemPrompt, /정확한 계정 이름은 댓글 nickname/);
  assert.match(prompt.systemPrompt, /previousDecisions에 있던 거래를 하나도 생략하지/);
});

test("compact aliases restore every source ID and prior decision identity without trusting invented aliases", () => {
  const evidence = input();
  evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  const wire = sellerLogicWireInput(evidence);
  assert.equal(wire.previousDecisions[0].id, "D0");
  assert.deepEqual(wire.previousDecisions[0].commentIds, ["C0", "C1", "C2"]);
  const answer = { summary: "유지", purchaseIntentCommentIds: ["C0"], decisions: [{ ...decision(), id: "D0", commentIds: ["C0", "C1", "C2"], transcriptIds: ["S0", "S1"] }] };
  const decoded = parseSellerLogicWireResult(JSON.stringify(answer), evidence);
  assert.deepEqual(decoded.decisions[0].commentIds, ["c1", "c2", "c3"]);
  assert.deepEqual(decoded.decisions[0].transcriptIds, ["t1", "t2"]);
  assert.equal(decoded.decisions[0].id, evidence.previousDecisions[0].id);
  answer.decisions[0].commentIds = ["C999"];
  assert.throws(() => parseSellerLogicWireResult(JSON.stringify(answer), evidence), /별칭/);
});

test("preserves exact emoji nickname and AI price; assigns stable evidence identity and time", () => {
  const evidence = normalizeSellerLogicInput(input());
  const a = parseSellerLogicResult(result(), evidence);
  const b = parseSellerLogicResult(result(), evidence);
  assert.equal(a.decisions[0].nickname, "😚JJEONG😚");
  assert.equal(a.decisions[0].unitPrice, 20000);
  assert.equal(a.decisions[0].decidedAt, "2026-10-04T14:58:10.000Z");
  assert.equal(a.decisions[0].id, b.decisions[0].id);
  assert.ok(a.decisions[0].id.startsWith("sla:"));
});

test("contract guards do not reinterpret arbitrary AI-classified expressions", () => {
  const evidence = input();
  evidence.comments[0].content = "판매자님 방금 말한 방식대로 파랑새!";
  assert.equal(parseSellerLogicResult(result(), evidence).purchaseIntentCommentIds[0], "c1");
});

test("AI-classified purchase requests remain visible even when the AI cannot confirm a sale", () => {
  const raw = JSON.parse(result());
  raw.decisions = [];
  assert.throws(() => parseSellerLogicResult(JSON.stringify(raw), input()), /구매 의사로 분류한 댓글의 거래 판단이 누락/);
  raw.decisions = [{ ...decision(), status: "PENDING", unitPrice: null, transcriptIds: [] }];
  assert.equal(parseSellerLogicResult(JSON.stringify(raw), input()).decisions[0].status, "PENDING");
});

test("rejects fabricated source references and STT-as-account nickname", () => {
  const evidence = input();
  for (const d of [
    { ...decision(), commentIds: ["made-up"] },
    { ...decision(), transcriptIds: ["made-up"] },
    { ...decision(), nickname: "정원이" },
    { ...decision(), id: "invented-id" },
  ]) assert.throws(() => parseSellerLogicResult(result(d), evidence));
  const raw = JSON.parse(result());
  raw.purchaseIntentCommentIds = ["made-up"];
  assert.throws(() => parseSellerLogicResult(JSON.stringify(raw), evidence), /purchaseIntentCommentIds/);
});

test("requires complete buyer price and final speech evidence before CONFIRMED", () => {
  for (const d of [
    { ...decision(), nickname: null }, { ...decision(), unitPrice: null },
    { ...decision(), transcriptIds: [] }, { ...decision(), unitPrice: 1.8 },
    { ...decision(), quantity: 0 },
  ]) assert.throws(() => parseSellerLogicResult(result(d), input()));
  const evidence = input();
  evidence.transcripts.forEach((t) => t.isFinal = false);
  assert.throws(() => parseSellerLogicResult(result(), evidence), /CONFIRMED/);
  assert.equal(parseSellerLogicResult(result({ ...decision(), status: "REVIEW", nickname: null, unitPrice: null }), evidence).decisions[0].status, "REVIEW");
});

test("revision retains transaction identity while adding later evidence and updating status", () => {
  const evidence = input();
  const pending = parseSellerLogicResult(result({ ...decision(), status: "PENDING", unitPrice: null, commentIds: ["c1"], transcriptIds: [] }), evidence).decisions[0];
  evidence.previousDecisions = [pending];
  const confirmed = parseSellerLogicResult(result({ ...decision(), id: pending.id }), evidence).decisions[0];
  assert.equal(confirmed.id, pending.id);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.unitPrice, 20000);
  evidence.previousDecisions = [confirmed];
  const cancelled = parseSellerLogicResult(result({ ...decision(), id: confirmed.id, status: "CANCELLED", reason: "후속 대화에서 취소했습니다." }), evidence).decisions[0];
  assert.equal(cancelled.id, confirmed.id);
  assert.equal(cancelled.status, "CANCELLED");
});

test("incomplete snapshots and duplicate allocations cannot silently remove or double-count transactions", () => {
  const evidence = input();
  evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  assert.throws(() => parseSellerLogicResult(JSON.stringify({ summary: "없음", decisions: [], purchaseIntentCommentIds: [] }), evidence), /누락/);
  const raw = JSON.parse(result()); raw.decisions.push(decision());
  assert.throws(() => parseSellerLogicResult(JSON.stringify(raw), input()), /중복/);
});

test("AI can split one comment and one allocation into distinct product lines with stable IDs", () => {
  const evidence = input();
  evidence.comments[0].content = "니트 베이지랑 검정 둘 다 저요";
  evidence.transcripts[1].text = "정원이 언니 니트 베이지 2만원 검정 1만8천원 드릴게요";
  const raw = JSON.parse(result());
  raw.decisions = [
    { ...decision(), productName: "니트", lineKey: "니트-베이지", unitPrice: 20000 },
    { ...decision(), productName: "니트", lineKey: "니트-검정", unitPrice: 18000 },
  ];
  const first = parseSellerLogicResult(JSON.stringify(raw), evidence);
  assert.equal(first.decisions.length, 2);
  assert.notEqual(first.decisions[0].id, first.decisions[1].id);
  evidence.previousDecisions = first.decisions;
  raw.decisions = first.decisions.map((d, i) => ({ ...d, unitPrice: i ? 17000 : d.unitPrice }));
  const updated = parseSellerLogicResult(JSON.stringify(raw), evidence);
  assert.deepEqual(updated.decisions.map((d) => d.id), first.decisions.map((d) => d.id));
  assert.equal(updated.decisions[1].unitPrice, 17000);
});

test("same nickname from distinct cited platform accounts requires review; identifier namespaces stay separate", () => {
  const evidence = input();
  evidence.comments[1].platformUserId = "p2";
  assert.throws(() => parseSellerLogicResult(result(), evidence), /서로 다른 계정/);
  assert.equal(parseSellerLogicResult(result({ ...decision(), status: "REVIEW" }), evidence).decisions[0].status, "REVIEW");
  evidence.comments[1].platformUserId = "p1";
  evidence.comments[1].buyerId = "internal-buyer-uuid";
  evidence.comments[2].uniqueId = "platform-handle";
  assert.equal(parseSellerLogicResult(result(), evidence).decisions[0].status, "CONFIRMED");
});

test("input rejects wrong session, duplicate IDs, invalid time and explicit overflow instead of truncation", () => {
  const badSession = input(); badSession.comments[0].sessionId = "other";
  const duplicate = input(); duplicate.comments.push(duplicate.comments[0]);
  const badTime = input(); badTime.transcripts[0].recognizedAt = "yesterday";
  const overflow = input(); overflow.comments = Array.from({ length: 2001 }, (_, i) => ({ ...overflow.comments[0], id: `c${i}` }));
  const size = input(); size.transcripts[0].text = "가".repeat(500_001);
  for (const raw of [badSession, duplicate, badTime, overflow, size, { ...input(), slotNumber: 3 }]) {
    assert.throws(() => normalizeSellerLogicInput(raw));
  }
  const many = input(); many.transcripts = Array.from({ length: 2000 }, (_, i) => ({ ...many.transcripts[0], id: `t${i}` }));
  assert.equal(normalizeSellerLogicInput(many).transcripts.length, 2000);
});

const emptyWindowAnswer = () => ({ summary: "이번 구간에는 구매 판단이 없습니다.", decisions: [], purchaseIntentCommentIds: [], retractedPurchaseIntentCommentIds: [], memory: [] });
function longEvidence() {
  return { sessionId: "live", slotNumber: 2, comments: [], transcripts: Array.from({ length: 131 }, (_, i) => ({
    id: `s${i}`, text: `원문 ${i}`, recognizedAt: new Date(Date.UTC(2026, 9, 4, 12, 0, i)).toISOString(), isFinal: true,
  })) };
}

test("chronological windows process every source once, preserve overlap, and compute progress on the server", () => {
  const evidence = longEvidence();
  const seen = [];
  for (const expected of [30, 30, 30, 30, 11]) {
    const window = prepareSellerLogicWindow(evidence, 33);
    assert.equal(window.newTranscriptIds.length, expected);
    seen.push(...window.newTranscriptIds);
    if (evidence.analysisState) assert.equal(window.evidence.transcripts.length, expected + 20);
    const response = parseSellerLogicWindowResult(JSON.stringify({ ...emptyWindowAnswer(), hasMore: false, processedTranscriptIds: [] }), window);
    assert.equal(response.hasMore, seen.length < 131);
    evidence.analysisState = response.analysisState;
    evidence.previousDecisions = response.decisions;
  }
  assert.equal(new Set(seen).size, 131);
  assert.deepEqual(evidence.analysisState.processedTranscriptIds, evidence.transcripts.map((t) => t.id));
  assert.equal(prepareSellerLogicWindow(evidence, 33).newTranscriptIds.length, 0);
});

test("late older sources use ID progress and local historical overlap; slot/version changes restart processing", () => {
  const evidence = longEvidence();
  evidence.analysisState = { slotNumber: 2, appliedVersion: 33, processedCommentIds: [], processedTranscriptIds: evidence.transcripts.map((t) => t.id), memory: [], purchaseIntentCommentIds: [] };
  evidence.transcripts.push({ id: "late", text: "늦게 온 과거 멘트", recognizedAt: "2026-10-04T12:00:30.500Z", isFinal: true });
  const window = prepareSellerLogicWindow(evidence, 33);
  assert.deepEqual(window.newTranscriptIds, ["late"]);
  assert.ok(window.evidence.transcripts.some((t) => t.id === "s30"));
  assert.ok(!window.evidence.transcripts.some((t) => t.id === "s130"));
  assert.equal(prepareSellerLogicWindow(evidence, 34).newTranscriptIds.length, 30);
  evidence.slotNumber = 1;
  assert.equal(prepareSellerLogicWindow(evidence, 33).state.processedTranscriptIds.length, 0);
});

test('stage-two signal aliases map the AI-selected decision positions to stable transaction IDs', () => {
  const evidence = input();
  evidence.linkSignals = [{ id: 'slsig:one', summary: '니트 구매 협상', commentIds: ['c1'], transcriptIds: ['t2'] }];
  evidence.incremental = { newCommentIds: ['c1', 'c2', 'c3'], newTranscriptIds: ['t1', 't2'], historyQueries: [], historyExhausted: false, omittedEvents: 0, omittedDecisions: 0 };
  const window = prepareSellerLogicWindow(normalizeSellerLogicInput(evidence), 33);
  const sent = JSON.parse(sellerLogicWindowPrompt(window).userPrompt);
  assert.equal(sent.signals[0].id, 'F0');
  const answer = { summary: '확정', purchaseIntentCommentIds: ['C0'], decisions: [{ ...decision(), commentIds: ['C0', 'C1', 'C2'], transcriptIds: ['S0', 'S1'] }],
    memory: [], retractedPurchaseIntentCommentIds: [], signalLinks: [{ signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [0], previousDecisionIds: [] }] };
  const parsed = parseSellerLogicWindowResult(JSON.stringify(answer), window);
  assert.deepEqual(parsed.signalLinks, [{ signalId: 'slsig:one', outcome: 'MATCHED', decisionIds: [parsed.decisions[0].id] }]);
  for (const invalidLink of [
    { signalId: 'F9', outcome: 'MATCHED', decisionIndexes: [0] },
    { signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [1] },
    { signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [] },
    { signalId: 'F0', outcome: 'UNMATCHED', decisionIndexes: [0] },
  ]) assert.throws(() => parseSellerLogicWindowResult(JSON.stringify({ ...answer, signalLinks: [invalidLink] }), window));
  assert.throws(() => parseSellerLogicWindowResult(JSON.stringify({ ...answer, signalLinks: [] }), window), /signalLinks/);
});

test('an unchanged existing transaction can be linked by its prior alias without reinserting it', () => {
  const evidence = input(); evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  evidence.linkSignals = [{ id: 'slsig:one', summary: '확정 후 확인', commentIds: ['c1'], transcriptIds: ['t2'] }];
  const window = prepareSellerLogicWindow(evidence, 33);
  const parsed = parseSellerLogicWindowResult(JSON.stringify({ summary: '유지', decisions: [], purchaseIntentCommentIds: [], memory: [],
    signalLinks: [{ signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [], previousDecisionIds: ['D0'] }] }), window);
  assert.equal(parsed.decisions.length, 1); assert.equal(parsed.signalLinks[0].decisionIds[0], evidence.previousDecisions[0].id);
});

test('STT stable text and speech-boundary metadata remain separate throughout the analysis wire', () => {
  const evidence = input(); Object.assign(evidence.transcripts[0], { startedAt: evidence.transcripts[0].recognizedAt, endedAt: '2026-10-04T14:58:01Z',
    receivedAt: '2026-10-04T14:58:04Z', utteranceId: 'ongoing', utteranceEnded: false, revision: 2, endReason: 'flush' });
  const normalized = normalizeSellerLogicInput(evidence);
  assert.equal(normalized.transcripts[0].revision, 2); assert.equal(normalized.transcripts[0].utteranceEnded, false);
  const wire = sellerLogicWireInput(normalized).timeline.find((row) => row[0] === 'S0');
  assert.equal(wire[3], true); assert.equal(wire[4].utteranceEnded, false); assert.equal(wire[4].endReason, 'flush');
});

test("AI memory cites old raw evidence and omitted prior transactions survive delta responses", () => {
  const evidence = input();
  evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  evidence.analysisState = { slotNumber: 2, appliedVersion: 33, processedCommentIds: evidence.comments.map((c) => c.id), processedTranscriptIds: evidence.transcripts.map((t) => t.id), memory: [{ text: "이전 상품은 6번", commentIds: [], transcriptIds: ["t1"] }], purchaseIntentCommentIds: ["c1"] };
  evidence.transcripts.push({ id: "new", text: "다음 상품", recognizedAt: "2026-10-04T15:10:00Z", isFinal: true });
  const window = prepareSellerLogicWindow(evidence, 33);
  const wire = JSON.parse(sellerLogicWindowPrompt(window).userPrompt);
  assert.equal(wire.memory[0].transcriptIds[0], "S0");
  assert.ok(wire.timeline.some((row) => row[0] === "S0" && row[2] === evidence.transcripts[0].text));
  const response = parseSellerLogicWindowResult(JSON.stringify({ ...emptyWindowAnswer(), memory: [{ text: "6번 상품 안내", commentIds: [], transcriptIds: ["S0"] }] }), window);
  assert.deepEqual(response.decisions, evidence.previousDecisions);
  assert.deepEqual(response.purchaseIntentCommentIds, ["c1"]);
  assert.deepEqual(response.analysisState.memory[0].transcriptIds, ["t1"]);
  assert.ok(response.analysisState.processedTranscriptIds.includes("new"));
});

test("late seller fragment can use an already processed following buyer acceptance", () => {
  const evidence = { sessionId: "live", slotNumber: 2,
    comments: [{ id: "accept", sessionId: "live", nickname: "루비", content: "네", capturedAt: "2026-10-04T12:00:02Z" }],
    transcripts: [{ id: "late-offer", text: "루비 언니 이만원에 드릴까요", recognizedAt: "2026-10-04T12:00:01Z", isFinal: true }],
    analysisState: { processedCommentIds: ["accept"], processedTranscriptIds: [], memory: [], purchaseIntentCommentIds: [], slotNumber: 2, appliedVersion: 33 },
  };
  const window = prepareSellerLogicWindow(evidence, 33);
  assert.deepEqual(window.newTranscriptIds, ["late-offer"]);
  assert.equal(window.evidence.comments[0].id, "accept");
});

test("window contract rejects fabricated memory and incomplete AI output without advancing input progress", () => {
  const evidence = input();
  const window = prepareSellerLogicWindow(evidence, 33);
  const before = structuredClone(window.state);
  for (const answer of [
    { ...emptyWindowAnswer(), memory: [{ text: "없는 상품", commentIds: [], transcriptIds: ["S999"] }] },
    { ...emptyWindowAnswer(), purchaseIntentCommentIds: ["C0"] },
    { ...emptyWindowAnswer(), memory: undefined },
  ]) assert.throws(() => parseSellerLogicWindowResult(JSON.stringify(answer), window));
  assert.deepEqual(window.state, before);
});

test("AI can explicitly retract a past purchase classification and cancel its transaction", () => {
  const evidence = input();
  evidence.previousDecisions = parseSellerLogicResult(result(), evidence).decisions;
  evidence.analysisState = { slotNumber: 2, appliedVersion: 33, processedCommentIds: [], processedTranscriptIds: [], memory: [], purchaseIntentCommentIds: ["c1"] };
  const window = prepareSellerLogicWindow(evidence, 33);
  const answer = { ...emptyWindowAnswer(), retractedPurchaseIntentCommentIds: ["C0"], decisions: [{ ...decision(), id: "D0", status: "CANCELLED", commentIds: ["C0", "C1", "C2"], transcriptIds: ["S0", "S1"], reason: "이전 구매 의사 오판을 정정" }] };
  const response = parseSellerLogicWindowResult(JSON.stringify(answer), window);
  assert.equal(response.decisions[0].id, evidence.previousDecisions[0].id);
  assert.equal(response.decisions[0].status, "CANCELLED");
  assert.deepEqual(response.purchaseIntentCommentIds, []);
  assert.deepEqual(response.analysisState.purchaseIntentCommentIds, []);
});
