import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('VOICECAP_WEB_ORIGIN') ?? 'https://www.voicecap.shop',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders })

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !anonKey) return null
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data, error } = await client.auth.getUser()
  return error ? null : data.user
}

const chunked = <T,>(items: T[], size = 100) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

async function listVoicecapAuthUsers() {
  const users: any[] = []
  const perPage = 200
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    users.push(...(data?.users || []).filter((candidate: any) => candidate.user_metadata?.auth_app === 'voicecap'))
    if (!data?.users || data.users.length < perPage) break
  }
  return users
}

async function listVoicecapSellers() {
  // auth.users의 VoiceCAP 표식을 기준으로 먼저 선별해야 공유 DB의 다른 서비스 회원이 섞이지 않는다.
  // 이메일 확인 전 사용자는 workspace/profile이 없으므로 auth.users가 목록의 기준 데이터다.
  const authUsers = await listVoicecapAuthUsers()
  const userIds = authUsers.map((candidate) => candidate.id)

  const memberships: any[] = []
  const profiles: any[] = []
  for (const ids of chunked(userIds)) {
    const [membershipResult, profileResult] = await Promise.all([
      admin
        .from('workspace_members')
        .select('user_id, role, created_at, workspace_id')
        .in('user_id', ids)
        .order('created_at', { ascending: true }),
      admin.from('profiles').select('id, email, display_name, phone').in('id', ids),
    ])
    if (membershipResult.error) throw membershipResult.error
    if (profileResult.error) throw profileResult.error
    memberships.push(...(membershipResult.data || []))
    profiles.push(...(profileResult.data || []))
  }

  const membershipByUserId = new Map<string, any>()
  for (const membership of memberships) {
    if (!membershipByUserId.has(membership.user_id)) membershipByUserId.set(membership.user_id, membership)
  }
  const profileByUserId = new Map(profiles.map((profile) => [profile.id, profile]))

  const workspaceIds = [...new Set(memberships.map((membership) => membership.workspace_id).filter(Boolean))]
  const workspaces: any[] = []
  for (const ids of chunked(workspaceIds)) {
    const { data, error } = await admin.from('workspaces').select('id, name').in('id', ids)
    if (error) throw error
    workspaces.push(...(data || []))
  }
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))

  return authUsers
    .map((authUser) => {
      const membership = membershipByUserId.get(authUser.id)
      const profile = profileByUserId.get(authUser.id)
      const workspace = membership ? workspaceById.get(membership.workspace_id) : null
      return {
        id: authUser.id,
        email: profile?.email || authUser.email || '',
        nickname: profile?.display_name || authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || '판매자',
        role: membership?.role === 'MANAGER' ? '관리자' : '판매자',
        status: '활성',
        createdAt: String(authUser.created_at || new Date().toISOString()).slice(0, 10),
        workspaceId: workspace?.id || null,
        workspaceName: workspace?.name || authUser.user_metadata?.workspace_name || null,
        phone: profile?.phone || null,
        emailConfirmed: Boolean(authUser.email_confirmed_at),
        source: 'cloud',
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, error: 'POST 요청만 지원합니다.' }, 405)

  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)

    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    if (body.action === 'list-voicecap-sellers') {
      if (user.user_metadata?.auth_app !== 'voicecap' && user.app_metadata?.role !== 'ADMIN') {
        return json({ ok: false, error: 'VoiceCAP 회원만 조회할 수 있습니다.' }, 403)
      }
      const sellers = await listVoicecapSellers()
      return json({ ok: true, sellers })
    }

    // 이 함수를 통해 로그인한 계정은 이후 관리자 목록에서 확실히 식별되도록 표식을 보정한다.
    if (user.user_metadata?.auth_app !== 'voicecap') {
      const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, auth_app: 'voicecap' },
      })
      if (metadataError) throw metadataError
    }

    const { data: membership, error: membershipError } = await admin
      .from('workspace_members').select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle()
    if (membershipError) throw membershipError
    const displayName = String(user.user_metadata?.display_name || user.email?.split('@')[0] || '판매자').slice(0, 100)
    const workspaceName = String(user.user_metadata?.workspace_name || `${displayName}의 VoiceCAP`).slice(0, 120)
    const { error: profileError } = await admin.from('profiles').upsert({
      id: user.id, email: user.email || null, display_name: displayName,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (profileError) throw profileError
    if (membership) return json({ ok: true, workspaceId: membership.workspace_id, created: false })
    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces').insert({ name: workspaceName, owner_id: user.id }).select('id').single()
    if (workspaceError) throw workspaceError
    const { error: insertError } = await admin.from('workspace_members').insert({
      workspace_id: workspace.id, user_id: user.id, role: 'OWNER',
    })
    if (insertError) throw insertError
    return json({ ok: true, workspaceId: workspace.id, created: true })
  } catch (error) {
    console.error(error)
    return json({ ok: false, error: error instanceof Error ? error.message : '작업공간 준비에 실패했습니다.' }, 500)
  }
})
