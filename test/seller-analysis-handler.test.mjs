import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DEFAULT_WORKFLOW_PROFILE } from "../src/services/salesWorkflowEngine.ts";
const bundle = await build({
  entryPoints: ["supabase/functions/sales-api/handlers/sellerAnalysis.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "analysis-fixture",
    setup(b) {
      b.onResolve(
        { filter: /_shared\/productSales\.ts$/ },
        (args) => ({ path: "db", namespace: "fixture" }),
      );
      b.onResolve(
        { filter: /aiOperationalSettings\.ts$/ },
        (args) => ({ path: "settings", namespace: "fixture" }),
      );
      b.onResolve(
        { filter: /aiAdapters\/index\.ts$/ },
        (args) => ({ path: "ai", namespace: "fixture" }),
      );
      b.onLoad(
        { filter: /.*/, namespace: "fixture" },
        (args) => ({
          contents: args.path === "db"
            ? `
   export const admin={from:(...a)=>globalThis.analysisFixture.from(...a),rpc:(...a)=>globalThis.analysisFixture.rpc(...a),auth:{admin:{getUserById:async id=>({data:{user:{id}}})}}};
   export const successResponse=data=>new Response(JSON.stringify({ok:true,data}));
   export const errorResponse=(code,message,status=400)=>new Response(JSON.stringify({ok:false,error:{code,message}}),{status});`
            : args.path === "settings"
            ? `export const getOperationalAiSetting=async()=>({id:'setting',primary_slot:2,auto_fallback_enabled:true,slot1:{type:'LOCAL',provider:'CUSTOM',model:'local'},slot2:{type:'CLOUD',provider:'OPENAI',model:'cloud'}});export const getPrimaryAiSlot=s=>s.primary_slot;`
            : `export const executeAiPrompt=(...a)=>globalThis.analysisFixture.ai(...a);`,
        }),
      );
    },
  }],
});
const { handleSellerAnalysis } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const actor = crypto.randomUUID(),
  auth = {
    actorId: actor,
    actorType: "USER",
    role: "ADMIN",
    workspaceId: "",
    capabilities: new Set(["ADMIN"]),
  };
const input = {
  sellerName: "테스트 판매자",
  sellerUserId: null,
  adminDescription: "번호로 주문하고 여러 명을 호명합니다.",
  commentText: "",
  transcriptText: "",
  sessionId: "session",
  comments: [{
    id: "c",
    sessionId: "session",
    platformUserId: "buyer",
    nickname: "햇살",
    content: "1",
    capturedAt: "2026-10-02T00:00:02Z",
  }],
  transcripts: [{
    id: "a",
    text: "댓글에 1번 입력 0.5",
    recognizedAt: "2026-10-02T00:00:00Z",
  }, {
    id: "b",
    text: "햇살언니 드릴게요",
    recognizedAt: "2026-10-02T00:00:10Z",
  }],
};
const report = {
  summary: "번호 주문과 복수 호명",
  workflow: [],
  purchaseSignals: [],
  confirmationSignals: [],
  priceRules: [],
  nicknameRules: [],
  inventoryRule: "재고 안내가 있을 때만 검사",
  exceptions: [],
  unknowns: [],
  suggestions: [],
  supportAssessment: "SUPPORTED",
  profile: DEFAULT_WORKFLOW_PROFILE,
};
function fixture() {
  const rows = new Map(), calls = [];
  const ctx = {
    rows,
    calls,
    from(table) {
      let id;
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          if (k === "id") id = v;
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        async maybeSingle() {
          return { data: rows.has(id) ? { document: rows.get(id) } : null };
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: table === "ai_secrets"
              ? []
              : [...rows.values()].map((document) => ({
                document,
                summary: document,
              })),
          }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(_name, args) {
      const row = rows.get(args.p_id);
      if (
        args.p_expected_revision !== null &&
        row?.revision !== args.p_expected_revision
      ) return { data: { ok: false } };
      rows.set(args.p_id, structuredClone(args.p_document));
      return { data: { ok: true, document: structuredClone(args.p_document) } };
    },
    async ai(prompt, options) {
      calls.push({ prompt, options });
      if (options.slotConfig.type === "CLOUD") {
        return {
          content: null,
          error: "TIMEOUT",
        };
      }
      return { content: JSON.stringify(report) };
    },
  };
  globalThis.analysisFixture = ctx;
  return ctx;
}
async function call(action, payload = {}) {
  return (await (await handleSellerAnalysis(auth, { action, ...payload }))
    .json()).data.analysis;
}
test("admin analysis follows primary order, keeps feedback and requires reviewed current replay before approval", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  assert.equal(doc.status, "DRAFT");
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
  });
  assert.equal(doc.status, "REVIEW");
  assert.equal(doc.reports.length, 1);
  assert.equal(ctx.calls[0].options.slotConfig.timeoutSeconds, 4);
  assert.equal(ctx.calls[0].options.slotConfig.type, "CLOUD");
  assert.equal(ctx.calls[1].options.slotConfig.type, "LOCAL");
  assert.match(ctx.calls[0].prompt.userPrompt, /번호로 주문/);
  await assert.rejects(
    () =>
      call("seller-analysis-approve", {
        id: doc.id,
        expectedRevision: doc.revision,
        reportVersion: 1,
      }),
    (e) => e.code === "VERIFICATION_REQUIRED",
  );
  doc = await call("seller-analysis-verify", {
    id: doc.id,
    expectedRevision: doc.revision,
    reportVersion: 1,
    reviewed: true,
  });
  assert.equal(doc.reports[0].verification.decisions[0].nickname, "햇살");
  assert.equal(doc.reports[0].verification.decisions[0].amount, 5000);
  doc = await call("seller-analysis-approve", {
    id: doc.id,
    expectedRevision: doc.revision,
    reportVersion: 1,
  });
  assert.equal(doc.status, "APPROVED");
  assert.equal(doc.approvedBy, actor);
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    feedback: "추가로 옵션 주문을 확인해 주세요.",
  });
  assert.equal(doc.reports.length, 2);
  assert.equal(doc.approvedAt, null);
  assert.match(ctx.calls.at(-1).prompt.userPrompt, /옵션 주문/);
  assert.equal(doc.reports[1].verification, undefined);
  await assert.rejects(
    () =>
      call("seller-analysis-approve", {
        id: doc.id,
        expectedRevision: doc.revision,
        reportVersion: 1,
      }),
    (e) => e.code === "STALE_REPORT",
  );
});
test("workspace OWNER and device ADMIN capability cannot analyze or approve seller profiles", async () => {
  fixture();
  for (
    const a of [{ ...auth, role: "OWNER" }, { ...auth, actorType: "DEVICE" }]
  ) {
    await assert.rejects(
      () => handleSellerAnalysis(a, { action: "seller-analysis-list" }),
      (e) => e.code === "FORBIDDEN",
    );
  }
});
test("changed input clears approval and an old revision cannot replace current data", async () => {
  fixture();
  let doc = await call("seller-analysis-save", { input });
  const old = doc;
  doc = await call("seller-analysis-save", {
    id: doc.id,
    expectedRevision: doc.revision,
    input: { ...input, adminDescription: "수정된 방식" },
  });
  await assert.rejects(
    () =>
      call("seller-analysis-save", {
        id: doc.id,
        expectedRevision: old.revision,
        input,
      }),
    (e) => e.code === "REVISION_CONFLICT",
  );
  assert.equal(doc.input.adminDescription, "수정된 방식");
  assert.equal(doc.status, "DRAFT");
});
