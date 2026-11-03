import { promiseDefaultBuyerKey } from '../promiseDefaultService.ts';
import { buildContactBook, type ContactBuyer, type ContactLinkRecord, type ContactMessage, type ContactState } from './contactLink.ts';
import type { FulfillmentItemRecord } from './fulfillment.ts';

/**
 * [판매] 탭·청취 홈의 고객 띠와 불러 줄 명단 (순수 함수).
 * 띠: `12건/4회 · 킵 3 · 연락처 없음` (구매 통계는 기존 고객 통계 그대로, 여기서는 킵·연락처만 보탠다)
 * 명단: 이번 방송 구매자 중 연락처가 없는 사람. 연락이 오면 자동으로 빠진다.
 */

export interface BuyerManageInfo {
  buyerKey: string;
  kept: number;
  contact: ContactState;
}

export const buyerKeyOf = (buyerId: string | null | undefined, nickname: string) =>
  promiseDefaultBuyerKey(buyerId || undefined, nickname || '');

export function keptCountByBuyer(items: readonly (FulfillmentItemRecord & { buyerKey?: string | null })[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.state !== 'KEPT' || !item.buyerKey) continue;
    counts.set(item.buyerKey, (counts.get(item.buyerKey) || 0) + 1);
  }
  return counts;
}

export function buyerManageInfo(
  buyer: { buyerId?: string | null; nickname: string },
  links: readonly ContactLinkRecord[],
  keptCounts: ReadonlyMap<string, number>,
  messages: readonly ContactMessage[] = [],
): BuyerManageInfo {
  const buyerKey = buyerKeyOf(buyer.buyerId, buyer.nickname);
  const book = buildContactBook([{ buyerKey, nickname: buyer.nickname.trim() }], links, messages);
  return { buyerKey, kept: keptCounts.get(buyerKey) || 0, contact: book.byBuyer.get(buyerKey)?.state || 'NONE' };
}

export function stripParts(info: BuyerManageInfo): string[] {
  const parts: string[] = [];
  if (info.kept > 0) parts.push(`킵 ${info.kept}`);
  if (info.contact === 'NONE') parts.push('연락처 없음');
  else if (info.contact === 'NEEDS_CONFIRM') parts.push('연락처 확인 필요');
  return parts;
}

/** 이번 방송 구매자 중 연락처가 없는 사람 (닉네임 가나다순) */
export function broadcastCallList(
  buyers: readonly { buyerId?: string | null; nickname: string }[],
  links: readonly ContactLinkRecord[],
  messages: readonly ContactMessage[] = [],
): ContactBuyer[] {
  const unique = new Map<string, ContactBuyer>();
  for (const buyer of buyers) {
    const nickname = buyer.nickname.trim();
    if (!nickname) continue;
    const buyerKey = buyerKeyOf(buyer.buyerId, nickname);
    unique.set(buyerKey, { buyerKey, nickname });
  }
  const book = buildContactBook([...unique.values()], links, messages);
  return [...unique.values()]
    .filter((buyer) => (book.byBuyer.get(buyer.buyerKey)?.state || 'NONE') === 'NONE')
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
}
