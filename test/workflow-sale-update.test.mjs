import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { checkFourPointSaleCriteria } from '../src/services/salesExtractor.ts';
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
    checkFourPointSaleCriteria,
    salesRef: { current: [previous] },
    setSyncError: (e) => state.errors.push(e),
    replaceSale: (s) => { state.saved.push(s); return s; },
    isPrintableSale: (s) => s.status !== "보류" && s.amount > 0,
    hasSellerEditChanged: () => true,
    queueSalePrint: (s, r) => {
      const saved = { ...s, printRevision: r, printStatus: "QUEUED" };
      state.saved.push(saved);
      return saved;
    },
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

const voicePending = { ...pending, workflowEvidence: undefined, sourceCommentIds: ['comment'],
  productCode: '001', productName: '001-20261002-1' };
const fourPointContinuation = { ...voicePending, status: '확정', amount: 15000, unitPrice: 15000,
  purchaseRequestId: 'session:comment', rawTranscript: '햇살님 드릴게요 1.5. 캡처하세요.',
  recognizedAt: '2026-10-02T00:00:01Z' };

test('a same-comment voice confirmation can complete an uploading pending sale and queue one receipt', () => {
  const ctx = fixture(voicePending);
  const saved = ctx.update(fourPointContinuation, { voiceAllocationContinuation: true });
  assert.equal(ctx.errors.length, 0);
  assert.equal(ctx.saved.length, 1);
  assert.equal(saved.id, voicePending.id);
  assert.equal(saved.status, '확정');
  assert.equal(saved.amount, 15000);
  assert.equal(saved.printRevision, 1);
  assert.equal(saved.printStatus, 'QUEUED');
});

test('voice continuation does not permit a different purchase, product, session, or a manual price edit', () => {
  for (const patch of [
    { sourceCommentIds: ['another-comment'], purchaseRequestId: 'session:another-comment' },
    { sessionId: 'another-session' }, { productCode: '002' }, { amount: 0 },
  ]) {
    const ctx = fixture(voicePending);
    assert.equal(ctx.update({ ...fourPointContinuation, ...patch }, { voiceAllocationContinuation: true }), undefined);
    assert.equal(ctx.saved.length, 0);
    assert.equal(ctx.errors.length, 1);
  }
  const manual = fixture(voicePending);
  manual.update(fourPointContinuation);
  assert.equal(manual.saved.length, 0);
  assert.equal(manual.errors.length, 1);

  const final = fixture({ ...fourPointContinuation, syncStatus: 'PENDING' });
  final.update({ ...fourPointContinuation, amount: 20000 }, { voiceAllocationContinuation: true });
  assert.equal(final.saved.length, 0);
});

test('an uploading confirmed sale can link its real commenter while preserving the sale evidence', () => {
  const previous = { ...voicePending, status: '확정', amount: 15000,
    evidenceSnapshot: { buyerResolution: { saleConfirmed: true, status: 'NO_MATCH', candidates: [] } } };
  const updated = { ...previous, buyerNickname: '꽃순이', sourceCommentIds: ['real-comment'],
    evidenceSnapshot: { buyerResolution: { saleConfirmed: true, status: 'MATCHED',
      candidates: [{ nickname: '꽃순이', commentId: 'real-comment' }] } } };
  const ctx = fixture(previous);
  const saved = ctx.update(updated);
  assert.equal(ctx.errors.length, 0);
  assert.equal(saved.id, previous.id);
  assert.equal(saved.buyerNickname, '꽃순이');
  assert.equal(saved.printStatus, 'QUEUED');
  const bad = fixture(previous);
  bad.update({ ...updated, amount: 20000 });
  assert.equal(bad.saved.length, 0, 'buyer linking cannot change the confirmed amount');
});
