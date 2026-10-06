create function public.voicecap_commit_workflow_sale(p_workspace uuid,p_actor text,p_operation uuid,p_sale_id text,p_session uuid,p_decision jsonb,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.live_comments%rowtype; s public.live_sessions%rowtype; p public.products%rowtype;
  op public.operations%rowtype; h text; result jsonb; n integer; q integer; price integer; total integer; stock integer;
begin
  q:=(p_decision->>'quantity')::integer;price:=(p_decision->>'unitPrice')::integer;total:=(p_decision->>'amount')::integer;
  if q<1 or q>99 or price<1 or price>99999999 or total<1 or total>99999999 or total<>q::bigint*price or p_decision->>'status'<>'CONFIRMED'
    or p_sale_id !~ '^s-[0-9a-f-]{36}$' then return jsonb_build_object('ok',false,'code','INVALID_EVIDENCE'); end if;
  h:=md5(p_decision::text || p_evidence::text || p_sale_id);
  select * into s from public.live_sessions where id=p_session and workspace_id=p_workspace for update;
  if not found or s.status<>'ACTIVE' then return jsonb_build_object('ok',false,'code','SESSION_ENDED'); end if;
  select * into op from public.operations where workspace_id=p_workspace and operation_id=p_operation;
  if found then
    if op.request_hash<>h then return jsonb_build_object('ok',false,'code','OPERATION_PAYLOAD_MISMATCH'); end if;
    return op.response_json;
  end if;
  if not exists(select 1 from public.seller_workflow_session_profiles
    where workspace_id=p_workspace and session_id=p_session and profile_id=(p_evidence->>'profileId')::uuid)
    then return jsonb_build_object('ok',false,'code','PROFILE_NOT_APPLIED'); end if;
  select * into c from public.live_comments where id=(p_decision->>'commentId')::uuid and session_id=p_session and workspace_id=p_workspace for update;
  if not found or c.buyer_id is null or c.nickname_snapshot is distinct from p_decision->>'nickname' then return jsonb_build_object('ok',false,'code','COMMENT_NOT_SYNCED'); end if;
  if exists(select 1 from public.live_comments where workspace_id=p_workspace and session_id=p_session and buyer_id=c.buyer_id
    and captured_at>c.captured_at and captured_at<=(p_decision->>'recognizedAt')::timestamptz and content ~ '(취소|안\s*살게요|구경이요|저요\s*아니고)')
    then return jsonb_build_object('ok',false,'code','REQUEST_WITHDRAWN'); end if;
  if exists(select 1 from public.sales where workspace_id=p_workspace and purchase_request_id=p_decision->>'requestId' and id<>p_sale_id)
    then return jsonb_build_object('ok',false,'code','REQUEST_ALREADY_ALLOCATED'); end if;
  stock:=(p_decision->>'stock')::integer;
  if stock is not null then
    select coalesce(sum(quantity),0) into n from public.sales where workspace_id=p_workspace and session_id=p_session::text
      and workflow_evidence->>'offerId'=p_decision->>'offerId' and status not in ('보류','취소') and record_state='ACTIVE' and id<>p_sale_id;
    if n+q>stock then return jsonb_build_object('ok',false,'code','STOCK_CONFLICT'); end if;
  end if;
  select * into p from public.products where workspace_id=p_workspace and session_id=p_session and product_code=p_decision->>'offerId' for update;
  if not found then
    insert into public.products(workspace_id,session_id,product_code,name,image_kind,unit_price,source)
    values(p_workspace,p_session,p_decision->>'offerId',case when p_decision->>'orderCode' is not null then '방송 주문번호 ' || (p_decision->>'orderCode') else '방송 상품' end,'NUMBER_IMAGE',price,'WEB_VOICE') returning * into p;
  end if;
  insert into public.sales(id,workspace_id,session_id,product_id,buyer_id,buyer_nickname,amount,unit_price,quantity,recognized_at,raw_transcript,status,
    product_name,product_code_snapshot,product_name_snapshot,record_state,source,source_comment_ids,operation_id,purchase_request_id,note,print_status,print_revision,workflow_evidence)
  values(p_sale_id,p_workspace,p_session::text,p.id,c.buyer_id,c.nickname_snapshot,total,price,q,(p_decision->>'recognizedAt')::timestamptz,
    p_decision->>'rawTranscript','자동저장',p.name,coalesce(p_decision->>'orderCode',p.product_code),p.name,'ACTIVE','WEB_VOICE',jsonb_build_array(c.id),p_operation,
    p_decision->>'requestId','판매방식 프로필·구매 댓글·가격 발화 검증','QUEUED',1,p_evidence)
  on conflict(id) do update set buyer_id=excluded.buyer_id,buyer_nickname=excluded.buyer_nickname,
    product_id=excluded.product_id,amount=excluded.amount,unit_price=excluded.unit_price,quantity=excluded.quantity,
    status=excluded.status,purchase_request_id=excluded.purchase_request_id,source_comment_ids=excluded.source_comment_ids,
    workflow_evidence=excluded.workflow_evidence,raw_transcript=excluded.raw_transcript,
    print_status='QUEUED',print_revision=1,revision=public.sales.revision+1,updated_at=now()
    where public.sales.workspace_id=p_workspace and public.sales.session_id=p_session::text and public.sales.status='보류' and public.sales.source='WEB_VOICE';
  if not found then return jsonb_build_object('ok',false,'code','SALE_ALREADY_FINAL'); end if;
  insert into public.sale_comment_sources(workspace_id,product_id,comment_id,sale_id) values(p_workspace,p.id,c.id,p_sale_id) on conflict do nothing;
  result:=jsonb_build_object('ok',true,'saleId',p_sale_id,'buyerNickname',c.nickname_snapshot,'amount',total,'productId',p.id);
  insert into public.operations(workspace_id,operation_id,actor_id,action,request_hash,status,response_json)
    values(p_workspace,p_operation,p_actor,'commit-workflow-sale',h,'SUCCEEDED',result);
  return result;
end $$;
revoke all on function public.voicecap_commit_workflow_sale(uuid,text,uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.voicecap_commit_workflow_sale(uuid,text,uuid,text,uuid,jsonb,jsonb) to service_role;
