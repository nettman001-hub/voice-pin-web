/**
 * 관리탭 쓰기 요청 검증 (순수 함수, Deno·Node 공용).
 * 실제 상태 변경과 잠금은 DB 함수 public.voicecap_manage() 가 한다.
 */

export const MANAGE_ACTIONS: Record<string, string> = {
  'manage-contact-link': 'contact-link',
  'manage-keep': 'keep',
  'manage-unkeep': 'unkeep',
  'manage-cancel-items': 'cancel-items',
  'manage-mark-refunded': 'mark-refunded',
  'manage-backfill-buyer-keys': 'backfill-buyer-keys',
  'manage-shipment-reserve': 'shipment-reserve',
  'manage-shipment-status': 'shipment-status',
  'manage-invoice-create': 'invoice-create',
  'manage-invoice-begin-send': 'invoice-begin-send',
  'manage-invoice-finish-send': 'invoice-finish-send',
  'manage-invoice-cancel': 'invoice-cancel',
};

export const MANAGE_MESSAGES: Record<string, string> = {
  OPERATION_PAYLOAD_MISMATCH: '같은 작업 번호로 다른 내용을 보낼 수 없습니다.',
  SALE_NOT_FOUND: '판매를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.',
  SALE_NOT_BILLABLE: '보류되거나 취소된 판매입니다.',
  KEEP_REQUIRES_PAYMENT: '결제 전 상품은 보관할 수 없습니다.',
  ITEM_STATE_CONFLICT: '상품 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.',
  SHIPMENT_ITEM_UNPAID: '결제 전 상품은 출고할 수 없습니다.',
  SHIPMENT_CONFLICT: '다른 출고에 이미 들어 있는 상품이 있습니다.',
  KEPT_ITEMS_MISSING: '보관 중인 상품은 모두 함께 출고해야 합니다.',
  BUYER_MISMATCH: '다른 구매자의 상품이 섞여 있습니다.',
  SHIPMENT_NOT_FOUND: '출고를 찾을 수 없습니다.',
  SHIPMENT_STATE_CONFLICT: '지금 출고 상태에서는 할 수 없는 작업입니다.',
  REVISION_CONFLICT: '다른 화면에서 수정했습니다. 새로고침 후 다시 시도해 주세요.',
  INVOICE_CONFLICT: '이미 열린 정산서가 있거나 입금코드가 겹칩니다.',
  INVOICE_NOT_FOUND: '정산서를 찾을 수 없습니다.',
  INVOICE_CLOSED: '결제 완료되었거나 취소된 정산서입니다.',
  INVOICE_ALREADY_SENDING: '다른 화면에서 이 정산서를 보내는 중입니다.',
  INVOICE_ALREADY_SENT: '이미 보낸 정산서입니다. 다시 보내려면 [다시 보내기]를 눌러 주세요.',
  SEND_LEASE_LOST: '보내기 상태가 바뀌었습니다. 정산서 상태를 확인해 주세요.',
  PHONE_LINKED_TO_OTHER: '이 번호는 다른 구매자에게 연결되어 있습니다.',
  UNKNOWN_ACTION: '알 수 없는 작업입니다.',
  VALIDATION_ERROR: '입력값을 확인해 주세요.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SALES = 500;

export function normalizeManagePhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.startsWith('82') && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);
const int = (value: unknown) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 99_999_999 ? number : undefined;
};

export type ManageValidation =
  | { ok: true; dbAction: string; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/** 허용된 필드만 남긴다. 작업공간·작업자는 인증에서 정하므로 받지 않는다. */
export function validateManageRequest(action: string, body: Record<string, unknown>): ManageValidation {
  const dbAction = MANAGE_ACTIONS[action];
  if (!dbAction) return { ok: false, reason: 'action' };
  if (!UUID.test(String(body.operationId || ''))) return { ok: false, reason: 'operationId' };
  const payload: Record<string, unknown> = { operationId: String(body.operationId).toLowerCase() };

  if (body.saleIds !== undefined) {
    if (!Array.isArray(body.saleIds) || body.saleIds.length > MAX_SALES
      || body.saleIds.some((id) => typeof id !== 'string' || !id || id.length > 120)) {
      return { ok: false, reason: 'saleIds' };
    }
    payload.saleIds = Array.from(new Set(body.saleIds as string[])).sort();
  }
  const buyerKey = text(body.buyerKey, 200);
  if (buyerKey !== undefined) {
    if (!/^(buyer|nickname):.+/.test(buyerKey)) return { ok: false, reason: 'buyerKey' };
    payload.buyerKey = buyerKey;
  }
  for (const [key, max] of [
    ['nickname', 100], ['reason', 200], ['recipientName', 100], ['address', 300], ['memo', 300],
    ['carrier', 50], ['trackingNumber', 60], ['sessionId', 120], ['invoiceId', 120], ['shipmentId', 120],
    ['bankAccount', 200], ['depositCode', 20], ['error', 200],
  ] as const) {
    const value = text(body[key], max);
    if (value !== undefined) payload[key] = value;
  }
  if (body.phone !== undefined) payload.phone = normalizeManagePhone(body.phone);
  for (const key of ['productAmount', 'shippingFee', 'feeBasis', 'expectedRevision'] as const) {
    if (body[key] === undefined) continue;
    const value = int(body[key]);
    if (value === undefined) return { ok: false, reason: key };
    payload[key] = value;
  }
  for (const key of ['replace', 'shippingPaid', 'resend', 'sent'] as const) {
    if (body[key] !== undefined) payload[key] = body[key] === true;
  }
  if (body.mode !== undefined) {
    if (!['LINK', 'BLOCK', 'UNLINK'].includes(String(body.mode))) return { ok: false, reason: 'mode' };
    payload.mode = body.mode;
  }
  if (body.status !== undefined) {
    if (!['PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'].includes(String(body.status))) return { ok: false, reason: 'status' };
    payload.status = body.status;
  }
  if (body.cancelledBy !== undefined) payload.cancelledBy = body.cancelledBy === 'SELLER' ? 'SELLER' : 'CUSTOMER';
  if (body.source !== undefined) payload.source = body.source === 'MESSAGE' ? 'MESSAGE' : 'MANUAL';
  if (body.sentVia !== undefined) {
    if (!['SMS', 'KAKAO', 'MANUAL'].includes(String(body.sentVia))) return { ok: false, reason: 'sentVia' };
    payload.sentVia = body.sentVia;
  }
  if (body.dueDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate))) return { ok: false, reason: 'dueDate' };
    payload.dueDate = body.dueDate;
  }
  if (body.smsMessageId !== undefined && body.smsMessageId !== null) {
    const value = text(body.smsMessageId, 120);
    if (value) payload.smsMessageId = value;
  }
  if (body.sendOperationId !== undefined) {
    if (!UUID.test(String(body.sendOperationId))) return { ok: false, reason: 'sendOperationId' };
    payload.sendOperationId = String(body.sendOperationId).toLowerCase();
  }
  return { ok: true, dbAction, payload };
}
