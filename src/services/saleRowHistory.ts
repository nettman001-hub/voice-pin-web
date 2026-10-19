import type { SaleRecord } from '../types/live.ts';

export function isCountedSale(sale: SaleRecord): boolean {
  return sale.status !== '보류' && sale.status !== '취소'
    && sale.recordState !== 'CANCELLED'
    && sale.aiVerification?.reviewDecision !== 'NOT_SALE';
}

function isSameBuyer(left: SaleRecord, right: SaleRecord): boolean {
  if (left.buyerId || right.buyerId) return Boolean(left.buyerId && left.buyerId === right.buyerId);
  return Boolean(left.buyerNickname && left.buyerNickname !== '미확인(보류)' && left.buyerNickname !== '미확인'
    && left.buyerNickname === right.buyerNickname
    && left.aiVerification?.nicknameVerified !== false && right.aiVerification?.nicknameVerified !== false);
}

/** Each sale card describes purchases up to that sale, never later purchases.
 * Equal/invalid timestamps cannot establish an earlier purchase, so do not
 * infer chronology from display sorting, random IDs, or product numbers. */
export function getSalePurchaseHistory(sale: SaleRecord, records: readonly SaleRecord[]): SaleRecord[] {
  const at = Date.parse(sale.recognizedAt);
  if (!isCountedSale(sale) || !Number.isFinite(at)) return [sale];
  const earlier = records.filter((candidate) => candidate.id !== sale.id
    && candidate.sessionId === sale.sessionId && isCountedSale(candidate)
    && Date.parse(candidate.recognizedAt) < at && isSameBuyer(candidate, sale));
  earlier.sort((left, right) => Date.parse(left.recognizedAt) - Date.parse(right.recognizedAt)
    || left.id.localeCompare(right.id));
  return [...earlier, sale];
}
