/**
 * 판매자 로직분석01opus — 실시간 AI 판매 확정 도구의 공용 타입.
 * 브라우저(관리자 화면)와 Edge Function(sales-api)이 같은 정의를 쓴다.
 */

export type LogicOpusSlot = 1 | 2;

export type LogicOpusSalesMode =
  | 'AUTO'
  | 'FREE_TALK'
  | 'NUMBER_CALL'
  | 'NUMBERED_PRODUCT';

export const LOGIC_OPUS_SALES_MODE_LABELS: Record<LogicOpusSalesMode, string> = {
  AUTO: 'AI 자동 인식',
  FREE_TALK: '저요형 (저요·ㅈㅇ)',
  NUMBER_CALL: '번호형 (1·5·7 댓글)',
  NUMBERED_PRODUCT: '상품번호형 (숫자 1번, 가격 0.9)',
};

export interface LogicOpusCommentEvent {
  id: string;
  kind: 'COMMENT';
  at: string;
  nickname: string;
  uniqueId?: string;
  text: string;
}

export interface LogicOpusSpeechEvent {
  id: string;
  kind: 'SPEECH';
  at: string;
  text: string;
  /** 청취 시작 기준 오디오 시각(ms). 재생 테스트에서는 없을 수 있다. */
  audioStartMs?: number;
  audioEndMs?: number;
  sttSessionNo?: number;
}

export type LogicOpusEvent = LogicOpusCommentEvent | LogicOpusSpeechEvent;

export type LogicOpusEventType =
  | 'PURCHASE_INTENT'
  | 'PRODUCT_ANNOUNCE'
  | 'PRICE_CHANGE'
  | 'SELLER_CONFIRM'
  | 'OPTION_CHANGE'
  | 'SOLD_OUT'
  | 'CANCEL'
  | 'QUESTION'
  | 'ANSWER'
  | 'CHATTER';

export interface LogicOpusClassification {
  eventId: string;
  type: LogicOpusEventType;
  target?: string;
  confidence: number;
}

export interface LogicOpusProductOption {
  no?: number;
  label: string;
  price?: number;
  limit?: number;
}

export interface LogicOpusProductState {
  name: string;
  price: number | null;
  options: LogicOpusProductOption[];
  salesMode: Exclude<LogicOpusSalesMode, 'AUTO'> | null;
  note?: string;
}

export interface LogicOpusLedgerCreateOp {
  op: 'CREATE';
  buyerNickname: string;
  spokenName?: string;
  product: string;
  option?: string;
  price: number | null;
  quantity?: number;
  confidence: number;
  evidence: string[];
  reason: string;
  alternatives?: string[];
}

export interface LogicOpusLedgerUpdateOp {
  op: 'UPDATE';
  saleId: string;
  buyerNickname?: string;
  product?: string;
  option?: string;
  price?: number | null;
  quantity?: number;
  confidence?: number;
  evidence?: string[];
  reason: string;
}

export interface LogicOpusLedgerCancelOp {
  op: 'CANCEL';
  saleId: string;
  reason: string;
  evidence?: string[];
}

export type LogicOpusLedgerOp =
  | LogicOpusLedgerCreateOp
  | LogicOpusLedgerUpdateOp
  | LogicOpusLedgerCancelOp;

export interface LogicOpusJudgement {
  classifications: LogicOpusClassification[];
  productState: LogicOpusProductState | null;
  ledgerOps: LogicOpusLedgerOp[];
  sttHintRequest: boolean;
}

export type LogicOpusSaleStatus = 'CONFIRMED' | 'REVIEW' | 'CANCELLED';
export type LogicOpusPrintStatus = 'NOT_REQUESTED' | 'QUEUED' | 'PRINTED' | 'FAILED';

export interface LogicOpusSaleHistory {
  at: string;
  action: 'CREATE' | 'UPDATE' | 'CANCEL' | 'MANUAL' | 'PRINT';
  summary: string;
  by: 'AI' | 'ADMIN' | 'SYSTEM';
}

export interface LogicOpusSale {
  id: string;
  /** 리스트 표시용 일련번호 (1부터) */
  seq: number;
  createdAt: string;
  updatedAt: string;
  buyerNickname: string;
  spokenName?: string;
  product: string;
  option?: string;
  price: number | null;
  quantity: number;
  confidence: number;
  status: LogicOpusSaleStatus;
  reviewReasons: string[];
  candidates: string[];
  evidence: string[];
  reason: string;
  corrected: boolean;
  duplicateOf?: string;
  printStatus: LogicOpusPrintStatus;
  printRevision: number;
  printError?: string;
  history: LogicOpusSaleHistory[];
}

export interface LogicOpusNicknameCandidate {
  nickname: string;
  score: number;
  matchedForm: string;
  recentIntent: boolean;
}

export interface LogicOpusSpokenNameCandidates {
  eventId: string;
  spoken: string;
  candidates: LogicOpusNicknameCandidate[];
}

export interface LogicOpusOpenIntent {
  eventId: string;
  nickname: string;
  text: string;
  at: string;
  target?: string;
}

export interface LogicOpusJudgeRequest {
  runId: string;
  slotNumber: LogicOpusSlot;
  autoFallback: boolean;
  salesMode: LogicOpusSalesMode;
  sellerNicknames: string[];
  newEvents: LogicOpusEvent[];
  recentEvents: LogicOpusEvent[];
  productState: LogicOpusProductState | null;
  openIntents: LogicOpusOpenIntent[];
  ledger: Array<Pick<LogicOpusSale, 'id' | 'buyerNickname' | 'product' | 'option' | 'price' | 'quantity' | 'status' | 'createdAt'>>;
  nicknameCandidates: LogicOpusSpokenNameCandidates[];
  knownNicknames: string[];
}

export interface LogicOpusAttempt {
  slot: LogicOpusSlot;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
  errorCode?: string;
}

export interface LogicOpusJudgeResponse {
  judgement: LogicOpusJudgement | null;
  usedSlot: LogicOpusSlot | null;
  attempts: LogicOpusAttempt[];
  error?: string;
}

export interface LogicOpusSlotInfo {
  slot: LogicOpusSlot;
  type: string;
  provider: string;
  model: string;
  ready: boolean;
  note?: string;
}

export interface LogicOpusRunSummary {
  id: string;
  broadcastUsername: string;
  mode: 'LIVE' | 'REPLAY';
  slotNumber: LogicOpusSlot;
  startedAt: string;
  endedAt: string | null;
  saleCount: number;
  totalAmount: number;
}

export const LOGIC_OPUS_LIMITS = {
  /** STT에 보내는 닉네임 수 */
  HINT_NICKNAMES: 50,
  /** Soniox context.terms 전체 상한 (고정 단어 + 닉네임 + 발음) */
  HINT_TERMS: 100,
  /** 힌트 갱신(세션 교체) 최소 간격 */
  HINT_MIN_INTERVAL_MS: 5_000,
  /** 겹침 교체에서 두 세션에 동시에 보내는 최대 길이 */
  OVERLAP_MAX_MS: 3_000,
  /** 자르는 지점으로 쓸 무음 길이 */
  OVERLAP_SILENCE_MS: 250,
  /** 새 세션이 열리기를 기다리는 시간 */
  ROTATION_OPEN_TIMEOUT_MS: 5_000,
  /** 끊김 대비 오디오 보관 길이 */
  RING_BUFFER_MS: 15_000,
  /** 판단 묶음 대기 */
  JUDGE_DEBOUNCE_MS: 1_200,
  /** AI에게 보내는 최근 문맥 길이 */
  RECENT_WINDOW_MS: 180_000,
  /** 닉네임 후보로 보는 댓글 기간 */
  CANDIDATE_WINDOW_MS: 600_000,
  /** 슬롯당 판단 대기 시간(초) */
  JUDGE_TIMEOUT_SECONDS: 12,
  /** 자동 확정 신뢰도 */
  CONFIRM_CONFIDENCE: 0.8,
  /** 같은 구매자·상품 재확정을 중복으로 보는 기간 */
  DUPLICATE_WINDOW_MS: 90_000,
  MAX_NEW_EVENTS: 60,
  MAX_RECENT_EVENTS: 120,
  MAX_LEDGER_CONTEXT: 30,
} as const;
