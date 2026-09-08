import { admin, successResponse, errorResponse } from '../../_shared/productSales.ts'

export async function handleListDevices(workspaceId: string) {
  const { data: devices } = await admin
    .from('devices')
    .select('id, name, device_type, capabilities, is_output_device, revision, last_seen_at')
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  return successResponse({
    devices: (devices || []).map((d) => ({
      id: d.id,
      displayName: d.name,
      deviceType: d.device_type,
      capabilities: d.capabilities || [],
      isOutputDevice: d.is_output_device,
      revision: d.revision || 1,
      lastSeenAt: d.last_seen_at,
    })),
    nextCursor: null,
  })
}

export async function handleUpdateDeviceCapabilities(workspaceId: string, body: any) {
  const { deviceId, expectedDeviceRevision, capabilities: newCaps } = body
  if (!deviceId || !Array.isArray(newCaps)) {
    return errorResponse('VALIDATION_ERROR', 'deviceId와 capabilities는 필수입니다.', 400)
  }

  const { data: dev } = await admin
    .from('devices')
    .select('*')
    .eq('id', deviceId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!dev) return errorResponse('NOT_FOUND', '기기를 찾을 수 없습니다.', 404)

  if (expectedDeviceRevision !== undefined && dev.revision !== expectedDeviceRevision) {
    return errorResponse('REVISION_CONFLICT', '기기 설정 충돌이 발생했습니다.', 409)
  }

  const nextRev = (dev.revision || 1) + 1
  await admin
    .from('devices')
    .update({ capabilities: newCaps, revision: nextRev, updated_at: new Date().toISOString() })
    .eq('id', deviceId)

  return successResponse({
    device: {
      id: dev.id,
      displayName: dev.name,
      capabilities: newCaps,
      revision: nextRev,
    },
    auditLogId: crypto.randomUUID(),
  })
}

export async function handleSetOutputDevice(workspaceId: string, body: any) {
  const { deviceId } = body
  await admin
    .from('devices')
    .update({ is_output_device: false })
    .eq('workspace_id', workspaceId)

  if (deviceId) {
    await admin
      .from('devices')
      .update({ is_output_device: true })
      .eq('id', deviceId)
      .eq('workspace_id', workspaceId)
  }

  const { data: outDev } = await admin
    .from('devices')
    .select('id, name')
    .eq('id', deviceId)
    .single()

  return successResponse({
    outputDevice: outDev ? { id: outDev.id, displayName: outDev.name } : null,
    settingsRevision: 2,
  })
}
