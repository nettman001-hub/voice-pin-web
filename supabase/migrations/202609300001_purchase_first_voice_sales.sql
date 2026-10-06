-- Buyer-comment-first voice allocations. This function is deliberately the only
-- write path for automatic voice sales; caller authentication is done by sales-api.
alter table public.sales add column if not exists purchase_request_id text;
create unique index if not exists sales_voice_request_once_idx
  on public.sales (workspace_id, purchase_request_id)
  where source = 'WEB_VOICE' and purchase_request_id is not null;

create or replace function public.voicecap_commit_voice_sale(
  p_workspace_id uuid, p_actor_id text, p_operation_id uuid,
  p_sale_id text, p_session_id uuid, p_request_id text,
  p_platform_message_id text, p_product_id uuid, p_product_code text, p_product_name text,
  p_amount integer, p_raw_transcript text, p_recognized_at timestamptz,
  p_price_quote text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.live_sessions%rowtype;
  v_comment public.live_comments%rowtype;
  v_product public.products%rowtype;
  v_comment_id uuid;
  v_operation public.operations%rowtype;
  v_existing_sale public.sales%rowtype;
  v_hash text;
  v_result jsonb;
  v_count integer;
  v_display_code text;
begin
  if p_sale_id !~ '^s-[0-9a-f-]{36}$' or p_amount is null or p_amount < 1 or p_amount > 99999999
     or length(coalesce(p_raw_transcript, '')) < 3 or length(coalesce(p_price_quote, '')) < 1
     or position(p_price_quote in p_raw_transcript) = 0
     or p_request_id is distinct from p_session_id::text || ':' || p_platform_message_id then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVIDENCE');
  end if;

  v_hash := md5(concat_ws('|', p_sale_id, p_session_id, p_request_id, p_product_id,
    p_product_code, p_amount, p_raw_transcript, p_recognized_at, p_price_quote));

  select * into v_operation from public.operations
    where workspace_id = p_workspace_id and operation_id = p_operation_id;
  if found then
    if v_operation.request_hash <> v_hash then
      return jsonb_build_object('ok', false, 'code', 'OPERATION_PAYLOAD_MISMATCH');
    end if;
    if v_operation.status = 'SUCCEEDED' then return v_operation.response_json; end if;
  end if;

  -- Serializes allocations, session closure and product promotion.
  select * into v_session from public.live_sessions
    where id = p_session_id and workspace_id = p_workspace_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND'); end if;

  select * into v_operation from public.operations
    where workspace_id = p_workspace_id and operation_id = p_operation_id for update;
  if found then
    if v_operation.request_hash <> v_hash then
      return jsonb_build_object('ok', false, 'code', 'OPERATION_PAYLOAD_MISMATCH');
    end if;
    if v_operation.status = 'SUCCEEDED' then return v_operation.response_json; end if;
  end if;
  if v_session.status <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_ENDED');
  end if;

  select count(*), (array_agg(id))[1] into v_count, v_comment_id
    from public.live_comments
    where workspace_id = p_workspace_id and session_id = p_session_id
      and platform_message_id = p_platform_message_id;
  if v_count <> 1 then
    return jsonb_build_object('ok', false, 'code', case when v_count = 0 then 'COMMENT_NOT_SYNCED' else 'COMMENT_AMBIGUOUS' end);
  end if;
  select * into v_comment from public.live_comments where id = v_comment_id for update;
  if v_comment.buyer_id is null or
    (v_comment.content !~ '(저요|ㅈ\s*ㅇ|구매|살게요|살께요|주문|결제|입금|확정)'
      and (v_comment.content !~ '주세요' or v_comment.content ~ '(보여|입어|비춰|알려|설명|확인|바꿔|틀어)\s*주세요')) or
    p_recognized_at - v_comment.captured_at > interval '5 minutes' or
    v_comment.captured_at - p_recognized_at > interval '10 seconds' then
    return jsonb_build_object('ok', false, 'code', 'COMMENT_NOT_ELIGIBLE');
  end if;
  if exists (select 1 from public.live_comments later
    where later.workspace_id = p_workspace_id and later.session_id = p_session_id
      and later.buyer_id = v_comment.buyer_id
      and later.captured_at > v_comment.captured_at and later.captured_at <= p_recognized_at
      and later.content ~ '(취소|안\s*살게요|구경이요|저요\s*아니고)') then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_WITHDRAWN');
  end if;

  if exists (select 1 from public.sales where workspace_id = p_workspace_id
      and purchase_request_id = p_request_id and source = 'WEB_VOICE' and id <> p_sale_id) then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_ALREADY_ALLOCATED');
  end if;
  -- Repeated "저요" messages immediately before the same allocation do not
  -- authorize a second sale. A genuinely new comment after the sale is separate.
  if exists (select 1 from public.sales earlier
      where earlier.workspace_id = p_workspace_id and earlier.session_id = p_session_id::text
        and earlier.buyer_id = v_comment.buyer_id and earlier.id <> p_sale_id
        and earlier.source = 'WEB_VOICE' and earlier.status <> '보류'
        and earlier.record_state = 'ACTIVE'
        and earlier.recognized_at >= v_comment.captured_at
        and earlier.recognized_at - v_comment.captured_at <= interval '30 seconds') then
    return jsonb_build_object('ok', false, 'code', 'REPEATED_INTENT_ALREADY_ALLOCATED');
  end if;

  select * into v_existing_sale from public.sales where id = p_sale_id and workspace_id = p_workspace_id for update;
  if found and (v_existing_sale.status <> '보류' or v_existing_sale.source <> 'WEB_VOICE'
      or v_existing_sale.session_id <> p_session_id::text) then
    return jsonb_build_object('ok', false, 'code', 'SALE_ALREADY_FINAL');
  end if;

  if p_product_id is not null then
    select * into v_product from public.products
      where id = p_product_id and workspace_id = p_workspace_id and session_id = p_session_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'PRODUCT_MISMATCH'); end if;
  elsif v_session.active_product_id is not null then
    select * into v_product from public.products
      where id = v_session.active_product_id and workspace_id = p_workspace_id and session_id = p_session_id for update;
  end if;
  if v_product.id is null then
    insert into public.products (workspace_id, session_id, product_code, name, image_kind, unit_price, source)
      values (p_workspace_id, p_session_id, 'voice-' || p_sale_id, nullif(p_product_name, ''), 'NUMBER_IMAGE', p_amount, 'WEB_VOICE')
      returning * into v_product;
    update public.live_sessions set active_product_id = v_product.id, revision = revision + 1,
      updated_at = now() where id = p_session_id;
  end if;

  select lpad((count(*) + 1)::text, 3, '0') into v_display_code
    from public.sales where workspace_id = p_workspace_id and session_id = p_session_id::text
      and id <> p_sale_id;

  if v_existing_sale.id is null then
  insert into public.sales (
    id, workspace_id, session_id, product_id, buyer_id, buyer_nickname,
    amount, unit_price, quantity, recognized_at, raw_transcript, status,
    product_name, product_code_snapshot, product_name_snapshot, record_state,
    source, source_comment_ids, operation_id, purchase_request_id,
    note, print_status, print_revision
  ) values (
    p_sale_id, p_workspace_id, p_session_id::text, v_product.id, v_comment.buyer_id,
    v_comment.nickname_snapshot, p_amount, p_amount, 1, p_recognized_at,
    p_raw_transcript, '자동저장', nullif(p_product_name, ''),
    v_display_code, coalesce(nullif(p_product_name, ''), v_product.name),
    'ACTIVE', 'WEB_VOICE', jsonb_build_array(v_comment.id), p_operation_id,
    p_request_id, '구매 댓글 및 판매자 음성 가격 연결: ' || p_price_quote,
    'QUEUED', 1
  );
  else
    update public.sales set product_id = v_product.id, buyer_id = v_comment.buyer_id,
      buyer_nickname = v_comment.nickname_snapshot, amount = p_amount, unit_price = p_amount,
      recognized_at = p_recognized_at, raw_transcript = p_raw_transcript,
      status = '자동저장', product_code_snapshot = v_display_code,
      product_name_snapshot = coalesce(nullif(p_product_name, ''), v_product.name),
      source_comment_ids = jsonb_build_array(v_comment.id), operation_id = p_operation_id,
      purchase_request_id = p_request_id, note = '구매 댓글 및 판매자 음성 가격 연결: ' || p_price_quote,
      print_status = 'QUEUED', print_revision = 1, revision = revision + 1,
      updated_at = now() where id = p_sale_id;
  end if;

  insert into public.sale_comment_sources (workspace_id, product_id, comment_id, sale_id)
    values (p_workspace_id, v_product.id, v_comment.id, p_sale_id);

  v_result := jsonb_build_object('ok', true, 'saleId', p_sale_id,
    'buyerId', v_comment.buyer_id, 'buyerNickname', v_comment.nickname_snapshot,
    'commentId', v_comment.id, 'productId', v_product.id, 'amount', p_amount);
  insert into public.operations (workspace_id, operation_id, actor_id, action,
    request_hash, status, response_json)
    values (p_workspace_id, p_operation_id, p_actor_id, 'commit-voice-sale', v_hash, 'SUCCEEDED', v_result);
  return v_result;
end;
$$;

revoke all on function public.voicecap_commit_voice_sale(uuid, text, uuid, text, uuid, text, text, uuid, text, text, integer, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.voicecap_commit_voice_sale(uuid, text, uuid, text, uuid, text, text, uuid, text, text, integer, text, timestamptz, text)
  to service_role;
