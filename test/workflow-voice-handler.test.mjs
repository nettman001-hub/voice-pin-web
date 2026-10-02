import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DEFAULT_WORKFLOW_PROFILE } from "../src/services/salesWorkflowEngine.ts";
const compiled = await build({
  entryPoints: ["supabase/functions/sales-api/handlers/voiceSales.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "workflow-edge-fixture",
    setup(b) {
      b.onResolve(
        { filter: /_shared\/productSales\.ts$/ },
        () => ({ path: "db", namespace: "fixture" }),
      );
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `
    export const admin={from:(...args)=>globalThis.workflowEdge.from(...args),rpc:(...args)=>globalThis.workflowEdge.rpc(...args)};
    export const successResponse=data=>new Response(JSON.stringify({ok:true,data}));
    export const errorResponse=(code,message,status=400)=>new Response(JSON.stringify({ok:false,error:{code,message}}),{status});
  `,
      }));
    },
  }],
});
const { handleCommitVoiceSale } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
function fixture() {
  const ws = crypto.randomUUID(),
    seller = crypto.randomUUID(),
    profileId = crypto.randomUUID(),
    session = crypto.randomUUID(),
    comment = crypto.randomUUID(),
    buyer = crypto.randomUUID();
  const sale = {
    id: "s-" + crypto.randomUUID(),
    sessionId: session,
    purchaseRequestId: session + ":message",
    buyerNickname: "햇살",
    amount: 5000,
    unitPrice: 5000,
    quantity: 1,
    recognizedAt: "2026-09-15T00:00:10Z",
    rawTranscript: "댓글에 1번 입력 0.5\n햇살언니 드릴게요",
    workflowEvidence: {
      decisionId: "b:햇살",
      profileId,
      profileVersion: 1,
      offerId: "forged-client-offer",
      profileSnapshot: { unsafe: true },
      transcripts: [],
    },
  };
  const tables = {
    workspaces: [{ id: ws, owner_id: seller }],
    seller_workflow_profiles: [{
      id: profileId,
      seller_user_id: seller,
      report_version: 1,
      shadow_verified: true,
      profile: DEFAULT_WORKFLOW_PROFILE,
    }],
    workspace_settings: [{
      workspace_id: ws,
      namespace: "session_transcripts_" + session,
      value: {
        logs: [
          {
            id: "a",
            text: "댓글에 1번 입력 0.5",
            recognizedAt: "2026-09-15T00:00:00Z",
          },
          {
            id: "b",
            text: "햇살언니 드릴게요",
            recognizedAt: "2026-09-15T00:00:10Z",
          },
        ],
      },
    }],
    live_comments: [{
      id: comment,
      workspace_id: ws,
      session_id: session,
      platform_message_id: "message",
      buyer_id: buyer,
      nickname_snapshot: "햇살",
      content: "1번이요",
      captured_at: "2026-09-15T00:00:02Z",
    }],
    operations: [],
    sales: [],
  };
  const ctx = {
    tables,
    sale,
    ws,
    calls: [],
    from(table) {
      let filters = [];
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return q;
        },
        gte(k, v) {
          filters.push((r) => r[k] >= v);
          return q;
        },
        lte(k, v) {
          filters.push((r) => r[k] <= v);
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        async maybeSingle() {
          return {
            data: tables[table].filter((r) => filters.every((f) => f(r)))[0] ||
              null,
            error: null,
          };
        },
        single() {
          return q.maybeSingle();
        },
        then(resolve, reject) {
          const data = tables[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data, count: data.length, error: null })
            .then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      ctx.calls.push({ name, args });
      return {
        data: {
          ok: true,
          saleId: args.p_sale_id,
          buyerNickname: args.p_decision.nickname,
          amount: args.p_decision.amount,
          productId: crypto.randomUUID(),
        },
      };
    },
  };
  globalThis.workflowEdge = ctx;
  return ctx;
}
const commit = async (ctx, sale = ctx.sale) =>
  (await handleCommitVoiceSale(ctx.ws, "actor", {
    operationId: sale.id.slice(2),
    sale,
  })).json();
test("workflow edge independently replays canonical comments and ignores client profile/offer claims", async () => {
  const ctx = fixture();
  const result = await commit(ctx);
  assert.equal(result.ok, true);
  assert.equal(ctx.calls[0].name, "voicecap_commit_workflow_sale");
  const proof = ctx.calls[0].args.p_evidence;
  assert.equal(proof.offerId, ctx.sale.sessionId + ":a");
  assert.deepEqual(proof.profileSnapshot, DEFAULT_WORKFLOW_PROFILE);
  assert.equal(proof.orderCode, "1");
  assert.equal(proof.transcripts.length, 2);
  assert.equal(ctx.calls[0].args.p_decision.nickname, "햇살");
});
test("wrong nickname, price, quantity and unverified profile cannot reach a workflow commit", async () => {
  for (
    const change of [{ buyerNickname: "이거" }, { amount: 8000 }, {
      quantity: 2,
    }]
  ) {
    const ctx = fixture();
    assert.equal(
      (await commit(ctx, { ...ctx.sale, ...change })).error.code,
      "WORKFLOW_EVIDENCE_UNVERIFIED",
    );
    assert.equal(ctx.calls.length, 0);
  }
  const ctx = fixture();
  ctx.tables.seller_workflow_profiles[0].shadow_verified = false;
  assert.equal((await commit(ctx)).error.code, "PROFILE_UNVERIFIED");
  assert.equal(ctx.calls.length, 0);
});
test("successful retry is stable after later broadcast context disappears and changed requests are rejected", async () => {
  const ctx = fixture();
  const first = await commit(ctx);
  ctx.tables.operations.push({
    workspace_id: ctx.ws,
    operation_id: ctx.sale.id.slice(2),
    action: "commit-workflow-sale",
    response_json: first.data,
  });
  ctx.tables.sales.push({
    id: ctx.sale.id,
    workspace_id: ctx.ws,
    session_id: ctx.sale.sessionId,
    purchase_request_id: ctx.sale.purchaseRequestId,
    buyer_nickname: "햇살",
    amount: 5000,
    unit_price: 5000,
    quantity: 1,
    workflow_evidence: ctx.sale.workflowEvidence,
  });
  ctx.tables.workspace_settings[0].value.logs = [];
  ctx.tables.live_comments = [];
  assert.deepEqual(await commit(ctx), first);
  assert.equal(ctx.calls.length, 1);
  assert.equal(
    (await commit(ctx, { ...ctx.sale, amount: 8000 })).error.code,
    "OPERATION_PAYLOAD_MISMATCH",
  );
});
