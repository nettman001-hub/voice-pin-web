import type { CommerceState } from '../types/commerce';

export interface CommerceChanges {
  messages: CommerceState['messages'];
  claims: CommerceState['claims'];
  invoices: CommerceState['invoices'];
  payments: CommerceState['payments'];
  shipments: CommerceState['shipments'];
  verifiedSaleIdsToAdd: string[];
  verifiedSaleIdsToRemove: string[];
}

// Compare values rather than object identity: forms and bridge responses can
// reconstruct unchanged records with a different property order.
export const areCommerceValuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areCommerceValuesEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
      && areCommerceValuesEqual(leftRecord[key], rightRecord[key]));
};

const changedRecords = <T extends { id: string }>(previous: T[], next: T[]): T[] => {
  if (previous === next) return [];
  const previousById = new Map(previous.map((record) => [record.id, record]));
  return next.filter((record) => !areCommerceValuesEqual(previousById.get(record.id), record));
};

export const getCommerceChanges = (previous: CommerceState, next: CommerceState): CommerceChanges => {
  const previousVerified = new Set(previous.verifiedSaleIds);
  const nextVerified = new Set(next.verifiedSaleIds);
  return {
    messages: changedRecords(previous.messages, next.messages),
    claims: changedRecords(previous.claims, next.claims),
    invoices: changedRecords(previous.invoices, next.invoices),
    payments: changedRecords(previous.payments, next.payments),
    shipments: changedRecords(previous.shipments, next.shipments),
    verifiedSaleIdsToAdd: [...nextVerified].filter((id) => !previousVerified.has(id)),
    verifiedSaleIdsToRemove: [...previousVerified].filter((id) => !nextVerified.has(id)),
  };
};

export const hasCommerceChanges = (changes: CommerceChanges): boolean => (
  Object.values(changes).some((records) => records.length > 0)
);

// A Realtime/recovery read replaces only the requested tables. Local edits
// made while the request was in flight must remain visible until saved.
export function mergeRemoteCommerce(current: CommerceState, beforeRead: CommerceState, remote: Partial<CommerceState>): CommerceState {
  const next = { ...current };
  for (const key of ['messages', 'claims', 'invoices', 'payments', 'shipments'] as const) {
    const incoming = remote[key];
    if (!incoming) continue;
    const rows = new Map<string, { id: string }>(incoming.map((row) => [row.id, row]));
    const before = new Map(beforeRead[key].map((row) => [row.id, row]));
    const latest = new Map(current[key].map((row) => [row.id, row]));
    for (const [id, row] of latest) if (!areCommerceValuesEqual(before.get(id), row)) rows.set(id, row);
    for (const id of before.keys()) if (!latest.has(id)) rows.delete(id);
    // Server ordering is preserved; locally added records keep their identity.
    (next[key] as { id: string }[]) = [...rows.values()];
  }
  if (remote.verifiedSaleIds) {
    const values = new Set(remote.verifiedSaleIds);
    const before = new Set(beforeRead.verifiedSaleIds);
    const latest = new Set(current.verifiedSaleIds);
    for (const id of latest) if (!before.has(id)) values.add(id);
    for (const id of before) if (!latest.has(id)) values.delete(id);
    next.verifiedSaleIds = [...values];
  }
  return areCommerceValuesEqual(current, next) ? current : next;
}
