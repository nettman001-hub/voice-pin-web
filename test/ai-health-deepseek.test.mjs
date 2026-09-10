import test from 'node:test';
import assert from 'node:assert/strict';
import { runCloudResolution } from '../supabase/functions/sales-api/handlers/aiAdapters/cloudAdapter.ts';
import { checkTier1Connection } from '../supabase/functions/sales-api/handlers/aiHealthCore.ts';
import aiHealthHandler from '../api/ai-health.ts';

// 1. DeepSeek reasoner 모델의 파라미터 제약 검증 (temperature, response_format 제외)
test('DeepSeek: deepseek-reasoner must omit temperature and response_format to avoid HTTP 400', async () => {
  let capturedBody = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"resolvable": true, "targetSaleId": "sale_1", "changes": {"amount": {"to": 12000}}}',
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await runCloudResolution(
      {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'ws_1',
        sessionId: 'sess_1',
        currentUtterance: 'xx님 가격이 0.9가 아니고 1.2입니다',
        saleCandidates: [{ saleId: 'sale_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' }],
      },
      {
        slotConfig: {
          type: 'CLOUD',
          provider: 'DEEPSEEK',
          model: 'deepseek-reasoner',
          endpointUrl: 'https://api.deepseek.com',
          location: 'EXTERNAL_IP',
          routingMode: 'SERVER_DIRECT',
          authType: 'BEARER',
          timeoutSeconds: 10,
          connectTimeoutSeconds: 5,
        },
        secretApiKey: 'sk-test-deepseek-key',
      }
    );

    assert.ok(result);
    assert.equal(capturedBody.model, 'deepseek-reasoner');
    // deepseek-reasoner does not support temperature or response_format
    assert.equal(capturedBody.temperature, undefined);
    assert.equal(capturedBody.response_format, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 2. DeepSeek chat 모델은 response_format(json_object)과 temperature를 전송함
test('DeepSeek: deepseek-chat supports response_format and temperature', async () => {
  let capturedBody = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"resolvable": true, "targetSaleId": "sale_1", "changes": {"amount": {"to": 12000}}}',
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await runCloudResolution(
      {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'ws_1',
        sessionId: 'sess_1',
        currentUtterance: 'xx님 가격이 0.9가 아니고 1.2입니다',
        saleCandidates: [{ saleId: 'sale_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' }],
      },
      {
        slotConfig: {
          type: 'CLOUD',
          provider: 'DEEPSEEK',
          model: 'deepseek-chat',
          endpointUrl: '',
          location: 'EXTERNAL_IP',
          routingMode: 'SERVER_DIRECT',
          authType: 'BEARER',
          timeoutSeconds: 10,
          connectTimeoutSeconds: 5,
        },
        secretApiKey: 'sk-test-deepseek-key',
      }
    );

    assert.ok(result);
    assert.equal(capturedBody.model, 'deepseek-chat');
    assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
    assert.equal(capturedBody.temperature, 0.1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 3. 자체 운영 LLM 외부 IP (HTTP://...:1235/v1) Tier 1 연결 검사 허용 검증
test('Tier 1 Connection: allows HTTP external IP (e.g. nettman.iptime.org:1235) without SSRF blocking', async () => {
  let probedUrl = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    probedUrl = url;
    return new Response(JSON.stringify({
      data: [{ id: 'gemma-4-e4b-it', object: 'model' }],
      object: 'list',
    }), { status: 200 });
  };

  try {
    const res = await checkTier1Connection(
      {
        type: 'LOCAL',
        provider: 'LM_STUDIO',
        model: 'gemma-4-e4b-it',
        endpointUrl: 'http://nettman.iptime.org:1235/v1',
        location: 'EXTERNAL_IP',
        routingMode: 'SERVER_DIRECT',
        authType: 'NONE',
        timeoutSeconds: 10,
        connectTimeoutSeconds: 5,
      },
      undefined,
      true // allowInsecureHttpForExternal
    );

    assert.equal(res.ok, true);
    assert.equal(res.status, 'SUCCESS');
    assert.equal(probedUrl, 'http://nettman.iptime.org:1235/v1/models');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 4. Vercel Serverless Function api/ai-health 핸들러 동작 검증
test('Vercel API: api/ai-health handler returns valid AiSlotHealth with TIER1', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      data: [{ id: 'gemma-4-e4b-it' }],
    }), { status: 200 });
  };

  try {
    let responseStatus = 0;
    let responseJson = null;

    const req = {
      method: 'POST',
      body: {
        slotNumber: 1,
        tier: 'TIER1',
        tempSlotConfig: {
          type: 'LOCAL',
          provider: 'LM_STUDIO',
          model: 'gemma-4-e4b-it',
          endpointUrl: 'http://nettman.iptime.org:1235/v1',
          location: 'EXTERNAL_IP',
          routingMode: 'SERVER_DIRECT',
        },
      },
    };

    const res = {
      setHeader: () => {},
      status: (code) => { responseStatus = code; return res; },
      json: (data) => { responseJson = data; return res; },
      end: () => {},
    };

    await aiHealthHandler(req, res);

    assert.equal(responseStatus, 200);
    assert.equal(responseJson.ok, true);
    assert.equal(responseJson.health.overallStatus, 'AVAILABLE');
    assert.equal(responseJson.health.tier1.ok, true);
    assert.equal(responseJson.health.tier1.status, 'SUCCESS');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
