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
import { createFcmSender, parseServiceAccount, type PushResult } from '../_shared/fcm.ts'

const pairingPepper = Deno.env.get('VOICECAP_PAIRING_PEPPER') ?? ''
const fcmAccount = parseServiceAccount(Deno.env.get('FCM_SERVICE_ACCOUNT_JSON'))
const sendOutboxPush = fcmAccount ? createFcmSender(fcmAccount) : null

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
      await admin.from('device_push_tokens').delete().eq('device_id', device.id)
      return json({ ok: true })
    }

    // 휴대폰 앱이 FCM 토큰을 등록한다. 빈 토큰이면 등록을 지운다.
    if (action === 'register-push') {
      const device = await activeDevice(request)
      if (!device) return json({ ok: false, error: '등록된 기기가 아닙니다.' }, 401)
      const token = String(payload.token ?? '').trim()
      if (token.length > 4096) return json({ ok: false, error: '알림 토큰이 너무 깁니다.' }, 400)
      if (!token) {
        const { error } = await admin.from('device_push_tokens').delete().eq('device_id', device.id)
        if (error) throw error
        return json({ ok: true, registered: false, pushConfigured: Boolean(sendOutboxPush) })
      }
      // 앱을 다시 연결하면 같은 토큰이 예전 기기 행에 남아 있을 수 있어 먼저 옮긴다.
      const { error: moveError } = await admin.from('device_push_tokens').delete().eq('token', token).neq('device_id', device.id)
      if (moveError) throw moveError
      const { error } = await admin.from('device_push_tokens').upsert({
        device_id: device.id,
        workspace_id: device.workspace_id,
        token,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'device_id' })
      if (error) throw error
      return json({ ok: true, registered: true, pushConfigured: Boolean(sendOutboxPush) })
    }

    // 웹이 문자를 대기열에 넣은 뒤 부른다. 연결된 휴대폰을 깨워 바로 outbox-claim 하게 한다.
    if (action === 'notify-outbox') {
      const user = await authenticatedUser(request)
      if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)
      const membership = await workspaceMembership(user.id, payload.workspaceId)
      if (!membership) return json({ ok: false, error: '워크스페이스 권한이 없습니다.' }, 403)
      const workspaceId = membership.workspace_id

      const { data: queued, error: queuedError } = await admin
        .from('customer_messages')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('direction', 'OUTGOING')
        .eq('status', 'QUEUED')
        .limit(1)
      if (queuedError) throw queuedError
      if (!queued?.length) return json({ ok: true, queued: false, configured: Boolean(sendOutboxPush), devices: 0, pushed: 0 })

      const { data: devices, error: devicesError } = await admin
        .from('devices')
        .select('id, capabilities')
        .eq('workspace_id', workspaceId)
        .is('revoked_at', null)
      if (devicesError) throw devicesError
      const smsDeviceIds = (devices ?? [])
        .filter((device) => !Array.isArray(device.capabilities) || device.capabilities.includes('SMS'))
        .map((device) => device.id as string)
      if (!sendOutboxPush || smsDeviceIds.length === 0) {
        return json({ ok: true, queued: true, configured: Boolean(sendOutboxPush), devices: smsDeviceIds.length, pushed: 0 })
      }

      const { data: tokens, error: tokensError } = await admin
        .from('device_push_tokens')
        .select('device_id, token')
        .in('device_id', smsDeviceIds)
      if (tokensError) throw tokensError
      const results = await Promise.all((tokens ?? []).map(async (row) => {
        let result: PushResult = 'FAILED'
        try {
          result = await sendOutboxPush(String(row.token))
        } catch (error) {
          console.error('[device-pair] FCM 발송 실패', error)
        }
        if (result === 'STALE_TOKEN') {
          await admin.from('device_push_tokens').delete().eq('device_id', row.device_id).eq('token', row.token)
        }
        return result
      }))
      return json({
        ok: true,
        queued: true,
        configured: true,
        devices: smsDeviceIds.length,
        pushed: results.filter((result) => result === 'SENT').length,
      })
    }

    return json({ ok: false, error: '지원하지 않는 요청입니다.' }, 400)
  } catch (error) {
    console.error(error)
    return json({ ok: false, error: error instanceof Error ? error.message : '기기 연결 처리에 실패했습니다.' }, 500)
  }
})
