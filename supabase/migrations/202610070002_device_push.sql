-- 202610070002_device_push.sql
-- 웹이 문자를 대기열에 넣으면 휴대폰을 FCM으로 바로 깨우기 위한 기기별 알림 토큰.
-- devices는 회원이 읽을 수 있는 표라서 토큰은 따로 두고, 서버(Edge Function)만 읽고 쓴다.

create table if not exists public.device_push_tokens (
  device_id uuid primary key references public.devices(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token text not null unique,
  updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_workspace_idx
  on public.device_push_tokens (workspace_id);

alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from anon, authenticated;
