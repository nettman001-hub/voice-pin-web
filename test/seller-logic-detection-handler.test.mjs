import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { normalizeSellerLogicDetectionInput, sellerLogicDetectionPrompt } from '../src/services/sellerLogicDetection.ts';
import { SELLER_LOGIC_LIMITS } from '../src/types/sellerLogicAnalysis.ts';

const bundle = await build({
  entryPoints: ['supabase/functions/sales-api/handlers/sellerLogicDetection.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'detection-handler-fixture', setup(builder) {
    builder.onResolve({ filter: /_shared\/productSales\.ts$/ }, () => ({ path: 'db', namespace: 'fixture' }));
    builder.onResolve({ filter: /aiOperationalSettings\.ts$/ }, () => ({ path: 'settings', namespace: 'fixture' }));
    builder.onResolve({ filter: /aiAdapters\/index\.ts$/ }, () => ({ path: 'ai', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'db'
      ? `export const admin={from:()=>{globalThis.detectionFixture.secretReads++;return {select:()=>({eq:async()=>({data:[{slot_number:1,secret_value:'KEY1'},{slot_number:2,secret_value:'KEY2'}]})})}}}; export const successResponse=data=>Response.json({ok:true,data}); export const errorResponse=(code,message,status=400)=>Response.json({ok:false,error:{code,message}},{status});`
      : path === 'settings' ? `export const getOperationalAiSetting=async()=>globalThis.detectionFixture.setting;`
      : `export const executeAiPrompt=(...args)=>globalThis.detectionFixture.ai(...args);` }));
  } }],
});
const { handleSellerLogicDetection } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const auth = { actorType: 'USER', role: 'ADMIN' };
const input = () => ({ sessionId: 'detector', slotNumber: 2,
  comments: [{ id: 'c', sessionId: 'detector', nickname: '루비', content: 'ㅈㅇ', capturedAt: '2026-10-05T12:00:01Z' }],
  transcripts: [{ id: 's', text: '루비 언니', recognizedAt: '2026-10-05T12:00:00Z', isFinal: true, utteranceEnded: false, revision: 1 }],
  freshCommentIds: ['c'], freshTranscriptIds: ['s'], existingSignals: [], carry: [],
});
const output = () => ({ summary: '구매 연결 확인이 필요하며 호명 뒤 발화는 미완료입니다.',
  purchaseIntentCommentIds: ['C0'],
  signals: [{ id: null, summary: '구매 요청과 호명 연결 가능성', commentIds: ['C0'], transcriptIds: ['S0'] }],
  carry: [{ reason: '호명 다음 말을 이어 읽어야 함', commentIds: [], transcriptIds: ['S0'] }],
});
function fixture() {
  const fixture = { calls: [], secretReads: 0,
    setting: { id: 'applied', version: 7, applied_version: 6, auto_fallback_enabled: true,
      slot1: { type: 'LOCAL', provider: 'LM_STUDIO', model: 'saved-one', routingMode: 'SERVER_DIRECT' },
      slot2: { type: 'CLOUD', provider: 'DEEPSEEK', model: 'saved-two', routingMode: 'PC_HELPER' } },
    async ai(prompt, options) { fixture.calls.push({ prompt, options }); return { content: JSON.stringify(output()) }; },
  };
  globalThis.detectionFixture = fixture;
  return fixture;
}

test('only authenticated administrators can run first-stage detection', async () => {
  const f = fixture();
  for (const denied of [{ actorType: 'USER', role: 'SELLER' }, { actorType: 'DEVICE', role: 'ADMIN' }]) {
    await assert.rejects(() => handleSellerLogicDetection(denied, { input: input() }), (error) => error.status === 403);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.secretReads, 0);
});

test('normal detection uses the selected existing slot exactly once and returns signals without sale fields', async () => {
  const f = fixture();
  const response = await handleSellerLogicDetection(auth, { input: input() });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.secretReads, 1);
  assert.equal(body.data.appliedVersion, 7);
  assert.equal(body.data.provider, 'DEEPSEEK');
  assert.equal(body.data.model, 'saved-two');
  assert.match(body.data.signals[0].id, /^slsig:/);
  assert.deepEqual(body.data.signals[0].commentIds, ['c']);
  assert.deepEqual(body.data.carry[0].transcriptIds, ['s']);
  assert.equal(body.data.decisions, undefined);
  assert.equal(body.data.signals[0].unitPrice, undefined);
  assert.equal(f.calls[0].options.secretValue, 'KEY2');
  assert.equal(f.calls[0].options.slotConfig.routingMode, 'PC_HELPER');
  assert.equal(f.calls[0].options.slotConfig.type, 'CLOUD');
  assert.ok(f.calls[0].options.slotConfig.timeoutSeconds <= 120);
  assert.doesNotMatch(f.calls[0].prompt.userPrompt, /KEY1|KEY2/);
});

test('slot one preserves the common adapter route and selected credentials without fallback', async () => {
  const f = fixture();
  const response = await handleSellerLogicDetection(auth, { input: { ...input(), slotNumber: 1 } });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.secretValue, 'KEY1');
  assert.equal(f.calls[0].options.slotConfig.model, 'saved-one');
});

test('no fresh or revised source performs no inference and preserves unresolved carry', async () => {
  const f = fixture();
  const previous = input(); previous.freshCommentIds = []; previous.freshTranscriptIds = [];
  previous.carry = [{ reason: '호명 뒤 대기', commentIds: [], transcriptIds: ['s'] }];
  const body = await (await handleSellerLogicDetection(auth, { input: previous })).json();
  assert.equal(f.calls.length, 0);
  assert.equal(f.secretReads, 0);
  assert.deepEqual(body.data.carry, previous.carry);
  assert.deepEqual(body.data.signals, []);
});

test('only contract failure receives one repair on the same slot and no unconditional audit', async () => {
  const f = fixture();
  f.ai = async (prompt, options) => { f.calls.push({ prompt, options }); return { content: f.calls.length === 1 ? '{}' : JSON.stringify(output()) }; };
  const response = await handleSellerLogicDetection(auth, { input: input() });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.slotConfig.model, 'saved-two');
  assert.match(f.calls[1].prompt.userPrompt, /validationError/);
  assert.doesNotMatch(f.calls[1].prompt.systemPrompt, /독립 검증 단계/);
});

test('invalid repaired results never expose partial signals or trigger a third call', async () => {
  const f = fixture();
  f.ai = async (...args) => { f.calls.push(args); return { content: '{}' }; };
  const response = await handleSellerLogicDetection(auth, { input: input() });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'INVALID_AI_DETECTION');
  assert.equal(body.data, undefined);
  assert.equal(f.calls.length, 2);
});

test('provider context errors retain their exact message and stop after one call', async () => {
  const f = fixture();
  const message = 'LLM HTTP 400: {"error":"Context size has been exceeded."}';
  f.ai = async (...args) => { f.calls.push(args); return { content: null, errorCode: 'PROVIDER_ERROR', error: message }; };
  const response = await handleSellerLogicDetection(auth, { input: input() });
  assert.equal(response.status, 502);
  assert.deepEqual((await response.json()).error, { code: 'PROVIDER_ERROR', message });
  assert.equal(f.calls.length, 1);
});

test('oversized raw input fails before credentials or provider execution', async () => {
  const f = fixture();
  const large = input(); large.transcripts[0].text = '가'.repeat(32_001);
  const response = await handleSellerLogicDetection(auth, { input: large });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  assert.equal(f.calls.length, 0);
  assert.equal(f.secretReads, 0);
});

test('initial and repair prompts enforce the thirty-thousand character bound before another provider call', async () => {
  const f = fixture();
  const large = input();
  const prompt = sellerLogicDetectionPrompt(normalizeSellerLogicDetectionInput(large));
  large.transcripts[0].text += '가'.repeat(SELLER_LOGIC_LIMITS.promptCharacters - prompt.systemPrompt.length - prompt.userPrompt.length + 100);
  assert.ok(JSON.stringify(large).length < SELLER_LOGIC_LIMITS.packetCharacters);
  assert.equal((await handleSellerLogicDetection(auth, { input: large })).status, 413);
  assert.equal(f.calls.length, 0);
  assert.equal(f.secretReads, 0);
  f.ai = async (...args) => { f.calls.push(args); return { content: 'x'.repeat(SELLER_LOGIC_LIMITS.promptCharacters) }; };
  const repair = await handleSellerLogicDetection(auth, { input: input() });
  assert.equal(repair.status, 413);
  assert.equal((await repair.json()).error.code, 'AI_INPUT_LIMIT');
  assert.equal(f.calls.length, 1);
});
