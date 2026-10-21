create table if not exists public.touch_voice_presence (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  session_id uuid references public.live_sessions(id) on delete set null,
  producer_id uuid not null,
  running boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.touch_voice_presence enable row level security;
-- Monitoring data is available through the global-admin handler only, not workspace-owner ADMIN capability.
create or replace function public.voicecap_touch_monthly_stats(p_from timestamptz,p_until timestamptz)
returns jsonb language sql security definer set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(summary)),'[]'::jsonb) from (
    select workspace_id,
      coalesce(sum((metrics->>'directComments')::numeric),0) as direct_comments,
      coalesce(sum((metrics->>'fallbackComments')::numeric),0) as fallback_comments,
      coalesce(sum((metrics->>'fallbackMessages')::numeric),0) as fallback_messages,
      coalesce(sum((metrics->>'signalMessages')::numeric),0) as signal_messages,
      coalesce(sum((metrics->>'directSeconds')::numeric),0) as direct_seconds,
      coalesce(sum((metrics->>'fallbackSeconds')::numeric),0) as fallback_seconds,
      coalesce(sum((metrics->>'transitions')::numeric),0) as transitions,
      coalesce(sum((metrics->>'delayUnavailableSeconds')::numeric),0) as delay_unavailable_seconds,
      case when sum((metrics->>'delaySamples')::numeric)>0 then
        sum((metrics->>'delaySum')::numeric)/sum((metrics->>'delaySamples')::numeric) else null end as delay_average,
      max((metrics->>'delayMaximum')::numeric) as delay_maximum,
      count(*) filter(where kind in ('HELPER_ERROR','PRINT_ERROR','CAPTURE_MISSING','LATE_SALE')) as errors,
      count(*) filter(where kind in ('DIRECT','FALLBACK','DISCONNECTED')) as connection_changes
    from public.touch_sales_events where created_at>=p_from and created_at<p_until group by workspace_id
  ) summary;
$$;
revoke all on function public.voicecap_touch_monthly_stats(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.voicecap_touch_monthly_stats(timestamptz,timestamptz) to service_role;
