import type { ManageOrder } from './orderPipeline.ts';
import { INVOICE_FORM_ERROR_TEXT, invoiceCreateRequest, invoiceSmsBody, validateInvoiceForm, type InvoiceForm } from './orderInvoice.ts';

/**
 * 주문 하나의 정산서 만들기 + 한 번만 보내기, 그리고 여러 주문 일괄 처리 (결과 집계).
 * 화면(주문 상세, 주문 목록 일괄)이 같은 함수를 쓴다.
 */

export interface InvoiceLite {
  id: string;
  status: string;
  phoneNumber: string;
  saleIds: readonly string[];
  bankAccount: string;
  dueDate: string;
  depositCode?: string;
}

export interface SenderApi {
  createInvoice(input: ReturnType<typeof invoiceCreateRequest>): Promise<Record<string, unknown>>;
  sendInvoiceOnce(
    invoiceId: string,
    send: () => Promise<{ sent: boolean; smsMessageId?: string | null; error?: string }>,
    options?: { resend?: boolean },
  ): Promise<Record<string, unknown>>;
}

export type SmsSender = (phone: string, body: string, saleIds: string[]) => Promise<{ status: string; id: string; error?: string }>;

export type SendOutcome =
  | { status: 'SENT' }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function sendOrderInvoice(input: {
  api: SenderApi;
  order: ManageOrder;
  form: InvoiceForm;
  invoicesById: ReadonlyMap<string, InvoiceLite>;
  sendSms: SmsSender;
}): Promise<SendOutcome> {
  const { api, order, form } = input;
  const invalid = validateInvoiceForm(order, form);
  if (invalid) return { status: 'SKIPPED', reason: INVOICE_FORM_ERROR_TEXT[invalid] };
  const created = await api.createInvoice(invoiceCreateRequest(order, form));
  const invoiceId = String(created.invoiceId);
  if (created.existing && created.status !== 'DRAFT') return { status: 'SKIPPED', reason: '이미 보낸 정산서가 있습니다' };
  const known = input.invoicesById.get(invoiceId);
  // 다른 기기가 만든 정산서를 아직 못 받았으면 그 입금코드를 모르므로 보내지 않는다.
  if (created.existing && !known) return { status: 'SKIPPED', reason: '이미 만든 정산서가 있어 잠시 뒤 다시 보내야 합니다' };
  const target: InvoiceLite = known || {
    id: invoiceId, status: 'DRAFT', phoneNumber: form.phone.replace(/\D/g, ''), saleIds: order.saleIds,
    bankAccount: form.bankAccount.trim(), dueDate: form.dueDate, depositCode: form.depositCode,
  };
  const body = invoiceSmsBody({
    nickname: order.nickname, productAmount: order.productAmount, shippingFee: order.shipping.fee,
    deferredShipping: order.shipping.deferredToShipment, itemCount: order.itemCount,
    bankAccount: target.bankAccount, dueDate: target.dueDate, depositCode: target.depositCode,
  });
  const result = await api.sendInvoiceOnce(invoiceId, async () => {
    const sms = await input.sendSms(target.phoneNumber, body, [...target.saleIds]);
    return sms.status === 'FAILED' ? { sent: false, error: sms.error || '문자 보내기 실패' } : { sent: true, smsMessageId: sms.id };
  });
  if (result.sendError) return { status: 'FAILED', reason: String(result.sendError) };
  return { status: 'SENT' };
}

export interface BulkResult<T> {
  sent: T[];
  failed: Array<{ item: T; reason: string }>;
  skipped: Array<{ item: T; reason: string }>;
}

/** 하나씩 차례로 처리하고 결과를 모은다. 보냄 + 실패 + 건너뜀 = 선택 수. 하나가 실패해도 나머지는 계속한다. */
export async function runBulk<T>(
  items: readonly T[],
  worker: (item: T) => Promise<SendOutcome>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { sent: [], failed: [], skipped: [] };
  let done = 0;
  for (const item of items) {
    try {
      const outcome = await worker(item);
      if (outcome.status === 'SENT') result.sent.push(item);
      else if (outcome.status === 'SKIPPED') result.skipped.push({ item, reason: outcome.reason });
      else result.failed.push({ item, reason: outcome.reason });
    } catch (error) {
      result.failed.push({ item, reason: error instanceof Error ? error.message : String(error) });
    }
    done += 1;
    onProgress?.(done, items.length);
  }
  return result;
}

export const bulkSummary = (result: BulkResult<unknown>) =>
  `보냄 ${result.sent.length} · 실패 ${result.failed.length} · 건너뜀 ${result.skipped.length}`;
