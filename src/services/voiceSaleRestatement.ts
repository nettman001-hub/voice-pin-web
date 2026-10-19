import type { SaleRecord } from '../types/live.ts';

export const VOICE_SALE_RESTATEMENT_WINDOW_MS = 10_000;

/** "하나 더", "두 개", "추가로 드릴게요" announce another unit, not a restatement. */
const ADDITIONAL_PURCHASE = /(?:하나|한\s*(?:개|장|벌|켤레)|\d+\s*(?:개|장|벌|켤레))\s*더|(?:두|세|네|다섯)\s*(?:개|장|벌|켤레)|추가(?:로|해서)?\s*(?:하나|드|구매|주문)|또\s*(?:하나|드)/u;

export function announcesAdditionalPurchase(text: string): boolean {
  return ADDITIONAL_PURCHASE.test(text);
}

export interface VoiceSaleRestatementCandidate {
  sessionId: string;
  recognizedAt: string;
  buyerId?: string;
  buyerNickname: string;
  amount: number;
  productId?: string;
  /** A product change at this time ends every earlier sale. */
  notBefore?: string;
}

const nicknameKey = (name: string) => name.replace(/\s+/gu, '').toLowerCase();

/**
 * The seller often repeats an allocation a few seconds later ("꼬심이님 드릴게요"
 * again, with the price) and may even ask the buyer to comment once more
 * ("저요, 한번만 더 해 주세요"). When the latest voice sale of the session went to
 * the same buyer within 10 seconds for the same product and price, the new
 * speech restates that sale; it is not a second purchase.
 */
export function findRestatedVoiceSale(
  sales: SaleRecord[],
  candidate: VoiceSaleRestatementCandidate,
): SaleRecord | undefined {
  const at = Date.parse(candidate.recognizedAt);
  if (!Number.isFinite(at)) return undefined;
  const latest = sales
    .filter((sale) => sale.sessionId === candidate.sessionId && sale.source === 'WEB_VOICE'
      && sale.status !== '취소' && sale.recordState !== 'CANCELLED'
      && Number.isFinite(Date.parse(sale.recognizedAt)) && Date.parse(sale.recognizedAt) <= at)
    .sort((left, right) => Date.parse(right.recognizedAt) - Date.parse(left.recognizedAt))[0];
  if (!latest || latest.status === '수동수정'
    || (candidate.notBefore && Date.parse(latest.recognizedAt) < Date.parse(candidate.notBefore))
    || at - Date.parse(latest.recognizedAt) > VOICE_SALE_RESTATEMENT_WINDOW_MS) return undefined;
  const sameBuyer = latest.buyerId && candidate.buyerId
    ? latest.buyerId === candidate.buyerId
    : nicknameKey(latest.buyerNickname) === nicknameKey(candidate.buyerNickname);
  if (!sameBuyer) return undefined;
  if (candidate.amount > 0 && latest.amount > 0 && candidate.amount !== latest.amount) return undefined;
  if ((latest.productId || undefined) !== (candidate.productId || undefined)) return undefined;
  return latest;
}
