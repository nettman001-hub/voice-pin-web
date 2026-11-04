import { invokeSalesApi } from '../productSalesApi';
import type { ManageSummary } from './manageSummary';

/**
 * 관리탭 서버 쓰기 (sales-api manage-* 액션).
 * 모든 쓰기에 operationId 를 붙인다. 응답을 못 받았으면 같은 operationId 로 다시 보내면 처음 결과가 돌아온다.
 * 관리 쓰기는 온라인에서만 한다 (보관·출고는 두 기기가 같은 상품을 잡지 않도록 서버가 판정).
 */

export type ManageResult = Record<string, unknown> & { ok: true; replayed?: boolean };
type Invoke = <T>(action: string, payload: Record<string, unknown>) => Promise<T>;

export const newOperationId = () => crypto.randomUUID();

export class ManageApi {
  readonly workspaceId: string;
  private readonly invoke: Invoke;

  constructor(workspaceId: string, invoke: Invoke = invokeSalesApi) {
    this.workspaceId = workspaceId;
    this.invoke = invoke;
  }

  private call(action: string, payload: Record<string, unknown>, operationId: string = newOperationId()) {
    return this.invoke<ManageResult>(action, { ...payload, operationId, workspaceId: this.workspaceId });
  }

  linkContact(input: { phone: string; buyerKey: string; nickname: string; source?: 'MANUAL' | 'MESSAGE'; replace?: boolean }) {
    return this.call('manage-contact-link', { ...input, mode: 'LINK' });
  }
  blockContact(input: { phone: string; buyerKey?: string; nickname?: string }) {
    return this.call('manage-contact-link', { ...input, mode: 'BLOCK' });
  }
  unlinkContact(phone: string) {
    return this.call('manage-contact-link', { phone, mode: 'UNLINK' });
  }
  keep(buyerKey: string, saleIds: string[]) {
    return this.call('manage-keep', { buyerKey, saleIds });
  }
  unkeep(saleIds: string[]) {
    return this.call('manage-unkeep', { saleIds });
  }
  cancelItems(input: { buyerKey: string; saleIds: string[]; reason: string; cancelledBy?: 'CUSTOMER' | 'SELLER' }) {
    return this.call('manage-cancel-items', input);
  }
  markRefunded(saleIds: string[]) {
    return this.call('manage-mark-refunded', { saleIds });
  }
  backfillBuyerKeys(buyerKey: string, saleIds: string[]) {
    return this.call('manage-backfill-buyer-keys', { buyerKey, saleIds });
  }
  reserveShipment(input: {
    buyerKey: string; saleIds: string[]; recipientName: string; phone: string; address: string;
    shippingFee: number; feeBasis: number; shippingPaid?: boolean; memo?: string;
  }, operationId?: string) {
    return this.call('manage-shipment-reserve', input, operationId);
  }
  setShipmentStatus(input: {
    shipmentId: string; status: 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'; expectedRevision?: number;
    carrier?: string; trackingNumber?: string;
  }) {
    return this.call('manage-shipment-status', input);
  }
  createInvoice(input: {
    sessionId: string; buyerKey: string; nickname: string; saleIds: string[]; phone: string; address?: string;
    productAmount: number; shippingFee: number; bankAccount: string; dueDate?: string; depositCode?: string;
  }, operationId?: string) {
    return this.call('manage-invoice-create', input, operationId);
  }
  cancelInvoice(invoiceId: string) {
    return this.call('manage-invoice-cancel', { invoiceId });
  }
  /** 관리 홈 숫자를 서버가 세어 준다 (읽기만, operationId 없음). */
  summary(scope: import('./scope').ManageScope) {
    return this.invoke<ManageSummary>('manage-summary', { scope, workspaceId: this.workspaceId });
  }

  /**
   * 정산서를 한 번만 보낸다: 서버 잠금 → 문자 보내기 → 결과 기록.
   * 다른 기기가 보내는 중이거나 이미 보냈으면 서버가 거절하므로 문자가 두 번 나가지 않는다.
   */
  async sendInvoiceOnce(
    invoiceId: string,
    send: () => Promise<{ sent: boolean; smsMessageId?: string | null; error?: string }>,
    options: { resend?: boolean; sentVia?: 'SMS' | 'KAKAO' | 'MANUAL' } = {},
  ) {
    const lease = await this.call('manage-invoice-begin-send', { invoiceId, resend: options.resend === true });
    const sendOperationId = String(lease.sendOperationId);
    let outcome: { sent: boolean; smsMessageId?: string | null; error?: string };
    try {
      outcome = await send();
    } catch (error) {
      outcome = { sent: false, error: error instanceof Error ? error.message : String(error) };
    }
    return this.call('manage-invoice-finish-send', {
      invoiceId, sendOperationId, sent: outcome.sent, smsMessageId: outcome.smsMessageId ?? undefined,
      error: outcome.error, sentVia: options.sentVia || 'SMS',
    });
  }
}
