import type { AiConversationTrace } from "./aiTask";
import type {
  SalesWorkflowProfile,
  WorkflowDecision,
  WorkflowTranscript,
} from "./salesWorkflow";
import type { CommentRecord } from "./comment";

export type SellerAnalysisSlot = 1 | 2;
export const SELLER_ANALYSIS_SLOT_TIMEOUT_SECONDS = 120;
export const SELLER_ANALYSIS_BUSY_TIMEOUT_MS = 5 * 60 * 1000;

export interface SellerAnalysisInput {
  sellerName: string;
  sellerUserId: string | null;
  adminDescription: string;
  commentText: string;
  transcriptText: string;
  broadcastUsername?: string;
  sessionId?: string;
  comments?: CommentRecord[];
  transcripts?: WorkflowTranscript[];
}

export const SELLER_ANALYSIS_LIMITS = {
  sellerName: 120,
  adminDescription: 8000,
  commentText: 24000,
  transcriptText: 48000,
  feedback: 4000,
  feedbackTurns: 10,
} as const;

export type SellerAnalysisStatus =
  | "DRAFT"
  | "ANALYZING"
  | "REVIEW"
  | "APPROVED"
  | "FAILED";

export interface SellerAnalysisReport {
  profile: SalesWorkflowProfile;
  summary: string;
  workflow: string[];
  purchaseSignals: string[];
  confirmationSignals: string[];
  priceRules: string[];
  nicknameRules: string[];
  inventoryRule: string;
  exceptions: string[];
  unknowns: string[];
  suggestions: string[];
  supportAssessment: "SUPPORTED" | "NEEDS_REVIEW" | "NEW_MODULE_REQUIRED";
}

export interface SellerAnalysisAttempt {
  slot: 1 | 2;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  error: string | null;
  conversationTrace: AiConversationTrace | null;
}

export interface SellerAnalysisReportVersion {
  version: number;
  requestedSlot?: SellerAnalysisSlot;
  inputRevision: number;
  input: SellerAnalysisInput;
  report: SellerAnalysisReport;
  attempts: SellerAnalysisAttempt[];
  createdAt: string;
  verification?: {
    decisions: WorkflowDecision[];
    reviewed: boolean;
    verifiedAt: string;
  };
}

export interface SellerAnalysisMessage {
  id: string;
  role: "ADMIN" | "ASSISTANT" | "SYSTEM";
  content: string;
  revision: number;
  reportVersion: number | null;
  attempts?: SellerAnalysisAttempt[];
  /** Server-created handoff to a second request; excluded from list summaries. */
  continuation?: {
    requestedSlot: SellerAnalysisSlot;
    nextSlot: SellerAnalysisSlot;
    settingId: string;
    settingVersion: number;
    feedback: string;
  };
  createdAt: string;
}

export interface SellerAnalysisSummary {
  id: string;
  input: SellerAnalysisInput;
  revision: number;
  status: SellerAnalysisStatus;
  currentReportVersion: number | null;
  approvedReportVersion: number | null;
  approvedRevision: number | null;
  approvedAt: string | null;
  approvedBy?: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SellerAnalysisDocument extends SellerAnalysisSummary {
  reports: SellerAnalysisReportVersion[];
  messages: SellerAnalysisMessage[];
}
