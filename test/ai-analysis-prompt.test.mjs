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
test("DeepSeek analysis explicitly disables thinking and bounds output without changing legacy reasoner mode", async () => {
  const original = globalThis.fetch;
  const bodies = [];
  try {
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"summary":"report"}' } }] });
    };
    for (const model of ["deepseek-flash", "deepseek-reasoner"]) {
      const result = await executeAiPrompt({ systemPrompt: "JSON", userPrompt: "evidence" }, {
        slotConfig: { ...slot, provider: "DEEPSEEK", model }, secretValue: "SECRET",
      });
      assert.equal(result.content, '{"summary":"report"}');
    }
    assert.deepEqual(bodies[0].thinking, { type: "disabled" });
    assert.equal(bodies[0].max_tokens, 4096);
    assert.equal(bodies[1].thinking, undefined);
    assert.equal(bodies[1].max_tokens, 4096);
  } finally { globalThis.fetch = original; }
});

for (const [type, provider, response] of [
  ["CLOUD", "DEEPSEEK", { choices: [{ finish_reason: "length", message: { content: '{"summary":"partial' } }] }],
  ["LOCAL", "LM_STUDIO", { choices: [{ finish_reason: "length", message: { content: '{"summary":"partial' } }] }],
  ["LOCAL", "OLLAMA", { done_reason: "length", message: { content: '{"summary":"partial' } }],
]) {
  test(`${provider} truncated analysis retains evidence and reports output limit instead of an invalid report`, async () => {
    const original = globalThis.fetch;
    let trace, body;
    try {
      globalThis.fetch = async (_url, options) => {
        body = JSON.parse(options.body);
        return Response.json(response);
      };
      const result = await executeAiPrompt({ systemPrompt: "JSON", userPrompt: "evidence" }, {
        slotConfig: { ...slot, type, provider, model: "test" }, secretValue: "SECRET",
        onConversationTrace: (v) => { trace = v; },
      });
      assert.equal(result.content, null);
      assert.equal(result.errorCode, "OUTPUT_LIMIT");
      assert.match(trace.responseText, /partial/);
      assert.equal(trace.httpStatus, 200);
      assert.equal(provider === "OLLAMA" ? body.options.num_predict : body.max_tokens, 4096);
    } finally { globalThis.fetch = original; }
  });
}
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

for (const type of ["LOCAL", "CLOUD"]) {
  test(`${type} analysis waits the full 120 seconds and then aborts`, async (t) => {
    const original = globalThis.fetch;
    let signal;
    let completed = false;
    try {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      globalThis.fetch = (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      };
      const pending = executeAiPrompt({
        systemPrompt: "JSON",
        userPrompt: "Broadcast evidence",
      }, {
        slotConfig: {
          ...slot,
          type,
          provider: type === "LOCAL" ? "LM_STUDIO" : "OPENAI",
          timeoutSeconds: 120,
        },
        secretValue: "SECRET",
      }).then((result) => {
        completed = true;
        return result;
      });
      assert.ok(signal);
      t.mock.timers.tick(119_999);
      await Promise.resolve();
      assert.equal(completed, false);
      assert.equal(signal.aborted, false);
      t.mock.timers.tick(1);
      const result = await pending;
      assert.equal(signal.aborted, true);
      assert.equal(result.content, null);
      assert.match(result.error, /대기시간/);
    } finally {
      globalThis.fetch = original;
      t.mock.timers.reset();
    }
  });
}

test("analysis accepts an answer after the old deadline but before 120 seconds", async (t) => {
  const original = globalThis.fetch;
  let release;
  let signal;
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = (_url, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const pending = executeAiPrompt({
      systemPrompt: "JSON",
      userPrompt: "Broadcast evidence",
    }, { slotConfig: { ...slot, timeoutSeconds: 120 }, secretValue: "SECRET" });
    t.mock.timers.tick(119_000);
    release(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"late report"}' } }],
        }),
        { status: 200 },
      ),
    );
    const result = await pending;
    assert.equal(result.content, '{"summary":"late report"}');
    t.mock.timers.tick(2000);
    assert.equal(signal.aborted, false);
  } finally {
    globalThis.fetch = original;
    t.mock.timers.reset();
  }
});
