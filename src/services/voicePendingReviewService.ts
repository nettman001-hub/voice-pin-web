import type { SaleRecord, SttTranscriptLog } from '../types/live.ts';
import type { CommentRecord } from '../types/comment.ts';
import type { AiResolutionRequest, AiResolutionResult, AiPurchaseWindow, AiUtteranceContext } from '../types/aiResolution.ts';
import type { AiVerificationMeta } from '../types/pendingSale.ts';
import { extractSaleFromTranscript, findExplicitPriceTranscript } from './salesExtractor.ts';
import { extractSpeechPrice } from './priceEvidence.ts';
import { getPurchaseRequests, type PurchaseRequest } from './purchaseFirstSales.ts';

export const VOICE_REVIEW_WINDOW = { BEFORE_MS: 30_000, AFTER_MS: 70_000 } as const;
export type ReviewTranscript = SttTranscriptLog & { sessionId?: string };
type ReviewSale = Pick<SaleRecord, 'sessionId' | 'recognizedAt' | 'rawTranscript'>
  & Partial<Pick<SaleRecord, 'purchaseRequestId' | 'sourceCommentIds'>>;

function dedupeReviewComments(comments: CommentRecord[]): CommentRecord[] {
  const byMessage = new Map<string, CommentRecord>();
  for (const comment of comments) {
    const key = `${comment.sessionId}:${comment.platformMessageId || comment.id}`;
    const existing = byMessage.get(key);
    if (!existing?.buyerId || comment.buyerId) byMessage.set(key, comment);
  }
  return [...byMessage.values()];
}

export function getVoiceReviewRequests(sale: ReviewSale,
  comments: CommentRecord[]): PurchaseRequest[] {
  const when = Date.parse(sale.recognizedAt);
  const requests = getPurchaseRequests(dedupeReviewComments(comments), sale.sessionId).filter((request) => {
    const age = when - Date.parse(request.capturedAt);
    return !request.withdrawn && age >= -VOICE_REVIEW_WINDOW.BEFORE_MS && age <= VOICE_REVIEW_WINDOW.AFTER_MS;
  });
  const linked = requests.filter((request) => request.id === sale.purchaseRequestId
    || sale.sourceCommentIds?.includes(request.commentId));
  return linked.length ? linked : requests;
}

export function getVoiceReviewWindows(sale: ReviewSale, comments: CommentRecord[]): AiPurchaseWindow[] {
  return getVoiceReviewRequests(sale, comments).map((request) => ({
    commentId: request.commentId, nickname: request.nickname, capturedAt: request.capturedAt,
    startAt: new Date(Date.parse(request.capturedAt) - VOICE_REVIEW_WINDOW.BEFORE_MS).toISOString(),
    endAt: new Date(Date.parse(request.capturedAt) + VOICE_REVIEW_WINDOW.AFTER_MS).toISOString(),
  }));
}

export function isVoiceReviewReady(sale: ReviewSale, comments: CommentRecord[], now = Date.now()): boolean {
  const windows = getVoiceReviewWindows(sale, comments);
  return windows.length > 0 && windows.every((window) => now >= Date.parse(window.endAt));
}

function inWindows(when: number, windows: AiPurchaseWindow[]): boolean {
  return Number.isFinite(when) && windows.some((window) =>
    when >= Date.parse(window.startAt) && when <= Date.parse(window.endAt));
}

export function getVoiceReviewUtterances(sale: ReviewSale, comments: CommentRecord[], logs: ReviewTranscript[]): AiUtteranceContext[] {
  const windows = getVoiceReviewWindows(sale, comments);
  const byId = new Map<string, AiUtteranceContext>();
  for (const log of logs) {
    if (!log || log.isFinal !== true || typeof log.text !== 'string' || !log.text.trim()
      || (log.sessionId && log.sessionId !== sale.sessionId)) continue;
    const legacyTime = typeof log.id === 'string' ? log.id.match(/^log-(\d{13})-/u)?.[1] : undefined;
    const timestamp = [log.recognizedAt, log.timestamp].find((value) => typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))
      || (legacyTime ? new Date(Number(legacyTime)).toISOString() : undefined);
    if (!timestamp || !inWindows(Date.parse(timestamp), windows)) continue;
    const id = `timeline:${log.id || `${timestamp}:${log.text}`}`;
    byId.set(id, { id, text: log.text, timestamp, speakerRole: 'SELLER' });
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
}

export function shouldReviewVoiceSale(sale: SaleRecord, comments: CommentRecord[]): boolean {
  return sale.source === 'WEB_VOICE' && sale.status === '보류' && sale.recordState !== 'CANCELLED'
    && Boolean(extractSaleFromTranscript(sale.rawTranscript)) && getVoiceReviewRequests(sale, comments).length > 0;
}

export function voiceReviewFingerprint(sale: SaleRecord, comments: CommentRecord[], followingText = '', logs: ReviewTranscript[] = []): string {
  return JSON.stringify([sale.revision || 1, sale.rawTranscript,
    getVoiceReviewRequests(sale, comments).map((r) => [r.id, r.nickname, r.buyerId, r.content, r.capturedAt]).sort(),
    followingText, getVoiceReviewUtterances(sale, comments, logs).map((u) => [u.id, u.timestamp, u.text])]);
}

export function buildVoiceReviewRequest(sale: SaleRecord, comments: CommentRecord[], followingText = '', logs: ReviewTranscript[] = []): AiResolutionRequest {
  const requests = getVoiceReviewRequests(sale, comments);
  const purchaseWindows = getVoiceReviewWindows(sale, comments);
  const sellerUtterances = getVoiceReviewUtterances(sale, comments, logs);
  const relevantComments = dedupeReviewComments(comments).filter((c) => c.sessionId === sale.sessionId
    && inWindows(Date.parse(c.capturedAt), purchaseWindows));
  return {
    taskType: 'PENDING_RESOLUTION', workspaceId: '', sessionId: sale.sessionId,
    currentUtterance: sale.rawTranscript,
    priorUtterances: [{ id: `voice:${sale.id}`, text: sale.rawTranscript, timestamp: sale.recognizedAt, speakerRole: 'SELLER' }],
    followingUtterances: followingText ? [{ id: `following:${sale.id}`, text: followingText, speakerRole: 'SELLER' }] : [],
    purchaseWindows, sellerUtterances,
    relevantComments: relevantComments.map((c) => ({ commentId: c.id, nickname: c.nickname, text: c.content,
      timestamp: c.capturedAt, buyerId: c.buyerId || undefined, isPurchaseIntent: requests.some((r) => r.commentId === c.id) })),
    saleCandidates: [{ saleId: sale.id, productCode: sale.productCode || '', buyerNickname: sale.buyerNickname,
      buyerId: sale.buyerId, amount: sale.amount, quantity: sale.quantity || 1, status: sale.status }],
  };
}

/** Suggestions preserve pending state. Only the comment-first commit can
 * consume a purchase request; AI confidence never chooses between accounts. */
export function validateVoiceReviewResult(sale: SaleRecord, comments: CommentRecord[], result: AiResolutionResult | null,
  slot: 1 | 2, taskId: string, fingerprint: string, followingText = '', logs: ReviewTranscript[] = []): AiVerificationMeta {
  const request = buildVoiceReviewRequest(sale, comments, followingText, logs);
  const base: AiVerificationMeta = { aiStatus: 'INSUFFICIENT_DATA', reviewDecision: 'INSUFFICIENT_DATA',
    appliedSlot: slot, aiTaskId: taskId, reviewFingerprint: fingerprint, validatedAt: new Date().toISOString(),
    purchaseWindows: request.purchaseWindows, sellerUtterances: request.sellerUtterances,
    resolutionSummary: result?.evidenceSummary || (result
      ? 'AI 응답의 판매 근거가 충분하지 않습니다. 판매자 확인이 필요합니다.'
      : 'AI 응답을 확인하지 못했습니다. 판매자 확인이 필요합니다.') };
  if (!result || result.targetSaleId !== sale.id) return base;
  const utterances = [...(request.priorUtterances || []), ...(request.followingUtterances || []), ...(request.sellerUtterances || [])];
  const cited = utterances.filter((u) => u.id && result.evidenceIds.includes(u.id));
  if (!cited.length) return { ...base, resolutionSummary: '판매자 발화의 근거 ID가 없어 보류를 유지합니다.' };
  if (result.action === 'NOT_SALE' && !result.changes
    && extractSaleFromTranscript(sale.rawTranscript)?.intent !== 'ALLOCATION') {
    return { ...base, aiStatus: 'RESOLVED', reviewDecision: 'NOT_SALE',
      resolutionSummary: '상품 배정이 아닌 멘트로 검토되었습니다.' };
  }
  if (result.action !== 'UPDATE_SALE' && result.action !== 'KEEP_PENDING') return base;
  // Every sales answer must explicitly return both values, even when unchanged.
  const nickname = result.changes?.buyerNickname?.to?.trim();
  const amount = result.changes?.amount?.to;
  if (!nickname || !Number.isSafeInteger(amount) || !amount || amount <= 0
    || (result.changes?.amount?.quantity || 1) !== 1) {
    return { ...base, resolutionSummary: 'AI 응답의 구매자 닉네임·가격이 모두 필요합니다. 판매자 확인이 필요합니다.' };
  }
  const allocation = cited.some((u) => extractSaleFromTranscript(u.text)?.intent === 'ALLOCATION');
  const priced = cited.some((u) => {
    const extracted = extractSaleFromTranscript(u.text);
    const explicitPrice = findExplicitPriceTranscript(u.text);
    if (!extracted && explicitPrice) return extractSpeechPrice(explicitPrice)?.amount === amount;
    // An uncited or unrelated measurement cannot provide a transaction price.
    if (!extracted && /(?:가단|가슴\s*단면|총장|사이즈|보여|입어|캡처)/u.test(u.text)) return false;
    return extractSpeechPrice(extracted?.allocationTranscript || u.text)?.amount === amount;
  });
  // Legacy uncertain candidates can still be proposed for seller confirmation;
  // a missing nickname never discards a strongly evidenced sale.
  if (!priced || (!allocation && !extractSaleFromTranscript(sale.rawTranscript))) {
    return { ...base, resolutionSummary: '판매자 멘트의 가격·판매 근거를 확인할 수 없어 보류를 유지합니다.' };
  }
  const pricedMeta: AiVerificationMeta = { ...base, candidateAmount: amount, saleConfirmed: allocation,
    suggestedNickname: nickname, nicknameVerified: false,
    aiStatus: allocation ? 'NEEDS_SELLER_CONFIRM' : 'INSUFFICIENT_DATA',
    reviewDecision: allocation ? 'NEEDS_CONFIRMATION' : 'INSUFFICIENT_DATA' };
  const requests = getVoiceReviewRequests(sale, comments);
  const matching = requests.filter((r) => r.nickname === nickname);
  if (new Set(matching.map((r) => r.accountKey)).size !== 1
    || !matching.some((r) => result.evidenceIds.includes(r.commentId))) {
    return { ...pricedMeta, aiStatus: allocation ? 'NEEDS_SELLER_CONFIRM' : 'INSUFFICIENT_DATA',
      reviewDecision: allocation ? 'NEEDS_CONFIRMATION' : 'INSUFFICIENT_DATA',
      resolutionSummary: '판매 가격은 확인했으나 실제 댓글 계정을 특정하지 못했습니다. 닉네임을 확인해 주세요.' };
  }
  if (result.action !== 'UPDATE_SALE' || !result.resolvable || result.conflictReason || result.missingInfo.length) return pricedMeta;
  const matched = matching.find((r) => result.evidenceIds.includes(r.commentId))!;
  if (matched.conditional || matched.requiresReview || (result.changes?.buyerNickname?.buyerId
    && result.changes.buyerNickname.buyerId !== matched.buyerId)) return pricedMeta;
  return { ...pricedMeta, aiStatus: 'NEEDS_SELLER_CONFIRM', reviewDecision: 'NEEDS_CONFIRMATION', nicknameVerified: true,
    resolutionSummary: '댓글 닉네임과 발화 가격을 확인했습니다. 판매자의 최종 확인이 필요합니다.',
    candidateBuyer: { buyerId: matched.buyerId || '', nickname: matched.nickname },
    candidatePurchaseRequestId: matched.id, candidateCommentId: matched.commentId };
}

export function isRejectedVoiceCandidate(sale: SaleRecord): boolean {
  return sale.aiVerification?.reviewDecision === 'NOT_SALE';
}
