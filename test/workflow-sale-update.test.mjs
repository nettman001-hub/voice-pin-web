import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const source = fs.readFileSync(
  new URL("../src/context/SalesContext.tsx", import.meta.url),
  "utf8",
);
const file = ts.createSourceFile(
  "SalesContext.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let initializer;
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(file) === "updateSale") {
    initializer = n.initializer.getText(file);
  }
  ts.forEachChild(n, visit);
}
visit(file);
const compiled = ts.transpileModule(`module.exports=${initializer}`, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const pending = {
  id: "s-one",
  sessionId: "session",
  status: "보류",
  source: "WEB_VOICE",
  syncStatus: "PENDING",
  amount: 0,
  recognizedAt: "2026-10-02T00:00:00Z",
  rawTranscript: "햇살언니 드릴게요",
  buyerNickname: "햇살",
  workflowEvidence: {
    decisionId: "decision",
    profileId: "profile",
    profileVersion: 1,
  },
};
function fixture(previous = pending) {
  const state = { saved: [], errors: [] }, module = { exports: null };
  vm.runInNewContext(compiled, {
    module,
    salesRef: { current: [previous] },
    setSyncError: (e) => state.errors.push(e),
    replaceSale: (s) => state.saved.push(s),
    isPrintableSale: (s) => s.status !== "보류" && s.amount > 0,
    hasSellerEditChanged: () => true,
    queueSalePrint: (s, r) =>
      state.saved.push({ ...s, printRevision: r, printStatus: "QUEUED" }),
  });
  return { ...state, update: module.exports };
}
test("price continuation updates an unsynced workflow pending row and queues the first receipt once", () => {
  const ctx = fixture();
  ctx.update({
    ...pending,
    status: "자동저장",
    amount: 5000,
    unitPrice: 5000,
    rawTranscript: "햇살언니 드릴게요\n금액은 0.5",
    purchaseRequestId: "session:comment",
  });
  assert.equal(ctx.errors.length, 0);
  assert.equal(ctx.saved[0].amount, 5000);
  assert.equal(ctx.saved[0].id, pending.id);
  assert.equal(ctx.saved[0].printRevision, 1);
});
test("a different workflow decision or profile cannot replace an unsynced voice row", () => {
  for (
    const evidence of [{ ...pending.workflowEvidence, decisionId: "other" }, {
      ...pending.workflowEvidence,
      profileId: "other",
    }]
  ) {
    const ctx = fixture();
    ctx.update({
      ...pending,
      amount: 5000,
      status: "자동저장",
      purchaseRequestId: "session:c",
      workflowEvidence: evidence,
    });
    assert.equal(ctx.saved.length, 0);
    assert.equal(ctx.errors.length, 1);
  }
});
test("legacy unsynced voice rows retain their price edit protection", () => {
  const previous = {
    ...pending,
    workflowEvidence: undefined,
    status: "자동저장",
    amount: 5000,
  };
  const ctx = fixture(previous);
  ctx.update({ ...previous, amount: 8000 });
  assert.equal(ctx.saved.length, 0);
  assert.equal(ctx.errors.length, 1);
});
