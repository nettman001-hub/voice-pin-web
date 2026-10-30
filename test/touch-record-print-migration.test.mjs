import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (name) =>
  fs.readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
test('직접 출력 기록: 판매 중이 아니어도 출력 결과를 서버에 남기고 다른 기기가 다시 출력하지 않는다', async () => {
  const db = new PGlite();
  try {
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
    await db.exec(read('202610300001_touch_record_print.sql'));
    const workspace = crypto.randomUUID(),
      other = crypto.randomUUID(),
      session = crypto.randomUUID(),
      actor = crypto.randomUUID(),
      producer = crypto.randomUUID();
    await db.query('insert into workspaces values($1),($2)', [workspace, other]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE')", [session, workspace]);
    const call = async (name, args) =>
      (
        await db.query(
          `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`,
          args,
        )
      ).rows[0].result;
    await call('voicecap_touch_run', [
      workspace, producer, session, 'START',
      JSON.stringify({ settings: { prepareSeconds: 4, fallbackDelaySeconds: 6 }, state: {} }),
    ]);
    const committed = await call('voicecap_commit_touch_sale', [
      workspace, actor,
      JSON.stringify({
        operationId: crypto.randomUUID(), sessionId: session, inputPrice: '1.5', unitPrice: 15000,
        quantity: 1, confirmedAt: new Date().toISOString(),
        comment: { platformMessageId: 'm1', platformUserId: 'u1', nickname: '꽃심이', content: '저요', capturedAt: new Date().toISOString() },
      }),
    ]);
    assert.equal(committed.ok, true);
    const saleId = committed.saleId;
    const record = (result, ws = workspace, id = saleId) =>
      call('voicecap_touch_record_print', [ws, actor, id, result]);
    const sale = async () =>
      (await db.query('select print_status,print_revision,printed_at,print_error,revision from sales where id=$1', [saleId])).rows[0];
    const jobs = async () =>
      (await db.query('select kind,status,result,immutable_payload p from print_jobs where sale_id=$1 order by created_at,id', [saleId])).rows;

    // 새 판매 전표가 아직 대기열에 있으면 그 작업이 상태를 정한다.
    assert.equal((await record('SUCCESS')).code, 'PRINT_ALREADY_PENDING');
    const claimed = await call('voicecap_claim_touch_jobs', [workspace, producer, 10]);
    assert.equal(claimed.jobs.length, 1);
    for (const [kind, result] of [['BEGIN', null], ['ACK', 'SUCCESS']]) {
      assert.equal((await call('voicecap_touch_print', [workspace, claimed.jobs[0].id, claimed.leaseToken, kind, result])).ok, true);
    }
    const before = await sale();
    assert.equal(before.print_status, 'PRINTED');

    // 판매를 끝낸 뒤 직접 출력한 결과도 서버에 남는다.
    await call('voicecap_touch_run', [workspace, producer, session, 'STOP', JSON.stringify({ state: {} })]);
    assert.equal((await record('FAILED')).ok, true);
    let row = await sale();
    assert.equal(row.print_status, 'FAILED');
    assert.equal(row.print_error, '프린터 오류');
    assert.equal(row.revision, before.revision, '판매 revision은 바뀌지 않아 다른 기기의 수정과 충돌하지 않는다');
    assert.equal(row.print_revision, before.print_revision + 1);
    assert.equal((await record('SUCCESS')).ok, true);
    row = await sale();
    assert.equal(row.print_status, 'PRINTED');
    assert.equal(row.print_error, null);
    assert.ok(row.printed_at);
    const list = await jobs();
    assert.deepEqual(list.map((j) => [j.kind, j.status]), [['SALE', 'SUBMITTED'], ['REPRINT', 'FAILED'], ['REPRINT', 'SUBMITTED']]);
    assert.equal(list[2].p.direct, true);
    assert.equal(list[2].p.buyerNickname, '꽃심이');

    // 끝난 상태로 넣었으므로 다시 판매를 켜도 아무도 이 작업을 가져가지 않는다.
    await call('voicecap_touch_run', [
      workspace, producer, session, 'START',
      JSON.stringify({ settings: { prepareSeconds: 4, fallbackDelaySeconds: 6 }, state: {} }),
    ]);
    assert.equal((await call('voicecap_claim_touch_jobs', [workspace, producer, 10])).jobs.length, 0);

    // 잘못된 요청은 거절한다.
    assert.equal((await record('UNKNOWN')).code, 'VALIDATION_ERROR');
    assert.equal((await record(null)).code, 'VALIDATION_ERROR');
    assert.equal((await record('SUCCESS', other)).code, 'NOT_FOUND');
    assert.equal((await record('SUCCESS', workspace, 'missing')).code, 'NOT_FOUND');
    const rev = (await sale()).revision;
    assert.equal((await call('voicecap_update_touch_sale', [workspace, actor,
      JSON.stringify({ kind: 'CANCEL', saleId, expectedRevision: rev })])).ok, true);
    assert.equal((await record('SUCCESS')).code, 'SALE_CANCELLED');
    // 함수는 service_role만 부를 수 있다.
    const grants = (await db.query(
      "select has_function_privilege('authenticated','voicecap_touch_record_print(uuid,uuid,text,text)','execute') a, has_function_privilege('service_role','voicecap_touch_record_print(uuid,uuid,text,text)','execute') s")).rows[0];
    assert.deepEqual(grants, { a: false, s: true });
  } finally {
    await db.close();
  }
});
