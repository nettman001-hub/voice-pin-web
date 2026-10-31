-- New sales have no capture yet; keep the required image list empty instead of NULL.
-- Preserve the existing operation ID so queued requests can retry without duplicate receipts.
create or replace function public.voicecap_commit_touch_sale(p_workspace_id uuid,p_actor_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_op uuid := (p_payload->>'operationId')::uuid;
  v_session uuid := (p_payload->>'sessionId')::uuid;
  v_hash text := md5(p_payload::text);
  v_existing public.operations%rowtype;
  v_run public.touch_sales_runs%rowtype;
  v_comment jsonb := p_payload->'comment';
  v_buyer uuid;
  v_comment_id uuid;
  v_sale text := 's-' || v_op::text;
  v_unit integer := (p_payload->>'unitPrice')::integer;
  v_qty integer := (p_payload->>'quantity')::integer;
  v_price numeric;
  v_input text := p_payload->>'inputPrice';
  v_product uuid;
  v_product_name text;
  v_product_code text;
  v_at timestamptz := (p_payload->>'confirmedAt')::timestamptz;
  v_due timestamptz;
  v_result jsonb;
  v_previous text;
  v_label text := nullif(btrim(coalesce(p_payload->>'productLabel','')),'');
  v_slip text := left(nullif(btrim(coalesce(p_payload->>'slipLine','')),''),60);
  v_capture text;
  v_reuse text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select * into v_existing from public.operations where workspace_id=p_workspace_id and operation_id=v_op;
  if found then
    if v_existing.request_hash<>v_hash then return jsonb_build_object('ok',false,'code','OPERATION_PAYLOAD_MISMATCH'); end if;
    if v_existing.status='SUCCEEDED' then return v_existing.response_json; end if;
  end if;
  if v_input is null or v_input !~ '^(\d{1,8}(\.\d{0,4})?|\.\d{1,4})$' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR');
  end if;
  v_price := v_input::numeric;
  if v_price<=0 or (v_price>=100 and v_price<1000) or (v_price>=1000 and trunc(v_price)<>v_price)
    or v_unit is null or v_unit<>(case when v_price<100 then round(v_price*10000) else v_price end)
    or v_unit<1 or v_qty is null or v_qty<1 or v_qty>999 or v_unit::bigint*v_qty>99999999
    or length(coalesce(v_comment->>'platformMessageId','')) not between 1 and 250
    or length(coalesce(v_comment->>'content','')) not between 1 and 4000
    or length(coalesce(v_comment->>'nickname','')) not between 1 and 200
    or length(coalesce(v_label,'')) > 20 then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR');
  end if;
  perform 1 from public.live_sessions where id=v_session and workspace_id=p_workspace_id and status='ACTIVE' for update;
  if not found then return jsonb_build_object('ok',false,'code','SESSION_ENDED'); end if;
  select * into v_run from public.touch_sales_runs where workspace_id=p_workspace_id and session_id=v_session and running;
  if not found then return jsonb_build_object('ok',false,'code','TOUCH_NOT_RUNNING'); end if;
  if v_at is null or v_at>now()+interval '5 seconds' or v_at<now()-interval '24 hours'
    or (v_comment->>'capturedAt')::timestamptz>now()+interval '10 seconds' then
    return jsonb_build_object('ok',false,'code','CLOCK_INVALID');
  end if;
  select s.id into v_previous from public.sales s join public.touch_sale_details d on d.sale_id=s.id
    where s.workspace_id=p_workspace_id and s.session_id=v_session::text and s.record_state='ACTIVE'
      and d.comment->>'platformMessageId'=v_comment->>'platformMessageId' limit 1;
  if v_previous is not null and not coalesce((p_payload->>'allowAdditional')::boolean,false) then
    return jsonb_build_object('ok',false,'code','COMMENT_ALREADY_COMMITTED','saleId',v_previous);
  end if;
  if nullif(v_comment->>'platformUserId','') is not null then
    select id into v_buyer from public.buyers where workspace_id=p_workspace_id and platform='TIKTOK'
      and platform_user_id=v_comment->>'platformUserId' order by created_at limit 1;
  elsif nullif(v_comment->>'uniqueId','') is not null then
    select id into v_buyer from public.buyers where workspace_id=p_workspace_id and platform='TIKTOK'
      and lower(platform_unique_id)=lower(v_comment->>'uniqueId') order by created_at limit 1;
  end if;
  if v_buyer is null then
    insert into public.buyers(workspace_id,platform,platform_user_id,platform_unique_id,display_nickname,identity_status)
      values(p_workspace_id,'TIKTOK',nullif(v_comment->>'platformUserId',''),nullif(v_comment->>'uniqueId',''),
        v_comment->>'nickname',case when nullif(v_comment->>'platformUserId','') is null then 'MANUAL_CONFIRMED' else 'VERIFIED' end)
      returning id into v_buyer;
  else
    update public.buyers set display_nickname=v_comment->>'nickname',updated_at=now() where id=v_buyer;
  end if;
  select id into v_comment_id from public.live_comments where workspace_id=p_workspace_id and session_id=v_session
    and platform_message_id=v_comment->>'platformMessageId' order by created_at limit 1;
  if v_comment_id is null then
    insert into public.live_comments(workspace_id,session_id,collector_id,platform_message_id,buyer_id,nickname_snapshot,content,captured_at,ingest_sequence)
      values(p_workspace_id,v_session,p_actor_id,v_comment->>'platformMessageId',v_buyer,v_comment->>'nickname',v_comment->>'content',
        (v_comment->>'capturedAt')::timestamptz,(extract(epoch from now())*1000)::bigint) returning id into v_comment_id;
  else
    -- A canonical comment cannot be reassigned by a phone request.
    if exists(select 1 from public.live_comments where id=v_comment_id and
      (content<>v_comment->>'content' or (buyer_id is not null and buyer_id<>v_buyer))) then
      raise exception 'COMMENT_IDENTITY_CONFLICT';
    end if;
    update public.live_comments set buyer_id=v_buyer where id=v_comment_id and buyer_id is null;
  end if;
  if nullif(p_payload->>'productId','') is not null then
    select id,name,product_code into v_product,v_product_name,v_product_code from public.products
      where id=(p_payload->>'productId')::uuid and workspace_id=p_workspace_id and session_id=v_session;
    if not found then raise exception 'TOUCH_PRODUCT_NOT_FOUND'; end if;
  elsif v_label is not null then
    -- 상품번호·사이즈·색상 방식: 회차 안에서 같은 번호는 같은 상품이다.
    select id,name,product_code into v_product,v_product_name,v_product_code from public.products
      where workspace_id=p_workspace_id and session_id=v_session and product_code='touch-'||v_session::text||'-'||md5(v_label);
    if not found then
      insert into public.products(workspace_id,session_id,product_code,name,image_kind,unit_price,source)
        values(p_workspace_id,v_session,'touch-'||v_session::text||'-'||md5(v_label),v_label,'NUMBER_IMAGE',v_unit,'ANDROID')
        returning id,name,product_code into v_product,v_product_name,v_product_code;
    end if;
  end if;
  v_capture := case when coalesce((p_payload->>'captureOff')::boolean,false) then 'SKIPPED'
    when coalesce((p_payload->>'skipCapture')::boolean,false) then 'MISSING' else 'PENDING' end;
  if coalesce((p_payload->>'reuseProductPhoto')::boolean,false) and v_product is not null then
    -- 지난 번호 판매는 그 번호 사진을 다시 쓰고 새로 찍지 않는다.
    select d.image_path into v_reuse from public.touch_sale_details d join public.sales s on s.id=d.sale_id
      where s.workspace_id=p_workspace_id and s.product_id=v_product and d.capture_status='CAPTURED' and d.image_path is not null
      order by d.captured_at desc nulls last limit 1;
    v_capture := case when v_reuse is not null then 'CAPTURED' when v_capture='PENDING' then 'MISSING' else v_capture end;
  end if;
  v_due := v_at + make_interval(secs=>coalesce((v_run.settings->>'prepareSeconds')::numeric,4)
    +coalesce((v_run.last_state->>'delaySeconds')::numeric,(v_run.settings->>'fallbackDelaySeconds')::numeric,6));
  insert into public.sales(id,workspace_id,session_id,buyer_id,buyer_nickname,amount,unit_price,quantity,status,source,
      raw_transcript,recognized_at,product_id,product_name,product_name_snapshot,product_code_snapshot,
      record_state,source_comment_ids,operation_id,print_status,print_revision,revision,note,touch_sale,capture_image_paths)
    values(v_sale,p_workspace_id,v_session::text,v_buyer,v_comment->>'nickname',v_unit*v_qty,v_unit,v_qty,'자동저장','ANDROID_COMMENTS',
      '판매자 터치: 폰, 댓글 '||(v_comment->>'platformMessageId')||', 입력값 '||v_input,v_at,v_product,v_product_name,v_product_name,v_product_code,
      'ACTIVE',jsonb_build_array(v_comment_id),v_op,'QUEUED',1,1,'구매 댓글 "'||(v_comment->>'content')||'"',true,
      case when v_reuse is not null then jsonb_build_array(v_reuse) else '[]'::jsonb end);
  insert into public.touch_sale_details(sale_id,workspace_id,comment,input_price,confirmed_at,client_confirmed_at,capture_due_at,capture_status,entry_context,image_path,captured_at)
    values(v_sale,p_workspace_id,v_comment,v_input,v_at,p_payload->>'clientConfirmedAt',v_due,
      v_capture,
      jsonb_build_object('clockOffsetMs',p_payload->'clockOffsetMs','originalConfirmedAt',p_payload->'originalConfirmedAt',
        'retargetedFromOperationId',p_payload->'retargetedFromOperationId','productLabel',v_label,'slipLine',v_slip),
      v_reuse,case when v_reuse is not null then now() end);
  insert into public.print_jobs(workspace_id,sale_id,sale_revision,kind,status,immutable_payload)
    values(p_workspace_id,v_sale,1,'SALE','QUEUED',jsonb_build_object('touchSale',true,'buyerNickname',v_comment->>'nickname',
      'amount',v_unit*v_qty,'quantity',v_qty,'unitPrice',v_unit,'sessionId',v_session,'recognizedAt',v_at,
      'productName',v_product_name,'slipLine',v_slip));
  v_result := jsonb_build_object('ok',true,'saleId',v_sale,'buyerId',v_buyer,'commentId',v_comment_id,'amount',v_unit*v_qty,'captureDueAt',v_due,
    'captureStatus',v_capture,'productId',v_product);
  insert into public.operations(workspace_id,operation_id,actor_id,action,request_hash,status,response_json)
    values(p_workspace_id,v_op,p_actor_id::text,'commit-touch-sale',v_hash,'SUCCEEDED',v_result);
  if v_at<now()-interval '3 seconds' or nullif(p_payload->>'retargetedFromOperationId','') is not null then
    insert into public.touch_sales_events(id,workspace_id,session_id,kind,metrics)
      values(v_op,p_workspace_id,v_session,'LATE_SALE','{}'::jsonb) on conflict(id) do nothing;
  end if;
  return v_result;
end; $$;

revoke all on function public.voicecap_commit_touch_sale(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.voicecap_commit_touch_sale(uuid,uuid,jsonb) to service_role;
