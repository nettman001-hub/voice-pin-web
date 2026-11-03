import type { ManageOrder } from './orderPipeline.ts';

/**
 * 주문서 → 정산서 (순수 함수).
 * 정산서는 회차×구매자마다 하나. 서버(voicecap_manage invoice-create)가 열린 정산서가 있으면 그것을 돌려준다.
 * 킵 고객은 상품값만 청구한다 (배송비는 출고 때 한 번).
 */

export const INVOICE_BANK_ACCOUNT_KEY = 'voicecap_invoice_bank_account';
export const DEFAULT_DUE_DAYS = 3;

export interface InvoiceForm {
  phone: string;
  bankAccount: string;
  dueDate: string;
  depositCode: string;
  address?: string;
}

export interface InvoiceSmsInput {
  nickname: string;
  productAmount: number;
  shippingFee: number;
  deferredShipping: boolean;
  itemCount: number;
  bankAccount: string;
  dueDate: string;
  depositCode?: string | null;
}

const won = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString('ko-KR')}원`;

export function invoiceSmsBody(input: InvoiceSmsInput): string {
  const total = input.productAmount + input.shippingFee;
  const shippingLine = input.deferredShipping
    ? '배송비: 보관 상품과 함께 보낼 때 한 번 받습니다'
    : `배송비: ${input.shippingFee > 0 ? won(input.shippingFee) : '무료'}`;
  return [
    '[VoiceCAP 정산서]',
    `고객: ${input.nickname}`,
    `상품 ${input.itemCount}개: ${won(input.productAmount)}`,
    shippingLine,
    `청구금액: ${won(total)}`,
    `입금계좌: ${input.bankAccount}`,
    `입금기한: ${input.dueDate}`,
    input.depositCode
      ? `입금자명을 "${input.nickname}" 또는 "${input.depositCode}"로 적어 주세요.`
      : `입금자명을 "${input.nickname}"로 적어 주세요.`,
  ].join('\n');
}

export function defaultDueDate(now: Date, days = DEFAULT_DUE_DAYS): string {
  const due = new Date(now.getTime() + days * 86400000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}

export type InvoiceFormError = 'NO_CONTACT' | 'NO_PHONE' | 'NO_BANK' | 'BAD_DUE_DATE' | 'NO_ITEMS' | null;

export const INVOICE_FORM_ERROR_TEXT: Record<Exclude<InvoiceFormError, null>, string> = {
  NO_CONTACT: '연락처를 먼저 연결해 주세요.',
  NO_PHONE: '받을 휴대폰 번호가 없습니다.',
  NO_BANK: '입금계좌를 적어 주세요.',
  BAD_DUE_DATE: '입금기한 날짜를 확인해 주세요.',
  NO_ITEMS: '청구할 상품이 없습니다.',
};

export function validateInvoiceForm(order: Pick<ManageOrder, 'saleIds' | 'contact'>, form: InvoiceForm): InvoiceFormError {
  if (order.saleIds.length === 0) return 'NO_ITEMS';
  if (order.contact?.state !== 'LINKED') return 'NO_CONTACT';
  if (form.phone.replace(/\D/g, '').length < 10) return 'NO_PHONE';
  if (!form.bankAccount.trim()) return 'NO_BANK';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) || Number.isNaN(Date.parse(form.dueDate))) return 'BAD_DUE_DATE';
  return null;
}

/** manageApi.createInvoice 에 넘길 값 */
export function invoiceCreateRequest(order: ManageOrder, form: InvoiceForm) {
  return {
    sessionId: order.sessionId,
    buyerKey: order.buyerKey,
    nickname: order.nickname,
    saleIds: [...order.saleIds],
    phone: form.phone.replace(/\D/g, ''),
    address: form.address || '',
    productAmount: order.productAmount,
    shippingFee: order.shipping.fee,
    bankAccount: form.bankAccount.trim(),
    dueDate: form.dueDate,
    depositCode: form.depositCode,
  };
}

/** 주문 화면 주소용 키 (회차::구매자키 에 콜론이 들어 있어 인코딩한다) */
export const orderPath = (orderKey: string) => `/manage/orders/${encodeURIComponent(orderKey)}`;
