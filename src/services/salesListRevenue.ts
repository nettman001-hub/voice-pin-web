import type { SaleRecord } from '../types/live.ts';
import { promiseDefaultBuyerKey, type PromiseDefaultRecord } from './promiseDefaultService.ts';

export interface SalesListRevenue {
  totalAmount: number;
  confirmedAmount: number;
  uniqueBuyerCount: number;
}

/** Gross sales stay visible; seller-confirmed nonfulfillment is excluded only from confirmed revenue. */
export function calculateSalesListRevenue(
  sales: SaleRecord[], decisions: PromiseDefaultRecord[],
): SalesListRevenue {
  const latestDecisions = new Map<string, PromiseDefaultRecord>();
  for (const decision of decisions) {
    const key = `${decision.buyerKey}:${decision.sessionId}`;
    const previous = latestDecisions.get(key);
    if (!previous || decision.updatedAt > previous.updatedAt) latestDecisions.set(key, decision);
  }

  let totalAmount = 0;
  let confirmedAmount = 0;
  const buyers = new Set<string>();
  for (const sale of sales) {
    if (sale.status === '보류' || sale.status === '취소' || sale.recordState === 'CANCELLED'
      || sale.syncStatus === 'PENDING') continue;
    const amount = Number(sale.amount) || 0;
    totalAmount += amount;
    if (sale.buyerNickname.trim()) buyers.add(sale.buyerNickname.trim());
    const key = `${promiseDefaultBuyerKey(sale.buyerId, sale.buyerNickname)}:${sale.sessionId}`;
    if (latestDecisions.get(key)?.status !== 'CONFIRMED') confirmedAmount += amount;
  }
  return { totalAmount, confirmedAmount, uniqueBuyerCount: buyers.size };
}
