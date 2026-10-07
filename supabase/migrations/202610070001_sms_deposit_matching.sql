-- 202610070001_sms_deposit_matching.sql
-- 입금확인(은행 알림/입금 문자) 저장 칸, 정산서 입금코드, 입금자명 별칭, 실시간 게시

-- 1. 입금 내역: 받는 계좌 별칭, 은행, 수집 경로, 올린 기기, 확인 필요 후보 정산서
alter table public.payment_receipts
  add column if not exists receiver_name text,
  add column if not exists bank text,
  add column if not exists source text not null default 'NOTIFICATION',
  add column if not exists device_id uuid references public.devices(id) on delete set null,
  add column if not exists candidate_ids jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_receipts_source_check') then
    alter table public.payment_receipts
      add constraint payment_receipts_source_check check (source in ('NOTIFICATION', 'SMS', 'MANUAL'));
  end if;
end $$;

create index if not exists payment_receipts_workspace_paid_idx
  on public.payment_receipts (workspace_id, paid_at desc);

-- 2. 정산서 입금코드: 고객이 입금자명에 적으면 자동 확정 근거가 된다. 미결 정산서끼리만 겹치지 않으면 된다.
alter table public.invoices add column if not exists deposit_code text;
create unique index if not exists invoices_open_deposit_code_idx
  on public.invoices (workspace_id, deposit_code)
  where deposit_code is not null and status not in ('PAID', 'CANCELLED');
create index if not exists invoices_workspace_open_idx
  on public.invoices (workspace_id, status, created_at desc)
  where status in ('QUEUED', 'SENT');

-- 3. 입금자명(정규화) → 구매 닉네임. buyer_nickname이 빈 값이면 동명이인 등으로 모호해 자동 확정에 쓰지 않는다.
create table if not exists public.depositor_aliases (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payer_name_normalized text not null,
  buyer_nickname text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, payer_name_normalized)
);

alter table public.depositor_aliases enable row level security;

drop policy if exists "depositor_aliases: member read" on public.depositor_aliases;
create policy "depositor_aliases: member read" on public.depositor_aliases
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists "depositor_aliases: member insert" on public.depositor_aliases;
create policy "depositor_aliases: member insert" on public.depositor_aliases
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
drop policy if exists "depositor_aliases: member update" on public.depositor_aliases;
create policy "depositor_aliases: member update" on public.depositor_aliases
  for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "depositor_aliases: manager delete" on public.depositor_aliases;
create policy "depositor_aliases: manager delete" on public.depositor_aliases
  for delete to authenticated using (public.is_workspace_manager(workspace_id));

grant select, insert, update, delete on public.depositor_aliases to authenticated;

drop trigger if exists set_depositor_aliases_updated_at on public.depositor_aliases;
create trigger set_depositor_aliases_updated_at before update on public.depositor_aliases
  for each row execute procedure public.set_updated_at();

-- 4. 웹 실시간 반영: 휴대폰이 올린 문자·입금·구매 신청·정산서 변경을 웹이 바로 받도록 게시한다(이미 있으면 건너뜀).
do $$
declare
  target text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach target in array array['customer_messages', 'payment_receipts', 'purchase_claims', 'invoices'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;
