import type { ContactBook } from './contactLink.ts';

/**
 * 문자·입금 "확인 필요" 목록 (순수 함수).
 * - 입금: 서버가 자동으로 못 붙인 입금 (확인 필요 = 후보 있음, 미확인 = 후보 없음). 금액만 같은 입금은 판매자가 고른다.
 * - 문자: 연결된 구매자가 보낸 최근 문자 (답장할 것), 모르는 번호는 연락처 연결 화면에서 처리.
 */

export interface PaymentForReview {
  id: string;
  payerName: string;
  amount: number;
  paidAt: string;
  matchStatus: string;
  candidateIds?: readonly string[];
  bank?: string;
}

export interface InvoiceForReview {
  id: string;
  sessionId?: string;
  buyerKey?: string;
  kind?: 'ORDER' | 'SHIPPING';
  customerNickname: string;
  amount: number;
  status: string;
  depositCode?: string;
  createdAt: string;
  saleIds: readonly string[];
}

export interface PaymentReviewItem {
  payment: PaymentForReview;
  /** 고를 정산서 (첫 번째가 추천). 확인 필요면 서버 후보, 미확인이면 같은 금액의 열린 정산서. */
  candidates: InvoiceForReview[];
  kind: 'NEEDS_REVIEW' | 'UNMATCHED';
}

const OPEN = new Set(['DRAFT', 'QUEUED', 'SENT']);

/** 회차나 정산서 상태가 바뀌면 이전 선택을 현재 열린 후보에 한해서만 사용한다. */
export function reviewInvoiceSelection(item: PaymentReviewItem, picked?: readonly string[]): string[] {
  const candidates = item.candidates.filter((invoice) => OPEN.has(invoice.status)).map((invoice) => invoice.id);
  if (picked === undefined) return candidates.length > 0 ? [candidates[0]] : [];
  const allowed = new Set(candidates);
  return [...new Set(picked.filter((id) => allowed.has(id)))];
}

export function buildPaymentReview(
  payments: readonly PaymentForReview[],
  invoices: readonly InvoiceForReview[],
  options: { now?: Date; days?: number } = {},
): PaymentReviewItem[] {
  const since = (options.now || new Date()).getTime() - (options.days ?? 30) * 86400000;
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const open = invoices.filter((invoice) => OPEN.has(invoice.status));
  const items: PaymentReviewItem[] = [];
  for (const payment of payments) {
    if (payment.matchStatus === 'MATCHED') continue;
    if (payment.matchStatus !== 'NEEDS_REVIEW' && payment.matchStatus !== 'UNMATCHED') continue;
    if (Date.parse(payment.paidAt) < since) continue;
    let candidates = (payment.candidateIds || []).map((id) => byId.get(id))
      .filter((invoice): invoice is InvoiceForReview => !!invoice && OPEN.has(invoice.status));
    if (candidates.length === 0) {
      candidates = open.filter((invoice) => invoice.amount === payment.amount)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    items.push({ payment, candidates, kind: payment.matchStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'UNMATCHED' });
  }
  return items.sort((a, b) => (a.kind === b.kind ? b.payment.paidAt.localeCompare(a.payment.paidAt) : a.kind === 'NEEDS_REVIEW' ? -1 : 1));
}

export interface InboxMessage {
  id: string;
  phone: string;
  body: string;
  direction: string;
  at: string;
}

export interface BuyerThread {
  phone: string;
  buyerKey?: string;
  nickname?: string;
  lastAt: string;
  lastBody: string;
  incomingCount: number;
}

/** 최근 받은 문자를 번호별로 묶는다. 연결된 번호는 닉네임을 붙인다. */
export function buildBuyerThreads(
  messages: readonly InboxMessage[],
  book: ContactBook,
  options: { now?: Date; days?: number } = {},
): BuyerThread[] {
  const since = (options.now || new Date()).getTime() - (options.days ?? 7) * 86400000;
  const owner = new Map<string, { buyerKey: string; nickname: string }>();
  for (const contact of book.byBuyer.values()) {
    if (contact.state === 'LINKED' && contact.phone) owner.set(contact.phone, { buyerKey: contact.buyerKey, nickname: contact.nickname });
  }
  const threads = new Map<string, BuyerThread>();
  for (const message of messages) {
    if (message.direction !== 'INCOMING') continue;
    if (Date.parse(message.at) < since) continue;
    const phone = message.phone.replace(/\D/g, '');
    if (!phone) continue;
    const current = threads.get(phone);
    if (!current) {
      const who = owner.get(phone);
      threads.set(phone, {
        phone, buyerKey: who?.buyerKey, nickname: who?.nickname, lastAt: message.at, lastBody: message.body, incomingCount: 1,
      });
    } else {
      current.incomingCount += 1;
      if (message.at > current.lastAt) { current.lastAt = message.at; current.lastBody = message.body; }
    }
  }
  return [...threads.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
