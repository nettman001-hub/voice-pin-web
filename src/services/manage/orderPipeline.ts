import type { SaleRecord } from '../../types/live.ts';
import type { InvoiceStatus } from '../../types/commerce.ts';
import type { BuyerShippingOverride, CalculatedShipping, ShippingConfig } from '../../types/shipping.ts';
import { isBillableSale } from '../billableSales.ts';
import { promiseDefaultBuyerKey } from '../promiseDefaultService.ts';
import { normalizeNickname } from '../nicknameMatcher.ts';
import { computeShippingFee } from './shippingFee.ts';
import type { ContactBook, ContactResolution } from './contactLink.ts';

/**
 * 관리 "주문" 흐름 계산 (순수 함수). 회차×구매자 하나가 주문서 하나다.
 *
 * 돈 단계: 연락처 연결 → 청구 전 → 입금 대기 → 결제 완료
 * - 합계는 판매내역과 같은 isBillableSale 규칙 (보류·취소·NOT_SALE 제외, 서버 확인 필요·저장 대기 포함).
 * - 구매자 키는 promiseDefaultBuyerKey 와 같다. 비슷한 닉네임으로 합치지 않는다.
 * - 킵 고객의 회차 정산서는 상품값만 (배송비는 출고 때 한 번). 판매자가 그 회차에 수동 배송비를 정했으면 그것을 따른다.
 */

export type MoneyStage = 'NEEDS_CONTACT' | 'READY_TO_BILL' | 'AWAITING_PAYMENT' | 'PAID';

export const MONEY_STAGE_LABEL: Record<MoneyStage, string> = {
  NEEDS_CONTACT: '연락처 연결',
  READY_TO_BILL: '청구 전',
  AWAITING_PAYMENT: '입금 대기',
  PAID: '결제 완료',
};

export const MONEY_STAGE_ORDER: readonly MoneyStage[] = ['NEEDS_CONTACT', 'READY_TO_BILL', 'AWAITING_PAYMENT', 'PAID'];

export interface OrderInvoiceLike {
  id: string;
  sessionId?: string | null;
  buyerKey?: string | null;
  buyerNickname?: string | null;
  status: InvoiceStatus;
  kind?: 'ORDER' | 'SHIPPING';
  saleIds?: readonly string[] | null;
  createdAt?: string;
}

export interface OrderShipping extends CalculatedShipping {
  /** 킵 고객이라 배송비를 출고 때 받는다 */
  deferredToShipment: boolean;
}

export interface ManageOrder {
  key: string;
  sessionId: string;
  buyerKey: string;
  nickname: string;
  saleIds: string[];
  itemCount: number;
  productAmount: number;
  shipping: OrderShipping;
  totalAmount: number;
  stage: MoneyStage;
  contact?: ContactResolution;
  invoiceId?: string;
  /** 같은 주문에 열린 정산서가 둘 이상 (예전 구조에서 생길 수 있는 결함) */
  duplicateOpenInvoiceIds: string[];
  lastSaleAt: string;
}

export interface BuildOrdersInput {
  sales: readonly SaleRecord[];
  shippingConfig: ShippingConfig;
  contactBook?: ContactBook | null;
  invoices?: readonly OrderInvoiceLike[];
  getOverride?: (nickname: string, sessionId: string) => BuyerShippingOverride | null | undefined;
  /** 보관 중인 상품이 있거나 이번 회차를 킵하기로 한 구매자 */
  keepingBuyerKeys?: ReadonlySet<string>;
  /** 정산서와 별개로 입금이 확인된 판매 (입금확인 매칭 결과) */
  paidSaleIds?: ReadonlySet<string>;
}

export const orderKey = (sessionId: string, buyerKey: string) => `${sessionId}::${buyerKey}`;

export const saleBuyerKey = (sale: Pick<SaleRecord, 'buyerId' | 'buyerNickname'>) =>
  promiseDefaultBuyerKey(sale.buyerId, sale.buyerNickname || '');

const OPEN_STATUSES: ReadonlySet<InvoiceStatus> = new Set(['DRAFT', 'QUEUED', 'SENT']);

export function buildOrders(input: BuildOrdersInput): ManageOrder[] {
  const groups = new Map<string, { sessionId: string; buyerKey: string; sales: SaleRecord[] }>();
  for (const sale of input.sales) {
    if (!isBillableSale(sale)) continue;
    const buyerKey = saleBuyerKey(sale);
    const key = orderKey(sale.sessionId, buyerKey);
    const group = groups.get(key);
    if (group) group.sales.push(sale);
    else groups.set(key, { sessionId: sale.sessionId, buyerKey, sales: [sale] });
  }

  // 정산서를 주문에 붙인다: 판매 id → 구매자 키 → 정규화 닉네임 순서
  const orderBySaleId = new Map<string, string>();
  const ordersBySessionNickname = new Map<string, string[]>();
  for (const [key, group] of groups) {
    for (const sale of group.sales) orderBySaleId.set(sale.id, key);
    const nicknames = new Set(group.sales.map((sale) => normalizeNickname(sale.buyerNickname)));
    for (const nickname of nicknames) {
      const lookup = `${group.sessionId}::${nickname}`;
      ordersBySessionNickname.set(lookup, [...(ordersBySessionNickname.get(lookup) || []), key]);
    }
  }
  const invoicesByOrder = new Map<string, OrderInvoiceLike[]>();
  for (const invoice of input.invoices || []) {
    if (invoice.kind === 'SHIPPING') continue;
    let key = (invoice.saleIds || []).map((id) => orderBySaleId.get(id)).find(Boolean);
    if (!key && invoice.sessionId && invoice.buyerKey && groups.has(orderKey(invoice.sessionId, invoice.buyerKey))) {
      key = orderKey(invoice.sessionId, invoice.buyerKey);
    }
    if (!key && invoice.sessionId && invoice.buyerNickname) {
      const owners = ordersBySessionNickname.get(`${invoice.sessionId}::${normalizeNickname(invoice.buyerNickname)}`) || [];
      if (owners.length === 1) key = owners[0];
    }
    if (!key) continue;
    invoicesByOrder.set(key, [...(invoicesByOrder.get(key) || []), invoice]);
  }

  const orders: ManageOrder[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group.sales].sort((a, b) => a.recognizedAt.localeCompare(b.recognizedAt));
    const nickname = sorted[sorted.length - 1].buyerNickname.trim();
    const productAmount = sorted.reduce((total, sale) => total + (Number(sale.amount) || 0), 0);
    const override = input.getOverride?.(nickname, group.sessionId) ?? null;
    const keeping = input.keepingBuyerKeys?.has(group.buyerKey) ?? false;
    let shipping: OrderShipping;
    if (keeping && override?.mode !== 'MANUAL') {
      shipping = {
        fee: 0, isFree: true, isManual: false, originalAutoFee: 0, deferredToShipment: true,
        reason: '킵 고객: 배송비는 출고 때 한 번',
      };
    } else {
      shipping = { ...computeShippingFee(productAmount, input.shippingConfig, override), deferredToShipment: false };
    }

    const invoices = invoicesByOrder.get(key) || [];
    const open = invoices.filter((invoice) => OPEN_STATUSES.has(invoice.status))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const paidInvoice = invoices.find((invoice) => invoice.status === 'PAID');
    const sentInvoice = open.find((invoice) => invoice.status === 'SENT' || invoice.status === 'QUEUED');
    const contact = input.contactBook?.byBuyer.get(group.buyerKey);
    const allPaidBySaleMatch = !!input.paidSaleIds && sorted.every((sale) => input.paidSaleIds!.has(sale.id));

    let stage: MoneyStage;
    if (paidInvoice || allPaidBySaleMatch) stage = 'PAID';
    else if (sentInvoice) stage = 'AWAITING_PAYMENT';
    else if (contact?.state !== 'LINKED') stage = 'NEEDS_CONTACT';
    else stage = 'READY_TO_BILL';

    orders.push({
      key,
      sessionId: group.sessionId,
      buyerKey: group.buyerKey,
      nickname,
      saleIds: sorted.map((sale) => sale.id),
      itemCount: sorted.reduce((total, sale) => total + Math.max(1, Number(sale.quantity) || 1), 0),
      productAmount,
      shipping,
      totalAmount: productAmount + shipping.fee,
      stage,
      contact,
      invoiceId: (paidInvoice || sentInvoice || open[0])?.id,
      duplicateOpenInvoiceIds: open.length > 1 ? open.map((invoice) => invoice.id) : [],
      lastSaleAt: sorted[sorted.length - 1].recognizedAt,
    });
  }
  return orders.sort((a, b) => b.lastSaleAt.localeCompare(a.lastSaleAt) || a.key.localeCompare(b.key));
}

export interface StageSummary {
  stage: MoneyStage;
  label: string;
  orderCount: number;
  amount: number;
}

/** 홈 카드용 단계별 건수·금액 (금액 = 상품값 + 그 단계의 배송비) */
export function summarizeStages(orders: readonly ManageOrder[]): StageSummary[] {
  return MONEY_STAGE_ORDER.map((stage) => {
    const inStage = orders.filter((order) => order.stage === stage);
    return {
      stage, label: MONEY_STAGE_LABEL[stage], orderCount: inStage.length,
      amount: inStage.reduce((total, order) => total + order.totalAmount, 0),
    };
  });
}

/** 판매내역 화면과 같은 기준의 상품 합계 (배송비 제외) */
export const ordersProductTotal = (orders: readonly ManageOrder[]) =>
  orders.reduce((total, order) => total + order.productAmount, 0);
