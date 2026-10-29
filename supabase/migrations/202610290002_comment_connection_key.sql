-- 폰 단독 판매 1단계 (2026-10-29): 댓글 연결 키(Euler)를 서버에만 보관한다.
-- 관리자 메뉴 "댓글 연결 키 (Euler)"에서만 저장하고, 판매자는 키를 보거나 입력하지 않는다.
-- RLS 정책을 만들지 않아 service_role(sales-api)만 읽고 쓴다 (ai_secrets와 같은 방식).
-- 판매자의 틱톡 ID는 기존 workspace_settings(namespace touch_sales)의 tiktokId에 둔다(표 변경 없음).
-- 적용 순서: 이 SQL -> sales-api -> 웹.
create table if not exists public.platform_secrets (
  name text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from anon, authenticated;
