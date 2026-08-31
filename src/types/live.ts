export type SaleStatus = '자동저장' | '수동수정' | '확정' | '보류';
export type SalePrintStatus = 'NOT_REQUESTED' | 'QUEUED' | 'PRINTED' | 'FAILED';

export interface SaleRecord {
  id: string;
  sessionId: string;           // 방송 회차 ID (예: 20260824_02)
  buyerNickname: string;       // 구매자 닉네임
  amount: number;              // 판매 금액 (원)
  recognizedAt: string;        // 인식 일시 (ISO string)
  rawTranscript: string;       // 원본 전사 문장
  status: SaleStatus;          // 상태 (자동저장, 수동수정, 확정, 보류)
  productName?: string;        // 판매 상품명 (판매자 직접 입력 또는 음성 추출)
  captureImageUrls?: string[]; // 연결된 화면 캡처 이미지 URL 목록
  note?: string;               // 메모
  /** 댓글 도우미를 통한 로컬 프린터 출력 상태 */
  printStatus?: SalePrintStatus;
  /** 같은 판매를 수정하여 재출력할 때 증가하는 출력 작업 번호 */
  printRevision?: number;
  printedAt?: string;
  printError?: string;
}

export interface CaptureItem {
  id: string;
  saleId?: string;             // 연결된 판매 내역 ID (있을 경우)
  sessionId: string;           // 방송 회차 ID
  imageUrl: string;            // 캡처 이미지 Data URL or URL
  capturedAt: string;          // 캡처 일시
  areaName: string;            // '댓글 목록' | '주문 내역' | '화면 전체' | '사용자 지정'
  triggerWord: string;         // '캡처' 등 트리거 단어
  note?: string;
}

export interface LiveSession {
  sessionId: string;           // YYYYMMDD_HH 형식
  startedAt: string;
  endedAt?: string;
  isActive: boolean;
  totalSalesCount: number;
  totalSalesAmount: number;
  captureCount: number;
}

export interface SttTranscriptLog {
  id: string;
  timestamp: string;
  text: string;
  isFinal: boolean;
  confidence: number;
  matchedKeywords?: string[];
  actionTriggered?: 'SALE_SAVED' | 'SCREEN_CAPTURED' | 'VOICE_EDIT_START' | 'VOICE_EDIT_DONE' | 'NONE';
}

export type VoiceEditState = 'IDLE' | 'LISTENING_FIELD' | 'CONFIRMING';
