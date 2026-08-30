import { admin, authenticatedUser, handleCors, json } from '../_shared/voicecap.ts'

Deno.serve(async (request) => {
  const cors = handleCors(request)
  if (cors) return cors
  if (request.method !== 'POST') return json({ ok: false, error: 'POST 요청만 지원합니다.' }, 405)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)
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
