import test from "node:test";
import assert from "node:assert/strict";
import { executeAiPrompt } from "../supabase/functions/sales-api/handlers/aiAdapters/index.ts";

const responseSchema = { name: 'test_response', schema: { type: 'object', additionalProperties: false,
  properties: { summary: { type: 'string' } }, required: ['summary'] } };
const localOptions = (provider = 'LM_STUDIO') => ({
  slotConfig: { type: 'LOCAL', provider, model: 'saved-model', endpointUrl: 'https://ai.example.com',
    routingMode: 'SERVER_DIRECT', location: 'EXTERNAL_IP', authType: 'BEARER', timeoutSeconds: 1 },
  secretValue: 'SECRET',
});

test('LM Studio generic prompts opt into the documented strict JSON Schema payload without changing the token budget', async () => {
  const original = globalThis.fetch, bodies = [];
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://ai.example.com/v1/chat/completions');
      bodies.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: '{}' } }] });
    };
    const prompt = { systemPrompt: 'JSON', userPrompt: 'source evidence' };
    assert.equal((await executeAiPrompt({ ...prompt, responseSchema }, localOptions())).content, '{}');
    assert.equal((await executeAiPrompt(prompt, localOptions())).content, '{}');
    assert.deepEqual(bodies[0].response_format, { type: 'json_schema', json_schema: { ...responseSchema, strict: true } });
    assert.equal(bodies[0].max_tokens, 4096);
    assert.equal(bodies[1].response_format, undefined);
    const { response_format: _format, ...unchanged } = bodies[0];
    assert.deepEqual(unchanged, bodies[1]);
  } finally { globalThis.fetch = original; }
});

test('schema opt-in leaves cloud and other self-hosted provider formats unchanged', async () => {
  const original = globalThis.fetch;
  try {
    for (const provider of ['VLLM', 'CUSTOM', 'OLLAMA', 'OPENAI', 'DEEPSEEK']) {
      const bodies = [];
      globalThis.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: '{}' } }] });
      };
      const options = localOptions(provider);
      if (provider === 'OPENAI' || provider === 'DEEPSEEK') options.slotConfig.type = 'CLOUD';
      const prompt = { systemPrompt: 'JSON', userPrompt: 'source evidence', maxOutputTokens: 8192 };
      await executeAiPrompt({ ...prompt, responseSchema }, options);
      await executeAiPrompt(prompt, options);
      assert.equal(bodies.length, 2);
      assert.deepEqual(bodies[0], bodies[1], `${provider} must not inherit LM Studio schema settings`);
    }
  } finally { globalThis.fetch = original; }
});

test('LM Studio unsupported response_format 400 retains one fallback retry without the schema', async () => {
  const original = globalThis.fetch, bodies = [];
  try {
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? Response.json({ error: 'response_format is unsupported' }, { status: 400 })
        : Response.json({ choices: [{ message: { content: '{"summary":"valid"}' } }] });
    };
    const result = await executeAiPrompt({ systemPrompt: 'JSON', userPrompt: 'source', responseSchema, maxOutputTokens: 4096 }, localOptions());
    assert.equal(result.content, '{"summary":"valid"}');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].response_format.type, 'json_schema');
    assert.equal(bodies[1].response_format, undefined);
    const { response_format: _format, ...first } = bodies[0];
    assert.deepEqual(first, bodies[1]);
  } finally { globalThis.fetch = original; }
});

test('LM Studio context errors do not trigger a schema fallback or hide the original error', async () => {
  const original = globalThis.fetch;
  let count = 0;
  try {
    globalThis.fetch = async () => { count++; return Response.json({ error: 'Context size exceeded' }, { status: 400 }); };
    const result = await executeAiPrompt({ systemPrompt: 'JSON', userPrompt: 'source', responseSchema }, localOptions());
    assert.equal(count, 1);
    assert.equal(result.content, null);
    assert.match(result.error, /HTTP 400.*Context size exceeded/);
  } finally { globalThis.fetch = original; }
});

test("cloud execution uses the saved provider even if legacy slot metadata says PC_HELPER", async () => {
  const original = globalThis.fetch;
  let body;
  try {
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    };
    const result = await executeAiPrompt({ systemPrompt: "JSON", userPrompt: "evidence" }, {
      slotConfig: { type: "CLOUD", provider: "OPENAI", model: "existing-saved-model", endpointUrl: "https://ai.example.com/chat/completions", routingMode: "PC_HELPER", location: "SAME_PC", authType: "BEARER", timeoutSeconds: 1 },
      secretValue: "SECRET",
    });
    assert.equal(result.content, "{}");
    assert.equal(body.model, "existing-saved-model");
    assert.equal(result.execution.routingMode, "SERVER_DIRECT");
  } finally { globalThis.fetch = original; }
});

for (const [type, provider, response, budget] of [
  ["CLOUD", "OPENAI", { choices: [{ message: { content: "{}" } }] }, (b) => b.max_tokens],
  ["CLOUD", "DEEPSEEK", { choices: [{ message: { content: "{}" } }] }, (b) => b.max_tokens],
  ["CLOUD", "ANTHROPIC", { content: [{ text: "{}" }] }, (b) => b.max_tokens],
  ["CLOUD", "GOOGLE", { candidates: [{ content: { parts: [{ text: "{}" }] } }] }, (b) => b.generationConfig.maxOutputTokens],
  ["LOCAL", "LM_STUDIO", { choices: [{ message: { content: "{}" } }] }, (b) => b.max_tokens],
  ["LOCAL", "OLLAMA", { message: { content: "{}" } }, (b) => b.options.num_predict],
]) {
  test(`${provider} accepts the full-snapshot output budget without changing default prompts`, async () => {
    const original = globalThis.fetch;
    let body;
    try {
      globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return Response.json(response); };
      const result = await executeAiPrompt({ systemPrompt: "JSON", userPrompt: "full evidence", maxOutputTokens: 8192 }, {
        slotConfig: { type, provider, model: "test-model", endpointUrl: "https://ai.example.com", routingMode: "SERVER_DIRECT", location: "EXTERNAL_IP", authType: "BEARER", timeoutSeconds: 1 },
        secretValue: "SECRET",
      });
      assert.equal(result.content, "{}");
      assert.equal(budget(body), 8192);
    } finally { globalThis.fetch = original; }
  });
}
