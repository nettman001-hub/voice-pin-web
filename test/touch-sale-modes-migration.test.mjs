import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (name) =>
  fs.readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
test('touch sales keep required capture paths, recover queued operations once, and preserve number modes', async () => {
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
        printed_at timestamptz,print_error text,capture_image_paths jsonb not null default '[]'::jsonb,updated_at timestamptz default now());
      create table print_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,sale_id text,sale_revision integer,kind text,status text default 'QUEUED',
        immutable_payload jsonb,lease_token text,lease_expires_at timestamptz,attempts integer default 0,result text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table sale_revisions(workspace_id uuid,sale_id text,old_revision integer,new_revision integer,before_value jsonb,after_value jsonb,actor_user_id uuid,reason text);`);
    await db.exec(read('202610210001_touch_sales.sql'));
    await db.exec(read('202610290001_touch_sale_modes.sql'));
    await db.exec(read('202610290001_touch_sale_modes.sql'));
    const workspace = crypto.randomUUID(),
      session = crypto.randomUUID(),
      actor = crypto.randomUUID(),
      producer = crypto.randomUUID();
    await db.query('insert into workspaces values($1)', [workspace]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE')", [
      session,
      workspace,
    ]);
    const call = async (name, args) =>
      (
        await db.query(
          `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`,
          args,
        )
      ).rows[0].result;
    const start = (salesMode) => call('voicecap_touch_run', [
      workspace,
      producer,
      session,
      'START',
      JSON.stringify({
        settings: {
          prepareSeconds: 4,
          fallbackDelaySeconds: 6,
          salesMode,
        },
        state: {},
      }),
    ]);
    await start('BASIC');
    const sale = (id, extra = {}) => ({
      operationId: crypto.randomUUID(),
      sessionId: session,
      inputPrice: '1.5',
      unitPrice: 15000,
      quantity: 1,
      confirmedAt: new Date().toISOString(),
      comment: {
        platformMessageId: id,
        platformUserId: 'u-' + id,
        nickname: id,
        content: '1번',
        capturedAt: new Date().toISOString(),
      },
      ...extra,
    });
    const commit = (p) =>
      call('voicecap_commit_touch_sale', [workspace, actor, JSON.stringify(p)]);
    const assertCommittedOnce = async (payload, result, paths) => {
      assert.equal(result.ok, true);
      assert.deepEqual(await commit(payload), result);
      assert.deepEqual(
        (await db.query('select capture_image_paths from sales where operation_id=$1', [payload.operationId])).rows,
        [{ capture_image_paths: paths }],
      );
      assert.deepEqual(
        (await db.query('select kind,status from print_jobs where sale_id=$1', [result.saleId])).rows,
        [{ kind: 'SALE', status: 'QUEUED' }],
      );
      assert.deepEqual(
        (await db.query('select status from operations where operation_id=$1', [payload.operationId])).rows,
        [{ status: 'SUCCEEDED' }],
      );
    };
    // The deployed schema requires an image list before the first photo exists.
    // Keep the old migration in this upgrade test to prove the queued operation recovers.
    const queued = sale('queued-basic');
    await assert.rejects(commit(queued), (error) =>
      error.code === '23502' && error.column === 'capture_image_paths',
    );
    for (const table of ['sales', 'print_jobs', 'operations'])
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0);
    await db.exec(read('202610310001_touch_sale_capture_paths.sql'));
    await db.exec(read('202610310001_touch_sale_capture_paths.sql'));
    const recovered = await commit(queued);
    assert.equal(recovered.productId, null);
    assert.equal(recovered.captureStatus, 'PENDING');
    await assertCommittedOnce(queued, recovered, []);
    assert.deepEqual(
      (await db.query("select has_function_privilege('anon','voicecap_commit_touch_sale(uuid,uuid,jsonb)','execute') anon, has_function_privilege('authenticated','voicecap_commit_touch_sale(uuid,uuid,jsonb)','execute') authenticated, has_function_privilege('service_role','voicecap_commit_touch_sale(uuid,uuid,jsonb)','execute') service_role")).rows[0],
      { anon: false, authenticated: false, service_role: true },
    );
    await start('NUMBER');
    const numbered = sale('a', { productLabel: '1번', slipLine: '1번' });
    const a = await commit(numbered);
    await assertCommittedOnce(numbered, a, []);
    const b = await commit(sale('b', { productLabel: '1번', slipLine: '1번' }));
    assert.equal(a.ok, true);
    assert.equal(a.productId, b.productId);
    assert.equal(a.captureStatus, 'PENDING');
    const products = (
      await db.query('select name,product_code,unit_price,source from products')
    ).rows;
    assert.equal(products.length, 1);
    assert.equal(products[0].name, '1번');
    const job = (
      await db.query(
        'select immutable_payload p from print_jobs where sale_id=$1',
        [a.saleId],
      )
    ).rows[0].p;
    assert.equal(job.productName, '1번');
    assert.equal(job.slipLine, '1번');
    assert.equal(
      (await db.query('select product_name from sales where id=$1', [a.saleId]))
        .rows[0].product_name,
      '1번',
    );
    const captureOff = sale('c', {
      productLabel: '2번',
      slipLine: '2번 · 블랙 M',
      captureOff: true,
    });
    const off = await commit(captureOff);
    assert.equal(off.captureStatus, 'SKIPPED');
    await assertCommittedOnce(captureOff, off, []);
    assert.equal(
      (await db.query('select count(*)::int n from products')).rows[0].n,
      2,
    );
    // 아직 사진이 없는 번호를 다시 팔면 새로 찍지 않는다.
    const missingPhoto = sale('d', { productLabel: '1번', reuseProductPhoto: true });
    const noPhoto = await commit(missingPhoto);
    assert.equal(noPhoto.captureStatus, 'MISSING');
    await assertCommittedOnce(missingPhoto, noPhoto, []);
    const path = workspace + '/touch-sales/' + a.saleId + '/x.jpg';
    await db.query(
      "update touch_sale_details set capture_status='CAPTURED',image_path=$1,captured_at=now() where sale_id=$2",
      [path, a.saleId],
    );
    const reusePhoto = sale('e', { productLabel: '1번', reuseProductPhoto: true });
    const reused = await commit(reusePhoto);
    assert.equal(reused.captureStatus, 'CAPTURED');
    await assertCommittedOnce(reusePhoto, reused, [path]);
    const detail = (
      await db.query(
        'select image_path,capture_status from touch_sale_details where sale_id=$1',
        [reused.saleId],
      )
    ).rows[0];
    assert.equal(detail.image_path, path);
    assert.deepEqual(
      (
        await db.query('select capture_image_paths p from sales where id=$1', [
          reused.saleId,
        ])
      ).rows[0].p,
      [path],
    );
    // 기본 방식은 상품을 만들지 않는다.
    await start('BASIC');
    const basicRequest = sale('f');
    const basic = await commit(basicRequest);
    assert.equal(basic.productId, null);
    await assertCommittedOnce(basicRequest, basic, []);
    assert.equal(
      (await db.query('select count(*)::int n from products')).rows[0].n,
      2,
    );
    assert.equal(
      (await commit(sale('g', { productLabel: '1234567890123456789012번' })))
        .code,
      'VALIDATION_ERROR',
    );
    // 수정 전표에도 번호와 셋째 줄이 남는다.
    const rev = (
      await db.query('select revision from sales where id=$1', [off.saleId])
    ).rows[0].revision;
    assert.equal(
      (
        await call('voicecap_update_touch_sale', [
          workspace,
          actor,
          JSON.stringify({
            kind: 'PRICE',
            saleId: off.saleId,
            expectedRevision: rev,
            unitPrice: 20000,
          }),
        ])
      ).ok,
      true,
    );
    const correction = (
      await db.query(
        "select immutable_payload p from print_jobs where sale_id=$1 and kind='CORRECTION'",
        [off.saleId],
      )
    ).rows[0].p;
    assert.equal(correction.productName, '2번');
    assert.equal(correction.slipLine, '2번 · 블랙 M');
  } finally {
    await db.close();
  }
});
