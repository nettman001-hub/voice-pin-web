import type { CommentRecord } from "./comment.ts";
import type { WorkflowTranscript } from "./salesWorkflow.ts";

export type SellerLogicDeepStatus = "CONFIRMED" | "PENDING" | "REVIEW" | "CANCELLED";

export type SellerLogicDeepSignalKind =
  | "BUYER_INTENT"
  | "SELLER_ALLOCATE"
  | "PRODUCT_ANNOUNCE"
  | "PRICE_QUOTE"
  | "PRICE_CORRECTION"
  | "STOCK"
  | "CANCEL"
  | "INQUIRY"
  | "NOISE";

/** AI-authored carry for the next time bucket. */
export interface SellerLogicDeepContextItem {
  text: string;
  commentIds: string[];
  transcriptIds: string[];
  /** AI kept a carry item without any source reference; shown for manual review only. */
  sourcesMissing?: boolean;
}

export interface SellerLogicDeepDecision {
  /**
   * sld: evidence identity. The same ID is revised when the AI updates or
   * cancels a transaction so the browser merges instead of duplicating.
   */
  id: string;
  status: SellerLogicDeepStatus;
  nickname: string | null;
  unitPrice: number | null;
  quantity: number;
  reason: string;
  commentIds: string[];
  transcriptIds: string[];
  decidedAt: string;
  spokenNickname?: string;
  productName?: string;
  orderCode?: string;
  /** AI distinguishes multiple product lines sharing the same evidence. */
  lineKey?: string;
}

export interface SellerLogicDeepSignal {
  id: string;
  kind: SellerLogicDeepSignalKind;
  summary: string;
  commentIds: string[];
  transcriptIds: string[];
}

/** One time bucket of the broadcast. Boundaries are mechanical, meaning is AI. */
export interface SellerLogicDeepSegment {
  id: string;
  index: number;
  startedAt: string;
  endedAt: string;
  closed: boolean;
  commentIds: string[];
  transcriptIds: string[];
}

export interface SellerLogicDeepInput {
  sessionId: string;
  slotNumber: 1 | 2;
  segment: SellerLogicDeepSegment;
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
  context: SellerLogicDeepContextItem[];
  previousDecisions: SellerLogicDeepDecision[];
}

export interface SellerLogicDeepWarning {
  id: string;
  at: string;
  segmentId?: string;
  message: string;
}

export interface SellerLogicDeepResult {
  /** Complete cumulative decision snapshot for the session. */
  decisions: SellerLogicDeepDecision[];
  signals: SellerLogicDeepSignal[];
  context: SellerLogicDeepContextItem[];
  /** Evidence-less carry accumulated for manual review; never sent to the AI. */
  unreviewedContext: SellerLogicDeepContextItem[];
  segments: SellerLogicDeepSegment[];
  summary: string;
  provider: string;
  model: string;
  appliedVersion: number;
  stats: { segmentCalls: number; segmentMs: number };
  warnings?: SellerLogicDeepWarning[];
}

export interface SellerLogicDeepEngineState {
  slotNumber: 1 | 2;
  processedSegments: Record<string, string>;
  context: SellerLogicDeepContextItem[];
  unreviewedContext: SellerLogicDeepContextItem[];
  decisions: SellerLogicDeepDecision[];
  provider?: string;
  model?: string;
  appliedVersion?: number;
  stats: { segmentCalls: number; segmentMs: number };
  warnings?: SellerLogicDeepWarning[];
}

export const SELLER_LOGIC_DEEP_LIMITS = {
  segmentEvents: 40,
  segmentCharacters: 7_000,
  segmentIdleMs: 25_000,
  segmentMaxMs: 5 * 60_000,
  decisions: 200,
  contextItems: 30,
  signals: 50,
  timeoutSeconds: 120,
  promptCharacters: 30_000,
  /** Previous decision reasons are abbreviated on the wire; the browser keeps the full text. */
  wireReasonCharacters: 400,
} as const;
