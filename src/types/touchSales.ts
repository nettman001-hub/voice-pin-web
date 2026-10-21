import type { CommentRecord } from './comment';
import type { CustomerStats } from '../services/customerStatsIndex';
import type { Product } from './productSales';

export interface TouchSettings {
  mode: 'VOICE' | 'COMMENT_TOUCH';
  prepareSeconds: number;
  fallbackDelaySeconds: number;
}
export interface TouchComment extends CommentRecord {
  sequence: number;
  stats?: Omit<CustomerStats, 'validSales'>;
}
export type TouchTransport = 'DIRECT' | 'FALLBACK' | 'DISCONNECTED';
export interface TouchPcState {
  running: boolean;
  producerId: string;
  sessionId: string;
  displayCode: string;
  helperConnected: boolean;
  commentStatus: string;
  screenConnected: boolean;
  printerConnected: boolean;
  delaySeconds: number;
  delaySource: 'AUTO' | 'LAST' | 'SETTING';
  prepareSeconds: number;
  product: Product | null;
  totalCount: number;
  totalAmount: number;
}
export interface TouchCommit {
  operationId: string;
  sessionId: string;
  comment: Pick<CommentRecord, 'platformMessageId' | 'platformUserId' | 'uniqueId' | 'nickname' | 'content' | 'capturedAt'>;
  inputPrice: string;
  unitPrice: number;
  quantity: number;
  productId?: string;
  confirmedAt: string;
  clientConfirmedAt: string;
  clockOffsetMs: number;
  allowAdditional?: boolean;
}
export interface TouchCommitResult { saleId: string; buyerId: string; commentId: string; amount: number; captureDueAt: string; }
export interface TouchSale {
  id: string;
  sessionId: string;
  buyerId: string;
  buyerNickname: string;
  amount: number;
  unitPrice: number;
  quantity: number;
  recognizedAt: string;
  productName?: string;
  status: string;
  printStatus: string;
  captureStatus: string;
  captureDueAt: string;
  imageUrl?: string;
  revision: number;
  comment: TouchCommit['comment'];
  history: unknown[];
}
export interface TouchRun { session_id: string; producer_id: string; running: boolean; lease_expires_at: string; settings: TouchSettings; }
