import type { SaleRecord } from '../../types/live.ts';
import type { BuyerShippingOverride, ShippingConfig } from '../../types/shipping.ts';
import type { ContactLinkRecord, ContactMessage } from './contactLink.ts';
import type { FulfillmentItemRecord, KeepingAlertDays } from './fulfillment.ts';
import { buildManageDashboard, type DashboardInput, type GoodsSummary, type ManageDashboard, type PaymentLike } from './dashboard.ts';
import type { OrderInvoiceLike, StageSummary } from './orderPipeline.ts';
import type { ManageTodo } from './todos.ts';

/**
 * 관리 홈 서버 요약 (sales-api manage-summary).
 * 폰이 판매·정산서·입금·문자를 모두 받아 세지 않고, 서버가 같은 buildManageDashboard 로 센 숫자만 받는다.
 * 행 → 계산 입력 변환도 여기 한 곳에 두어 폰 계산과 서버 계산이 같은 값을 쓰게 한다.
 */

type Row = Record<string, any>;

export const SUMMARY_PERIODS = [0, 1, 7, 30] as const;

/** 서버가 읽는 판매 열 (계산에 쓰는 것만). 사진·기록은 읽지 않는다. */
export const SUMMARY_SALE_COLUMNS = 'id,session_id,buyer_nickname,buyer_id,record_state,amount,recognized_at,status,quantity,ai_verification';
export const SUMMARY_INVOICE_COLUMNS = 'id,status,sale_ids,customer_nickname,created_at';
export const SUMMARY_PAYMENT_COLUMNS = 'sale_ids,match_status,paid_at';
export const SUMMARY_MESSAGE_COLUMNS = 'phone_number,direction,body,received_at';
export const CONTACT_COLUMNS = 'phone,buyer_key,nickname,state,linked_at';
export const FULFILLMENT_COLUMNS = 'sale_id,buyer_key,state,kept_at,shipment_id,cancelled_by,refunded_at';

export function summarySaleFromRow(row: Row): SaleRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    buyerNickname: row.buyer_nickname || '',
    buyerId: row.buyer_id || undefined,
    recordState: row.record_state || 'ACTIVE',
    amount: Number(row.amount) || 0,
    recognizedAt: row.recognized_at,
    rawTranscript: '',
    status: row.status,
    quantity: Number(row.quantity || 1),
    aiVerification: row.ai_verification || undefined,
  } as SaleRecord;
}

const ids = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

export function summaryInvoiceFromRow(row: Row): OrderInvoiceLike & { saleIds: string[] } {
  return { id: row.id, status: row.status, saleIds: ids(row.sale_ids), buyerNickname: row.customer_nickname, createdAt: row.created_at };
}

export function summaryPaymentFromRow(row: Row): PaymentLike {
  return { saleIds: ids(row.sale_ids), matchStatus: row.match_status, paidAt: row.paid_at || undefined };
}

export function summaryMessageFromRow(row: Row, cleanBody: (body?: string | null) => string): ContactMessage {
  return { phone: row.phone_number, direction: row.direction, body: cleanBody(row.body), receivedAt: row.received_at || undefined };
}

/** buyer_contacts 행. 구매자 키가 없는 행은 BLOCKED(모르는 번호 막기)만 쓴다. */
export function contactLinksFromRows(rows: readonly Row[]): ContactLinkRecord[] {
  return rows.filter((row) => row.buyer_key || row.state === 'BLOCKED').map((row) => ({
    phone: row.phone, buyerKey: row.buyer_key || '', nickname: row.nickname, linkedAt: row.linked_at, blocked: row.state === 'BLOCKED',
  }));
}

export function fulfillmentItemsFromRows(rows: readonly Row[]): FulfillmentItemRecord[] {
  return rows.map((row) => ({
    saleId: row.sale_id, buyerKey: row.buyer_key, state: row.state, keptAt: row.kept_at, shipmentId: row.shipment_id,
    cancelledBy: row.cancelled_by, refunded: !!row.refunded_at,
  }));
}

/** 수동 택배비 지정 (workspace_settings buyer_shipping_overrides, 키 = `${회차}_${닉네임}`) */
export function overrideLookup(map: Record<string, BuyerShippingOverride> | null | undefined) {
  return (nickname: string, sessionId: string) => (nickname && map ? map[`${sessionId}_${nickname.trim()}`] || null : null);
}

export interface ManageSummary {
  periodDays: number;
  salesAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  orderCount: number;
  stages: StageSummary[];
  goods: GoodsSummary;
  todos: ManageTodo[];
  keeping: ManageDashboard['keeping'];
  alertDays: KeepingAlertDays;
  computedAt: string;
}

/** 관리 홈이 그리는 값만 (주문 목록·연락처 장부는 보내지 않는다) */
export function summaryOf(dashboard: ManageDashboard, periodDays: number, alertDays: KeepingAlertDays, now: Date): ManageSummary {
  return {
    periodDays,
    salesAmount: dashboard.salesAmount,
    paidAmount: dashboard.paidAmount,
    unpaidAmount: dashboard.unpaidAmount,
    orderCount: dashboard.orderCount,
    stages: dashboard.stages,
    goods: dashboard.goods,
    todos: dashboard.todos,
    keeping: dashboard.keeping,
    alertDays,
    computedAt: now.toISOString(),
  };
}

export function buildManageSummary(input: DashboardInput): ManageSummary {
  return summaryOf(buildManageDashboard(input), input.periodDays, input.alertDays, input.now);
}

export function normalizeSummaryPeriod(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null;
  const days = Number(value);
  return (SUMMARY_PERIODS as readonly number[]).includes(days) ? days : null;
}

export type { ShippingConfig };
