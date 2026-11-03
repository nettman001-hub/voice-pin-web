import type { SaleRecord } from '../../types/live.ts';
import type { BuyerShippingOverride, CalculatedShipping, ShippingConfig } from '../../types/shipping.ts';
import { isBillableSale } from '../billableSales.ts';
import { computeShippingFee } from './shippingFee.ts';
import { saleBuyerKey } from './orderPipeline.ts';

/**
 * 관리 "상품" 흐름 계산 (순수 함수). 판매 한 건마다 상태가 하나다.
 *
 * 결제 전 → 발송 대기 / 보관 중 → 출고 예약 → 포장 → 발송 → 배송 완료, 고객 취소 후 결제됐으면 환불 필요.
 * 사용자 규칙 (2026-11-02):
 * - 보관(킵)은 결제된 상품만. 결제 전에는 보관할 수 없다.
 * - 출고는 보관 중인 상품 전체 + 결제된 새 상품. 고르지 않는다. 고객이 취소한 것만 빠진다.
 * - 결제 안 된 상품은 출고에 넣지 않는다.
 * - 다른 출고에 이미 예약·포장된 상품은 다시 넣지 않는다 (두 기기 동시 출고 방지는 서버가 최종 판단).
 * - 오래 보관해도 자동 출고하지 않고 알림만. 알림 일수는 판매자가 정한다 (처음 값 14일·30일).
 */

export type FulfillmentState = 'KEPT' | 'RESERVED' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface FulfillmentItemRecord {
  saleId: string;
  buyerKey?: string | null;
  state: FulfillmentState;
  keptAt?: string | null;
  shipmentId?: string | null;
  cancelledBy?: 'CUSTOMER' | 'SELLER' | null;
  refunded?: boolean;
}

export type GoodsState =
  | 'UNPAID' | 'READY_TO_SHIP' | 'KEPT' | 'RESERVED' | 'PACKED' | 'SHIPPED' | 'DELIVERED'
  | 'REFUND_NEEDED' | 'CANCELLED';

export const GOODS_STATE_LABEL: Record<GoodsState, string> = {
  UNPAID: '결제 전',
  READY_TO_SHIP: '발송 대기',
  KEPT: '보관 중',
  RESERVED: '출고 예약',
  PACKED: '포장',
  SHIPPED: '발송',
  DELIVERED: '배송 완료',
  REFUND_NEEDED: '환불 필요',
  CANCELLED: '취소',
};

export function goodsStateOf(paid: boolean, item?: FulfillmentItemRecord | null): GoodsState {
  if (item?.state === 'CANCELLED') return paid && !item.refunded ? 'REFUND_NEEDED' : 'CANCELLED';
  if (!paid) return 'UNPAID';
  if (!item) return 'READY_TO_SHIP';
  return item.state;
}

export function canKeep(paid: boolean, item?: FulfillmentItemRecord | null): { ok: boolean; reason?: string } {
  const state = goodsStateOf(paid, item);
  if (state === 'UNPAID') return { ok: false, reason: '결제 전 상품은 보관할 수 없습니다' };
  if (state === 'KEPT') return { ok: false, reason: '이미 보관 중입니다' };
  if (state === 'READY_TO_SHIP') return { ok: true };
  return { ok: false, reason: `${GOODS_STATE_LABEL[state]} 상태라 보관할 수 없습니다` };
}

export interface ShipmentPlanInput {
  buyerKey: string;
  sales: readonly SaleRecord[];
  paidSaleIds: ReadonlySet<string>;
  items: ReadonlyMap<string, FulfillmentItemRecord>;
  shippingConfig: ShippingConfig;
  /** 이 상품들의 회차 정산서에서 이미 받은 배송비 합계 */
  shippingAlreadyCharged?: number;
  getOverride?: (nickname: string, sessionId: string) => BuyerShippingOverride | null | undefined;
}

export interface ShipmentExclusion {
  saleId: string;
  state: GoodsState;
  reason: string;
}

export interface ShipmentPlan {
  buyerKey: string;
  saleIds: string[];
  keptSaleIds: string[];
  newSaleIds: string[];
  productAmount: number;
  keptAmount: number;
  newAmount: number;
  shipping: CalculatedShipping;
  /** 출고 때 받을 배송비 (이미 받은 배송비를 뺀 값) */
  feeDue: number;
  excluded: ShipmentExclusion[];
  /** 다른 출고에 이미 묶인 상품 */
  conflicts: string[];
  canReserve: boolean;
}

/** 한 구매자의 출고 계획: 보관 중 전체 + 결제된 새 상품 */
export function planShipment(input: ShipmentPlanInput): ShipmentPlan {
  const keptSaleIds: string[] = [];
  const newSaleIds: string[] = [];
  const excluded: ShipmentExclusion[] = [];
  const conflicts: string[] = [];
  let keptAmount = 0;
  let newAmount = 0;
  const included: SaleRecord[] = [];

  const sales = input.sales.filter((sale) => isBillableSale(sale) && saleBuyerKey(sale) === input.buyerKey)
    .sort((a, b) => a.recognizedAt.localeCompare(b.recognizedAt));
  for (const sale of sales) {
    const state = goodsStateOf(input.paidSaleIds.has(sale.id), input.items.get(sale.id));
    const amount = Number(sale.amount) || 0;
    if (state === 'KEPT') { keptSaleIds.push(sale.id); keptAmount += amount; included.push(sale); }
    else if (state === 'READY_TO_SHIP') { newSaleIds.push(sale.id); newAmount += amount; included.push(sale); }
    else if (state === 'RESERVED' || state === 'PACKED') {
      conflicts.push(sale.id);
      excluded.push({ saleId: sale.id, state, reason: '다른 출고에 이미 들어 있음' });
    } else if (state === 'UNPAID') excluded.push({ saleId: sale.id, state, reason: '결제 전' });
    else if (state === 'REFUND_NEEDED' || state === 'CANCELLED') excluded.push({ saleId: sale.id, state, reason: '고객 취소' });
    // 발송·배송 완료는 이미 끝난 상품이라 목록에 넣지 않는다
  }

  const productAmount = keptAmount + newAmount;
  const thresholdBase = input.shippingConfig.includeKeepingInThreshold ? productAmount : newAmount;
  const sessionIds = new Set(included.map((sale) => sale.sessionId));
  const nickname = included[included.length - 1]?.buyerNickname.trim() || '';
  // 수동 배송비는 회차별이라, 한 회차 상품만 나갈 때만 따른다 (shippingService.getOverrideForSales 와 같음)
  const override = sessionIds.size === 1 ? input.getOverride?.(nickname, [...sessionIds][0]) ?? null : null;
  const shipping = computeShippingFee(thresholdBase, input.shippingConfig, override);
  const feeDue = included.length ? Math.max(0, shipping.fee - Math.max(0, input.shippingAlreadyCharged || 0)) : 0;

  return {
    buyerKey: input.buyerKey,
    saleIds: [...keptSaleIds, ...newSaleIds],
    keptSaleIds, newSaleIds, productAmount, keptAmount, newAmount, shipping, feeDue,
    excluded, conflicts,
    canReserve: included.length > 0,
  };
}

export interface KeepingAlertDays {
  warnDays: number;
  alertDays: number;
}

export const DEFAULT_KEEPING_ALERT_DAYS: KeepingAlertDays = { warnDays: 14, alertDays: 30 };
export const KEEPING_ALERT_DAYS_SETTING = 'keeping_alert_days';

/** 판매자가 정한 보관 알림 일수 (workspace_settings 'keeping_alert_days'). 잘못된 값은 처음 값으로. */
export function normalizeKeepingAlertDays(raw: unknown): KeepingAlertDays {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const toDays = (value: unknown) => {
    const days = Math.floor(Number(value));
    return Number.isFinite(days) && days >= 1 && days <= 365 ? days : null;
  };
  const warnDays = toDays(source.warnDays) ?? DEFAULT_KEEPING_ALERT_DAYS.warnDays;
  let alertDays = toDays(source.alertDays) ?? DEFAULT_KEEPING_ALERT_DAYS.alertDays;
  if (alertDays <= warnDays) alertDays = Math.min(365, warnDays + 1);
  return { warnDays, alertDays: Math.max(alertDays, warnDays) };
}

export type KeepingAlertLevel = 'OK' | 'WARN' | 'ALERT';

export interface KeepingAlert {
  buyerKey: string;
  nickname: string;
  itemCount: number;
  keptAmount: number;
  oldestKeptAt: string;
  days: number;
  level: KeepingAlertLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 구매자별 보관 현황과 알림 단계 (가장 오래된 보관 상품 기준) */
export function keepingAlerts(
  sales: readonly SaleRecord[],
  items: ReadonlyMap<string, FulfillmentItemRecord>,
  now: Date,
  settings: KeepingAlertDays = DEFAULT_KEEPING_ALERT_DAYS,
): KeepingAlert[] {
  const byBuyer = new Map<string, KeepingAlert>();
  for (const sale of sales) {
    const item = items.get(sale.id);
    if (item?.state !== 'KEPT' || !isBillableSale(sale)) continue;
    const buyerKey = saleBuyerKey(sale);
    const keptAt = item.keptAt || sale.recognizedAt;
    const current = byBuyer.get(buyerKey);
    if (!current) {
      byBuyer.set(buyerKey, {
        buyerKey, nickname: sale.buyerNickname.trim(), itemCount: 1, keptAmount: Number(sale.amount) || 0,
        oldestKeptAt: keptAt, days: 0, level: 'OK',
      });
    } else {
      current.itemCount += 1;
      current.keptAmount += Number(sale.amount) || 0;
      if (keptAt < current.oldestKeptAt) current.oldestKeptAt = keptAt;
    }
  }
  const alerts = [...byBuyer.values()];
  for (const alert of alerts) {
    alert.days = Math.max(0, Math.floor((now.getTime() - Date.parse(alert.oldestKeptAt)) / DAY_MS));
    alert.level = alert.days >= settings.alertDays ? 'ALERT' : alert.days >= settings.warnDays ? 'WARN' : 'OK';
  }
  return alerts.sort((a, b) => b.days - a.days || a.buyerKey.localeCompare(b.buyerKey));
}
