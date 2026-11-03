import type { TouchSale } from '../types/touchSales.ts';
export function nextTouchProductNumber(rows: readonly TouchSale[], sessionId: string) {
  return rows.filter(s => s.sessionId === sessionId).reduce((max, s) => {
    const n = /^(\d+)번$/.exec((s.productName || '').trim());
    return n ? Math.max(max, Number(n[1])) : max;
  }, 0) + 1;
}
const identity = (s: TouchSale) => s.buyerId || s.comment?.platformUserId || s.comment?.uniqueId || s.buyerNickname;
export function touchBuyerSessionTotal(sale: TouchSale, rows: readonly TouchSale[]) {
  const purchases = rows.filter(s => s.sessionId === sale.sessionId && identity(s) === identity(sale) &&
    !['취소', '보류'].includes(s.status) && s.recordState !== 'CANCELLED' && s.reviewDecision !== 'NOT_SALE');
  return { count: purchases.length, amount: purchases.reduce((sum, s) => sum + s.amount, 0) };
}
