import { admin, authenticatedUser, handleCors, json } from '../_shared/voicecap.ts'

Deno.serve(async (request) => {
  const cors = handleCors(request)
  if (cors) return cors
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

    if (body?.action === 'list-voicecap-sellers') {
      // 1. VoiceCAP 작업공간 회원 조회 (타 서비스 sermon-guide-db와 100% 격리)
      const { data: memberships, error: membersError } = await admin
        .from('workspace_members')
        .select(`
          user_id,
          role,
          created_at,
          workspaces (id, name, created_at),
          profiles (id, email, display_name, phone)
        `)
        .order('created_at', { ascending: false })

      if (membersError) throw membersError

      // 2. 가입 직후 아직 첫 로그인을 하지 않아 workspace가 생성되지 않은 VoiceCAP 가입자도 수집
      const { data: authData, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const memberUserIds = new Set((memberships || []).map((m: any) => m.user_id))
      const voicecapAuthUsers = (!authError && authData?.users)
        ? authData.users.filter((u: any) => u.user_metadata?.auth_app === 'voicecap' && !memberUserIds.has(u.id))
        : []

      const sellers = [
        ...(memberships || []).map((m: any) => {
          const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
          const workspace = Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces
          return {
            id: m.user_id,
            email: profile?.email || '',
            nickname: profile?.display_name || '판매자',
            role: m.role === 'OWNER' ? '판매자' : (m.role === 'MANAGER' ? '관리자' : '판매자'),
            status: '활성',
            createdAt: m.created_at ? String(m.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
            workspaceId: workspace?.id || null,
            workspaceName: workspace?.name || null,
            phone: profile?.phone || null,
            source: 'cloud',
          }
        }),
        ...voicecapAuthUsers.map((u: any) => ({
          id: u.id,
          email: u.email || '',
          nickname: u.user_metadata?.display_name || u.email?.split('@')[0] || '판매자',
          role: '판매자',
          status: '활성',
          createdAt: u.created_at ? String(u.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
          workspaceId: null,
          workspaceName: u.user_metadata?.workspace_name || null,
          phone: null,
          source: 'cloud',
        }))
      ]

      return json({ ok: true, sellers })
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
