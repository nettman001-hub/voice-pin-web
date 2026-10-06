import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/services/sellerAnalysisApi.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "analysis-slot-client-fixture",
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({
        path: "supabase",
        namespace: "fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `export const isSupabaseConfigured=true;
          export const requireSupabase=()=>({functions:{invoke:(...args)=>globalThis.analysisSlotClientFixture.invoke(...args)}});`,
      }));
    },
  }],
});
const { sellerAnalysisApi } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

function fixture(responses = []) {
  const calls = [];
  globalThis.analysisSlotClientFixture = {
    async invoke(name, options) {
      calls.push({ name, options });
      return {
        data: {
          ok: true,
          data: {
            analysis: responses.shift() || { id: "analysis", revision: 2 },
          },
        },
      };
    },
  };
  return calls;
}

for (const slotNumber of [1, 2]) {
  test(`analysis client sends selected slot ${slotNumber} with correction feedback`, async () => {
    const calls = fixture();
    const doc = await sellerAnalysisApi.analyze(
      { id: "analysis", revision: 1 },
      "  여러 명 호명을 확인해 주세요.  ",
      slotNumber,
    );
    assert.deepEqual(calls, [{
      name: "sales-api",
      options: {
        body: {
          action: "seller-analysis-analyze",
          id: "analysis",
          expectedRevision: 1,
          slotNumber,
          feedback: "여러 명 호명을 확인해 주세요.",
        },
      },
    }]);
    assert.equal(doc.revision, 2);
  });
}

test("legacy analysis client calls omit slot selection and retain server priority", async () => {
  const calls = fixture();
  await sellerAnalysisApi.analyze({ id: "analysis", revision: 1 });
  assert.deepEqual(calls[0].options.body, {
    action: "seller-analysis-analyze",
    id: "analysis",
    expectedRevision: 1,
  });
});
test("client continues a pending fallback in a second HTTP request using its server revision", async () => {
  const calls = fixture([
    {
      id: "analysis",
      revision: 3,
      status: "ANALYZING",
      messages: [{
        continuation: { requestedSlot: 2, nextSlot: 1 },
      }],
    },
    { id: "analysis", revision: 5, status: "REVIEW", messages: [] },
  ]);
  const result = await sellerAnalysisApi.analyze(
    { id: "analysis", revision: 1 },
    "feedback",
    2,
  );
  assert.equal(result.status, "REVIEW");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options.body, {
    action: "seller-analysis-analyze",
    id: "analysis",
    expectedRevision: 3,
    continueAnalysis: true,
  });
});
test("reopened pending analysis resumes the persisted fallback instead of restarting", async () => {
  const calls = fixture([{
    id: "analysis",
    revision: 5,
    status: "REVIEW",
    messages: [],
  }]);
  await sellerAnalysisApi.analyze(
    {
      id: "analysis",
      revision: 3,
      status: "ANALYZING",
      messages: [{
        continuation: { requestedSlot: 2, nextSlot: 1 },
      }],
    },
    "this must not replace saved feedback",
    1,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.body, {
    action: "seller-analysis-analyze",
    id: "analysis",
    expectedRevision: 3,
    continueAnalysis: true,
  });
});

test("progress reports selected slot, saved fallback evidence and final failure in request order", async () => {
  const attempts = [{ slot: 2, startedAt: "2026-10-03T00:00:00Z", error: "답변 형식 확인 실패" }];
  const pending = {
    id: "analysis", revision: 3, status: "ANALYZING",
    messages: [{ attempts, continuation: { requestedSlot: 2, nextSlot: 1 } }],
  };
  const failed = { ...pending, revision: 5, status: "FAILED", messages: [{ attempts }] };
  const calls = fixture([pending, failed]);
  const events = [];
  const result = await sellerAnalysisApi.analyze(
    { id: "analysis", revision: 1 }, "", 2,
    (event) => events.push({ event, requestCount: calls.length }),
  );
  assert.deepEqual(events.map(({ event, requestCount }) => [event.phase, event.activeSlot, requestCount]), [
    ["ANALYZING", 2, 0], ["FALLBACK", 1, 1], ["COMPLETE", 1, 2],
  ]);
  assert.equal(events[1].event.analysis, pending);
  assert.equal(events[1].event.analysis.messages[0].attempts, attempts);
  assert.equal(events[2].event.analysis, failed);
  assert.equal(result, failed);
});

test("fallback transport failure retains the emitted saved revision and never reports completion", async () => {
  const pending = {
    id: "analysis", revision: 3, status: "ANALYZING",
    messages: [{ attempts: [{ slot: 2, error: "답변 형식 확인 실패" }], continuation: { requestedSlot: 2, nextSlot: 1 } }],
  };
  let requestCount = 0;
  globalThis.analysisSlotClientFixture = {
    async invoke() {
      if (++requestCount === 1) return { data: { ok: true, data: { analysis: pending } } };
      return { error: new Error("네트워크 연결이 끊겼습니다.") };
    },
  };
  const events = [];
  await assert.rejects(sellerAnalysisApi.analyze(
    { id: "analysis", revision: 1 }, "", 2, (event) => events.push(event),
  ), /네트워크 연결/);
  assert.deepEqual(events.map((event) => event.phase), ["ANALYZING", "FALLBACK"]);
  assert.equal(events[1].analysis.revision, 3);
  assert.equal(events[1].analysis.messages[0].attempts[0].error, "답변 형식 확인 실패");
});

test("resuming an analysis reports the saved fallback slot before requesting it", async () => {
  const calls = fixture([{ id: "analysis", revision: 5, status: "REVIEW", messages: [] }]);
  const events = [];
  await sellerAnalysisApi.analyze({
    id: "analysis", revision: 3, status: "ANALYZING",
    messages: [{ continuation: { requestedSlot: 2, nextSlot: 1 } }],
  }, "", 2, (event) => events.push({ event, requestCount: calls.length }));
  assert.deepEqual(events.map(({ event, requestCount }) => [event.phase, event.activeSlot, requestCount]), [
    ["FALLBACK", 1, 0], ["COMPLETE", 1, 1],
  ]);
});

test("legacy selection stays unknown until the server determines it and initial network failure stays incomplete", async () => {
  globalThis.analysisSlotClientFixture = { async invoke() { throw new Error("offline"); } };
  const events = [];
  await assert.rejects(sellerAnalysisApi.analyze({ id: "analysis", revision: 1 }, undefined, undefined,
    (event) => events.push(event)), /offline/);
  assert.deepEqual(events, [{ phase: "ANALYZING", activeSlot: null }]);
});
