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
