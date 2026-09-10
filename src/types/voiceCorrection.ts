import type { SaleRecord } from './live.ts';
import type { SaleHistoryRecord } from './pendingSale.ts';

export type CorrectionFieldType = 'AMOUNT' | 'BUYER' | 'PRODUCT' | 'CANCEL_CORRECTION' | 'COMPLEX';

export type CorrectionScope = 'THIS_SALE_ONLY' | 'FUTURE_PRODUCT_SALES' | 'UNCERTAIN';

export type PendingCorrectionStatus = 'PENDING' | 'APPLIED' | 'CANCELLED' | 'CONFLICT';

export interface VoiceCorrectionIntent {
  isCorrection: boolean;
  field: CorrectionFieldType;
  negatedOldValue?: {
    amount?: number;
    buyerNickname?: string;
    productCode?: string;
  };
  affirmedNewValue?: {
    amount?: number;
    buyerNickname?: string;
    productCode?: string;
  };
  targetReference?: {
    buyerNickname?: string;
    productCode?: string;
    relativeTime?: 'JUST_BEFORE' | 'PREVIOUS' | string;
  };
  scope: CorrectionScope;
  isNegativeCommand: boolean;
  isQuestion: boolean;
  isCancellation: boolean;
  isIncomplete: boolean;
  rawUtterance: string;
  confidence?: number;
}

export interface PendingCorrectionRequest {
  id: string;
  workspaceId: string;
  sessionId: string;
  status: PendingCorrectionStatus;
  targetSaleId: string | null;
  candidateSaleIds: string[];
  originalUtterance: string;
  followUpUtterances: Array<{
    text: string;
    timestamp: string;
  }>;
  parsedCorrection: VoiceCorrectionIntent;
  missingInfo: string[];
  conflictReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceCorrectionApplyResult {
  success: boolean;
  action: 'APPLIED' | 'PENDING_CREATED' | 'CANCELLED' | 'RESTORED' | 'IGNORED' | 'CONFLICT';
  sale?: SaleRecord;
  pendingCorrection?: PendingCorrectionRequest;
  printJobCreated?: boolean;
  message: string;
  conflictDetails?: {
    saleId: string;
    paymentStatus?: string;
    shippingStatus?: string;
    reason: string;
  };
}
