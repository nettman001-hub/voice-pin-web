import test from 'node:test';
import assert from 'node:assert/strict';
import { runCloudResolution } from '../supabase/functions/sales-api/handlers/aiAdapters/cloudAdapter.ts';
import { runSelfHostedResolution } from '../supabase/functions/sales-api/handlers/aiAdapters/selfHostedAdapter.ts';

const request = {
  taskType: 'PENDING_RESOLUTION', workspaceId: 'ws-test', sessionId: 'session-test',
  currentUtterance: '이뿌쥬 언니 챙겨드릴게요, 0.8.',
  relevantComments: [{ commentId: 'comment-1', nickname: '이뿌쥬~^^', text: 'ㅈㅇ' }],
};
const slotConfig = { type: 'CLOUD', slotNumber: 2, provider: 'OPENAI', model: 'test-model' };
const output = '```json\n' + JSON.stringify({ resolvable: false, action: 'INSUFFICIENT_DATA',
  targetSaleId: null, changes: null, evidenceIds: [], evidenceSummary: '추가 근거 필요',
  missingInfo: ['판매 후보'], conflictReason: null }) + '\n```';

test('cloud trace captures exact dispatched prompts and unnormalized assistant answer', async () => {
  const originalFetch = globalThis.fetch;
  let body;
  const snapshots = [];
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    assert.equal(snapshots.length, 1, 'prompt must already exist before awaiting transport');
    return { ok: true, status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: output } }] }) };
  };
  try {
    await runCloudResolution(request, { slotConfig, secretApiKey: 'test-secret-value',
      onConversationTrace: trace => snapshots.push(trace) });
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].responseText, undefined, 'published snapshot must be immutable');
    assert.equal(snapshots[1].systemPrompt, body.messages[0].content);
    assert.equal(snapshots[1].userPrompt, body.messages[1].content);
    assert.equal(snapshots[1].responseText, output);
    assert.equal(snapshots[1].responseKind, 'MODEL_OUTPUT');
    assert.equal(snapshots[1].httpStatus, 200);
    assert.ok(snapshots[1].requestStartedAt);
    assert.ok(snapshots[1].responseReceivedAt);
    assert.ok(!JSON.stringify(snapshots).includes('test-secret-value'));
  } finally { globalThis.fetch = originalFetch; }
});

test('HTTP errors retain response body with configured secrets redacted', async () => {
  const originalFetch = globalThis.fetch;
  let trace;
  globalThis.fetch = async () => ({ ok: false, status: 401,
    text: async () => '{"error":"invalid key test-secret-value"}' });
  try {
    const result = await runCloudResolution(request, { slotConfig, secretApiKey: 'test-secret-value',
      onConversationTrace: value => { trace = value; } });
    assert.equal(result.resolvable, false);
    assert.equal(trace.httpStatus, 401);
    assert.equal(trace.responseKind, 'HTTP_ERROR');
    assert.equal(trace.responseText, '{"error":"invalid key [비밀정보 숨김]"}');
    assert.ok(!JSON.stringify(result).includes('test-secret-value'), 'failure summaries must not leak echoed credentials');
  } finally { globalThis.fetch = originalFetch; }
});

test('malformed provider envelope is preserved instead of recording an empty answer', async () => {
  const originalFetch = globalThis.fetch;
  let trace;
  const responseBody = '{"error":"unexpected provider error envelope"}';
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => responseBody });
  try {
    await runCloudResolution(request, { slotConfig, secretApiKey: 'test-secret-value',
      onConversationTrace: value => { trace = value; } });
    assert.equal(trace.responseText, responseBody);
  } finally { globalThis.fetch = originalFetch; }
});

test('non-JSON model output remains inspectable even when normalization fails', async () => {
  const originalFetch = globalThis.fetch;
  let trace;
  const text = '죄송합니다. 아직 답변할 수 없습니다.';
  globalThis.fetch = async () => ({ ok: true, status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });
  try {
    const result = await runCloudResolution(request, { slotConfig, secretApiKey: 'test-secret-value',
      onConversationTrace: value => { trace = value; } });
    assert.equal(result.conflictReason, '응답 형식 불일치');
    assert.equal(trace.responseText, text);
  } finally { globalThis.fetch = originalFetch; }
});

test('self-hosted helper trace uses actual dispatched model, prompts and reply', async () => {
  let trace;
  let requestBody;
  const result = await runSelfHostedResolution(request, {
    slotConfig: { type: 'LOCAL', slotNumber: 1, provider: 'OLLAMA', endpointUrl: 'http://localhost:11434',
      location: 'SAME_PC', routingMode: 'PC_HELPER', model: 'test-ollama' },
    onConversationTrace: value => { trace = value; },
    helperDispatcher: async (_url, body) => {
      requestBody = body;
      assert.equal(trace.responseText, undefined);
      return { status: 200, body: JSON.stringify({ message: { content: output } }) };
    },
  });
  assert.equal(result.conflictReason, null);
  assert.equal(trace.systemPrompt, requestBody.messages[0].content);
  assert.equal(trace.userPrompt, requestBody.messages[1].content);
  assert.equal(trace.model, requestBody.model);
  assert.equal(trace.responseText, output);
});

test('self-hosted helper HTTP failures retain the original failure response', async () => {
  let trace;
  await runSelfHostedResolution(request, {
    slotConfig: { type: 'LOCAL', slotNumber: 1, provider: 'OLLAMA', endpointUrl: 'http://localhost:11434',
      location: 'SAME_PC', routingMode: 'PC_HELPER', model: 'test-ollama' },
    onConversationTrace: value => { trace = value; },
    helperDispatcher: async () => ({ status: 503, body: 'LLM is unavailable' }),
  });
  assert.equal(trace.responseKind, 'HTTP_ERROR');
  assert.equal(trace.httpStatus, 503);
  assert.equal(trace.responseText, 'LLM is unavailable');
});
