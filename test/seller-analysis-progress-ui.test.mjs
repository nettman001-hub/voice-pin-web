import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/pages/admin/SellerAnalysisPage.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const input = { sellerName: "판매자", sellerUserId: null, adminDescription: "", commentText: "저요", transcriptText: "햇살 언니 드릴게요" };
const base = { id: "analysis", input, revision: 1, status: "DRAFT", reports: [], messages: [], currentReportVersion: null, approvedAt: null, lastError: null };
const first = { slot: 2, model: "deepseek", startedAt: "2026-10-03T00:00:00Z", error: "답변 형식 확인 실패" };
function Attempts() {}
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree == null || typeof tree === "boolean" ? [] : [tree, ...(typeof tree === "object" ? nodes(tree.props?.children) : [])];
const text = (tree) => nodes(tree).filter((n) => typeof n === "string" || typeof n === "number").join("");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(initial = base) {
  const cells = [], effects = [], cleanups = [], calls = [];
  let index = 0, stateWrites = 0;
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initialValue) {
      const cell = index++;
      if (!(cell in cells)) cells[cell] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [cells[cell], (value) => { stateWrites++; cells[cell] = typeof value === "function" ? value(cells[cell]) : value; }];
    },
    useRef(value) { const cell = index++; return cells[cell] ||= { current: value }; },
    useEffect(effect) { const cell = index++; if (!(cell in cells)) { cells[cell] = true; effects.push(effect); } },
  };
  const api = {
    list: async () => [initial], get: async () => initial,
    analyze(document, feedback, slotNumber, progress) {
      const call = { document, feedback, slotNumber, progress };
      calls.push(call);
      progress({ phase: document.status === "ANALYZING" ? "FALLBACK" : "ANALYZING", activeSlot: slotNumber });
      return new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));
    },
  };
  const imports = {
    react: { __esModule: true, default: react, ...react },
    "../../context/AppDataContext": { useAppData: () => ({ allMembers: [], refreshMembers() {} }) },
    "../../context/LiveContext": { useLive: () => ({ isListening: false }) },
    "../../context/CommentCaptureContext": { useCommentCapture: () => ({ isActive: false }) },
    "../../services/sellerAnalysisApi": { sellerAnalysisApi: api, createSellerAnalysisInput: () => input, sameSellerAnalysisInput: (a, b) => JSON.stringify(a) === JSON.stringify(b), canApproveSellerAnalysis: () => false },
    "../../services/sellerAnalysisCapture": { SellerAnalysisCapture: class {} },
    "../../services/sellerAnalysisRules": { normalizeAnalysisInput: (value) => value },
    "../../types/sellerAnalysis": { SELLER_ANALYSIS_SLOT_TIMEOUT_SECONDS: 120 },
    "./SellerAnalysisAttempts": { __esModule: true, default: Attempts, collectSellerAnalysisAttempts: (messages) => messages.flatMap((message) => message.attempts || []) },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) { assert.ok(name in imports, name); return imports[name]; },
  });
  return {
    calls,
    get stateWrites() { return stateWrites; },
    render() { index = 0; const tree = module.exports.default(); while (effects.length) { const cleanup = effects.shift()(); if (cleanup) cleanups.push(cleanup); } return tree; },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
    async open() {
      this.render(); await settle();
      nodes(this.render()).find((node) => node.type === "button" && text(node).startsWith("판매자")).props.onClick();
      await settle();
    },
  };
}

test("UI retains the handoff revision and previous failure after a fallback connection error", async () => {
  const ctx = fixture(); await ctx.open();
  let tree = ctx.render();
  nodes(tree).find((node) => node.props?.["aria-label"] === "분석 AI 슬롯").props.onChange({ target: { value: "2" } });
  tree = ctx.render();
  nodes(tree).find((node) => node.type === "button" && text(node) === "AI 판매방식 분석").props.onClick();
  assert.ok(text(ctx.render()).includes("2번슬롯 AI 응답을 기다리고 있습니다."));
  const pending = { ...base, revision: 3, status: "ANALYZING", messages: [{ id: "fallback", role: "SYSTEM", content: "대체 분석", attempts: [first], continuation: { requestedSlot: 2, nextSlot: 1 } }] };
  ctx.calls[0].progress({ phase: "FALLBACK", activeSlot: 1, analysis: pending });
  tree = ctx.render();
  assert.ok(text(tree).includes("1번슬롯 AI 응답을 기다리고 있습니다."));
  assert.ok(text(tree).includes("deepseek: 답변 형식 확인 실패"));
  ctx.calls[0].reject(new Error("연결 끊김")); await settle();
  tree = ctx.render();
  assert.ok(text(tree).includes("연결 끊김"));
  assert.ok(nodes(tree).some((node) => node.type === Attempts && node.props.attempts[0] === first));
  nodes(tree).find((node) => node.type === "button" && text(node) === "AI 판매방식 분석").props.onClick();
  assert.equal(ctx.calls[1].document.revision, 3);
  assert.equal(ctx.calls[1].document, pending);
  ctx.calls[1].resolve({ ...pending, status: "FAILED" }); await settle();
});

test("opening failed records does not replace the explicitly selected report's original attempts", async () => {
  const report = { summary: "보고서", supportAssessment: "SUPPORTED", inventoryRule: "재고 발화 시 검사", profile: {}, ...Object.fromEntries(["workflow", "purchaseSignals", "confirmationSignals", "priceRules", "nicknameRules", "exceptions", "unknowns", "suggestions"].map((key) => [key, []])) };
  const older = { version: 1, report, attempts: [{ ...first, model: "이전 모델" }] };
  const newer = { version: 2, report, attempts: [{ ...first, model: "새 모델" }] };
  const failed = { ...base, status: "FAILED", lastError: "대체 슬롯도 실패했습니다.", currentReportVersion: 2, reports: [older, newer], messages: [{ id: "m", role: "SYSTEM", attempts: [first] }] };
  const ctx = fixture(failed); await ctx.open();
  nodes(ctx.render()).find((node) => node.props?.["aria-label"] === "보고서 버전").props.onChange({ target: { value: "1" } });
  const viewers = nodes(ctx.render()).filter((node) => node.type === Attempts);
  assert.equal(viewers.length, 2);
  assert.equal(viewers[0].props.attempts[0], first);
  assert.equal(viewers[1].props.attempts, older.attempts);
  assert.equal(failed.currentReportVersion, 2);
});

test("late progress callbacks do not update a closed analysis screen", async () => {
  const ctx = fixture(); await ctx.open();
  nodes(ctx.render()).find((node) => node.type === "button" && text(node) === "AI 판매방식 분석").props.onClick();
  ctx.unmount(); const before = ctx.stateWrites;
  ctx.calls[0].progress({ phase: "FALLBACK", activeSlot: 1, analysis: { ...base, revision: 3, status: "ANALYZING" } });
  assert.equal(ctx.stateWrites, before);
  ctx.calls[0].resolve({ ...base, status: "FAILED" }); await settle();
});
