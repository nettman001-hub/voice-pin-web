-- 202611030001_manage_fulfillment.sql
-- 관리탭 재설계 PR 2: 연락처 연결, 보관(킵)·출고 상품 상태, 정산서 한 번만 보내기.
--
-- 원칙
-- - 새 표(buyer_contacts, fulfillment_items, fulfillment_events)는 회원이 읽기만 한다. 쓰기는 sales-api 를 거친
--   public.voicecap_manage() 한 곳에서만 (service_role). 두 기기가 같은 상품을 동시에 출고하지 못하게 잠근다.
-- - 모든 쓰기는 operationId 로 한 번만 실행된다 (public.operations 재사용). 같은 번호로 다시 오면 처음 결과를 돌려준다.
-- - 기존 invoices/shipments 의 열과 상태는 그대로 두고 열만 더한다. 옛 화면은 계속 동작한다.
-- - 구매자 키는 웹과 같은 buyer:<id> / nickname:<정규화> 문자열을 클라이언트가 보낸다. 비슷한 닉네임으로 합치지 않는다.
-- - 옛 workspace_settings blob(buyer_phone_links, customer_keeping_records)은 지우지 않고 복사만 한다.

-- 1. 연락처 연결: 전화번호 하나 = 한 구매자. 판매자가 해제한 번호는 BLOCKED 로 남겨 같은 닉네임에 다시 붙지 않게 한다.
create table if not exists public.buyer_contacts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone text not null check (phone ~ '^0[0-9]{8,10}$'),
  buyer_key text,
  nickname text not null default '',
  state text not null check (state in ('LINKED', 'BLOCKED')),
  source text not null default 'MANUAL' check (source in ('MANUAL', 'MESSAGE', 'LEGACY')),
  linked_by text,
  linked_at timestamptz not null default now(),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, phone)
);
create index if not exists buyer_contacts_buyer_idx on public.buyer_contacts (workspace_id, buyer_key) where state = 'LINKED';

-- 2. 상품(판매 한 건)별 출고 상태. 행이 없으면 "결제 전" 또는 "발송 대기"다.
create table if not exists public.fulfillment_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id text not null references public.sales(id) on delete cascade,
  buyer_key text,
  legacy_nickname text,
  state text not null check (state in ('KEPT', 'RESERVED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
  prev_state text check (prev_state in ('KEPT')),
  kept_at timestamptz,
  shipment_id text references public.shipments(id) on delete set null,
  cancelled_by text check (cancelled_by in ('CUSTOMER', 'SELLER')),
  cancel_reason text,
  refunded_at timestamptz,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, sale_id)
);
create index if not exists fulfillment_items_buyer_idx on public.fulfillment_items (workspace_id, buyer_key, state);
create index if not exists fulfillment_items_shipment_idx on public.fulfillment_items (workspace_id, shipment_id) where shipment_id is not null;

create table if not exists public.fulfillment_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id text,
  shipment_id text,
  invoice_id text,
  kind text not null,
  from_state text,
  to_state text,
  actor_id text,
  operation_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fulfillment_events_sale_idx on public.fulfillment_events (workspace_id, sale_id, created_at desc);

-- 3. 출고(shipments): 구매자 키, 배송비, 예약 상태, 수정 번호
alter table public.shipments
  add column if not exists buyer_key text,
  add column if not exists shipping_fee integer check (shipping_fee is null or shipping_fee >= 0),
  add column if not exists fee_basis integer check (fee_basis is null or fee_basis >= 0),
  add column if not exists shipping_paid boolean not null default false,
  add column if not exists operation_id uuid,
  add column if not exists revision integer not null default 1;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shipments_status_check') then
    alter table public.shipments drop constraint shipments_status_check;
  end if;
  alter table public.shipments add constraint shipments_status_check
    check (status in ('RESERVED', 'READY', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'));
end $$;

-- 4. 정산서(invoices): 종류, 회차·구매자 키, 금액 나눔, 보내기 잠금
alter table public.invoices
  add column if not exists kind text not null default 'ORDER',
  add column if not exists session_id text,
  add column if not exists buyer_key text,
  add column if not exists product_amount integer check (product_amount is null or product_amount >= 0),
  add column if not exists shipping_fee integer check (shipping_fee is null or shipping_fee >= 0),
  add column if not exists sent_via text,
  add column if not exists send_operation_id uuid,
  add column if not exists send_started_at timestamptz,
  add column if not exists send_error text,
  add column if not exists operation_id uuid,
  add column if not exists revision integer not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_kind_check') then
    alter table public.invoices add constraint invoices_kind_check check (kind in ('ORDER', 'SHIPPING'));
  end if;
end $$;
-- 회차×구매자마다 열린 주문 정산서는 하나. 옛 행은 session_id/buyer_key 가 비어 있어 이 제약에 걸리지 않는다.
create unique index if not exists invoices_one_open_order_idx
  on public.invoices (workspace_id, session_id, buyer_key)
  where kind = 'ORDER' and session_id is not null and buyer_key is not null
    and status in ('DRAFT', 'QUEUED', 'SENT');

-- 5. 읽기 권한 (쓰기는 함수만)
do $$
declare target text;
begin
  foreach target in array array['buyer_contacts', 'fulfillment_items', 'fulfillment_events'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists %I on public.%I', target || ': member read', target);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', target || ': member read', target);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', target);
    execute format('grant select on public.%I to authenticated', target);
  end loop;
end $$;

-- 6. 결제 여부: 입금이 매칭됐거나 결제 완료 정산서에 들어 있는 판매
create or replace function public.voicecap_manage_sale_paid(p_workspace_id uuid, p_sale_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payment_receipts r
    where r.workspace_id = p_workspace_id and r.match_status = 'MATCHED' and r.sale_ids ? p_sale_id
  ) or exists (
    select 1 from public.invoices i
    where i.workspace_id = p_workspace_id and i.status = 'PAID' and i.sale_ids ? p_sale_id
  );
$$;
revoke all on function public.voicecap_manage_sale_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.voicecap_manage_sale_paid(uuid, text) to service_role;

-- 7. 관리 쓰기 한 곳
create or replace function public.voicecap_manage(p_workspace_id uuid, p_actor_id text, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_op uuid;
  v_hash text := md5(coalesce(p_action, '') || ':' || coalesce(p_payload::text, ''));
  v_existing public.operations%rowtype;
  v_result jsonb;
  v_sale_ids text[];
  v_sale_id text;
  v_sale public.sales%rowtype;
  v_item public.fulfillment_items%rowtype;
  v_buyer text := nullif(p_payload->>'buyerKey', '');
  v_phone text := nullif(p_payload->>'phone', '');
  v_contact public.buyer_contacts%rowtype;
  v_shipment public.shipments%rowtype;
  v_invoice public.invoices%rowtype;
  v_ship_id text;
  v_invoice_id text;
  v_to text;
  v_missing text[];
  v_count integer;
begin
  begin
    v_op := (p_payload->>'operationId')::uuid;
  exception when others then
    v_op := null;
  end;
  if v_op is null or p_workspace_id is null or p_action is null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'operationId');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 211031));
  select * into v_existing from public.operations where workspace_id = p_workspace_id and operation_id = v_op;
  if found then
    if v_existing.request_hash <> v_hash then
      return jsonb_build_object('ok', false, 'code', 'OPERATION_PAYLOAD_MISMATCH');
    end if;
    if v_existing.status = 'SUCCEEDED' then return v_existing.response_json || jsonb_build_object('replayed', true); end if;
  end if;

  select coalesce(array_agg(distinct value), '{}') into v_sale_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p_payload->'saleIds') = 'array' then p_payload->'saleIds' else '[]'::jsonb end);

  -- 판매 확인: 이 작업공간의 판매이고 합계에 들어가는 판매여야 한다 (보류·취소 제외)
  if p_action in ('keep', 'unkeep', 'cancel-items', 'mark-refunded', 'shipment-reserve', 'backfill-buyer-keys') then
    if cardinality(v_sale_ids) = 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'saleIds');
    end if;
    select count(*) into v_count from public.sales s
      where s.workspace_id = p_workspace_id and s.id = any(v_sale_ids);
    if v_count <> cardinality(v_sale_ids) then
      return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
    end if;
  end if;

  if p_action = 'contact-link' then
    if v_phone is null or v_phone !~ '^0[0-9]{8,10}$' then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'phone');
    end if;
    v_to := upper(coalesce(p_payload->>'mode', 'LINK'));
    select * into v_contact from public.buyer_contacts where workspace_id = p_workspace_id and phone = v_phone for update;
    if v_to = 'LINK' then
      if v_buyer is null then return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'buyerKey'); end if;
      if found and v_contact.state = 'LINKED' and v_contact.buyer_key is distinct from v_buyer
        and coalesce((p_payload->>'replace')::boolean, false) = false then
        return jsonb_build_object('ok', false, 'code', 'PHONE_LINKED_TO_OTHER', 'nickname', v_contact.nickname);
      end if;
      insert into public.buyer_contacts (workspace_id, phone, buyer_key, nickname, state, source, linked_by, linked_at)
        values (p_workspace_id, v_phone, v_buyer, coalesce(p_payload->>'nickname', ''), 'LINKED',
          case when p_payload->>'source' in ('MANUAL', 'MESSAGE') then p_payload->>'source' else 'MANUAL' end, p_actor_id, now())
        on conflict (workspace_id, phone) do update set buyer_key = excluded.buyer_key, nickname = excluded.nickname,
          state = 'LINKED', source = excluded.source, linked_by = excluded.linked_by, linked_at = now(),
          revision = public.buyer_contacts.revision + 1, updated_at = now();
    elsif v_to = 'BLOCK' then
      insert into public.buyer_contacts (workspace_id, phone, buyer_key, nickname, state, source, linked_by)
        values (p_workspace_id, v_phone, v_buyer, coalesce(p_payload->>'nickname', ''), 'BLOCKED', 'MANUAL', p_actor_id)
        on conflict (workspace_id, phone) do update set buyer_key = coalesce(excluded.buyer_key, public.buyer_contacts.buyer_key),
          nickname = case when excluded.nickname = '' then public.buyer_contacts.nickname else excluded.nickname end,
          state = 'BLOCKED', linked_by = excluded.linked_by, revision = public.buyer_contacts.revision + 1, updated_at = now();
    elsif v_to = 'UNLINK' then
      delete from public.buyer_contacts where workspace_id = p_workspace_id and phone = v_phone;
    else
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'mode');
    end if;
    insert into public.fulfillment_events (workspace_id, kind, to_state, actor_id, operation_id, detail)
      values (p_workspace_id, 'CONTACT_' || v_to, v_to, p_actor_id, v_op, jsonb_build_object('phone', v_phone, 'buyerKey', v_buyer));
    v_result := jsonb_build_object('ok', true, 'phone', v_phone, 'mode', v_to);

  elsif p_action = 'keep' then
    if v_buyer is null then return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'buyerKey'); end if;
    foreach v_sale_id in array v_sale_ids loop
      select * into v_sale from public.sales where workspace_id = p_workspace_id and id = v_sale_id;
      if v_sale.status = '보류' or v_sale.record_state = 'CANCELLED' then
        return jsonb_build_object('ok', false, 'code', 'SALE_NOT_BILLABLE', 'saleId', v_sale_id);
      end if;
      if not public.voicecap_manage_sale_paid(p_workspace_id, v_sale_id) then
        return jsonb_build_object('ok', false, 'code', 'KEEP_REQUIRES_PAYMENT', 'saleId', v_sale_id);
      end if;
      select * into v_item from public.fulfillment_items where workspace_id = p_workspace_id and sale_id = v_sale_id for update;
      if found then
        return jsonb_build_object('ok', false, 'code', 'ITEM_STATE_CONFLICT', 'saleId', v_sale_id, 'state', v_item.state);
      end if;
      insert into public.fulfillment_items (workspace_id, sale_id, buyer_key, state, kept_at)
        values (p_workspace_id, v_sale_id, v_buyer, 'KEPT', now());
      insert into public.fulfillment_events (workspace_id, sale_id, kind, to_state, actor_id, operation_id)
        values (p_workspace_id, v_sale_id, 'KEEP', 'KEPT', p_actor_id, v_op);
    end loop;
    v_result := jsonb_build_object('ok', true, 'saleIds', to_jsonb(v_sale_ids));

  elsif p_action = 'unkeep' then
    foreach v_sale_id in array v_sale_ids loop
      select * into v_item from public.fulfillment_items where workspace_id = p_workspace_id and sale_id = v_sale_id for update;
      if not found or v_item.state <> 'KEPT' then
        return jsonb_build_object('ok', false, 'code', 'ITEM_STATE_CONFLICT', 'saleId', v_sale_id, 'state', v_item.state);
      end if;
      delete from public.fulfillment_items where workspace_id = p_workspace_id and sale_id = v_sale_id;
      insert into public.fulfillment_events (workspace_id, sale_id, kind, from_state, actor_id, operation_id)
        values (p_workspace_id, v_sale_id, 'UNKEEP', 'KEPT', p_actor_id, v_op);
    end loop;
    v_result := jsonb_build_object('ok', true, 'saleIds', to_jsonb(v_sale_ids));

  elsif p_action = 'cancel-items' then
    -- 고객 취소: 포장 전까지만. 출고 예약에 들어 있었으면 그 출고에서 뺀다.
    foreach v_sale_id in array v_sale_ids loop
      select * into v_item from public.fulfillment_items where workspace_id = p_workspace_id and sale_id = v_sale_id for update;
      if found and v_item.state not in ('KEPT', 'RESERVED') then
        return jsonb_build_object('ok', false, 'code', 'ITEM_STATE_CONFLICT', 'saleId', v_sale_id, 'state', v_item.state);
      end if;
      if found and v_item.state = 'RESERVED' and v_item.shipment_id is not null then
        update public.shipments set sale_ids = sale_ids - v_sale_id, revision = revision + 1, updated_at = now()
          where workspace_id = p_workspace_id and id = v_item.shipment_id;
      end if;
      insert into public.fulfillment_items (workspace_id, sale_id, buyer_key, state, cancelled_by, cancel_reason)
        values (p_workspace_id, v_sale_id, v_buyer, 'CANCELLED',
          case when p_payload->>'cancelledBy' = 'SELLER' then 'SELLER' else 'CUSTOMER' end, left(p_payload->>'reason', 200))
        on conflict (workspace_id, sale_id) do update set state = 'CANCELLED', shipment_id = null, prev_state = null,
          buyer_key = coalesce(public.fulfillment_items.buyer_key, excluded.buyer_key),
          cancelled_by = excluded.cancelled_by, cancel_reason = excluded.cancel_reason,
          revision = public.fulfillment_items.revision + 1, updated_at = now();
      insert into public.fulfillment_events (workspace_id, sale_id, shipment_id, kind, from_state, to_state, actor_id, operation_id, detail)
        values (p_workspace_id, v_sale_id, v_item.shipment_id, 'CANCEL', v_item.state, 'CANCELLED', p_actor_id, v_op,
          jsonb_build_object('reason', p_payload->>'reason', 'paid', public.voicecap_manage_sale_paid(p_workspace_id, v_sale_id)));
    end loop;
    v_result := jsonb_build_object('ok', true, 'saleIds', to_jsonb(v_sale_ids));

  elsif p_action = 'mark-refunded' then
    update public.fulfillment_items set refunded_at = now(), revision = revision + 1, updated_at = now()
      where workspace_id = p_workspace_id and sale_id = any(v_sale_ids) and state = 'CANCELLED' and refunded_at is null;
    get diagnostics v_count = row_count;
    insert into public.fulfillment_events (workspace_id, kind, actor_id, operation_id, detail)
      values (p_workspace_id, 'REFUNDED', p_actor_id, v_op, jsonb_build_object('saleIds', to_jsonb(v_sale_ids)));
    v_result := jsonb_build_object('ok', true, 'updated', v_count);

  elsif p_action = 'backfill-buyer-keys' then
    -- 옛 보관 기록(구매자 키 없음)에 웹이 계산한 키를 채운다. 이미 있는 키는 바꾸지 않는다.
    if v_buyer is null then return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'buyerKey'); end if;
    update public.fulfillment_items set buyer_key = v_buyer, revision = revision + 1, updated_at = now()
      where workspace_id = p_workspace_id and sale_id = any(v_sale_ids) and buyer_key is null;
    get diagnostics v_count = row_count;
    v_result := jsonb_build_object('ok', true, 'updated', v_count);

  elsif p_action = 'shipment-reserve' then
    -- 출고 = 보관 중 전체 + 결제된 새 상품. 고객 취소·미결제는 들어올 수 없고, 보관 중인 상품을 빼면 거절한다.
    if v_buyer is null then return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'buyerKey'); end if;
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_buyer, 211032));
    foreach v_sale_id in array v_sale_ids loop
      select * into v_sale from public.sales where workspace_id = p_workspace_id and id = v_sale_id;
      if v_sale.status = '보류' or v_sale.record_state = 'CANCELLED' then
        return jsonb_build_object('ok', false, 'code', 'SALE_NOT_BILLABLE', 'saleId', v_sale_id);
      end if;
      if not public.voicecap_manage_sale_paid(p_workspace_id, v_sale_id) then
        return jsonb_build_object('ok', false, 'code', 'SHIPMENT_ITEM_UNPAID', 'saleId', v_sale_id);
      end if;
      select * into v_item from public.fulfillment_items where workspace_id = p_workspace_id and sale_id = v_sale_id for update;
      if found and v_item.state <> 'KEPT' then
        return jsonb_build_object('ok', false, 'code', 'SHIPMENT_CONFLICT', 'saleId', v_sale_id, 'state', v_item.state,
          'shipmentId', v_item.shipment_id);
      end if;
      if found and v_item.buyer_key is not null and v_item.buyer_key <> v_buyer then
        return jsonb_build_object('ok', false, 'code', 'BUYER_MISMATCH', 'saleId', v_sale_id);
      end if;
    end loop;
    select coalesce(array_agg(sale_id), '{}') into v_missing from public.fulfillment_items
      where workspace_id = p_workspace_id and buyer_key = v_buyer and state = 'KEPT' and not (sale_id = any(v_sale_ids));
    if cardinality(v_missing) > 0 then
      return jsonb_build_object('ok', false, 'code', 'KEPT_ITEMS_MISSING', 'saleIds', to_jsonb(v_missing));
    end if;
    v_ship_id := 'ship-' || v_op::text;
    insert into public.shipments (id, workspace_id, sale_ids, recipient_name, phone_number, address, status, memo,
        buyer_key, shipping_fee, fee_basis, shipping_paid, operation_id, revision)
      values (v_ship_id, p_workspace_id, to_jsonb(v_sale_ids), coalesce(p_payload->>'recipientName', ''),
        coalesce(p_payload->>'phone', ''), coalesce(p_payload->>'address', ''), 'RESERVED', coalesce(p_payload->>'memo', ''),
        v_buyer, greatest(0, coalesce((p_payload->>'shippingFee')::integer, 0)),
        greatest(0, coalesce((p_payload->>'feeBasis')::integer, 0)),
        coalesce((p_payload->>'shippingPaid')::boolean, false), v_op, 1);
    foreach v_sale_id in array v_sale_ids loop
      select * into v_item from public.fulfillment_items where workspace_id = p_workspace_id and sale_id = v_sale_id;
      insert into public.fulfillment_items (workspace_id, sale_id, buyer_key, state, prev_state, shipment_id)
        values (p_workspace_id, v_sale_id, v_buyer, 'RESERVED', null, v_ship_id)
        on conflict (workspace_id, sale_id) do update set state = 'RESERVED', prev_state = 'KEPT', shipment_id = v_ship_id,
          buyer_key = v_buyer, revision = public.fulfillment_items.revision + 1, updated_at = now();
      insert into public.fulfillment_events (workspace_id, sale_id, shipment_id, kind, from_state, to_state, actor_id, operation_id)
        values (p_workspace_id, v_sale_id, v_ship_id, 'RESERVE', coalesce(v_item.state, 'READY_TO_SHIP'), 'RESERVED', p_actor_id, v_op);
    end loop;
    v_result := jsonb_build_object('ok', true, 'shipmentId', v_ship_id, 'saleIds', to_jsonb(v_sale_ids), 'revision', 1);

  elsif p_action = 'shipment-status' then
    v_ship_id := p_payload->>'shipmentId';
    v_to := upper(coalesce(p_payload->>'status', ''));
    select * into v_shipment from public.shipments where workspace_id = p_workspace_id and id = v_ship_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'SHIPMENT_NOT_FOUND'); end if;
    if (p_payload ? 'expectedRevision') and v_shipment.revision <> (p_payload->>'expectedRevision')::integer then
      return jsonb_build_object('ok', false, 'code', 'REVISION_CONFLICT', 'revision', v_shipment.revision);
    end if;
    if not (
      (v_shipment.status in ('RESERVED', 'READY') and v_to in ('PACKED', 'CANCELLED')) or
      (v_shipment.status = 'PACKED' and v_to in ('SHIPPED', 'CANCELLED')) or
      (v_shipment.status = 'SHIPPED' and v_to = 'DELIVERED')
    ) then
      return jsonb_build_object('ok', false, 'code', 'SHIPMENT_STATE_CONFLICT', 'status', v_shipment.status);
    end if;
    update public.shipments set status = v_to,
        carrier = coalesce(nullif(p_payload->>'carrier', ''), carrier),
        tracking_number = coalesce(nullif(p_payload->>'trackingNumber', ''), tracking_number),
        shipped_at = case when v_to = 'SHIPPED' then now() else shipped_at end,
        delivered_at = case when v_to = 'DELIVERED' then now() else delivered_at end,
        revision = revision + 1, updated_at = now()
      where workspace_id = p_workspace_id and id = v_ship_id returning * into v_shipment;
    if v_to = 'CANCELLED' then
      -- 출고 취소: 보관하던 상품은 다시 보관 중, 새 상품은 발송 대기로 돌아간다.
      update public.fulfillment_items set state = 'KEPT', prev_state = null, shipment_id = null,
          revision = revision + 1, updated_at = now()
        where workspace_id = p_workspace_id and shipment_id = v_ship_id and prev_state = 'KEPT' and state in ('RESERVED', 'PACKED');
      delete from public.fulfillment_items
        where workspace_id = p_workspace_id and shipment_id = v_ship_id and state in ('RESERVED', 'PACKED');
    else
      update public.fulfillment_items set state = v_to, revision = revision + 1, updated_at = now()
        where workspace_id = p_workspace_id and shipment_id = v_ship_id and state not in ('CANCELLED');
    end if;
    insert into public.fulfillment_events (workspace_id, shipment_id, kind, to_state, actor_id, operation_id)
      values (p_workspace_id, v_ship_id, 'SHIPMENT_' || v_to, v_to, p_actor_id, v_op);
    v_result := jsonb_build_object('ok', true, 'shipmentId', v_ship_id, 'status', v_to, 'revision', v_shipment.revision);

  elsif p_action = 'invoice-create' then
    if nullif(p_payload->>'sessionId', '') is null or v_buyer is null or cardinality(v_sale_ids) = 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'reason', 'sessionId/buyerKey/saleIds');
    end if;
    select * into v_invoice from public.invoices
      where workspace_id = p_workspace_id and kind = 'ORDER' and session_id = p_payload->>'sessionId'
        and buyer_key = v_buyer and status in ('DRAFT', 'QUEUED', 'SENT') for update;
    if found then
      v_result := jsonb_build_object('ok', true, 'invoiceId', v_invoice.id, 'existing', true, 'status', v_invoice.status,
        'revision', v_invoice.revision);
    else
      v_invoice_id := coalesce(nullif(p_payload->>'invoiceId', ''), 'invoice-' || v_op::text);
      begin
        insert into public.invoices (id, workspace_id, sale_ids, customer_nickname, phone_number, address, amount,
            bank_account, due_date, status, deposit_code, kind, session_id, buyer_key, product_amount, shipping_fee,
            operation_id, revision)
          values (v_invoice_id, p_workspace_id, to_jsonb(v_sale_ids), coalesce(p_payload->>'nickname', ''),
            coalesce(p_payload->>'phone', ''), coalesce(p_payload->>'address', ''),
            greatest(0, coalesce((p_payload->>'productAmount')::integer, 0)) + greatest(0, coalesce((p_payload->>'shippingFee')::integer, 0)),
            coalesce(p_payload->>'bankAccount', ''), coalesce((p_payload->>'dueDate')::date, current_date + 3), 'DRAFT',
            nullif(p_payload->>'depositCode', ''), 'ORDER', p_payload->>'sessionId', v_buyer,
            greatest(0, coalesce((p_payload->>'productAmount')::integer, 0)),
            greatest(0, coalesce((p_payload->>'shippingFee')::integer, 0)), v_op, 1);
      exception when unique_violation then
        return jsonb_build_object('ok', false, 'code', 'INVOICE_CONFLICT');
      end;
      insert into public.fulfillment_events (workspace_id, invoice_id, kind, to_state, actor_id, operation_id)
        values (p_workspace_id, v_invoice_id, 'INVOICE_CREATE', 'DRAFT', p_actor_id, v_op);
      v_result := jsonb_build_object('ok', true, 'invoiceId', v_invoice_id, 'existing', false, 'status', 'DRAFT', 'revision', 1);
    end if;

  elsif p_action = 'invoice-begin-send' then
    -- 보내기 잠금: 한 정산서는 한 번에 한 기기만 보낸다. 2분 넘게 끝나지 않은 잠금은 풀린 것으로 본다.
    select * into v_invoice from public.invoices where workspace_id = p_workspace_id and id = p_payload->>'invoiceId' for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'INVOICE_NOT_FOUND'); end if;
    if v_invoice.status in ('PAID', 'CANCELLED') then
      return jsonb_build_object('ok', false, 'code', 'INVOICE_CLOSED', 'status', v_invoice.status);
    end if;
    if v_invoice.send_operation_id is not null and v_invoice.send_started_at > now() - interval '2 minutes' then
      return jsonb_build_object('ok', false, 'code', 'INVOICE_ALREADY_SENDING');
    end if;
    if v_invoice.status in ('QUEUED', 'SENT') and coalesce((p_payload->>'resend')::boolean, false) = false then
      return jsonb_build_object('ok', false, 'code', 'INVOICE_ALREADY_SENT', 'status', v_invoice.status);
    end if;
    update public.invoices set send_operation_id = v_op, send_started_at = now(), send_error = null,
        revision = revision + 1, updated_at = now()
      where workspace_id = p_workspace_id and id = v_invoice.id returning * into v_invoice;
    v_result := jsonb_build_object('ok', true, 'invoiceId', v_invoice.id, 'sendOperationId', v_op, 'revision', v_invoice.revision);

  elsif p_action = 'invoice-finish-send' then
    select * into v_invoice from public.invoices where workspace_id = p_workspace_id and id = p_payload->>'invoiceId' for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'INVOICE_NOT_FOUND'); end if;
    if v_invoice.send_operation_id is distinct from (p_payload->>'sendOperationId')::uuid then
      return jsonb_build_object('ok', false, 'code', 'SEND_LEASE_LOST');
    end if;
    if coalesce((p_payload->>'sent')::boolean, false) then
      update public.invoices set status = case when status = 'DRAFT' then 'QUEUED' else status end,
          sent_at = now(), sms_message_id = coalesce(nullif(p_payload->>'smsMessageId', ''), sms_message_id),
          sent_via = case when p_payload->>'sentVia' in ('SMS', 'KAKAO', 'MANUAL') then p_payload->>'sentVia' else 'SMS' end,
          send_operation_id = null, send_started_at = null, send_error = null, revision = revision + 1, updated_at = now()
        where workspace_id = p_workspace_id and id = v_invoice.id returning * into v_invoice;
    else
      update public.invoices set send_operation_id = null, send_started_at = null,
          send_error = left(coalesce(p_payload->>'error', '보내기 실패'), 200), revision = revision + 1, updated_at = now()
        where workspace_id = p_workspace_id and id = v_invoice.id returning * into v_invoice;
    end if;
    insert into public.fulfillment_events (workspace_id, invoice_id, kind, to_state, actor_id, operation_id, detail)
      values (p_workspace_id, v_invoice.id, 'INVOICE_SEND', v_invoice.status, p_actor_id, v_op,
        jsonb_build_object('sent', coalesce((p_payload->>'sent')::boolean, false), 'error', v_invoice.send_error));
    v_result := jsonb_build_object('ok', true, 'invoiceId', v_invoice.id, 'status', v_invoice.status,
      'sendError', v_invoice.send_error, 'revision', v_invoice.revision);

  elsif p_action = 'invoice-cancel' then
    select * into v_invoice from public.invoices where workspace_id = p_workspace_id and id = p_payload->>'invoiceId' for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'INVOICE_NOT_FOUND'); end if;
    if v_invoice.status = 'PAID' then return jsonb_build_object('ok', false, 'code', 'INVOICE_CLOSED', 'status', 'PAID'); end if;
    update public.invoices set status = 'CANCELLED', send_operation_id = null, send_started_at = null,
        revision = revision + 1, updated_at = now()
      where workspace_id = p_workspace_id and id = v_invoice.id returning * into v_invoice;
    insert into public.fulfillment_events (workspace_id, invoice_id, kind, to_state, actor_id, operation_id)
      values (p_workspace_id, v_invoice.id, 'INVOICE_CANCEL', 'CANCELLED', p_actor_id, v_op);
    v_result := jsonb_build_object('ok', true, 'invoiceId', v_invoice.id, 'status', 'CANCELLED', 'revision', v_invoice.revision);

  else
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end if;

  insert into public.operations (workspace_id, operation_id, actor_id, action, request_hash, status, response_json)
    values (p_workspace_id, v_op, coalesce(p_actor_id, ''), 'manage-' || p_action, v_hash, 'SUCCEEDED', v_result)
    on conflict (workspace_id, operation_id) do update set status = 'SUCCEEDED', response_json = excluded.response_json,
      updated_at = now();
  return v_result;
end; $$;
revoke all on function public.voicecap_manage(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.voicecap_manage(uuid, text, text, jsonb) to service_role;

-- 8. 옛 blob 복사 (지우지 않는다). 다시 실행해도 같은 결과.
insert into public.buyer_contacts (workspace_id, phone, buyer_key, nickname, state, source, linked_at)
select ws.workspace_id, p.phone, null, coalesce(p.link->>'nickname', ''),
  case when coalesce((p.link->>'blocked')::boolean, false) then 'BLOCKED' else 'LINKED' end, 'LEGACY',
  coalesce((p.link->>'linkedAt')::timestamptz, ws.updated_at)
from public.workspace_settings ws
cross join lateral (
  select regexp_replace(e.key, '[^0-9]', '', 'g') as phone, e.value as link
  from jsonb_each(case when jsonb_typeof(ws.value) = 'object' then ws.value else '{}'::jsonb end) e
  where jsonb_typeof(e.value) = 'object'
) p
where ws.namespace = 'buyer_phone_links' and p.phone ~ '^0[0-9]{8,10}$' and coalesce(p.link->>'nickname', '') <> ''
on conflict (workspace_id, phone) do nothing;

insert into public.fulfillment_items (workspace_id, sale_id, buyer_key, legacy_nickname, state, kept_at)
select distinct on (ws.workspace_id, s.id) ws.workspace_id, s.id,
  case when s.buyer_id is not null then 'buyer:' || s.buyer_id::text end,
  r.record->>'buyerNickname', 'KEPT', coalesce((r.record->>'keptAt')::timestamptz, ws.updated_at)
from public.workspace_settings ws
cross join lateral jsonb_array_elements(case when jsonb_typeof(ws.value) = 'array' then ws.value else '[]'::jsonb end) as r(record)
cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.record->'saleIds') = 'array' then r.record->'saleIds' else '[]'::jsonb end) as k(sale_id)
join public.sales s on s.workspace_id = ws.workspace_id and s.id = k.sale_id
where ws.namespace = 'customer_keeping_records' and r.record->>'status' = 'KEPT'
order by ws.workspace_id, s.id
on conflict (workspace_id, sale_id) do nothing;
