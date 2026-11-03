import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';
import ts from 'typescript';
import { helperLinkDb } from './fixtures/helperLinkDb.mjs';
import * as core from '../supabase/functions/sales-api/handlers/helperLinkCore.ts';

const sha256 = async (v) => nodeCrypto.createHash('sha256').update(v).digest('hex');
const success = (data, status = 200) => ({ status, body: { ok: true, data } });
const failure = (code, message, status = 400, details = {}, retryable = false) => ({ status, body: { ok: false, error: { code, message, retryable, details } } });

function loadHandler(db, apiKey = 'euler-key-1234567890') {
  const source = fs.readFileSync(new URL('../supabase/functions/sales-api/handlers/helperLink.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push(name);
      const keys = Object.keys(args);
      const sql = `select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) result`;
      const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      try {
        return { data: (await db.query(sql, values)).rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Number, String, Math, Date, Set, Object, Array, JSON,
    require: (name) => {
      if (name.includes('helperLinkCore')) return core;
      if (name.includes('commentKey')) return { readCommentApiKey: async () => apiKey };
      return { admin, successResponse: success, errorResponse: failure, sha256 };
    },
  });
  return { ...module.exports, calls };
}

const req = (ip = '1.2.3.4') => ({ headers: new Map([['x-forwarded-for', ip]]) });

test('sales-api helper actions: registration, phone approval, push and pull through the real SQL', async (t) => {
  const db = await helperLinkDb();
  const api = loadHandler(db);
  try {
    const ws = crypto.randomUUID(), owner = crypto.randomUUID(), staff = crypto.randomUUID(), session = crypto.randomUUID(), producer = crypto.randomUUID();
    await db.query("insert into workspaces values($1,'꽃가게')", [ws]);
    await db.query("insert into auth.users values($1,'o@x.kr'),($2,'s@x.kr')", [owner, staff]);
    await db.query("insert into workspace_members values($1,$2,'OWNER'),($1,$3,'STAFF')", [ws, owner, staff]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 1회차')", [session, ws]);
    const ownerAuth = { actorType: 'USER', actorId: owner, workspaceId: ws, role: 'OWNER', capabilities: new Set(['SALES_WRITE']) };
    const staffAuth = { ...ownerAuth, actorId: staff, role: 'STAFF' };

    const secret = core.newSecretToken('hrs');
    const begin = await api.handleHelperPublic(req(), { action: 'helper-register-begin', secret, helperName: '사무실 PC', appVersion: '1.4.0' });
    assert.equal(begin.status, 200);
    const { code, registrationId } = begin.body.data;
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal((await api.handleHelperPublic(req(), { action: 'helper-register-begin', secret: 'short' })).status, 400);
    assert.equal((await api.handleHelperPublic(req(), { action: 'helper-register-poll', registrationId, secret })).body.data.status, 'PENDING');

    assert.equal((await api.handleHelperUser(staffAuth, { action: 'helper-register-approve', code })).status, 403, 'STAFF cannot register a PC');
    assert.equal((await api.handleHelperUser(ownerAuth, { action: 'helper-register-approve', code: 'zzzz' })).status, 400);
    const approve = await api.handleHelperUser(ownerAuth, { action: 'helper-register-approve', code: code.toLowerCase().replace('-', ' ') });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    assert.equal((await api.handleHelperPublic(req(), { action: 'helper-register-poll', registrationId, secret: core.newSecretToken('hrs') })).status, 404);
    const done = await api.handleHelperPublic(req(), { action: 'helper-register-poll', registrationId, secret });
    assert.equal(done.body.data.status, 'REGISTERED');
    const deviceToken = done.body.data.deviceToken;
    assert.ok(deviceToken.startsWith('vchd_'));
    const device = (await db.query('select * from devices where id=$1', [done.body.data.deviceId])).rows[0];
    assert.equal(device.token_hash, await sha256(deviceToken), 'server stores only the token hash');
    assert.ok(!JSON.stringify((await db.query('select * from helper_registrations')).rows).includes(deviceToken));

    const helperAuth = { actorType: 'DEVICE', actorId: device.id, deviceId: device.id, workspaceId: ws, capabilities: new Set(device.capabilities) };
    assert.equal((await api.handleHelperDevice({ ...helperAuth, capabilities: new Set(['SMS']) }, { action: 'helper-heartbeat' })).status, 403, 'SMS device is not a helper');
    assert.equal((await api.handleHelperDevice(ownerAuth, { action: 'helper-heartbeat' })).status, 403);
    assert.equal((await api.handleHelperDevice(helperAuth, { action: 'helper-comment-key' })).body.data.apiKey, 'euler-key-1234567890');

    const issue = await api.handleHelperDevice(helperAuth, { action: 'helper-pair-issue' });
    assert.match(issue.body.data.code, /^\d{6}$/);
    assert.equal((await api.handleHelperUser(ownerAuth, { action: 'helper-pair-claim', code: issue.body.data.code, installId: 'bad' })).status, 400);
    const claim = await api.handleHelperUser(ownerAuth, { action: 'helper-pair-claim', code: issue.body.data.code, installId: 'install-0001', phoneName: 'Galaxy S24' });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const linkToken = claim.body.data.linkToken;
    assert.equal((await api.handleHelperUser(ownerAuth, { action: 'helper-phone-status', linkToken })).body.data.linkStatus, 'PENDING');
    const hb = await api.handleHelperDevice(helperAuth, { action: 'helper-heartbeat', state: { tiktok: 'collecting', username: '@flower', secret: 'x' } });
    assert.equal(hb.body.data.pendingRequests[0].phoneName, 'Galaxy S24');
    const decide = await api.handleHelperDevice(helperAuth, { action: 'helper-pair-decide', linkId: claim.body.data.linkId, approve: true });
    assert.equal(decide.body.data.status, 'ACTIVE');
    assert.equal((await api.handleHelperDevice(helperAuth, { action: 'helper-set-enabled', enabled: true })).body.data.enabled, true);

    const runResult = (await db.query(`select voicecap_touch_run($1,$2,$3,'START',$4) r`, [ws, producer, session,
      JSON.stringify({ settings: { printTarget: 'PHONE_BLUETOOTH' }, state: { phoneOnly: true } })])).rows[0].r;
    assert.equal(runResult.ok, true);
    const attach = await api.handleHelperUser(ownerAuth, { action: 'helper-attach', linkToken, sessionId: session, producerId: producer });
    assert.equal(attach.status, 200, JSON.stringify(attach.body));
    const hb2 = await api.handleHelperDevice(helperAuth, { action: 'helper-heartbeat', state: { tiktok: 'collecting', username: 'flower', secret: 'x' } });
    assert.equal(hb2.body.data.sessionId, session);

    const batch = { action: 'helper-push', sessionId: session, generation: hb2.body.data.generation, batchId: crypto.randomUUID(),
      comments: [{ platformMessageId: 'm1', platformUserId: '77', uniqueId: '@hani', nickname: '하니', content: '저요', capturedAt: new Date().toISOString() }] };
    const pushed = await api.handleHelperDevice(helperAuth, batch);
    assert.deepEqual(pushed.body.data.acked, ['m1']);
    assert.deepEqual((await api.handleHelperDevice(helperAuth, batch)).body.data.acked, ['m1'], 'same batch retry acks again');
    assert.equal((await api.handleHelperDevice(helperAuth, { ...batch, comments: [{ platformMessageId: 'x' }] })).status, 400);
    const stale = await api.handleHelperDevice(helperAuth, { ...batch, generation: 999 });
    assert.equal(stale.body.error.code, 'STALE_GENERATION');
    assert.equal(stale.body.error.retryable, false);

    const pull = await api.handleHelperUser(ownerAuth, { action: 'helper-pull', linkToken, sessionId: session, after: null });
    assert.equal(pull.body.data.comments.length, 1);
    assert.equal(pull.body.data.comments[0].uniqueId, 'hani');
    assert.equal(pull.body.data.collector.username, 'flower');
    assert.equal(pull.body.data.collector.secret, undefined, 'unknown collector keys are dropped');
    assert.equal((await api.handleHelperUser(staffAuth, { action: 'helper-pull', linkToken, sessionId: session })).status, 403, 'another member cannot reuse the token');
    assert.equal((await api.handleHelperUser(ownerAuth, { action: 'helper-pull', linkToken: 'nope', sessionId: session })).status, 403);

    const unlink = await api.handleHelperUser(ownerAuth, { action: 'helper-phone-unlink', linkToken });
    assert.equal(unlink.body.data.status, 'REVOKED');
    assert.equal((await api.handleHelperUser(ownerAuth, { action: 'helper-pull', linkToken, sessionId: session })).status, 403);
    const audit = (await db.query('select metadata, entity_id from audit_logs')).rows;
    assert.ok(!JSON.stringify(audit).includes(linkToken) && !JSON.stringify(audit).includes(deviceToken) && !JSON.stringify(audit).includes(code));
  } finally {
    await db.close();
  }
});

test('sales-api index routes helper device tokens only to helper actions', () => {
  const index = fs.readFileSync(new URL('../supabase/functions/sales-api/index.ts', import.meta.url), 'utf8');
  const publicAt = index.indexOf('HELPER_PUBLIC_ACTIONS.has(action)');
  const authAt = index.indexOf('await authenticateRequest(req, body.workspaceId)');
  const guardAt = index.indexOf('auth.capabilities.has(HELPER_CAPABILITY) || HELPER_DEVICE_ACTIONS.has(action)');
  const switchAt = index.indexOf('switch (action)');
  assert.ok(publicAt > 0 && publicAt < authAt, 'only registration begin/poll run before authentication');
  assert.ok(guardAt > authAt && guardAt < switchAt, 'helper guard runs before every other action');
  for (const a of core.HELPER_DEVICE_ACTIONS) assert.ok(!core.HELPER_USER_ACTIONS.has(a) && !core.HELPER_PUBLIC_ACTIONS.has(a));
  assert.ok(!core.HELPER_DEVICE_ACTIONS.has('ingest-comments'));
});

test('codes and tokens have the expected shape and normalize user input', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(core.newPairCode(), /^\d{6}$/);
    assert.ok(core.normalizeRegistrationCode(core.newRegistrationCode()));
  }
  assert.equal(core.normalizePairCode('12 34-56'), '123456');
  assert.equal(core.normalizePairCode('12345'), null);
  assert.equal(core.normalizeRegistrationCode('abcd efgh'), 'ABCD-EFGH');
  assert.equal(core.normalizeRegistrationCode('ABCD-EFG0'), null, '0 is not in the alphabet');
  assert.ok(core.isSecret(core.newSecretToken('vcpl'), 'vcpl'));
  assert.ok(!core.isSecret(core.newSecretToken('vchd'), 'vcpl'));
  assert.equal(core.cleanInstallId('a b'), null);
});
