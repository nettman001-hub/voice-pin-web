-- 판매자 로직분석01opus: 실시간 AI 판매 확정 실험 기록.
-- 운영 판매(sales)·정산과 섞이지 않도록 별도 테이블에 저장한다.

create table public.logic_opus_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('LIVE','REPLAY')),
  broadcast_username text not null default '',
  slot_number smallint not null check (slot_number in (1,2)),
  sales_mode text not null default 'AUTO',
  seller_nicknames jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  sale_count integer not null default 0,
  total_amount bigint not null default 0,
  created_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.logic_opus_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.logic_opus_runs(id) on delete cascade,
  event_id text not null,
  kind text not null check (kind in ('COMMENT','SPEECH')),
  occurred_at timestamptz not null,
  nickname text,
  body text not null,
  classification text,
  classification_target text,
  classification_confidence real,
  judged_slot smallint,
  created_at timestamptz not null default now(),
  unique (run_id, event_id)
);
create index logic_opus_events_run_time on public.logic_opus_events (run_id, occurred_at);

create table public.logic_opus_ledger (
  run_id uuid not null references public.logic_opus_runs(id) on delete cascade,
  sale_id text not null,
  seq integer not null,
  status text not null check (status in ('CONFIRMED','REVIEW','CANCELLED')),
  buyer_nickname text not null,
  product text not null,
  option text,
  price integer,
  quantity integer not null default 1,
  confidence real not null,
  print_status text not null default 'NOT_REQUESTED',
  document jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (run_id, sale_id)
);

alter table public.logic_opus_runs enable row level security;
alter table public.logic_opus_events enable row level security;
alter table public.logic_opus_ledger enable row level security;
revoke all on public.logic_opus_runs, public.logic_opus_events, public.logic_opus_ledger from anon, authenticated;
grant all on public.logic_opus_runs, public.logic_opus_events, public.logic_opus_ledger to service_role;
