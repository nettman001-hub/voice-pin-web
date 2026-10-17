import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(name, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (id) => {
    assert.ok(id in dependencies, `Unexpected import ${id}`);
    return dependencies[id];
  }, console, ...globals });
  return exports;
}

const nicknameMatcher = load('nicknameMatcher');
const liveSttHints = load('liveSttHints', { './nicknameMatcher.ts': nicknameMatcher, './nicknameMatcher': nicknameMatcher });
const vocabulary = load('sellerLogicVocabulary', { './nicknameMatcher': nicknameMatcher, './liveSttHints': liveSttHints });
const sttVocab = load('sttVocabularyService');
const opusHintPlanner = load('logicOpus/opusHintPlanner', {
  '../../types/logicOpus.ts': { LOGIC_OPUS_LIMITS: { maxHintTerms: 200 } },
  './opusNicknameCandidates.ts': { plainForm: (s) => s },
  '../liveSttHints.ts': liveSttHints,
});

test('admin Soniox vocabulary keeps 50 distinct platform names and their Latin Korean readings', () => {
  const comments = Array.from({ length: 70 }, (_, i) => ({
    nickname: `고객${i}`, capturedAt: new Date(1_000_000 + i * 1_000).toISOString(),
  }));
  comments.push({ nickname: 'u', capturedAt: new Date(2_000_000).toISOString() });
  const names = vocabulary.recentSellerLogicNicknames(comments, ['고객1']);
  assert.equal(names.length, 50);
  assert.equal(names[0], '고객1');
  assert.equal(names[1], 'u');
  assert.ok(!names.includes('고객2'));
  const terms = vocabulary.sellerLogicNicknameTerms(names);
  assert.ok(terms.includes('u'));
  assert.ok(terms.includes('유'));
  assert.equal(terms.length, 51);
  const manyEnglish = vocabulary.sellerLogicNicknameTerms(Array.from({ length: 70 }, (_, i) => `user${i}`));
  assert.equal(manyEnglish.length, 100);
  assert.ok(manyEnglish.includes('user49'));
  assert.ok(!manyEnglish.includes('user50'));
});

test('admin Soniox prioritizes only the latest thirty purchasers and fills remaining slots from recent comments', () => {
  const old = Array.from({ length: 40 }, (_, i) => ({ nickname: `구매자${i}`, capturedAt: new Date(1000 + i * 1000).toISOString() }));
  const recent = Array.from({ length: 25 }, (_, i) => ({ nickname: `댓글${i}`, capturedAt: new Date(100_000 + i * 1000).toISOString() }));
  const names = vocabulary.recentSellerLogicNicknames([...old, ...recent], old.map((entry) => entry.nickname));
  assert.equal(names.length, 50);
  assert.equal(names[0], '구매자39');
  assert.equal(names[29], '구매자10');
  assert.equal(names[30], '댓글24');
  assert.ok(!names.includes('구매자9'));
});

async function fixture({ selection, created } = {}) {
  const sockets = [], events = [], transcripts = [], audios = [], commentServices = [];
  let now = 2_000_000;
  class Audio {
    constructor() { audios.push(this); }
    async startCapture(_mode, chunk) {
      this.chunk = chunk;
      this.initial = new ArrayBuffer(320);
      chunk(this.initial);
      return { getAudioTracks: () => [] };
    }
    stopCapture() {}
  }
  class Comments {
    constructor() { commentServices.push(this); }
    onComment(fn) { this.comment = fn; return () => { this.comment = () => {}; }; }
    onStatus(fn) { this.status = fn; return () => {}; }
    connect() {}
    startCollecting() {}
    disconnect() {}
  }
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() { this.sent = []; this.readyState = 0; sockets.push(this); }
    send(chunk) { this.sent.push(chunk); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    respond(response = { tokens: [] }) { this.onmessage?.({ data: JSON.stringify(response) }); }
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const { SellerLogicCapture } = load('sellerLogicCapture', {
    './audioCaptureService': { AudioCaptureService: Audio },
    './commentStreamService': { CommentStreamService: Comments },
    './screenCaptureService': { screenCaptureService: {
      async getOrCreateStream(force) { assert.equal(force, true); return selection || { getTracks: () => [] }; },
      stopStream() {}, cancelPendingRequest() {},
    } },
    './sellerLogicVocabulary': vocabulary,
    './liveSttHints': liveSttHints,
    './sttVocabularyService': sttVocab,
    './logicOpus/opusHintPlanner': opusHintPlanner,
  }, { WebSocket: Socket, ArrayBuffer, Date: Clock, crypto: webcrypto, window: { setTimeout, clearTimeout, setInterval, clearInterval } });
  const capture = new SellerLogicCapture();
  created?.(capture);
  await capture.start({
    username: 'seller', serverUrl: 'http://127.0.0.1:2137', sessionId: 'test',
    stt: { provider: 'SONIOX', apiKey: 'not-a-real-api-key' },
    comment: (comment) => events.push(comment), transcript: (event) => transcripts.push(event),
    status: (message) => events.push({ message }),
  });
  const comment = (nickname) => commentServices[0].comment({ id: nickname, nickname, content: 'anything', receivedAt: new Date(2_000_000).toISOString() });
  const shutdown = async () => {
    const promise = capture.stop();
    sockets.filter((socket) => socket.readyState === Socket.OPEN).forEach((socket) => socket.respond({ tokens: [], finished: true }));
    await promise;
  };
  return { capture, sockets, events, transcripts, audio: audios[0], comment, shutdown,
    advance(milliseconds) { now += milliseconds; capture.tick(); },
  };
}

test('capture buffers startup PCM and emits timestamped final tokens only once', async () => {
  const ctx = await fixture();
  const socket = ctx.sockets[0];
  const next = new ArrayBuffer(640);
  ctx.audio.chunk(next);
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.equal(socket.sent[1], ctx.audio.initial);
  assert.equal(socket.sent[2], next);
  socket.respond({ tokens: [{ text: '루비', is_final: true, start_ms: 5, end_ms: 10 }] });
  socket.respond({ tokens: [{ text: ' 드릴게요', is_final: true, start_ms: 10, end_ms: 25 }, { text: '<end>', is_final: true }] });
  assert.equal(ctx.transcripts.length, 1);
  assert.equal(ctx.transcripts[0].text, '루비 드릴게요');
  assert.equal(ctx.transcripts[0].startMs, 1_999_995);
  assert.equal(ctx.transcripts[0].endMs, 2_000_015);
  assert.equal(ctx.transcripts[0].startedAt, ctx.transcripts[0].recognizedAt);
  assert.equal(ctx.transcripts[0].endedAt, new Date(2_000_015).toISOString());
  assert.equal(ctx.transcripts[0].utteranceEnded, true);
  assert.equal(ctx.transcripts[0].endReason, 'endpoint');
  assert.equal(ctx.transcripts[0].revision, 1);
  assert.ok(Number.isFinite(Date.parse(ctx.transcripts[0].receivedAt)));
  assert.notEqual(ctx.transcripts[0].receivedAt, ctx.transcripts[0].capturedAt);
  await ctx.shutdown();
});

test('timed fragments retain one utterance and a textless endpoint revises only its last row', async (t) => {
  const ctx = await fixture(); t.after(ctx.shutdown);
  const socket = ctx.sockets[0]; socket.open();
  socket.respond({ tokens: [{ text: '루비 언니', is_final: true, start_ms: 0, end_ms: 500 }] });
  ctx.advance(4000);
  const prefix = ctx.transcripts[0];
  assert.equal(prefix.isFinal, true, 'stable tokens can still be an incomplete utterance');
  assert.equal(prefix.utteranceEnded, false);
  assert.equal(prefix.endReason, 'flush');
  socket.respond({ tokens: [{ text: ' 니트 만팔천 원에 드릴게요', is_final: true, start_ms: 600, end_ms: 2500 }] });
  ctx.advance(4000);
  const tail = ctx.transcripts[1];
  assert.notEqual(tail.id, prefix.id);
  assert.equal(tail.utteranceId, prefix.utteranceId);
  assert.equal(tail.utteranceEnded, false);
  assert.equal(tail.revision, 1);

  socket.respond({ tokens: [{ text: '<end>', is_final: true }] });
  const endpoint = ctx.transcripts[2];
  assert.equal(endpoint.id, tail.id);
  assert.equal(endpoint.text, tail.text);
  assert.equal(endpoint.utteranceId, tail.utteranceId);
  assert.equal(endpoint.revision, 2);
  assert.equal(endpoint.utteranceEnded, true);
  assert.equal(endpoint.endReason, 'endpoint');
  assert.equal(endpoint.recognizedAt, tail.recognizedAt);
  assert.equal(endpoint.endedAt, tail.endedAt);
  assert.equal(endpoint.startMs, tail.startMs);
  assert.equal(endpoint.endMs, tail.endMs);
  const archive = new Map(ctx.transcripts.map((row) => [row.id, row]));
  assert.equal(archive.size, 2);
  assert.equal([...archive.values()].map((row) => row.text).join(' '), '루비 언니 니트 만팔천 원에 드릴게요');
  socket.respond({ tokens: [{ text: '<end>', is_final: true }] });
  assert.equal(ctx.transcripts.length, 3, 'duplicate empty boundaries do not duplicate revisions');
  socket.respond({ tokens: [{ text: '다음 상품', is_final: true, start_ms: 2600, end_ms: 3000 }, { text: '<end>', is_final: true }] });
  assert.notEqual(ctx.transcripts[3].utteranceId, prefix.utteranceId);
});

test('finalize markers never claim a semantic endpoint and preserve the continuing utterance', async (t) => {
  const ctx = await fixture(); t.after(ctx.shutdown);
  const socket = ctx.sockets[0]; socket.open();
  socket.respond({ tokens: [{ text: '정원이 언니', is_final: true, start_ms: 0, end_ms: 500 }, { text: '<fin>', is_final: true }] });
  const prefix = ctx.transcripts[0];
  assert.equal(prefix.endReason, 'finalize');
  assert.equal(prefix.utteranceEnded, false);
  socket.respond({ tokens: [{ text: ' 이만 원에', is_final: true, start_ms: 600, end_ms: 1000 }] });
  ctx.advance(4000);
  const price = ctx.transcripts[1];
  assert.equal(price.utteranceId, prefix.utteranceId);
  socket.respond({ tokens: [{ text: '<fin>', is_final: true }] });
  const finalized = ctx.transcripts[2];
  assert.equal(finalized.id, price.id);
  assert.equal(finalized.revision, 2);
  assert.equal(finalized.endReason, 'finalize');
  assert.equal(finalized.utteranceEnded, false);
  socket.respond({ tokens: [{ text: ' 드릴게요', is_final: true, start_ms: 1100, end_ms: 1500 }, { text: '<end>', is_final: true }] });
  assert.equal(ctx.transcripts[3].utteranceId, prefix.utteranceId);
  assert.equal(ctx.transcripts[3].utteranceEnded, true);
});

test('stream completion after a flush revises boundary metadata without inventing an endpoint', async (t) => {
  const ctx = await fixture(); t.after(ctx.shutdown);
  const socket = ctx.sockets[0]; socket.open();
  socket.respond({ tokens: [{ text: '마지막 미완성 멘트', is_final: true, start_ms: 0, end_ms: 500 }] });
  ctx.advance(4000);
  const first = ctx.transcripts[0];
  const stopped = ctx.capture.stop();
  socket.respond({ tokens: [], finished: true });
  await stopped;
  assert.equal(ctx.transcripts.length, 2);
  assert.equal(ctx.transcripts[1].id, first.id);
  assert.equal(ctx.transcripts[1].text, first.text);
  assert.equal(ctx.transcripts[1].revision, 2);
  assert.equal(ctx.transcripts[1].utteranceEnded, false);
  assert.equal(ctx.transcripts[1].endReason, 'stream_end');
  assert.equal(ctx.transcripts[1].endedAt, first.endedAt);
});

test('a late rotated connection keeps its own utterance and original capture times with every tail intact', async (t) => {
  const ctx = await fixture(); t.after(ctx.shutdown);
  const old = ctx.sockets[0]; old.open();
  ctx.audio.chunk(new ArrayBuffer(32_000));
  old.respond({ tokens: [{ text: '루비 언니', is_final: true, start_ms: 0, end_ms: 200 }] });
  ctx.advance(4000);
  const prefix = ctx.transcripts[0];
  ctx.comment('u'); ctx.capture.prioritizeNicknames(['u']);
  const replacement = ctx.sockets[1];
  ctx.audio.chunk(new ArrayBuffer(3200));
  replacement.open();
  replacement.respond({ tokens: [{ text: '니트 드릴게요', is_final: true, start_ms: 0, end_ms: 80 }, { text: '<end>', is_final: true }] });
  const newer = ctx.transcripts[1];
  ctx.advance(1000);
  old.respond({ tokens: [{ text: ' 만팔천 원', is_final: true, start_ms: 210, end_ms: 900 }, { text: '<fin>', is_final: true }], finished: true });
  const archive = new Map(ctx.transcripts.map((row) => [row.id, row]));
  const oldTail = [...archive.values()].find((row) => row.text === '만팔천 원');
  assert.equal(archive.size, 3);
  assert.equal(oldTail.utteranceId, prefix.utteranceId);
  assert.notEqual(newer.utteranceId, prefix.utteranceId);
  assert.equal(oldTail.endReason, 'rotation');
  assert.equal(oldTail.utteranceEnded, false);
  assert.equal(oldTail.revision, 2, 'stream completion updates the finalized tail, not its text');
  assert.ok(oldTail.endMs < newer.startMs, 'late arrival does not move older audio after the replacement');
  assert.ok(Date.parse(oldTail.receivedAt) > Date.parse(newer.receivedAt));
  assert.equal(old.readyState, 3);
});

test('AI-prioritized missing name rotates immediately, buffers PCM, and drains the previous final response', async () => {
  const ctx = await fixture();
  const old = ctx.sockets[0];
  old.open(); old.respond();
  ctx.comment('u');
  ctx.capture.prioritizeNicknames(['u']);
  const replacement = ctx.sockets[1];
  assert.ok(replacement, 'no silence or elapsed-time purchase heuristic is required');
  const a = new ArrayBuffer(320), b = new ArrayBuffer(640);
  ctx.audio.chunk(a);
  assert.ok(!old.sent.includes(a));
  replacement.open();
  ctx.audio.chunk(b);
  const config = JSON.parse(replacement.sent[0]);
  assert.deepEqual(config.context.terms, ['u', '유']);
  assert.equal(replacement.sent[1], a);
  assert.equal(replacement.sent[2], b);
  assert.equal(old.readyState, 1, 'old socket stays available until provider acceptance');
  replacement.respond();
  assert.equal(old.sent.at(-1), '', 'end audio without detaching result handler');
  old.respond({ tokens: [{ text: '이전 문장 끝', is_final: true, start_ms: 0, end_ms: 10 }], finished: true });
  replacement.respond({ tokens: [{ text: '유 언니', is_final: true, start_ms: 0, end_ms: 15 }, { text: '<end>', is_final: true }] });
  assert.deepEqual(ctx.transcripts.map((item) => item.text), ['이전 문장 끝', '유 언니']);
  assert.equal(ctx.transcripts[1].startMs, 2_000_000, 'replacement uses original capture time of buffered audio');
  assert.equal(old.readyState, 3);
  await ctx.shutdown();
});

test('rejected replacement replays its whole pending audio journal to the surviving socket without duplicate events', async () => {
  const ctx = await fixture();
  const old = ctx.sockets[0]; old.open(); old.respond();
  ctx.comment('new'); ctx.capture.prioritizeNicknames(['new']);
  const replacement = ctx.sockets[1];
  const a = new ArrayBuffer(100), b = new ArrayBuffer(200);
  ctx.audio.chunk(a); replacement.open(); ctx.audio.chunk(b);
  replacement.respond({ error_code: 400 });
  assert.equal(old.readyState, 1);
  assert.equal(replacement.readyState, 3);
  assert.equal(old.sent.filter((value) => value === a).length, 1);
  assert.equal(old.sent.filter((value) => value === b).length, 1);
  assert.equal(ctx.transcripts.length, 0);
  assert.ok(ctx.events.some((event) => event.message?.startsWith('주의:')));
  await ctx.shutdown();
});

test('stop awaits the final provider response and retains the last utterance', async () => {
  const ctx = await fixture();
  const socket = ctx.sockets[0]; socket.open(); socket.respond();
  let stopped = false;
  const promise = ctx.capture.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.equal(socket.sent.at(-1), '');
  socket.respond({ tokens: [{ text: '마지막 판매 멘트', is_final: true, start_ms: 0, end_ms: 10 }], finished: true });
  await promise;
  assert.equal(stopped, true);
  assert.equal(ctx.transcripts[0].text, '마지막 판매 멘트');
});

test('unclassified comments and names absent from platform evidence cannot trigger urgent rotation', async () => {
  const ctx = await fixture();
  ctx.sockets[0].open(); ctx.sockets[0].respond();
  ctx.comment('저요');
  ctx.capture.prioritizeNicknames(['invented-name']);
  assert.equal(ctx.sockets.length, 1);
  await ctx.shutdown();
});

test('cancel while awaiting display permission closes the late stream without starting STT', async () => {
  let resolveSelection, capture, stoppedTracks = 0;
  const selection = new Promise((resolve) => { resolveSelection = resolve; });
  const start = fixture({ selection, created: (value) => { capture = value; } });
  await new Promise((resolve) => setImmediate(resolve));
  await capture.stop();
  resolveSelection({ getTracks: () => [{ stop() { stoppedTracks++; } }] });
  const ctx = await start;
  assert.equal(stoppedTracks, 1);
  assert.equal(ctx.sockets.length, 0);
  assert.equal(ctx.audio.chunk, undefined);
});

test('immediate cancel during initial cleanup cannot resume capture on the next microtask', async () => {
  let capture;
  const start = fixture({ created: (value) => { capture = value; } });
  await capture.stop();
  const ctx = await start;
  assert.equal(ctx.sockets.length, 0);
  assert.equal(ctx.audio.chunk, undefined);
});

test('comment callback preserves platform identity and namespaces message IDs by session', async () => {
  const ctx = await fixture();
  ctx.comment('😚JJEONG😚');
  ctx.comment('😚JJEONG😚');
  const comments = ctx.events.filter((event) => event.nickname);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].nickname, '😚JJEONG😚');
  assert.equal(comments[0].id, 'test:comment:😚JJEONG😚');
  assert.equal(comments[0].platformMessageId, '😚JJEONG😚');
  await ctx.shutdown();
});

test('a resumed broadcast in a new capture instance cannot reuse transcript IDs', async () => {
  const first = await fixture();
  first.sockets[0].open();
  first.sockets[0].respond({ tokens: [{ text: '첫 판매', is_final: true }, { text: '<end>', is_final: true }] });
  await first.shutdown();
  const second = await fixture();
  second.sockets[0].open();
  second.sockets[0].respond({ tokens: [{ text: '다음 판매', is_final: true }, { text: '<end>', is_final: true }] });
  assert.notEqual(first.transcripts[0].id, second.transcripts[0].id);
  await second.shutdown();
});

test('configuration send failure during replacement returns buffered PCM to old connection', async () => {
  const ctx = await fixture();
  const old = ctx.sockets[0]; old.open(); old.respond();
  ctx.comment('next'); ctx.capture.prioritizeNicknames(['next']);
  const chunk = new ArrayBuffer(320);
  ctx.audio.chunk(chunk);
  const candidate = ctx.sockets[1];
  candidate.send = () => { throw new Error('network unavailable'); };
  assert.doesNotThrow(() => candidate.open());
  assert.ok(old.sent.includes(chunk));
  assert.equal(candidate.readyState, 3);
  await ctx.shutdown();
});

test('late AI purchase intent can prioritize a platform buyer after recent history compaction', async () => {
  const ctx = await fixture();
  const first = ctx.sockets[0]; first.open(); first.respond();
  ctx.comment('늦게 판정된 구매자🎀');
  for (let index = 0; index < 500; index++) ctx.comment(`새 댓글 고객${index}`);
  assert.ok(!ctx.capture.recent.some((item) => item.nickname === '늦게 판정된 구매자🎀'), 'buyer has left the compact recent window');
  ctx.capture.prioritizeNicknames(['늦게 판정된 구매자🎀']);
  const replacement = ctx.sockets[1];
  assert.ok(replacement, 'delayed AI result still opens a replacement session');
  replacement.open();
  const terms = JSON.parse(replacement.sent[0]).context.terms;
  assert.equal(terms[0], '늦게 판정된 구매자🎀', 'canonical name remains exact and receives priority');
  assert.equal(terms.length, 50);
  replacement.respond();
  first.respond({ tokens: [], finished: true });
  await ctx.shutdown();
});
