-- VoiceCAP 상품 중심 판매관리 핵심 스키마 마이그레이션 (v1)
-- 일자: 2026-09-08
-- 대상: live_sessions, products, product_drafts, product_code_reservations, buyers,
--       live_comments, sale_revisions, sale_comment_sources, operations,
--       product_change_previews, print_jobs 및 sales 확장

-- 1. 방송 회차 (live_sessions)
create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_code text not null,
  status text not null check (status in ('ACTIVE', 'ENDED')),
  active_product_id uuid,
  revision integer not null default 1 check (revision >= 1),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 작업공간당 진행 중 회차(ACTIVE)는 최대 1개만 허용
create unique index if not exists live_sessions_workspace_active_idx
  on public.live_sessions (workspace_id)
  where status = 'ACTIVE';

create index if not exists live_sessions_workspace_started_idx
  on public.live_sessions (workspace_id, started_at desc);

-- 2. 상품 (products)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  product_code text not null,
  name text,
  image_path text not null default '',
  image_kind text not null default 'PHOTO' check (image_kind in ('PHOTO', 'NUMBER_IMAGE')),
  unit_price integer check (unit_price is null or (unit_price >= 1 and unit_price <= 99999999)),
  revision integer not null default 1 check (revision >= 1),
  sales_revision integer not null default 0 check (sales_revision >= 0),
  source text not null default 'WEB_VOICE' check (source in ('WEB_VOICE', 'ANDROID', 'MANUAL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_workspace_code_unique unique (workspace_id, product_code)
);

create index if not exists products_workspace_session_idx
  on public.products (workspace_id, session_id, created_at desc);

-- live_sessions의 active_product_id 외래키 연결
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'live_sessions_active_product_id_fkey'
  ) then
    alter table public.live_sessions
      add constraint live_sessions_active_product_id_fkey
      foreign key (active_product_id) references public.products(id) on delete set null;
  end if;
end;
$$;

-- 3. 상품 등록 초안 (product_drafts)
create table if not exists public.product_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  product_id uuid not null,
  product_code text not null,
  name text,
  unit_price integer check (unit_price is null or (unit_price >= 1 and unit_price <= 99999999)),
  image_kind text not null default 'PHOTO' check (image_kind in ('PHOTO', 'NUMBER_IMAGE')),
  upload_path text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'COMMITTED', 'CANCELLED', 'EXPIRED')),
  revision integer not null default 1 check (revision >= 1),
  actor_id text not null,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_drafts_workspace_session_idx
  on public.product_drafts (workspace_id, session_id, expires_at desc);

-- 4. 상품 코드 영구 예약 (product_code_reservations)
create table if not exists public.product_code_reservations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_code text not null,
  product_id uuid not null,
  draft_id uuid,
  reserved_at timestamptz not null default now(),
  primary key (workspace_id, product_code)
);

-- 5. 구매자 신원 (buyers)
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null default 'TIKTOK' check (platform in ('TIKTOK', 'MANUAL', 'OTHER')),
  platform_user_id text,
  platform_unique_id text,
  display_nickname text not null,
  identity_status text not null default 'UNRESOLVED' check (identity_status in ('VERIFIED', 'MANUAL_CONFIRMED', 'UNRESOLVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buyers_workspace_platform_user_idx
  on public.buyers (workspace_id, platform_user_id)
  where platform_user_id is not null;

create index if not exists buyers_workspace_platform_unique_idx
  on public.buyers (workspace_id, platform_unique_id)
  where platform_unique_id is not null;

create index if not exists buyers_workspace_nickname_idx
  on public.buyers (workspace_id, display_nickname);

-- 6. 실시간 댓글 (live_comments)
create table if not exists public.live_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  collector_id uuid not null,
  platform_message_id text not null,
  buyer_id uuid references public.buyers(id) on delete set null,
  nickname_snapshot text not null,
  content text not null,
  captured_at timestamptz not null default now(),
  ingest_sequence bigint not null,
  created_at timestamptz not null default now(),
  constraint live_comments_unique_msg unique (workspace_id, session_id, collector_id, platform_message_id)
);

create index if not exists live_comments_feed_idx
  on public.live_comments (workspace_id, session_id, captured_at desc, ingest_sequence desc);

-- 7. 멱등성 및 작업 처리 (operations)
create table if not exists public.operations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operation_id uuid not null,
  actor_id text not null,
  action text not null,
  request_hash text not null,
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  response_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, operation_id)
);

-- 8. 상품 수정 영향 미리보기 (product_change_previews)
create table if not exists public.product_change_previews (
  token_hash text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  proposed_patch jsonb not null default '{}'::jsonb,
  product_revision integer not null,
  sales_revision integer not null,
  affected_sales_revisions jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  consumed_operation_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists product_change_previews_expires_idx
  on public.product_change_previews (workspace_id, expires_at desc);

-- 9. 전표 인쇄 작업 (print_jobs)
create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id text not null references public.sales(id) on delete cascade,
  sale_revision integer not null default 1,
  kind text not null default 'SALE' check (kind in ('SALE', 'CORRECTION', 'CANCEL', 'REPRINT')),
  reprint_sequence integer not null default 0,
  immutable_payload jsonb not null default '{}'::jsonb,
  target_device_id uuid references public.devices(id) on delete set null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'CLAIMED', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'UNKNOWN', 'CANCELLED')),
  lease_token text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists print_jobs_queue_idx
  on public.print_jobs (workspace_id, status, created_at)
  where status in ('QUEUED', 'CLAIMED', 'SUBMITTING');

create index if not exists print_jobs_sale_idx
  on public.print_jobs (workspace_id, sale_id, sale_revision desc);

-- 10. 판매 이력/정정 (sale_revisions)
create table if not exists public.sale_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id text not null references public.sales(id) on delete cascade,
  old_revision integer not null,
  new_revision integer not null,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_device_id uuid references public.devices(id) on delete set null,
  reason text not null default '',
  operation_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists sale_revisions_sale_idx
  on public.sale_revisions (workspace_id, sale_id, created_at desc);

-- 11. 댓글 소비 근거 (sale_comment_sources)
create table if not exists public.sale_comment_sources (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  comment_id uuid not null references public.live_comments(id) on delete cascade,
  sale_id text not null references public.sales(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, product_id, comment_id)
);

-- 12. 기존 sales 테이블 확장 (하위 호환 필드 추가)
alter table public.sales
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists buyer_id uuid references public.buyers(id) on delete set null,
  add column if not exists quantity integer not null default 1 check (quantity >= 1 and quantity <= 999),
  add column if not exists unit_price integer not null default 0 check (unit_price >= 0 and unit_price <= 99999999),
  add column if not exists product_code_snapshot text,
  add column if not exists product_name_snapshot text,
  add column if not exists product_image_path_snapshot text,
  add column if not exists record_state text not null default 'ACTIVE' check (record_state in ('ACTIVE', 'CANCELLED')),
  add column if not exists source text not null default 'LEGACY' check (source in ('WEB_VOICE', 'ANDROID_COMMENTS', 'MANUAL', 'LEGACY')),
  add column if not exists source_comment_ids jsonb not null default '[]'::jsonb,
  add column if not exists operation_id uuid;

-- 기존 sales 데이터 보존 및 unit_price 백필
update public.sales
set unit_price = amount
where unit_price = 0 and amount > 0;

create index if not exists sales_product_active_idx
  on public.sales (workspace_id, product_id, record_state)
  where product_id is not null;

create index if not exists sales_buyer_active_idx
  on public.sales (workspace_id, buyer_id, record_state)
  where buyer_id is not null;

-- 13. devices 테이블 권한 및 출력 기기 확장
alter table public.devices
  add column if not exists capabilities text[] not null default array['SMS']::text[],
  add column if not exists is_output_device boolean not null default false,
  add column if not exists device_type text not null default 'ANDROID_SMS' check (device_type in ('ANDROID_SMS', 'ANDROID_PHONE', 'WINDOWS_HELPER', 'OTHER')),
  add column if not exists revision integer not null default 1 check (revision >= 1);

-- 14. 신규 테이블 RLS 활성화
do $$
declare
  target text;
begin
  foreach target in array array[
    'live_sessions', 'products', 'product_drafts', 'product_code_reservations',
    'buyers', 'live_comments', 'operations', 'product_change_previews',
    'print_jobs', 'sale_revisions', 'sale_comment_sources'
  ] loop
    execute format('alter table public.%I enable row level security', target);
  end loop;
end;
$$;

-- RLS 정책: 워크스페이스 회원 읽기 허용
do $$
declare
  target text;
begin
  foreach target in array array[
    'live_sessions', 'products', 'buyers', 'live_comments',
    'print_jobs', 'sale_revisions'
  ] loop
    execute format('
      drop policy if exists "%s: member select" on public.%I;
      create policy "%s: member select" on public.%I
        for select to authenticated using (public.is_workspace_member(workspace_id));
    ', target, target, target, target);
  end loop;
end;
$$;

-- 쓰기(INSERT/UPDATE/DELETE)는 데이터 무결성 보장을 위해 전용 SECURITY DEFINER RPC 및 service_role로만 제어
