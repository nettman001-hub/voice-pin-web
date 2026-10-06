import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(connected = true) {
  const sockets = [], timers = new Map(), statuses = [], transcripts = [], errors = [];
  let nextTimer = 0;
  const io = () => {
    const handlers = new Map();
    const socket = { connected, sent: [], on: (name, fn) => handlers.set(name, fn),
      emit: (name, value) => socket.sent.push({ name, value }),
      event: (name, value) => handlers.get(name)?.(value) };
    sockets.push(socket);
    return socket;
  };
  const source = fs.readFileSync(new URL('../src/services/localSttService.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports,
    require(name) {
      if (name === 'socket.io-client') return { io };
      if (name === '../types/comment') return { DEFAULT_COMMENT_SERVER_URL: 'http://127.0.0.1:2137' };
      throw new Error(`Unexpected dependency ${name}`);
    },
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    console: { log() {}, warn() {} },
  });
  const service = exports.localSttService, socket = sockets[0];
  const start = (generation = 7) => service.startListening('session', generation, '',
    (value) => transcripts.push(value), (value) => errors.push(value),
    (status, message) => statuses.push({ status, message }), 'base');
  return { service, socket, timers, statuses, transcripts, errors, start };
}

test('an offline local helper fails immediately instead of buffering a fake listening start', () => {
  const ctx = fixture(false);
  ctx.start();
  assert.equal(ctx.statuses.at(-1).status, 'ERROR');
  assert.match(ctx.errors[0], /클라우드 STT/);
  assert.equal(ctx.socket.sent.length, 0);
  assert.equal(ctx.timers.size, 0);
  ctx.socket.connected = true;
  ctx.service.sendAudioChunk(new ArrayBuffer(8192));
  assert.equal(ctx.socket.sent.length, 0);
});

test('local startup requires the matching acknowledgment; a silent helper times out and rejects late text', () => {
  const ctx = fixture();
  ctx.start();
  assert.equal(ctx.statuses.at(-1).status, 'CONNECTING');
  ctx.socket.event('stt:status', { state: 'LISTENING' });
  assert.equal(ctx.statuses.at(-1).status, 'CONNECTING');
  const timer = [...ctx.timers.values()][0];
  assert.equal(timer.ms, 60_000);
  timer.callback();
  assert.equal(ctx.statuses.at(-1).status, 'ERROR');
  assert.match(ctx.errors[0], /60초/);
  ctx.socket.event('stt:listening_started', { session_id: 'session', generation: 7 });
  ctx.socket.event('stt:transcript', { session_id: 'session', generation: 7, text: 'late' });
  assert.equal(ctx.transcripts.length, 0);
  assert.equal(ctx.statuses.at(-1).status, 'ERROR');
  ctx.start(9);
  ctx.socket.event('stt:listening_started', { session_id: 'session', generation: 9 });
  assert.equal(ctx.statuses.at(-1).status, 'CONNECTED');
  assert.equal(ctx.timers.size, 0);
  ctx.socket.event('stt:transcript', { session_id: 'session', generation: 9, text: '새 전사' });
  assert.equal(ctx.transcripts[0].text, '새 전사');
  ctx.service.stopListening();
});

test('disconnect and stop invalidate local startup callbacks and do not leave background timers', () => {
  for (const action of ['disconnect', 'stop']) {
    const ctx = fixture();
    ctx.start();
    if (action === 'disconnect') { ctx.socket.connected = false; ctx.socket.event('disconnect'); }
    else ctx.service.stopListening();
    assert.equal(ctx.timers.size, 0);
    assert.equal(ctx.statuses.at(-1).status, 'DISCONNECTED');
    ctx.socket.event('stt:listening_started', { session_id: 'session', generation: 7 });
    ctx.socket.event('stt:transcript', { session_id: 'session', generation: 7, text: 'late' });
    assert.equal(ctx.transcripts.length, 0);
    assert.equal(ctx.statuses.at(-1).status, 'DISCONNECTED');
  }
});
