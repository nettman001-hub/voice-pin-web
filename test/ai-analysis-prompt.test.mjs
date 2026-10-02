import test from "node:test";
import assert from "node:assert/strict";
import { executeAiPrompt } from "../supabase/functions/sales-api/handlers/aiAdapters/index.ts";
const slot = {
  type: "CLOUD",
  provider: "OPENAI",
  model: "test",
  endpointUrl: "https://ai.example.com/chat/completions",
  routingMode: "SERVER_DIRECT",
  location: "EXTERNAL_IP",
  authType: "BEARER",
  timeoutSeconds: 1,
};
test("analysis prompts use shared transport without normalizing output as a sale", async () => {
  const original = globalThis.fetch;
  let body;
  try {
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [{
            message: { content: '{"summary":"report","profile":{}}' },
          }],
        }),
        { status: 200 },
      );
    };
    const result = await executeAiPrompt({
      systemPrompt: "Analyze JSON",
      userPrompt: "Broadcast evidence",
    }, { slotConfig: slot, secretValue: "SECRET" });
    assert.equal(body.messages[0].content, "Analyze JSON");
    assert.equal(body.messages[1].content, "Broadcast evidence");
    assert.equal(result.content, '{"summary":"report","profile":{}}');
  } finally {
    globalThis.fetch = original;
  }
});
test("PC_HELPER is explicitly rejected on server without a dispatcher", async () => {
  const result = await executeAiPrompt({
    systemPrompt: "JSON",
    userPrompt: "input",
  }, {
    slotConfig: {
      ...slot,
      type: "LOCAL",
      routingMode: "PC_HELPER",
      location: "SAME_PC",
      endpointUrl: "http://127.0.0.1:1234",
    },
  });
  assert.equal(result.content, null);
  assert.match(result.error, /PC 도우미/);
});
test("provider errors and traces never expose supplied secrets", async () => {
  const original = globalThis.fetch;
  let trace;
  try {
    globalThis.fetch = async () =>
      new Response("SECRET failed", { status: 400 });
    const result = await executeAiPrompt({
      systemPrompt: "JSON",
      userPrompt: "input",
    }, {
      slotConfig: slot,
      secretValue: "SECRET",
      onConversationTrace: (v) => trace = v,
    });
    assert.equal(result.content, null);
    assert.ok(!result.error.includes("SECRET"));
    assert.ok(!trace.responseText.includes("SECRET"));
    assert.equal(trace.httpStatus, 400);
  } finally {
    globalThis.fetch = original;
  }
});
test("deadline returns even when the provider ignores cancellation", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => new Promise(() => {});
    const started = Date.now();
    const result = await executeAiPrompt({
      systemPrompt: "JSON",
      userPrompt: "input",
    }, {
      slotConfig: { ...slot, timeoutSeconds: 0.05 },
      secretValue: "SECRET",
    });
    assert.equal(result.content, null);
    assert.match(result.error, /대기시간/);
    assert.ok(Date.now() - started < 1000);
  } finally {
    globalThis.fetch = original;
  }
});
