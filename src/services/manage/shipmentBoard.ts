import type { SaleRecord } from '../../types/live.ts';
import type { BuyerShippingOverride, ShippingConfig } from '../../types/shipping.ts';
import { isBillableSale } from '../billableSales.ts';
import { saleBuyerKey } from './orderPipeline.ts';
import { goodsStateOf, planShipment, type FulfillmentItemRecord, type GoodsState, type ShipmentPlan } from './fulfillment.ts';
import { inManagePeriod } from './period.ts';

/**
 * 출고 화면 계산 (순수 함수).
 * - 출고할 고객: 결제된 새 상품이 있는 고객 (보관 상품도 함께 나간다)
 * - 보관만 있는 고객: 판매자가 정할 때까지 기다린다 (자동 출고 없음)
 * - 진행 중 출고: 예약 → 포장 → 발송 → 배송 완료
 */

export interface ShipmentLike {
  id: string;
  saleIds: readonly string[];
  recipientName: string;
  phoneNumber: string;
  address: string;
  carrier: string;
  trackingNumber: string;
  status: string;
  createdAt: string;
  shippedAt?: string;
  buyerKey?: string | null;
  shippingFee?: number | null;
  revision?: number | null;
}

export interface InvoiceForShipping {
  status: string;
  saleIds: readonly string[];
  amount: number;
  phoneNumber?: string;
  address?: string;
  customerNickname?: string;
  createdAt?: string;
}

export interface ClaimForShipping {
  saleIds: readonly string[];
  phoneNumber?: string;
  address?: string;
  nickname?: string;
  createdAt?: string;
}

export interface ShipBuyer {
  buyerKey: string;
  nickname: string;
  plan: ShipmentPlan;
  /** 새로 결제된 상품이 있는지 (없으면 보관만 있는 고객) */
  hasNewPaid: boolean;
  phone: string;
  address: string;
  recipientName: string;
  /** 오래 보관 중인 상품의 가장 이른 날 */
  oldestKeptAt?: string;
}

export interface ShipmentCard {
  shipment: ShipmentLike;
  nickname: string;
  itemCount: number;
  productAmount: number;
}

export interface ShipmentBoard {
  ready: ShipBuyer[];
  keptOnly: ShipBuyer[];
  active: ShipmentCard[];
  done: ShipmentCard[];
  /** 고객이 취소했는데 이미 결제된 상품 (환불한 뒤 [환불했음]) */
  refundNeeded: Array<{ saleId: string; nickname: string; productName: string; amount: number; sessionId: string }>;
}

export interface ShipmentBoardInput {
  sales: readonly SaleRecord[];
  paidSaleIds: ReadonlySet<string>;
  items: ReadonlyMap<string, FulfillmentItemRecord>;
  shipments: readonly ShipmentLike[];
  invoices: readonly InvoiceForShipping[];
  claims?: readonly ClaimForShipping[];
  contactPhones?: ReadonlyMap<string, string>;
  shippingConfig: ShippingConfig;
  getOverride?: (nickname: string, sessionId: string) => BuyerShippingOverride | null | undefined;
  /** 끝난 출고(발송·배송 완료·취소)를 며칠까지 보여 줄지 */
  doneDays?: number;
  now?: Date;
  /** 표시할 상품의 판매 기간. 출고 예약에 쓰는 합배송 계획은 전체 기간으로 유지한다. */
  periodDays?: number;
  selectedSessionIds?: ReadonlySet<string>;
}

const ACTIVE = new Set(['RESERVED', 'READY', 'PACKED']);
const DONE = new Set(['SHIPPED', 'DELIVERED', 'CANCELLED']);

/** 이미 회차 정산서로 받은 배송비: 결제된 정산서 금액 − 그 정산서 상품값 (출고에 들어가는 상품의 정산서만) */
export function shippingAlreadyCharged(
  saleIds: readonly string[],
  invoices: readonly InvoiceForShipping[],
  amountOf: (saleId: string) => number,
): number {
  const wanted = new Set(saleIds);
  let total = 0;
  for (const invoice of invoices) {
    if (invoice.status !== 'PAID') continue;
    if (!invoice.saleIds.some((id) => wanted.has(id))) continue;
    const products = invoice.saleIds.reduce((sum, id) => sum + amountOf(id), 0);
    total += Math.max(0, (Number(invoice.amount) || 0) - products);
  }
  return total;
}

export function buildShipmentBoard(input: ShipmentBoardInput): ShipmentBoard {
  const billable = input.sales.filter(isBillableSale);
  const saleById = new Map(billable.map((sale) => [sale.id, sale]));
  const amountOf = (id: string) => Number(saleById.get(id)?.amount) || 0;

  const buyers = new Map<string, { nickname: string; states: GoodsState[]; saleIds: string[] }>();
  for (const sale of billable) {
    const state = goodsStateOf(input.paidSaleIds.has(sale.id), input.items.get(sale.id));
    if (state !== 'READY_TO_SHIP' && state !== 'KEPT') continue;
    const buyerKey = saleBuyerKey(sale);
    const current = buyers.get(buyerKey) || { nickname: sale.buyerNickname.trim(), states: [], saleIds: [] };
    current.states.push(state);
    current.saleIds.push(sale.id);
    current.nickname = sale.buyerNickname.trim() || current.nickname;
    buyers.set(buyerKey, current);
  }

  const latest = <T extends { saleIds: readonly string[]; createdAt?: string }>(rows: readonly T[], saleIds: Set<string>) =>
    rows.filter((row) => row.saleIds.some((id) => saleIds.has(id)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const ready: ShipBuyer[] = [];
  const keptOnly: ShipBuyer[] = [];
  for (const [buyerKey, buyer] of buyers) {
    const buyerSaleIds = new Set(billable.filter((sale) => saleBuyerKey(sale) === buyerKey).map((sale) => sale.id));
    const plan0 = planShipment({
      buyerKey, sales: billable, paidSaleIds: input.paidSaleIds, items: input.items, shippingConfig: input.shippingConfig,
      getOverride: input.getOverride,
    });
    const charged = shippingAlreadyCharged(plan0.newSaleIds, input.invoices, amountOf);
    const plan = charged > 0 ? { ...plan0, feeDue: Math.max(0, plan0.shipping.fee - charged) } : plan0;
    if (!plan.canReserve) continue;
    const invoice = latest(input.invoices.filter((row) => row.status !== 'CANCELLED'), buyerSaleIds)[0];
    const claim = latest(input.claims || [], buyerSaleIds).find((row) => row.address?.trim());
    const keptDates = plan.keptSaleIds.map((id) => input.items.get(id)?.keptAt || saleById.get(id)?.recognizedAt || '')
      .filter(Boolean).sort();
    const entry: ShipBuyer = {
      buyerKey,
      nickname: buyer.nickname,
      plan,
      hasNewPaid: plan.newSaleIds.length > 0,
      phone: (input.contactPhones?.get(buyerKey) || invoice?.phoneNumber || claim?.phoneNumber || '').replace(/\D/g, ''),
      address: (claim?.address || invoice?.address || '').trim(),
      recipientName: (claim?.nickname || buyer.nickname).trim(),
      oldestKeptAt: keptDates[0],
    };
    (entry.hasNewPaid ? ready : keptOnly).push(entry);
  }
  ready.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  keptOnly.sort((a, b) => String(a.oldestKeptAt).localeCompare(String(b.oldestKeptAt)) || a.nickname.localeCompare(b.nickname, 'ko'));

  const now = (input.now || new Date()).getTime();
  const doneSince = now - (input.doneDays ?? 14) * 86400000;
  const card = (shipment: ShipmentLike): ShipmentCard => {
    const first = shipment.saleIds.map((id) => saleById.get(id)).find(Boolean);
    return {
      shipment,
      nickname: first?.buyerNickname.trim() || shipment.recipientName,
      itemCount: shipment.saleIds.length,
      productAmount: shipment.saleIds.reduce((sum, id) => sum + amountOf(id), 0),
    };
  };
  const active = input.shipments.filter((row) => ACTIVE.has(row.status)).map(card)
    .sort((a, b) => a.shipment.createdAt.localeCompare(b.shipment.createdAt));
  const done = input.shipments
    .filter((row) => DONE.has(row.status) && Date.parse(row.shippedAt || row.createdAt) >= doneSince).map(card)
    .sort((a, b) => b.shipment.createdAt.localeCompare(a.shipment.createdAt));
  const refundNeeded = billable
    .filter((sale) => goodsStateOf(input.paidSaleIds.has(sale.id), input.items.get(sale.id)) === 'REFUND_NEEDED')
    .map((sale) => ({
      saleId: sale.id, nickname: sale.buyerNickname.trim(), productName: sale.productName || sale.productCode || '상품',
      amount: Number(sale.amount) || 0, sessionId: sale.sessionId,
    }));
  if (input.periodDays === undefined && !input.selectedSessionIds) return { ready, keptOnly, active, done, refundNeeded };
  const visibleIds = new Set(billable.filter((sale) => input.selectedSessionIds
    ? input.selectedSessionIds.has(sale.sessionId)
    : inManagePeriod(sale.recognizedAt, input.periodDays!, input.now || new Date())).map((sale) => sale.id));
  const includesVisible = (ids: readonly string[]) => ids.some((id) => visibleIds.has(id));
  return {
    ready: ready.filter((buyer) => includesVisible(buyer.plan.newSaleIds)),
    keptOnly: [...keptOnly, ...ready].filter((buyer) => includesVisible(buyer.plan.keptSaleIds)),
    active: active.filter((card) => includesVisible(card.shipment.saleIds)),
    done: done.filter((card) => includesVisible(card.shipment.saleIds)),
    refundNeeded: refundNeeded.filter((item) => visibleIds.has(item.saleId)),
  };
}

/** 다음에 누를 수 있는 단계 (서버 shipment-status 규칙과 같음) */
export function nextShipmentSteps(status: string): Array<'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'> {
  if (status === 'RESERVED' || status === 'READY') return ['PACKED', 'CANCELLED'];
  if (status === 'PACKED') return ['SHIPPED', 'CANCELLED'];
  if (status === 'SHIPPED') return ['DELIVERED'];
  return [];
}

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  RESERVED: '출고 예약', READY: '발송 대기', PACKED: '포장 완료', SHIPPED: '발송', DELIVERED: '배송 완료', CANCELLED: '취소',
};

export function shippingNoticeText(recipientName: string, carrier: string, trackingNumber: string): string {
  return `[VoiceCAP 배송안내]\n${recipientName}님 상품이 발송되었습니다.\n${carrier} ${trackingNumber}`;
}
