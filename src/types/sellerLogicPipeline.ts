import type { CommentRecord } from './comment.ts';
import type { WorkflowTranscript } from './salesWorkflow.ts';

export interface SellerLogicCarry {
  reason: string;
  commentIds: string[];
  transcriptIds: string[];
}

export interface SellerLogicDetectedSignal {
  id: string;
  summary: string;
  commentIds: string[];
  transcriptIds: string[];
}

export interface SellerLogicSignal extends SellerLogicDetectedSignal {
  startedAt: string;
  endedAt: string;
  observedUntil: string;
  status: 'WATCHING' | 'LINKED' | 'UNMATCHED' | 'DISMISSED';
  decisionIds: string[];
  needsAnalysis: boolean;
  observationClosed: boolean;
  lastAnalyzedFingerprint?: string;
  lastAnalyzedAt?: string;
}

export interface SellerLogicDetectionInput {
  sessionId: string;
  slotNumber: 1 | 2;
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
  /** Includes changed revisions of an existing STT row. */
  freshCommentIds: string[];
  freshTranscriptIds: string[];
  existingSignals: SellerLogicDetectedSignal[];
  carry: SellerLogicCarry[];
}

export interface SellerLogicDetectionResult {
  signals: SellerLogicDetectedSignal[];
  carry: SellerLogicCarry[];
  /** AI-classified purchase requests, available before stage-two sale linking. */
  purchaseIntentCommentIds?: string[];
  summary: string;
  provider: string;
  model: string;
  appliedVersion: number;
}

/** Local browser state. Never send the entire pipeline state to the backend. */
export interface SellerLogicPipelineState {
  slotNumber: 1 | 2;
  seenRevisions: Record<string, string>;
  carry: SellerLogicCarry[];
  signals: SellerLogicSignal[];
  observedThrough: number;
  provider?: string;
  model?: string;
  appliedVersion?: number;
  stats: { detectCalls: number; linkCalls: number; detectMs: number; linkMs: number };
}
