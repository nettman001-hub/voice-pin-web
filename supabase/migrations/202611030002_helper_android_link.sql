-- Windows 댓글도우미 → 서버 → 안드로이드 판매 앱 댓글 전달.
-- 추가 전용 마이그레이션: 기존 테이블·함수의 의미를 바꾸지 않는다.
-- 모든 테이블은 RLS를 켜고 정책을 두지 않는다(서버 함수 service_role만 접근).
-- 원복: 파일 끝의 "원복 방법" 주석 참고.

-- 1. PC 도우미 등록 요청. 도우미가 만든 일회용 확인코드(해시)와 비밀값(해시)을 대조한다.
create table if not exists public.helper_registrations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  secret_hash text not null,
  helper_name text not null default 'Windows PC',
  app_version text,
  client_key text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','CONSUMED','EXPIRED')),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  approved_by uuid,
  device_id uuid references public.devices(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists helper_registrations_pending_code
  on public.helper_registrations(code_hash) where status in ('PENDING','APPROVED');
create index if not exists helper_registrations_client_time on public.helper_registrations(client_key, created_at desc);

-- 2. 댓글 전달 상태: 도우미 1대당 1행.
create table if not exists public.helper_delivery (
  helper_device_id uuid primary key references public.devices(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  state_version integer not null default 1,
  generation integer not null default 1,
  alive_until timestamptz,
  link_id uuid,
  session_id uuid references public.live_sessions(id) on delete set null,
  producer_id uuid,
  collector_state jsonb not null default '{}'::jsonb,
  last_push_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists helper_delivery_workspace on public.helper_delivery(workspace_id);

-- 3. 폰 연결 코드(6자리, 3분, 1회 사용, 재발급하면 이전 코드 폐기).
create table if not exists public.helper_pair_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  helper_device_id uuid not null references public.devices(id) on delete cascade,
  code_hash text not null,
  status text not null default 'ISSUED' check (status in ('ISSUED','CLAIMED','APPROVED','REJECTED','CANCELLED','EXPIRED')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists helper_pair_codes_issued
  on public.helper_pair_codes(workspace_id, code_hash) where status = 'ISSUED';
create index if not exists helper_pair_codes_helper on public.helper_pair_codes(helper_device_id, created_at desc);

-- 4. 폰 연결. PENDING(폰이 코드 입력) → ACTIVE(PC 승인) → REVOKED(해제).
create table if not exists public.helper_phone_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  helper_device_id uuid not null references public.devices(id) on delete cascade,
  pair_code_id uuid references public.helper_pair_codes(id) on delete set null,
  user_id uuid not null,
  phone_install_id text not null,
  phone_name text not null default 'Android',
  token_hash text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','REJECTED','CANCELLED','EXPIRED','REVOKED')),
  link_version integer not null default 1,
  pending_expires_at timestamptz not null,
  approved_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 도우미당 활성 폰 1대를 DB가 보장한다.
create unique index if not exists helper_phone_links_one_active
  on public.helper_phone_links(helper_device_id) where status = 'ACTIVE';
create index if not exists helper_phone_links_pending on public.helper_phone_links(helper_device_id, created_at desc) where status = 'PENDING';

-- 5. 실패한 코드 입력(무차별 대입 제한).
create table if not exists public.helper_pair_failures (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists helper_pair_failures_user_time on public.helper_pair_failures(user_id, created_at desc);
create index if not exists helper_pair_failures_workspace_time on public.helper_pair_failures(workspace_id, created_at desc);

-- 6. 폰이 읽는 댓글 목록. cursor는 서버가 정한 단조 증가 값이다.
--    같은 회차의 같은 플랫폼 메시지 ID는 1건(수집기 재시작·재전송 중복 제거).
create table if not exists public.helper_comment_feed (
  cursor bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  helper_device_id uuid not null,
  generation integer not null,
  comment_id uuid,
  platform_message_id text not null,
  platform_user_id text,
  unique_id text,
  nickname text not null,
  content text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint helper_comment_feed_unique_msg unique (session_id, platform_message_id)
);
create index if not exists helper_comment_feed_session_cursor on public.helper_comment_feed(session_id, cursor);

alter table public.helper_registrations enable row level security;
alter table public.helper_delivery enable row level security;
alter table public.helper_pair_codes enable row level security;
alter table public.helper_phone_links enable row level security;
alter table public.helper_pair_failures enable row level security;
alter table public.helper_comment_feed enable row level security;
revoke all on public.helper_registrations, public.helper_delivery, public.helper_pair_codes,
  public.helper_phone_links, public.helper_pair_failures, public.helper_comment_feed from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 내부 도움 함수
-- ---------------------------------------------------------------------------
create or replace function public.voicecap_helper_audit(p_workspace uuid, p_user uuid, p_device uuid, p_action text, p_entity text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(workspace_id, actor_user_id, actor_device_id, action, entity_type, entity_id, metadata)
    values(p_workspace, p_user, p_device, p_action, 'helper_link', p_entity, coalesce(p_metadata,'{}'::jsonb));
exception when others then
  -- 감사 기록 실패가 연결 동작을 막지 않는다.
  null;
end; $$;

-- 활성 판매 회차: 연결된 폰의 touch-run이 살아 있을 때만.
create or replace function public.voicecap_helper_active_session(p_delivery public.helper_delivery)
returns uuid language sql stable security definer set search_path=public as $$
  select case when p_delivery.link_id is not null and p_delivery.session_id is not null and exists(
    select 1 from public.touch_sales_runs r
     where r.workspace_id=p_delivery.workspace_id and r.running and r.lease_expires_at>now()
       and r.session_id=p_delivery.session_id and r.producer_id=p_delivery.producer_id)
    and exists(select 1 from public.live_sessions s where s.id=p_delivery.session_id
       and s.workspace_id=p_delivery.workspace_id and s.status='ACTIVE')
  then p_delivery.session_id end;
$$;

-- ---------------------------------------------------------------------------
-- PC 등록
-- ---------------------------------------------------------------------------
create or replace function public.voicecap_helper_register_begin(p_code_hash text, p_secret_hash text, p_name text, p_version text, p_client text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_exp timestamptz := now() + interval '10 minutes';
begin
  if coalesce(p_client,'') <> '' and (select count(*) from public.helper_registrations
      where client_key=p_client and created_at>now()-interval '10 minutes') >= 10 then
    return jsonb_build_object('ok',false,'code','RATE_LIMITED');
  end if;
  update public.helper_registrations set status='EXPIRED', updated_at=now()
    where status in ('PENDING','APPROVED') and expires_at<=now();
  insert into public.helper_registrations(code_hash, secret_hash, helper_name, app_version, client_key, expires_at)
    values(p_code_hash, p_secret_hash, left(coalesce(nullif(trim(p_name),''),'Windows PC'),60), left(p_version,40), p_client, v_exp)
    returning id into v_id;
  return jsonb_build_object('ok',true,'registrationId',v_id,'expiresAt',v_exp);
exception when unique_violation then
  return jsonb_build_object('ok',false,'code','CODE_COLLISION');
end; $$;

create or replace function public.voicecap_helper_register_approve(p_workspace uuid, p_user uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_reg public.helper_registrations%rowtype;
begin
  if (select count(*) from public.helper_pair_failures where user_id=p_user and created_at>now()-interval '10 minutes') >= 10 then
    return jsonb_build_object('ok',false,'code','RATE_LIMITED');
  end if;
  select * into v_reg from public.helper_registrations
    where code_hash=p_code_hash and status='PENDING' and expires_at>now() for update;
  if not found then
    insert into public.helper_pair_failures(workspace_id,user_id) values(p_workspace,p_user);
    return jsonb_build_object('ok',false,'code','CODE_INVALID');
  end if;
  update public.helper_registrations set status='APPROVED', workspace_id=p_workspace, approved_by=p_user, updated_at=now()
    where id=v_reg.id;
  perform public.voicecap_helper_audit(p_workspace,p_user,null,'HELPER_REGISTER_APPROVED',v_reg.id::text,
    jsonb_build_object('helperName',v_reg.helper_name));
  return jsonb_build_object('ok',true,'helperName',v_reg.helper_name);
end; $$;

create or replace function public.voicecap_helper_register_complete(p_id uuid, p_secret_hash text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_reg public.helper_registrations%rowtype; v_device uuid; v_ws_name text;
begin
  select * into v_reg from public.helper_registrations where id=p_id and secret_hash=p_secret_hash for update;
  if not found then return jsonb_build_object('ok',false,'code','REGISTRATION_NOT_FOUND'); end if;
  if v_reg.status='PENDING' and v_reg.expires_at>now() then return jsonb_build_object('ok',true,'status','PENDING'); end if;
  if v_reg.status<>'APPROVED' or v_reg.expires_at<=now() then
    update public.helper_registrations set status='EXPIRED', updated_at=now() where id=p_id and status in ('PENDING','APPROVED');
    return jsonb_build_object('ok',false,'code','REGISTRATION_EXPIRED');
  end if;
  -- 작업공간당 도우미 1대: 이전 도우미와 그 폰 연결을 폐기한다.
  update public.helper_phone_links set status=case when status='ACTIVE' then 'REVOKED' else 'CANCELLED' end,
      revoked_at=now(), updated_at=now()
    where workspace_id=v_reg.workspace_id and status in ('ACTIVE','PENDING');
  update public.helper_pair_codes set status='CANCELLED' where workspace_id=v_reg.workspace_id and status in ('ISSUED','CLAIMED');
  delete from public.helper_delivery where workspace_id=v_reg.workspace_id;
  update public.devices set revoked_at=now(), updated_at=now()
    where workspace_id=v_reg.workspace_id and device_type='WINDOWS_HELPER' and revoked_at is null
      and 'HELPER_COMMENTS'=any(capabilities);
  insert into public.devices(workspace_id,name,token_hash,app_version,device_type,capabilities,last_seen_at)
    values(v_reg.workspace_id,v_reg.helper_name,p_token_hash,v_reg.app_version,'WINDOWS_HELPER',array['HELPER_COMMENTS']::text[],now())
    returning id into v_device;
  insert into public.helper_delivery(helper_device_id,workspace_id) values(v_device,v_reg.workspace_id);
  update public.helper_registrations set status='CONSUMED', device_id=v_device, updated_at=now() where id=p_id;
  select name into v_ws_name from public.workspaces where id=v_reg.workspace_id;
  perform public.voicecap_helper_audit(v_reg.workspace_id,v_reg.approved_by,v_device,'HELPER_REGISTERED',v_device::text,
    jsonb_build_object('helperName',v_reg.helper_name));
  return jsonb_build_object('ok',true,'status','REGISTERED','deviceId',v_device,'workspaceId',v_reg.workspace_id,
    'workspaceName',v_ws_name,'helperName',v_reg.helper_name);
end; $$;

-- 도우미 스스로 등록 해제(이 PC 계정 연결 끊기).
create or replace function public.voicecap_helper_unregister(p_device uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.devices where id=p_device and revoked_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  update public.helper_phone_links set status=case when status='ACTIVE' then 'REVOKED' else 'CANCELLED' end,
      revoked_at=now(), updated_at=now()
    where helper_device_id=p_device and status in ('ACTIVE','PENDING');
  update public.helper_pair_codes set status='CANCELLED' where helper_device_id=p_device and status in ('ISSUED','CLAIMED');
  delete from public.helper_delivery where helper_device_id=p_device;
  update public.devices set revoked_at=now(), updated_at=now() where id=p_device;
  perform public.voicecap_helper_audit(v_ws,null,p_device,'HELPER_UNREGISTERED',p_device::text);
  return jsonb_build_object('ok',true);
end; $$;

-- ---------------------------------------------------------------------------
-- 폰 인증
-- ---------------------------------------------------------------------------
create or replace function public.voicecap_helper_pair_issue(p_device uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_d public.helper_delivery%rowtype; v_id uuid; v_exp timestamptz := now() + interval '3 minutes';
begin
  select * into v_d from public.helper_delivery where helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  if (select count(*) from public.helper_pair_codes where helper_device_id=p_device and created_at>now()-interval '10 minutes') >= 20 then
    return jsonb_build_object('ok',false,'code','RATE_LIMITED');
  end if;
  -- 재발급하면 이전 코드와 아직 승인 안 된 요청은 효력을 잃는다.
  update public.helper_pair_codes set status='CANCELLED' where helper_device_id=p_device and status in ('ISSUED','CLAIMED');
  update public.helper_phone_links set status='CANCELLED', updated_at=now() where helper_device_id=p_device and status='PENDING';
  insert into public.helper_pair_codes(workspace_id,helper_device_id,code_hash,expires_at)
    values(v_d.workspace_id,p_device,p_code_hash,v_exp) returning id into v_id;
  return jsonb_build_object('ok',true,'codeId',v_id,'expiresAt',v_exp);
exception when unique_violation then
  return jsonb_build_object('ok',false,'code','CODE_COLLISION');
end; $$;

create or replace function public.voicecap_helper_pair_cancel(p_device uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.helper_pair_codes set status='CANCELLED' where helper_device_id=p_device and status in ('ISSUED','CLAIMED');
  update public.helper_phone_links set status='CANCELLED', updated_at=now() where helper_device_id=p_device and status='PENDING';
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.voicecap_helper_pair_claim(p_workspace uuid, p_user uuid, p_code_hash text,
  p_install_id text, p_phone_name text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code public.helper_pair_codes%rowtype; v_link uuid; v_name text;
begin
  if (select count(*) from public.helper_pair_failures where user_id=p_user and created_at>now()-interval '10 minutes') >= 10
    or (select count(*) from public.helper_pair_failures where workspace_id=p_workspace and created_at>now()-interval '10 minutes') >= 30 then
    return jsonb_build_object('ok',false,'code','RATE_LIMITED');
  end if;
  update public.helper_pair_codes set status='EXPIRED' where workspace_id=p_workspace and status='ISSUED' and expires_at<=now();
  select * into v_code from public.helper_pair_codes
    where workspace_id=p_workspace and code_hash=p_code_hash and status='ISSUED' and expires_at>now() for update;
  if not found then
    insert into public.helper_pair_failures(workspace_id,user_id) values(p_workspace,p_user);
    return jsonb_build_object('ok',false,'code','CODE_INVALID');
  end if;
  if not exists(select 1 from public.devices where id=v_code.helper_device_id and revoked_at is null) then
    return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND');
  end if;
  update public.helper_pair_codes set status='CLAIMED', claimed_at=now() where id=v_code.id;
  insert into public.helper_phone_links(workspace_id,helper_device_id,pair_code_id,user_id,phone_install_id,phone_name,token_hash,pending_expires_at)
    values(p_workspace,v_code.helper_device_id,v_code.id,p_user,left(p_install_id,80),
      left(coalesce(nullif(trim(p_phone_name),''),'Android'),60),p_token_hash,now()+interval '5 minutes')
    returning id into v_link;
  select name into v_name from public.devices where id=v_code.helper_device_id;
  perform public.voicecap_helper_audit(p_workspace,p_user,v_code.helper_device_id,'HELPER_PHONE_REQUESTED',v_link::text,
    jsonb_build_object('phoneName',left(p_phone_name,60)));
  return jsonb_build_object('ok',true,'linkId',v_link,'status','PENDING','helperName',v_name);
end; $$;

create or replace function public.voicecap_helper_pair_decide(p_device uuid, p_link uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_link public.helper_phone_links%rowtype; v_d public.helper_delivery%rowtype;
begin
  select * into v_d from public.helper_delivery where helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  select * into v_link from public.helper_phone_links where id=p_link and helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); end if;
  if v_link.status<>'PENDING' then return jsonb_build_object('ok',false,'code','REQUEST_CLOSED','status',v_link.status); end if;
  if v_link.pending_expires_at<=now() then
    update public.helper_phone_links set status='EXPIRED', updated_at=now() where id=p_link;
    update public.helper_pair_codes set status='EXPIRED', decided_at=now() where id=v_link.pair_code_id;
    return jsonb_build_object('ok',false,'code','REQUEST_EXPIRED');
  end if;
  if not p_approve then
    update public.helper_phone_links set status='REJECTED', updated_at=now() where id=p_link;
    update public.helper_pair_codes set status='REJECTED', decided_at=now() where id=v_link.pair_code_id;
    perform public.voicecap_helper_audit(v_d.workspace_id,null,p_device,'HELPER_PHONE_REJECTED',p_link::text);
    return jsonb_build_object('ok',true,'status','REJECTED');
  end if;
  if exists(select 1 from public.helper_phone_links where helper_device_id=p_device and status='ACTIVE') then
    return jsonb_build_object('ok',false,'code','PHONE_ALREADY_LINKED');
  end if;
  update public.helper_phone_links set status='ACTIVE', approved_at=now(), last_seen_at=now(), updated_at=now() where id=p_link;
  update public.helper_pair_codes set status='APPROVED', decided_at=now() where id=v_link.pair_code_id;
  -- 같은 코드로 들어온 다른 요청은 모두 닫는다.
  update public.helper_phone_links set status='CANCELLED', updated_at=now()
    where helper_device_id=p_device and status='PENDING' and id<>p_link;
  update public.helper_delivery set link_id=p_link, session_id=null, producer_id=null,
      state_version=state_version+1, generation=generation+1, updated_at=now()
    where helper_device_id=p_device;
  perform public.voicecap_helper_audit(v_d.workspace_id,null,p_device,'HELPER_PHONE_APPROVED',p_link::text,
    jsonb_build_object('phoneName',v_link.phone_name));
  return jsonb_build_object('ok',true,'status','ACTIVE');
exception when unique_violation then
  return jsonb_build_object('ok',false,'code','PHONE_ALREADY_LINKED');
end; $$;

-- 폰 연결 해제. 도우미(p_device) 또는 그 폰의 판매자(p_user + 토큰)가 할 수 있다.
create or replace function public.voicecap_helper_unlink(p_device uuid, p_link uuid, p_actor_user uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_link public.helper_phone_links%rowtype;
begin
  select * into v_link from public.helper_phone_links where id=p_link and helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','LINK_NOT_FOUND'); end if;
  if v_link.status not in ('ACTIVE','PENDING') then return jsonb_build_object('ok',true,'status',v_link.status); end if;
  update public.helper_phone_links set status=case when status='ACTIVE' then 'REVOKED' else 'CANCELLED' end,
      link_version=link_version+1, revoked_at=now(), updated_at=now() where id=p_link;
  update public.helper_delivery set link_id=null, session_id=null, producer_id=null,
      state_version=state_version+1, generation=generation+1, updated_at=now()
    where helper_device_id=p_device and link_id=p_link;
  perform public.voicecap_helper_audit(v_link.workspace_id,p_actor_user,case when p_actor_user is null then p_device end,
    'HELPER_PHONE_REVOKED',p_link::text);
  return jsonb_build_object('ok',true,'status','REVOKED');
end; $$;

-- ---------------------------------------------------------------------------
-- 전달 스위치·생존 확인
-- ---------------------------------------------------------------------------
create or replace function public.voicecap_helper_set_enabled(p_device uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_d public.helper_delivery%rowtype;
begin
  select * into v_d from public.helper_delivery where helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  if v_d.enabled is distinct from p_enabled then
    -- 다시 켤 때 세대를 올려 꺼진 동안 쌓인 댓글이 뒤늦게 들어오지 않게 한다.
    update public.helper_delivery set enabled=p_enabled, state_version=state_version+1,
        generation=case when p_enabled then generation+1 else generation end, updated_at=now()
      where helper_device_id=p_device returning * into v_d;
    perform public.voicecap_helper_audit(v_d.workspace_id,null,p_device,
      case when p_enabled then 'HELPER_DELIVERY_ON' else 'HELPER_DELIVERY_OFF' end,p_device::text);
  end if;
  return jsonb_build_object('ok',true,'enabled',v_d.enabled,'stateVersion',v_d.state_version,'generation',v_d.generation);
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
    'sessionId',v_session,'tiktokId',v_tiktok,'link',v_link,'pendingRequests',v_pending,
    'workspaceName',v_ws_name,'lastPushAt',v_d.last_push_at);
end; $$;

-- ---------------------------------------------------------------------------
-- 폰: 판매 회차 연결·해제, 상태
-- ---------------------------------------------------------------------------
create or replace function public.voicecap_helper_phone_link(p_workspace uuid, p_user uuid, p_token_hash text)
returns public.helper_phone_links language sql stable security definer set search_path=public as $$
  select * from public.helper_phone_links
   where token_hash=p_token_hash and workspace_id=p_workspace and user_id=p_user
     and exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=p_user)
   limit 1;
$$;

create or replace function public.voicecap_helper_phone_status(p_workspace uuid, p_user uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_link public.helper_phone_links%rowtype; v_d public.helper_delivery%rowtype; v_name text;
begin
  v_link := public.voicecap_helper_phone_link(p_workspace,p_user,p_token_hash);
  if v_link.id is null then return jsonb_build_object('ok',false,'code','LINK_NOT_FOUND'); end if;
  if v_link.status='PENDING' and v_link.pending_expires_at<=now() then
    update public.helper_phone_links set status='EXPIRED', updated_at=now() where id=v_link.id;
    v_link.status := 'EXPIRED';
  end if;
  select name into v_name from public.devices where id=v_link.helper_device_id;
  if v_link.status<>'ACTIVE' then
    return jsonb_build_object('ok',true,'linkStatus',v_link.status,'helperName',v_name);
  end if;
  update public.helper_phone_links set last_seen_at=now() where id=v_link.id;
  select * into v_d from public.helper_delivery where helper_device_id=v_link.helper_device_id and link_id=v_link.id;
  return jsonb_build_object('ok',true,'linkStatus','ACTIVE','linkId',v_link.id,'helperName',v_name,
    'helperDeviceId',v_link.helper_device_id,'enabled',coalesce(v_d.enabled,false),
    'helperAlive',coalesce(v_d.alive_until>now(),false),'stateVersion',v_d.state_version,'generation',v_d.generation,
    'sessionId',public.voicecap_helper_active_session(v_d),'collector',coalesce(v_d.collector_state,'{}'::jsonb));
end; $$;

create or replace function public.voicecap_helper_attach(p_workspace uuid, p_user uuid, p_token_hash text,
  p_session uuid, p_producer uuid, p_detach boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_link public.helper_phone_links%rowtype; v_d public.helper_delivery%rowtype;
begin
  v_link := public.voicecap_helper_phone_link(p_workspace,p_user,p_token_hash);
  if v_link.id is null or v_link.status<>'ACTIVE' then return jsonb_build_object('ok',false,'code','LINK_NOT_ACTIVE'); end if;
  select * into v_d from public.helper_delivery where helper_device_id=v_link.helper_device_id and link_id=v_link.id for update;
  if not found then return jsonb_build_object('ok',false,'code','LINK_NOT_ACTIVE'); end if;
  if p_detach then
    -- 판매 종료: 이 회차 전달만 끝낸다. 폰 승인은 유지.
    if v_d.producer_id is not distinct from p_producer then
      update public.helper_delivery set session_id=null, producer_id=null, state_version=state_version+1, updated_at=now()
        where helper_device_id=v_d.helper_device_id;
    end if;
    return jsonb_build_object('ok',true,'detached',true);
  end if;
  -- 판매 실행권은 폰의 touch-run이 갖는다. 그 실행이 살아 있어야 회차를 연결할 수 있다.
  if not exists(select 1 from public.touch_sales_runs r where r.workspace_id=p_workspace and r.running
      and r.lease_expires_at>now() and r.session_id=p_session and r.producer_id=p_producer) then
    return jsonb_build_object('ok',false,'code','RUN_NOT_ACTIVE');
  end if;
  update public.helper_delivery set
      generation=case when session_id is distinct from p_session then generation+1 else generation end,
      state_version=case when session_id is distinct from p_session or producer_id is distinct from p_producer
        then state_version+1 else state_version end,
      session_id=p_session, producer_id=p_producer, updated_at=now()
    where helper_device_id=v_d.helper_device_id returning * into v_d;
  update public.helper_phone_links set last_seen_at=now() where id=v_link.id;
  return jsonb_build_object('ok',true,'enabled',v_d.enabled,'generation',v_d.generation,'stateVersion',v_d.state_version,
    'helperAlive',coalesce(v_d.alive_until>now(),false),'sessionId',p_session);
end; $$;

-- ---------------------------------------------------------------------------
-- 댓글 전송(도우미)과 조회(폰)
-- ---------------------------------------------------------------------------
create or replace function public.voicecap_helper_push(p_device uuid, p_session uuid, p_generation integer, p_comments jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_d public.helper_delivery%rowtype; v_active uuid; v_c jsonb; v_acked jsonb := '[]'::jsonb; v_comment uuid;
  v_inserted integer := 0; v_dup integer := 0; v_cursor bigint; v_msg text;
begin
  -- 회차마다 직렬화: cursor가 커밋 순서대로 보이게 한다(늦게 커밋된 작은 cursor 누락 방지).
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_session::text,'none'),611030));
  select * into v_d from public.helper_delivery where helper_device_id=p_device for update;
  if not found then return jsonb_build_object('ok',false,'code','HELPER_NOT_FOUND'); end if;
  update public.helper_delivery set alive_until=now()+interval '30 seconds' where helper_device_id=p_device;
  if not v_d.enabled then return jsonb_build_object('ok',false,'code','HELPER_DISABLED','generation',v_d.generation); end if;
  if v_d.generation<>p_generation then return jsonb_build_object('ok',false,'code','STALE_GENERATION','generation',v_d.generation); end if;
  v_active := public.voicecap_helper_active_session(v_d);
  if v_active is null or v_active<>p_session then
    return jsonb_build_object('ok',false,'code','SESSION_INACTIVE','generation',v_d.generation);
  end if;
  if jsonb_typeof(p_comments)<>'array' or jsonb_array_length(p_comments)>200 then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR');
  end if;
  for v_c in select * from jsonb_array_elements(p_comments) loop
    v_msg := nullif(v_c->>'platformMessageId','');
    if v_msg is null or nullif(trim(coalesce(v_c->>'content','')),'') is null then continue; end if;
    if exists(select 1 from public.helper_comment_feed where session_id=p_session and platform_message_id=v_msg) then
      v_dup := v_dup + 1;
    else
      select id into v_comment from public.live_comments
        where workspace_id=v_d.workspace_id and session_id=p_session and platform_message_id=v_msg
        order by created_at limit 1;
      if v_comment is null then
        insert into public.live_comments(workspace_id,session_id,collector_id,platform_message_id,nickname_snapshot,content,captured_at,ingest_sequence)
          values(v_d.workspace_id,p_session,p_device,v_msg,left(coalesce(v_c->>'nickname',''),120),left(v_c->>'content',500),
            coalesce((v_c->>'capturedAt')::timestamptz,now()),(extract(epoch from now())*1000)::bigint)
          returning id into v_comment;
      end if;
      insert into public.helper_comment_feed(workspace_id,session_id,helper_device_id,generation,comment_id,platform_message_id,
          platform_user_id,unique_id,nickname,content,captured_at)
        values(v_d.workspace_id,p_session,p_device,p_generation,v_comment,v_msg,nullif(v_c->>'platformUserId',''),
          nullif(v_c->>'uniqueId',''),left(coalesce(nullif(v_c->>'nickname',''),nullif(v_c->>'uniqueId',''),'알 수 없음'),120),
          left(v_c->>'content',500),coalesce((v_c->>'capturedAt')::timestamptz,now()))
        returning cursor into v_cursor;
      v_inserted := v_inserted + 1;
      v_comment := null;
    end if;
    v_acked := v_acked || to_jsonb(v_msg);
  end loop;
  update public.helper_delivery set last_push_at=now() where helper_device_id=p_device;
  return jsonb_build_object('ok',true,'acked',v_acked,'inserted',v_inserted,'duplicates',v_dup,'generation',v_d.generation);
end; $$;

create or replace function public.voicecap_helper_pull(p_workspace uuid, p_user uuid, p_token_hash text, p_session uuid,
  p_after bigint, p_tail integer, p_limit integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_link public.helper_phone_links%rowtype; v_d public.helper_delivery%rowtype; v_active uuid; v_rows jsonb;
  v_limit integer := greatest(1,least(coalesce(p_limit,500),1000)); v_last bigint; v_more boolean; v_count integer;
begin
  v_link := public.voicecap_helper_phone_link(p_workspace,p_user,p_token_hash);
  if v_link.id is null or v_link.status<>'ACTIVE' then return jsonb_build_object('ok',false,'code','LINK_NOT_ACTIVE'); end if;
  update public.helper_phone_links set last_seen_at=now() where id=v_link.id;
  select * into v_d from public.helper_delivery where helper_device_id=v_link.helper_device_id and link_id=v_link.id;
  if not found then return jsonb_build_object('ok',false,'code','LINK_NOT_ACTIVE'); end if;
  v_active := public.voicecap_helper_active_session(v_d);
  if v_active is null or v_active<>p_session or not v_d.enabled then
    -- 꺼짐·회차 불일치: 댓글 본문을 주지 않고 상태만 알린다.
    return jsonb_build_object('ok',true,'enabled',v_d.enabled,'sessionActive',v_active is not null and v_active=p_session,
      'helperAlive',coalesce(v_d.alive_until>now(),false),'stateVersion',v_d.state_version,'generation',v_d.generation,
      'collector',v_d.collector_state,'comments','[]'::jsonb,'cursor',coalesce(p_after,0),'hasMore',false);
  end if;
  if p_after is null then
    -- 처음 붙을 때: 최근 p_tail건부터(과거 댓글을 새 댓글처럼 몰아서 보이지 않게).
    if coalesce(p_tail,100)<=0 then
      select coalesce(max(cursor),0) into p_after from public.helper_comment_feed where session_id=p_session;
    else
      select coalesce(min(t.cursor)-1,0) into p_after from (select cursor from public.helper_comment_feed
        where session_id=p_session order by cursor desc limit least(p_tail,500)) t;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('cursor',f.cursor,'commentId',f.comment_id,'platformMessageId',f.platform_message_id,
      'platformUserId',f.platform_user_id,'uniqueId',f.unique_id,'nickname',f.nickname,'content',f.content,
      'capturedAt',f.captured_at,'storedAt',f.created_at) order by f.cursor),'[]'::jsonb), max(f.cursor), count(*)
    into v_rows, v_last, v_count
    from (select * from public.helper_comment_feed where session_id=p_session and workspace_id=p_workspace and cursor>p_after
      order by cursor limit v_limit) f;
  v_more := v_count >= v_limit;
  return jsonb_build_object('ok',true,'enabled',true,'sessionActive',true,'helperAlive',coalesce(v_d.alive_until>now(),false),
    'stateVersion',v_d.state_version,'generation',v_d.generation,'collector',v_d.collector_state,
    'comments',v_rows,'cursor',coalesce(v_last,p_after),'hasMore',v_more);
end; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'voicecap_helper_audit(uuid,uuid,uuid,text,text,jsonb)',
    'voicecap_helper_active_session(public.helper_delivery)',
    'voicecap_helper_register_begin(text,text,text,text,text)',
    'voicecap_helper_register_approve(uuid,uuid,text)',
    'voicecap_helper_register_complete(uuid,text,text)',
    'voicecap_helper_unregister(uuid)',
    'voicecap_helper_pair_issue(uuid,text)',
    'voicecap_helper_pair_cancel(uuid)',
    'voicecap_helper_pair_claim(uuid,uuid,text,text,text,text)',
    'voicecap_helper_pair_decide(uuid,uuid,boolean)',
    'voicecap_helper_unlink(uuid,uuid,uuid)',
    'voicecap_helper_set_enabled(uuid,boolean)',
    'voicecap_helper_heartbeat(uuid,jsonb)',
    'voicecap_helper_phone_link(uuid,uuid,text)',
    'voicecap_helper_phone_status(uuid,uuid,text)',
    'voicecap_helper_attach(uuid,uuid,text,uuid,uuid,boolean)',
    'voicecap_helper_push(uuid,uuid,integer,jsonb)',
    'voicecap_helper_pull(uuid,uuid,text,uuid,bigint,integer,integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- 원복 방법(기존 기능에 영향 없음):
--   drop function public.voicecap_helper_* (위 목록);
--   drop table public.helper_comment_feed, public.helper_pair_failures, public.helper_phone_links,
--     public.helper_pair_codes, public.helper_delivery, public.helper_registrations;
--   update public.devices set revoked_at=now() where device_type='WINDOWS_HELPER' and 'HELPER_COMMENTS'=any(capabilities);
-- live_comments에 들어간 도우미 댓글(collector_id=도우미 기기 ID)은 기존 댓글과 같은 형식이라 남겨 둬도 된다.
