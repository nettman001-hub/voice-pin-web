import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (name) => fs.readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

/** 도우미-폰 연결 시험용 DB: 기존 터치 판매 마이그레이션 위에 새 마이그레이션을 적용한다. */
export async function helperLinkDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create schema realtime; create table realtime.messages(extension text); create function realtime.topic() returns text language sql as $$ select ''::text $$;
    create table workspaces(id uuid primary key, name text); create function is_workspace_member(uuid) returns boolean language sql as $$ select true $$;
    create table workspace_members(workspace_id uuid, user_id uuid, role text, primary key(workspace_id,user_id));
    create table workspace_settings(workspace_id uuid, namespace text, value jsonb, updated_at timestamptz default now(), primary key(workspace_id,namespace));
    create table devices(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text, token_hash text unique, app_version text,
      last_seen_at timestamptz, revoked_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
      capabilities text[] not null default array['SMS'], device_type text not null default 'ANDROID_SMS', is_output_device boolean default false, revision integer default 1);
    create table audit_logs(id uuid primary key default gen_random_uuid(), workspace_id uuid, actor_user_id uuid, actor_device_id uuid, action text,
      entity_type text, entity_id text, metadata jsonb, created_at timestamptz default now());
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
    '202610310002_touch_print_targets.sql', '202611030002_helper_android_link.sql',
    '202611030004_helper_phone_controls_delivery.sql']) await db.exec(read(name));
  // 두 번 적용해도 실패하지 않는다(추가 전용·재실행 안전).
  await db.exec(read('202611030002_helper_android_link.sql'));
  await db.exec(read('202611030004_helper_phone_controls_delivery.sql'));
  return db;
}
