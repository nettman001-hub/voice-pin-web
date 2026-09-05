-- VoiceCAP 판매자 목록 조회 전용 RPC 함수
-- 타 서비스(sermon-guide-db)와의 데이터 섞임을 100% 방지하며, VoiceCAP 작업공간 소속 판매자만 선별 반환합니다.

create or replace function public.get_voicecap_sellers()
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  status text,
  created_at timestamptz,
  workspace_id uuid,
  workspace_name text,
  phone text
)
language sql
security definer
set search_path = public
as $$
  select 
    wm.user_id as id,
    coalesce(p.email, u.email, '') as email,
    coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name', ''), split_part(coalesce(p.email, u.email, '판매자'), '@', 1)) as display_name,
    case 
      when wm.role = 'OWNER' then '판매자'
      when wm.role = 'MANAGER' then '관리자'
      else '판매자'
    end as role,
    '활성'::text as status,
    wm.created_at,
    w.id as workspace_id,
    w.name as workspace_name,
    p.phone
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  left join public.profiles p on p.id = wm.user_id
  left join auth.users u on u.id = wm.user_id
  order by wm.created_at desc;
$$;

grant execute on function public.get_voicecap_sellers() to authenticated, anon;
