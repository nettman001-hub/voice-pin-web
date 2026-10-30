-- 판매 앱 [관리] 탭에서 폰 프린터로 바로 출력한 결과를 서버 기록에 남긴다 (2026-10-30).
-- 기존 출력 기록(voicecap_touch_print)은 판매 중인 기기가 대기열에서 가져간 작업만 받으므로,
-- 판매를 켜지 않고 직접 출력한 전표는 이 함수로 "이미 끝난 출력 작업"을 한 줄 남긴다.
-- 이미 끝난 상태(SUBMITTED/FAILED)로 넣기 때문에 어느 기기도 이 작업을 다시 출력하지 않는다.
-- 적용 순서: 이 SQL -> sales-api -> 웹. (웹은 이 함수가 없어도 오류 없이 동작한다.)
create or replace function public.voicecap_touch_record_print(p_workspace_id uuid,p_actor_id uuid,p_sale_id text,p_result text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_sale public.sales%rowtype; v_ok boolean:=(p_result='SUCCESS');
begin
  if p_result is null or p_result not in ('SUCCESS','FAILED') then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select s.* into v_sale from public.sales s join public.touch_sale_details d on d.sale_id=s.id
    where s.id=p_sale_id and s.workspace_id=p_workspace_id for update of s;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_sale.record_state<>'ACTIVE' then return jsonb_build_object('ok',false,'code','SALE_CANCELLED'); end if;
  -- 대기열에 아직 출력할 작업이 있으면 그 작업이 상태를 정하므로 건드리지 않는다.
  if exists(select 1 from public.print_jobs where workspace_id=p_workspace_id and sale_id=v_sale.id and status in ('QUEUED','CLAIMED','SUBMITTING')) then
    return jsonb_build_object('ok',false,'code','PRINT_ALREADY_PENDING'); end if;
  insert into public.print_jobs(workspace_id,sale_id,sale_revision,kind,status,result,attempts,immutable_payload)
    values(p_workspace_id,v_sale.id,v_sale.revision,'REPRINT',case when v_ok then 'SUBMITTED' else 'FAILED' end,p_result,1,
      jsonb_build_object('touchSale',true,'direct',true,'buyerNickname',v_sale.buyer_nickname,'amount',v_sale.amount,
        'sessionId',v_sale.session_id,'recognizedAt',v_sale.recognized_at,
        'productName',coalesce(v_sale.product_name_snapshot,v_sale.product_name),'actorId',p_actor_id));
  update public.sales set print_status=case when v_ok then 'PRINTED' else 'FAILED' end,
    print_revision=coalesce(print_revision,0)+1,
    printed_at=case when v_ok then now() else printed_at end,
    print_error=case when v_ok then null else '프린터 오류' end,
    updated_at=now() where id=v_sale.id and workspace_id=p_workspace_id;
  return jsonb_build_object('ok',true,'saleId',v_sale.id);
end; $$;
revoke all on function public.voicecap_touch_record_print(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.voicecap_touch_record_print(uuid,uuid,text,text) to service_role;
