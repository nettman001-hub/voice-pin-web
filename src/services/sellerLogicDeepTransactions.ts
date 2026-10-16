import type { SellerLogicDeepDecision } from "../types/sellerLogicDeep.ts";

type TransactionEvidence = Pick<SellerLogicDeepDecision, "nickname" | "commentIds" | "transcriptIds"> &
  Partial<Pick<SellerLogicDeepDecision, "productName" | "orderCode" | "lineKey">>;

const normalized = (value: string | null | undefined): string => value?.trim().toLowerCase() || "";

/** A shared customer or price is not evidence that two purchases are one order. */
export function canMergeSellerLogicDeepTransactions(left: TransactionEvidence, right: TransactionEvidence): boolean {
  const buyer = normalized(left.nickname);
  if (!buyer || buyer !== normalized(right.nickname)) return false;
  for (const key of ["lineKey", "orderCode", "productName"] as const) {
    const first = normalized(left[key]);
    const second = normalized(right[key]);
    if (first && second && first !== second) return false;
  }

  if (left.commentIds.some((id) => right.commentIds.includes(id))) return true;
  // A speech-only continuation may enrich an existing order. Two separate
  // buyer requests remain separate even when the seller cites one shared row.
  return (!left.commentIds.length || !right.commentIds.length) &&
    left.transcriptIds.some((id) => right.transcriptIds.includes(id));
}
