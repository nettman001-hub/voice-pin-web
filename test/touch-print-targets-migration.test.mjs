import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('phone and PC receipt routes share leases without transferring comments or camera ownership', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create schema realtime; create table realtime.messages(extension text); create function realtime.topic() returns text language sql as $$ select ''::text $$;
      create table workspaces(id uuid primary key); create function is_workspace_member(uuid) returns boolean language sql as $$ select true $$;
      create table live_sessions(id uuid primary key, workspace_id uuid, status text, display_code text);
      create table buyers(id uuid primary key default gen_random_uuid(),workspace_id uuid,platform text,platform_user_id text,platform_unique_id text,
        display_nickname text,identity_status text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table live_comments(id uuid primary key default gen_random_uuid(),workspace_id uuid,session_id uuid,collector_id uuid,platform_message_id text,
        buyer_id uuid,nickname_snapshot text,content text,captured_at timestamptz,ingest_sequence bigint,created_at timestamptz default now());
      create table products(id uuid primary key default gen_random_uuid(),workspace_id uuid,session_id uuid,name text,product_code text unique,image_kind text,unit_price integer,source text,created_at timestamptz default now());
      create table operations(workspace_id uuid,operation_id uuid,actor_id text,action text,request_hash text,status text,response_json jsonb,primary key(workspace_id,operation_id));
      create table sales(id text primary key,workspace_id uuid,session_id text,buyer_id uuid,buyer_nickname text,amount integer,unit_price integer,quantity integer,
        status text not null constraint sales_status_check check(status in ('자동저장','수동수정','확정','보류')),source text,raw_transcript text,recognized_at timestamptz,product_id uuid,product_name text,product_name_snapshot text,product_code_snapshot text,
        record_state text,source_comment_ids jsonb,operation_id uuid,print_status text,print_revision integer,revision integer,note text,
        printed_at timestamptz,print_error text,capture_image_paths jsonb not null default '[]'::jsonb,updated_at timestamptz default now());
      create table print_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,sale_id text,sale_revision integer,kind text,status text default 'QUEUED',
        immutable_payload jsonb,lease_token text,lease_expires_at timestamptz,attempts integer default 0,result text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table sale_revisions(workspace_id uuid,sale_id text,old_revision integer,new_revision integer,before_value jsonb,after_value jsonb,actor_user_id uuid,reason text);`);
    for (const name of ['202610210001_touch_sales.sql', '202610290001_touch_sale_modes.sql',
      '202610300003_touch_direct_print_latest.sql', '202610310001_touch_sale_capture_paths.sql',
      '202610310002_touch_print_targets.sql', '202610310002_touch_print_targets.sql']) await db.exec(read(name));
    const call = async (name, args) => (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
    const scenario = (name, fn) => t.test(name, async () => {
      await db.exec('begin');
      try {
        const workspace = crypto.randomUUID(), session = crypto.randomUUID(), phone = crypto.randomUUID(), relay = crypto.randomUUID(), actor = crypto.randomUUID();
        await db.query('insert into workspaces values($1)', [workspace]);
        await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 3회차')", [session, workspace]);
        const run = (kind = 'START', target, phoneOnly = true, producer = phone, sessionId = session) => call('voicecap_touch_run', [workspace, producer, sessionId, kind, JSON.stringify({ settings: { prepareSeconds: 4, fallbackDelaySeconds: 0, printTarget: target }, state: { phoneOnly, delaySeconds: 0 } })]);
        const presence = (kind = 'START', ready = true, id = relay) => call('voicecap_touch_print_relay', [workspace, id, kind, ready, 'Windows 기본 프린터']);
        const change = (target, producer = phone) => call('voicecap_touch_print_target', [workspace, producer, target]);
        const claimPhone = (producer = phone) => call('voicecap_claim_touch_jobs', [workspace, producer, 10]);
        const claimRelay = (id = relay) => call('voicecap_claim_touch_relay_jobs', [workspace, id, 10]);
        const print = (batch, kind = 'BEGIN', result = null, job = batch.jobs[0]) => call('voicecap_touch_print', [workspace, job.id, batch.leaseToken, kind, result]);
        const commit = async () => {
          const id = crypto.randomUUID();
          const payload = { operationId: id, sessionId: session, inputPrice: '1.5', unitPrice: 15000, quantity: 1, confirmedAt: new Date().toISOString(),
            comment: { platformMessageId: id, platformUserId: 'user-' + id, nickname: '하니', content: '저요', capturedAt: new Date().toISOString() } };
          const result = await call('voicecap_commit_touch_sale', [workspace, actor, JSON.stringify(payload)]);
          assert.equal(result.ok, true);
          assert.deepEqual(await call('voicecap_commit_touch_sale', [workspace, actor, JSON.stringify(payload)]), result, 'retry returns same sale/job');
          return result;
        };
        const state = async () => (await db.query('select * from touch_sales_runs where workspace_id=$1', [workspace])).rows[0];
        await fn({ workspace, session, phone, relay, actor, run, presence, change, claimPhone, claimRelay, print, commit, state });
      } finally { await db.exec('rollback'); }
    });

    await scenario('PC startup requires ready relay; relay handles only print while phone keeps capture', async (x) => {
      assert.equal((await x.run('START', 'PC_HELPER')).code, 'PRINT_RELAY_NOT_READY');
      assert.equal(await x.state(), undefined);
      await x.presence('START', false);
      assert.equal((await x.run('START', 'PC_HELPER')).code, 'PRINT_RELAY_NOT_READY');
      const p = await x.presence('HEARTBEAT');
      assert.equal(p.printRelay.printerName, 'Windows 기본 프린터');
      assert.deepEqual((await x.claimRelay()).jobs, []);
      assert.equal((await x.run('START', 'PC_HELPER')).ok, true);
      const sale = await x.commit();
      const capture = await call('voicecap_claim_touch_captures', [x.workspace, x.phone]);
      assert.equal(capture.captures[0].sale_id, sale.saleId);
      assert.equal(capture.captures[0].capture_owner, x.phone);
      assert.equal((await call('voicecap_claim_touch_captures', [x.workspace, x.relay])).code, 'PC_LEASE_LOST');
      assert.deepEqual((await x.claimPhone()).jobs, []);
      const batch = await x.claimRelay();
      assert.equal(batch.jobs.length, 1);
      assert.equal(batch.jobs[0].immutable_payload.sessionDisplayCode, '라이브 3회차');
      assert.equal((await x.state()).producer_id, x.phone);
      assert.equal((await x.print(batch)).ok, true);
      assert.equal((await x.print(batch, 'ACK', 'SUCCESS')).ok, true);
      assert.deepEqual((await x.claimRelay()).jobs, []);
      assert.equal((await db.query('select count(*)::int n from print_jobs')).rows[0].n, 1);
    });

    await scenario('queued sales follow explicit target; stale heartbeat and same START cannot undo it', async (x) => {
      await x.run();
      await x.presence();
      const sale = await x.commit();
      assert.equal((await x.state()).settings.printTarget, 'PHONE_BLUETOOTH');
      assert.equal((await x.change('PC_HELPER', x.relay)).code, 'PC_LEASE_LOST');
      assert.equal((await x.change('PC_HELPER')).ok, true);
      await x.run('HEARTBEAT', 'PHONE_BLUETOOTH', false);
      await x.run('START', 'PHONE_BLUETOOTH', false);
      assert.equal((await x.state()).settings.printTarget, 'PC_HELPER');
      assert.equal((await x.state()).last_state.phoneOnly, true);
      const batches = await Promise.all([x.claimPhone(), x.claimRelay(), x.claimRelay()]);
      assert.deepEqual(batches.map((b) => b.jobs.length), [0, 1, 0]);
      assert.equal(batches[1].jobs[0].sale_id, sale.saleId);
      assert.equal((await x.change('PHONE_BLUETOOTH')).code, 'PRINT_TARGET_BUSY');
      assert.equal((await x.print(batches[1])).ok, true);
      assert.equal((await x.change('PHONE_BLUETOOTH')).code, 'PRINT_TARGET_BUSY');
      await x.print(batches[1], 'ACK', 'SUCCESS');
      assert.equal((await x.change('PHONE_BLUETOOTH')).ok, true);
      assert.deepEqual((await x.claimPhone()).jobs, []);
      assert.equal((await db.query('select print_status from sales where id=$1', [sale.saleId])).rows[0].print_status, 'PRINTED');
    });

    await scenario('unstarted claim blocks switch; expired claim moves once and invalidates old token', async (x) => {
      await x.run(); await x.presence(); await x.commit();
      const old = await x.claimPhone();
      assert.equal((await x.change('PC_HELPER')).code, 'PRINT_TARGET_BUSY');
      await x.run('STOP');
      assert.equal((await x.run('START', 'PC_HELPER')).code, 'PRINT_TARGET_BUSY', 'STOP/START cannot bypass active claims');
      await x.run();
      await db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [old.jobs[0].id]);
      assert.equal((await x.change('PC_HELPER')).ok, true);
      assert.equal((await x.print(old)).code, 'PRINT_LEASE_LOST');
      const next = await x.claimRelay();
      assert.equal(next.jobs[0].id, old.jobs[0].id);
      assert.notEqual(next.leaseToken, old.leaseToken);
      assert.equal((await x.print(old)).code, 'PRINT_LEASE_LOST');
      assert.equal((await x.print(next)).ok, true);
      await x.print(next, 'ACK', 'SUCCESS');
      assert.equal(next.jobs[0].attempts, 2);
    });

    await scenario('expired submitted work becomes UNKNOWN and is never replayed after switching', async (x) => {
      await x.run(); await x.presence(); const sale = await x.commit();
      const batch = await x.claimPhone(); await x.print(batch);
      assert.equal((await x.change('PC_HELPER')).code, 'PRINT_TARGET_BUSY');
      await db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [batch.jobs[0].id]);
      assert.equal((await x.change('PC_HELPER')).ok, true);
      assert.deepEqual((await x.claimRelay()).jobs, []);
      assert.equal((await x.print(batch, 'ACK', 'SUCCESS')).code, 'PRINT_LEASE_LOST');
      assert.equal((await db.query('select status from print_jobs where id=$1', [batch.jobs[0].id])).rows[0].status, 'UNKNOWN');
      assert.equal((await db.query('select print_error from sales where id=$1', [sale.saleId])).rows[0].print_error, '출력 여부 확인 필요');
    });

    await scenario('direct reprint in progress also blocks switch and expiry is not replayed', async (x) => {
      await x.run(); await x.presence(); const sale = await x.commit();
      const batch = await x.claimPhone(); await x.print(batch); await x.print(batch, 'ACK', 'SUCCESS');
      const direct = await call('voicecap_touch_direct_print', [x.workspace, x.actor, JSON.stringify({ kind: 'BEGIN', saleId: sale.saleId, expectedRevision: 1 })]);
      assert.equal(direct.ok, true);
      assert.equal((await x.change('PC_HELPER')).code, 'PRINT_TARGET_BUSY');
      await db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [direct.jobId]);
      assert.equal((await x.change('PC_HELPER')).ok, true);
      assert.deepEqual((await x.claimRelay()).jobs, []);
      assert.equal((await db.query('select status from print_jobs where id=$1', [direct.jobId])).rows[0].status, 'UNKNOWN');
    });

    await scenario('relay presence has one owner; expiry rejects late BEGIN and stale heartbeats', async (x) => {
      const second = crypto.randomUUID();
      await x.presence();
      assert.equal((await x.presence('START', true, second)).code, 'PRINT_RELAY_ALREADY_RUNNING');
      await x.run('START', 'PC_HELPER'); await x.commit();
      const old = await x.claimRelay();
      await db.query("update touch_print_relays set lease_expires_at=now()-interval '1 second' where workspace_id=$1", [x.workspace]);
      assert.equal((await x.print(old)).code, 'PRINT_LEASE_LOST');
      assert.equal((await x.presence('HEARTBEAT')).code, 'PRINT_RELAY_LEASE_LOST');
      assert.equal((await x.claimRelay()).code, 'PRINT_RELAY_LEASE_LOST');
      assert.equal((await x.presence('START', true, second)).ok, true);
      assert.equal((await x.presence('STOP')).code, 'PRINT_RELAY_LEASE_LOST');
      assert.equal((await x.print(old)).code, 'PRINT_LEASE_LOST');
      assert.deepEqual((await x.claimRelay(second)).jobs, [], 'old unstarted job lease still protects its token');
      await db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [old.jobs[0].id]);
      const next = await x.claimRelay(second);
      assert.equal(next.jobs.length, 1);
      await x.presence('HEARTBEAT', false, second);
      assert.equal((await x.print(next)).code, 'PRINT_LEASE_LOST');
      assert.equal((await x.claimRelay(second)).code, 'PRINT_RELAY_NOT_READY');
    });

    await scenario('claims and BEGIN honor workspace/current session and legacy PC ownership', async (x) => {
      await x.run('START', undefined, false); await x.presence(); const oldSale = await x.commit();
      assert.equal((await x.state()).settings.printTarget, 'PC_HELPER');
      assert.deepEqual((await x.claimRelay()).jobs, [], 'legacy PC producer prints directly');
      const old = await x.claimPhone();
      const otherSession = crypto.randomUUID();
      await db.query("insert into live_sessions values($1,$2,'ACTIVE','라이브 4회차')", [otherSession, x.workspace]);
      await x.run('STOP');
      await x.run('START', undefined, false, x.phone, otherSession);
      assert.equal((await x.print(old)).code, 'PRINT_LEASE_LOST', 'previous session token cannot start');
      await db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [old.jobs[0].id]);
      assert.deepEqual((await x.claimPhone()).jobs, [], 'old session queue is not printed in new session');
      const foreign = crypto.randomUUID(); await db.query('insert into workspaces values($1)', [foreign]);
      assert.equal((await call('voicecap_claim_touch_relay_jobs', [foreign, x.relay, 10])).code, 'PRINT_RELAY_LEASE_LOST');
      assert.equal((await call('voicecap_touch_print_target', [foreign, x.phone, 'PC_HELPER'])).code, 'PC_LEASE_LOST');
      assert.equal((await call('voicecap_touch_print', [foreign, old.jobs[0].id, old.leaseToken, 'BEGIN', null])).code, 'PRINT_LEASE_LOST');
      await x.run('STOP'); await x.run('START', undefined, false);
      const resumed = await x.claimPhone(); assert.equal(resumed.jobs[0].sale_id, oldSale.saleId);
      assert.equal((await x.print(resumed)).ok, true); await x.print(resumed, 'ACK', 'SUCCESS');
      await db.query("update live_sessions set status='ENDED' where id=$1", [x.session]);
      assert.deepEqual((await x.claimPhone()).jobs, []);
      await x.run('STOP');
      assert.equal((await x.claimPhone()).code, 'PC_LEASE_LOST');
    });

    await t.test('new privileged functions are not executable by anon or authenticated roles', async () => {
      for (const signature of ['voicecap_touch_print_relay(uuid,uuid,text,boolean,text)', 'voicecap_touch_print_target(uuid,uuid,text)',
        'voicecap_claim_touch_relay_jobs(uuid,uuid,integer)', 'voicecap_claim_touch_output_jobs(uuid,uuid,boolean,integer)', 'voicecap_expire_touch_prints(uuid,uuid)']) {
        assert.deepEqual((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role", [signature])).rows[0], { anon: false, authenticated: false, service_role: true });
      }
      assert.equal((await db.query("select relrowsecurity from pg_class where relname='touch_print_relays'")).rows[0].relrowsecurity, true);
    });
  } finally { await db.close(); }
});
