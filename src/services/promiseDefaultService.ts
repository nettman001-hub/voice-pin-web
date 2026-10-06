import { normalizeNickname } from './nicknameMatcher.ts';

export interface PromiseDefaultRecord {
  buyerKey: string;
  buyerNickname: string;
  sessionId: string;
  status: 'CONFIRMED' | 'CANCELLED';
  updatedAt: string;
}

/** One decision per real account and broadcast, regardless of item count. */
export function promiseDefaultBuyerKey(buyerId: string | undefined, nickname: string): string {
  return buyerId ? `buyer:${buyerId}` : `nickname:${normalizeNickname(nickname)}`;
}

export function getPromiseDefault(
  records: PromiseDefaultRecord[], buyerKey: string, sessionId: string,
): PromiseDefaultRecord | undefined {
  return records.filter((record) => record.buyerKey === buyerKey && record.sessionId === sessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function summarizePromiseDefaults(records: PromiseDefaultRecord[], buyerKey: string): {
  confirmedCount: number;
  decidedSessionIds: ReadonlySet<string>;
} {
  const latestBySession = new Map<string, PromiseDefaultRecord>();
  for (const record of records) {
    if (record.buyerKey !== buyerKey) continue;
    const previous = latestBySession.get(record.sessionId);
    if (!previous || record.updatedAt > previous.updatedAt) latestBySession.set(record.sessionId, record);
  }
  return {
    confirmedCount: [...latestBySession.values()].filter((record) => record.status === 'CONFIRMED').length,
    decidedSessionIds: new Set(latestBySession.keys()),
  };
}
