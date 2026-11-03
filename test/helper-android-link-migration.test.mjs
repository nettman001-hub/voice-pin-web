import test from 'node:test';
import assert from 'node:assert/strict';
import { helperLinkDb } from './fixtures/helperLinkDb.mjs';
const h = (s) => `hash:${s}`;

test('Windows helper → server → Android link: registration, phone approval, switch, cursor feed', async (t) => {
  const db = await helperLinkDb();
  try {
    const call = async (name, args) => (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
    const scenario = (name, fn) => t.test(name, async () => {
      await db.exec('begin');
      try {
        const ws = crypto.randomUUID(), other = crypto.randomUUID(), user = crypto.randomUUID(), user2 = crypto.randomUUID(),
          outsider = crypto.randomUUID(), session = crypto.randomUUID(), producer = crypto.randomUUID();
        await db.query("insert into workspaces values($1,'꽃가게'),($2,'다른가게')", [ws, other]);
        await db.query("insert into auth.users values($1,'a@x.kr'),($2,'b@x.kr'),($3,'c@x.kr')", [user, user2, outsider]);
        await db.query("insert into workspace_members values($1,$2,'OWNER'),($1,$3,'STAFF'),($4,$5,'OWNER')", [ws, user, user2, other, outsider]);
        await db.query("insert into workspace_settings(workspace_id,namespace,value) values($1,'touch_sales','{\"tiktokId\":\"flower\"}')", [ws]);
        await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 1회차')", [session, ws]);
        const register = async (suffix = '1') => {
          const begin = await call('voicecap_helper_register_begin', [h('REG' + suffix), h('secret' + suffix), '사무실 PC', '1.4.0', 'ip-' + suffix]);
          assert.equal(begin.ok, true);
          assert.equal((await call('voicecap_helper_register_complete', [begin.registrationId, h('secret' + suffix), h('tok' + suffix)])).status, 'PENDING');
          assert.equal((await call('voicecap_helper_register_approve', [ws, user, h('REG' + suffix)])).ok, true);
          assert.equal((await call('voicecap_helper_register_complete', [begin.registrationId, h('wrong'), h('tok' + suffix)])).code, 'REGISTRATION_NOT_FOUND');
          const done = await call('voicecap_helper_register_complete', [begin.registrationId, h('secret' + suffix), h('tok' + suffix)]);
          assert.equal(done.status, 'REGISTERED');
          assert.equal(done.workspaceName, '꽃가게');
          assert.equal((await call('voicecap_helper_register_complete', [begin.registrationId, h('secret' + suffix), h('tok-again')])).code, 'REGISTRATION_EXPIRED', 'token is issued only once');
          return done.deviceId;
        };
        const pair = async (helper, code = '123456', who = user, install = 'phone-1') => {
          assert.equal((await call('voicecap_helper_pair_issue', [helper, h(code)])).ok, true);
          return call('voicecap_helper_pair_claim', [ws, who, h(code), install, 'Galaxy', h('link-' + install)]);
        };
        const run = (kind = 'START', p = producer, s = session) => call('voicecap_touch_run', [ws, p, s, kind,
          JSON.stringify({ settings: { prepareSeconds: 4, fallbackDelaySeconds: 0, printTarget: 'PHONE_BLUETOOTH' }, state: { phoneOnly: true } })]);
        const attach = (install = 'phone-1', p = producer, s = session, detach = false) => call('voicecap_helper_attach', [ws, user, h('link-' + install), s, p, detach]);
        const push = (helper, gen, comments, s = session) => call('voicecap_helper_push', [helper, s, gen, JSON.stringify(comments)]);
        const pull = (after = 0, install = 'phone-1', s = session, tail = 100, limit = 500, who = user) =>
          call('voicecap_helper_pull', [ws, who, h('link-' + install), s, after, tail, limit]);
        const c = (id, content = '저요') => ({ platformMessageId: id, platformUserId: 'u' + id, uniqueId: 'id' + id, nickname: '닉' + id, content, capturedAt: new Date().toISOString() });
        await fn({ ws, other, user, user2, outsider, session, producer, register, pair, run, attach, push, pull, c });
      } finally { await db.exec('rollback'); }
    });

    await scenario('A1 registered helper, approved phone receives comments by cursor; A12 resend dedupes', async (x) => {
      const helper = await x.register();
      const dev = (await db.query('select * from devices where id=$1', [helper])).rows[0];
      assert.equal(dev.device_type, 'WINDOWS_HELPER');
      assert.deepEqual(dev.capabilities, ['HELPER_COMMENTS']);
      const claim = await x.pair(helper);
      assert.equal(claim.status, 'PENDING');
      assert.equal(claim.helperName, '사무실 PC');
      const hb = await call('voicecap_helper_heartbeat', [helper, '{"tiktok":"collecting"}']);
      assert.equal(hb.pendingRequests.length, 1);
      assert.equal(hb.pendingRequests[0].userEmail, 'a@x.kr');
      assert.equal(hb.tiktokId, 'flower');
      assert.equal((await call('voicecap_helper_pair_decide', [helper, claim.linkId, true])).status, 'ACTIVE');
      assert.equal((await call('voicecap_helper_set_enabled', [helper, true])).enabled, true);
      assert.equal((await x.attach()).code, 'RUN_NOT_ACTIVE', 'phone must own a running touch-run');
      assert.equal((await x.run()).ok, true);
      const a = await x.attach();
      assert.equal(a.ok, true);
      const hb2 = await call('voicecap_helper_heartbeat', [helper, '{}']);
      assert.equal(hb2.sessionId, x.session);
      assert.equal(hb2.link.phoneName, 'Galaxy');
      const gen = hb2.generation;
      const r1 = await x.push(helper, gen, [x.c('m1'), x.c('m2')]);
      assert.deepEqual(r1.acked, ['m1', 'm2']);
      assert.equal(r1.inserted, 2);
      const r2 = await x.push(helper, gen, [x.c('m2'), x.c('m3')]);
      assert.deepEqual(r2.acked, ['m2', 'm3']);
      assert.equal(r2.duplicates, 1);
      const p = await x.pull(null);
      assert.deepEqual(p.comments.map((v) => v.platformMessageId), ['m1', 'm2', 'm3']);
      assert.equal(p.comments[0].platformUserId, 'um1');
      assert.equal(p.comments[0].uniqueId, 'idm1');
      const p2 = await x.pull(p.comments[1].cursor);
      assert.deepEqual(p2.comments.map((v) => v.platformMessageId), ['m3']);
      assert.equal((await x.pull(p.cursor)).comments.length, 0);
      const stored = (await db.query('select collector_id from live_comments where session_id=$1', [x.session])).rows;
      assert.equal(stored.length, 3);
      assert.ok(stored.every((r) => r.collector_id === helper));
      // 같은 댓글로 판매확정하면 기존 live_comments 행을 그대로 쓴다.
      const sale = await call('voicecap_commit_touch_sale', [x.ws, x.user, JSON.stringify({ operationId: crypto.randomUUID(), sessionId: x.session,
        inputPrice: '1.5', unitPrice: 15000, quantity: 1, confirmedAt: new Date().toISOString(),
        comment: { platformMessageId: 'm1', platformUserId: 'um1', uniqueId: 'idm1', nickname: '닉m1', content: '저요', capturedAt: p.comments[0].capturedAt } })]);
      assert.equal(sale.ok, true);
      assert.equal(sale.commentId, p.comments[0].commentId);
    });

    await scenario('A2/A4/A7 no comments before approval, after rejection, other workspace, other user, revoked token', async (x) => {
      const helper = await x.register();
      const claim = await x.pair(helper);
      await call('voicecap_helper_set_enabled', [helper, true]);
      await x.run();
      assert.equal((await x.attach()).code, 'LINK_NOT_ACTIVE');
      assert.equal((await x.pull()).code, 'LINK_NOT_ACTIVE');
      assert.equal((await call('voicecap_helper_pair_decide', [helper, claim.linkId, false])).status, 'REJECTED');
      assert.equal((await x.pull()).code, 'LINK_NOT_ACTIVE');
      assert.equal((await call('voicecap_helper_pair_decide', [helper, claim.linkId, true])).code, 'REQUEST_CLOSED');
      const claim2 = await x.pair(helper, '222222', x.user, 'phone-2');
      await call('voicecap_helper_pair_decide', [helper, claim2.linkId, true]);
      assert.equal((await x.attach('phone-2')).ok, true);
      const gen = (await call('voicecap_helper_heartbeat', [helper, '{}'])).generation;
      await x.push(helper, gen, [x.c('m1')]);
      assert.equal((await x.pull(0, 'phone-2')).comments.length, 1);
      assert.equal((await call('voicecap_helper_pull', [x.other, x.outsider, h('link-phone-2'), x.session, 0, 100, 500])).code, 'LINK_NOT_ACTIVE', 'other workspace');
      assert.equal((await x.pull(0, 'phone-2', x.session, 100, 500, x.user2)).code, 'LINK_NOT_ACTIVE', 'other user on same workspace');
      const forged = crypto.randomUUID();
      assert.equal((await x.pull(0, 'phone-2', forged)).sessionActive, false, 'forged session id gets no comments');
      assert.equal((await x.pull(0, 'phone-2', forged)).comments.length, 0);
      assert.equal((await x.push(helper, gen, [x.c('m9')], forged)).code, 'SESSION_INACTIVE');
      assert.equal((await call('voicecap_helper_unlink', [helper, claim2.linkId, null])).status, 'REVOKED');
      assert.equal((await x.pull(0, 'phone-2')).code, 'LINK_NOT_ACTIVE');
      assert.equal((await x.attach('phone-2')).code, 'LINK_NOT_ACTIVE');
      assert.equal((await x.push(helper, gen, [x.c('m2')])).code, 'STALE_GENERATION');
      const hb = await call('voicecap_helper_heartbeat', [helper, '{}']);
      assert.equal(hb.link, null);
      assert.equal(hb.sessionId, null);
    });

    await scenario('A3 expiry, reuse, reissue and brute force are blocked', async (x) => {
      const helper = await x.register();
      assert.equal((await call('voicecap_helper_pair_issue', [helper, h('111111')])).ok, true);
      assert.equal((await call('voicecap_helper_pair_issue', [helper, h('333333')])).ok, true);
      assert.equal((await call('voicecap_helper_pair_claim', [x.ws, x.user, h('111111'), 'p', 'G', h('t1')])).code, 'CODE_INVALID', 'reissued code voids the old one');
      assert.equal((await call('voicecap_helper_pair_claim', [x.ws, x.user, h('333333'), 'p', 'G', h('t2')])).ok, true);
      assert.equal((await call('voicecap_helper_pair_claim', [x.ws, x.user, h('333333'), 'p', 'G', h('t3')])).code, 'CODE_INVALID', 'one use only');
      assert.equal((await call('voicecap_helper_pair_claim', [x.other, x.outsider, h('333333'), 'p', 'G', h('t4')])).code, 'CODE_INVALID', 'other workspace');
      await call('voicecap_helper_pair_issue', [helper, h('444444')]);
      await db.query("update helper_pair_codes set expires_at=now()-interval '1 second' where code_hash=$1", [h('444444')]);
      assert.equal((await call('voicecap_helper_pair_claim', [x.ws, x.user, h('444444'), 'p', 'G', h('t5')])).code, 'CODE_INVALID', 'expired');
      await call('voicecap_helper_pair_issue', [helper, h('555555')]);
      for (let i = 0; i < 8; i += 1) await call('voicecap_helper_pair_claim', [x.ws, x.user, h('bad' + i), 'p', 'G', h('b' + i)]);
      assert.equal((await call('voicecap_helper_pair_claim', [x.ws, x.user, h('555555'), 'p', 'G', h('t6')])).code, 'RATE_LIMITED');
      // 기한이 지난 승인 요청은 승인할 수 없다.
      const second = await call('voicecap_helper_pair_claim', [x.ws, x.user2, h('555555'), 'p2', 'G', h('t7')]);
      assert.equal(second.ok, true);
      await db.query("update helper_phone_links set pending_expires_at=now()-interval '1 second' where id=$1", [second.linkId]);
      assert.equal((await call('voicecap_helper_pair_decide', [helper, second.linkId, true])).code, 'REQUEST_EXPIRED');
      assert.equal((await call('voicecap_helper_register_approve', [x.ws, x.user, h('nope')])).code, 'RATE_LIMITED', 'register approve shares the failure limit');
    });

    await scenario('A5 two phones requesting at once leave one active phone', async (x) => {
      const helper = await x.register();
      await call('voicecap_helper_pair_issue', [helper, h('777777')]);
      const a = await call('voicecap_helper_pair_claim', [x.ws, x.user, h('777777'), 'pa', 'A폰', h('la')]);
      assert.equal((await call('voicecap_helper_pair_claim', [x.ws, x.user2, h('777777'), 'pb', 'B폰', h('lb')])).code, 'CODE_INVALID');
      assert.equal((await call('voicecap_helper_pair_decide', [helper, a.linkId, true])).ok, true);
      await call('voicecap_helper_pair_issue', [helper, h('888888')]);
      const b = await call('voicecap_helper_pair_claim', [x.ws, x.user2, h('888888'), 'pb', 'B폰', h('lb')]);
      assert.equal((await call('voicecap_helper_pair_decide', [helper, b.linkId, true])).code, 'PHONE_ALREADY_LINKED');
      await db.exec('savepoint dup');
      await assert.rejects(db.query("update helper_phone_links set status='ACTIVE' where id=$1", [b.linkId]), /helper_phone_links_one_active/);
      await db.exec('rollback to savepoint dup');
      const active = (await db.query("select count(*)::int n from helper_phone_links where helper_device_id=$1 and status='ACTIVE'", [helper])).rows[0].n;
      assert.equal(active, 1);
    });

    await scenario('A6 switch off stops delivery, comments while off never arrive, on resumes with new generation', async (x) => {
      const helper = await x.register();
      const claim = await x.pair(helper);
      await call('voicecap_helper_pair_decide', [helper, claim.linkId, true]);
      await call('voicecap_helper_set_enabled', [helper, true]);
      await x.run();
      await x.attach();
      const g1 = (await call('voicecap_helper_heartbeat', [helper, '{}'])).generation;
      await x.push(helper, g1, [x.c('before')]);
      const off = await call('voicecap_helper_set_enabled', [helper, false]);
      assert.equal(off.enabled, false);
      const status = await x.pull(0);
      assert.equal(status.enabled, false);
      assert.equal(status.comments.length, 0, 'disabled pull returns no bodies');
      assert.equal((await x.push(helper, g1, [x.c('during-off')])).code, 'HELPER_DISABLED');
      const on = await call('voicecap_helper_set_enabled', [helper, true]);
      assert.ok(on.generation > g1);
      assert.equal((await x.push(helper, g1, [x.c('during-off')])).code, 'STALE_GENERATION', 'queued off-period comments are rejected');
      await x.push(helper, on.generation, [x.c('after')]);
      assert.deepEqual((await x.pull(0)).comments.map((v) => v.platformMessageId), ['before', 'after']);
    });

    await scenario('A13/A14 new session bumps generation; resumed session keeps it; STOP detaches only the session', async (x) => {
      const helper = await x.register();
      const claim = await x.pair(helper);
      await call('voicecap_helper_pair_decide', [helper, claim.linkId, true]);
      await call('voicecap_helper_set_enabled', [helper, true]);
      await x.run();
      const a1 = await x.attach();
      await x.push(helper, a1.generation, [x.c('s1')]);
      const again = await x.attach();
      assert.equal(again.generation, a1.generation, 'same session keeps generation');
      await x.run('STOP');
      assert.equal((await x.push(helper, a1.generation, [x.c('late')])).code, 'SESSION_INACTIVE', 'stopped run receives nothing');
      const s2 = crypto.randomUUID();
      await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 2회차')", [s2, x.ws]);
      const p2 = crypto.randomUUID();
      await x.run('START', p2, s2);
      const a2 = await x.attach('phone-1', p2, s2);
      assert.ok(a2.generation > a1.generation);
      assert.equal((await x.push(helper, a1.generation, [x.c('old-queue')], x.session)).code, 'STALE_GENERATION');
      await x.push(helper, a2.generation, [x.c('s2')], s2);
      assert.deepEqual((await x.pull(0, 'phone-1', s2)).comments.map((v) => v.platformMessageId), ['s2']);
      // 판매 종료(detach)는 회차만 끊고 폰 승인은 유지한다.
      assert.equal((await x.attach('phone-1', p2, s2, true)).detached, true);
      assert.equal((await call('voicecap_helper_heartbeat', [helper, '{}'])).link.phoneName, 'Galaxy');
      assert.equal((await call('voicecap_helper_heartbeat', [helper, '{}'])).sessionId, null);
    });

    await scenario('A15 5,000 comments page by cursor in order without loss; tail start skips history', async (x) => {
      const helper = await x.register();
      const claim = await x.pair(helper);
      await call('voicecap_helper_pair_decide', [helper, claim.linkId, true]);
      await call('voicecap_helper_set_enabled', [helper, true]);
      await x.run();
      const { generation } = await x.attach();
      const at = new Date().toISOString();
      for (let b = 0; b < 25; b += 1) {
        const batch = Array.from({ length: 200 }, (_, i) => ({ ...x.c(`b${b}-${i}`), capturedAt: b % 2 ? at : new Date(Date.now() - b * 1000).toISOString() }));
        const r = await x.push(helper, generation, batch);
        assert.equal(r.acked.length, 200);
      }
      let cursor = 0; const seen = [];
      for (;;) {
        const page = await x.pull(cursor, 'phone-1', x.session, 100, 1000);
        seen.push(...page.comments.map((v) => v.platformMessageId));
        cursor = page.cursor;
        if (!page.hasMore) break;
      }
      assert.equal(seen.length, 5000);
      assert.equal(new Set(seen).size, 5000);
      assert.equal(seen[0], 'b0-0');
      assert.equal(seen.at(-1), 'b24-199');
      const tail = await x.pull(null, 'phone-1', x.session, 50);
      assert.equal(tail.comments.length, 50);
      assert.equal(tail.comments[0].platformMessageId, 'b24-150');
      const none = await x.pull(null, 'phone-1', x.session, 0);
      assert.equal(none.comments.length, 0);
      assert.equal(none.cursor, cursor);
    });

    await scenario('re-registering a PC revokes the old helper and its phone; unregister revokes itself', async (x) => {
      const first = await x.register('1');
      const claim = await x.pair(first);
      await call('voicecap_helper_pair_decide', [first, claim.linkId, true]);
      const second = await x.register('2');
      assert.notEqual(first, second);
      assert.ok((await db.query('select revoked_at from devices where id=$1', [first])).rows[0].revoked_at);
      assert.equal((await db.query('select status from helper_phone_links where id=$1', [claim.linkId])).rows[0].status, 'REVOKED');
      assert.equal((await call('voicecap_helper_heartbeat', [first, '{}'])).code, 'HELPER_NOT_FOUND');
      assert.equal((await call('voicecap_helper_unregister', [second])).ok, true);
      assert.equal((await call('voicecap_helper_heartbeat', [second, '{}'])).code, 'HELPER_NOT_FOUND');
      const audit = (await db.query('select action from audit_logs where workspace_id=$1 order by created_at', [x.ws])).rows.map((r) => r.action);
      assert.ok(audit.includes('HELPER_REGISTERED'));
      assert.ok(audit.includes('HELPER_PHONE_APPROVED'));
      assert.ok(audit.includes('HELPER_UNREGISTERED'));
      assert.ok(!JSON.stringify(audit).includes('123456'));
    });
  } finally {
    await db.close();
  }
});
