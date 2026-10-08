// sms-bridge의 순수 로직. Deno 전용 모듈을 쓰지 않아 Node 테스트에서도 그대로 불러온다.
import {
  chooseMatchingSales,
  compareClaimWithSales,
  parseCustomerMessage,
} from '../../../src/services/customerMessageParser.ts'
import {
  isUnknownPayer,
  normalizePayerName,
  UNKNOWN_PAYER,
  type MatchableInvoice,
} from '../../../src/services/paymentMatching.ts'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const isoOrNow = (value: unknown) => {
  const parsed = new Date(String(value ?? ''))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export interface OutgoingInput {
  externalId: string
  phoneNumber: string
  body: string
  sentAt: string
  status: 'SENT' | 'FAILED'
  error: string | null
  category: string
  saleIds: string[]
}

/** 휴대폰에서 직접 보낸 업무 문자 기록 (action: outgoing) */
export function parseOutgoing(payload: Row, validCategories: Set<string>): Parsed<OutgoingInput> {
  const externalId = text(payload.externalId, 200)
  const phoneNumber = text(payload.phoneNumber, 40)
  const body = text(payload.body, 5000)
  if (!externalId || !phoneNumber || !body) return { ok: false, error: 'externalId, phoneNumber, body가 필요합니다.' }
  const status = payload.status === 'FAILED' ? 'FAILED' : 'SENT'
  const category = validCategories.has(String(payload.category)) ? String(payload.category) : 'GENERAL'
  return {
    ok: true,
    value: {
      externalId,
      phoneNumber,
      body,
      sentAt: isoOrNow(payload.sentAt),
      status,
      error: status === 'FAILED' ? text(payload.error, 500) || 'SMS 발송 실패' : null,
      category,
      saleIds: Array.isArray(payload.saleIds) ? payload.saleIds.map(String) : [],
    },
  }
}

export interface PaymentInput {
  externalId: string
  payerName: string
  amount: number
  paidAt: string
  memo: string
  receiverName: string | null
  bank: string | null
  source: 'NOTIFICATION' | 'SMS'
}

/** 입금 알림/입금 문자에서 뽑은 값 (action: payment-incoming) */
export function parsePayment(payload: Row): Parsed<PaymentInput> {
  const externalId = text(payload.externalId, 200)
  const amount = Number(payload.amount)
  if (!externalId || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: 'externalId와 1원 이상의 정수 amount가 필요합니다.' }
  }
  return {
    ok: true,
    value: {
      externalId,
      payerName: text(payload.payerName, 100) || UNKNOWN_PAYER,
      amount,
      paidAt: isoOrNow(payload.paidAt),
      memo: text(payload.memo, 1000),
      receiverName: text(payload.receiverName, 200) || null,
      bank: text(payload.bank, 100) || null,
      source: payload.source === 'SMS' ? 'SMS' : 'NOTIFICATION',
    },
  }
}

export const invoiceFromRow = (row: Row): MatchableInvoice => ({
  id: String(row.id),
  customerNickname: String(row.customer_nickname ?? ''),
  amount: Number(row.amount),
  status: String(row.status),
  saleIds: Array.isArray(row.sale_ids) ? row.sale_ids.map(String) : [],
  depositCode: row.deposit_code ? String(row.deposit_code) : null,
  createdAt: String(row.created_at),
})

const saleFromRow = (row: Row) => ({
  id: String(row.id),
  sessionId: String(row.session_id ?? ''),
  buyerNickname: String(row.buyer_nickname ?? ''),
  amount: Number(row.amount) || 0,
  productName: row.product_name ? String(row.product_name) : undefined,
  recognizedAt: String(row.recognized_at ?? row.created_at ?? ''),
  captureImageUrls: Array.isArray(row.capture_image_paths) ? row.capture_image_paths.map(String) : [],
})

export interface ServerClaim {
  claim: Row
  alias: { payer_name_normalized: string; buyer_nickname: string } | null
}

/**
 * 구매정보 문자(PURCHASE_INFO)로 구매 신청을 만든다. 웹 buildClaimFromMessage와 같은 파싱 규칙을 쓰되,
 * 사진은 Storage 경로를 그대로 저장한다.
 */
export function buildServerClaim(workspaceId: string, message: Row, saleRows: Row[], now = new Date().toISOString()): ServerClaim {
  const body = String(message.body ?? '')
  const parsed = parseCustomerMessage(body)
  const sales = saleRows.filter((row) => row.status !== '보류').map(saleFromRow)
  // deno-lint-ignore no-explicit-any
  const matchedSales = chooseMatchingSales(parsed, sales as any)
  const capturePaths = (Array.isArray(message.attachments) ? message.attachments : [])
    .filter((attachment: Row) => String(attachment?.mimeType ?? '').startsWith('image/') && attachment?.path)
    .map((attachment: Row) => String(attachment.path))
  // deno-lint-ignore no-explicit-any
  const comparison = compareClaimWithSales({ ...parsed, captureImageUrls: capturePaths }, matchedSales as any)
  const claim = {
    id: `claim-${message.id}`,
    workspace_id: workspaceId,
    message_id: String(message.id),
    phone_number: String(message.phone_number ?? ''),
    nickname: parsed.nickname,
    address: parsed.address,
    product_name: parsed.productName,
    amount: parsed.amount,
    capture_image_paths: capturePaths,
    sale_ids: matchedSales.map((sale) => sale.id),
    match_status: comparison.status,
    field_matches: comparison.fields,
    seller_note: '',
    created_at: String(message.received_at ?? message.created_at ?? now),
    updated_at: now,
  }
  const nickname = parsed.nickname || matchedSales[0]?.buyerNickname || ''
  const alias = parsed.depositorName && nickname && !isUnknownPayer(parsed.depositorName)
    ? { payer_name_normalized: normalizePayerName(parsed.depositorName), buyer_nickname: nickname }
    : null
  return { claim, alias }
}
