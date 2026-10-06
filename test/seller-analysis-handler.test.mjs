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
            ? `export const getOperationalAiSetting=async()=>globalThis.analysisFixture.setting;export const getPrimaryAiSlot=s=>s.primary_slot;`
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
    setting: {
      id: "setting",
      primary_slot: 2,
      auto_fallback_enabled: true,
      slot1: { type: "LOCAL", provider: "CUSTOM", model: "local" },
      slot2: { type: "CLOUD", provider: "OPENAI", model: "cloud" },
    },
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
              ? [{ slot_number: 1, secret_value: "TEST_SLOT_1_SECRET" }, {
                slot_number: 2,
                secret_value: "TEST_SLOT_2_SECRET",
              }]
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
      if (ctx.aiResult) return ctx.aiResult(prompt, options);
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
async function singleCall(action, payload = {}) {
  return (await (await handleSellerAnalysis(auth, { action, ...payload }))
    .json()).data.analysis;
}
async function call(action, payload = {}) {
  const doc = await singleCall(action, payload);
  return action === "seller-analysis-analyze" && doc.status === "ANALYZING" &&
      doc.messages.at(-1)?.continuation
    ? singleCall(action, {
      id: doc.id,
      expectedRevision: doc.revision,
      continueAnalysis: true,
    })
    : doc;
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
  assert.equal(ctx.calls[0].options.slotConfig.timeoutSeconds, 120);
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
test("explicit slot 1 overrides global slot 2 for this analysis without changing global settings", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 1,
  });
  assert.equal(doc.status, "REVIEW");
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].options.slotConfig.model, "local");
  assert.equal(ctx.calls[0].options.slotConfig.timeoutSeconds, 120);
  assert.equal(ctx.calls[0].options.secretValue, "TEST_SLOT_1_SECRET");
  assert.equal(ctx.setting.primary_slot, 2);
  assert.equal(doc.reports[0].requestedSlot, 1);
  assert.equal(doc.reports[0].attempts[0].slot, 1);
});
test("explicit slot 2 uses its own credentials and falls back to slot 1 with identical prompt", async () => {
  const ctx = fixture();
  ctx.setting.primary_slot = 1;
  let doc = await call("seller-analysis-save", { input });
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 2,
  });
  assert.equal(doc.status, "REVIEW");
  assert.deepEqual(doc.reports[0].attempts.map((a) => a.slot), [2, 1]);
  assert.equal(doc.reports[0].requestedSlot, 2);
  assert.equal(ctx.calls[0].options.slotConfig.model, "cloud");
  assert.equal(ctx.calls[0].options.slotConfig.timeoutSeconds, 120);
  assert.equal(ctx.calls[0].options.secretValue, "TEST_SLOT_2_SECRET");
  assert.equal(ctx.calls[1].options.slotConfig.timeoutSeconds, 120);
  assert.equal(ctx.calls[1].options.secretValue, "TEST_SLOT_1_SECRET");
  assert.deepEqual(ctx.calls[0].prompt, ctx.calls[1].prompt);
  assert.equal(ctx.setting.primary_slot, 1);
});
test("invalid report receives one format repair before falling back with a fresh 120 second budget", async () => {
  const ctx = fixture();
  ctx.aiResult = async (_prompt, options) => ({
    content: options.slotConfig.type === "LOCAL"
      ? "not json"
      : JSON.stringify(report),
  });
  let doc = await call("seller-analysis-save", { input });
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 1,
  });
  assert.equal(doc.status, "REVIEW");
  assert.deepEqual(doc.reports[0].attempts.map((a) => a.slot), [1, 1, 2]);
  assert.ok(doc.reports[0].attempts[0].error);
  assert.equal(doc.reports[0].attempts[1].phase, "FORMAT_REPAIR");
  assert.ok(ctx.calls[1].options.slotConfig.timeoutSeconds <= 120);
  assert.equal(ctx.calls[2].options.slotConfig.timeoutSeconds, 120);
});

test("production-like invalid report is repaired on the same slot within its remaining deadline", async (t) => {
  const ctx = fixture();
  const invalid = { ...report, purchaseSignals: [{ expression: "저요" }], profile: { ...report.profile, exclusionExpressions: ["."] } };
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T00:00:00Z") });
  try {
    ctx.aiResult = async (_prompt, options) => {
      const first = ctx.calls.length === 1;
      const content = JSON.stringify(first ? invalid : report);
      options.onConversationTrace({ responseText: content, httpStatus: 200 });
      if (first) t.mock.timers.tick(91_500);
      return { content };
    };
    let doc = await call("seller-analysis-save", { input });
    doc = await call("seller-analysis-analyze", { id: doc.id, expectedRevision: doc.revision, slotNumber: 2 });
    assert.equal(doc.status, "REVIEW");
    const attempts = doc.reports[0].attempts;
    assert.deepEqual(attempts.map((a) => [a.slot, a.phase]), [[2, "ANALYSIS"], [2, "FORMAT_REPAIR"]]);
    assert.equal(attempts[0].errorCode, "INVALID_REPORT");
    assert.match(attempts[0].error, /purchaseSignals/);
    assert.match(attempts[0].error, /exclusionExpressions/);
    assert.equal(attempts[0].conversationTrace.responseText, JSON.stringify(invalid));
    assert.equal(attempts[1].error, null);
    assert.equal(ctx.calls[1].options.slotConfig.timeoutSeconds, 28.5);
    const repair = JSON.parse(ctx.calls[1].prompt.userPrompt);
    assert.equal(repair.originalRequest, ctx.calls[0].prompt.userPrompt);
    assert.equal(repair.previousResponse, JSON.stringify(invalid));
    assert.match(repair.validationError, /purchaseSignals/);
  } finally { t.mock.timers.reset(); }
});

test("near-deadline validation failure does not start repair and keeps both slot errors", async (t) => {
  const ctx = fixture();
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T00:00:00Z") });
  try {
    ctx.aiResult = async (_prompt, options) => {
      if (options.slotConfig.type === "CLOUD") {
        t.mock.timers.tick(119_000);
        return { content: "not json" };
      }
      return { content: null, error: "AI 응답 대기시간 초과", errorCode: "TIMEOUT" };
    };
    let doc = await call("seller-analysis-save", { input });
    doc = await call("seller-analysis-analyze", { id: doc.id, expectedRevision: doc.revision, slotNumber: 2 });
    assert.equal(doc.status, "FAILED");
    assert.equal(ctx.calls.length, 2);
    assert.deepEqual(doc.messages.at(-1).attempts.map((a) => a.errorCode), ["INVALID_REPORT", "TIMEOUT"]);
    assert.match(doc.lastError, /2번슬롯 \(cloud\).*JSON/);
    assert.match(doc.lastError, /1번슬롯 \(local\).*대기시간 초과/);
  } finally { t.mock.timers.reset(); }
});

test("output-limit failures are not retried as format repairs", async () => {
  const ctx = fixture();
  ctx.setting.auto_fallback_enabled = false;
  ctx.aiResult = async () => ({ content: null, error: "출력 길이 제한", errorCode: "OUTPUT_LIMIT" });
  let doc = await call("seller-analysis-save", { input });
  doc = await call("seller-analysis-analyze", { id: doc.id, expectedRevision: doc.revision, slotNumber: 2 });
  assert.equal(doc.status, "FAILED");
  assert.equal(ctx.calls.length, 1);
  assert.equal(doc.messages.at(-1).attempts[0].errorCode, "OUTPUT_LIMIT");
});
test("selected slot does not bypass disabled auto fallback", async () => {
  const ctx = fixture();
  ctx.setting.auto_fallback_enabled = false;
  ctx.setting.primary_slot = 1;
  let doc = await call("seller-analysis-save", { input });
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 2,
  });
  assert.equal(doc.status, "FAILED");
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].options.slotConfig.type, "CLOUD");
  assert.equal(doc.messages.at(-1).attempts[0].slot, 2);
});
test("slot 1 and slot 2 can both be used for correction reanalysis", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 1,
  });
  ctx.calls.length = 0;
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 2,
    feedback: "재고 미상일 때도 확정하도록 검토해 주세요.",
  });
  assert.equal(doc.reports[1].requestedSlot, 2);
  assert.equal(ctx.calls[0].options.slotConfig.type, "CLOUD");
  const prompt = JSON.parse(ctx.calls[0].prompt.userPrompt);
  assert.deepEqual(prompt.previous, report);
  assert.match(prompt.feedback, /재고 미상/);
});
test("invalid slot values are rejected before claiming or calling AI", async () => {
  const ctx = fixture();
  const doc = await call("seller-analysis-save", { input });
  for (const slotNumber of [0, 3, "1", null, true, {}, [1]]) {
    await assert.rejects(() =>
      call("seller-analysis-analyze", {
        id: doc.id,
        expectedRevision: doc.revision,
        slotNumber,
      }), (e) => e.code === "VALIDATION_ERROR");
    assert.equal(ctx.rows.get(doc.id).status, "DRAFT");
    assert.equal(ctx.rows.get(doc.id).revision, doc.revision);
  }
  assert.equal(ctx.calls.length, 0);
});
test("fallback runs in a separate request with persisted original feedback, priority and attempts", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  const feedback = "미확인 사례를 구분해 주세요.";
  doc = await singleCall("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 2,
    feedback,
  });
  assert.equal(doc.status, "ANALYZING");
  assert.equal(ctx.calls.length, 1);
  assert.equal(doc.messages.at(-1).continuation.nextSlot, 1);
  assert.equal(doc.messages.at(-1).attempts[0].slot, 2);
  doc = await singleCall("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    continueAnalysis: true,
    slotNumber: 2,
    feedback: "client must not change the original prompt",
  });
  assert.equal(doc.status, "REVIEW");
  assert.equal(doc.reports.length, 1);
  assert.equal(doc.reports[0].requestedSlot, 2);
  assert.deepEqual(doc.reports[0].attempts.map((a) => a.slot), [2, 1]);
  assert.equal(ctx.calls[1].options.slotConfig.timeoutSeconds, 120);
  assert.deepEqual(ctx.calls[0].prompt, ctx.calls[1].prompt);
  assert.equal(JSON.parse(ctx.calls[1].prompt.userPrompt).feedback, feedback);
  assert.equal(doc.messages.filter((m) => m.role === "ADMIN").length, 1);
  assert.ok(doc.messages.every((m) => !m.continuation));
});
test("long analysis cannot be replaced by saving or restarting after the old 60 second guard", async () => {
  const ctx = fixture();
  const doc = await call("seller-analysis-save", { input });
  for (const elapsed of [90_000, 239_000, 299_000]) {
    ctx.rows.set(doc.id, {
      ...doc,
      status: "ANALYZING",
      updatedAt: new Date(Date.now() - elapsed).toISOString(),
    });
    await assert.rejects(() =>
      singleCall("seller-analysis-analyze", {
        id: doc.id,
        expectedRevision: doc.revision,
        slotNumber: 1,
      }), (e) => e.code === "BUSY");
    await assert.rejects(() =>
      singleCall("seller-analysis-save", {
        id: doc.id,
        expectedRevision: doc.revision,
        input,
      }), (e) => e.code === "BUSY");
  }
  assert.equal(ctx.calls.length, 0);
});
test("an abandoned analysis can be restarted after the five minute safety lease", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  ctx.rows.set(doc.id, {
    ...doc,
    status: "ANALYZING",
    updatedAt: new Date(Date.now() - 301_000).toISOString(),
  });
  doc = await call("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 1,
  });
  assert.equal(doc.status, "REVIEW");
  assert.equal(ctx.calls.length, 1);
});
test("a continuation without a server-issued handoff cannot run AI", async () => {
  const ctx = fixture();
  const doc = await call("seller-analysis-save", { input });
  await assert.rejects(() =>
    singleCall("seller-analysis-analyze", {
      id: doc.id,
      expectedRevision: doc.revision,
      continueAnalysis: true,
    }), (e) => e.code === "NO_PENDING_ANALYSIS");
  assert.equal(ctx.calls.length, 0);
  assert.equal(ctx.rows.get(doc.id).status, "DRAFT");
});
test("changed operational settings do not silently change a queued fallback model", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  doc = await singleCall("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 2,
  });
  ctx.setting.applied_version = 2;
  doc = await singleCall("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    continueAnalysis: true,
  });
  assert.equal(doc.status, "FAILED");
  assert.match(doc.lastError, /운영 AI 설정이 변경/);
  assert.equal(ctx.calls.length, 1);
  assert.equal(doc.messages.at(-1).attempts[0].slot, 2);
});
test("fallback handoff can only be claimed once and cannot loop to the first slot", async () => {
  const ctx = fixture();
  let doc = await call("seller-analysis-save", { input });
  doc = await singleCall("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    slotNumber: 2,
  });
  let release;
  ctx.aiResult = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const running = singleCall("seller-analysis-analyze", {
    id: doc.id,
    expectedRevision: doc.revision,
    continueAnalysis: true,
  });
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  assert.ok(release);
  const claimed = ctx.rows.get(doc.id);
  assert.ok(!claimed.messages.at(-1).continuation);
  await assert.rejects(() =>
    singleCall("seller-analysis-analyze", {
      id: doc.id,
      expectedRevision: doc.revision,
      continueAnalysis: true,
    }), (e) => e.code === "REVISION_CONFLICT");
  await assert.rejects(() =>
    singleCall("seller-analysis-analyze", {
      id: claimed.id,
      expectedRevision: claimed.revision,
      continueAnalysis: true,
    }), (e) => e.code === "NO_PENDING_ANALYSIS");
  release({ content: null, error: "TIMEOUT" });
  const failed = await running;
  assert.equal(failed.status, "FAILED");
  assert.equal(ctx.calls.length, 2);
  assert.deepEqual(failed.messages.at(-1).attempts.map((a) => a.slot), [2, 1]);
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
