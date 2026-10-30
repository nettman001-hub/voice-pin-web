-- 판매 앱 [관리] 탭의 직접 출력을 "출력 전에 서버에서 확인하고 자리를 잡는" 방식으로 바꾼다 (2026-10-30 검수 반영).
-- 202610300001의 voicecap_touch_record_print는 출력이 끝난 뒤에 기록만 해서,
-- 대기 중인 전표가 있거나 그사이 판매가 취소·수정된 경우에도 종이가 먼저 나갔다. 같은 기록을 두 번 보내면 두 줄이 생겼다.
-- BEGIN: 판매가 살아 있고(ACTIVE), 화면의 revision과 같고, 대기 중인 전표가 없을 때만 출력 작업을 SUBMITTING으로 잡고
--        서버의 최신 판매 내용(구매자, 금액, 상품)을 돌려준다. 웹은 이 내용으로 출력한다.
-- FINISH: 그 작업 번호와 토큰으로 성공/실패를 한 번 기록한다. 같은 요청을 다시 보내도 결과는 바뀌지 않는다.
-- 손을 놓친 작업(앱 종료 등)은 90초 뒤 다음 BEGIN 또는 판매 중 claim이 "출력 여부 확인 필요"로 바꾼다.
-- 적용 순서: 이 SQL -> sales-api -> 웹.
create or replace function public.voicecap_touch_direct_print(p_workspace_id uuid,p_actor_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_kind text:=p_payload->>'kind'; v_sale public.sales%rowtype; v_job public.print_jobs%rowtype; v_result text; v_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  if v_kind='BEGIN' then
    select s.* into v_sale from public.sales s join public.touch_sale_details d on d.sale_id=s.id
      where s.id=p_payload->>'saleId' and s.workspace_id=p_workspace_id for update of s;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
    if v_sale.record_state<>'ACTIVE' then return jsonb_build_object('ok',false,'code','SALE_CANCELLED'); end if;
    if nullif(p_payload->>'expectedRevision','') is not null and v_sale.revision<>(p_payload->>'expectedRevision')::integer then
      return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
    -- 끝을 알리지 못하고 시간이 지난 직접 출력은 "확인 필요"로 돌린다.
    with expired as (
      update public.print_jobs set status='UNKNOWN',updated_at=now()
        where workspace_id=p_workspace_id and sale_id=v_sale.id and status='SUBMITTING' and lease_expires_at<now()
          and coalesce((immutable_payload->>'direct')::boolean,false)
        returning sale_revision
    ) update public.sales set print_status='FAILED',print_error='출력 여부 확인 필요',updated_at=now()
        where id=v_sale.id and revision in (select sale_revision from expired);
    if exists(select 1 from public.print_jobs where workspace_id=p_workspace_id and sale_id=v_sale.id and status in ('QUEUED','CLAIMED','SUBMITTING')) then
      return jsonb_build_object('ok',false,'code','PRINT_ALREADY_PENDING'); end if;
    v_token:=gen_random_uuid()::text;
    insert into public.print_jobs(workspace_id,sale_id,sale_revision,kind,status,lease_token,lease_expires_at,attempts,immutable_payload)
      values(p_workspace_id,v_sale.id,v_sale.revision,'REPRINT','SUBMITTING',v_token,now()+interval '90 seconds',1,
        jsonb_build_object('touchSale',true,'direct',true,'buyerNickname',v_sale.buyer_nickname,'amount',v_sale.amount,
          'sessionId',v_sale.session_id,'recognizedAt',v_sale.recognized_at,
          'productName',coalesce(v_sale.product_name_snapshot,v_sale.product_name),'actorId',p_actor_id))
      returning * into v_job;
    return jsonb_build_object('ok',true,'jobId',v_job.id,'leaseToken',v_token,
      'sale',jsonb_build_object('id',v_sale.id,'revision',v_sale.revision,'buyerNickname',v_sale.buyer_nickname,
        'amount',v_sale.amount,'productName',coalesce(v_sale.product_name_snapshot,v_sale.product_name)));
  elsif v_kind='FINISH' then
    v_result:=p_payload->>'result';
    if v_result is null or v_result not in ('SUCCESS','FAILED') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
    select * into v_job from public.print_jobs where id=nullif(p_payload->>'jobId','')::uuid and workspace_id=p_workspace_id for update;
    if not found or v_job.lease_token is distinct from p_payload->>'leaseToken'
      or not coalesce((v_job.immutable_payload->>'direct')::boolean,false) then
      return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
    -- 이미 끝난 작업은 다시 바꾸지 않는다(같은 요청 재전송).
    if v_job.status in ('SUBMITTED','FAILED') then
      return jsonb_build_object('ok',true,'jobId',v_job.id,'result',v_job.result,'alreadyFinished',true); end if;
    if v_job.status not in ('SUBMITTING','UNKNOWN') then return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
    update public.print_jobs set status=case when v_result='SUCCESS' then 'SUBMITTED' else 'FAILED' end,
      result=v_result,updated_at=now() where id=v_job.id;
    update public.sales set print_status=case when v_result='SUCCESS' then 'PRINTED' else 'FAILED' end,
      print_revision=coalesce(print_revision,0)+1,
      printed_at=case when v_result='SUCCESS' then now() else printed_at end,
      print_error=case when v_result='SUCCESS' then null else '프린터 오류' end,
      updated_at=now() where id=v_job.sale_id and workspace_id=p_workspace_id and revision=v_job.sale_revision;
    return jsonb_build_object('ok',true,'jobId',v_job.id,'result',v_result);
  end if;
  return jsonb_build_object('ok',false,'code','VALIDATION_ERROR');
end; $$;
revoke all on function public.voicecap_touch_direct_print(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.voicecap_touch_direct_print(uuid,uuid,jsonb) to service_role;
