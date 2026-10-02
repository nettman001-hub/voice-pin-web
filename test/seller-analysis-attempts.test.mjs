import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const result = await build({
  entryPoints: ["src/pages/admin/SellerAnalysisAttempts.tsx"],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, {
  module, exports: module.exports, require: createRequire(import.meta.url),
});
const { default: Attempts, collectSellerAnalysisAttempts } = module.exports;
const attempt = {
  slot: 2, provider: "DEEPSEEK", model: "deepseek-flash",
  startedAt: "2026-10-03T00:00:00.000Z", completedAt: "2026-10-03T00:01:31.500Z",
  error: "구매 표현은 30개까지 가능합니다.", errorCode: "INVALID_REPORT",
  conversationTrace: {
    systemPrompt: "지침 <script>window.bad=true</script>",
    userPrompt: "질문: 햇살 언니에게 0.5",
    responseText: '{"summary":"<img src=x onerror=bad()>"}',
  },
};

test("failed analysis shows model, duration, reason and complete escaped question and response", () => {
  const html = renderToStaticMarkup(React.createElement(Attempts, { attempts: [attempt] }));
  for (const text of ["2번슬롯", "deepseek-flash", "91.5초", "답변 형식 확인 실패", "30개까지", "AI에게 전달한 지침", "질문: 햇살", "AI 답변"]) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(html.includes("&lt;script&gt;window.bad=true&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=bad()&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
});

test("reopened failed records deduplicate handoff copies without removing same-slot format repairs", () => {
  const repair = { ...attempt, phase: "FORMAT_REPAIR", startedAt: "2026-10-03T00:01:32.000Z", completedAt: "2026-10-03T00:01:40.000Z" };
  const fallback = { ...attempt, slot: 1, errorCode: "TIMEOUT", conversationTrace: { ...attempt.conversationTrace, responseText: "" } };
  const messages = [{ attempts: [attempt, repair] }, { attempts: [attempt, repair, fallback] }];
  const records = collectSellerAnalysisAttempts(messages);
  assert.equal(records.length, 3);
  assert.equal(records[0], attempt);
  assert.equal(records[1], repair);
  const html = renderToStaticMarkup(React.createElement(Attempts, { attempts: records }));
  assert.ok(html.includes("답변 형식 재확인"));
  assert.ok(html.includes("응답 시간 초과"));
  assert.ok(html.includes("받은 답변이 없습니다."));
});
