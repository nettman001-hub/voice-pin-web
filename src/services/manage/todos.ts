import type { ManageOrder } from './orderPipeline.ts';
import type { ContactBook } from './contactLink.ts';
import type { KeepingAlert } from './fulfillment.ts';

/**
 * 관리 홈 "할 일" 목록 (순수 함수). 앞에 올수록 먼저 할 일이다.
 * 연락처 연결이 청구보다 먼저다 (사용자 규칙 2026-11-02).
 */

export type ManageTodoKind =
  | 'DUPLICATE_INVOICE' | 'REFUND_NEEDED' | 'PAYMENT_REVIEW' | 'CONTACT_CONFIRM' | 'CONTACT_MISSING' | 'UNKNOWN_SENDER'
  | 'READY_TO_BILL' | 'AWAITING_PAYMENT' | 'READY_TO_SHIP' | 'KEEPING_ALERT' | 'KEEPING_WARN';

export interface ManageTodo {
  kind: ManageTodoKind;
  count: number;
  label: string;
  /** 이동할 관리 화면 */
  path: string;
}

export interface TodoInput {
  orders: readonly ManageOrder[];
  contactBook?: ContactBook | null;
  keepingAlerts?: readonly KeepingAlert[];
  readyToShipBuyerCount?: number;
  refundNeededCount?: number;
  /** 자동으로 못 붙인 입금 (확인 필요 + 미확인) */
  paymentReviewCount?: number;
}

export function buildManageTodos(input: TodoInput): ManageTodo[] {
  const todos: ManageTodo[] = [];
  const add = (kind: ManageTodoKind, count: number, label: string, path: string) => {
    if (count > 0) todos.push({ kind, count, label, path });
  };
  const orders = input.orders;
  add('DUPLICATE_INVOICE', orders.filter((order) => order.duplicateOpenInvoiceIds.length > 0).length,
    '열린 정산서가 둘인 주문', '/manage/orders?filter=duplicate');
  add('REFUND_NEEDED', input.refundNeededCount || 0, '환불 필요', '/manage/ship?filter=refund');
  add('PAYMENT_REVIEW', input.paymentReviewCount || 0, '입금 확인 필요', '/manage/inbox');
  add('CONTACT_CONFIRM', orders.filter((order) => order.stage === 'NEEDS_CONTACT' && order.contact?.state === 'NEEDS_CONFIRM').length,
    '연락처 확인 필요', '/manage/contacts');
  add('CONTACT_MISSING', orders.filter((order) => order.stage === 'NEEDS_CONTACT' && order.contact?.state !== 'NEEDS_CONFIRM').length,
    '연락처 없음 (방송에서 불러 주기)', '/manage/contacts');
  add('UNKNOWN_SENDER', input.contactBook?.unassignedPhones.length || 0, '누군지 모르는 문자', '/manage/contacts');
  add('READY_TO_BILL', orders.filter((order) => order.stage === 'READY_TO_BILL').length, '청구 전', '/manage/orders?stage=READY_TO_BILL');
  add('AWAITING_PAYMENT', orders.filter((order) => order.stage === 'AWAITING_PAYMENT').length, '입금 대기', '/manage/orders?stage=AWAITING_PAYMENT');
  add('READY_TO_SHIP', input.readyToShipBuyerCount || 0, '출고할 구매자', '/manage/ship');
  const alerts = input.keepingAlerts || [];
  add('KEEPING_ALERT', alerts.filter((alert) => alert.level === 'ALERT').length, '오래 보관 (경고)', '/manage/ship?filter=keeping');
  add('KEEPING_WARN', alerts.filter((alert) => alert.level === 'WARN').length, '오래 보관 (주의)', '/manage/ship?filter=keeping');
  return todos;
}
