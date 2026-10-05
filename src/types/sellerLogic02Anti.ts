import type { CommentRecord } from './comment';
import type { WorkflowTranscript } from './salesWorkflow';

export type SellerLogicStatus = 'CONFIRMED' | 'PENDING' | 'REVIEW' | 'CANCELLED';

export interface SellerLogic02AntiDecision {
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
  spokenNickname?: string;
  lineKey?: string;
  decidedAt: string;
}

export interface SellerLogic02AntiResult {
  summary: string;
  purchaseIntentCommentIds: string[];
  decisions: SellerLogic02AntiDecision[];
  provider?: string;
  model?: string;
}

export interface SellerLogic02AntiInput {
  sessionId: string;
  slotNumber: 1 | 2;
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
  previousDecisions?: SellerLogic02AntiDecision[];
}

export interface AiDebugLog {
  id: string;
  timestamp: string;
  type: 'REQUEST' | 'RESPONSE' | 'ERROR';
  slotNumber: 1 | 2;
  model?: string;
  message: string;
  payload?: any;
}

export interface SttDebugLog {
  id: string;
  timestamp: string;
  type: 'IMMEDIATE_TRIGGER' | 'BATCH_COOLDOWN' | 'VOCAB_UPDATE' | 'HANDOVER' | 'AUDIO_BUFFER';
  message: string;
  details?: any;
}
