import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { OpusJudgeLoop } from "../src/services/logicOpus/opusJudgeLoop.ts";

const bundle = await build({
  entryPoints: ["supabase/functions/sales-api/handlers/logicOpus.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "logic-opus-fixture",
    setup(b) {
      b.onResolve({ filter: /_shared\/productSales\.ts$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onResolve({ filter: /aiOperationalSettings\.ts$/ }, () => ({ path: "settings", namespace: "fixture" }));
      b.onResolve({ filter: /aiAdapters\/index\.ts$/ }, () => ({ path: "ai", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "db"
          ? `export const admin={from:(...a)=>globalThis.opusFixture.from(...a)};
             export const successResponse=data=>new Response(JSON.stringify({ok:true,data}));`
          : args.path === "settings"
          ? `export const getOperationalAiSetting=async()=>globalThis.opusFixture.setting;`
          : `export const executeAiPrompt=(...a)=>globalThis.opusFixture.ai(...a);`,
      }));
    },
  }],
});
const { handleLogicOpus } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const RUN = "11111111-1111-4111-8111-111111111111";
const admin = { actorType: "USER", role: "ADMIN", actorId: "22222222-2222-4222-8222-222222222222" };

function fixture(aiReplies) {
  const calls = [];
  const writes = [];
  globalThis.opusFixture = {
    setting: {
      id: "setting-1",
      primary_slot: 1,
      auto_fallback_enabled: true,
      slot1: { type: "CLOUD", provider: "DEEPSEEK", model: "deepseek-chat", authType: "API_KEY", routingMode: "SERVER_DIRECT" },
      slot2: { type: "CLOUD", provider: "OPENAI", model: "gpt-x", authType: "API_KEY", routingMode: "SERVER_DIRECT" },
    },
    ai: async (prompt, options) => {
      calls.push({ prompt, model: options.slotConfig.model, timeout: options.slotConfig.timeoutSeconds, secret: options.secretValue });
      const reply = aiReplies.shift();
      return typeof reply === "string" ? { content: reply } : reply;
    },
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => (table === "ai_secrets" ? Promise.resolve({ data: [{ slot_number: 1, secret_value: "k1" }, { slot_number: 2, secret_value: "k2" }], error: null }) : chain),
        upsert: (rows) => { writes.push({ table, rows }); return Promise.resolve({ error: null }); },
      };
      return chain;
    },
  };
  return { calls, writes };
}

const request = (over = {}) => ({
  runId: RUN,
  slotNumber: 2,
  autoFallback: true,
  salesMode: "AUTO",
  sellerNicknames: ["네네"],
  newEvents: [
    { id: "c_1", kind: "COMMENT", at: "2026-10-04T14:40:04.000Z", nickname: "체리나무", text: "저요" },
    { id: "s_1", kind: "SPEECH", at: "2026-10-04T14:40:14.000Z", text: "체리 나무 언니 드릴게요." },
  ],
  recentEvents: [],
  productState: null,
  openIntents: [],
  ledger: [],
  nicknameCandidates: [],
  knownNicknames: ["체리나무"],
  ...over,
});

const good = JSON.stringify({
  classifications: [{ eventId: "c_1", type: "PURCHASE_INTENT", confidence: 0.95 }, { eventId: "s_1", type: "SELLER_CONFIRM", confidence: 0.9 }],
  productState: { name: "가디건", price: 18000, options: [], salesMode: "FREE_TALK" },
  ledgerOps: [{ op: "CREATE", buyerNickname: "체리나무", product: "가디건", price: 18000, confidence: 0.92, evidence: ["c_1", "s_1"], reason: "확정" }],
});

async function call(body) {
  const res = await handleLogicOpus(admin, body);
  return (await res.json()).data;
}

test("관리자만 사용할 수 있다", async () => {
  fixture([]);
  await assert.rejects(handleLogicOpus({ ...admin, role: "SELLER" }, { action: "logic-opus-slots" }), (e) => e.code === "FORBIDDEN");
});

test("화면에서 고른 슬롯(2번)을 먼저 쓰고, 이벤트 분류를 기록한다", async () => {
  const { calls, writes } = fixture([good]);
  const data = await call({ action: "logic-opus-judge", request: request() });
  assert.equal(data.usedSlot, 2);
  assert.equal(calls[0].model, "gpt-x");
  assert.equal(calls[0].secret, "k2");
  assert.ok(calls[0].timeout <= 12);
  assert.equal(data.judgement.ledgerOps[0].buyerNickname, "체리나무");
  const rows = writes.find((w) => w.table === "logic_opus_events").rows;
  assert.equal(rows.find((r) => r.event_id === "c_1").classification, "PURCHASE_INTENT");
});

test("형식이 틀리면 같은 슬롯에 한 번 교정 요청, 계속 실패하면 다른 슬롯으로 넘어간다", async () => {
  const { calls } = fixture(["형식 없음", "또 형식 없음", good]);
  const data = await call({ action: "logic-opus-judge", request: request({ slotNumber: 1 }) });
  assert.deepEqual(calls.map((c) => c.model), ["deepseek-chat", "deepseek-chat", "gpt-x"]);
  assert.ok(calls[1].prompt.userPrompt.includes("형식에 맞지 않았습니다"));
  assert.equal(data.usedSlot, 2);
  assert.equal(data.attempts.length, 3);
});

test("자동 전환을 끄면 고른 슬롯만 쓰고 실패를 알려 준다", async () => {
  const { calls } = fixture([{ content: null, error: "AI 응답 대기시간 초과", errorCode: "TIMEOUT" }]);
  const data = await call({ action: "logic-opus-judge", request: request({ slotNumber: 1, autoFallback: false }) });
  assert.equal(calls.length, 1);
  assert.equal(data.judgement, null);
  assert.match(data.error, /1번슬롯: AI 응답 대기시간 초과/);
});

test("PC 도우미 경유 로컬 슬롯은 사용 불가로 표시한다", async () => {
  fixture([]);
  globalThis.opusFixture.setting.slot1 = { type: "LOCAL", provider: "OLLAMA", model: "qwen2.5:7b", routingMode: "PC_HELPER", authType: "NONE" };
  const data = await call({ action: "logic-opus-slots" });
  assert.equal(data.slots[0].ready, false);
  assert.equal(data.slots[1].ready, true);
});

test("판단 루프: 묶음 전송, 새 구매의사자일 때만 힌트 갱신 요청, 실패 시 한 번 재시도", async () => {
  const requests = [];
  const hints = [];
  let fail = true;
  const loop = new OpusJudgeLoop(
    { runId: RUN, slotNumber: 1, autoFallback: true, salesMode: "AUTO", sellerNicknames: ["네네"] },
    {
      judge: async (req) => {
        requests.push(req);
        if (fail) { fail = false; return { judgement: null, usedSlot: null, attempts: [], error: "실패" }; }
        return {
          usedSlot: 1,
          attempts: [],
          judgement: {
            classifications: req.newEvents.map((e) => ({ eventId: e.id, type: e.kind === "COMMENT" ? "PURCHASE_INTENT" : "SELLER_CONFIRM", confidence: 0.9 })),
            productState: null,
            ledgerOps: req.newEvents.some((e) => e.kind === "SPEECH")
              ? [{ op: "CREATE", buyerNickname: "체리나무", product: "가디건", price: 18000, quantity: 1, confidence: 0.9, evidence: ["s_1"], reason: "" }]
              : [],
            sttHintRequest: true,
          },
        };
      },
      onLedger: () => {},
      onHintRequest: (nicks) => { hints.push(nicks); },
      debounceMs: 5,
    },
  );
  loop.addEvent({ id: "c_1", kind: "COMMENT", at: "2026-10-04T14:40:04.000Z", nickname: "체리나무", text: "저요" });
  loop.addEvent({ id: "s_1", kind: "SPEECH", at: "2026-10-04T14:40:14.000Z", text: "체리 나무 언니 드릴게요." });
  await loop.flush();
  assert.equal(requests.length, 2, "첫 실패 후 같은 이벤트를 한 번 더 보냄");
  assert.deepEqual(requests[1].newEvents.map((e) => e.id), ["c_1", "s_1"]);
  assert.equal(requests[1].nicknameCandidates[0].candidates[0].nickname, "체리나무");
  assert.equal(loop.sales[0].status, "CONFIRMED");
  assert.deepEqual(hints, [["체리나무"]]);
  assert.deepEqual(loop.intentNicknames, ["체리나무"]);
  loop.addEvent({ id: "c_2", kind: "COMMENT", at: "2026-10-04T14:40:20.000Z", nickname: "체리나무", text: "저요 하나 더" });
  await loop.flush();
  assert.deepEqual(hints, [["체리나무"]], "같은 사람이 다시 구매의사를 밝히면 힌트 요청 안 함");
  loop.addEvent({ id: "c_3", kind: "COMMENT", at: "2026-10-04T14:40:22.000Z", nickname: "루비", text: "저요" });
  loop.addEvent({ id: "c_4", kind: "COMMENT", at: "2026-10-04T14:40:22.500Z", nickname: "네네", text: "저요" });
  await loop.flush();
  assert.deepEqual(hints, [["체리나무"], ["루비"]], "새 구매의사자만, 판매자 닉네임은 제외");
  loop.stop();
});
