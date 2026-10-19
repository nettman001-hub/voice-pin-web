import type { SaleRecord } from '../types/live.ts';

/** Orders counted in purchase totals and shipping calculations. */
export function isBillableSale(sale: SaleRecord): boolean {
  return sale.status !== '보류' && sale.status !== '취소'
    && sale.recordState !== 'CANCELLED'
    && sale.aiVerification?.reviewDecision !== 'NOT_SALE';
}

export function calculateBillableAmount(sales: SaleRecord[]): number {
  return sales.reduce((total, sale) => (
    total + (isBillableSale(sale) ? Number(sale.amount) || 0 : 0)
  ), 0);
}
