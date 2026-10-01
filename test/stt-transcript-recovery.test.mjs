import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(onStatus) {
  const sockets = [], transcripts = [], statuses = [], errors = [];
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const source = fs.readFileSync(new URL('../src/services/deepgramService.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, WebSocket: Socket, ArrayBuffer, Int16Array,
    window: { setTimeout, clearTimeout },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
  });
  const service = new exports.DeepgramSttService();
  const config = {
    provider: 'SONIOX', apiKey: 'test-only-key-for-stt', model: 'stt-rt-v5', language: 'ko',
    keyterms: [], punctuate: true, interimResults: true, endpointing: 300, allowBrowserSpeechFallback: false,
  };
  service.startLiveStream(config, (data) => transcripts.push(data), (message) => errors.push(message),
    (status, message) => { statuses.push({ status, message }); onStatus?.(status, message); });
  const socket = sockets.at(-1);
  socket.readyState = Socket.OPEN;
  socket.onopen();
  const sendTokens = (tokens) => socket.onmessage({ data: JSON.stringify({ tokens }) });
  return { service, socket, transcripts, statuses, errors, sendTokens };
}

test('Soniox enables semantic endpoints so background audio does not make logs depend on PCM silence', () => {
  const ctx = fixture();
  const config = JSON.parse(ctx.socket.sent[0]);
  assert.equal(config.enable_endpoint_detection, true);
  assert.equal(config.max_endpoint_delay_ms, 2000);
  assert.equal(config.model, 'stt-rt-v5');
  ctx.service.stopLiveStream();
});

test('Soniox preserves the entire finalized utterance beyond 1200 characters', () => {
  const ctx = fixture();
  const pieces = Array.from({ length: 50 }, (_, index) => ` ${index}번째 상품은 원단과 디자인이 다릅니다. 언니들 확인해주세요.`);
  for (const text of pieces) ctx.sendTokens([{ text, is_final: true, confidence: 0.99 }]);
  ctx.sendTokens([{ text: '<end>', is_final: true }]);
  const final = ctx.transcripts.filter((item) => item.isFinal);
  assert.equal(final.length, 1);
  assert.equal(final[0].text, pieces.join('').trim());
  assert.ok(final[0].text.length > 1200);
  assert.equal(ctx.socket.sent.filter((value) => typeof value === 'string' && JSON.parse(value).type === 'finalize').length, 1);
  ctx.service.stopLiveStream();
});

function liveStatusFixture(mode) {
  const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'deepgramService.startLiveStream') {
      callback = node.arguments[3].getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(callback, 'The real cloud status callback must be found');
  const state = { listening: true, paused: 0, stopped: 0, resets: 0, level: 0.5, status: 'CONNECTED' };
  const refs = {
    listeningGenerationRef: { current: 1 }, currentUserIdRef: { current: 'seller' },
    activeListeningUserIdRef: { current: 'seller' }, isListeningRef: { current: true },
  };
  const compiled = ts.transpileModule(`module.exports = ${callback}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, ...refs, listeningGeneration: 1, requestedUserId: 'seller', mode, Uint8Array,
    setSttEngineStatus: (value) => { state.status = value; },
    setSttEngineMessage: (value) => { state.message = value; },
    setIsListening: (value) => { state.listening = value; },
    setAudioLevel: (value) => { state.level = value; },
    setWaveform: (value) => { state.waveform = value; },
    resetSonioxBusinessAccumulator: () => { state.resets++; },
    audioCaptureService: {
      pauseCapture: () => { state.paused++; }, stopCapture: () => { state.stopped++; },
    },
  });
  return { state, refs, callback: module.exports };
}

for (const mode of ['TAB_AUDIO', 'MIC']) {
  test(`a real Soniox close event clears ON AIR and stale callbacks (${mode})`, () => {
    const live = liveStatusFixture(mode);
    const ctx = fixture(live.callback);
    ctx.socket.readyState = 3;
    ctx.socket.onclose({ code: 1006, reason: 'network lost' });
    assert.equal(live.state.status, 'DISCONNECTED');
    assert.equal(live.state.listening, false);
    assert.equal(live.refs.isListeningRef.current, false);
    assert.equal(live.refs.activeListeningUserIdRef.current, null);
    assert.equal(live.state.level, 0);
    assert.equal(live.state.waveform.every((value) => value === 0), true);
    assert.equal(live.state.paused, mode === 'TAB_AUDIO' ? 1 : 0);
    assert.equal(live.state.stopped, mode === 'MIC' ? 1 : 0);
    assert.match(live.state.message, /다시 시작/);
    live.callback('CONNECTED', 'late old connection');
    assert.equal(live.state.status, 'DISCONNECTED');
    assert.equal(live.state.listening, false);
    ctx.service.stopLiveStream();
  });
}

test('a Soniox error_code does not leave a failed tab stream reporting CONNECTED', () => {
  const live = liveStatusFixture('TAB_AUDIO');
  const ctx = fixture(live.callback);
  ctx.socket.onmessage({ data: JSON.stringify({ error_code: 400 }) });
  assert.equal(live.state.status, 'ERROR');
  assert.equal(live.state.listening, false);
  assert.equal(live.state.paused, 1);
  ctx.service.stopLiveStream();
});

test('server endpoints produce ordinary transcript logs without a sale keyword or a local finalize request', () => {
  const ctx = fixture();
  const speech = new Int16Array(4096).fill(1200);
  for (let index = 0; index < 20; index++) ctx.service.sendAudioChunk(speech.buffer);
  assert.equal(ctx.socket.sent.some((value) => typeof value === 'string' && JSON.parse(value).type === 'finalize'), false);
  ctx.sendTokens([{ text: '원단이 부드럽고 레이스가 예뻐요.', is_final: true }]);
  ctx.sendTokens([{ text: '<end>', is_final: true }]);
  ctx.sendTokens([{ text: '총장은 팔십구입니다.', is_final: true }, { text: '<end>', is_final: true }]);
  const finals = ctx.transcripts.filter((item) => item.isFinal);
  assert.deepEqual(finals.map((item) => item.text), ['원단이 부드럽고 레이스가 예뻐요.', '총장은 팔십구입니다.']);
  ctx.service.stopLiveStream();
});
