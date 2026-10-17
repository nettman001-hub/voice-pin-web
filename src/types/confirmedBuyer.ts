export interface ConfirmedBuyerCandidate {
  nickname: string;
  accountKey: string;
  buyerId?: string;
  commentId: string;
  platformMessageId?: string;
  capturedAt: string;
  commentText?: string;
  uniqueId?: string;
  score: number;
  nameScore: number;
  recentPurchase: boolean;
  purchaseRequestId?: string;
}

/** Sale evidence remains confirmed while only the buyer identity is unresolved. */
export interface ConfirmedBuyerResolution {
  saleConfirmed: true;
  status: 'MATCHED' | 'AMBIGUOUS' | 'NO_MATCH';
  spokenNickname: string;
  candidates: ConfirmedBuyerCandidate[];
  matchedBy?: 'RULE' | 'MANUAL';
}

export interface ConfirmedBuyerAlias {
  spokenNickname: string;
  nickname: string;
  accountKey: string;
  updatedAt: string;
}
