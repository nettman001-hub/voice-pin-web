import { admin } from '../_shared/voicecap.ts'
import { buildServerClaim, invoiceFromRow, type PaymentInput } from './core.ts'
import {
  decideAliasUpdate,
  isUnknownPayer,
  MATCH_WINDOW_DAYS,
  matchPayment,
  normalizePayerName,
  type PaymentMatchResult,
} from '../../../src/services/paymentMatching.ts'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

/**
 * 입금자명 → 닉네임 별칭 저장. 같은 입금자명이 이미 다른 닉네임에 묶여 있으면(동명이인)
 * 닉네임을 빈 값으로 바꿔 "모호함"으로 표시한다. 이후 그 이름의 입금은 자동 확정되지 않고 판매자 확인으로 간다.
 */
export async function saveDepositorAlias(workspaceId: string, payerName: string, buyerNickname: string) {
  if (isUnknownPayer(payerName) || !buyerNickname.trim()) return
  const payerNormalized = normalizePayerName(payerName)
  const { data: existing, error: readError } = await admin.from('depositor_aliases')
    .select('buyer_nickname').eq('workspace_id', workspaceId).eq('payer_name_normalized', payerNormalized).maybeSingle()
  if (readError) throw readError
  const decision = decideAliasUpdate(existing ? String(existing.buyer_nickname ?? '') : null, buyerNickname)
  if (decision === 'keep') return
  if (decision === 'ambiguous') {
    const { error } = await admin.from('depositor_aliases').update({ buyer_nickname: '' })
      .eq('workspace_id', workspaceId).eq('payer_name_normalized', payerNormalized)
    if (error) throw error
    return
  }
  const { error } = await admin.from('depositor_aliases').insert({
    workspace_id: workspaceId,
    payer_name_normalized: payerNormalized,
    buyer_nickname: buyerNickname.trim(),
  })
  if (error && error.code !== '23505') throw error
}

/** PURCHASE_INFO 문자가 들어오면 서버에서 구매 신청을 만든다(웹이 꺼져 있어도 남도록). */
export async function createClaimForMessage(workspaceId: string, message: Row) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: sales, error: salesError } = await admin.from('sales')
    .select('id, session_id, buyer_nickname, amount, product_name, recognized_at, created_at, status, capture_image_paths')
    .eq('workspace_id', workspaceId)
    .gte('recognized_at', since)
    .order('recognized_at', { ascending: false })
    .limit(1000)
  if (salesError) throw salesError
  const { claim, alias } = buildServerClaim(workspaceId, message, sales ?? [])
  const { error } = await admin.from('purchase_claims').upsert(claim, { onConflict: 'message_id', ignoreDuplicates: true })
  if (error) throw error
  if (alias) await saveDepositorAlias(workspaceId, alias.payer_name_normalized, alias.buyer_nickname)
}

/**
 * 저장된 입금을 미결 정산서와 대조한다. 자동 확정(MATCHED)이면 정산서를 PAID로 바꾸고,
 * 그 사이 다른 입금이 먼저 정산서를 가져갔으면 확인 필요로 돌린다.
 */
export async function matchStoredPayment(workspaceId: string, paymentId: string, payment: PaymentInput): Promise<PaymentMatchResult> {
  const since = new Date(new Date(payment.paidAt).getTime() - MATCH_WINDOW_DAYS * 86_400_000).toISOString()
  const [invoicesResult, aliasesResult] = await Promise.all([
    admin.from('invoices')
      .select('id, customer_nickname, amount, status, sale_ids, deposit_code, created_at')
      .eq('workspace_id', workspaceId)
      .in('status', ['QUEUED', 'SENT'])
      .gte('created_at', since),
    isUnknownPayer(payment.payerName)
      ? Promise.resolve({ data: [], error: null })
      : admin.from('depositor_aliases')
        .select('payer_name_normalized, buyer_nickname')
        .eq('workspace_id', workspaceId)
        .eq('payer_name_normalized', normalizePayerName(payment.payerName)),
  ])
  if (invoicesResult.error) throw invoicesResult.error
  if (aliasesResult.error) throw aliasesResult.error
  const aliases = new Map((aliasesResult.data ?? []).map((row: Row) => [String(row.payer_name_normalized), String(row.buyer_nickname)]))
  let result = matchPayment(payment, (invoicesResult.data ?? []).map(invoiceFromRow), aliases)

  if (result.status === 'MATCHED' && result.invoiceId) {
    const { data: paid, error } = await admin.from('invoices')
      .update({ status: 'PAID' })
      .eq('workspace_id', workspaceId)
      .eq('id', result.invoiceId)
      .in('status', ['QUEUED', 'SENT'])
      .select('id')
    if (error) throw error
    if (!paid || paid.length === 0) {
      result = { status: 'NEEDS_REVIEW', reason: result.reason, saleIds: [], candidateIds: [result.invoiceId] }
    }
  }

  const { error: updateError } = await admin.from('payment_receipts').update({
    match_status: result.status,
    invoice_id: result.status === 'MATCHED' ? result.invoiceId : null,
    sale_ids: result.saleIds,
    candidate_ids: result.candidateIds,
  }).eq('workspace_id', workspaceId).eq('id', paymentId)
  if (updateError) throw updateError
  return result
}
