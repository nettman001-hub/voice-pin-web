/** Opt-in, paid end-to-end check against an already deployed sales-api.
 * Uses the existing administrator's supplied session and applied AI slots.
 * No accounts, settings, sales records, or credentials are changed.
 * node --env-file=.env.local scripts/verify-seller-logic-live.mjs --session-file <ignored JSON>
 * Optionally add --soniox-report artifacts/soniox-live-validation.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { runSellerLogicPipeline } from '../src/services/sellerLogicPipeline.ts';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const accessToken = (args['session-file'] && JSON.parse(fs.readFileSync(args['session-file'], 'utf8')).access_token) || process.env.SELLER_LOGIC_ADMIN_JWT;
assert.ok(url && publicKey && accessToken, 'Supply Supabase URL, public key, and an administrator access token. This check calls paid AI providers.');
const redact = (message) => [accessToken, publicKey].filter(Boolean).reduce((safe, secret) => safe.replaceAll(secret, '[REDACTED]'), String(message));

async function invoke(body) {
  const response = await fetch(`${url}/functions/v1/sales-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publicKey, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(135_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(redact(`${response.status} ${result.error?.code || 'API_ERROR'}: ${result.error?.message || 'Analysis failed'}`));
  return result.data;
}

const sessionId = `verification-${randomUUID()}`;
const at = (seconds) => new Date(Date.parse('2026-10-04T14:00:00Z') + seconds * 1000).toISOString();
const comments = [
  [5, 'xou.3z', '1'],
  [65, '루비', '찡박힌 티 저요 싸게주세요'],
  [75, '루비', '1.8 어때요'],
  [85, '루비', '네 2만원에 살게요'],
  [125, '😚JJEONG😚', '검정 바지랑 흰색 티 둘다 주세요'],
].map(([seconds, nickname, content], index) => ({ id: `${sessionId}:c${index}`, sessionId, nickname, content, capturedAt: at(seconds) }));
const transcripts = [
  [0, '이번 상품 숫자 1번입니다. 베이지 브이넥 니트 가격 0.9입니다. 원하시면 댓글에 1 입력하세요.'],
  [10, '엑소 언니 1번 베이지 브이넥 니트 9천원 드릴게요. 구매 확정입니다.'],
  [60, '다음 상품은 찡박힌 티입니다. 정가는 2만4천원입니다.'],
  [70, '루비 언니 찡박힌 티 2만원에 드릴까요?'],
  [80, '루비 언니 1만8천원은 안돼요. 2만원입니다.'],
  [90, '네 루비 언니 찡박힌 티 2만원 판매 확정입니다.'],
  [120, '다음은 검정 바지 만원, 흰색 티 8천원입니다.'],
  [130, '정원이 언니 검정 바지 만원 한개와 흰색 티 8천원 한개, 각각 판매 확정입니다.'],
].map(([seconds, text], index) => ({ id: `${sessionId}:t${index}`, text, recognizedAt: at(seconds), isFinal: true }));
const cases = [{ name: 'numeric-negotiation-multiple-products', input: { sessionId, comments, transcripts }, expected: [['xou.3z', 9000], ['루비', 20000], ['😚JJEONG😚', 10000], ['😚JJEONG😚', 8000]] }];
if (args['soniox-report']) {
  const captured = JSON.parse(fs.readFileSync(args['soniox-report'], 'utf8'));
  assert.equal(captured.ok, true, 'Soniox input must come from a successful real transport check.');
  const sttSession = `verification-soniox-${randomUUID()}`;
  cases.push({ name: 'generated-audio-real-soniox-real-ai', input: { sessionId: sttSession, comments: captured.comments.map((comment) => ({ ...comment, sessionId: sttSession })), transcripts: captured.transcripts }, expected: [['루비', 18000], ['u', 9000], ['mint', 20000]] });
}

const metadata = await invoke({ action: 'seller-logic-slots' });
const report = { startedAt: new Date().toISOString(), mode: 'DEPLOYED_API_TWO_STAGE_REAL_AI_FICTIONAL_TRANSACTIONS', metadata, results: [], ok: true };
for (const example of cases) for (const slotNumber of [1, 2]) {
  const started = Date.now();
  const requests = [];
  let partial;
  const stage = async (phase, input) => {
    const began = Date.now();
    const request = { phase, characters: JSON.stringify(input).length, comments: input.comments.length, transcripts: input.transcripts.length };
    try {
      const data = await invoke({ action: phase === 'detect' ? 'seller-logic-detect' : 'seller-logic-analysis', input });
      requests.push({ ...request, elapsedMs: Date.now() - began, ok: true });
      return data;
    } catch (error) {
      requests.push({ ...request, elapsedMs: Date.now() - began, ok: false });
      throw error;
    }
  };
  try {
    // Replay through the same browser pipeline, exposing only already processed
    // source to stage two. The entire fictional broadcast is never an API body.
    const data = await runSellerLogicPipeline({ ...example.input, slotNumber }, {
      detect: (input) => stage('detect', input), link: (input) => stage('link', input),
    }, { live: false, onProgress: (result) => { partial = result; } });
    const configured = metadata.slots.find((slot) => slot.slotNumber === slotNumber);
    assert.equal(data.provider, configured.provider);
    assert.equal(data.model, configured.model);
    assert.equal(data.decisions.length, example.expected.length, 'Exactly one row per expected product; no omitted or duplicate transactions.');
    const unmatched = [...data.decisions];
    for (const [nickname, price] of example.expected) {
      const index = unmatched.findIndex((decision) => decision.status === 'CONFIRMED' && decision.nickname === nickname && decision.unitPrice === price && decision.quantity === 1);
      assert.notEqual(index, -1, `Missing confirmed transaction: ${nickname} / ${price}`);
      unmatched.splice(index, 1);
    }
    report.results.push({ name: example.name, slotNumber, elapsedMs: Date.now() - started, ok: true, requests, data });
  } catch (error) {
    report.ok = false;
    report.results.push({ name: example.name, slotNumber, elapsedMs: Date.now() - started, ok: false, requests, partial, error: redact(error.message) });
  }
  console.log(JSON.stringify({ ...report.results.at(-1), data: undefined, partial: undefined }));
}
report.finishedAt = new Date().toISOString();
const output = args.output || 'artifacts/seller-logic-live-validation.json';
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, output }));
if (!report.ok) process.exitCode = 1;
