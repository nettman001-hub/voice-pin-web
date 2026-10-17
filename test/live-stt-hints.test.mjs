import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  buildNicknameHintTerms,
  findUnsentNicknames,
  getPurchaserNicknames,
  koreanPronunciationsForNickname,
  selectHintNicknames,
} from '../src/services/liveSttHints.ts';

test('라이브 청취 홈 힌트 닉네임은 구매의사자 먼저, 최근 댓글 작성자로 채워 최대 50명', () => {
  const requests = [
    { sessionId: 's1', nickname: '먼저산사람', capturedAt: '2026-10-06T10:00:00Z' },
    { sessionId: 's1', nickname: 'minji', capturedAt: '2026-10-06T10:05:00Z' },
    { sessionId: 's1', nickname: '취소한사람', capturedAt: '2026-10-06T10:06:00Z', withdrawn: true },
    { sessionId: 's0', nickname: '지난방송', capturedAt: '2026-10-06T10:07:00Z' },
    { sessionId: 's1', nickname: 'MINJI', capturedAt: '2026-10-06T10:01:00Z' },
  ];
  const purchasers = getPurchaserNicknames(requests, 's1');
  assert.deepEqual(purchasers, ['minji', '먼저산사람']);

  const commenters = ['구경꾼', 'minji', ...Array.from({ length: 60 }, (_, i) => `고객${i}`)];
  const selected = selectHintNicknames(purchasers, commenters);
  assert.equal(selected.length, 50);
  assert.deepEqual(selected.slice(0, 3), ['minji', '먼저산사람', '구경꾼']);
  assert.equal(selected.filter((n) => n.toLowerCase() === 'minji').length, 1);

  assert.deepEqual(findUnsentNicknames(purchasers, ['먼저산사람']), ['minji']);
  assert.deepEqual(findUnsentNicknames(purchasers, ['Minji', '먼저산사람']), []);
});

test('영어 닉네임은 원문과 한국어 발음을 함께 보낸다', () => {
  assert.deepEqual(koreanPronunciationsForNickname('minji'), ['민지']);
  assert.deepEqual(koreanPronunciationsForNickname('hyeon_woo'), ['현우']);
  assert.deepEqual(koreanPronunciationsForNickname('LovelyMint'), ['러블리민트']);
  assert.deepEqual(koreanPronunciationsForNickname('mint_choco22'), ['민트초코이이']);
  assert.deepEqual(koreanPronunciationsForNickname('JJ'), ['제이제이', '찌']);
  assert.deepEqual(koreanPronunciationsForNickname('러블리'), []);
  assert.deepEqual(buildNicknameHintTerms(['👑sweet', '러블리']), ['sweet', '스윗', '러블리']);
});

test('latest thirty distinct purchasers get priority, then recent commenters fill the remaining twenty', () => {
  const requests = Array.from({ length: 42 }, (_, i) => ({ sessionId: 's1', nickname: `구매자${i}`,
    capturedAt: new Date(Date.UTC(2026, 9, 18, 0, 0, i)).toISOString() }));
  requests.push({ ...requests[41], nickname: '다른회차', sessionId: 's2' });
  requests.push({ ...requests[41], nickname: '철회', withdrawn: true });
  const purchasers = getPurchaserNicknames(requests, 's1');
  assert.equal(purchasers.length, 30);
  assert.equal(purchasers[0], '구매자41');
  assert.equal(purchasers[29], '구매자12');
  const commenters = Array.from({ length: 25 }, (_, i) => `댓글${i}`);
  const selected = selectHintNicknames([...purchasers, '넘친구매자'], [purchasers[0], ...commenters]);
  assert.equal(selected.length, 50);
  assert.deepEqual(selected.slice(0, 30), purchasers);
  assert.deepEqual(selected.slice(30), commenters.slice(0, 20));
  assert.equal(selected.includes('넘친구매자'), false);
});

/* ------------------------------------------------------------------ */
/* Soniox 세션 교체 중 멘트 유실 방지                                   */
/* ------------------------------------------------------------------ */

const CHUNK_MS = 100;
const SAMPLES = 16000 * CHUNK_MS / 1000;
const chunkStart = new WeakMap();

function chunk(startMs, loud = true) {
  const pcm = new Int16Array(SAMPLES);
  if (loud) for (let i = 0; i < pcm.length; i++) pcm[i] = i % 2 ? 6000 : -6000;
  chunkStart.set(pcm.buffer, startMs);
  return pcm.buffer;
}

/** 판매자가 쉬지 않고 말하는 대본: 300ms마다 한 단어 */
const SCRIPT = Array.from({ length: 40 }, (_, i) => ({ text: ` 말${i}`, startMs: i * 300, endMs: i * 300 + 250 }));

function loadService() {
  const sockets = [];
  class FakeSoniox {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() {
      this.readyState = 0;
      this.config = null;
      this.firstGlobal = null;
      this.heardTo = 0;
      this.emitted = new Set();
      sockets.push(this);
    }
    deliver(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
    emit(includePartial) {
      if (this.firstGlobal === null) return [];
      const tokens = [];
      for (const w of SCRIPT) {
        if (this.emitted.has(w) || w.endMs <= this.firstGlobal || w.startMs >= this.heardTo) continue;
        const clipped = w.startMs < this.firstGlobal || w.endMs > this.heardTo;
        if (w.endMs > this.heardTo && !includePartial) continue;
        this.emitted.add(w);
        tokens.push({
          text: clipped ? ` ~${w.text.trim()}` : w.text,
          start_ms: Math.max(w.startMs, this.firstGlobal) - this.firstGlobal,
          end_ms: Math.min(w.endMs, this.heardTo) - this.firstGlobal,
          is_final: true,
        });
      }
      return tokens;
    }
    send(data) {
      if (this.readyState !== 1) throw new Error('not open');
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        if (message.api_key) { this.config = message; return; }
        if (message.type === 'finalize') this.deliver({ tokens: [...this.emit(true), { text: '<fin>', is_final: true }] });
        return;
      }
      if (data.byteLength === 0) {
        this.deliver({ tokens: [], finished: true });
        this.readyState = 3;
        return;
      }
      const at = chunkStart.get(data);
      if (this.firstGlobal === null) this.firstGlobal = at;
      this.heardTo = at + CHUNK_MS;
      const tokens = this.emit(false);
      if (tokens.length) this.deliver({ tokens });
    }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
  }

  const source = fs.readFileSync(new URL('../src/services/deepgramService.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, WebSocket: FakeSoniox, ArrayBuffer, Int16Array, JSON, Math, Number,
    window: { setTimeout, clearTimeout },
    console: { log() {}, warn() {}, error() {} },
  });
  const service = new exports.DeepgramSttService();
  const finals = [];
  const statuses = [];
  const errors = [];
  const config = {
    provider: 'SONIOX', apiKey: 'test-only-key-for-stt', model: 'nova-3', language: 'ko',
    keyterms: ['고객1'], punctuate: true, interimResults: true, endpointing: 300, allowBrowserSpeechFallback: false,
  };
  service.startLiveStream(config, (data) => { if (data.isFinal) finals.push(data.text); },
    (message) => errors.push(message), (status, message) => statuses.push({ status, message }));
  sockets[0].open();
  return { service, sockets, finals, statuses, errors, config };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function spokenWords(finals) {
  return finals.join(' ').split(/\s+/).filter(Boolean);
}

async function finishLastSession(sockets) {
  const last = sockets.at(-1);
  last.deliver({ tokens: [...last.emit(true), { text: '<fin>', is_final: true }] });
  await flush();
}

test('말하는 도중 닉네임 힌트를 바꿔도 판매자 멘트를 잃거나 겹치지 않는다', async () => {
  const { service, sockets, finals, config } = loadService();
  let t = 0;
  for (; t < 2000; t += CHUNK_MS) service.sendAudioChunk(chunk(t));

  assert.equal(service.canRotateLiveStream(), true, '무음을 기다리지 않고 바로 교체를 시작한다');
  const rotation = service.rotateLiveStream({ ...config, keyterms: ['고객1', 'minji', '민지'] });
  for (; t < 2500; t += CHUNK_MS) service.sendAudioChunk(chunk(t)); // 새 세션 연결 중에도 기존 세션이 듣는다
  sockets[1].open();
  assert.deepEqual(sockets[1].config.context.terms, ['고객1', 'minji', '민지']);
  for (; t < 12_000; t += CHUNK_MS) {
    service.sendAudioChunk(chunk(t));
    await flush();
  }
  assert.equal(await rotation, true);
  assert.equal(sockets[0].readyState, 3, '기존 세션은 정상 종료됐다');
  await finishLastSession(sockets);

  const words = spokenWords(finals);
  assert.ok(!words.some((w) => w.startsWith('~')), `잘린 단어가 섞이면 안 된다: ${words.join(' ')}`);
  assert.deepEqual(words, SCRIPT.map((w) => w.text.trim()));
});

test('연속 교체(두 번째부터는 위임 세션)도 멘트가 이어진다', async () => {
  const { service, sockets, finals, config } = loadService();
  let t = 0;
  for (; t < 1500; t += CHUNK_MS) service.sendAudioChunk(chunk(t));
  const first = service.rotateLiveStream({ ...config, keyterms: ['a'] });
  sockets[1].open();
  for (; t < 5000; t += CHUNK_MS) { service.sendAudioChunk(chunk(t)); await flush(); }
  assert.equal(await first, true);
  const second = service.rotateLiveStream({ ...config, keyterms: ['b'] });
  sockets[2].open();
  for (; t < 12_000; t += CHUNK_MS) { service.sendAudioChunk(chunk(t)); await flush(); }
  assert.equal(await second, true);
  await finishLastSession(sockets);
  assert.deepEqual(spokenWords(finals), SCRIPT.map((w) => w.text.trim()));
});

test('새 세션 연결이 실패하면 기존 세션으로 계속 듣는다', async () => {
  const { service, sockets, finals, config, statuses } = loadService();
  let t = 0;
  for (; t < 2000; t += CHUNK_MS) service.sendAudioChunk(chunk(t));
  const rotation = service.rotateLiveStream({ ...config, keyterms: ['x'] });
  sockets[1].onclose?.({ code: 1006, reason: '' });
  assert.equal(await rotation, false);
  for (; t < 12_000; t += CHUNK_MS) service.sendAudioChunk(chunk(t));
  await finishLastSession(sockets.slice(0, 1));
  assert.deepEqual(spokenWords(finals), SCRIPT.map((w) => w.text.trim()));
  assert.ok(!statuses.some((s) => s.status === 'ERROR' || s.status === 'DISCONNECTED'));
});

test('겹쳐 듣는 중 기존 세션이 끊기면 새 세션이 바로 이어받는다', async () => {
  const { service, sockets, finals, config, statuses } = loadService();
  let t = 0;
  for (; t < 2000; t += CHUNK_MS) service.sendAudioChunk(chunk(t));
  const rotation = service.rotateLiveStream({ ...config, keyterms: ['x'] });
  sockets[1].open();
  for (; t < 2300; t += CHUNK_MS) service.sendAudioChunk(chunk(t));
  sockets[0].readyState = 3;
  sockets[0].onclose?.({ code: 1006, reason: '' });
  await flush();
  assert.equal(await rotation, true);
  for (; t < 12_000; t += CHUNK_MS) service.sendAudioChunk(chunk(t));
  await finishLastSession(sockets);
  const words = spokenWords(finals);
  assert.ok(!words.some((w) => w.startsWith('~')), words.join(' '));
  assert.deepEqual(words, SCRIPT.map((w) => w.text.trim()));
  assert.ok(!statuses.some((s) => s.status === 'DISCONNECTED'));
});
