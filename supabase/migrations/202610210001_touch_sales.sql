-- Phone comment-touch sales. Existing voice commit functions and helper protocol are unchanged.
alter table public.sales add column if not exists touch_sale boolean not null default false;
create table if not exists public.touch_sales_runs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  producer_id uuid not null,
  running boolean not null default true,
  lease_expires_at timestamptz not null default now(),
  settings jsonb not null default '{"mode":"COMMENT_TOUCH","prepareSeconds":4,"fallbackDelaySeconds":6}'::jsonb,
  last_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.touch_sale_details (
  sale_id text primary key references public.sales(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  comment jsonb not null,
  input_price text not null,
  confirmed_at timestamptz not null,
  client_confirmed_at text,
  entry_context jsonb not null default '{}'::jsonb,
  capture_due_at timestamptz not null,
  capture_status text not null default 'PENDING' check(capture_status in ('PENDING','CAPTURED','MISSING','CANCELLED')),
  capture_generation uuid not null default gen_random_uuid(),
  capture_owner uuid,
  capture_lease_expires_at timestamptz,
  captured_at timestamptz,
  image_path text,
  recapture boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.touch_sale_details add column if not exists capture_generation uuid not null default gen_random_uuid();
alter table public.touch_sale_details add column if not exists entry_context jsonb not null default '{}'::jsonb;
alter table public.touch_sale_details add column if not exists recapture boolean not null default false;
create table if not exists public.touch_sales_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid references public.live_sessions(id) on delete set null,
  producer_id uuid,
  kind text not null check (kind in ('START','STOP','DIRECT','FALLBACK','DISCONNECTED','HELPER_ERROR','PRINT_ERROR','CAPTURE_MISSING','LATE_SALE','SUMMARY')),
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists touch_sales_events_workspace_time on public.touch_sales_events(workspace_id,created_at desc);
create index if not exists touch_sale_pending on public.touch_sale_details(workspace_id,capture_due_at) where capture_status='PENDING';
alter table public.touch_sales_runs enable row level security;
alter table public.touch_sale_details enable row level security;
alter table public.touch_sales_events enable row level security;
drop policy if exists "touch run member read" on public.touch_sales_runs;
create policy "touch run member read" on public.touch_sales_runs for select to authenticated using(public.is_workspace_member(workspace_id));
drop policy if exists "touch sale member read" on public.touch_sale_details;
create policy "touch sale member read" on public.touch_sale_details for select to authenticated using(public.is_workspace_member(workspace_id));
-- Private Broadcast topic is exactly touch-sales:<workspace UUID>. No comment DB writes for transport.
drop policy if exists "touch sales broadcast receive" on realtime.messages;
create policy "touch sales broadcast receive" on realtime.messages for select to authenticated using (
  extension = 'broadcast' and realtime.topic() ~ '^touch-sales:[0-9a-f-]{36}$'
  and public.is_workspace_member(substring(realtime.topic() from 13)::uuid)
);
drop policy if exists "touch sales broadcast send" on realtime.messages;
create policy "touch sales broadcast send" on realtime.messages for insert to authenticated with check (
  extension = 'broadcast' and realtime.topic() ~ '^touch-sales:[0-9a-f-]{36}$'
  and public.is_workspace_member(substring(realtime.topic() from 13)::uuid)
);

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
    or length(coalesce(v_comment->>'nickname','')) not between 1 and 200 then
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
  end if;
  v_due := v_at + make_interval(secs=>coalesce((v_run.settings->>'prepareSeconds')::numeric,4)
    +coalesce((v_run.last_state->>'delaySeconds')::numeric,(v_run.settings->>'fallbackDelaySeconds')::numeric,6));
  insert into public.sales(id,workspace_id,session_id,buyer_id,buyer_nickname,amount,unit_price,quantity,status,source,
      raw_transcript,recognized_at,product_id,product_name,product_name_snapshot,product_code_snapshot,
      record_state,source_comment_ids,operation_id,print_status,print_revision,revision,note,touch_sale)
    values(v_sale,p_workspace_id,v_session::text,v_buyer,v_comment->>'nickname',v_unit*v_qty,v_unit,v_qty,'자동저장','ANDROID_COMMENTS',
      '판매자 터치: 폰, 댓글 '||(v_comment->>'platformMessageId')||', 입력값 '||v_input,v_at,v_product,v_product_name,v_product_name,v_product_code,
      'ACTIVE',jsonb_build_array(v_comment_id),v_op,'QUEUED',1,1,'구매 댓글 "'||(v_comment->>'content')||'"',true);
  insert into public.touch_sale_details(sale_id,workspace_id,comment,input_price,confirmed_at,client_confirmed_at,capture_due_at,capture_status,entry_context)
    values(v_sale,p_workspace_id,v_comment,v_input,v_at,p_payload->>'clientConfirmedAt',v_due,
      case when coalesce((p_payload->>'skipCapture')::boolean,false) then 'MISSING' else 'PENDING' end,
      jsonb_build_object('clockOffsetMs',p_payload->'clockOffsetMs','originalConfirmedAt',p_payload->'originalConfirmedAt',
        'retargetedFromOperationId',p_payload->'retargetedFromOperationId'));
  insert into public.print_jobs(workspace_id,sale_id,sale_revision,kind,status,immutable_payload)
    values(p_workspace_id,v_sale,1,'SALE','QUEUED',jsonb_build_object('touchSale',true,'buyerNickname',v_comment->>'nickname',
      'amount',v_unit*v_qty,'quantity',v_qty,'unitPrice',v_unit,'sessionId',v_session,'recognizedAt',v_at));
  v_result := jsonb_build_object('ok',true,'saleId',v_sale,'buyerId',v_buyer,'commentId',v_comment_id,'amount',v_unit*v_qty,'captureDueAt',v_due);
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

-- A transaction leases jobs once; expired submitting jobs are UNKNOWN, never auto-printed again.
create or replace function public.voicecap_claim_touch_jobs(p_workspace_id uuid,p_producer_id uuid,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_token text:=gen_random_uuid()::text; v_jobs jsonb; begin
  if not exists(select 1 from public.touch_sales_runs where workspace_id=p_workspace_id and producer_id=p_producer_id
    and lease_expires_at>now()) then return jsonb_build_object('ok',false,'code','PC_LEASE_LOST'); end if;
  with expired as (
    update public.print_jobs j set status='UNKNOWN',updated_at=now() where j.workspace_id=p_workspace_id
      and j.status='SUBMITTING' and j.lease_expires_at<now() and exists(select 1 from public.touch_sale_details d where d.sale_id=j.sale_id)
      returning j.sale_id,j.sale_revision
  ) update public.sales s set print_status='FAILED',print_error='출력 여부 확인 필요',updated_at=now()
    from expired e where s.id=e.sale_id and s.workspace_id=p_workspace_id and s.revision=e.sale_revision;
  with candidates as (
    select j.id from public.print_jobs j join public.touch_sale_details d on d.sale_id=j.sale_id
      where j.workspace_id=p_workspace_id and (j.status='QUEUED' or (j.status='CLAIMED' and j.lease_expires_at<now()))
      order by j.created_at for update of j skip locked limit greatest(1,least(p_limit,20))
  ), leased as (
    update public.print_jobs j set status='CLAIMED',lease_token=v_token,lease_expires_at=now()+interval '60 seconds',
      attempts=j.attempts+1,updated_at=now() from candidates c where j.id=c.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(leased)),'[]'::jsonb) into v_jobs from leased;
  return jsonb_build_object('ok',true,'jobs',v_jobs,'leaseToken',v_token);
end; $$;
revoke all on function public.voicecap_claim_touch_jobs(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.voicecap_claim_touch_jobs(uuid,uuid,integer) to service_role;

create or replace function public.voicecap_update_touch_sale(p_workspace_id uuid,p_actor_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_sale public.sales%rowtype; v_before jsonb; v_action text:=p_payload->>'kind'; v_buyer public.buyers%rowtype; v_revision integer;
  v_op uuid := nullif(p_payload->>'operationId','')::uuid; v_hash text:=md5(p_payload::text); v_existing public.operations%rowtype; v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  if v_op is not null then
    select * into v_existing from public.operations where workspace_id=p_workspace_id and operation_id=v_op;
    if found then
      if v_existing.request_hash<>v_hash then return jsonb_build_object('ok',false,'code','OPERATION_PAYLOAD_MISMATCH'); end if;
      if v_existing.status='SUCCEEDED' then return v_existing.response_json; end if;
    end if;
  end if;
  select s.* into v_sale from public.sales s join public.touch_sale_details d on d.sale_id=s.id
    where s.id=p_payload->>'saleId' and s.workspace_id=p_workspace_id for update of s;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_sale.revision<>(p_payload->>'expectedRevision')::integer then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
  v_before:=to_jsonb(v_sale); v_revision:=v_sale.revision+1;
  if v_action='CANCEL' then
    update public.sales set status='취소',record_state='CANCELLED',revision=v_revision,updated_at=now() where id=v_sale.id;
    update public.print_jobs set status='CANCELLED' where sale_id=v_sale.id and workspace_id=p_workspace_id and status in ('QUEUED','CLAIMED');
    update public.touch_sale_details set capture_status='CANCELLED',updated_at=now() where sale_id=v_sale.id;
  elsif v_action in ('PRICE','BUYER','FIELDS') then
    if v_sale.record_state<>'ACTIVE' then return jsonb_build_object('ok',false,'code','SALE_CANCELLED'); end if;
    if v_action in ('PRICE','FIELDS') then
      if (p_payload->>'unitPrice')::integer<1 or (p_payload->>'unitPrice')::bigint*v_sale.quantity>99999999 then
        return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
      v_sale.unit_price:=(p_payload->>'unitPrice')::integer; v_sale.amount:=v_sale.unit_price*v_sale.quantity;
    end if;
    if v_action='BUYER' or (v_action='FIELDS' and nullif(p_payload->>'buyerId','') is not null and p_payload->>'buyerId'<>v_sale.buyer_id::text) then
      select * into v_buyer from public.buyers where id=(p_payload->>'buyerId')::uuid and workspace_id=p_workspace_id;
      if not found then return jsonb_build_object('ok',false,'code','BUYER_NOT_FOUND'); end if;
      v_sale.buyer_id:=v_buyer.id; v_sale.buyer_nickname:=v_buyer.display_nickname;
    end if;
    update public.sales set buyer_id=v_sale.buyer_id,buyer_nickname=v_sale.buyer_nickname,unit_price=v_sale.unit_price,
      amount=v_sale.amount,status=case when v_action='FIELDS' and p_payload->>'status' in ('자동저장','수동수정','확정') then p_payload->>'status' else '수동수정' end,
      note=case when v_action='FIELDS' then left(coalesce(p_payload->>'note',''),4000) else note end,
      product_name=case when v_action='FIELDS' then left(p_payload->>'productName',200) else product_name end,
      product_name_snapshot=case when v_action='FIELDS' then left(p_payload->>'productName',200) else product_name_snapshot end,
      revision=v_revision,print_revision=print_revision+case when coalesce((p_payload->>'reprint')::boolean,true) then 1 else 0 end,
      print_status=case when coalesce((p_payload->>'reprint')::boolean,true) then 'QUEUED' when print_status='QUEUED' then 'NOT_REQUESTED' else print_status end,
      updated_at=now() where id=v_sale.id;
    update public.print_jobs set status='CANCELLED' where workspace_id=p_workspace_id and sale_id=v_sale.id and status in ('QUEUED','CLAIMED');
    if coalesce((p_payload->>'reprint')::boolean,true) then
      insert into public.print_jobs(workspace_id,sale_id,sale_revision,kind,immutable_payload) values(p_workspace_id,v_sale.id,v_revision,'CORRECTION',
        jsonb_build_object('touchSale',true,'buyerNickname',v_sale.buyer_nickname,'amount',v_sale.amount,'sessionId',v_sale.session_id,'recognizedAt',v_sale.recognized_at));
    end if;
  elsif v_action='REPRINT' then
    if v_sale.record_state<>'ACTIVE' then return jsonb_build_object('ok',false,'code','SALE_CANCELLED'); end if;
    if exists(select 1 from public.print_jobs where workspace_id=p_workspace_id and sale_id=v_sale.id and status in ('QUEUED','CLAIMED','SUBMITTING')) then
      return jsonb_build_object('ok',false,'code','PRINT_ALREADY_PENDING'); end if;
    insert into public.print_jobs(workspace_id,sale_id,sale_revision,kind,immutable_payload) values(p_workspace_id,v_sale.id,v_revision,'REPRINT',
      jsonb_build_object('touchSale',true,'buyerNickname',v_sale.buyer_nickname,'amount',v_sale.amount,'sessionId',v_sale.session_id,'recognizedAt',v_sale.recognized_at));
    update public.sales set print_status='QUEUED',print_revision=print_revision+1,revision=v_revision,updated_at=now() where id=v_sale.id;
  else return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  insert into public.sale_revisions(workspace_id,sale_id,old_revision,new_revision,before_value,after_value,actor_user_id,reason)
    values(p_workspace_id,v_sale.id,(v_before->>'revision')::integer,v_revision,v_before,
      (select to_jsonb(s) from public.sales s where id=v_sale.id),p_actor_id,'댓글터치 '||v_action);
  v_result:=jsonb_build_object('ok',true,'saleId',v_sale.id);
  if v_op is not null then insert into public.operations(workspace_id,operation_id,actor_id,action,request_hash,status,response_json)
    values(p_workspace_id,v_op,p_actor_id::text,'update-touch-sale',v_hash,'SUCCEEDED',v_result); end if;
  return v_result;
end; $$;
revoke all on function public.voicecap_update_touch_sale(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.voicecap_update_touch_sale(uuid,uuid,jsonb) to service_role;

create or replace function public.voicecap_touch_run(p_workspace_id uuid,p_producer_id uuid,p_session_id uuid,p_kind text,p_state jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.touch_sales_runs%rowtype; begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select * into v_run from public.touch_sales_runs where workspace_id=p_workspace_id for update;
  if p_kind='START' then
    if v_run.running and v_run.producer_id<>p_producer_id and v_run.lease_expires_at>now() then
      return jsonb_build_object('ok',false,'code','PC_ALREADY_RUNNING'); end if;
    if not exists(select 1 from public.live_sessions where id=p_session_id and workspace_id=p_workspace_id and status='ACTIVE') then
      return jsonb_build_object('ok',false,'code','SESSION_ENDED'); end if;
    insert into public.touch_sales_runs(workspace_id,producer_id,session_id,running,lease_expires_at,settings,last_state)
      values(p_workspace_id,p_producer_id,p_session_id,true,now()+interval '20 seconds',
        p_state->'settings',coalesce(p_state->'state','{}'::jsonb))
      on conflict(workspace_id) do update set producer_id=excluded.producer_id,session_id=excluded.session_id,
        running=true,lease_expires_at=excluded.lease_expires_at,settings=excluded.settings,last_state=excluded.last_state,updated_at=now();
  else
    if v_run.producer_id is distinct from p_producer_id then return jsonb_build_object('ok',false,'code','PC_LEASE_LOST'); end if;
    update public.touch_sales_runs set running=case when p_kind='STOP' then false else running end,
      lease_expires_at=now()+interval '20 seconds',last_state=coalesce(p_state->'state',last_state),updated_at=now()
      where workspace_id=p_workspace_id;
  end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.voicecap_touch_run(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.voicecap_touch_run(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.voicecap_touch_print(p_workspace_id uuid,p_job_id uuid,p_lease text,p_kind text,p_result text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.print_jobs%rowtype; begin
  select * into v_job from public.print_jobs where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found or v_job.lease_token is distinct from p_lease or v_job.lease_expires_at<now()
    or not exists(select 1 from public.touch_sale_details where sale_id=v_job.sale_id) then
    return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
  if p_kind='BEGIN' then
    if v_job.status<>'CLAIMED' then return jsonb_build_object('ok',false,'code','PRINT_ALREADY_STARTED'); end if;
    if not exists(select 1 from public.sales where id=v_job.sale_id and workspace_id=p_workspace_id and record_state='ACTIVE' and revision=v_job.sale_revision) then
      update public.print_jobs set status='CANCELLED' where id=v_job.id;
      return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
    update public.print_jobs set status='SUBMITTING',updated_at=now() where id=v_job.id;
  elsif p_kind='ACK' then
    if v_job.status<>'SUBMITTING' then return jsonb_build_object('ok',false,'code','PRINT_NOT_SUBMITTING'); end if;
    if p_result not in ('SUCCESS','FAILED','UNKNOWN') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
    update public.print_jobs set status=case p_result when 'SUCCESS' then 'SUBMITTED' when 'UNKNOWN' then 'UNKNOWN' else 'FAILED' end,
      result=p_result,updated_at=now() where id=v_job.id;
    update public.sales set print_status=case when p_result='SUCCESS' then 'PRINTED' else 'FAILED' end,
      printed_at=case when p_result='SUCCESS' then now() else null end,
      print_error=case p_result when 'UNKNOWN' then '출력 여부 확인 필요' when 'FAILED' then '프린터 오류' else null end,
      updated_at=now() where id=v_job.sale_id and workspace_id=p_workspace_id and revision=v_job.sale_revision;
  else return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.voicecap_touch_print(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.voicecap_touch_print(uuid,uuid,text,text,text) to service_role;

create or replace function public.voicecap_claim_touch_captures(p_workspace_id uuid,p_producer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_rows jsonb; begin
  if not exists(select 1 from public.touch_sales_runs where workspace_id=p_workspace_id and producer_id=p_producer_id and lease_expires_at>now()) then
    return jsonb_build_object('ok',false,'code','PC_LEASE_LOST'); end if;
  with candidates as (select d.sale_id from public.touch_sale_details d join public.sales s on s.id=d.sale_id
    where d.workspace_id=p_workspace_id and d.capture_status='PENDING' and s.record_state='ACTIVE'
      -- Only the current PC lease can reach this statement; it takes over pending captures immediately.
      order by d.capture_due_at for update of d skip locked limit 20), leased as (
      update public.touch_sale_details d set capture_owner=p_producer_id,capture_lease_expires_at=now()+interval '60 seconds'
        from candidates c where d.sale_id=c.sale_id returning d.*)
    select coalesce(jsonb_agg(to_jsonb(leased)),'[]'::jsonb) into v_rows from leased;
  return jsonb_build_object('ok',true,'captures',v_rows);
end; $$;
revoke all on function public.voicecap_claim_touch_captures(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicecap_claim_touch_captures(uuid,uuid) to service_role;

drop function if exists public.voicecap_touch_capture(uuid,uuid,text,text,text,timestamptz);
create or replace function public.voicecap_touch_capture(p_workspace_id uuid,p_producer_id uuid,p_sale_id text,p_status text,p_path text,p_captured_at timestamptz,p_generation uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_old text; begin
  if p_status not in ('MISSING','CAPTURED') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  if not exists(select 1 from public.touch_sales_runs where workspace_id=p_workspace_id and producer_id=p_producer_id and lease_expires_at>now()) then
    return jsonb_build_object('ok',false,'code','CAPTURE_LEASE_LOST'); end if;
  if p_status='CAPTURED' and (p_path is null or position(p_workspace_id::text||'/touch-sales/'||p_sale_id||'/' in p_path)<>1) then
    return jsonb_build_object('ok',false,'code','INVALID_IMAGE_PATH'); end if;
  select d.image_path into v_old from public.touch_sale_details d join public.sales s on s.id=d.sale_id
    where d.sale_id=p_sale_id and d.workspace_id=p_workspace_id and d.capture_owner=p_producer_id
      and d.capture_lease_expires_at>now() and d.capture_status='PENDING'
      and (p_generation is null or d.capture_generation=p_generation) and s.record_state='ACTIVE' for update of d,s;
  if not found then return jsonb_build_object('ok',false,'code','CAPTURE_LEASE_LOST'); end if;
  update public.touch_sale_details set capture_status=p_status,image_path=case when p_status='CAPTURED' then p_path else image_path end,
    captured_at=p_captured_at,updated_at=now() where sale_id=p_sale_id;
  if p_status='CAPTURED' then
    update public.sales set capture_image_paths=jsonb_build_array(p_path),updated_at=now()
      where id=p_sale_id and workspace_id=p_workspace_id;
  end if;
  return jsonb_build_object('ok',true,'previousPath',v_old);
end; $$;
revoke all on function public.voicecap_touch_capture(uuid,uuid,text,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.voicecap_touch_capture(uuid,uuid,text,text,text,timestamptz,uuid) to service_role;

do $$ declare target text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach target in array array['touch_sales_runs','touch_sale_details','live_sessions','buyers'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=target) then
        execute format('alter publication supabase_realtime add table public.%I',target);
      end if;
    end loop;
  end if;
end $$;
