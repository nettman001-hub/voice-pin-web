import { admin, successResponse, errorResponse } from '../../_shared/productSales.ts'
import { getWorkspaceSettings } from './common.ts'

export async function handleGetBootstrap(workspaceId: string, capabilities: Set<string>) {
  const settings = await getWorkspaceSettings(workspaceId)

  const { data: session } = await admin
    .from('live_sessions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  let activeProduct = null
  if (session?.active_product_id) {
    const { data: prod } = await admin
      .from('products')
      .select('*')
      .eq('id', session.active_product_id)
      .maybeSingle()
    if (prod) {
      activeProduct = {
        id: prod.id,
        productCode: prod.product_code,
        name: prod.name,
        unitPrice: prod.unit_price,
        imageKind: prod.image_kind,
        imageUrl: prod.image_path,
        imagePath: prod.image_path,
        source: prod.source,
        revision: prod.revision,
        salesRevision: prod.sales_revision,
      }
    }
  }

  const { data: outputDevice } = await admin
    .from('devices')
    .select('id, name, last_seen_at')
    .eq('workspace_id', workspaceId)
    .eq('is_output_device', true)
    .is('revoked_at', null)
    .maybeSingle()

  const printerStatus = {
    outputDeviceId: outputDevice?.id || null,
    outputDeviceName: outputDevice?.name || null,
    online: outputDevice ? (new Date().getTime() - new Date(outputDevice.last_seen_at || 0).getTime() < 120000) : false,
    queuedJobsCount: 0,
  }

  return successResponse({
    workspaceId,
    settings,
    activeSession: session
      ? {
          id: session.id,
          displayCode: session.display_code,
          status: session.status,
          activeProductId: session.active_product_id,
          revision: session.revision,
          startedAt: session.started_at,
        }
      : null,
    activeProduct,
    printerStatus,
    permissions: Array.from(capabilities),
  })
}

export async function handleUpdateSettings(workspaceId: string, body: any) {
  const { operationId, expectedRevision, settings } = body
  if (!settings) return errorResponse('VALIDATION_ERROR', 'settings 필드가 누락되었습니다.', 400)

  const current = await getWorkspaceSettings(workspaceId)
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    return errorResponse('REVISION_CONFLICT', '설정 버전 충돌이 발생했습니다.', 409, {
      currentRevision: current.revision,
    })
  }

  // Validate voiceCommands overlap
  if (settings.voiceCommands && typeof settings.voiceCommands === 'object') {
    const seenWords = new Map<string, string>()
    for (const [actionName, words] of Object.entries(settings.voiceCommands)) {
      if (Array.isArray(words)) {
        for (const w of words) {
          const trimmed = String(w).trim()
          if (!trimmed) continue
          if (seenWords.has(trimmed)) {
            const prevAction = seenWords.get(trimmed)
            if (prevAction !== actionName) {
              return errorResponse(
                'VALIDATION_ERROR',
                `명령 단어 '${trimmed}'가 서로 다른 동작(${prevAction}, ${actionName})에 중복 설정되었습니다.`,
                400,
                { conflictingWord: trimmed, actions: [prevAction, actionName] }
              )
            }
          }
          seenWords.set(trimmed, actionName)
        }
      }
    }
  }

  const newRevision = (current.revision || 1) + 1
  const updatedSettings = { ...current, ...settings, revision: newRevision }

  await admin.from('workspace_settings').upsert({
    workspace_id: workspaceId,
    namespace: 'product_sales',
    value: updatedSettings,
    updated_at: new Date().toISOString(),
  })

  return successResponse({ settings: updatedSettings })
}

export async function handleStartSession(workspaceId: string, body: any) {
  const { displayName } = body
  const code = displayName || `${new Date().toISOString().slice(0, 10)} 라이브 1회차`

  await admin
    .from('live_sessions')
    .update({ status: 'ENDED', ended_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('status', 'ACTIVE')

  const { data: session, error } = await admin
    .from('live_sessions')
    .insert({
      workspace_id: workspaceId,
      display_code: code,
      status: 'ACTIVE',
      revision: 1,
    })
    .select('*')
    .single()

  if (error) return errorResponse('TEMPORARILY_UNAVAILABLE', error.message, 500)
  return successResponse({ session })
}

export async function handleEndSession(workspaceId: string, body: any) {
  const { sessionId, expectedSessionRevision } = body
  const { data: session } = await admin
    .from('live_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!session) return errorResponse('NOT_FOUND', '회차를 찾을 수 없습니다.', 404)
  if (expectedSessionRevision !== undefined && session.revision !== expectedSessionRevision) {
    return errorResponse('REVISION_CONFLICT', '회차 버전 충돌이 발생했습니다.', 409)
  }

  const { data: updated } = await admin
    .from('live_sessions')
    .update({ status: 'ENDED', ended_at: new Date().toISOString(), revision: session.revision + 1 })
    .eq('id', sessionId)
    .select('*')
    .single()

  return successResponse({ session: updated })
}
