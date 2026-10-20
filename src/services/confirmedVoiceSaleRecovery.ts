import type { SaleRecord } from '../types/live.ts';
import type { CommentRecord } from '../types/comment.ts';
import type { AiVerificationMeta } from '../types/pendingSale.ts';
import { getVoiceTextReviewComments, getVoiceTextReviewTargetPrice, validateVoiceTextReviewAnswer,
  type ReviewTranscript } from './voicePendingReviewService.ts';
import { compareNicknames } from './nicknameMatcher.ts';

const sourceFingerprint = (sale: SaleRecord) => JSON.stringify([sale.id, sale.sessionId, sale.revision || 1,
  sale.status, sale.buyerNickname, sale.buyerId || '', sale.amount, sale.unitPrice || sale.amount, sale.quantity || 1,
  sale.purchaseRequestId || '', sale.sourceCommentIds || [], sale.rawTranscript, sale.recognizedAt,
  sale.printRevision || 0, sale.printStatus || 'NOT_REQUESTED', sale.history || []]);

/** Only an unvalidated legacy AI overwrite can release the current buyer/price
 * locks. The original pre-AI values come from history, never from the caller. */
export function confirmedAiRecoveryBaseline(sale: SaleRecord): SaleRecord | null {
  const meta = sale.aiVerification;
  if (sale.source !== 'WEB_VOICE' || sale.status !== '확정' || sale.recordState === 'CANCELLED'
    || sale.workflowEvidence || sale.syncStatus === 'PENDING'
    || !meta || !['TEXT_PROMPT', 'TEXT_PROMPT_RECOVERY'].includes(meta.reviewMode || '')
    || (meta.reviewMode === 'TEXT_PROMPT' && meta.textReviewEvidence)
    || (meta.reviewMode === 'TEXT_PROMPT_RECOVERY' && meta.recoveryReview?.sourceFingerprint !== sourceFingerprint(sale))) return null;
  const history = sale.history || [];
  for (let index = history.length - 1; index >= 0; index--) {
    const event = history[index];
    if (event.changedBy === 'SELLER' || ['VOICE_CORRECTION', 'CORRECTION_ROLLBACK'].includes(event.changeType)) return null;
    if (event.changeType !== 'AI_RESOLVE' || event.changedBy !== 'AI'
      || event.before?.status !== '보류' || !event.before.buyerNickname || event.before.amount === undefined
      || event.after?.buyerNickname !== sale.buyerNickname || event.after.amount !== sale.amount
      || (event.before.buyerNickname === event.after.buyerNickname && event.before.amount === event.after.amount)) continue;
    return { ...sale, status: '보류', buyerNickname: event.before.buyerNickname, amount: event.before.amount,
      unitPrice: event.before.amount, buyerId: undefined, purchaseRequestId: undefined,
      sourceCommentIds: sale.evidenceSnapshot?.relevantCommentIds || [], aiVerification: undefined };
  }
  return null;
}

/** Reuses the target-bound verifier without calling a model or changing the sale. */
export function previewConfirmedAiRecovery(sale: SaleRecord, comments: CommentRecord[], logs: ReviewTranscript[]): AiVerificationMeta {
  const source = sourceFingerprint(sale);
  const base: AiVerificationMeta = { aiStatus: 'INSUFFICIENT_DATA', reviewMode: 'TEXT_PROMPT_RECOVERY',
    reviewDecision: 'INSUFFICIENT_DATA', aiTaskId: sale.aiVerification?.aiTaskId,
    validatedAt: new Date().toISOString(), recoveryReview: { sourceFingerprint: source },
    resolutionSummary: '원본 근거로 정정할 수 있는 과거 AI 확정 이력을 찾지 못했습니다.' };
  const baseline = confirmedAiRecoveryBaseline(sale);
  if (!baseline) return base;
  const price = getVoiceTextReviewTargetPrice(baseline, logs);
  if (!price) return { ...base, resolutionSummary: '해당 판매의 원본 가격 근거가 부족해 기존 확정 내용을 유지합니다.' };
  const matches = getVoiceTextReviewComments(baseline, comments).map(c => ({ nickname: c.nickname, match: compareNicknames(price.spoken, c.nickname) }));
  const nickname = (matches.find(c => c.match.isSame) || matches.find(c => c.match.isSimilar))?.nickname;
  const meta = nickname ? validateVoiceTextReviewAnswer(baseline, comments,
    `닉네임: ${nickname}\n가격: ${price.amount}원`, sale.aiVerification?.appliedSlot || 1,
    sale.aiVerification?.aiTaskId || '', source, logs) : null;
  if (meta?.aiStatus !== 'RESOLVED') return { ...base,
    resolutionSummary: '원본 발화와 유효한 구매 댓글을 하나의 계정으로 연결할 수 없어 기존 확정 내용을 유지합니다.' };
  if (meta.candidateBuyer?.nickname === sale.buyerNickname && (meta.candidateBuyer?.buyerId || '') === (sale.buyerId || '')
    && meta.candidateAmount === sale.amount && meta.candidatePurchaseRequestId === sale.purchaseRequestId) {
    return { ...base, resolutionSummary: '원본 근거와 현재 판매가 일치해 정정할 내용이 없습니다.' };
  }
  const fingerprint = JSON.stringify([source, meta.candidateBuyer, meta.candidateAmount,
    meta.candidatePurchaseRequestId, meta.candidateCommentId, meta.textReviewEvidence]);
  return { ...meta, reviewMode: 'TEXT_PROMPT_RECOVERY', aiStatus: 'NEEDS_SELLER_CONFIRM', reviewDecision: 'NEEDS_CONFIRMATION',
    recoveryReview: { sourceFingerprint: source, candidateFingerprint: fingerprint },
    resolutionSummary: `원본 근거 정정 후보: ${sale.buyerNickname} · ${sale.amount.toLocaleString('ko-KR')}원 → ${meta.candidateBuyer!.nickname} · ${meta.candidateAmount!.toLocaleString('ko-KR')}원. 판매자가 정정 적용을 누르면 반영합니다.` };
}

/** The repository must recompute the preview and enforce request uniqueness
 * and compare-and-swap before persisting this seller-approved correction. */
export function applyConfirmedAiRecovery(sale: SaleRecord, fresh: AiVerificationMeta, expectedFingerprint: string,
  now = new Date().toISOString()): SaleRecord | null {
  if (!confirmedAiRecoveryBaseline(sale) || !expectedFingerprint
    || sale.aiVerification?.recoveryReview?.candidateFingerprint !== expectedFingerprint
    || fresh.recoveryReview?.candidateFingerprint !== expectedFingerprint
    || fresh.recoveryReview.sourceFingerprint !== sourceFingerprint(sale)
    || !fresh.nicknameVerified || !fresh.saleConfirmed || !fresh.candidateBuyer || !fresh.candidateAmount
    || !fresh.candidateCommentId || !fresh.textReviewEvidence) return null;
  const revision = (sale.revision || 1) + 1;
  const summary = `판매자가 원본 근거로 확정 판매 정정: ${sale.buyerNickname} · ${sale.amount.toLocaleString('ko-KR')}원 → ${fresh.candidateBuyer.nickname} · ${fresh.candidateAmount.toLocaleString('ko-KR')}원`;
  return { ...sale, buyerNickname: fresh.candidateBuyer.nickname, buyerId: fresh.candidateBuyer.buyerId || undefined,
    amount: fresh.candidateAmount, unitPrice: fresh.candidateAmount, purchaseRequestId: fresh.candidatePurchaseRequestId,
    sourceCommentIds: [fresh.candidateCommentId], revision,
    printStatus: 'NOT_REQUESTED', printRevision: (sale.printRevision || 0) + 1, printedAt: undefined, printError: undefined,
    aiVerification: { ...fresh, aiStatus: 'RESOLVED', reviewDecision: undefined, resolutionSummary: summary,
      validatedAt: now, textReviewEvidence: { ...fresh.textReviewEvidence, appliedRevision: revision } },
    history: [...(sale.history || []), { revision, changedAt: now, changedBy: 'SELLER', changeType: 'MANUAL_EDIT',
      before: { buyerNickname: sale.buyerNickname, amount: sale.amount, status: sale.status },
      after: { buyerNickname: fresh.candidateBuyer.nickname, amount: fresh.candidateAmount, status: sale.status },
      summary, evidenceIds: [fresh.candidateCommentId], evidenceSummary: fresh.textReviewEvidence.priceTranscript }] };
}
