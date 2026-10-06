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
