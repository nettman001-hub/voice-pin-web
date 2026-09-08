import { admin, successResponse, errorResponse } from '../../_shared/productSales.ts'

export async function handleClaimPrintJobs(workspaceId: string, deviceId: string | undefined, body: any) {
  const { limit = 10 } = body
  const { data: queuedJobs } = await admin
    .from('print_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'QUEUED')
    .order('created_at', { ascending: true })
    .limit(limit)

  const leaseToken = `lease_${crypto.randomUUID().replace(/-/g, '')}`
  const leaseExpiresAt = new Date(Date.now() + 30000).toISOString()
  const claimed: any[] = []

  for (const j of queuedJobs || []) {
    const { data: updated } = await admin
      .from('print_jobs')
      .update({
        status: 'CLAIMED',
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        attempts: (j.attempts || 0) + 1,
        target_device_id: deviceId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', j.id)
      .select('*')
      .single()
    if (updated) claimed.push(updated)
  }

  return successResponse({
    jobs: claimed,
    leaseToken,
    leaseExpiresAt,
  })
}

export async function handleRenewPrintLease(workspaceId: string, body: any) {
  const { jobId, leaseToken } = body
  const expiresAt = new Date(Date.now() + 30000).toISOString()
  await admin
    .from('print_jobs')
    .update({ lease_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('lease_token', leaseToken)
    .eq('workspace_id', workspaceId)

  return successResponse({ leaseExpiresAt: expiresAt })
}

export async function handleBeginPrintJob(workspaceId: string, body: any) {
  const { jobId, leaseToken } = body
  const { data: job } = await admin
    .from('print_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!job) return errorResponse('NOT_FOUND', '작업을 찾을 수 없습니다.', 404)
  if (job.lease_token !== leaseToken) {
    return errorResponse('REVISION_CONFLICT', '유효하지 않은 leaseToken입니다.', 409)
  }

  const recordedAt = new Date().toISOString()
  await admin
    .from('print_jobs')
    .update({ status: 'SUBMITTING', updated_at: recordedAt })
    .eq('id', jobId)

  return successResponse({
    status: 'SUBMITTING',
    serverRecordedAt: recordedAt,
  })
}

export async function handleAcknowledgePrintJob(workspaceId: string, body: any) {
  const { jobId, leaseToken, result } = body
  const nextStatus = result === 'SUCCESS' ? 'SUBMITTED' : 'FAILED'

  const { data: updated } = await admin
    .from('print_jobs')
    .update({
      status: nextStatus,
      result: result || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('lease_token', leaseToken)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()

  return successResponse({
    status: nextStatus,
    job: updated,
  })
}

export async function handleRequestReprint(workspaceId: string, body: any) {
  const { saleId, reason } = body
  const { data: sale } = await admin
    .from('sales')
    .select('*')
    .eq('id', saleId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!sale) return errorResponse('NOT_FOUND', '판매 내역을 찾을 수 없습니다.', 404)

  const jobId = crypto.randomUUID()
  const { data: pJob } = await admin
    .from('print_jobs')
    .insert({
      id: jobId,
      workspace_id: workspaceId,
      sale_id: saleId,
      sale_revision: sale.revision,
      kind: 'REPRINT',
      status: 'QUEUED',
      immutable_payload: {
        saleId: sale.id,
        buyerNickname: sale.buyer_nickname,
        amount: sale.amount,
        reason: reason || '재인쇄 요청',
        createdAt: new Date().toISOString(),
      },
    })
    .select('*')
    .single()

  return successResponse({ printJob: pJob })
}

export async function handleGetPrintStatus(workspaceId: string, body: any) {
  const { saleIds, jobIds } = body
  let query = admin.from('print_jobs').select('*').eq('workspace_id', workspaceId)
  if (Array.isArray(saleIds) && saleIds.length) {
    query = query.in('sale_id', saleIds)
  } else if (Array.isArray(jobIds) && jobIds.length) {
    query = query.in('id', jobIds)
  }

  const { data: jobs } = await query
  return successResponse({ jobs: jobs || [] })
}
