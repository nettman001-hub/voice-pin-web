-- Migration: 202609100006_voice_correction_resolution.sql
-- Description: 음성 정정 및 정정 보류 요청 관리 테이블 (PLAN.md 1-B, 5단계 정정 보류)

create table if not exists pending_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  session_id text not null,
  status text not null check (status in ('PENDING', 'APPLIED', 'CANCELLED', 'CONFLICT')) default 'PENDING',
  target_sale_id text,
  candidate_sale_ids text[] not null default '{}',
  original_utterance text not null,
  follow_up_utterances jsonb not null default '[]'::jsonb,
  parsed_correction jsonb not null,
  missing_info text[] not null default '{}',
  conflict_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pending_corrections_ws_session on pending_corrections (workspace_id, session_id);
create index if not exists idx_pending_corrections_status on pending_corrections (status);
create index if not exists idx_pending_corrections_target_sale on pending_corrections (target_sale_id);
