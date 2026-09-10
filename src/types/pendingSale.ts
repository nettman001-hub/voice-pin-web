/**
 * 자동 적재 판매 보류 해결 및 근거 보존 관련 타입 정의 (PLAN.md 1-A 및 5단계 준수)
 */

export type PendingReasonCode =
  | 'MISSING_NICKNAME'               // 닉네임 미추출 또는 미인식
  | 'TRAILING_DIGITS_ONLY'           // 끝번호만 인식되어 특정 필요
  | 'MISSING_AMOUNT'                 // 금액 누락 또는 0원
  | 'SPLIT_UTTERANCE'                // 여러 문장으로 나뉜 분리 발화 대기
  | 'DELAYED_COMMENT'                // 댓글 지연 (아직 방송 댓글에 일치하는 구매자가 없음)
  | 'MULTIPLE_CANDIDATES_CONFLICT';  // 복수 후보 존재 또는 가격 충돌

export interface StructuredPendingReason {
  code: PendingReasonCode;
  message: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: 'RULE' | 'AI' | 'MANUAL';
  resolutionDetails?: string;
}

export interface PendingEvidenceSnapshot {
  originalUtterance: string;         // 원본 발화
  recognizedAt: string;              // 인식 일시
  relevantCommentIds: string[];      // 관련 댓글 ID 목록
  productCode?: string;              // 상품 코드
  productName?: string;              // 상품명
  unitPrice?: number;                // 단가
  quantity?: number;                 // 수량
  amount?: number;                   // 총액
  captureImageUrls?: string[];       // 화면 캡처 이미지 URL 목록
  snapshotVersion: number;           // 근거 스냅샷 버전
  snapshotHash?: string;             // 근거 변경 감지 해시
}

export interface AiVerificationMeta {
  aiStatus: 'NONE' | 'CHECKING' | 'RESOLVED' | 'INSUFFICIENT_DATA' | 'NEEDS_SELLER_CONFIRM';
  aiTaskId?: string;
  appliedSlot?: 1 | 2;
  resolutionSummary?: string;
  candidateBuyer?: {
    buyerId: string;
    nickname: string;
  };
  candidateAmount?: number;
  validatedAt?: string;
}

export interface SaleHistoryRecord {
  revision: number;
  changedAt: string;
  changedBy: 'SYSTEM' | 'AI' | 'SELLER';
  changeType: 'INITIAL_AUTO_SAVE' | 'RULE_RESOLVE' | 'AI_RESOLVE' | 'MANUAL_EDIT' | 'BATCH_CONFIRM' | 'VOICE_CORRECTION' | 'CORRECTION_ROLLBACK';
  before: {
    buyerNickname?: string;
    amount?: number;
    status?: string;
    productCode?: string;
    pendingReasons?: StructuredPendingReason[];
  };
  after: {
    buyerNickname?: string;
    amount?: number;
    status?: string;
    productCode?: string;
    pendingReasons?: StructuredPendingReason[];
  };
  summary: string;
  appliedSlot?: 1 | 2;
  switchReason?: string;
  failoverAttempted?: boolean;
  evidenceIds?: string[];
  evidenceSummary?: string;
}

export interface ResolvePendingSalePayload {
  workspaceId: string;
  saleId: string;
  expectedRevision: number;
  resolvedBy: 'RULE' | 'AI' | 'MANUAL';
  changes: {
    buyerNickname?: string;
    buyerId?: string;
    amount?: number;
    unitPrice?: number;
    quantity?: number;
    productCode?: string;
    productId?: string;
  };
  resolvedReasonCodes: PendingReasonCode[];
  resolutionDetails?: string;
  evidenceSnapshotVersion?: number;
}

export interface BatchConfirmResult {
  totalRequested: number;
  confirmedCount: number;
  confirmedSaleIds: string[];
  skippedCount: number;
  skippedSales: Array<{
    saleId: string;
    buyerNickname: string;
    amount: number;
    remainingReasons: string[];
  }>;
}
