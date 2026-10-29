import type { CommentRecord } from './comment';
import type { CustomerStats } from '../services/customerStatsIndex';
import type { Product } from './productSales';

export type TouchSalesMode = 'BASIC' | 'NUMBER' | 'SIZE_COLOR';
export interface TouchSettings {
  mode: 'VOICE' | 'COMMENT_TOUCH';
  prepareSeconds: number;
  fallbackDelaySeconds: number;
  /** 댓글터치 판매 방식. 없으면 기본. */
  salesMode?: TouchSalesMode;
  /** 캡처 안 함: 사진을 찍지 않고 PC 화면 공유도 받지 않는다. */
  captureOff?: boolean;
  /** 폰 단독 판매에서 댓글을 받을 틱톡 ID(@ 제외). 서버 touch-tiktok-id로 저장. */
  tiktokId?: string;
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
  transport?: TouchTransport;
  phoneCount?: number;
  /** 폰 단독 판매(PC 없음). */
  phoneOnly?: boolean;
}
export interface TouchCommit {
  operationId: string;
  sessionId: string;
  comment: Pick<
    CommentRecord,
    | 'platformMessageId'
    | 'platformUserId'
    | 'uniqueId'
    | 'nickname'
    | 'content'
    | 'capturedAt'
  >;
  inputPrice: string;
  unitPrice: number;
  quantity: number;
  productId?: string;
  confirmedAt: string;
  clientConfirmedAt: string;
  clockOffsetMs: number;
  allowAdditional?: boolean;
  retargetedFromOperationId?: string;
  originalConfirmedAt?: string;
  skipCapture?: boolean;
  /** 상품번호·사이즈·색상 방식의 번호 상품 이름(예: "1번"). 회차마다 같은 이름이면 같은 상품. */
  productLabel?: string;
  /** 전표 셋째 줄(예: "2번 · 블랙 M"). */
  slipLine?: string;
  captureOff?: boolean;
  /** 지난 번호 판매: 그 번호의 사진을 다시 쓰고 새로 찍지 않는다. */
  reuseProductPhoto?: boolean;
}
export interface TouchCommitResult {
  saleId: string;
  buyerId: string;
  commentId: string;
  amount: number;
  captureDueAt: string;
}
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
  source?: string;
  touchSale?: boolean;
  recordState?: string;
  reviewDecision?: string;
}
export interface TouchRun {
  session_id: string;
  producer_id: string;
  running: boolean;
  lease_expires_at: string;
  settings: TouchSettings;
  last_state?: Partial<TouchPcState>;
}
