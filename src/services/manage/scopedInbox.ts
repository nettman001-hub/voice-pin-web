import type { SaleRecord } from '../../types/live.ts';
import { normalizePhone, type ContactBook } from './contactLink.ts';

export interface ScopedInboxInvoice {
  id: string;
  sessionId?: string | null;
  saleIds?: readonly string[] | null;
}

export interface ScopedInboxPayment {
  id?: string;
  saleIds?: readonly string[] | null;
  invoiceId?: string | null;
  invoiceIds?: readonly string[] | null;
  candidateIds?: readonly string[] | null;
}

export interface ScopedInboxMessage {
  id?: string;
  phoneNumber?: string | null;
  phone?: string | null;
  saleIds?: readonly string[] | null;
}

export interface ScopedInboxInput<Payment extends ScopedInboxPayment, Message extends ScopedInboxMessage> {
  /** 선택 회차 밖의 정확한 연결도 구분할 수 있도록 전체 판매를 받는다. */
  sales: readonly Pick<SaleRecord, 'id' | 'sessionId'>[];
  selectedSessionIds: ReadonlySet<string>;
  invoices: readonly ScopedInboxInvoice[];
  payments: readonly Payment[];
  messages: readonly Message[];
  /** 선택 회차 구매자들로 만든 연락처 장부. */
  contactBook: ContactBook;
  allSessions: boolean;
}

export interface ScopedInbox<Payment, Message> {
  payments: Payment[];
  unassignedPayments: Payment[];
  messages: Message[];
  unassignedMessages: Message[];
}

/**
 * 입금은 판매·정산서 연결로, 문자는 판매 연결 또는 구매자 연락처로 범위를 정한다.
 * 방송 종료 뒤의 입금·문자도 처리해야 하므로 수신 시각으로 자르지 않는다.
 * 전화번호로 포함한 문자는 구매자 연결이며, 특정 회차의 문자로 확정한 것은 아니다.
 */
export function scopeManageInbox<Payment extends ScopedInboxPayment, Message extends ScopedInboxMessage>(
  input: ScopedInboxInput<Payment, Message>,
): ScopedInbox<Payment, Message> {
  if (input.allSessions) {
    return {
      payments: [...input.payments], unassignedPayments: [],
      messages: [...input.messages], unassignedMessages: [],
    };
  }

  const knownSaleIds = new Set(input.sales.map((sale) => sale.id));
  const selectedSaleIds = new Set(input.sales
    .filter((sale) => input.selectedSessionIds.has(sale.sessionId)).map((sale) => sale.id));
  const assignedInvoiceIds = new Set(input.invoices.filter((invoice) => invoice.sessionId
    || (invoice.saleIds || []).some((id) => knownSaleIds.has(id))).map((invoice) => invoice.id));
  const selectedInvoiceIds = new Set(input.invoices.filter((invoice) =>
    (invoice.sessionId && input.selectedSessionIds.has(invoice.sessionId))
    || (invoice.saleIds || []).some((id) => selectedSaleIds.has(id))).map((invoice) => invoice.id));
  const selectedPhones = new Set<string>();
  for (const contact of input.contactBook.byBuyer.values()) {
    const phone = normalizePhone(contact.phone);
    if (contact.state === 'LINKED' && phone) selectedPhones.add(phone);
  }

  const payments: Payment[] = [];
  const unassignedPayments: Payment[] = [];
  for (const payment of input.payments) {
    const saleIds = payment.saleIds || [];
    const invoiceIds = [...(payment.invoiceIds || []), ...(payment.invoiceId ? [payment.invoiceId] : [])];
    const linkedHere = saleIds.some((id) => selectedSaleIds.has(id))
      || invoiceIds.some((id) => selectedInvoiceIds.has(id));
    if (linkedHere) {
      payments.push(payment);
      continue;
    }
    // 다른 회차로 정확히 연결돼 있으면 후보나 입금자명으로 다시 붙이지 않는다.
    const linkedElsewhere = saleIds.some((id) => knownSaleIds.has(id))
      || invoiceIds.some((id) => assignedInvoiceIds.has(id));
    if (linkedElsewhere) continue;

    const candidateIds = payment.candidateIds || [];
    if (candidateIds.some((id) => selectedInvoiceIds.has(id))) {
      // 검토 후보일 뿐이다. matchStatus 등 원본을 그대로 유지한다.
      payments.push(payment);
    } else if (!candidateIds.some((id) => assignedInvoiceIds.has(id))) {
      unassignedPayments.push(payment);
    }
  }

  const messages: Message[] = [];
  const unassignedMessages: Message[] = [];
  for (const message of input.messages) {
    const saleIds = message.saleIds || [];
    if (saleIds.some((id) => selectedSaleIds.has(id))) {
      messages.push(message);
      continue;
    }
    if (saleIds.some((id) => knownSaleIds.has(id))) continue;
    const phone = normalizePhone(message.phoneNumber || message.phone);
    if (phone && selectedPhones.has(phone)) messages.push(message);
    else unassignedMessages.push(message);
  }

  return { payments, unassignedPayments, messages, unassignedMessages };
}
