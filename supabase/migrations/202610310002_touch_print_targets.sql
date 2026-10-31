-- The phone keeps the sales/capture lease; a separate PC lease can relay receipts.
create table if not exists public.touch_print_relays (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  relay_id uuid not null,
  ready boolean not null default false,
  printer_name text,
  lease_expires_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.touch_print_relays enable row level security;
drop policy if exists "touch print relay member read" on public.touch_print_relays;
create policy "touch print relay member read" on public.touch_print_relays for select to authenticated
  using(public.is_workspace_member(workspace_id));
alter table public.print_jobs add column if not exists touch_print_route text;
alter table public.print_jobs add column if not exists touch_print_owner uuid;

create or replace function public.voicecap_touch_print_relay(p_workspace_id uuid,p_relay_id uuid,p_kind text,p_ready boolean,p_printer_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_relay public.touch_print_relays%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  if p_relay_id is null or p_kind is null or p_kind not in ('START','HEARTBEAT','STOP') then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  select * into v_relay from public.touch_print_relays where workspace_id=p_workspace_id for update;
  if p_kind='START' then
    if v_relay.relay_id is distinct from p_relay_id and v_relay.lease_expires_at>now() then
      return jsonb_build_object('ok',false,'code','PRINT_RELAY_ALREADY_RUNNING'); end if;
    insert into public.touch_print_relays(workspace_id,relay_id,ready,printer_name,lease_expires_at)
      values(p_workspace_id,p_relay_id,coalesce(p_ready,false),left(p_printer_name,120),now()+interval '20 seconds')
      on conflict(workspace_id) do update set relay_id=excluded.relay_id,ready=excluded.ready,
        printer_name=excluded.printer_name,lease_expires_at=excluded.lease_expires_at,updated_at=now()
      returning * into v_relay;
  else
    if v_relay.relay_id is distinct from p_relay_id or (p_kind='HEARTBEAT' and v_relay.lease_expires_at<=now()) then
      return jsonb_build_object('ok',false,'code','PRINT_RELAY_LEASE_LOST'); end if;
    update public.touch_print_relays set ready=p_kind<>'STOP' and coalesce(p_ready,false),
      printer_name=left(p_printer_name,120),
      lease_expires_at=case when p_kind='STOP' then now() else now()+interval '20 seconds' end,updated_at=now()
      where workspace_id=p_workspace_id returning * into v_relay;
  end if;
  return jsonb_build_object('ok',true,'printRelay',jsonb_build_object('relayId',v_relay.relay_id,
    'ready',v_relay.ready,'leaseExpiresAt',v_relay.lease_expires_at,'printerName',v_relay.printer_name));
end; $$;
revoke all on function public.voicecap_touch_print_relay(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.voicecap_touch_print_relay(uuid,uuid,text,boolean,text) to service_role;

-- A missing printer acknowledgement is never permission to print the same job again.
create or replace function public.voicecap_expire_touch_prints(p_workspace_id uuid,p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  with expired as (
    update public.print_jobs j set status='UNKNOWN',updated_at=now()
      from public.sales s,public.touch_sale_details d
      where j.workspace_id=p_workspace_id and s.workspace_id=p_workspace_id and d.workspace_id=p_workspace_id
        and s.id=j.sale_id and d.sale_id=s.id and s.session_id=p_session_id::text
        and j.status='SUBMITTING' and j.lease_expires_at<=now()
      returning j.sale_id,j.sale_revision
  ) update public.sales s set print_status='FAILED',print_error='출력 여부 확인 필요',updated_at=now()
    from expired e where s.id=e.sale_id and s.workspace_id=p_workspace_id and s.revision=e.sale_revision;
end; $$;
revoke all on function public.voicecap_expire_touch_prints(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicecap_expire_touch_prints(uuid,uuid) to service_role;

create or replace function public.voicecap_touch_print_target(p_workspace_id uuid,p_producer_id uuid,p_print_target text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.touch_sales_runs%rowtype; v_target text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select * into v_run from public.touch_sales_runs where workspace_id=p_workspace_id for update;
  if not found or not v_run.running or v_run.producer_id is distinct from p_producer_id or v_run.lease_expires_at<=now() then
    return jsonb_build_object('ok',false,'code','PC_LEASE_LOST'); end if;
  if v_run.last_state->>'phoneOnly' is distinct from 'true' or p_print_target is null
    or p_print_target not in ('PHONE_BLUETOOTH','PC_HELPER') then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  v_target:=coalesce(v_run.settings->>'printTarget','PHONE_BLUETOOTH');
  if v_target=p_print_target then return jsonb_build_object('ok',true,'printTarget',v_target); end if;
  if p_print_target='PC_HELPER' and not exists(select 1 from public.touch_print_relays
    where workspace_id=p_workspace_id and ready and lease_expires_at>now()) then
    return jsonb_build_object('ok',false,'code','PRINT_RELAY_NOT_READY'); end if;
  perform public.voicecap_expire_touch_prints(p_workspace_id,v_run.session_id);
  if exists(select 1 from public.print_jobs j join public.sales s on s.id=j.sale_id
    join public.touch_sale_details d on d.sale_id=s.id
    where j.workspace_id=p_workspace_id and s.workspace_id=p_workspace_id and d.workspace_id=p_workspace_id
      and s.session_id=v_run.session_id::text and (j.status='SUBMITTING'
        or (j.status='CLAIMED' and coalesce(j.lease_expires_at>now(),true)))) then
    return jsonb_build_object('ok',false,'code','PRINT_TARGET_BUSY'); end if;
  update public.touch_sales_runs set settings=jsonb_set(settings,'{printTarget}',to_jsonb(p_print_target)),updated_at=now()
    where workspace_id=p_workspace_id;
  return jsonb_build_object('ok',true,'printTarget',p_print_target);
end; $$;
revoke all on function public.voicecap_touch_print_target(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.voicecap_touch_print_target(uuid,uuid,text) to service_role;

create or replace function public.voicecap_touch_run(p_workspace_id uuid,p_producer_id uuid,p_session_id uuid,p_kind text,p_state jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.touch_sales_runs%rowtype; v_phone boolean; v_target text; v_previous text; v_settings jsonb; v_state jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select * into v_run from public.touch_sales_runs where workspace_id=p_workspace_id for update;
  if p_kind='START' then
    if v_run.running and v_run.producer_id<>p_producer_id and v_run.lease_expires_at>now() then
      return jsonb_build_object('ok',false,'code','PC_ALREADY_RUNNING'); end if;
    if not exists(select 1 from public.live_sessions where id=p_session_id and workspace_id=p_workspace_id and status='ACTIVE') then
      return jsonb_build_object('ok',false,'code','SESSION_ENDED'); end if;
    v_phone:=coalesce(p_state->'state'->>'phoneOnly','false')='true';
    v_target:=case when v_phone then coalesce(p_state->'settings'->>'printTarget','PHONE_BLUETOOTH') else 'PC_HELPER' end;
    if v_run.running and v_run.producer_id=p_producer_id and v_run.session_id=p_session_id then
      v_phone:=coalesce(v_run.last_state->>'phoneOnly','false')='true';
      v_target:=case when v_phone then coalesce(v_run.settings->>'printTarget','PHONE_BLUETOOTH') else 'PC_HELPER' end;
    end if;
    if v_target not in ('PHONE_BLUETOOTH','PC_HELPER') then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
    if v_phone and v_target='PC_HELPER' and not exists(select 1 from public.touch_print_relays
      where workspace_id=p_workspace_id and ready and lease_expires_at>now()) then
      return jsonb_build_object('ok',false,'code','PRINT_RELAY_NOT_READY'); end if;
    v_previous:=case when v_run.last_state->>'phoneOnly'='true' then coalesce(v_run.settings->>'printTarget','PHONE_BLUETOOTH') else 'PC_HELPER' end;
    if v_run.session_id=p_session_id and (v_previous<>v_target
      or (coalesce(v_run.last_state->>'phoneOnly','false')='true')<>v_phone) then
      perform public.voicecap_expire_touch_prints(p_workspace_id,p_session_id);
      if exists(select 1 from public.print_jobs j join public.sales s on s.id=j.sale_id
        join public.touch_sale_details d on d.sale_id=s.id
        where j.workspace_id=p_workspace_id and s.workspace_id=p_workspace_id and d.workspace_id=p_workspace_id
          and s.session_id=p_session_id::text and (j.status='SUBMITTING'
            or (j.status='CLAIMED' and coalesce(j.lease_expires_at>now(),true)))) then
        return jsonb_build_object('ok',false,'code','PRINT_TARGET_BUSY'); end if;
    end if;
    v_settings:=jsonb_set(coalesce(p_state->'settings','{}'::jsonb),'{printTarget}',to_jsonb(v_target));
    insert into public.touch_sales_runs(workspace_id,producer_id,session_id,running,lease_expires_at,settings,last_state)
      values(p_workspace_id,p_producer_id,p_session_id,true,now()+interval '20 seconds',v_settings,
        jsonb_set(coalesce(p_state->'state','{}'::jsonb),'{phoneOnly}',to_jsonb(v_phone)))
      on conflict(workspace_id) do update set producer_id=excluded.producer_id,session_id=excluded.session_id,
        running=true,lease_expires_at=excluded.lease_expires_at,settings=excluded.settings,last_state=excluded.last_state,updated_at=now();
  elsif p_kind in ('HEARTBEAT','STOP') then
    if v_run.producer_id is distinct from p_producer_id then return jsonb_build_object('ok',false,'code','PC_LEASE_LOST'); end if;
    -- Heartbeat state cannot change the owner's mode or overwrite a selected target.
    v_state:=jsonb_set(coalesce(p_state->'state',v_run.last_state),'{phoneOnly}',
      to_jsonb(coalesce(v_run.last_state->>'phoneOnly','false')='true'));
    update public.touch_sales_runs set running=case when p_kind='STOP' then false else running end,
      lease_expires_at=now()+interval '20 seconds',last_state=v_state,updated_at=now() where workspace_id=p_workspace_id;
  else return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.voicecap_touch_run(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.voicecap_touch_run(uuid,uuid,uuid,text,jsonb) to service_role;

-- Both claim paths and route switching serialize with BEGIN, before any bytes are sent.
create or replace function public.voicecap_claim_touch_output_jobs(p_workspace_id uuid,p_owner_id uuid,p_relay boolean,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.touch_sales_runs%rowtype; v_token text:=gen_random_uuid()::text; v_jobs jsonb; v_phone boolean; v_display text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select * into v_run from public.touch_sales_runs where workspace_id=p_workspace_id;
  v_phone:=coalesce(v_run.last_state->>'phoneOnly','false')='true';
  if p_relay then
    if not exists(select 1 from public.touch_print_relays where workspace_id=p_workspace_id and relay_id=p_owner_id
      and lease_expires_at>now()) then return jsonb_build_object('ok',false,'code','PRINT_RELAY_LEASE_LOST'); end if;
    if not exists(select 1 from public.touch_print_relays where workspace_id=p_workspace_id and relay_id=p_owner_id and ready) then
      return jsonb_build_object('ok',false,'code','PRINT_RELAY_NOT_READY'); end if;
    if not coalesce(v_run.running,false) or v_run.lease_expires_at<=now() or not v_phone
      or coalesce(v_run.settings->>'printTarget','PHONE_BLUETOOTH')<>'PC_HELPER' then
      return jsonb_build_object('ok',true,'jobs','[]'::jsonb,'leaseToken',v_token); end if;
  else
    if not coalesce(v_run.running,false) or v_run.producer_id is distinct from p_owner_id or v_run.lease_expires_at<=now() then
      return jsonb_build_object('ok',false,'code','PC_LEASE_LOST'); end if;
    if v_phone and coalesce(v_run.settings->>'printTarget','PHONE_BLUETOOTH')<>'PHONE_BLUETOOTH' then
      return jsonb_build_object('ok',true,'jobs','[]'::jsonb,'leaseToken',v_token); end if;
  end if;
  if not exists(select 1 from public.live_sessions where id=v_run.session_id and workspace_id=p_workspace_id and status='ACTIVE') then
    return jsonb_build_object('ok',true,'jobs','[]'::jsonb,'leaseToken',v_token); end if;
  select coalesce(to_jsonb(l)->>'display_code','') into v_display from public.live_sessions l
    where l.id=v_run.session_id and l.workspace_id=p_workspace_id;
  perform public.voicecap_expire_touch_prints(p_workspace_id,v_run.session_id);
  with candidates as (
    select j.id from public.print_jobs j join public.touch_sale_details d on d.sale_id=j.sale_id join public.sales s on s.id=j.sale_id
      where j.workspace_id=p_workspace_id and d.workspace_id=p_workspace_id and s.workspace_id=p_workspace_id
        and s.session_id=v_run.session_id::text and s.record_state='ACTIVE' and s.revision=j.sale_revision
        and (j.status='QUEUED' or (j.status='CLAIMED' and j.lease_expires_at<=now()))
      order by j.created_at,j.id for update of j skip locked limit greatest(1,least(p_limit,20))
  ), leased as (
    update public.print_jobs j set status='CLAIMED',lease_token=v_token,lease_expires_at=now()+interval '60 seconds',
      touch_print_route=case when p_relay then 'RELAY' else 'PRODUCER' end,touch_print_owner=p_owner_id,
      attempts=j.attempts+1,updated_at=now() from candidates c where j.id=c.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(leased)||jsonb_build_object('immutable_payload',
    leased.immutable_payload||jsonb_build_object('sessionDisplayCode',v_display))),'[]'::jsonb) into v_jobs from leased;
  return jsonb_build_object('ok',true,'jobs',v_jobs,'leaseToken',v_token);
end; $$;
revoke all on function public.voicecap_claim_touch_output_jobs(uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.voicecap_claim_touch_output_jobs(uuid,uuid,boolean,integer) to service_role;

create or replace function public.voicecap_claim_touch_jobs(p_workspace_id uuid,p_producer_id uuid,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
begin return public.voicecap_claim_touch_output_jobs(p_workspace_id,p_producer_id,false,p_limit); end; $$;
revoke all on function public.voicecap_claim_touch_jobs(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.voicecap_claim_touch_jobs(uuid,uuid,integer) to service_role;
create or replace function public.voicecap_claim_touch_relay_jobs(p_workspace_id uuid,p_relay_id uuid,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
begin return public.voicecap_claim_touch_output_jobs(p_workspace_id,p_relay_id,true,p_limit); end; $$;
revoke all on function public.voicecap_claim_touch_relay_jobs(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.voicecap_claim_touch_relay_jobs(uuid,uuid,integer) to service_role;

create or replace function public.voicecap_touch_print(p_workspace_id uuid,p_job_id uuid,p_lease text,p_kind text,p_result text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.print_jobs%rowtype; v_run public.touch_sales_runs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,210021));
  select * into v_job from public.print_jobs where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found or v_job.lease_token is distinct from p_lease or v_job.lease_expires_at<=now()
    or not exists(select 1 from public.touch_sale_details where sale_id=v_job.sale_id and workspace_id=p_workspace_id) then
    return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
  if p_kind='BEGIN' then
    if v_job.status<>'CLAIMED' then return jsonb_build_object('ok',false,'code','PRINT_ALREADY_STARTED'); end if;
    if v_job.touch_print_route is not null then
      select * into v_run from public.touch_sales_runs where workspace_id=p_workspace_id;
      if not coalesce(v_run.running,false) or v_run.lease_expires_at<=now()
        or not exists(select 1 from public.sales s join public.live_sessions l on l.id=v_run.session_id
          where s.id=v_job.sale_id and s.workspace_id=p_workspace_id and s.session_id=v_run.session_id::text
            and l.workspace_id=p_workspace_id and l.status='ACTIVE') then
        return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
      if v_job.touch_print_route='RELAY' then
        if v_run.last_state->>'phoneOnly' is distinct from 'true' or v_run.settings->>'printTarget' is distinct from 'PC_HELPER'
          or not exists(select 1 from public.touch_print_relays where workspace_id=p_workspace_id and relay_id=v_job.touch_print_owner
            and ready and lease_expires_at>now()) then return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
      elsif v_job.touch_print_route='PRODUCER' then
        if v_run.producer_id is distinct from v_job.touch_print_owner or (v_run.last_state->>'phoneOnly'='true'
          and coalesce(v_run.settings->>'printTarget','PHONE_BLUETOOTH')<>'PHONE_BLUETOOTH') then
          return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
      else return jsonb_build_object('ok',false,'code','PRINT_LEASE_LOST'); end if;
    end if;
    if not exists(select 1 from public.sales where id=v_job.sale_id and workspace_id=p_workspace_id and record_state='ACTIVE' and revision=v_job.sale_revision) then
      update public.print_jobs set status='CANCELLED' where id=v_job.id;
      return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
    update public.print_jobs set status='SUBMITTING',updated_at=now() where id=v_job.id;
  elsif p_kind='ACK' then
    if v_job.status<>'SUBMITTING' then return jsonb_build_object('ok',false,'code','PRINT_NOT_SUBMITTING'); end if;
    if p_result is null or p_result not in ('SUCCESS','FAILED','UNKNOWN') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR'); end if;
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
