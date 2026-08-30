import {
  activeDevice,
  admin,
  authenticatedUser,
  handleCors,
  json,
  randomSecret,
  sha256,
  workspaceMembership,
} from '../_shared/voicecap.ts'

const pairingPepper = Deno.env.get('VOICECAP_PAIRING_PEPPER') ?? ''

const pairingHash = (code: string) => sha256(`${pairingPepper}:${code.trim().toUpperCase()}`)

Deno.serve(async (request) => {
  const cors = handleCors(request)
  if (cors) return cors
  if (request.method !== 'POST') return json({ ok: false, error: 'POST 요청만 지원합니다.' }, 405)

  try {
    const payload = await request.json()
    const action = String(payload.action ?? '')

    if (action === 'create-code') {
      const user = await authenticatedUser(request)
      if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)
      const membership = await workspaceMembership(user.id, payload.workspaceId)
      if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
        return json({ ok: false, error: '기기 연결 코드를 만들 권한이 없습니다.' }, 403)
      }

      const code = randomSecret(5).slice(0, 10).toUpperCase()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      const { error } = await admin.from('device_pairing_codes').insert({
        workspace_id: membership.workspace_id,
        created_by: user.id,
        code_hash: await pairingHash(code),
        expires_at: expiresAt,
      })
      if (error) throw error
      await admin.from('audit_logs').insert({
        workspace_id: membership.workspace_id,
        actor_user_id: user.id,
        action: 'DEVICE_PAIR_CODE_CREATED',
        entity_type: 'device_pairing_code',
      })
      return json({ ok: true, code, expiresAt, workspaceId: membership.workspace_id })
    }

    if (action === 'claim') {
      const code = String(payload.code ?? '').trim().toUpperCase()
      const deviceName = String(payload.deviceName ?? 'VoiceCAP Android').trim().slice(0, 100)
      if (!code || !deviceName) return json({ ok: false, error: '연결 코드와 기기 이름이 필요합니다.' }, 400)

      const now = new Date().toISOString()
      const { data: pairing, error: pairingError } = await admin
        .from('device_pairing_codes')
        .select('id, workspace_id, expires_at, claimed_at')
        .eq('code_hash', await pairingHash(code))
        .is('claimed_at', null)
        .maybeSingle()
      if (pairingError) throw pairingError
      if (!pairing || pairing.expires_at <= now) return json({ ok: false, error: '연결 코드가 만료되었거나 이미 사용되었습니다.' }, 400)

      const { data: claimedCode, error: claimError } = await admin
        .from('device_pairing_codes')
        .update({ claimed_at: now })
        .eq('id', pairing.id)
        .is('claimed_at', null)
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimedCode) return json({ ok: false, error: '연결 코드가 이미 사용되었습니다.' }, 400)

      const deviceToken = randomSecret(32)
      const { data: device, error: deviceError } = await admin
        .from('devices')
        .insert({
          workspace_id: pairing.workspace_id,
          name: deviceName,
          token_hash: await sha256(deviceToken),
          app_version: String(payload.appVersion ?? '').slice(0, 40),
          last_seen_at: now,
        })
        .select('id, workspace_id, name')
        .single()
      if (deviceError) throw deviceError
      await admin.from('audit_logs').insert({
        workspace_id: pairing.workspace_id,
        actor_device_id: device.id,
        action: 'DEVICE_PAIRED',
        entity_type: 'device',
        entity_id: device.id,
      })
      return json({ ok: true, deviceId: device.id, deviceToken, workspaceId: device.workspace_id, deviceName: device.name })
    }

    if (action === 'revoke-self') {
      const device = await activeDevice(request)
      if (!device) return json({ ok: false, error: '등록된 기기가 아닙니다.' }, 401)
      await admin.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', device.id)
      return json({ ok: true })
    }

    return json({ ok: false, error: '지원하지 않는 요청입니다.' }, 400)
  } catch (error) {
    console.error(error)
    return json({ ok: false, error: error instanceof Error ? error.message : '기기 연결 처리에 실패했습니다.' }, 500)
  }
})
