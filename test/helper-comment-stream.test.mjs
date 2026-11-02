import test from 'node:test';
import assert from 'node:assert/strict';
import { HelperCommentStream, helperStatus } from '../src/services/helperCommentStream.ts';

function fakeApi(pages) {
  const calls = [];
  return {
    calls,
    async call(action, payload) {
      calls.push({ action, ...payload });
      if (action === 'helper-attach') return { ok: true };
      const next = pages.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const page = (comments, extra = {}) => ({ enabled: true, sessionActive: true, helperAlive: true, stateVersion: 1, generation: 1,
  collector: { tiktok: 'collecting' }, comments, cursor: comments.at(-1)?.cursor ?? 0, hasMore: false, ...extra });
const c = (cursor) => ({ cursor, platformMessageId: `m${cursor}`, nickname: '하니', content: '저요', capturedAt: '2026-11-03T00:00:00Z' });

function stream(api, opts = {}) {
  const got = [], statuses = [];
  const timers = [];
  const s = new HelperCommentStream({
    api, sessionId: 's1', producerId: 'p1', linkToken: async () => 'vcpl_token', onComments: (x) => got.push(...x),
    onStatus: (x) => statuses.push(x), setTimer: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: () => {}, ...opts,
  });
  return { s, got, statuses, timers };
}

test('attaches once, starts from tail, follows hasMore pages by server cursor', async () => {
  const api = fakeApi([page([c(1), c(2)], { hasMore: true }), page([c(3)]), page([c(4)])]);
  const { s, got, statuses } = stream(api);
  s.start();
  await s.tick();
  assert.deepEqual(api.calls.map((x) => x.action), ['helper-attach', 'helper-pull', 'helper-pull']);
  assert.equal(api.calls[1].after, null, 'first pull asks for the tail');
  assert.equal(api.calls[2].after, 2, 'next page continues from cursor');
  assert.deepEqual(got.map((x) => x.sequence), [1, 2, 3]);
  assert.equal(got[0].platformMessageId, 'm1');
  await s.tick();
  assert.equal(api.calls.at(-1).after, 3);
  assert.equal(api.calls.filter((x) => x.action === 'helper-attach').length, 1);
  assert.deepEqual(statuses.at(-1), { state: 'connected' });
});

test('late response after stop is ignored; disabled keeps cursor and shows off', async () => {
  let release;
  const api = { calls: [], async call(action) { this.calls.push(action); if (action === 'helper-attach') return {}; return new Promise((r) => { release = r; }); } };
  const { s, got } = stream(api);
  s.start();
  const pending = s.tick();
  await new Promise((r) => setImmediate(r));
  s.stop();
  release(page([c(9)]));
  await pending;
  assert.equal(got.length, 0);

  const api2 = fakeApi([page([c(1)]), page([], { enabled: false, cursor: 0 }), page([c(2)])]);
  const x = stream(api2);
  x.s.start();
  await x.s.tick();
  await x.s.tick();
  assert.equal(x.statuses.at(-1).state, 'waiting');
  await x.s.tick();
  assert.equal(api2.calls.at(-1).after, 1, 'cursor kept while disabled');
});

test('status distinguishes helper off, disconnected, waiting for live and no link', async () => {
  assert.equal(helperStatus(page([], { helperAlive: false })).state, 'error');
  assert.equal(helperStatus(page([], { enabled: false })).state, 'waiting');
  assert.equal(helperStatus(page([], { collector: { tiktok: 'waiting_live' } })).message, 'PC 도우미 · 방송 시작 대기');
  assert.equal(helperStatus(page([], { sessionActive: false })).state, 'connecting');
  const err = Object.assign(new Error('x'), { code: 'LINK_NOT_ACTIVE' });
  const api = fakeApi([err]);
  const { s, statuses } = stream(api);
  s.start();
  await s.tick();
  assert.match(statuses.at(-1).message, /해제/);
  const none = stream(fakeApi([]), { linkToken: async () => null });
  none.s.start();
  await none.s.tick();
  assert.match(none.statuses.at(-1).message, /연결되지 않았습니다/);
});
