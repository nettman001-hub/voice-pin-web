import {
  activeDevice,
  admin,
  base64Bytes,
  handleCors,
  json,
  validMessageCategory,
  validMessageStatus,
} from '../_shared/voicecap.ts'

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : []

async function uploadAttachments(workspaceId: string, messageId: string, attachments: unknown[]) {
  if (attachments.length > 8) throw new Error('이미지는 최대 8개까지 첨부할 수 있습니다.')
  const uploaded = []
  for (const attachment of attachments) {
    const item = attachment as { dataUrl?: string; fileName?: string }
    if (!item?.dataUrl) continue
    const { bytes, mimeType } = base64Bytes(item.dataUrl)
    const extension = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1]
    const path = `${workspaceId}/sms/${messageId}/${crypto.randomUUID()}.${extension}`
    const { error } = await admin.storage.from('voicecap-private').upload(path, bytes, {
      contentType: mimeType,
      upsert: false,
    })
    if (error) throw error
    uploaded.push({ id: crypto.randomUUID(), mimeType, path, fileName: String(item.fileName ?? `attachment.${extension}`).slice(0, 160) })
  }
  return uploaded
}

Deno.serve(async (request) => {
  const cors = handleCors(request)
  if (cors) return cors
  if (request.method !== 'POST') return json({ ok: false, error: 'POST 요청만 지원합니다.' }, 405)

  const device = await activeDevice(request)
  if (!device) return json({ ok: false, error: '등록되지 않았거나 해제된 기기입니다.' }, 401)

  try {
    const payload = await request.json()
    const action = String(payload.action ?? '')
    const workspaceId = device.workspace_id

    if (action === 'status') return json({ ok: true, workspaceId, deviceName: device.name })

    if (action === 'incoming') {
      const phoneNumber = String(payload.phoneNumber ?? '').trim()
      const body = String(payload.body ?? '').trim()
      const externalId = String(payload.externalId ?? '').trim()
      const category = validMessageCategory.has(String(payload.category)) ? String(payload.category) : 'PURCHASE_INFO'
      if (!phoneNumber || !body || !externalId) return json({ ok: false, error: 'externalId, phoneNumber, body가 필요합니다.' }, 400)

      const { data: existing } = await admin
        .from('customer_messages')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('external_id', externalId)
        .maybeSingle()
      if (existing) return json({ ok: true, duplicate: true, message: existing })

      const messageId = `sms-${crypto.randomUUID()}`
      const attachments = await uploadAttachments(workspaceId, messageId, Array.isArray(payload.attachments) ? payload.attachments : [])
      const receivedAt = String(payload.receivedAt ?? new Date().toISOString())
      const row = {
        id: messageId,
        workspace_id: workspaceId,
        device_id: device.id,
        external_id: externalId,
        phone_number: phoneNumber,
        body,
        direction: 'INCOMING',
        category,
        status: 'RECEIVED',
        sale_ids: list(payload.saleIds),
        attachments,
        received_at: receivedAt,
        created_at: receivedAt,
      }
      const { data, error } = await admin.from('customer_messages').insert(row).select().single()
      if (error) throw error
      await admin.from('audit_logs').insert({ workspace_id: workspaceId, actor_device_id: device.id, action: 'SMS_RECEIVED', entity_type: 'customer_message', entity_id: messageId })
      return json({ ok: true, duplicate: false, message: data }, 201)
    }

    if (action === 'messages') {
      const limit = Math.min(Math.max(Number(payload.limit) || 200, 1), 2000)
      const { data, error } = await admin
        .from('customer_messages')
        .select('id, phone_number, direction, category, sale_ids, created_at, received_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return json({ ok: true, messages: data ?? [] })
    }

    if (action === 'outbox-claim') {
      const { data, error } = await admin.rpc('claim_outbox_messages', {
        p_workspace_id: workspaceId,
        p_device_id: device.id,
        p_limit: Math.min(Math.max(Number(payload.limit) || 20, 1), 50),
      })
      if (error) throw error
      return json({ ok: true, messages: data ?? [] })
    }

    if (action === 'outbox-status') {
      const id = String(payload.id ?? '')
      const status = String(payload.status ?? '')
      if (!id || !validMessageStatus.has(status) || !['SENT', 'FAILED', 'SENDING'].includes(status)) {
        return json({ ok: false, error: '올바른 발송 상태가 필요합니다.' }, 400)
      }
      const update: Record<string, unknown> = { status, lease_expires_at: null, lease_device_id: null }
      if (status === 'SENT') update.sent_at = String(payload.sentAt ?? new Date().toISOString())
      if (status === 'FAILED') update.error = String(payload.error ?? 'SMS 발송 실패').slice(0, 500)
      const { data, error } = await admin
        .from('customer_messages')
        .update(update)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .eq('lease_device_id', device.id)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) return json({ ok: false, error: '발송 점유권이 없거나 메시지를 찾을 수 없습니다.' }, 409)
      await admin.from('audit_logs').insert({ workspace_id: workspaceId, actor_device_id: device.id, action: `SMS_${status}`, entity_type: 'customer_message', entity_id: id })
      return json({ ok: true, message: data })
    }

    if (action === 'payment-incoming') {
      const externalId = String(payload.externalId ?? '').trim()
      const payerName = String(payload.payerName ?? '').trim()
      const amount = Number(payload.amount)
      if (!externalId || !payerName || !Number.isFinite(amount) || amount <= 0) {
        return json({ ok: false, error: 'externalId, payerName, amount가 필요합니다.' }, 400)
      }
      const { data: existing } = await admin.from('payment_receipts')
        .select('*').eq('workspace_id', workspaceId).eq('external_id', externalId).maybeSingle()
      if (existing) return json({ ok: true, duplicate: true, payment: existing })
      const id = `bank-${crypto.randomUUID()}`
      const paidAt = String(payload.paidAt ?? new Date().toISOString())
      const { data, error } = await admin.from('payment_receipts').insert({
        id, workspace_id: workspaceId, external_id: externalId, payer_name: payerName,
        amount, paid_at: paidAt, memo: String(payload.memo ?? '').slice(0, 1000),
        sale_ids: [], match_status: 'UNMATCHED',
      }).select().single()
      if (error) throw error
      return json({ ok: true, duplicate: false, payment: data }, 201)
    }

    return json({ ok: false, error: '지원하지 않는 요청입니다.' }, 400)
  } catch (error) {
    console.error(error)
    return json({ ok: false, error: error instanceof Error ? error.message : 'SMS 브리지 처리에 실패했습니다.' }, 500)
  }
})
