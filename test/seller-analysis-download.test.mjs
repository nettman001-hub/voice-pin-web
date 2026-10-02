import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAnalysisInput } from "../src/services/sellerAnalysisRules.ts";

const input = {
  sellerName: "테스트 판매자",
  sellerUserId: null,
  broadcastUsername: "test",
  sessionId: "broadcast",
  adminDescription: "번호 주문 후 구매자를 호명합니다.",
  commentText: "참고 댓글",
  transcriptText: "참고 멘트",
  comments: [{
    id: "comment",
    sessionId: "broadcast",
    platformUserId: "buyer",
    nickname: "햇살♡",
    content: "1번 저요",
    capturedAt: "2026-10-02T01:00:00Z",
  }],
  transcripts: [{
    id: "speech",
    text: "햇살언니 0.5에 드릴게요",
    recognizedAt: "2026-10-02T01:00:10Z",
  }],
};
const compiled = ts.transpileModule(
  fs.readFileSync(
    new URL(
      "../src/pages/admin/SellerAnalysisPage.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  },
).outputText;

function fixture() {
  const cells = [], downloads = [], blobs = [], revoked = [], apiCalls = [];
  let index = 0;
  const react = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } };
    },
    useState(initial) {
      const i = index++;
      if (!(i in cells)) {
        cells[i] = typeof initial === "function" ? initial() : initial;
      }
      return [cells[i], (next) => {
        cells[i] = typeof next === "function" ? next(cells[i]) : next;
      }];
    },
    useRef(initial) {
      const i = index++;
      return cells[i] ||= { current: initial };
    },
    useEffect() {},
  };
  const imports = {
    react: { __esModule: true, default: react, ...react },
    "../../context/AppDataContext": { useAppData: () => ({ allMembers: [] }) },
    "../../context/LiveContext": { useLive: () => ({ isListening: false }) },
    "../../context/CommentCaptureContext": {
      useCommentCapture: () => ({ isActive: false }),
    },
    "../../services/sellerAnalysisApi": {
      createSellerAnalysisInput: () => structuredClone(input),
      sameSellerAnalysisInput: () => true,
      canApproveSellerAnalysis: () => false,
      sellerAnalysisApi: new Proxy({}, {
        get: (_target, key) => () => {
          apiCalls.push(key);
          throw new Error("Download must not call the server");
        },
      }),
    },
    "../../services/sellerAnalysisCapture": { SellerAnalysisCapture: class {} },
    "../../services/sellerAnalysisRules": { normalizeAnalysisInput },
    "../../types/sellerAnalysis": { SELLER_ANALYSIS_SLOT_TIMEOUT_SECONDS: 120 },
    "./SellerAnalysisAttempts": {
      default: () => null,
      collectSellerAnalysisAttempts: () => [],
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Blob,
    require(name) {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return "blob:analysis-download";
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    document: {
      createElement(type) {
        assert.equal(type, "a");
        return {
          click() {
            downloads.push({ href: this.href, filename: this.download });
          },
        };
      },
    },
  });
  return {
    downloads,
    blobs,
    revoked,
    apiCalls,
    render() {
      index = 0;
      return module.exports.default();
    },
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree == null || typeof tree === "boolean") return [];
  return [
    tree,
    ...(typeof tree === "object" ? nodes(tree.props?.children) : []),
  ];
}
const text = (tree) =>
  nodes(tree).filter((n) => typeof n === "string").join("");
const downloadButton = (tree) =>
  nodes(tree).find((n) => n.type === "button" && text(n) === "자료다운로드");

test("download is beside save and outside the collapsed import section", () => {
  const ctx = fixture(), tree = ctx.render();
  const row = nodes(tree).find((n) =>
    n.type === "div" &&
    n.props.children[0]?.type === "button" &&
    text(n.props.children[0]) === "자료 저장"
  );
  assert.ok(row);
  assert.equal(row.props.children[1], downloadButton(tree));
  assert.equal(row.props.children[2].type, "select");
  const details = nodes(tree).find((n) => n.type === "details");
  assert.equal(downloadButton(details), undefined);
  assert.equal(
    nodes(tree).filter((n) => n.type === "button" && text(n) === "자료다운로드")
      .length,
    1,
  );
});

test("download exports current unsaved comments, speech and form data without saving or analyzing", async () => {
  const ctx = fixture();
  let tree = ctx.render();
  nodes(tree).find((n) => n.props?.["aria-label"] === "판매자 멘트 참고 자료")
    .props.onChange({ target: { value: "수정한 미저장 멘트\n금액 0.5" } });
  tree = ctx.render();
  downloadButton(tree).props.onClick();
  assert.deepEqual(ctx.downloads, [{
    href: "blob:analysis-download",
    filename: "voicecap-판매방식-분석자료.json",
  }]);
  assert.equal(ctx.blobs[0].type, "application/json");
  const saved = JSON.parse(await ctx.blobs[0].text());
  assert.deepEqual(saved, {
    ...input,
    transcriptText: "수정한 미저장 멘트\n금액 0.5",
  });
  assert.deepEqual(normalizeAnalysisInput(saved), saved);
  assert.deepEqual(ctx.revoked, ["blob:analysis-download"]);
  assert.deepEqual(ctx.apiCalls, []);
});
