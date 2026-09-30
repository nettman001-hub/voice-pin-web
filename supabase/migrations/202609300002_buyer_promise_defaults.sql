-- Preserve a seller's explicit no-show decision independently from deletable sales.
-- A buyer can purchase several products in one broadcast, but default only once.
create table if not exists public.buyer_promise_defaults (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  buyer_key text not null,
  buyer_nickname text not null,
  session_id text not null,
  status text not null check (status in ('CONFIRMED', 'CANCELLED')),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, buyer_key, session_id),
  constraint buyer_promise_defaults_key_valid check (length(buyer_key) between 3 and 150),
  constraint buyer_promise_defaults_nickname_valid check (length(buyer_nickname) between 1 and 200)
);

create index if not exists buyer_promise_defaults_workspace_nickname_idx
  on public.buyer_promise_defaults (workspace_id, buyer_nickname);

alter table public.buyer_promise_defaults enable row level security;
create policy "buyer_promise_defaults: member read" on public.buyer_promise_defaults
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "buyer_promise_defaults: member insert" on public.buyer_promise_defaults
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
create policy "buyer_promise_defaults: member update" on public.buyer_promise_defaults
  for update to authenticated using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
grant select, insert, update on public.buyer_promise_defaults to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'buyer_promise_defaults') then
    alter publication supabase_realtime add table public.buyer_promise_defaults;
  end if;
end;
$$;
