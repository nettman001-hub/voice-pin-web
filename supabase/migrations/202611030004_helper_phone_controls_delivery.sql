-- 폰 판매 시작/종료가 PC 댓글도우미의 "안드로이드 댓글 연결" 켜짐/꺼짐을 바꾼다 (2026-11-03 사용자 요청).
-- 한 번 연결(승인)된 폰에서 판매를 시작하면 켜짐, 판매를 종료하면 꺼짐.
-- PC에서 직접 바꾼 것과 폰이 바꾼 것 중 나중 것이 이긴다: enabled_version이 바뀔 때마다 올라가고,
-- 도우미(1.4.1+)는 heartbeat에서 이 값이 바뀐 것을 보면 서버 값을 따른다.

alter table public.helper_delivery add column if not exists enabled_version integer not null default 0;
alter table public.helper_delivery add column if not exists enabled_by text;

create or replace function public.voicecap_helper_set_enabled(p_device uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_d public.helper_delivery%rowtype;
begin
  select * into v_d from public.helper_delivery where helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  if v_d.enabled is distinct from p_enabled then
    -- 다시 켤 때 세대를 올려 꺼진 동안 쌓인 댓글이 뒤늦게 들어오지 않게 한다.
    update public.helper_delivery set enabled=p_enabled, state_version=state_version+1,
        generation=case when p_enabled then generation+1 else generation end,
        enabled_version=enabled_version+1, enabled_by='HELPER', updated_at=now()
      where helper_device_id=p_device returning * into v_d;
    perform public.voicecap_helper_audit(v_d.workspace_id,null,p_device,
      case when p_enabled then 'HELPER_DELIVERY_ON' else 'HELPER_DELIVERY_OFF' end,p_device::text);
  end if;
  return jsonb_build_object('ok',true,'enabled',v_d.enabled,'stateVersion',v_d.state_version,'generation',v_d.generation,
    'enabledVersion',v_d.enabled_version,'enabledBy',v_d.enabled_by);
end; $$;

create or replace function public.voicecap_helper_heartbeat(p_device uuid, p_state jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_d public.helper_delivery%rowtype; v_session uuid; v_link jsonb; v_pending jsonb; v_tiktok text; v_ws_name text;
begin
  update public.helper_delivery set alive_until=now()+interval '30 seconds',
      collector_state=coalesce(p_state,'{}'::jsonb), updated_at=now()
    where helper_device_id=p_device returning * into v_d;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  v_session := public.voicecap_helper_active_session(v_d);
  select jsonb_build_object('id',l.id,'phoneName',l.phone_name,'lastSeenAt',l.last_seen_at,'approvedAt',l.approved_at)
    into v_link from public.helper_phone_links l where l.id=v_d.link_id and l.status='ACTIVE';
  update public.helper_phone_links set status='EXPIRED', updated_at=now()
    where helper_device_id=p_device and status='PENDING' and pending_expires_at<=now();
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'phoneName',l.phone_name,'requestedAt',l.created_at,
      'expiresAt',l.pending_expires_at,'userEmail',u.email) order by l.created_at),'[]'::jsonb)
    into v_pending from public.helper_phone_links l left join auth.users u on u.id=l.user_id
    where l.helper_device_id=p_device and l.status='PENDING';
  select nullif(value->>'tiktokId','') into v_tiktok from public.workspace_settings
    where workspace_id=v_d.workspace_id and namespace='touch_sales';
  select name into v_ws_name from public.workspaces where id=v_d.workspace_id;
  return jsonb_build_object('ok',true,'enabled',v_d.enabled,'stateVersion',v_d.state_version,'generation',v_d.generation,
    'enabledVersion',v_d.enabled_version,'enabledBy',v_d.enabled_by,
    'sessionId',v_session,'tiktokId',v_tiktok,'link',v_link,'pendingRequests',v_pending,
    'workspaceName',v_ws_name,'lastPushAt',v_d.last_push_at);
end; $$;

-- p_start 인자를 더한다. 옛 6인자 함수를 지워야 이름 붙여 부를 때 겹치지 않는다(옛 sales-api 호출도 기본값으로 그대로 맞는다).
drop function if exists public.voicecap_helper_attach(uuid,uuid,text,uuid,uuid,boolean);
create or replace function public.voicecap_helper_attach(p_workspace uuid, p_user uuid, p_token_hash text,
  p_session uuid, p_producer uuid, p_detach boolean default false, p_start boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_link public.helper_phone_links%rowtype; v_d public.helper_delivery%rowtype; v_on boolean;
begin
  v_link := public.voicecap_helper_phone_link(p_workspace,p_user,p_token_hash);
  if v_link.id is null or v_link.status<>'ACTIVE' then return jsonb_build_object('ok',false,'code','LINK_NOT_ACTIVE'); end if;
  select * into v_d from public.helper_delivery where helper_device_id=v_link.helper_device_id and link_id=v_link.id for update;
  if not found then return jsonb_build_object('ok',false,'code','LINK_NOT_ACTIVE'); end if;
  if p_detach then
    -- 판매 종료: 이 회차 전달을 끝내고 도우미 댓글 연결을 끈다. 폰 승인은 유지.
    -- 다른 판매(다른 producer)가 이미 붙어 있으면 건드리지 않는다.
    if v_d.producer_id is not distinct from p_producer then
      update public.helper_delivery set session_id=null, producer_id=null, state_version=state_version+1,
          enabled=false,
          enabled_version=case when enabled then enabled_version+1 else enabled_version end,
          enabled_by=case when enabled then 'PHONE' else enabled_by end,
          updated_at=now()
        where helper_device_id=v_d.helper_device_id;
      if v_d.enabled then
        perform public.voicecap_helper_audit(p_workspace,p_user,v_d.helper_device_id,'HELPER_DELIVERY_OFF_BY_PHONE',v_link.id::text);
      end if;
    end if;
    return jsonb_build_object('ok',true,'detached',true);
  end if;
  -- 판매 실행권은 폰의 touch-run이 갖는다. 그 실행이 살아 있어야 회차를 연결할 수 있다.
  if not exists(select 1 from public.touch_sales_runs r where r.workspace_id=p_workspace and r.running
      and r.lease_expires_at>now() and r.session_id=p_session and r.producer_id=p_producer) then
    return jsonb_build_object('ok',false,'code','RUN_NOT_ACTIVE');
  end if;
  -- 판매 시작(재연결·자동 재부착이 아닌 첫 연결)이면 도우미 댓글 연결을 켠다.
  v_on := p_start and not v_d.enabled;
  update public.helper_delivery set
      generation=case when session_id is distinct from p_session or v_on then generation+1 else generation end,
      state_version=case when session_id is distinct from p_session or producer_id is distinct from p_producer or v_on
        then state_version+1 else state_version end,
      enabled=enabled or v_on,
      enabled_version=case when v_on then enabled_version+1 else enabled_version end,
      enabled_by=case when v_on then 'PHONE' else enabled_by end,
      session_id=p_session, producer_id=p_producer, updated_at=now()
    where helper_device_id=v_d.helper_device_id returning * into v_d;
  if v_on then
    perform public.voicecap_helper_audit(p_workspace,p_user,v_d.helper_device_id,'HELPER_DELIVERY_ON_BY_PHONE',v_link.id::text);
  end if;
  update public.helper_phone_links set last_seen_at=now() where id=v_link.id;
  return jsonb_build_object('ok',true,'enabled',v_d.enabled,'generation',v_d.generation,'stateVersion',v_d.state_version,
    'enabledVersion',v_d.enabled_version,'helperAlive',coalesce(v_d.alive_until>now(),false),'sessionId',p_session);
end; $$;

revoke all on function public.voicecap_helper_set_enabled(uuid,boolean) from public, anon, authenticated;
grant execute on function public.voicecap_helper_set_enabled(uuid,boolean) to service_role;
revoke all on function public.voicecap_helper_heartbeat(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.voicecap_helper_heartbeat(uuid,jsonb) to service_role;
revoke all on function public.voicecap_helper_attach(uuid,uuid,text,uuid,uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.voicecap_helper_attach(uuid,uuid,text,uuid,uuid,boolean,boolean) to service_role;

-- 원복: 202611030002의 세 함수를 다시 적용하고(attach는 7인자 함수를 먼저 drop),
--   alter table public.helper_delivery drop column enabled_version, drop column enabled_by;
