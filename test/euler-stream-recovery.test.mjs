import test from 'node:test';
import assert from 'node:assert/strict';
import { EulerCommentStream, EULER_HEALTH, parseEulerPayload } from '../src/services/eulerComments.ts';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const chat = id => JSON.stringify({ messages: [{ type: 'WebcastChatMessage', data: { common: { msgId: id }, content: '저요', user: { nickname: '고객' } } }] });
function fixture(t, extra = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000000 });
  const sockets = [], comments = [], statuses = [], diagnostics = [];
  const stream = new EulerCommentStream({
    getToken: async () => ({ mode: 'JWT', uniqueId: 'live', jwtKey: 'test' }),
    socketFactory: url => { const s = { url, closes: 0, close() { this.closes++; } }; sockets.push(s); return s; },
    onComments: items => comments.push(...items), onStatus: s => statuses.push(s), onDiagnostic: d => diagnostics.push(d), ...extra,
  });
  t.after(() => stream.stop());
  const advance = async ms => { for (let left = ms; left > 0; left -= 500) { t.mock.timers.tick(Math.min(500, left)); await flush(); } };
  return { stream, sockets, comments, statuses, diagnostics, advance };
}

test('silent OPEN socket recovers after 90s, including after 3 minutes of normal streaming', async t => {
  const f = fixture(t); f.stream.start(); await flush();
  const first = f.sockets[0]; first.onopen();
  for (let i = 0; i < 6; i++) { await f.advance(30000); first.onmessage({ data: chat(String(i)) }); }
  const lateMessage = first.onmessage;
  const lateClose = first.onclose;
  await f.advance(EULER_HEALTH.idleTimeoutMs + 2000);
  assert.equal(f.sockets.length, 2); assert.equal(first.closes, 1);
  lateMessage({ data: chat('stale') }); lateClose({ code: 4403 });
  const second = f.sockets[1]; second.onopen();
  second.onmessage({ data: chat('5') }); second.onmessage({ data: chat('new') });
  assert.deepEqual(f.comments.map(c => c.id), ['0','1','2','3','4','5','new']);
  assert.ok(f.diagnostics.some(d => d.reason === 'NO_FRAMES'));
  assert.equal(f.statuses.at(-1).state, 'connected');
});

test('socket error without close and synchronous constructor failure retry', async t => {
  const f = fixture(t); f.stream.start(); await flush();
  f.sockets[0].onopen(); f.sockets[0].onerror({});
  await f.advance(2000); assert.equal(f.sockets.length, 2);
  f.stream.stop();
  let attempts = 0;
  const broken = new EulerCommentStream({ getToken: async () => ({ mode: 'JWT', uniqueId: 'live', jwtKey: 't' }), onComments() {},
    socketFactory: () => { attempts++; throw new Error('offline'); } });
  t.after(() => broken.stop()); broken.start(); await flush(); await f.advance(2000);
  assert.equal(attempts, 2);
});

test('hung token request times out; its late result cannot replace the fresh connection', async t => {
  let resolveOld, tokens = 0;
  const f = fixture(t, { getToken: () => ++tokens === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ mode: 'JWT', uniqueId: 'live', jwtKey: 'fresh' }) });
  f.stream.start(); await flush(); await f.advance(17000);
  assert.equal(f.sockets.length, 1); assert.ok(f.sockets[0].url.includes('jwtKey=fresh'));
  resolveOld({ mode: 'JWT', uniqueId: 'live', jwtKey: 'stale' }); await flush();
  assert.equal(f.sockets.length, 1);
  f.sockets[0].onopen(); f.sockets[0].onerror({}); await f.advance(2000);
  assert.ok(f.sockets[1].url.includes('jwtKey=fresh'));
});

test('connecting handshake timeout retries instead of remaining connected forever', async t => {
  const f = fixture(t); f.stream.start(); await flush(); await f.advance(22000);
  assert.equal(f.sockets.length, 2); assert.ok(f.diagnostics.some(d => d.reason === 'CONNECT_TIMEOUT'));
});

test('numeric/prefixed room states normalize and repeated reconnecting status cannot mask a stalled room', async t => {
  assert.deepEqual(parseEulerPayload({ roomStatusEvent: { state: 3 } }).roomStates, ['reconnecting']);
  assert.deepEqual(parseEulerPayload({ roomStatusEvent: { state: 'ROOM_STATUS_STATE_CONNECTED' } }).roomStates, ['connected']);
  const f = fixture(t); f.stream.start(); await flush(); f.sockets[0].onopen();
  for (let i = 0; i < 4; i++) { f.sockets[0].onmessage({ data: JSON.stringify({ roomStatusEvent: { state: 3 } }) }); await f.advance(5000); }
  await f.advance(2000); assert.equal(f.sockets.length, 2);
  assert.ok(f.diagnostics.some(d => d.reason === 'ROOM_STALLED'));
});

test('non-chat frames keep an active socket healthy for 10 minutes', async t => {
  const f = fixture(t); f.stream.start(); await flush(); f.sockets[0].onopen();
  for (let i = 0; i < 20; i++) { await f.advance(30000); f.sockets[0].onmessage({ data: '{"type":"like","data":{"count":1}}' }); }
  assert.equal(f.sockets.length, 1);
});

test('permanent auth failure waits for explicit repair; stop removes every recovery timer', async t => {
  const f = fixture(t); f.stream.start(); await flush(); f.sockets[0].onclose({ code: 4403 });
  await f.advance(180000); assert.equal(f.sockets.length, 1);
  f.stream.reconnect(); await f.advance(500); assert.equal(f.sockets.length, 2);
  f.stream.stop(); await f.advance(180000); assert.equal(f.sockets.length, 2);
});

test('network restoration replaces only the comment socket and listeners are cleaned up', async t => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = previous; });
  const f = fixture(t); f.stream.start(); await flush(); f.sockets[0].onopen();
  window.dispatchEvent(new Event('online')); await f.advance(500);
  assert.equal(f.sockets.length, 2);
  f.stream.stop(); window.dispatchEvent(new Event('online')); await f.advance(500);
  assert.equal(f.sockets.length, 2);
});
