-- 202609100005_pending_sales_resolution.sql
-- 자동 적재 판매 보류 원인 구조화, 근거 보존, AI 검증 및 이력 관리

alter table public.sales
  add column if not exists pending_reasons jsonb not null default '[]'::jsonb,
  add column if not exists evidence_snapshot jsonb default null,
  add column if not exists ai_verification jsonb default null,
  add column if not exists history jsonb not null default '[]'::jsonb;

-- 보류 판매 고속 검색 인덱스
create index if not exists sales_pending_status_idx
  on public.sales (workspace_id, session_id, status)
  where status = '보류';
