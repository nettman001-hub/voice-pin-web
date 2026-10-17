import type { SaleRecord } from '../types/live.ts';
import { promiseDefaultBuyerKey } from './promiseDefaultService.ts';

export interface BuyerSaleGroup {
  key: string;
  nickname: string;
  records: SaleRecord[];
  latestTime: number;
}

const recognizedTime = (sale: SaleRecord): number => {
  const time = Date.parse(sale.recognizedAt);
  return Number.isFinite(time) ? time : 0;
};

/** Keep each sale row intact while placing records of the same known buyer together. */
export function groupSalesByBuyer(sales: readonly SaleRecord[]): BuyerSaleGroup[] {
  const groups = new Map<string, SaleRecord[]>();
  for (const sale of sales) {
    const nickname = sale.buyerNickname?.trim() || '';
    const key = sale.buyerId || nickname
      ? promiseDefaultBuyerKey(sale.buyerId, nickname)
      : `unidentified:${sale.id}`;
    const records = groups.get(key) || [];
    records.push(sale);
    groups.set(key, records);
  }

  return Array.from(groups, ([key, records]) => {
    const sortedRecords = [...records].sort((a, b) => recognizedTime(b) - recognizedTime(a));
    return {
      key,
      nickname: sortedRecords.find((sale) => sale.buyerNickname?.trim())?.buyerNickname.trim() || '구매자 닉네임 없음',
      records: sortedRecords,
      latestTime: recognizedTime(sortedRecords[0]),
    };
  }).sort((a, b) => b.latestTime - a.latestTime);
}
