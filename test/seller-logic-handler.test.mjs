import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { normalizeSellerLogicInput, prepareSellerLogicWindow, sellerLogicWindowPrompt } from "../src/services/sellerLogicContract.ts";
import { SELLER_LOGIC_LIMITS } from "../src/types/sellerLogicAnalysis.ts";

const bundle = await build({
  entryPoints: ["supabase/functions/sales-api/handlers/sellerLogicAnalysis.ts"], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "seller-logic-fixture", setup(b) {
    b.onResolve({ filter: /_shared\/productSales\.ts$/ }, () => ({ path: "db", namespace: "fixture" }));
    b.onResolve({ filter: /aiOperationalSettings\.ts$/ }, () => ({ path: "settings", namespace: "fixture" }));
    b.onResolve({ filter: /aiAdapters\/index\.ts$/ }, () => ({ path: "ai", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "db"
      ? `export const admin={from:()=>({select:()=>({eq:async()=>({data:[{slot_number:1,secret_value:'SECRET1'},{slot_number:2,secret_value:'SECRET2'}]})})})};export const successResponse=data=>Response.json({ok:true,data});export const errorResponse=(code,message,status=400)=>Response.json({ok:false,error:{code,message}},{status});`
      : path === "settings" ? `export const getOperationalAiSetting=async()=>globalThis.sellerLogicFixture.setting;export const getPrimaryAiSlot=s=>s.primary_slot===2?2:1;`
      : `export const executeAiPrompt=(...args)=>globalThis.sellerLogicFixture.ai(...args);` }));
  } }],
});
const { handleSellerLogicAnalysis, handleSellerLogicSlots } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const auth = { actorType: "USER", role: "ADMIN" };
const input = { sessionId: "s", slotNumber: 2, comments: [{ id: "c", sessionId: "s", nickname: "루비", content: "ㅈㅇ", capturedAt: "2026-10-04T15:01:00Z" }], transcripts: [{ id: "t", text: "루비 언니 2만원 드릴게요", recognizedAt: "2026-10-04T15:01:05Z", isFinal: true }] };
const output = () => ({ summary: "루비 구매 확정", memory: [], retractedPurchaseIntentCommentIds: [], purchaseIntentCommentIds: ["C0"], decisions: [{ id: null, status: "CONFIRMED", nickname: "루비", quantity: 1, unitPrice: 20000, reason: "구매 댓글과 판매자 확정 및 가격 근거", commentIds: ["C0"], transcriptIds: ["S0"] }] });
function fixture() {
  const f = { calls: [], setting: { id: "setting", primary_slot: 1, auto_fallback_enabled: true, slot1: { type: "CLOUD", provider: "OPENAI", model: "slot-one", routingMode: "SERVER_DIRECT" }, slot2: { type: "LOCAL", provider: "LM_STUDIO", model: "slot-two", routingMode: "SERVER_DIRECT" } },
    async ai(prompt, options) { f.calls.push({ prompt, options }); return { content: JSON.stringify(output()) }; } };
  globalThis.sellerLogicFixture = f; return f;
}

test("only authenticated administrator can run seller logic analysis", async () => {
  const f = fixture();
  for (const denied of [{ actorType: "USER", role: "SELLER" }, { actorType: "DEVICE", role: "ADMIN" }]) {
    await assert.rejects(() => handleSellerLogicAnalysis(denied, { input }), (e) => e.status === 403);
    await assert.rejects(() => handleSellerLogicSlots(denied), (e) => e.status === 403);
  }
  assert.equal(f.calls.length, 0);
});

test("requested applied slot owns prompt/credentials and no commerce mutation occurs", async () => {
  const f = fixture();
  const response = await handleSellerLogicAnalysis(auth, { input });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.model, "slot-two");
  assert.equal(body.data.provider, "LM_STUDIO");
  assert.equal(body.data.decisions[0].nickname, "루비");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.secretValue, "SECRET2");
  assert.ok(f.calls[0].options.slotConfig.timeoutSeconds <= 120);
  const timeline = JSON.parse(f.calls[0].prompt.userPrompt).timeline;
  assert.equal(timeline[0][0], "C0");
  assert.equal(timeline[0][3], input.comments[0].content);
});

test("one invalid AI response is repaired on the same selected slot with evidence", async () => {
  const f = fixture();
  f.ai = async (prompt, options) => { f.calls.push({ prompt, options }); return { content: f.calls.length === 1 ? '{"decisions":[]}' : JSON.stringify(output()) }; };
  const body = await (await handleSellerLogicAnalysis(auth, { input })).json();
  assert.equal(body.ok, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.slotConfig.model, "slot-two");
  assert.match(f.calls[1].prompt.userPrompt, /validationError/);
});

test("repair cannot treat its rejected output as a prior transaction or invent D aliases on the first link", async () => {
  const f = fixture();
  const signal = { id: 'slsig:first', summary: '첫 구매 후보', commentIds: ['c'], transcriptIds: ['t'] };
  f.ai = async (prompt, options) => {
    f.calls.push({ prompt, options });
    const raw = output();
    raw.signalLinks = [{ signalId: 'F0', outcome: 'MATCHED', decisionIndexes: [0], previousDecisionIds: [] }];
    if (f.calls.length === 1) raw.decisions[0].id = 'D0';
    return { content: JSON.stringify(raw) };
  };
  const body = await (await handleSellerLogicAnalysis(auth, { input: { ...input, linkSignals: [signal] } })).json();
  assert.equal(body.ok, true);
  assert.equal(f.calls.length, 2);
  const repair = f.calls[1].prompt;
  assert.match(repair.systemPrompt, /previousResponse는 적용되지 않은 잘못된 출력이며 기존 거래 목록이 아닙니다/);
  assert.match(repair.systemPrompt, /기존 거래 ID의 유일한 근거는 originalInput.previousDecisions/);
  assert.match(repair.systemPrompt, /D별칭을 previousResponse에서 가져오거나 만들어 사용하지/);
  const sent = JSON.parse(repair.userPrompt);
  assert.deepEqual(sent.originalInput.previousDecisions, []);
  assert.equal(JSON.parse(sent.previousResponse).decisions[0].id, 'D0');
  assert.notEqual(body.data.decisions[0].id, 'D0');
  assert.equal(body.data.signalLinks[0].decisionIds[0], body.data.decisions[0].id);
});

test("provider failure and rejected output never invoke rules or an unselected fallback", async () => {
  const f = fixture();
  f.ai = async (...args) => { f.calls.push(args); return { content: null, error: "선택 슬롯 시간 초과", errorCode: "TIMEOUT" }; };
  assert.equal((await handleSellerLogicAnalysis(auth, { input })).status, 502);
  assert.equal(f.calls.length, 1);
  f.calls = []; f.ai = async (...args) => { f.calls.push(args); return { content: "{}" }; };
  const bad = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(bad.status, 502);
  assert.equal((await bad.json()).error.code, "INVALID_AI_ANALYSIS");
  assert.equal(f.calls.length, 2);
});

test("invalid request fails before sending private evidence", async () => {
  const f = fixture();
  assert.equal((await handleSellerLogicAnalysis(auth, { input: { ...input, slotNumber: 0 } })).status, 400);
  assert.equal(f.calls.length, 0);
});

test("existing cloud slot with legacy local routing metadata reaches the common adapter", async () => {
  const f = fixture();
  f.setting.slot2 = { type: "CLOUD", provider: "DEEPSEEK", model: "saved-cloud-model", routingMode: "PC_HELPER", location: "SAME_PC" };
  const response = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.slotConfig.model, "saved-cloud-model");
  assert.equal(f.calls[0].options.slotConfig.type, "CLOUD");
  assert.equal(f.calls[0].options.slotConfig.routingMode, "PC_HELPER");
  assert.equal(f.calls[0].options.secretValue, "SECRET2");
});

test("analysis delegates existing local routing unchanged without a screen-specific restriction", async () => {
  const f = fixture();
  f.setting.slot2.routingMode = "PC_HELPER";
  f.ai = async (prompt, options) => { f.calls.push({ prompt, options }); return { content: null, error: "common adapter route result", errorCode: "PROVIDER_ERROR" }; };
  const response = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(response.status, 502);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.slotConfig.routingMode, "PC_HELPER");
  assert.equal((await response.json()).error.message, "common adapter route result");
});

test("slot labels expose only the same applied slot provider/model used for execution", async () => {
  const f = fixture();
  f.setting.version = 4;
  f.setting.applied_version = 3; // A saved historical snapshot later applied as version 4.
  f.setting.primary_slot = 2;
  f.setting.slot1.endpointUrl = "https://private-endpoint.example";
  f.setting.slot1.maskedSecret = "secret-metadata";
  const response = await handleSellerLogicSlots(auth);
  const body = await response.json();
  assert.deepEqual(body.data, {
    appliedVersion: 4, primarySlot: 2,
    slots: [{ slotNumber: 1, provider: "OPENAI", model: "slot-one" }, { slotNumber: 2, provider: "LM_STUDIO", model: "slot-two" }],
  });
  assert.equal(f.calls.length, 0);
  const analysis = await (await handleSellerLogicAnalysis(auth, { input })).json();
  assert.equal(analysis.data.model, body.data.slots[1].model);
  assert.equal(analysis.data.provider, body.data.slots[1].provider);
});

test("slot metadata does not synthesize a separate configuration when settings are missing", async () => {
  const f = fixture(); f.setting = null;
  const response = await handleSellerLogicSlots(auth);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "AI_NOT_CONFIGURED");
});

test("a structurally valid confirmation returns after one call without semantic re-audit", async () => {
  const f = fixture();
  f.ai = async (prompt, options) => {
    f.calls.push({ prompt, options });
    assert.equal(f.calls.length, 1, "a valid result must not trigger a second provider call");
    return { content: JSON.stringify(output()) };
  };
  const body = await (await handleSellerLogicAnalysis(auth, { input })).json();
  assert.equal(body.data.decisions[0].unitPrice, 20000);
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(f.calls[0].prompt.userPrompt, /candidateResponse|previousResponse/);
  assert.equal(f.calls[0].options.slotConfig.model, "slot-two");
});

test("provider context errors retain the exact code and message and never trigger repair", async () => {
  const f = fixture();
  const message = '자체 운영 LLM 호출 실패: 외부 서버 LLM 응답 오류 (HTTP 400): {"error":"Context size has been exceeded."}';
  f.ai = async (prompt, options) => {
    f.calls.push({ prompt, options });
    return { content: null, errorCode: "PROVIDER_ERROR", error: message };
  };
  const response = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(response.status, 502);
  assert.deepEqual((await response.json()).error, { code: "PROVIDER_ERROR", message });
  assert.equal(f.calls.length, 1);
});

test("fully processed input returns its existing state without another provider call", async () => {
  const f = fixture();
  const first = await (await handleSellerLogicAnalysis(auth, { input })).json();
  const calls = f.calls.length;
  const second = await (await handleSellerLogicAnalysis(auth, { input: { ...input, analysisState: first.data.analysisState, previousDecisions: first.data.decisions } })).json();
  assert.equal(f.calls.length, calls);
  assert.equal(second.data.hasMore, false);
  assert.deepEqual(second.data.decisions, first.data.decisions);
});

test("missing purchase evidence receives only a contract repair, which may retract the AI classification", async () => {
  const f = fixture();
  f.ai = async (prompt, options) => {
    f.calls.push({ prompt, options });
    return { content: JSON.stringify({ summary: "질문만 있어 구매 거래 없음", decisions: [], memory: [], retractedPurchaseIntentCommentIds: [], purchaseIntentCommentIds: f.calls.length === 1 ? ["C0"] : [] }) };
  };
  const response = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].prompt.userPrompt, /validationError/);
  assert.doesNotMatch(f.calls[1].prompt.systemPrompt, /독립 검증 단계/);
  assert.deepEqual((await response.json()).data.purchaseIntentCommentIds, []);
});

test("a failed contract repair never triggers a third call or applies partial progress", async () => {
  const f = fixture();
  f.ai = async (prompt, options) => {
    f.calls.push({ prompt, options });
    const answer = output();
    delete answer.memory;
    return { content: JSON.stringify(answer) };
  };
  const response = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(response.status, 502);
  assert.equal(f.calls.length, 2);
  const body = await response.json();
  assert.equal(body.error.code, "INVALID_AI_ANALYSIS");
  assert.equal(body.data, undefined);
});

test("oversized initial model prompt fails explicitly before provider execution", async () => {
  const f = fixture();
  const maximum = SELLER_LOGIC_LIMITS.promptCharacters;
  assert.equal(maximum, 30_000);
  const prompt = sellerLogicWindowPrompt(prepareSellerLogicWindow(normalizeSellerLogicInput(input), 0));
  const baseLength = prompt.systemPrompt.length + prompt.userPrompt.length;
  const large = structuredClone(input);
  large.transcripts[0].text += "가".repeat(maximum - baseLength + 100);
  assert.ok(JSON.stringify(large).length < SELLER_LOGIC_LIMITS.inputCharacters);
  const response = await handleSellerLogicAnalysis(auth, { input: large });
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error.code, "AI_INPUT_LIMIT");
  assert.match(body.error.message, /문자 상한/);
  assert.ok(body.error.message.includes(maximum.toLocaleString("en-US")));
  assert.equal(f.calls.length, 0);
});

test("oversized repair prompt is rejected without a second provider call", async () => {
  const f = fixture();
  const maximum = SELLER_LOGIC_LIMITS.promptCharacters;
  f.ai = async (prompt, options) => { f.calls.push({ prompt, options }); return { content: "x".repeat(maximum) }; };
  const response = await handleSellerLogicAnalysis(auth, { input });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "AI_INPUT_LIMIT");
  assert.equal(f.calls.length, 1);
});

test("AI history requests return after one call without acknowledging new evidence", async () => {
  const f = fixture();
  f.ai = async (prompt, options) => {
    f.calls.push({ prompt, options });
    return { content: JSON.stringify({ historyRequests: ["맨투맨", "루비"] }) };
  };
  const packet = { ...input, incremental: {
    newCommentIds: ["c"], newTranscriptIds: ["t"], historyQueries: [],
    historyExhausted: false, omittedEvents: 100, omittedDecisions: 3,
  } };
  const response = await handleSellerLogicAnalysis(auth, { input: packet });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(body.data.hasMore, true);
  assert.deepEqual(body.data.historyRequests, ["맨투맨", "루비"]);
  assert.deepEqual(body.data.analysisState.processedCommentIds, []);
  assert.deepEqual(body.data.analysisState.processedTranscriptIds, []);
  assert.deepEqual(body.data.decisions, []);
  assert.equal(body.data.model, "slot-two");
});
