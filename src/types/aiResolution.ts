/**
 * 판매 보류 해결 및 음성 정정 AI 공통 요청/응답 규격 (PLAN.md 1-A, 1-B, 2, 3 준수)
 */

export type AiTaskType = 'PENDING_RESOLUTION' | 'VOICE_CORRECTION' | 'SYNTHETIC_TEST';

export interface AiUtteranceContext {
  id?: string;
  text: string;
  timestamp?: string;
  speakerRole?: 'SELLER' | 'BUYER' | 'SYSTEM';
}

export interface AiCommentContext {
  commentId: string;
  nickname: string;
  text: string;
  timestamp?: string;
}

export interface AiSaleCandidate {
  saleId: string;
  productCode: string;
  productName?: string;
  buyerNickname: string;
  buyerId?: string;
  amount: number;
  unitPrice?: number;
  quantity: number;
  status: string;
  createdAt?: string;
}

export interface AiResolutionRequest {
  taskId?: string;
  taskType: AiTaskType;
  workspaceId: string;
  sessionId: string;
  currentUtterance: string;
  priorUtterances?: AiUtteranceContext[];
  relevantComments?: AiCommentContext[];
  saleCandidates?: AiSaleCandidate[];
  activeProduct?: {
    productCode: string;
    productName?: string;
    unitPrice?: number;
  };
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export interface BuyerCorrectionChange {
  from?: string;
  to?: string;
  buyerId?: string;
}

export interface AmountCorrectionChange {
  from?: number;
  to?: number;
  unitPrice?: number;
  quantity?: number;
}

export interface ProductCodeCorrectionChange {
  from?: string;
  to?: string;
}

export interface AiStructuredChanges {
  buyerNickname?: BuyerCorrectionChange;
  amount?: AmountCorrectionChange;
  productCode?: ProductCodeCorrectionChange;
}

export type AiResolutionAction =
  | 'UPDATE_SALE'        // 판매 값 정정/보완
  | 'CANCEL_CORRECTION'  // 정정 요청 철회 (예: "방금 수정한 거 취소할게요")
  | 'KEEP_PENDING'       // 보류 유지 (추가 발화/댓글 대기)
  | 'INSUFFICIENT_DATA'; // 자료 부족

export interface AiExecutionMeta {
  adapterType: 'SELF_HOSTED' | 'CLOUD';
  routingMode: 'SERVER_DIRECT' | 'PC_HELPER';
  location?: 'SAME_PC' | 'LAN' | 'EXTERNAL_IP';
  provider: string;
  model: string;
  latencyMs: number;
  tokensUsed?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  rawResponse?: string;
}

/**
 * 두 어댑터(자체 운영 및 클라우드)가 공통으로 반환하는 구조화된 결과
 */
export interface AiResolutionResult {
  resolvable: boolean;                    // 처리 가능 여부 (근거가 충분하여 결론을 낼 수 있는가)
  targetSaleId: string | null;            // 특정된 판매 후보 ID (불명확시 null)
  action: AiResolutionAction;             // 권장 조치
  changes: AiStructuredChanges | null;    // 변경 전후 값
  evidenceIds: string[];                  // 근거 ID 목록 (발화, 댓글, 상품 등)
  evidenceSummary: string;                // 근거 요약 설명
  missingInfo: string[];                  // 부족한 정보 목록 (예: ["상품번호 누락", "구매자 특정 불가"])
  conflictReason: string | null;          // 충돌 사유 (예: "후보 구매자 2명 존재")
  execution: AiExecutionMeta;             // 실행 메타데이터
}
