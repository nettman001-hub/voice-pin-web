-- 202609100004_ai_task_queue.sql
-- AI 작업 대기열, 슬롯 1->2 자동 전환, 시도 관리 및 서킷 브레이커

-- 1. AI 분석 작업 테이블 (ai_tasks)
create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  session_id text not null,
  sale_id text not null,
  sale_revision integer not null default 1,
  setting_version integer not null default 1,
  evidence_snapshot_version integer not null default 1,
  task_type text not null check (task_type in ('PENDING_RESOLUTION', 'VOICE_CORRECTION', 'SYNTHETIC_TEST')),
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'PROCESSING', 'RESOLVED', 'INSUFFICIENT_DATA', 'FAILED', 'CANCELLED'
  )),
  active_slot integer not null default 1 check (active_slot in (1, 2)),
  current_attempt_id text not null,
  current_utterance text not null,
  request_payload jsonb not null default '{}'::jsonb,
  resolution_result jsonb default null,
  switch_reason text default null,
  failure_reason text default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_tasks_ws_status_idx on public.ai_tasks (workspace_id, status);
create index if not exists ai_tasks_sale_idx on public.ai_tasks (sale_id, sale_revision);
create index if not exists ai_tasks_created_idx on public.ai_tasks (created_at desc);

-- 2. AI 작업 시도 테이블 (ai_task_attempts)
create table if not exists public.ai_task_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.ai_tasks(task_id) on delete cascade,
  attempt_id text not null unique,
  slot_number integer not null check (slot_number in (1, 2)),
  status text not null default 'RUNNING' check (status in (
    'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'
  )),
  is_valid_attempt boolean not null default true,
  started_at timestamptz not null default now(),
  completed_at timestamptz default null,
  latency_ms integer default null,
  error_code text default null,
  error_message text default null,
  result jsonb default null,
  created_at timestamptz not null default now()
);

create index if not exists ai_task_attempts_task_idx on public.ai_task_attempts (task_id, slot_number);

-- 3. AI 서킷 브레이커 상태 테이블 (ai_circuit_breaker)
create table if not exists public.ai_circuit_breaker (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  slot_number integer not null check (slot_number in (1, 2)),
  is_open boolean not null default false,
  consecutive_failures integer not null default 0,
  cooldown_until timestamptz default null,
  consecutive_recovery_successes integer not null default 0,
  last_failure_reason text default null,
  updated_at timestamptz not null default now(),
  constraint ai_circuit_breaker_unique unique nulls not distinct (workspace_id, slot_number)
);

create index if not exists ai_circuit_breaker_ws_idx on public.ai_circuit_breaker (workspace_id, slot_number);

-- 4. RLS 보안 설정
alter table public.ai_tasks enable row level security;
alter table public.ai_task_attempts enable row level security;
alter table public.ai_circuit_breaker enable row level security;

drop policy if exists ai_tasks_select_policy on public.ai_tasks;
create policy ai_tasks_select_policy on public.ai_tasks for select to authenticated using (true);
drop policy if exists ai_tasks_write_policy on public.ai_tasks;
create policy ai_tasks_write_policy on public.ai_tasks for all to authenticated using (true) with check (true);

drop policy if exists ai_attempts_select_policy on public.ai_task_attempts;
create policy ai_attempts_select_policy on public.ai_task_attempts for select to authenticated using (true);
drop policy if exists ai_attempts_write_policy on public.ai_task_attempts;
create policy ai_attempts_write_policy on public.ai_task_attempts for all to authenticated using (true) with check (true);

drop policy if exists ai_cb_select_policy on public.ai_circuit_breaker;
create policy ai_cb_select_policy on public.ai_circuit_breaker for select to authenticated using (true);
drop policy if exists ai_cb_write_policy on public.ai_circuit_breaker;
create policy ai_cb_write_policy on public.ai_circuit_breaker for all to authenticated using (true) with check (true);
