export type IdentityStatus = 'VERIFIED' | 'MANUAL_CONFIRMED' | 'UNRESOLVED';
export type ImageKind = 'PHOTO' | 'NUMBER_IMAGE';
export type RecordState = 'ACTIVE' | 'CANCELLED';
export type PrintJobStatus = 'QUEUED' | 'CLAIMED' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
export type PrintJobKind = 'SALE' | 'CORRECTION' | 'CANCEL' | 'REPRINT';
export type DeviceCapability = 'SALES_READ' | 'SALES_WRITE' | 'PRODUCT_WRITE' | 'COMMENT_INGEST' | 'PRINT' | 'SMS';
export type DeviceType = 'ANDROID_SMS' | 'ANDROID_PHONE' | 'WINDOWS_HELPER' | 'OTHER';

export interface ProductSalesSettings {
  revision: number;
  productRegistrationEnabled: boolean;
  captureProductImageEnabled: boolean;
  productNameInputEnabled: boolean;
  voicePreviewMs: number;
  voiceCommands: {
    registerProduct: string[];
    captureProduct: string[];
    setProductName: string[];
    setPrice: string[];
    confirmSale: string[];
    setBuyer: string[];
  };
}

export interface LiveSession {
  id: string;
  workspaceId?: string;
  displayCode: string;
  status: 'ACTIVE' | 'ENDED';
  activeProductId?: string | null;
  revision: number;
  startedAt: string;
  endedAt?: string | null;
}

export interface Product {
  id: string;
  productCode: string;
  name?: string | null;
  unitPrice: number | null;
  imageKind: ImageKind;
  imageUrl?: string;
  imagePath?: string;
  revision: number;
  salesRevision: number;
}

export interface ProductDraft {
  id: string;
  draftRevision: number;
  productId: string;
  productCode: string;
  name?: string | null;
  unitPrice: number | null;
  imageKind: ImageKind;
  status: 'DRAFT' | 'READY' | 'COMMITTED' | 'CANCELLED' | 'EXPIRED';
}

export interface BuyerStats {
  buyerId: string;
  displayNickname: string;
  sessionQuantity: number;
  sessionAmount: number;
  totalPurchaseCount: number;
  totalPurchaseAmount: number;
}

export interface Buyer {
  id: string;
  platform: 'TIKTOK' | 'MANUAL' | 'OTHER';
  platformUserId?: string | null;
  platformUniqueId?: string | null;
  displayNickname: string;
  identityStatus: IdentityStatus;
  stats?: BuyerStats;
}

export interface LiveComment {
  id: string;
  sessionId: string;
  collectorId: string;
  platformMessageId: string;
  buyerId?: string | null;
  nicknameSnapshot: string;
  content: string;
  capturedAt: string;
  ingestSequence: number;
}

export interface Sale {
  id: string;
  productId: string;
  buyerId: string;
  buyerNickname: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  revision: number;
  recordState: RecordState;
  productCodeSnapshot?: string;
  productNameSnapshot?: string;
  productImagePathSnapshot?: string;
  source?: string;
}

export interface PrintJob {
  id: string;
  saleId: string;
  saleRevision: number;
  kind: PrintJobKind;
  status: PrintJobStatus;
  reprintSequence?: number;
  immutablePayload?: Record<string, unknown>;
  leaseToken?: string;
  leaseExpiresAt?: string;
  attempts?: number;
  result?: string;
  message?: string;
  requiresManualReview?: boolean;
}

export interface Device {
  id: string;
  displayName: string;
  deviceType: DeviceType;
  capabilities: DeviceCapability[];
  isOutputDevice: boolean;
  revision: number;
  lastSeenAt?: string | null;
}

export interface SessionSummary {
  sessionQuantity: number;
  sessionAmount: number;
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface CommonApiResponse<T = unknown> {
  ok: boolean;
  apiVersion: number;
  serverTime: string;
  data?: T;
  error?: ApiError;
}
