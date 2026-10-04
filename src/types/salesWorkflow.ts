export const WORKFLOW_MODULES = ["DIRECT", "ORDER_CODE"] as const;
export interface SalesWorkflowProfile {
  schemaVersion: 1;
  modules: Array<(typeof WORKFLOW_MODULES)[number]>;
  defaultQuantity: number;
  requestWindowSeconds: number;
  offerLifetimeSeconds: number;
  purchaseExpressions: string[];
  confirmationExpressions: string[];
  exclusionExpressions: string[];
}
export interface AppliedSalesWorkflow {
  id: string;
  version: number;
  mode: "SHADOW" | "ACTIVE";
  profile: SalesWorkflowProfile;
}
export interface WorkflowTranscript {
  id: string;
  text: string;
  /** Capture-clock start of this fragment; not provider response arrival time. */
  recognizedAt: string;
  /** Stable transcription tokens do not imply a completed utterance. */
  isFinal?: boolean;
  startedAt?: string;
  endedAt?: string;
  receivedAt?: string;
  utteranceId?: string;
  utteranceEnded?: boolean;
  /** Same-ID updates revise boundary metadata without appending the text again. */
  revision?: number;
  endReason?: 'endpoint' | 'flush' | 'finalize' | 'stream_end' | 'rotation';
}
export interface WorkflowDecision {
  id: string;
  sessionId: string;
  offerId: string;
  orderCode?: string;
  requestId?: string;
  commentId?: string;
  buyerId?: string;
  nickname: string;
  spokenNickname: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  recognizedAt: string;
  transcriptId: string;
  priceTranscriptId?: string;
  priceQuote?: string;
  rawTranscript: string;
  stock?: number;
  reasons: string[];
  status: "CONFIRMED" | "REVIEW";
}
export interface WorkflowEvidence {
  decisionId: string;
  profileId: string;
  profileVersion: number;
  offerId: string;
  orderCode?: string;
  profileSnapshot?: SalesWorkflowProfile;
  transcripts: WorkflowTranscript[];
}
