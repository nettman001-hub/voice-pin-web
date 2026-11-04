import type { SaleRecord } from '../../types/live.ts';
import type { BuyerShippingOverride, ShippingConfig } from '../../types/shipping.ts';
import { isBillableSale } from '../billableSales.ts';
import { buildContactBook, type ContactBook, type ContactLinkRecord, type ContactMessage } from './contactLink.ts';
import { buildOrders, ordersProductTotal, saleBuyerKey, summarizeStages, type ManageOrder, type OrderInvoiceLike, type StageSummary } from './orderPipeline.ts';
import {
  goodsStateOf, keepingAlerts, planShipment,
  type FulfillmentItemRecord, type KeepingAlert, type KeepingAlertDays,
} from './fulfillment.ts';
import { buildManageTodos, type ManageTodo } from './todos.ts';
import { inManagePeriod } from './period.ts';

/**
 * 관리 홈 한 장에 필요한 값 (순수 함수).
 * 숫자 3개(판매액·입금·남은 입금), 돈 4칸, 물건 4칸, 할 일, 보관 카드.
 */

export interface PaymentLike { saleIds: readonly string[]; matchStatus: string; paidAt?: string }

export interface DashboardInput {
  sales: readonly SaleRecord[];
  invoices: readonly (OrderInvoiceLike & { saleIds?: readonly string[] | null })[];
  payments: readonly PaymentLike[];
  messages: readonly ContactMessage[];
  contactLinks: readonly ContactLinkRecord[];
  fulfillmentItems: readonly FulfillmentItemRecord[];
  shippingConfig: ShippingConfig;
  getOverride?: (nickname: string, sessionId: string) => BuyerShippingOverride | null | undefined;
  alertDays: KeepingAlertDays;
  now: Date;
  /** 판매·돈·물건을 볼 기간 (판매일 기준). 0 이면 전체. */
  periodDays: number;
}

export interface GoodsSummary {
  readyToShip: number;
  kept: number;
  inProgress: number;
  refundNeeded: number;
  readyToShipBuyers: number;
}

export interface ManageDashboard {
  salesAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  orderCount: number;
  sessionCount: number;
  buyerCount: number;
  stages: StageSummary[];
  goods: GoodsSummary;
  todos: ManageTodo[];
  keeping: { buyers: number; items: number; amount: number; warn: number; alert: number; top: KeepingAlert[] };
  orders: ManageOrder[];
  contactBook: ContactBook;
  contactMessages: readonly ContactMessage[];
  paidSaleIds: ReadonlySet<string>;
  fulfillmentItems: ReadonlyMap<string, FulfillmentItemRecord>;
}

export function paidSaleIdsOf(
  payments: readonly PaymentLike[],
  invoices: readonly { status: string; saleIds?: readonly string[] | null }[],
): Set<string> {
  const paid = new Set<string>();
  for (const payment of payments) if (payment.matchStatus === 'MATCHED') for (const id of payment.saleIds) paid.add(id);
  for (const invoice of invoices) if (invoice.status === 'PAID') for (const id of invoice.saleIds || []) paid.add(id);
  return paid;
}

export function buildManageDashboard(input: DashboardInput): ManageDashboard {
  const inPeriod = input.sales.filter((sale) => inManagePeriod(sale.recognizedAt, input.periodDays, input.now));
  const paidSaleIds = paidSaleIdsOf(input.payments, input.invoices);
  const items = new Map(input.fulfillmentItems.map((item) => [item.saleId, item]));
  const keepingBuyerKeys = new Set<string>();
  for (const sale of input.sales) if (items.get(sale.id)?.state === 'KEPT') keepingBuyerKeys.add(saleBuyerKey(sale));

  const buyers = new Map<string, { buyerKey: string; nickname: string }>();
  for (const sale of inPeriod) {
    if (!isBillableSale(sale)) continue;
    const buyerKey = saleBuyerKey(sale);
    buyers.set(buyerKey, { buyerKey, nickname: sale.buyerNickname.trim() });
  }
  const contactBook = buildContactBook([...buyers.values()], input.contactLinks, input.messages);
  const orders = buildOrders({
    sales: inPeriod, shippingConfig: input.shippingConfig, contactBook, invoices: input.invoices,
    getOverride: input.getOverride, keepingBuyerKeys, paidSaleIds,
    cancelledSaleIds: new Set(input.fulfillmentItems.filter((item) => item.state === 'CANCELLED').map((item) => item.saleId)),
  });

  let paidAmount = 0;
  let unpaidAmount = 0;
  for (const order of orders) {
    if (order.stage === 'PAID') paidAmount += order.totalAmount;
    else unpaidAmount += order.totalAmount;
  }

  // 표시할 물건은 선택 기간, 합배송 계산은 전체 판매를 사용한다.
  const goods: GoodsSummary = { readyToShip: 0, kept: 0, inProgress: 0, refundNeeded: 0, readyToShipBuyers: 0 };
  const shipBuyers = new Set<string>();
  const allBillable = input.sales.filter(isBillableSale);
  const billable = inPeriod.filter(isBillableSale);
  for (const sale of billable) {
    const state = goodsStateOf(paidSaleIds.has(sale.id), items.get(sale.id));
    if (state === 'READY_TO_SHIP') { goods.readyToShip += 1; shipBuyers.add(saleBuyerKey(sale)); }
    else if (state === 'KEPT') goods.kept += 1;
    else if (state === 'RESERVED' || state === 'PACKED') goods.inProgress += 1;
    else if (state === 'REFUND_NEEDED') goods.refundNeeded += 1;
  }
  // 출고할 구매자: 보관 상품이 있어도 새로 결제된 상품이 있으면 출고 대상 (보관만 있는 구매자는 판매자가 정할 때까지 기다림)
  for (const buyerKey of shipBuyers) {
    const plan = planShipment({ buyerKey, sales: allBillable, paidSaleIds, items, shippingConfig: input.shippingConfig });
    if (plan.canReserve && plan.conflicts.length === 0) goods.readyToShipBuyers += 1;
  }

  const alerts = keepingAlerts(inPeriod, items, input.now, input.alertDays);
  const todos = buildManageTodos({
    orders, contactBook, keepingAlerts: alerts,
    readyToShipBuyerCount: goods.readyToShipBuyers, refundNeededCount: goods.refundNeeded,
    paymentReviewCount: input.payments.filter((payment) =>
      (payment.matchStatus === 'NEEDS_REVIEW' || payment.matchStatus === 'UNMATCHED')
      && (!payment.paidAt || inManagePeriod(payment.paidAt, input.periodDays, input.now))).length,
  });

  return {
    salesAmount: ordersProductTotal(orders),
    paidAmount,
    unpaidAmount,
    orderCount: orders.length,
    sessionCount: new Set(orders.map((order) => order.sessionId)).size,
    buyerCount: new Set(orders.map((order) => order.buyerKey)).size,
    stages: summarizeStages(orders),
    goods,
    todos,
    keeping: {
      buyers: alerts.length,
      items: alerts.reduce((total, alert) => total + alert.itemCount, 0),
      amount: alerts.reduce((total, alert) => total + alert.keptAmount, 0),
      warn: alerts.filter((alert) => alert.level === 'WARN').length,
      alert: alerts.filter((alert) => alert.level === 'ALERT').length,
      top: alerts.slice(0, 3),
    },
    orders,
    contactBook,
    contactMessages: input.messages,
    paidSaleIds,
    fulfillmentItems: items,
  };
}
