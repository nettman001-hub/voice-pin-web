import type { SaleRecord } from '../types/live.ts';
import type { Buyer } from '../types/productSales.ts';
import type { SettlementInvoice, Shipment } from '../types/commerce.ts';
import {
  promiseDefaultBuyerKey,
  type PromiseDefaultRecord,
} from './promiseDefaultService.ts';

/** Exact display-name fallback only; fuzzy nickname matching is never an identity key. */
export const exactCustomerName = (name = '') =>
  name.replace(/\s/gu, '').toLocaleLowerCase();
export interface CustomerStats {
  purchaseCount: number;
  purchaseSessionCount: number;
  totalPurchaseCount: number;
  totalRevenue: number;
  defaultCount: number;
  todayCount: number;
  isFirstTimeBuyer: boolean;
  ambiguous?: boolean;
  validSales: SaleRecord[];
}
export const emptyCustomerStats = (): CustomerStats => ({
  purchaseCount: 0,
  purchaseSessionCount: 0,
  totalPurchaseCount: 0,
  totalRevenue: 0,
  defaultCount: 0,
  todayCount: 0,
  isFirstTimeBuyer: false,
  validSales: [],
});
export interface StatsInput {
  sales: SaleRecord[];
  buyers?: Buyer[];
  promiseDefaults?: PromiseDefaultRecord[];
  invoices?: SettlementInvoice[];
  shipments?: Shipment[];
  isPaid?: (ids: string[]) => boolean;
  currentSessionId?: string | null;
  activeSessionId?: string | null;
  now?: number;
}
const invalidSale = (sale: SaleRecord) =>
  !['보류', '취소', '반품', '환불'].includes(sale.status) &&
  sale.recordState !== 'CANCELLED' &&
  sale.aiVerification?.reviewDecision !== 'NOT_SALE' &&
  !/(반품|취소|환불|노쇼|미입금취소)/u.test(sale.note || '');

export function calculateCustomerStats(
  input: StatsInput & { nickname?: string; buyerId?: string },
): CustomerStats {
  const name = exactCustomerName(input.nickname);
  if ((!name || name.startsWith('미확인')) && !input.buyerId)
    return emptyCustomerStats();
  const rows = input.sales.filter((s) =>
    input.buyerId
      ? s.buyerId === input.buyerId
      : exactCustomerName(s.buyerNickname) === name,
  );
  const current = new Set(
    [input.currentSessionId, input.activeSessionId].filter(Boolean),
  );
  const now = input.now ?? Date.now();
  const isCurrent = (s: SaleRecord) =>
    current.size
      ? current.has(s.sessionId)
      : now - Date.parse(s.recognizedAt) < 12 * 60 * 60 * 1000;
  const valid = rows.filter(invalidSale);
  const past = valid.filter((s) => !isCurrent(s));
  const today = valid.filter(isCurrent);
  const decisions = new Map<string, PromiseDefaultRecord>();
  const keys = new Set([
    promiseDefaultBuyerKey(input.buyerId, input.nickname || ''),
  ]);
  for (const s of rows)
    keys.add(promiseDefaultBuyerKey(s.buyerId, s.buyerNickname));
  for (const d of input.promiseDefaults || []) {
    if (
      !keys.has(d.buyerKey) &&
      !(
        d.buyerKey.startsWith('nickname:') &&
        exactCustomerName(d.buyerNickname) === name
      )
    )
      continue;
    const old = decisions.get(d.sessionId);
    if (!old || d.updatedAt > old.updatedAt) decisions.set(d.sessionId, d);
  }
  const defaults = new Set(
    [...decisions.values()]
      .filter((d) => d.status === 'CONFIRMED')
      .map((d) => d.sessionId),
  );
  const invoiceBySale = new Map<string, SettlementInvoice[]>();
  const shipmentBySale = new Map<string, Shipment[]>();
  for (const i of input.invoices || [])
    for (const id of i.saleIds)
      invoiceBySale.set(id, [...(invoiceBySale.get(id) || []), i]);
  for (const s of input.shipments || [])
    for (const id of s.saleIds)
      shipmentBySale.set(id, [...(shipmentBySale.get(id) || []), s]);
  for (const sale of rows) {
    if (isCurrent(sale) || decisions.has(sale.sessionId)) continue;
    const cancelled =
      ['취소', '반품', '환불'].includes(sale.status) ||
      sale.recordState === 'CANCELLED';
    const noted = /(반품|취소|환불|노쇼|미입금)/u.test(sale.note || '');
    const invoiceDefault = (invoiceBySale.get(sale.id) || []).some(
      (inv) =>
        inv.status === 'CANCELLED' ||
        (inv.status !== 'PAID' &&
          !!inv.dueDate &&
          Date.parse(inv.dueDate) < now &&
          !!input.isPaid &&
          !input.isPaid([sale.id])),
    );
    const shipmentDefault = (shipmentBySale.get(sale.id) || []).some((s) =>
      ['CANCELLED', 'RETURNED'].includes(s.status),
    );
    if (cancelled || noted || invoiceDefault || shipmentDefault)
      defaults.add(sale.sessionId);
  }
  return {
    purchaseCount: past.length,
    purchaseSessionCount: new Set(past.map((s) => s.sessionId)).size,
    totalPurchaseCount: valid.length,
    totalRevenue: past.reduce((n, s) => n + s.amount, 0),
    defaultCount: defaults.size,
    todayCount: today.length,
    isFirstTimeBuyer: !past.length && !!today.length,
    validSales: valid,
  };
}

/** Shared table: reconcile once per source change; lookup is a Map access per comment. */
export class CustomerStatsIndex {
  private stats = new Map<
    string,
    { fingerprint: string; value: CustomerStats }
  >();
  private names = new Map<string, Set<string>>();
  private accounts = new Map<string, string>();
  private buyerAliases = new Map<string, string>();
  reconcile(input: StatsInput) {
    const names = new Map<string, Set<string>>();
    const addName = (name: string, key: string) => {
      const n = exactCustomerName(name);
      if (!n) return;
      if (!names.has(n)) names.set(n, new Set());
      names.get(n)!.add(key);
    };
    this.accounts.clear();
    this.buyerAliases.clear();
    const byAccount = new Map<string, string>();
    for (const b of input.buyers || []) {
      const account = b.platformUserId
        ? `${b.platform || 'TIKTOK'}:${b.platformUserId}`
        : null;
      const key =
        account && byAccount.has(account)
          ? byAccount.get(account)!
          : `buyer:${b.id}`;
      if (account) byAccount.set(account, key);
      this.buyerAliases.set(b.id, key);
      addName(b.displayNickname, key);
      if (!b.platform || b.platform === 'TIKTOK') {
        if (b.platformUserId) this.accounts.set(b.platformUserId, key);
        if (b.platformUniqueId)
          this.accounts.set(`handle:${b.platformUniqueId.toLowerCase()}`, key);
      }
    }
    for (const s of input.sales)
      if (s.buyerId)
        addName(
          s.buyerNickname,
          this.buyerAliases.get(s.buyerId) || `buyer:${s.buyerId}`,
        );
    const groups = new Map<string, SaleRecord[]>();
    for (const s of input.sales) {
      const n = exactCustomerName(s.buyerNickname),
        known = names.get(n);
      const key = s.buyerId
        ? this.buyerAliases.get(s.buyerId) || `buyer:${s.buyerId}`
        : known?.size === 1
          ? [...known][0]
          : `nickname:${n}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
      addName(s.buyerNickname, key);
    }
    const decisionGroups = new Map<string, PromiseDefaultRecord[]>();
    for (const d of input.promiseDefaults || []) {
      const matches = names.get(exactCustomerName(d.buyerNickname));
      const key = d.buyerKey.startsWith('buyer:')
        ? this.buyerAliases.get(d.buyerKey.slice(6)) || d.buyerKey
        : matches?.size === 1
          ? [...matches][0]
          : `nickname:${exactCustomerName(d.buyerNickname)}`;
      if (!d.buyerKey.startsWith('buyer:') && matches && matches.size > 1)
        continue;
      if (!groups.has(key)) groups.set(key, []);
      if (!decisionGroups.has(key)) decisionGroups.set(key, []);
      decisionGroups.get(key)!.push({ ...d, buyerKey: key });
      addName(d.buyerNickname, key);
    }
    // Index commerce links once, rather than scanning all invoices for every comment.
    const related = new Map<
      string,
      { invoices: SettlementInvoice[]; shipments: Shipment[] }
    >();
    const saleKeys = new Map<string, string>();
    for (const [key, rows] of groups)
      for (const s of rows) saleKeys.set(s.id, key);
    for (const [type, records] of [
      ['invoices', input.invoices || []],
      ['shipments', input.shipments || []],
    ] as const) {
      for (const record of records)
        for (const key of new Set(
          record.saleIds.map((id) => saleKeys.get(id)).filter(Boolean),
        )) {
          if (!related.has(key!))
            related.set(key!, { invoices: [], shipments: [] });
          (related.get(key!)![type] as (SettlementInvoice | Shipment)[]).push(
            record,
          );
        }
    }
    const next = new Map<
      string,
      { fingerprint: string; value: CustomerStats }
    >();
    for (const [key, rows] of groups) {
      const nickname =
        rows[0]?.buyerNickname ||
        (input.buyers || []).find((b) => key === `buyer:${b.id}`)
          ?.displayNickname ||
        (input.promiseDefaults || []).find((d) => d.buyerKey === key)
          ?.buyerNickname ||
        '';
      const buyerId = key.startsWith('buyer:') ? key.slice(6) : undefined;
      const decisions = decisionGroups.get(key) || [];
      const links = related.get(key) || { invoices: [], shipments: [] };
      const paid = links.invoices.map(
        (i) => input.isPaid?.(i.saleIds) || false,
      );
      const fingerprint = JSON.stringify([
        rows,
        decisions,
        links,
        paid,
        input.currentSessionId,
        input.activeSessionId,
        Math.floor((input.now ?? Date.now()) / 60_000),
      ]);
      const old = this.stats.get(key);
      next.set(
        key,
        old?.fingerprint === fingerprint
          ? old
          : {
              fingerprint,
              value: calculateCustomerStats({
                ...input,
                ...links,
                sales: rows.map((s) => ({ ...s, buyerId })),
                promiseDefaults: decisions,
                nickname,
                buyerId,
              }),
            },
      );
    }
    this.stats = next;
    this.names = names;
    return this;
  }
  lookup(query: {
    nickname?: string;
    buyerId?: string | null;
    platformUserId?: string;
    uniqueId?: string;
  }): CustomerStats {
    let key = query.buyerId
      ? this.buyerAliases.get(query.buyerId) || `buyer:${query.buyerId}`
      : query.platformUserId
        ? this.accounts.get(query.platformUserId)
        : undefined;
    if (!key && query.uniqueId)
      key = this.accounts.get(`handle:${query.uniqueId.toLowerCase()}`);
    if (!key) {
      const matches = this.names.get(exactCustomerName(query.nickname));
      if (matches && matches.size > 1)
        return { ...emptyCustomerStats(), ambiguous: true };
      key = matches?.values().next().value;
    }
    return key
      ? this.stats.get(key)?.value || emptyCustomerStats()
      : emptyCustomerStats();
  }
  snapshot() {
    return {
      version: 1,
      savedAt: Date.now(),
      accounts: [...this.accounts],
      names: [...this.names].map(([name, keys]) => [name, [...keys]]),
      stats: [...this.stats].map(([key, entry]) => {
        const { validSales: _rows, ...value } = entry.value;
        return [key, value];
      }),
    };
  }
}
export const customerStatsLabel = (s: CustomerStats) =>
  s.ambiguous
    ? '동명'
    : [
        s.purchaseCount
          ? `${s.purchaseCount}건/${s.purchaseSessionCount}회 ${(s.totalRevenue / 10000).toFixed(1)}만`
          : '',
        s.defaultCount ? `미이행${s.defaultCount}` : '',
        s.isFirstTimeBuyer ? '첫구매' : '',
        s.todayCount ? `오늘 ${s.todayCount}건` : '',
      ]
        .filter(Boolean)
        .join(' · ');
