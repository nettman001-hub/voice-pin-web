import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('touch sale, chosen comment and receipt commit atomically; retry, session, lease and revision guards run in SQL',async()=>{
  const db=new PGlite();
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
      create table products(id uuid primary key,workspace_id uuid,session_id uuid,name text,product_code text);
      create table operations(workspace_id uuid,operation_id uuid,actor_id text,action text,request_hash text,status text,response_json jsonb,primary key(workspace_id,operation_id));
      create table sales(id text primary key,workspace_id uuid,session_id text,buyer_id uuid,buyer_nickname text,amount integer,unit_price integer,quantity integer,
        status text,source text,raw_transcript text,recognized_at timestamptz,product_id uuid,product_name text,product_name_snapshot text,product_code_snapshot text,
        record_state text,source_comment_ids jsonb,operation_id uuid,print_status text,print_revision integer,revision integer,note text,
        printed_at timestamptz,print_error text,capture_image_paths jsonb,updated_at timestamptz default now());
      create table print_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,sale_id text,sale_revision integer,kind text,status text default 'QUEUED',
        immutable_payload jsonb,lease_token text,lease_expires_at timestamptz,attempts integer default 0,result text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table sale_revisions(workspace_id uuid,sale_id text,old_revision integer,new_revision integer,before_value jsonb,after_value jsonb,actor_user_id uuid,reason text);`);
    const sql=fs.readFileSync(new URL('../supabase/migrations/202610210001_touch_sales.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    const workspace=crypto.randomUUID(),session=crypto.randomUUID(),actor=crypto.randomUUID(),producer=crypto.randomUUID();
    await db.query('insert into workspaces values($1)',[workspace]);await db.query('insert into auth.users values($1)',[actor]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE')",[session,workspace]);
    const call=async(name,args)=> (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
    await call('voicecap_touch_run',[workspace,producer,session,'START',JSON.stringify({settings:{prepareSeconds:4,fallbackDelaySeconds:6},state:{delaySeconds:5}})]);
    const payload={operationId:crypto.randomUUID(),sessionId:session,inputPrice:'1.5',unitPrice:15000,quantity:1,confirmedAt:new Date().toISOString(),
      comment:{platformMessageId:'chosen',platformUserId:'account-123',nickname:'하니',content:'저요',capturedAt:new Date().toISOString()}};
    const commit=p=>call('voicecap_commit_touch_sale',[workspace,actor,JSON.stringify(p)]);
    const first=await commit(payload);assert.equal(first.ok,true);
    assert.equal(Math.round((Date.parse(first.captureDueAt)-Date.parse(payload.confirmedAt))/1000),9);
    assert.deepEqual(await commit(payload),first);
    assert.equal((await commit({...payload,unitPrice:16000,inputPrice:'1.6'})).code,'OPERATION_PAYLOAD_MISMATCH');
    assert.equal((await commit({...payload,operationId:crypto.randomUUID()})).code,'COMMENT_ALREADY_COMMITTED');
    assert.equal((await commit({...payload,operationId:crypto.randomUUID(),allowAdditional:true})).ok,true);
    assert.equal((await db.query('select count(*)::int n from live_comments')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from print_jobs')).rows[0].n,2);
    const badProduct={...payload,operationId:crypto.randomUUID(),productId:crypto.randomUUID(),comment:{...payload.comment,platformMessageId:'rollback',platformUserId:'new-account'}};
    await assert.rejects(commit(badProduct),/TOUCH_PRODUCT_NOT_FOUND/);
    assert.equal((await db.query("select count(*)::int n from buyers where platform_user_id='new-account'")).rows[0].n,0);
    const claimed=await call('voicecap_claim_touch_jobs',[workspace,producer,10]);assert.equal(claimed.jobs.length,2);
    assert.equal((await call('voicecap_claim_touch_jobs',[workspace,producer,10])).jobs.length,0);
    const job=claimed.jobs.find(j=>j.sale_id===first.saleId);
    assert.equal((await call('voicecap_touch_print',[workspace,job.id,claimed.leaseToken,'BEGIN',null])).ok,true);
    assert.equal((await call('voicecap_touch_print',[workspace,job.id,claimed.leaseToken,'BEGIN',null])).code,'PRINT_ALREADY_STARTED');
    assert.equal((await call('voicecap_touch_print',[workspace,job.id,claimed.leaseToken,'ACK','SUCCESS'])).ok,true);
    assert.equal((await db.query('select print_status from sales where id=$1',[first.saleId])).rows[0].print_status,'PRINTED');
    const edit={operationId:crypto.randomUUID(),saleId:first.saleId,expectedRevision:1,kind:'PRICE',unitPrice:18000,reprint:true};
    assert.equal((await call('voicecap_update_touch_sale',[workspace,actor,JSON.stringify(edit)])).ok,true);
    assert.equal((await call('voicecap_update_touch_sale',[workspace,actor,JSON.stringify(edit)])).ok,true,'edit replay must not create another correction receipt');
    assert.equal((await db.query("select count(*)::int n from print_jobs where kind='CORRECTION'")).rows[0].n,1);
    const captures=await call('voicecap_claim_touch_captures',[workspace,producer]);assert.equal(captures.captures.length,2);
    const imagePath=`${workspace}/touch-sales/${first.saleId}/first.jpg`;
    assert.equal((await call('voicecap_touch_capture',[workspace,producer,first.saleId,'CAPTURED',imagePath,new Date().toISOString()])).ok,true);
    const secondPath=imagePath.replace('first.jpg','second.jpg');
    assert.equal((await call('voicecap_touch_capture',[workspace,producer,first.saleId,'CAPTURED',secondPath,new Date().toISOString()])).previousPath,imagePath);
    assert.deepEqual((await db.query('select capture_image_paths from sales where id=$1',[first.saleId])).rows[0].capture_image_paths,[secondPath]);
    assert.equal((await db.query('select revision from sales where id=$1',[first.saleId])).rows[0].revision,2,'photo replacement does not revise/reprint sale');
    const cancel={operationId:crypto.randomUUID(),saleId:first.saleId,expectedRevision:2,kind:'CANCEL'};
    assert.equal((await call('voicecap_update_touch_sale',[workspace,actor,JSON.stringify(cancel)])).ok,true);
    assert.equal((await db.query('select record_state from sales where id=$1',[first.saleId])).rows[0].record_state,'CANCELLED');
    assert.equal((await call('voicecap_touch_capture',[workspace,producer,first.saleId,'CAPTURED',secondPath,new Date().toISOString()])).code,'CAPTURE_LEASE_LOST');
    assert.equal((await call('voicecap_touch_run',[workspace,crypto.randomUUID(),session,'START','{}'])).code,'PC_ALREADY_RUNNING');
    assert.equal((await call('voicecap_claim_touch_jobs',[crypto.randomUUID(),producer,10])).ok,false);
    await db.query("update live_sessions set status='ENDED' where id=$1",[session]);
    assert.deepEqual(await commit(payload),first,'replay still succeeds after end');
    assert.equal((await commit({...payload,operationId:crypto.randomUUID()})).code,'SESSION_ENDED');
  }finally{await db.close();}
});
