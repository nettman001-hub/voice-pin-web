-- 202609100002_ai_resolution_settings.sql
-- 판매 보류·음성 정정 AI 설정, 비밀정보 격리, 설정 버전 관리

-- 1. AI 설정 테이블 (ai_settings)
create table if not exists public.ai_settings (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'GLOBAL' check (scope in ('GLOBAL', 'WORKSPACE')),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  applied_version integer not null default 1 check (applied_version >= 1),
  is_draft boolean not null default false,
  enabled_pending_resolution boolean not null default true,
  enabled_voice_correction boolean not null default true,
  primary_slot integer not null default 1 check (primary_slot in (1, 2)),
  auto_fallback_enabled boolean not null default true,
  recovery_interval_seconds integer not null default 30 check (recovery_interval_seconds >= 5 and recovery_interval_seconds <= 600),
  auto_return_to_primary boolean not null default true,
  cloud_monthly_budget_krw integer default null check (cloud_monthly_budget_krw is null or cloud_monthly_budget_krw >= 0),
  slot1 jsonb not null default '{
    "type": "LOCAL",
    "provider": "OLLAMA",
    "model": "qwen2.5:7b",
    "location": "SAME_PC",
    "endpointUrl": "http://127.0.0.1:11434",
    "routingMode": "PC_HELPER",
    "authType": "NONE",
    "timeoutSeconds": 20,
    "connectTimeoutSeconds": 3
  }'::jsonb,
  slot2 jsonb not null default '{
    "type": "CLOUD",
    "provider": "OPENAI",
    "model": "gpt-4o-mini",
    "location": "EXTERNAL_IP",
    "endpointUrl": "",
    "routingMode": "SERVER_DIRECT",
    "authType": "API_KEY",
    "timeoutSeconds": 15,
    "connectTimeoutSeconds": 3
  }'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_settings_scope_ws_unique unique nulls not distinct (scope, workspace_id)
);

create index if not exists ai_settings_scope_idx on public.ai_settings (scope, workspace_id);

-- 2. AI 인증 비밀정보 격리 보관 테이블 (ai_secrets)
-- 클라우드 API Key 및 서버 직접 호출용 토큰을 별도로 격리하여 일반 클라이언트에 노출되지 않도록 보호
create table if not exists public.ai_secrets (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid not null references public.ai_settings(id) on delete cascade,
  slot_number integer not null check (slot_number in (1, 2)),
  secret_type text not null check (secret_type in ('API_KEY', 'BEARER_TOKEN', 'CUSTOM_HEADER')),
  secret_value text not null,
  masked_value text not null,
  header_name text default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_secrets_setting_slot_unique unique (setting_id, slot_number)
);

create index if not exists ai_secrets_setting_idx on public.ai_secrets (setting_id, slot_number);

-- 3. AI 설정 변경 이력 테이블 (ai_settings_history)
create table if not exists public.ai_settings_history (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid not null references public.ai_settings(id) on delete cascade,
  version integer not null,
  applied_version integer not null,
  snapshot jsonb not null,
  change_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_settings_history_setting_idx on public.ai_settings_history (setting_id, version desc);

-- 4. RLS 보안 활성화
alter table public.ai_settings enable row level security;
alter table public.ai_secrets enable row level security;
alter table public.ai_settings_history enable row level security;

-- ai_secrets는 RLS 정책을 생성하지 않음으로써 service_role(Edge Function)만 접근 가능하도록 엄격히 격리

-- ai_settings: 인증된 사용자는 조회 가능 (단, 비밀정보는 이 테이블에 없음)
create policy ai_settings_select_policy on public.ai_settings
  for select to authenticated
  using (true);

-- ai_settings: 관리자(app_metadata role = ADMIN)만 변경 가능
create policy ai_settings_admin_write_policy on public.ai_settings
  for all to authenticated
  using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'ADMIN'
  )
  with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'ADMIN'
  );

-- ai_settings_history: 인증된 사용자는 조회 가능
create policy ai_settings_history_select_policy on public.ai_settings_history
  for select to authenticated
  using (true);

-- ai_settings_history: 관리자만 기록 가능
create policy ai_settings_history_insert_policy on public.ai_settings_history
  for insert to authenticated
  with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'ADMIN'
  );

-- 초기 GLOBAL 설정 행 자동 생성
insert into public.ai_settings (scope, version, applied_version, is_draft)
values ('GLOBAL', 1, 1, false)
on conflict do nothing;
