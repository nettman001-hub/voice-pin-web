import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create schema realtime; create table realtime.messages(extension text); create function realtime.topic() returns text language sql as $$ select ''::text $$;
    create table workspaces(id uuid primary key); create function is_workspace_member(uuid) returns boolean language sql as $$ select true $$;
    create table live_sessions(id uuid primary key, workspace_id uuid, status text);
    create table buyers(id uuid primary key default gen_random_uuid(),workspace_id uuid,platform text,platform_user_id text,platform_unique_id text,
      display_nickname text,identity_status text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table live_comments(id uuid primary key default gen_random_uuid(),workspace_id uuid,session_id uuid,collector_id uuid,platform_message_id text,
      buyer_id uuid,nickname_snapshot text,content text,captured_at timestamptz,ingest_sequence bigint,created_at timestamptz default now());
    create table products(id uuid primary key default gen_random_uuid(),workspace_id uuid,session_id uuid,name text,product_code text unique,image_kind text,unit_price integer,source text,created_at timestamptz default now());
    create table operations(workspace_id uuid,operation_id uuid,actor_id text,action text,request_hash text,status text,response_json jsonb,primary key(workspace_id,operation_id));
    create table sales(id text primary key,workspace_id uuid,session_id text,buyer_id uuid,buyer_nickname text,amount integer,unit_price integer,quantity integer,
      status text not null constraint sales_status_check check(status in ('자동저장','수동수정','확정','보류')),source text,raw_transcript text,recognized_at timestamptz,product_id uuid,product_name text,product_name_snapshot text,product_code_snapshot text,
      record_state text,source_comment_ids jsonb,operation_id uuid,print_status text,print_revision integer,revision integer,note text,
      printed_at timestamptz,print_error text,capture_image_paths jsonb,updated_at timestamptz default now());
    create table print_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,sale_id text,sale_revision integer,kind text,status text default 'QUEUED',
      immutable_payload jsonb,lease_token text,lease_expires_at timestamptz,attempts integer default 0,result text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table sale_revisions(workspace_id uuid,sale_id text,old_revision integer,new_revision integer,before_value jsonb,after_value jsonb,actor_user_id uuid,reason text);`);
  await db.exec(read('202610210001_touch_sales.sql'));
  await db.exec(read('202610290001_touch_sale_modes.sql'));
  await db.exec(read('202610300001_touch_record_print.sql'));
  await db.exec(read('202610300002_touch_direct_print.sql'));
  await db.exec(read('202610300002_touch_direct_print.sql'));
  await db.exec(read('202610300003_touch_direct_print_latest.sql'));
  const workspace = crypto.randomUUID(), session = crypto.randomUUID(), actor = crypto.randomUUID(), producer = crypto.randomUUID();
  await db.query('insert into workspaces values($1)', [workspace]);
  await db.query("insert into live_sessions values($1,$2,'ACTIVE')", [session, workspace]);
  const call = async (name, args) =>
    (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
  const run = (kind) => call('voicecap_touch_run', [workspace, producer, session, kind,
    JSON.stringify({ settings: { prepareSeconds: 4, fallbackDelaySeconds: 6 }, state: {} })]);
  await run('START');
  const committed = await call('voicecap_commit_touch_sale', [workspace, actor, JSON.stringify({
    operationId: crypto.randomUUID(), sessionId: session, inputPrice: '1.5', unitPrice: 15000, quantity: 1,
    confirmedAt: new Date().toISOString(),
    comment: { platformMessageId: 'm1', platformUserId: 'u1', nickname: '꽃심이', content: '저요', capturedAt: new Date().toISOString() },
  })]);
  const saleId = committed.saleId;
  const direct = (payload) => call('voicecap_touch_direct_print', [workspace, actor, JSON.stringify(payload)]);
  const sale = async () => (await db.query('select print_status,print_revision,print_error,revision,amount from sales where id=$1', [saleId])).rows[0];
  const jobs = async () => (await db.query("select status,result from print_jobs where sale_id=$1 and immutable_payload->>'direct'='true' order by created_at,id", [saleId])).rows;
  // 새 판매 전표를 출력해 대기열을 비운다.
  const claimed = await call('voicecap_claim_touch_jobs', [workspace, producer, 10]);
  for (const [kind, result] of [['BEGIN', null], ['ACK', 'SUCCESS']])
    await call('voicecap_touch_print', [workspace, claimed.jobs[0].id, claimed.leaseToken, kind, result]);
  await run('STOP');
  return { db, workspace, actor, producer, saleId, call, run, direct, sale, jobs };
}

test('직접 출력: 출력 전에 자리를 잡고 서버의 최신 내용을 받으며, 끝 기록은 한 번만 남는다', async () => {
  const t = await setup();
  try {
    const rev = (await t.sale()).revision;
    const begin = await t.direct({ kind: 'BEGIN', saleId: t.saleId, expectedRevision: rev });
    assert.equal(begin.ok, true);
    assert.equal(begin.sale.buyerNickname, '꽃심이');
    assert.equal(begin.sale.amount, 15000);
    // 출력하는 동안 두 번째 직접 출력과 대기열 재출력은 막힌다.
    assert.equal((await t.direct({ kind: 'BEGIN', saleId: t.saleId })).code, 'PRINT_ALREADY_PENDING');
    assert.equal((await t.call('voicecap_update_touch_sale', [t.workspace, t.actor,
      JSON.stringify({ kind: 'REPRINT', saleId: t.saleId, expectedRevision: rev })])).code, 'PRINT_ALREADY_PENDING');
    // 판매를 다시 켜도 출력 중인 직접 작업은 아무도 가져가지 않는다.
    await t.run('START');
    assert.equal((await t.call('voicecap_claim_touch_jobs', [t.workspace, t.producer, 10])).jobs.length, 0);
    await t.run('STOP');
    const finish = { kind: 'FINISH', jobId: begin.jobId, leaseToken: begin.leaseToken, result: 'SUCCESS' };
    assert.equal((await t.direct(finish)).ok, true);
    const before = await t.sale();
    assert.equal(before.print_status, 'PRINTED');
    // 같은 끝 기록을 다시 보내도(재전송) 줄이 늘거나 결과가 바뀌지 않는다.
    const again = await t.direct({ ...finish, result: 'FAILED' });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyFinished, true);
    assert.deepEqual(await t.jobs(), [{ status: 'SUBMITTED', result: 'SUCCESS' }]);
    assert.deepEqual(await t.sale(), before);
    // 토큰이 틀리면 거절한다.
    assert.equal((await t.direct({ ...finish, leaseToken: 'x' })).code, 'PRINT_LEASE_LOST');
  } finally { await t.db.close(); }
});

test('직접 출력: 대기 중 전표, 취소, 수정된 판매는 종이를 내기 전에 거절한다', async () => {
  const t = await setup();
  try {
    let rev = (await t.sale()).revision;
    // 대기열에 재출력이 걸려 있으면(판매가 멈춰 있어도) 직접 출력하지 않는다.
    assert.equal((await t.call('voicecap_update_touch_sale', [t.workspace, t.actor,
      JSON.stringify({ kind: 'REPRINT', saleId: t.saleId, expectedRevision: rev })])).ok, true);
    rev = (await t.sale()).revision;
    assert.equal((await t.direct({ kind: 'BEGIN', saleId: t.saleId, expectedRevision: rev })).code, 'PRINT_ALREADY_PENDING');
    await t.db.query("update print_jobs set status='CANCELLED' where sale_id=$1 and status='QUEUED'", [t.saleId]);
    // 화면이 본 revision이 낡았으면(그사이 가격 수정) 거절한다.
    assert.equal((await t.direct({ kind: 'BEGIN', saleId: t.saleId, expectedRevision: rev - 1 })).code, 'REVISION_CONFLICT');
    // 취소된 판매는 거절한다.
    assert.equal((await t.call('voicecap_update_touch_sale', [t.workspace, t.actor,
      JSON.stringify({ kind: 'CANCEL', saleId: t.saleId, expectedRevision: rev })])).ok, true);
    assert.equal((await t.direct({ kind: 'BEGIN', saleId: t.saleId })).code, 'SALE_CANCELLED');
    assert.deepEqual(await t.jobs(), []);
  } finally { await t.db.close(); }
});

test('직접 출력: 끝을 알리지 못한 작업은 시간이 지나면 확인 필요로 바뀌고, 늦게 온 끝 기록이 바로잡는다', async () => {
  const t = await setup();
  try {
    const begin = await t.direct({ kind: 'BEGIN', saleId: t.saleId });
    await t.db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [begin.jobId]);
    const next = await t.direct({ kind: 'BEGIN', saleId: t.saleId });
    assert.equal(next.ok, true, '오래 멈춘 작업 때문에 영원히 막히지 않는다');
    const s = await t.sale();
    assert.equal(s.print_status, 'FAILED');
    assert.equal(s.print_error, '출력 여부 확인 필요');
    assert.equal((await t.direct({ kind: 'FINISH', jobId: begin.jobId, leaseToken: begin.leaseToken, result: 'SUCCESS' })).ok, true);
    assert.equal((await t.direct({ kind: 'FINISH', jobId: next.jobId, leaseToken: next.leaseToken, result: 'FAILED' })).ok, true);
    assert.deepEqual((await t.jobs()).map((j) => j.status), ['SUBMITTED', 'FAILED']);
    assert.equal((await t.direct({ kind: 'NOPE' })).code, 'VALIDATION_ERROR');
    assert.equal((await t.direct({ kind: 'FINISH', jobId: next.jobId, leaseToken: next.leaseToken, result: 'UNKNOWN' })).code, 'VALIDATION_ERROR');
    const grants = (await t.db.query(
      "select has_function_privilege('authenticated','voicecap_touch_direct_print(uuid,uuid,jsonb)','execute') a, has_function_privilege('service_role','voicecap_touch_direct_print(uuid,uuid,jsonb)','execute') s")).rows[0];
    assert.deepEqual(grants, { a: false, s: true });
  } finally { await t.db.close(); }
});

test('직접 출력: 오래 멈춘 작업의 늦은 끝 기록은 그 뒤에 시작한 최신 출력의 결과를 덮지 않는다', async () => {
  const t = await setup();
  try {
    const stall = async () => {
      const a = await t.direct({ kind: 'BEGIN', saleId: t.saleId });
      await t.db.query("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [a.jobId]);
      const b = await t.direct({ kind: 'BEGIN', saleId: t.saleId });
      assert.equal(b.ok, true);
      return [a, b];
    };
    const end = (job, result) => t.direct({ kind: 'FINISH', jobId: job.jobId, leaseToken: job.leaseToken, result });

    // B 성공 뒤 A의 실패가 늦게 와도 판매는 성공(B) 그대로다. A의 결과는 A의 줄에만 남는다.
    let [a, b] = await stall();
    assert.equal((await end(b, 'SUCCESS')).ok, true);
    const printed = await t.sale();
    assert.equal(printed.print_status, 'PRINTED');
    assert.equal((await end(a, 'FAILED')).ok, true);
    assert.deepEqual(await t.sale(), printed);
    assert.deepEqual((await t.jobs()).map((j) => j.status), ['FAILED', 'SUBMITTED']);

    // 반대로 B 실패 뒤 A의 성공이 늦게 와도 판매는 실패(B) 그대로다.
    [a, b] = await stall();
    assert.equal((await end(b, 'FAILED')).ok, true);
    const failed = await t.sale();
    assert.equal(failed.print_status, 'FAILED');
    assert.equal(failed.print_error, '프린터 오류');
    assert.equal((await end(a, 'SUCCESS')).ok, true);
    assert.deepEqual(await t.sale(), failed);

    // B가 아직 출력 중일 때 A가 늦게 끝나도 판매는 "확인 필요"로 남고, B의 결과가 정한다.
    [a, b] = await stall();
    assert.equal((await end(a, 'SUCCESS')).ok, true);
    assert.equal((await t.sale()).print_error, '출력 여부 확인 필요');
    assert.equal((await end(b, 'SUCCESS')).ok, true);
    assert.equal((await t.sale()).print_status, 'PRINTED');
  } finally { await t.db.close(); }
});
