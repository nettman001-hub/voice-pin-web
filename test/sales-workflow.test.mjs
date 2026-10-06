import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKFLOW_PROFILE,
  extractCommentOrderCode,
  replaySalesWorkflow,
  validateWorkflowProfile,
} from "../src/services/salesWorkflowEngine.ts";
import {
  normalizeAnalysisInput,
  parseAnalysisReport,
} from "../src/services/sellerAnalysisRules.ts";
const at = (n) => new Date(Date.UTC(2026, 9, 2, 0, 0, n)).toISOString();
const t = (id, text, n) => ({ id, text, recognizedAt: at(n), isFinal: true });
const c = (id, nickname, content, n) => ({
  id,
  platformMessageId: id,
  platformUserId: nickname,
  sessionId: "session",
  nickname,
  content,
  capturedAt: at(n),
});
const replay = (transcripts, comments, profile = DEFAULT_WORKFLOW_PROFILE) =>
  replaySalesWorkflow({ sessionId: "session", profile, transcripts, comments });
test("announced code + decimal price + three buyers creates three canonical sales", () => {
  const result = replay([
    t("a", "이 제품 댓글에 1번 입력해서 주문해주시구요. 0.5 입니다.", 0),
    t("b", "햇살언니, 마가린언니, 쥬쥬언니께 드릴께요", 10),
  ], [
    c("1", "햇살", "1", 2),
    c("2", "마가린", "1번", 3),
    c("3", "쥬쥬", "1번 저요", 4),
  ]);
  assert.deepEqual(result.map((d) => [d.nickname, d.amount, d.status]), [
    ["햇살", 5000, "CONFIRMED"],
    ["마가린", 5000, "CONFIRMED"],
    ["쥬쥬", 5000, "CONFIRMED"],
  ]);
  assert.equal(new Set(result.map((d) => d.offerId)).size, 1);
});
test("numeric-only comments without an announced code are not purchase requests", () => {
  assert.equal(
    replay([t("b", "햇살언니 드릴게요 0.5", 10)], [c("1", "햇살", "1", 2)])[0]
      .status,
    "REVIEW",
  );
});
test("wrong product code does not attach to current product", () => {
  assert.equal(
    replay([
      t("a", "댓글에 2번 입력해주세요 0.5", 0),
      t("b", "햇살언니 드릴게요", 10),
    ], [c("1", "햇살", "1번 저요", 2)])[0].status,
    "REVIEW",
  );
});
test("announced stock checks the entire three-person allocation group", () => {
  const r = replay([
    t("a", "댓글에 1번 입력해주세요 0.5 재고 두 개 있습니다", 0),
    t("b", "햇살언니, 마가린언니, 쥬쥬언니 드릴게요", 10),
  ], [
    c("1", "햇살", "1", 2),
    c("2", "마가린", "1", 3),
    c("3", "쥬쥬", "1", 4),
  ]);
  assert.equal(r.length, 3);
  assert.ok(
    r.every((d) =>
      d.status === "REVIEW" && d.reasons.includes("판매자가 안내한 재고 초과")
    ),
  );
});
test("unknown stock does not block confirmation", () => {
  assert.equal(
    replay([t("a", "가격 1.5", 0), t("b", "햇살언니께 드리겠습니다", 10)], [
      c("1", "햇살", "ㅈㅇ", 2),
    ])[0].status,
    "CONFIRMED",
  );
});
test("prefix alias uses exact comment nickname", () => {
  assert.equal(
    replay([t("b", "가윤 언니 챙겨줄게. 금액은 0.8", 10)], [
      c("1", "가윤♡예준맘", "저요", 2),
    ])[0].nickname,
    "가윤♡예준맘",
  );
});
test("STT typo matches an unambiguous buyer request", () => {
  assert.equal(
    replay([t("b", "네스트언니 챙겨드릴게요 1.5", 10)], [
      c("1", "넥스트", "제가 살게요", 2),
    ])[0].nickname,
    "넥스트",
  );
});
test("nickname conflicts stay pending", () => {
  assert.equal(
    replay([t("b", "가윤언니 챙겨드릴게요 1.5", 10)], [
      c("1", "가윤", "저요", 2),
      c("2", "가윤♡예준맘", "저요", 3),
    ])[0].status,
    "REVIEW",
  );
});
test("measurement, demonstration, questions and conditional gifts create no sales", () => {
  for (
    const text of [
      "햇살언니 가단 재 드릴게요 1.5",
      "햇살언니 원피스 보여 드릴게요 1.5",
      "햇살언니 드릴까요 1.5?",
      "햇살언니 입금하시면 드릴게요 1.5",
      "아까 햇살언니 드렸어요 1.5",
    ]
  ) {
    assert.deepEqual(
      replay([t("a", text, 10)], [c("1", "햇살", "저요", 2)]),
      [],
      text,
    );
  }
});
test("withdrawn request is not confirmed", () => {
  assert.equal(
    replay([t("b", "햇살언니 챙겨드릴게요 1.5", 10)], [
      c("1", "햇살", "저요", 2),
      c("2", "햇살", "취소요", 3),
    ])[0].status,
    "REVIEW",
  );
});
test("repeated confirmations allocate a comment only once", () => {
  assert.equal(
    replay([
      t("b", "햇살언니 챙겨드릴게요 1.5", 10),
      t("d", "햇살언니 드릴게요 1.5", 12),
    ], [c("1", "햇살", "저요", 2)]).length,
    1,
  );
});
test("reused order code starts a separate offer and excludes old requests", () => {
  const r = replay([
    t("a", "댓글에 1번 입력 0.5", 0),
    t("b", "햇살언니 드릴게요", 5),
    t("c", "댓글에 1번 입력 0.8", 10),
    t("d", "마가린언니 드릴게요", 15),
  ], [c("1", "햇살", "1", 2), c("2", "마가린", "1", 12)]);
  assert.deepEqual(r.map((d) => d.amount), [5000, 8000]);
  assert.notEqual(r[0].offerId, r[1].offerId);
});
test("quantity affects total and stock consumption", () => {
  const r = replay([
    t("a", "댓글에 1번 입력 0.5 재고 2개", 0),
    t("b", "햇살언니 드릴게요", 5),
    t("d", "마가린언니 드릴게요", 15),
  ], [c("1", "햇살", "1번 2개", 2), c("2", "마가린", "1", 12)]);
  assert.equal(r[0].amount, 10000);
  assert.equal(r[0].quantity, 2);
  assert.equal(r[1].status, "REVIEW");
});
test("unsupported modules and executable regex are rejected", () => {
  assert.throws(() =>
    validateWorkflowProfile({
      ...DEFAULT_WORKFLOW_PROFILE,
      modules: ["UNRESTRICTED_CODE"],
    })
  );
  assert.throws(() =>
    validateWorkflowProfile({
      ...DEFAULT_WORKFLOW_PROFILE,
      confirmationExpressions: ["x"],
    })
  );
});
test("analysis input requires timestamped structured evidence", () => {
  assert.throws(() =>
    normalizeAnalysisInput({
      sellerName: "seller",
      adminDescription: "",
      commentText: "",
      transcriptText: "",
      comments: [{
        id: "x",
        nickname: "x",
        content: "저요",
        capturedAt: "yesterday",
      }],
    })
  );
});
test("report parser refuses invalid runtime profiles", () => {
  assert.throws(() =>
    parseAnalysisReport(
      JSON.stringify({
        summary: "test",
        supportAssessment: "SUPPORTED",
        profile: { schemaVersion: 1, modules: ["CODEGEN"] },
      }),
    )
  );
});
test("price declaration after allocation completes the same decision", () => {
  const r = replay([
    t("a", "햇살언니 챙겨드릴게요", 10),
    t("b", "금액은 1.5 입니다.", 15),
  ], [c("1", "햇살", "저요", 2)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "CONFIRMED");
  assert.equal(r[0].amount, 15000);
});
test("measurements after explicit price never replace price", () => {
  const r = replay([
    t("a", "햇살언니 챙겨드릴게요. 금액은 1.0, 가단 60.5에 총장 89.5.", 10),
  ], [c("1", "햇살", "저요", 2)]);
  assert.equal(r[0].amount, 10000);
});
test("product switch without a price does not inherit previous price", () => {
  const r = replay([
    t("a", "댓글에 1번 입력 0.5", 0),
    t("b", "다음 상품입니다.", 5),
    t("d", "햇살언니 드릴게요", 10),
  ], [c("1", "햇살", "저요", 7)]);
  assert.equal(r[0].status, "REVIEW");
  assert.equal(r[0].unitPrice, 0);
});
test("slightly delayed numbered comment resolves the same pending decision", () => {
  const speech = [
    t("a", "댓글에 1번 입력 0.5", 0),
    t("b", "햇살언니 드릴게요", 10),
  ];
  const pending = replay(speech, [])[0];
  const resolved = replay(speech, [c("1", "햇살", "1번", 12)])[0];
  assert.equal(pending.id, resolved.id);
  assert.equal(resolved.status, "CONFIRMED");
  assert.equal(resolved.nickname, "햇살");
});
test("numbered purchase variations are supported without reading decimal prices as order codes", () => {
  for (
    const text of [
      "1",
      "1번",
      "1번이요",
      "1번저요",
      "1번 주세요",
      "１번",
      "1번2개",
      "1 저요",
    ]
  ) assert.equal(extractCommentOrderCode(text), "1", text);
  for (const text of ["1.5", "1만원", "11번"]) {
    assert.notEqual(extractCommentOrderCode(text), "1", text);
  }
});
test("delayed comments across a product boundary are never borrowed by the earlier offer", () => {
  const r = replay([
    t("a", "댓글에 1번 입력 0.5", 0),
    t("b", "햇살언니 드릴게요", 10),
    t("c", "다음 상품 댓글에 1번 입력 0.8", 11),
  ], [c("1", "햇살", "1번", 12)]);
  assert.equal(r[0].status, "REVIEW");
  assert.equal(r[0].requestId, undefined);
});
