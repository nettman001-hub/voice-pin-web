import type { SaleRecord } from '../types/live.ts';
import type { CommentRecord } from '../types/comment.ts';
import type { AiTask } from '../types/aiTask.ts';
import type { AiResolutionRequest } from '../types/aiResolution.ts';
import { buildVoiceReviewRequest, buildVoiceTextReviewPrompt, validateVoiceReviewResult,
  validateVoiceTextReviewAnswer, voiceReviewFingerprint, voiceTextReviewFingerprint,
  type ReviewTranscript } from './voicePendingReviewService.ts';

export function prepareVoicePendingReview(sale: SaleRecord, comments: CommentRecord[], logs: ReviewTranscript[], followingText: string, workspaceId: string) {
  const textReview = !sale.workflowEvidence;
  const fingerprint = textReview ? voiceTextReviewFingerprint(sale, comments, logs)
    : voiceReviewFingerprint(sale, comments, followingText, logs);
  const request: AiResolutionRequest = textReview ? {
    taskType: 'PENDING_RESOLUTION', workspaceId, sessionId: sale.sessionId,
    currentUtterance: sale.rawTranscript, plainTextPrompt: buildVoiceTextReviewPrompt(sale, comments, logs),
    saleCandidates: [{ saleId: sale.id, productCode: sale.productCode || '', buyerNickname: sale.buyerNickname,
      buyerId: sale.buyerId, amount: sale.amount, quantity: sale.quantity || 1, status: sale.status }],
  } : { ...buildVoiceReviewRequest(sale, comments, followingText, logs), workspaceId };
  return { textReview, fingerprint, request };
}

export function evaluateVoicePendingReview(sale: SaleRecord, comments: CommentRecord[], logs: ReviewTranscript[],
  followingText: string, task: AiTask | null, fingerprint: string, processingError?: string) {
  const meta = !sale.workflowEvidence
    ? validateVoiceTextReviewAnswer(sale, comments, task?.resolutionResult?.evidenceSummary ?? null,
      task?.activeSlot || 1, task?.taskId || '', fingerprint)
    : validateVoiceReviewResult(sale, comments, task?.resolutionResult || null,
      task?.activeSlot || 1, task?.taskId || '', fingerprint, followingText, logs);
  if (processingError) meta.errorMessage = processingError;
  return meta;
}

export function applyVoicePendingReview(sale: SaleRecord, comments: CommentRecord[], logs: ReviewTranscript[],
  followingText: string, meta: ReturnType<typeof evaluateVoicePendingReview>, task: AiTask | null): SaleRecord {
  const rejected = meta.reviewDecision === 'NOT_SALE';
  const next = { ...sale };
  if (!rejected && meta.candidateAmount && meta.saleConfirmed) next.amount = next.unitPrice = meta.candidateAmount;
  if (!rejected && meta.nicknameVerified && meta.candidateBuyer) {
    next.buyerNickname = meta.candidateBuyer.nickname;
    next.buyerId = meta.candidateBuyer.buyerId || undefined;
    next.purchaseRequestId = meta.candidatePurchaseRequestId;
    next.sourceCommentIds = meta.candidateCommentId ? [meta.candidateCommentId] : [];
  }
  const changed = next.amount !== sale.amount || next.buyerNickname !== sale.buyerNickname
    || next.buyerId !== sale.buyerId || next.purchaseRequestId !== sale.purchaseRequestId;
  next.revision = (sale.revision || 1) + (changed ? 1 : 0);
  meta.reviewFingerprint = !sale.workflowEvidence ? voiceTextReviewFingerprint(next, comments, logs)
    : voiceReviewFingerprint(next, comments, followingText, logs);
  const history = { revision: next.revision, changedAt: new Date().toISOString(), changedBy: 'AI' as const, changeType: 'AI_RESOLVE' as const,
    before: { status: sale.status, buyerNickname: sale.buyerNickname, amount: sale.amount },
    after: { status: rejected ? '취소' as const : sale.status, buyerNickname: next.buyerNickname, amount: next.amount },
    summary: meta.resolutionSummary || '', appliedSlot: task?.activeSlot, switchReason: task?.switchReason || undefined,
    failoverAttempted: Boolean((task?.attempts?.length || 0) > 1), evidenceIds: task?.resolutionResult?.evidenceIds || [] };
  return { ...next, aiVerification: meta, history: [...(sale.history || []), history],
    ...(rejected ? { status: '취소' as const, recordState: 'CANCELLED' as const, printStatus: 'NOT_REQUESTED' as const } : {}) };
}
