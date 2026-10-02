create table public.seller_workflow_analyses (
  id uuid primary key default gen_random_uuid(),
  revision integer not null default 1,
  document jsonb not null,
  summary jsonb generated always as (jsonb_set(document - 'reports' - 'messages', '{input}',
    (document->'input') - 'comments' - 'transcripts' - 'commentText' - 'transcriptText' - 'adminDescription')) stored,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.seller_workflow_profiles (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references auth.users(id),
  analysis_id uuid not null references public.seller_workflow_analyses(id),
  report_version integer not null,
  profile jsonb not null,
  shadow_verified boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(analysis_id, report_version)
);
create table public.seller_workflow_deployments (
  seller_user_id uuid primary key references auth.users(id),
  profile_id uuid not null references public.seller_workflow_profiles(id),
  previous_profile_id uuid references public.seller_workflow_profiles(id),
  mode text not null check (mode in ('SHADOW','ACTIVE','DEFAULT')),
  revision integer not null default 1,
  shadow_reviewed boolean not null default false,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.seller_workflow_observations (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references auth.users(id),
  profile_id uuid not null references public.seller_workflow_profiles(id),
  session_id uuid not null references public.live_sessions(id),
  decisions jsonb not null,
  created_at timestamptz not null default now(),
  unique(profile_id, session_id)
);
-- Active broadcasts keep the version they started with, even when an admin
-- replaces or rolls back the seller's configuration during the broadcast.
create table public.seller_workflow_session_profiles (
  session_id uuid primary key references public.live_sessions(id),
  workspace_id uuid not null references public.workspaces(id),
  profile_id uuid not null references public.seller_workflow_profiles(id),
  created_at timestamptz not null default now()
);
alter table public.seller_workflow_analyses enable row level security;
alter table public.seller_workflow_profiles enable row level security;
alter table public.seller_workflow_deployments enable row level security;
alter table public.seller_workflow_observations enable row level security;
alter table public.seller_workflow_session_profiles enable row level security;
revoke all on public.seller_workflow_analyses, public.seller_workflow_profiles,
  public.seller_workflow_deployments, public.seller_workflow_observations,
  public.seller_workflow_session_profiles from anon, authenticated;
grant all on public.seller_workflow_analyses, public.seller_workflow_profiles,
  public.seller_workflow_deployments, public.seller_workflow_observations,
  public.seller_workflow_session_profiles to service_role;

create function public.voicecap_save_workflow_analysis(p_id uuid, p_expected_revision integer, p_document jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.seller_workflow_analyses%rowtype;
begin
  if p_expected_revision is null then
    insert into public.seller_workflow_analyses(id, revision, document, created_by)
      values(p_id, 1, p_document, p_actor_id) returning * into v_row;
  else
    update public.seller_workflow_analyses set revision = revision + 1, document = p_document, updated_at = now()
      where id = p_id and revision = p_expected_revision returning * into v_row;
    if not found then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
  end if;
  return jsonb_build_object('ok', true, 'document', v_row.document);
end $$;
revoke all on function public.voicecap_save_workflow_analysis(uuid, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.voicecap_save_workflow_analysis(uuid, integer, jsonb, uuid) to service_role;

-- Deployment and rollback are versioned and serialized for each seller.
create function public.voicecap_deploy_workflow(p_seller uuid, p_profile uuid, p_mode text, p_expected_revision integer, p_actor uuid, p_shadow_reviewed boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.seller_workflow_deployments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_seller::text, 0));
  select * into d from public.seller_workflow_deployments where seller_user_id=p_seller for update;
  if coalesce(d.revision,0) <> p_expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
  if not exists(select 1 from public.seller_workflow_profiles where id=p_profile and seller_user_id=p_seller)
    then return jsonb_build_object('ok',false,'code','PROFILE_MISMATCH'); end if;
  if p_shadow_reviewed then
    if d.mode is distinct from 'SHADOW' or d.profile_id is distinct from p_profile
      or not exists(select 1 from public.seller_workflow_observations where profile_id=p_profile and jsonb_array_length(decisions)>0)
      then return jsonb_build_object('ok',false,'code','OBSERVATION_REQUIRED'); end if;
    update public.seller_workflow_profiles set shadow_verified=true where id=p_profile;
  end if;
  if p_mode='ACTIVE' and not exists(select 1 from public.seller_workflow_profiles where id=p_profile and shadow_verified)
    then return jsonb_build_object('ok',false,'code','SHADOW_REVIEW_REQUIRED'); end if;
  insert into public.seller_workflow_deployments(seller_user_id,profile_id,previous_profile_id,mode,revision,shadow_reviewed,updated_by)
    values(p_seller,p_profile,d.profile_id,p_mode,coalesce(d.revision,0)+1,p_shadow_reviewed,p_actor)
    on conflict(seller_user_id) do update set profile_id=excluded.profile_id,
      previous_profile_id=case when seller_workflow_deployments.mode='DEFAULT' then null
        when seller_workflow_deployments.profile_id<>excluded.profile_id then seller_workflow_deployments.profile_id else seller_workflow_deployments.previous_profile_id end,
      mode=excluded.mode,revision=excluded.revision,shadow_reviewed=excluded.shadow_reviewed,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.voicecap_deploy_workflow(uuid,uuid,text,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.voicecap_deploy_workflow(uuid,uuid,text,integer,uuid,boolean) to service_role;

create function public.voicecap_pin_workflow(p_workspace uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile uuid; v_seller uuid;
begin
  perform 1 from public.live_sessions where id=p_session and workspace_id=p_workspace and status='ACTIVE' for update;
  if not found then return jsonb_build_object('ok',false,'code','SESSION_NOT_ACTIVE'); end if;
  select profile_id into v_profile from public.seller_workflow_session_profiles where session_id=p_session and workspace_id=p_workspace;
  if v_profile is not null then return jsonb_build_object('ok',true,'profileId',v_profile); end if;
  select owner_id into v_seller from public.workspaces where id=p_workspace;
  select profile_id into v_profile from public.seller_workflow_deployments where seller_user_id=v_seller and mode='ACTIVE';
  if v_profile is not null then
    insert into public.seller_workflow_session_profiles(session_id,workspace_id,profile_id) values(p_session,p_workspace,v_profile);
  end if;
  return jsonb_build_object('ok',true,'profileId',v_profile);
end $$;
revoke all on function public.voicecap_pin_workflow(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voicecap_pin_workflow(uuid,uuid) to service_role;
alter table public.sales add column if not exists workflow_evidence jsonb;
create index sales_workflow_offer_idx on public.sales(workspace_id,session_id,((workflow_evidence->>'offerId')))
  where workflow_evidence is not null;
