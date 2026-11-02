import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { helperLinkDb } from './fixtures/helperLinkDb.mjs';
import * as core from '../supabase/functions/sales-api/handlers/helperLinkCore.ts';

const require = createRequire(import.meta.url);
const { CommentOutbox } = require('../desktop/comment-helper/androidLink/outbox.cjs');
const { AndroidLinkManager } = require('../desktop/comment-helper/androidLink/linkManager.cjs');

const sha256 = (v) => nodeCrypto.createHash('sha256').update(v).digest('hex');

/** sales-api의 도우미 경로(index.ts 인증 + helperLink.ts)를 실제 SQL 위에서 돌리는 가짜 서버. */
async function fakeServer() {
  const db = await helperLinkDb();
  const source = fs.readFileSync(new URL('../supabase/functions/sales-api/handlers/helperLink.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const success = (data, status = 200) => ({ status, body: { ok: true, data } });
  const failure = (code, message, status = 400, details = {}, retryable = false) => ({ status, body: { ok: false, error: { code, message, retryable, details } } });
  const admin = {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      try {
        return { data: (await db.query(`select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) r`, values)).rows[0].r, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Number, String, Math, Date, Set, Object, Array, JSON,
    require: (name) => (name.includes('helperLinkCore') ? core : name.includes('commentKey')
      ? { readCommentApiKey: async () => 'euler-key-1234567890' }
      : { admin, successResponse: success, errorResponse: failure, sha256: async (v) => sha256(v) }),
  });
  const handler = module.exports;
  const server = { db, blocked: false, requests: [], dropAfterCommit: 0 };
  server.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    server.requests.push(body.action);
    if (server.blocked) throw new Error('ECONNRESET');
    const respond = (r) => ({ ok: r.status < 400, status: r.status, json: async () => r.body });
    if (core.HELPER_PUBLIC_ACTIONS.has(body.action)) return respond(await handler.handleHelperPublic({ headers: new Map() }, body));
    const token = init.headers['x-voicecap-device-token'];
    const device = token ? (await db.query('select * from devices where token_hash=$1 and revoked_at is null', [sha256(token)])).rows[0] : null;
    if (!device) return respond(failure('AUTH_REQUIRED', '인증 필요', 401));
    const auth = { actorType: 'DEVICE', actorId: device.id, deviceId: device.id, workspaceId: device.workspace_id, capabilities: new Set(device.capabilities) };
    const result = await handler.handleHelperDevice(auth, body);
    if (body.action === 'helper-push' && server.dropAfterCommit > 0) {
      server.dropAfterCommit -= 1;
      throw new Error('socket hang up after commit');
    }
    return respond(result);
  };
  server.user = (auth, body) => handler.handleHelperUser(auth, body);
  return server;
}

function newManager(server, dir, overrides = {}) {
  const posts = [];
  let saved = {};
  const store = {
    load: () => ({ ...saved }),
    save: (v) => { saved = { ...v }; },
  };
  const outbox = new CommentOutbox({ file: path.join(dir, 'android-outbox.json') });
  const manager = new AndroidLinkManager({
    apiUrl: 'https://example.supabase.co/functions/v1/sales-api',
    fetchFn: server.fetch,
    store,
    outbox,
    post: (type, payload) => posts.push({ type, ...payload }),
    newSecret: () => core.newSecretToken('hrs'),
    registerUrl: 'https://www.voicecap.shop/helper/register',
    setTimer: () => 0,
    clearTimer: () => {},
    helperName: '사무실 PC',
    appVersion: '1.4.0',
    ...overrides,
  });
  return { manager, posts, outbox, store, getSaved: () => saved };
}

test('helper link manager end to end: register, pair, deliver, block network, switch, reboot', async () => {
  const server = await fakeServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-link-'));
  const { db } = server;
  try {
    const ws = crypto.randomUUID(), owner = crypto.randomUUID(), session = crypto.randomUUID(), producer = crypto.randomUUID();
    await db.query("insert into workspaces values($1,'꽃가게')", [ws]);
    await db.query("insert into auth.users values($1,'o@x.kr')", [owner]);
    await db.query("insert into workspace_members values($1,$2,'OWNER')", [ws, owner]);
    await db.query("insert into workspace_settings(workspace_id,namespace,value) values($1,'touch_sales','{\"tiktokId\":\"flower\"}')", [ws]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 1회차')", [session, ws]);
    const ownerAuth = { actorType: 'USER', actorId: owner, workspaceId: ws, role: 'OWNER', capabilities: new Set() };

    // 1. 등록: 도우미가 코드를 받고 브라우저를 연다 → 웹에서 승인 → 도우미가 토큰을 받는다.
    let opened = '';
    const { manager, posts, outbox, getSaved } = newManager(server, dir, { openExternal: (u) => { opened = u; } });
    manager.start();
    assert.equal(manager.snapshot().delivery.key, 'unregistered');
    await manager.register();
    assert.equal(opened, 'https://www.voicecap.shop/helper/register');
    const code = manager.snapshot().registering.code;
    assert.ok(posts.some((p) => p.type === 'android:registration' && p.code === code));
    assert.equal((await server.user(ownerAuth, { action: 'helper-register-approve', code })).status, 200);
    // 등록 폴링(타이머 대신 직접 실행).
    await new Promise((resolve) => {
      manager.o.setTimer = (fn) => { Promise.resolve().then(fn).then(resolve); return 1; };
      manager.pollRegistration(0);
    });
    manager.o.setTimer = () => 0;
    assert.equal(manager.snapshot().registered, true);
    assert.equal(manager.snapshot().workspaceName, '꽃가게');
    assert.ok(getSaved().deviceToken.startsWith('vchd_'));
    assert.equal(getSaved().enabled, false, 'first install default is off');

    // 2. 폰 연결: 인증번호 → 폰 입력 → PC 승인.
    await manager.issueCode();
    const pairCode = manager.snapshot().pairCode.code;
    const claim = await server.user(ownerAuth, { action: 'helper-pair-claim', code: pairCode, installId: 'install-0001', phoneName: 'Galaxy' });
    const linkToken = claim.body.data.linkToken;
    await manager.heartbeat();
    assert.equal(manager.snapshot().pendingRequests[0].phoneName, 'Galaxy');
    await manager.decide(claim.body.data.linkId, true);
    await manager.heartbeat();
    assert.equal(manager.snapshot().link.phoneName, 'Galaxy');
    assert.equal(manager.snapshot().pairCode, null);
    assert.equal(manager.snapshot().delivery.key, 'off');

    // 3. 켜기 + 폰 판매 시작 → 수집 요청과 키 전달.
    await manager.setEnabled(true);
    await manager.heartbeat();
    assert.equal(manager.snapshot().delivery.key, 'waiting-session');
    assert.equal(manager.onComment({ id: 'early', content: '저요', nickname: '하니' }), false, 'no session: not queued');
    await db.query(`select voicecap_touch_run($1,$2,$3,'START',$4)`, [ws, producer, session, JSON.stringify({ settings: {}, state: { phoneOnly: true } })]);
    assert.equal((await server.user(ownerAuth, { action: 'helper-attach', linkToken, sessionId: session, producerId: producer })).status, 200);
    await manager.heartbeat();
    await new Promise((r) => setImmediate(r));
    await manager.heartbeat();
    assert.ok(posts.some((p) => p.type === 'android:key' && p.apiKey === 'euler-key-1234567890'));
    assert.deepEqual(posts.filter((p) => p.type === 'android:demand').at(-1), { type: 'android:demand', username: 'flower' });
    manager.setCollector({ state: 'collecting', username: 'flower', message: '수집 중' });
    assert.equal(manager.snapshot().delivery.key, 'delivering');

    // 4. 댓글 → 디스크 대기열 → 서버 확인 후 삭제 → 폰이 커서로 읽는다.
    const c = (id) => ({ id, content: `저요 ${id}`, nickname: '하니', uniqueId: 'hani', userId: '77', receivedAt: new Date().toISOString() });
    manager.onComment(c('m1'));
    manager.onComment(c('m2'));
    assert.equal(manager.onComment(c('m2')), false, 'same message once');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'android-outbox.json'), 'utf8')).items.length, 2, 'written to disk within 200ms');
    await manager.pushOnce();
    assert.equal(outbox.stats().pending, 0);
    const pull = (after = 0) => server.user(ownerAuth, { action: 'helper-pull', linkToken, sessionId: session, after });
    assert.deepEqual((await pull()).body.data.comments.map((x) => x.platformMessageId), ['m1', 'm2']);

    // 5. A12: 서버가 저장한 뒤 응답 전에 끊김 → 같은 배치 재전송 → 중복 없음.
    server.dropAfterCommit = 1;
    manager.onComment(c('m3'));
    const batchBefore = outbox.nextBatch().batchId;
    await manager.pushOnce();
    assert.equal(outbox.stats().pending, 1, 'unacknowledged stays queued');
    assert.equal(outbox.nextBatch().batchId, batchBefore, 'same batch id on retry');
    await manager.pushOnce();
    assert.equal(outbox.stats().pending, 0);
    assert.deepEqual((await pull()).body.data.comments.map((x) => x.platformMessageId), ['m1', 'm2', 'm3']);

    // 6. A11: 전송 경로 차단 동안 수집은 계속되고 대기열에 쌓인다 → 복구 후 같은 세대로 반영.
    server.blocked = true;
    for (let i = 0; i < 30; i += 1) manager.onComment(c(`blk${i}`));
    await manager.pushOnce();
    await manager.heartbeat();
    assert.equal(manager.snapshot().online, false);
    assert.equal(manager.snapshot().delivery.key, 'offline');
    assert.equal(posts.filter((p) => p.type === 'android:demand').at(-1).username, 'flower', 'collection continues while offline');
    assert.equal(outbox.stats().pending, 30);
    server.blocked = false;
    await manager.heartbeat();
    await manager.pushOnce();
    assert.equal(outbox.stats().pending, 0);
    assert.equal((await pull()).body.data.comments.length, 33);

    // 7. 재부팅: 같은 저장값과 디스크 대기열로 새 관리자가 이어 간다(브라우저 없이).
    manager.onComment(c('before-reboot'));
    outbox.saveNow();
    manager.stop();
    const saved = getSaved();
    const again = newManager(server, dir);
    again.store.save(saved);
    again.manager.start();
    assert.equal(again.outbox.stats().pending, 1, 'disk queue survives restart');
    await again.manager.heartbeat();
    await new Promise((r) => setImmediate(r));
    await again.manager.heartbeat();
    assert.equal(again.posts.filter((p) => p.type === 'android:demand').at(-1).username, 'flower');
    await again.manager.pushOnce();
    assert.equal((await pull()).body.data.comments.length, 34);

    // 8. A6: 끄기 → 즉시 수집 요청 해제, 꺼진 동안 댓글은 보관 안 함, 다시 켜면 새 세대.
    const genBefore = again.manager.snapshot().generation;
    await again.manager.setEnabled(false);
    assert.equal(again.posts.filter((p) => p.type === 'android:demand').at(-1).username, null);
    assert.equal(again.manager.onComment(c('while-off')), false);
    assert.equal((await pull()).body.data.enabled, false);
    await again.manager.setEnabled(true);
    await again.manager.heartbeat();
    assert.ok(again.manager.snapshot().generation > genBefore);
    again.manager.onComment(c('after-on'));
    await again.manager.pushOnce();
    const ids = (await pull()).body.data.comments.map((x) => x.platformMessageId);
    assert.ok(ids.includes('after-on') && !ids.includes('while-off'));

    // 9. A13: 새 회차 시작 → 이전 회차 대기열은 새 회차에 섞이지 않는다.
    server.blocked = true;
    again.manager.onComment(c('old-session-late'));
    server.blocked = false;
    const s2 = crypto.randomUUID(), p2 = crypto.randomUUID();
    await db.query(`select voicecap_touch_run($1,$2,$3,'STOP',$4)`, [ws, producer, session, JSON.stringify({ settings: {}, state: {} })]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 2회차')", [s2, ws]);
    await db.query(`select voicecap_touch_run($1,$2,$3,'START',$4)`, [ws, p2, s2, JSON.stringify({ settings: {}, state: { phoneOnly: true } })]);
    assert.equal((await server.user(ownerAuth, { action: 'helper-attach', linkToken, sessionId: s2, producerId: p2 })).status, 200);
    await again.manager.heartbeat();
    assert.equal(again.outbox.stats().pending, 0, 'old-session queue dropped on new generation');
    assert.ok(again.outbox.stats().dropped >= 1);
    const s2pull = await server.user(ownerAuth, { action: 'helper-pull', linkToken, sessionId: s2, after: 0 });
    assert.equal(s2pull.body.data.comments.length, 0);

    // 10. 폰 해제 → 수집 요청 해제. 등록 해제 → 저장된 토큰 삭제.
    await again.manager.unlink(again.manager.snapshot().link.id);
    await again.manager.heartbeat();
    assert.equal(again.manager.snapshot().delivery.key, 'no-phone');
    assert.equal(again.posts.filter((p) => p.type === 'android:demand').at(-1).username, null);
    await again.manager.unregister();
    assert.equal(again.manager.snapshot().registered, false);
    assert.equal(again.store.load().deviceToken, undefined);
    assert.ok(!server.requests.some((a) => a === 'ingest-comments'));
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('outbox reports disk failures and overflow instead of silently dropping', () => {
  const failingFs = { ...fs, writeFileSync() { throw new Error('디스크 가득'); }, existsSync: () => false, mkdirSync() {} };
  const box = new CommentOutbox({ file: '/nonexistent/outbox.json', limit: 2, fsImpl: failingFs });
  assert.equal(box.enqueue({ id: 'a', content: 'x' }, 's', 1), true);
  assert.equal(box.saveNow(), false);
  assert.match(box.stats().error, /대기열 저장 실패/);
  box.enqueue({ id: 'b', content: 'x' }, 's', 1);
  assert.equal(box.enqueue({ id: 'c', content: 'x' }, 's', 1), false);
  assert.equal(box.stats().overflow, 1);
  const batch = box.nextBatch();
  assert.equal(batch.comments.length, 2);
  box.ack(batch, ['a']);
  assert.equal(box.stats().pending, 1);
  assert.notEqual(box.nextBatch().batchId, batch.batchId, 'remaining item is re-batched');
});

test('outbox batches never mix sessions or generations', () => {
  const box = new CommentOutbox({});
  box.enqueue({ id: '1', content: 'x' }, 's1', 1);
  box.enqueue({ id: '2', content: 'x' }, 's1', 2);
  box.enqueue({ id: '3', content: 'x' }, 's2', 2);
  const b = box.nextBatch();
  assert.deepEqual(b.comments.map((c) => c.platformMessageId), ['1']);
  assert.equal(box.dropStale('s2', 2, 'x'), 2);
  assert.deepEqual(box.nextBatch().comments.map((c) => c.platformMessageId), ['3']);
});
