-- 202609100003_ai_health_status.sql
-- AI 슬롯별 건강 점검, 모델 가용성, 3단계 점검 결과 및 기기별/경로별 상태 관리

create table if not exists public.ai_health_status (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  slot_number integer not null check (slot_number in (1, 2)),
  route_key text not null,
  routing_mode text not null check (routing_mode in ('SERVER_DIRECT', 'PC_HELPER')),
  location text not null check (location in ('SAME_PC', 'LAN', 'EXTERNAL_IP')),
  executor_id text not null default 'SERVER',
  endpoint_url text not null default '',
  model text not null default '',
  setting_version integer not null default 1,
  overall_status text not null default 'UNCONFIGURED' check (overall_status in (
    'UNCONFIGURED', 'CHECKING', 'PREPARING', 'AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'RECOVERING', 'EXPIRED'
  )),
  tier1_connection jsonb not null default '{
    "ok": false,
    "status": "UNCONFIGURED",
    "message": "점검 대기"
  }'::jsonb,
  tier2_model_readiness jsonb not null default '{
    "ok": false,
    "status": "NOT_QUERYABLE",
    "message": "점검 대기"
  }'::jsonb,
  tier3_synthetic_inference jsonb not null default '{
    "ok": false,
    "scenarios": [],
    "totalLatencyMs": 0,
    "message": "시험 대기"
  }'::jsonb,
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  last_latency_ms integer default null,
  last_checked_at timestamptz not null default now(),
  last_healthy_at timestamptz default null,
  next_check_at timestamptz default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_health_status_unique unique nulls not distinct (workspace_id, slot_number, route_key)
);

create index if not exists ai_health_status_ws_slot_idx on public.ai_health_status (workspace_id, slot_number);
create index if not exists ai_health_status_route_idx on public.ai_health_status (route_key, overall_status);

-- RLS 활성화
alter table public.ai_health_status enable row level security;

-- 인증된 사용자 및 작업공간 구성원은 상태 조회 가능
drop policy if exists ai_health_status_select_policy on public.ai_health_status;
create policy ai_health_status_select_policy on public.ai_health_status
  for select to authenticated
  using (true);

-- 관리자(ADMIN) 또는 서버 service_role만 상태 갱신/삽입 가능
drop policy if exists ai_health_status_write_policy on public.ai_health_status;
create policy ai_health_status_write_policy on public.ai_health_status
  for all to authenticated
  using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'ADMIN'
  )
  with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'ADMIN'
  );
