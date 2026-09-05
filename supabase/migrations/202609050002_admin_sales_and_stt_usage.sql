-- VoiceCAP 관리자 판매 관제 및 STT 사용량 집계 마이그레이션
-- 타 서비스(sermon-guide-db)와 100% 격리: VoiceCAP 전용 workspaces 및 auth_app: voicecap만 조인

-- 1. STT 사용 로그 테이블 생성
create table if not exists public.stt_usage_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  provider text not null check (provider in ('DEEPGRAM', 'SONIOX')),
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists stt_usage_logs_user_idx on public.stt_usage_logs (user_id, created_at desc);
create index if not exists stt_usage_logs_workspace_idx on public.stt_usage_logs (workspace_id, created_at desc);

-- RLS 활성화
alter table public.stt_usage_logs enable row level security;

-- 본인 워크스페이스 소속 사용자 조회/삽입 허용
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'stt_usage_logs' and policyname = 'stt_usage_logs: member insert'
  ) then
    create policy "stt_usage_logs: member insert" on public.stt_usage_logs
      for insert to authenticated with check (public.is_workspace_member(workspace_id));
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'stt_usage_logs' and policyname = 'stt_usage_logs: member select'
  ) then
    create policy "stt_usage_logs: member select" on public.stt_usage_logs
      for select to authenticated using (public.is_workspace_member(workspace_id));
  end if;
end;
$$;

grant select, insert on public.stt_usage_logs to authenticated;

-- 2. 관리자 전용 전체 판매 조회 RPC 함수
create or replace function public.get_admin_all_sales()
returns table (
  id text,
  workspace_id uuid,
  workspace_name text,
  seller_user_id uuid,
  seller_email text,
  seller_nickname text,
  session_id text,
  buyer_nickname text,
  amount integer,
  recognized_at timestamptz,
  raw_transcript text,
  status text,
  product_name text,
  note text,
  print_status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select 
    s.id,
    s.workspace_id,
    w.name as workspace_name,
    w.owner_id as seller_user_id,
    coalesce(p.email, u.email, '') as seller_email,
    coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name', ''), split_part(coalesce(p.email, u.email, '판매자'), '@', 1)) as seller_nickname,
    s.session_id,
    s.buyer_nickname,
    s.amount,
    s.recognized_at,
    s.raw_transcript,
    s.status,
    s.product_name,
    s.note,
    coalesce(s.print_status, 'NOT_REQUESTED') as print_status,
    s.created_at
  from public.sales s
  join public.workspaces w on w.id = s.workspace_id
  left join public.profiles p on p.id = w.owner_id
  left join auth.users u on u.id = w.owner_id
  order by s.recognized_at desc;
$$;

grant execute on function public.get_admin_all_sales() to authenticated, anon;

-- 3. 관리자 전용 판매자별 STT 사용 시간 요약 RPC 함수
create or replace function public.get_admin_stt_usage_summary()
returns table (
  user_id uuid,
  email text,
  nickname text,
  workspace_id uuid,
  workspace_name text,
  deepgram_seconds bigint,
  soniox_seconds bigint,
  total_seconds bigint,
  session_count bigint,
  last_used_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select 
    u.id as user_id,
    coalesce(p.email, u.email, '') as email,
    coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name', ''), split_part(coalesce(p.email, u.email, '판매자'), '@', 1)) as nickname,
    w.id as workspace_id,
    w.name as workspace_name,
    coalesce(sum(case when l.provider = 'DEEPGRAM' then l.duration_seconds else 0 end), 0)::bigint as deepgram_seconds,
    coalesce(sum(case when l.provider = 'SONIOX' then l.duration_seconds else 0 end), 0)::bigint as soniox_seconds,
    coalesce(sum(l.duration_seconds), 0)::bigint as total_seconds,
    count(l.id)::bigint as session_count,
    max(l.created_at) as last_used_at
  from auth.users u
  join public.workspace_members wm on wm.user_id = u.id
  join public.workspaces w on w.id = wm.workspace_id
  left join public.profiles p on p.id = u.id
  left join public.stt_usage_logs l on l.user_id = u.id
  where u.raw_user_meta_data->>'auth_app' = 'voicecap'
  group by u.id, p.email, u.email, p.display_name, u.raw_user_meta_data, w.id, w.name
  order by total_seconds desc, last_used_at desc nulls last;
$$;

grant execute on function public.get_admin_stt_usage_summary() to authenticated, anon;

-- 4. 특정 판매자의 STT 사용 세부 로그 조회 RPC 함수
create or replace function public.get_admin_stt_usage_logs(target_user_id uuid)
returns table (
  id uuid,
  session_id text,
  provider text,
  duration_seconds integer,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select 
    l.id,
    l.session_id,
    l.provider,
    l.duration_seconds,
    l.started_at,
    l.ended_at,
    l.created_at
  from public.stt_usage_logs l
  where l.user_id = target_user_id
  order by l.created_at desc
  limit 200;
$$;

grant execute on function public.get_admin_stt_usage_logs(uuid) to authenticated, anon;
