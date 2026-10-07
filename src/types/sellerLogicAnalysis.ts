import type { CommentRecord } from "./comment.ts";
import type { WorkflowTranscript } from "./salesWorkflow.ts";
import type { SellerLogicPipelineState, SellerLogicDetectedSignal } from './sellerLogicPipeline.ts';

export type SellerLogicStatus = "CONFIRMED" | "PENDING" | "REVIEW" | "CANCELLED";

/** Read-only labels from the same applied settings used by pending/correction AI. */
export interface SellerLogicSlots {
  appliedVersion: number;
  primarySlot: 1 | 2;
  slots: Array<{ slotNumber: 1 | 2; provider: string; model: string }>;
  hintsAccount?: string;
  presetWords?: string[];
  ruleWords?: string[];
}

export interface SellerLogicDecision {
  /** Server-issued evidence identity, retained when the AI revises a transaction. */
  id: string;
  status: SellerLogicStatus;
  nickname: string | null;
  unitPrice: number | null;
  quantity: number;
  reason: string;
  commentIds: string[];
  transcriptIds: string[];
  productName?: string;
  orderCode?: string;
  decidedAt: string;
  spokenNickname?: string;
  /** AI distinguishes transaction lines sharing the same source evidence. */
  lineKey?: string;
}

export interface SellerLogicAnalysisInput {
  sessionId: string;
  slotNumber: 1 | 2;
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
  previousDecisions?: SellerLogicDecision[];
  analysisState?: SellerLogicAnalysisState;
  pipeline?: SellerLogicPipelineState;
  /** Candidates from stage one; stage two must independently read the source. */
  linkSignals?: SellerLogicDetectedSignal[];
  linkWindow?: { page: number; hasMore: boolean; totalEvents: number; analyzedEvents: number };
  /** A bounded network packet. The complete broadcast stays in the browser. */
  incremental?: {
    newCommentIds: string[];
    newTranscriptIds: string[];
    historyQueries: string[];
    historyExhausted: boolean;
    omittedEvents: number;
    omittedDecisions: number;
  };
}

/** AI-authored context, with source references preserved across chronological windows. */
export interface SellerLogicMemoryItem {
  text: string;
  commentIds: string[];
  transcriptIds: string[];
}

export interface SellerLogicAnalysisState {
  processedCommentIds: string[];
  processedTranscriptIds: string[];
  memory: SellerLogicMemoryItem[];
  purchaseIntentCommentIds: string[];
  slotNumber: 1 | 2;
  appliedVersion: number;
}

export interface SellerLogicAnalysisResult {
  /** Complete snapshot, including unchanged and cancelled earlier decisions. */
  decisions: SellerLogicDecision[];
  purchaseIntentCommentIds: string[];
  summary: string;
  provider: string;
  model: string;
  analysisState: SellerLogicAnalysisState;
  hasMore: boolean;
  /** AI-selected literal search terms; no source is acknowledged until resolved. */
  historyRequests?: string[];
  retractedPurchaseIntentCommentIds?: string[];
  pipeline?: SellerLogicPipelineState;
  signalLinks?: Array<{ signalId: string; outcome: 'MATCHED' | 'UNMATCHED' | 'NOT_SALE'; decisionIds: string[] }>;
}

export const SELLER_LOGIC_LIMITS = {
  comments: 2000,
  transcripts: 2000,
  inputCharacters: 500_000,
  decisions: 1000,
  timeoutSeconds: 120,
  windowEvents: 30,
  overlapEvents: 20,
  memoryItems: 50,
  packetCharacters: 32_000,
  promptCharacters: 30_000,
} as const;
