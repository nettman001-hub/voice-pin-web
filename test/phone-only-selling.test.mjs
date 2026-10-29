import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  cleanAccountId,
  jwtRequest,
  maskKey,
  mergeCommentKey,
  normalizeTikTokId,
  publicCommentKey,
  readJwtResponse,
} from '../supabase/functions/sales-api/handlers/commentKeyCore.ts';
import {
  EulerCommentStream,
  eulerCloseInfo,
  eulerSocketUrl,
  parseEulerPayload,
} from '../src/services/eulerComments.ts';
import {
  TouchPhoneProducer,
  eulerToTouchComment,
  phoneOnlyState,
} from '../src/services/touchPhoneProducer.ts';

const KEY = 'euler_live_ABCDEFGH12345678secret';

test('TikTok ID is cleaned from @, URLs and spaces; junk is refused', () => {
  assert.equal(normalizeTikTokId(' @shop_live.01 '), 'shop_live.01');
  assert.equal(normalizeTikTokId('https://www.tiktok.com/@shop01/live'), 'shop01');
  assert.equal(normalizeTikTokId('한글아이디'), '');
  assert.equal(normalizeTikTokId('a'), '');
  assert.equal(normalizeTikTokId(null), '');
});

test('the Euler key is never returned in full; blank key keeps the stored one', () => {
  assert.equal(maskKey(KEY), 'eule****cret');
  const info = publicCommentKey({ value: { apiKey: KEY, accountId: '123' }, updated_at: 'x' });
  assert.equal(JSON.stringify(info).includes(KEY), false);
  assert.equal(info.jwtReady, true);
  const kept = mergeCommentKey({ apiKey: KEY }, { apiKey: '', accountId: '77' });
  assert.deepEqual(kept.value, { apiKey: KEY, accountId: '77' });
  assert.ok(mergeCommentKey({}, { apiKey: 'short' }).error);
  assert.ok(mergeCommentKey({}, { apiKey: KEY, accountId: '12a' }).error);
  assert.equal(cleanAccountId(' 42 '), '42');
  assert.equal(mergeCommentKey({ apiKey: KEY }, { clearKey: true }).value.apiKey, undefined);
});

test('JWT request: one creator, 8 hours, key only in the header', () => {
  const r = jwtRequest({ apiKey: KEY, accountId: '99' }, 'shop01', 'abcdef12-3456');
  assert.equal(r.url, 'https://tiktok.eulerstream.com/accounts/99/jwt/create');
  assert.equal(r.init.headers['x-api-key'], KEY);
  const body = JSON.parse(r.init.body);
  assert.equal(body.expireAfter, 8 * 3600);
  assert.deepEqual(body.websockets.allowedCreators, ['shop01']);
  assert.equal(r.init.body.includes(KEY), false);
  assert.deepEqual(readJwtResponse(200, { code: 200, token: 'jwt.x.y' }), { token: 'jwt.x.y' });
  assert.match(readJwtResponse(403, { message: 'plan' }).error, /403 · plan/);
});

test('Euler JSON: bundled messages, json strings and custom events all give comments', () => {
  const bundled = parseEulerPayload(
    JSON.stringify({
      messages: [
        { type: 'WebcastChatMessage', data: { common: { msgId: '7001' }, content: '저요', user: { uniqueId: 'kim01', nickname: '김언니', userId: '55' } } },
        { type: 'WebcastLikeMessage', data: { likeCount: 3 } },
        { type: 'WebcastEmoteChatMessage', data: { content: 'x', user: {} } },
        { type: 'roomStatus', data: { state: 'connected' } },
      ],
    }),
  );
  assert.deepEqual(
    bundled.comments.map((c) => [c.id, c.uniqueId, c.nickname, c.userId, c.content]),
    [['7001', 'kim01', '김언니', '55', '저요']],
  );
  assert.deepEqual(bundled.roomStates, ['connected']);
  const jsonString = parseEulerPayload({ type: 'chat', json: JSON.stringify({ comment: '1번이요', user: { displayId: '@lee', nickname: '' } }) });
  assert.equal(jsonString.comments[0].uniqueId, 'lee');
  assert.equal(jsonString.comments[0].nickname, 'lee');
  const custom = parseEulerPayload({ customEvent: { type: 'chat', json: '{"content":"ㅈㅇ","user":{"nickname":"박"},"msgId":"9"}' } });
  assert.equal(custom.comments[0].id, '9');
  assert.deepEqual(parseEulerPayload('not json').comments, []);
  assert.deepEqual(parseEulerPayload({ roomStatusEvent: { state: 'offline' } }).roomStates, ['offline']);
});

test('socket URL carries the JWT (or key) and feature flags; close codes are explained', () => {
  const url = new URL(eulerSocketUrl({ mode: 'JWT', uniqueId: 'shop01', jwtKey: 'j.w.t' }));
  assert.equal(url.host, 'ws.eulerstream.com');
  assert.equal(url.searchParams.get('jwtKey'), 'j.w.t');
  assert.equal(url.searchParams.get('apiKey'), null);
  assert.equal(url.searchParams.get('features.rawMessages'), 'false');
  assert.equal(eulerCloseInfo(4404).action, 'later');
  assert.equal(eulerCloseInfo(4401).action, 'token');
  assert.equal(eulerCloseInfo(4403).action, 'stop');
});

class FakeSocket {
  static all = [];
  constructor(url) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  close() {}
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('stream: duplicates dropped, not-live waits, bad token fetches a new one', async () => {
  FakeSocket.all = [];
  let tokens = 0;
  const got = [];
  const states = [];
  const s = new EulerCommentStream({
    getToken: async () => ({ mode: 'JWT', uniqueId: 'shop01', jwtKey: `t${++tokens}` }),
    onComments: (c) => got.push(...c),
    onStatus: (st) => states.push(st.state),
    socketFactory: (url) => new FakeSocket(url),
  });
  s.start();
  await flush();
  const ws = FakeSocket.all[0];
  ws.onopen();
  const msg = JSON.stringify({ messages: [{ type: 'WebcastChatMessage', data: { common: { msgId: '1' }, content: '저요', user: { uniqueId: 'a1', nickname: 'A' } } }] });
  ws.onmessage({ data: msg });
  ws.onmessage({ data: msg });
  assert.equal(got.length, 1);
  ws.onclose({ code: 4401 });
  await new Promise((r) => setTimeout(r, 600));
  await flush();
  assert.equal(tokens, 2);
  assert.match(FakeSocket.all[1].url, /jwtKey=t2/);
  FakeSocket.all[1].onclose({ code: 4404 });
  assert.equal(states.at(-1), 'waiting');
  s.stop();
  assert.equal(states.at(-1), 'stopped');
});

test('phone-only run state: no screen, delay 0, countdown = prepare seconds', () => {
  const state = phoneOnlyState(
    { producerId: 'p', sessionId: 's', displayCode: '1회차', settings: { mode: 'COMMENT_TOUCH', prepareSeconds: 5, fallbackDelaySeconds: 6 } },
    { commentStatus: 'connected', printerConnected: true, totalCount: 2, totalAmount: 30000 },
  );
  assert.equal(state.phoneOnly, true);
  assert.equal(state.delaySeconds, 0);
  assert.equal(state.prepareSeconds, 5);
  assert.equal(state.screenConnected, false);
  const c = eulerToTouchComment({ id: '7', uniqueId: 'a', nickname: 'A', content: '저요', receivedAt: 'now' }, 's1', 3);
  assert.equal(c.platformMessageId, '7');
  assert.equal(c.sessionId, 's1');
  assert.equal(c.sequence, 3);
});

function producerFixture({ printFails = false } = {}) {
  const calls = [];
  const sent = [];
  let jobs = [{ id: 'j1', immutable_payload: { buyerNickname: '김언니', amount: 15000, productName: '2번' } }];
  let captures = [{ sale_id: 's1', capture_generation: 'g1', capture_due_at: new Date(Date.now()).toISOString() }];
  const api = {
    call: async (action) => {
      calls.push([action]);
      return { mode: 'JWT', uniqueId: 'shop01', jwtKey: 't' };
    },
    run: async (...args) => calls.push(['run', ...args]),
    claimPrints: async () => {
      const out = { jobs, leaseToken: 'L' };
      jobs = [];
      return out;
    },
    print: async (...args) => calls.push(['print', ...args]),
    claimCaptures: async () => {
      const out = { captures };
      captures = [];
      return out;
    },
    saveCapture: async (...args) => calls.push(['save', ...args]),
  };
  const printer = {
    name: 'M50-1BB1_BLE',
    connected: true,
    connect: async () => {},
    reconnect: async () => true,
    send: async (bytes) => {
      if (printFails) throw new Error('끊김');
      sent.push(bytes);
    },
    disconnect() {},
  };
  const labels = [];
  const producer = new TouchPhoneProducer({
    api,
    producerId: 'p1',
    sessionId: 'sess',
    displayCode: '1회차',
    settings: { mode: 'COMMENT_TOUCH', prepareSeconds: 3, fallbackDelaySeconds: 0 },
    printer,
    serverOffset: () => 0,
    totals: () => ({ totalCount: 1, totalAmount: 15000 }),
    label: (content) => {
      labels.push(content);
      return new Uint8Array([1, 2, 3]);
    },
    capture: async () => 'data:image/jpeg;base64,AAAA',
    onComments: () => {},
    onStatus: () => {},
    onError: () => {},
    onChange: () => {},
    socketFactory: (url) => new FakeSocket(url),
  });
  return { producer, calls, sent, labels };
}

test('phone producer: starts the run as phone-only, prints the label, saves the photo', async () => {
  const f = producerFixture();
  await f.producer.start();
  for (let i = 0; i < 40 && !f.calls.some((c) => c[0] === 'save'); i++) await new Promise((r) => setTimeout(r, 5));
  const start = f.calls.find((c) => c[0] === 'run');
  assert.equal(start[1], 'START');
  assert.equal(start[5].phoneOnly, true);
  assert.deepEqual(f.labels, [{ buyer: '김언니', amount: 15000, productLabel: '2번' }]);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'print').map((c) => [c[1], c[4]]),
    [['BEGIN', undefined], ['ACK', 'SUCCESS']],
  );
  const save = f.calls.find((c) => c[0] === 'save');
  assert.deepEqual([save[1], save[2], save[3], save[5]], ['p1', 's1', 'data:image/jpeg;base64,AAAA', 'g1']);
  await f.producer.stop();
  assert.equal(f.calls.filter((c) => c[0] === 'run').at(-1)[1], 'STOP');
});

test('phone producer: a failed send is reported as FAILED, never SUCCESS', async () => {
  const f = producerFixture({ printFails: true });
  await f.producer.start();
  for (let i = 0; i < 40 && !f.calls.some((c) => c[0] === 'print' && c[1] === 'ACK'); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(f.calls.find((c) => c[0] === 'print' && c[1] === 'ACK')[4], 'FAILED');
  await f.producer.stop();
});

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

async function loadHandler({ keyRow, settings = { tiktokId: 'shop01' } }) {
  const module = { exports: {} };
  const core = await import('../supabase/functions/sales-api/handlers/commentKeyCore.ts');
  const writes = [];
  const query = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: table === 'platform_secrets' ? keyRow : { value: settings },
        error: null,
      }),
      upsert: async (row) => {
        writes.push([table, row]);
        return { error: null };
      },
    };
    return q;
  };
  vm.runInNewContext(compile('../supabase/functions/sales-api/handlers/commentKey.ts'), {
    module,
    exports: module.exports,
    console: { warn() {} },
    AbortSignal,
    Date,
    JSON,
    fetch: async () => ({ status: 200, json: async () => ({ token: 'jwt.ok' }) }),
    require: (name) =>
      name.includes('commentKeyCore')
        ? core
        : {
            admin: { from: query },
            successResponse: (data) => ({ ok: true, data }),
            errorResponse: (code, message, status = 400) => ({ ok: false, code, message, status }),
          },
  });
  return { ...module.exports, writes };
}

test('admin key screen: only global ADMIN; the key never comes back', async () => {
  const h = await loadHandler({ keyRow: { value: { apiKey: KEY, accountId: '9' }, updated_at: 't' } });
  const owner = { actorType: 'USER', role: 'OWNER', workspaceId: 'w', capabilities: new Set(['ADMIN']) };
  assert.equal((await h.handleCommentKeyAdmin(owner, { action: 'comment-key-get' })).code, 'CAPABILITY_DENIED');
  const adminAuth = { actorType: 'USER', role: 'ADMIN', workspaceId: 'w', actorId: 'u' };
  const got = await h.handleCommentKeyAdmin(adminAuth, { action: 'comment-key-get' });
  assert.equal(got.ok, true);
  assert.equal(JSON.stringify(got).includes(KEY), false);
  const saved = await h.handleCommentKeyAdmin(adminAuth, { action: 'comment-key-save', apiKey: '', accountId: '10' });
  assert.equal(JSON.stringify(saved).includes(KEY), false);
  assert.equal(h.writes[0][1].value.apiKey, KEY);
});

test('comment token: seller gets a JWT for the saved TikTok ID; devices get nothing', async () => {
  const h = await loadHandler({ keyRow: { value: { apiKey: KEY, accountId: '9' } } });
  const seller = { actorType: 'USER', role: 'OWNER', workspaceId: 'w' };
  const token = await h.handleCommentToken(seller, { action: 'touch-comment-token' });
  assert.equal(token.data.mode, 'JWT');
  assert.equal(token.data.jwtKey, 'jwt.ok');
  assert.equal(token.data.uniqueId, 'shop01');
  assert.equal(JSON.stringify(token).includes(KEY), false);
  const device = await h.handleCommentToken({ actorType: 'DEVICE', workspaceId: 'w' }, { action: 'touch-comment-token' });
  assert.equal(device.code, 'CAPABILITY_DENIED');
  const noId = await (await loadHandler({ keyRow: { value: { apiKey: KEY } }, settings: {} })).handleCommentToken(seller, {
    action: 'touch-comment-token',
  });
  assert.equal(noId.code, 'TIKTOK_ID_MISSING');
  const fallback = await (await loadHandler({ keyRow: { value: { apiKey: KEY } } })).handleCommentToken(seller, {
    action: 'touch-comment-token',
  });
  assert.equal(fallback.data.mode, 'KEY');
  const saved = await h.handleCommentToken(seller, { action: 'touch-tiktok-id', uniqueId: '@New_Shop' });
  assert.equal(saved.data.tiktokId, 'New_Shop');
  assert.equal(JSON.stringify(h.writes.at(-1)[1].value), '{"tiktokId":"New_Shop"}');
});
