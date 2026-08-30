-- VoiceCAP 운영 데이터 원본. Supabase SQL Editor 또는 `supabase db push`로 적용한다.
-- 모든 업무 데이터는 workspace_id로 분리하며 브라우저와 Android가 임의의 sellerId를 지정하지 않는다.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'MANAGER', 'STAFF')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_manager(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role in ('OWNER', 'MANAGER')
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 다른 앱도 같은 auth.users를 사용하므로 여기서는 인증 트리거를 만들거나 바꾸지 않는다.
-- VoiceCAP 전용 Edge Function `voicecap-onboard`가 사용자가 처음 로그인할 때
-- profiles/workspaces/workspace_members를 만든다.

create table if not exists public.sales (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id text not null,
  buyer_nickname text not null,
  amount integer not null default 0 check (amount >= 0),
  recognized_at timestamptz not null,
  raw_transcript text not null default '',
  status text not null check (status in ('자동저장', '수동수정', '확정', '보류')),
  product_name text,
  capture_image_paths jsonb not null default '[]'::jsonb,
  note text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_workspace_recognized_idx on public.sales (workspace_id, recognized_at desc);
create index if not exists sales_workspace_session_idx on public.sales (workspace_id, session_id);

create table if not exists public.customer_messages (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid,
  external_id text,
  phone_number text not null,
  body text not null,
  direction text not null check (direction in ('INCOMING', 'OUTGOING')),
  category text not null check (category in ('PURCHASE_INFO', 'CUSTOMER_INQUIRY', 'QUESTION', 'ANSWER', 'INVOICE', 'SHIPPING', 'GENERAL')),
  status text not null check (status in ('RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'FAILED')),
  sale_ids jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  received_at timestamptz,
  sent_at timestamptz,
  error text,
  lease_device_id uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_messages_workspace_external_idx
  on public.customer_messages (workspace_id, external_id)
  where external_id is not null;
create index if not exists customer_messages_workspace_created_idx on public.customer_messages (workspace_id, created_at desc);
create index if not exists customer_messages_outbox_idx on public.customer_messages (workspace_id, status, lease_expires_at, created_at)
  where direction = 'OUTGOING';

create table if not exists public.purchase_claims (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id text not null references public.customer_messages(id) on delete cascade,
  phone_number text not null,
  nickname text not null default '',
  address text not null default '',
  product_name text not null default '',
  amount integer check (amount is null or amount >= 0),
  capture_image_paths jsonb not null default '[]'::jsonb,
  sale_ids jsonb not null default '[]'::jsonb,
  match_status text not null check (match_status in ('NOT_RECEIVED', 'MATCHED', 'MISMATCH', 'NEEDS_REVIEW')),
  field_matches jsonb not null default '{}'::jsonb,
  seller_note text not null default '',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists purchase_claims_message_idx on public.purchase_claims (message_id);

create table if not exists public.invoices (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_ids jsonb not null default '[]'::jsonb,
  customer_nickname text not null,
  phone_number text not null,
  address text not null default '',
  amount integer not null check (amount >= 0),
  bank_account text not null,
  due_date date not null,
  status text not null check (status in ('DRAFT', 'QUEUED', 'SENT', 'PAID', 'CANCELLED')),
  sms_message_id text references public.customer_messages(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_receipts (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  external_id text,
  payer_name text not null,
  amount integer not null check (amount > 0),
  paid_at timestamptz not null,
  memo text,
  sale_ids jsonb not null default '[]'::jsonb,
  invoice_id text references public.invoices(id) on delete set null,
  match_status text not null check (match_status in ('UNMATCHED', 'MATCHED', 'NEEDS_REVIEW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_receipts_workspace_external_idx
  on public.payment_receipts (workspace_id, external_id)
  where external_id is not null;

create table if not exists public.shipments (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_ids jsonb not null default '[]'::jsonb,
  recipient_name text not null,
  phone_number text not null default '',
  address text not null default '',
  carrier text not null default '',
  tracking_number text not null default '',
  status text not null check (status in ('READY', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
  memo text not null default '',
  sms_message_id text references public.customer_messages(id) on delete set null,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.verified_sales (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id text not null references public.sales(id) on delete cascade,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null default now(),
  primary key (workspace_id, sale_id)
);

create table if not exists public.workspace_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  namespace text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, namespace)
);

create table if not exists public.device_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_pairing_codes_active_idx on public.device_pairing_codes (workspace_id, expires_at)
  where claimed_at is null;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  app_version text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_messages
  add constraint customer_messages_device_id_fkey
  foreign key (device_id) references public.devices(id) on delete set null;
alter table public.customer_messages
  add constraint customer_messages_lease_device_id_fkey
  foreign key (lease_device_id) references public.devices(id) on delete set null;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_device_id uuid references public.devices(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
declare
  target text;
begin
  foreach target in array array[
    'profiles', 'workspaces', 'workspace_members', 'sales', 'customer_messages',
    'purchase_claims', 'invoices', 'payment_receipts', 'shipments', 'verified_sales',
    'workspace_settings', 'device_pairing_codes', 'devices', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', target);
  end loop;
end;
$$;

create policy "profiles: own profile" on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "workspaces: member read" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "workspaces: owner update" on public.workspaces
  for update to authenticated using (public.is_workspace_manager(id)) with check (public.is_workspace_manager(id));

create policy "workspace_members: member read" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "workspace_members: manager manage" on public.workspace_members
  for all to authenticated using (public.is_workspace_manager(workspace_id)) with check (public.is_workspace_manager(workspace_id));

do $$
declare
  target text;
begin
  foreach target in array array[
    'sales', 'customer_messages', 'purchase_claims', 'invoices', 'payment_receipts',
    'shipments', 'verified_sales', 'workspace_settings', 'device_pairing_codes', 'devices', 'audit_logs'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', target || ': member read', target);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_workspace_member(workspace_id))', target || ': member insert', target);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', target || ': member update', target);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_workspace_manager(workspace_id))', target || ': manager delete', target);
  end loop;
end;
$$;

-- Devices and pairing codes are created/claimed only by Edge Functions using service_role.
revoke insert, update, delete on public.devices, public.device_pairing_codes from authenticated;

grant usage on schema public to authenticated;
grant update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.sales, public.customer_messages, public.purchase_claims,
  public.invoices, public.payment_receipts, public.shipments, public.verified_sales,
  public.workspace_settings, public.audit_logs to authenticated;
grant select on public.workspaces, public.workspace_members, public.profiles, public.devices to authenticated;

create or replace function public.claim_outbox_messages(
  p_workspace_id uuid,
  p_device_id uuid,
  p_limit integer default 20
)
returns setof public.customer_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.devices
    where id = p_device_id and workspace_id = p_workspace_id and revoked_at is null
  ) then
    raise exception 'device is not active';
  end if;

  return query
  with selected as (
    select id
    from public.customer_messages
    where workspace_id = p_workspace_id
      and direction = 'OUTGOING'
      and status in ('QUEUED', 'SENDING')
      and (lease_expires_at is null or lease_expires_at < now())
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.customer_messages message
    set status = 'SENDING',
        lease_device_id = p_device_id,
        lease_expires_at = now() + interval '5 minutes',
        attempt_count = message.attempt_count + 1,
        updated_at = now()
    from selected
    where message.id = selected.id
    returning message.*
  )
  select * from claimed;
end;
$$;
revoke all on function public.claim_outbox_messages(uuid, uuid, integer) from public;
grant execute on function public.claim_outbox_messages(uuid, uuid, integer) to service_role;

create or replace function public.add_audit_log(
  p_workspace_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata);
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'profiles', 'workspaces', 'sales', 'customer_messages', 'purchase_claims',
    'invoices', 'payment_receipts', 'shipments', 'workspace_settings', 'devices'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || target || '_updated_at', target);
    execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_at()', 'set_' || target || '_updated_at', target);
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voicecap-private', 'voicecap-private', false, 4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_workspace_id(object_name text)
returns uuid
language plpgsql
stable
as $$
declare
  prefix text;
begin
  prefix := (storage.foldername(object_name))[1];
  if prefix is null or prefix !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return prefix::uuid;
end;
$$;

create policy "voicecap storage: workspace read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voicecap-private'
    and public.is_workspace_member(public.storage_workspace_id(name))
  );
create policy "voicecap storage: workspace upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voicecap-private'
    and public.is_workspace_member(public.storage_workspace_id(name))
  );
create policy "voicecap storage: workspace update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'voicecap-private'
    and public.is_workspace_member(public.storage_workspace_id(name))
  )
  with check (
    bucket_id = 'voicecap-private'
    and public.is_workspace_member(public.storage_workspace_id(name))
  );
create policy "voicecap storage: workspace delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'voicecap-private'
    and public.is_workspace_manager(public.storage_workspace_id(name))
  );
