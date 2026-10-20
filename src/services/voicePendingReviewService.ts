import type { SaleRecord, SttTranscriptLog } from '../types/live.ts';
import type { CommentRecord } from '../types/comment.ts';
import type { AiResolutionRequest, AiResolutionResult, AiPurchaseWindow, AiUtteranceContext } from '../types/aiResolution.ts';
import type { AiVerificationMeta } from '../types/pendingSale.ts';
import { extractSaleFromTranscript, findExplicitPriceTranscript, getBuyerNicknameCandidates,
  getBuyerNicknamePhrase } from './salesExtractor.ts';
import { extractSpeechPrice } from './priceEvidence.ts';
import { getPurchaseRequests, commentWithdrawsPurchase, type PurchaseRequest } from './purchaseFirstSales.ts';
import { isWorkflowAllocation, extractCommentOrderCode } from './salesWorkflowEngine.ts';
import { compareNicknames } from './nicknameMatcher.ts';
import { hasCommentPurchaseIntent } from './commentNicknameVerifier.ts';
import { isProductChangeUtterance, VOICE_SALE_TRANSACTION_WINDOW_MS } from './voiceSaleTransaction.ts';

export const VOICE_REVIEW_WINDOW = { BEFORE_MS: 30_000, AFTER_MS: 70_000 } as const;
export type ReviewTranscript = SttTranscriptLog & { sessionId?: string };
type ReviewSale = Pick<SaleRecord, 'sessionId' | 'recognizedAt' | 'rawTranscript'>
  & Partial<Pick<SaleRecord, 'purchaseRequestId' | 'sourceCommentIds' | 'workflowEvidence' | 'buyerNickname'>>;

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
  const records=dedupeReviewComments(comments);
  const numbered:PurchaseRequest[] = sale.workflowEvidence?.orderCode && sale.workflowEvidence.profileSnapshot?.modules.includes('ORDER_CODE')
    ? records.filter(c=>c.sessionId===sale.sessionId && !commentWithdrawsPurchase(c.content) && extractCommentOrderCode(c.content)===sale.workflowEvidence!.orderCode)
      .map(c=>({id:`${c.sessionId}:${c.platformMessageId || c.id}`,sessionId:c.sessionId,commentId:c.id,nickname:c.nickname,
        capturedAt:c.capturedAt,content:c.content,buyerId:c.buyerId,accountKey:c.buyerId || c.platformUserId || c.uniqueId || `unresolved:${c.id}`,
        conditional:/있으면|가능하면|맞으면/u.test(c.content),requiresReview:/옵션|사이즈|빨강|파랑|검정|\d+\s*개/u.test(c.content),
        withdrawn:records.some(later=>later.sessionId===c.sessionId && later.capturedAt>c.capturedAt && later.capturedAt<=sale.recognizedAt
          && Boolean((c.buyerId&&later.buyerId===c.buyerId)||(c.platformUserId&&later.platformUserId===c.platformUserId)||(c.uniqueId&&later.uniqueId===c.uniqueId))
          && commentWithdrawsPurchase(later.content))})) : [];
  const rawRequests = [...new Map([...getPurchaseRequests(records, sale.sessionId),...numbered].map(r=>[r.id,r])).values()];
  const requests = rawRequests.filter((request) => {
    const age = when - Date.parse(request.capturedAt);
    return !request.withdrawn && age >= -VOICE_REVIEW_WINDOW.BEFORE_MS && age <= VOICE_REVIEW_WINDOW.AFTER_MS;
  });

  // 1. 표준 윈도우 내 요청이 없고, 180초 확장 윈도우 내에 구매 의사 요청이 있는 경우
  if (!requests.length) {
    const extended = rawRequests.filter((request) => {
      const age = when - Date.parse(request.capturedAt);
      return !request.withdrawn && age >= -60_000 && age <= 180_000;
    });
    if (extended.length) requests.push(...extended);
  }

  // 2. 발화 닉네임과 일치하고 구매 의사가 있는 댓글 작성자가 있는 경우 (후보 연결 지원)
  if (!requests.length) {
    const spoken = (sale as any).buyerNickname || extractSaleFromTranscript((sale as any).rawTranscript || '')?.buyerNickname;
    if (spoken) {
      const nickMatches = records.filter((c) =>
        (!c.sessionId || c.sessionId === sale.sessionId)
        && !commentWithdrawsPurchase(c.content)
        && hasCommentPurchaseIntent(c.content)
        && compareNicknames(c.nickname, spoken)
      );
      for (const c of nickMatches) {
        const age = when - Date.parse(c.capturedAt);
        if (age >= -VOICE_REVIEW_WINDOW.BEFORE_MS && age <= 180_000) {
          requests.push({
            id: `${c.sessionId || sale.sessionId}:${c.platformMessageId || c.id}`,
            sessionId: c.sessionId || sale.sessionId,
            commentId: c.id,
            platformMessageId: c.platformMessageId,
            buyerId: c.buyerId,
            accountKey: c.buyerId || (c.platformUserId ? `platform:${c.platformUserId}` : c.uniqueId ? `handle:${c.uniqueId.toLowerCase()}` : `unresolved:${c.id}`),
            nickname: c.nickname,
            content: c.content,
            capturedAt: c.capturedAt,
            requestedQuantity: 1,
          });
        }
      }
    }
  }

  // 3. 이미 판매에 연결된 commentId / purchaseRequestId가 있는 경우
  if (!requests.length && (sale.purchaseRequestId || sale.sourceCommentIds?.length)) {
    const linkedRecords = records.filter((c) =>
      (!c.sessionId || c.sessionId === sale.sessionId)
      && !commentWithdrawsPurchase(c.content)
      && hasCommentPurchaseIntent(c.content)
      && (c.id === sale.purchaseRequestId || `${c.sessionId}:${c.platformMessageId || c.id}` === sale.purchaseRequestId || sale.sourceCommentIds?.includes(c.id))
    );
    for (const c of linkedRecords) {
      requests.push({
        id: `${c.sessionId || sale.sessionId}:${c.platformMessageId || c.id}`,
        sessionId: c.sessionId || sale.sessionId,
        commentId: c.id,
        platformMessageId: c.platformMessageId,
        buyerId: c.buyerId,
        accountKey: c.buyerId || (c.platformUserId ? `platform:${c.platformUserId}` : c.uniqueId ? `handle:${c.uniqueId.toLowerCase()}` : `unresolved:${c.id}`),
        nickname: c.nickname,
        content: c.content,
        capturedAt: c.capturedAt,
        requestedQuantity: 1,
      });
    }
  }

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
    && Boolean(sale.workflowEvidence || extractSaleFromTranscript(sale.rawTranscript)) && getVoiceReviewRequests(sale, comments).length > 0;
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
  const relevantComments = dedupeReviewComments(comments).filter((c) => (!c.sessionId || c.sessionId === sale.sessionId)
    && (inWindows(Date.parse(c.capturedAt), purchaseWindows) || requests.some((r) => r.commentId === c.id || r.nickname === c.nickname)));
  return {
    taskType: 'PENDING_RESOLUTION', workspaceId: '', sessionId: sale.sessionId,
    workflowProfile: sale.workflowEvidence?.profileSnapshot,
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
  const allocation = cited.some((u) => extractSaleFromTranscript(u.text)?.intent === 'ALLOCATION'
    || (sale.workflowEvidence?.profileSnapshot && isWorkflowAllocation(u.text,sale.workflowEvidence.profileSnapshot)));
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
  if (matched.conditional || (result.changes?.buyerNickname?.buyerId
    && result.changes.buyerNickname.buyerId !== matched.buyerId)) return pricedMeta;
  return { ...pricedMeta, aiStatus: 'NEEDS_SELLER_CONFIRM', reviewDecision: 'NEEDS_CONFIRMATION', nicknameVerified: true,
    resolutionSummary: '댓글 닉네임과 발화 가격을 확인했습니다. 판매자의 최종 확인이 필요합니다.',
    candidateBuyer: { buyerId: matched.buyerId || '', nickname: matched.nickname },
    candidatePurchaseRequestId: matched.id, candidateCommentId: matched.commentId };
}

export function isRejectedVoiceCandidate(sale: SaleRecord): boolean {
  return sale.aiVerification?.reviewDecision === 'NOT_SALE';
}

/* ── 보류 판매 AI 질문 (사용자 지정 텍스트 형식, 2026-10-19) ──────────────
 * 보류 판매 앞뒤 1분의 고객 댓글과 판매자 멘트를 시각순 텍스트로 만들어
 * 정해진 프롬프트 그대로 묻고, "닉네임: xxx / 가격: 000원" 답이면 판매 확정. */

export const VOICE_TEXT_REVIEW_WINDOW_MS = 60_000;
// A sale is created just before its STT timeline entries are written. Those
// copies may differ by a few milliseconds and are still the target utterance.
const VOICE_TEXT_REVIEW_ANCHOR_JITTER_MS = 250;

export const VOICE_TEXT_REVIEW_INSTRUCTIONS = `아래 내용은 라이브방송에서 판매자의 멘트와 구매자의 댓글 내용이다. 
<검토 대상 판매>에 지정된 판매 ID·발화 시각·원본 발화의 거래 하나만 검토해라.
주변 댓글과 판매자 멘트는 대상 판매의 구매자와 가격을 확인하는 참고 근거다.
주변에서 가장 먼저 또는 가장 나중에 확정된 다른 거래를 선택하지 마라.
다른 거래의 구매자·가격을 대상 판매에 적용하거나 가격을 추정하지 마라.
대상 거래의 구매자와 가격 근거가 부족하거나 충돌하면 '미확인'이라고 답해라.
구매자는 구매의사표시를 "ㅈㅇ", "저요", "제가살께요", "저주세요" 등의 맥락으로 여러가지 표현을 쓴다는 것을 참고로 해라.
고객댓글의 닉네임이 정확한 것이고 판매자멘트에서의 고객을 호칭하는 닉네임이 STT가 받아적는 것이기 때문에 약간 틀릴 수 있다.
두 닉네임의 틀릴 가능성을 염두에 두고 비슷한 닉네임도 찾아서 판단해라.
가격은 소숫점으로 표현 할 수 있다. 1.5면 곱하기 10000원을 해서 15,000원 이다. 
답변은 아래와 같은 식으로 한다.
닉네임: xxx
가격: 000원`;

const KST = 'Asia/Seoul';
const oneLine = (text: string) => String(text || '').replace(/\s+/gu, ' ').trim();
const formatCommentTime = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: KST });
const formatSellerTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { timeZone: KST });

function inTextWindow(sale: Pick<SaleRecord, 'recognizedAt'>, iso?: string): boolean {
  const when = Date.parse(sale.recognizedAt);
  const at = Date.parse(iso || '');
  return Number.isFinite(when) && Number.isFinite(at) && Math.abs(at - when) <= VOICE_TEXT_REVIEW_WINDOW_MS;
}

export function getVoiceTextReviewComments(sale: Pick<SaleRecord, 'sessionId' | 'recognizedAt'>, comments: CommentRecord[]): CommentRecord[] {
  return dedupeReviewComments(comments)
    .filter((c) => (!c.sessionId || c.sessionId === sale.sessionId) && inTextWindow(sale, c.capturedAt) && oneLine(c.nickname))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

export function getVoiceTextReviewUtterances(sale: Pick<SaleRecord, 'sessionId' | 'recognizedAt'>, logs: ReviewTranscript[]) {
  const byKey = new Map<string, { at: string; text: string }>();
  for (const log of logs) {
    if (!log || log.isFinal === false || typeof log.text !== 'string' || !log.text.trim()
      || (log.sessionId && log.sessionId !== sale.sessionId)) continue;
    const at = [log.recognizedAt, log.timestamp].find((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    if (!at || !inTextWindow(sale, at)) continue;
    byKey.set(`${Date.parse(at)}:${oneLine(log.text)}`, { at, text: oneLine(log.text) });
  }
  const sorted = [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const distinct: typeof sorted = [];
  for (const utterance of sorted) {
    const previous = distinct.at(-1);
    if (previous?.text === utterance.text && Date.parse(utterance.at) - Date.parse(previous.at) <= VOICE_TEXT_REVIEW_ANCHOR_JITTER_MS) continue;
    distinct.push(utterance);
  }
  return distinct;
}

const matchesSpokenName = (spoken: string, nickname: string) => {
  const match = compareNicknames(spoken, nickname);
  return match.isSame || match.isSimilar;
};

/** Only the target's own allocation and its bounded continuation may supply
 * a price. Earlier trades and a following buyer/product are never evidence. */
export function getVoiceTextReviewTargetPrice(sale: SaleRecord, logs: ReviewTranscript[]) {
  const original = extractSaleFromTranscript(sale.rawTranscript);
  const originalText = original?.allocationTranscript || sale.rawTranscript;
  const names = getBuyerNicknameCandidates(originalText);
  if (!original || names.length !== 1 || (sale.quantity || 1) !== 1) return null;
  const spoken = getBuyerNicknamePhrase(originalText, names[0]) || names[0];
  let text = originalText;
  const evidence = () => {
    const extracted = extractSaleFromTranscript(text);
    const price = extractSpeechPrice(extracted?.allocationTranscript || text);
    return extracted?.amount && price?.amount === extracted.amount
      ? { spoken, amount: price.amount, quote: price.quote, transcript: extracted.allocationTranscript || text } : null;
  };
  const ownPrice = evidence();
  if (ownPrice) return ownPrice;
  const when = Date.parse(sale.recognizedAt);
  for (const utterance of getVoiceTextReviewUtterances(sale, logs)) {
    const age = Date.parse(utterance.at) - when;
    if (age <= 0) continue;
    if (age > VOICE_SALE_TRANSACTION_WINDOW_MS) break;
    const next = utterance.text;
    if (age <= VOICE_TEXT_REVIEW_ANCHOR_JITTER_MS && next === oneLine(sale.rawTranscript)) continue;
    const nextNames = getBuyerNicknameCandidates(next);
    if (isProductChangeUtterance(next)
      || /취소|정정|수정|변경|말고|아니라|아니고/u.test(next)
      || nextNames.some((name) => !matchesSpokenName(spoken, name))
      || (nextNames.length && extractSaleFromTranscript(next)?.intent === 'ALLOCATION')) break;
    text += `\n${next}`;
    const price = evidence();
    if (price) return price;
  }
  return null;
}

/** The target is explicit even when the surrounding minute has many trades. */
export function buildVoiceTextReviewPrompt(sale: SaleRecord, comments: CommentRecord[], logs: ReviewTranscript[]): string {
  const commentLines = getVoiceTextReviewComments(sale, comments)
    .map((c) => `${formatCommentTime(c.capturedAt)}\t${oneLine(c.nickname)}\t${oneLine(c.content)}`);
  const utterances = getVoiceTextReviewUtterances(sale, logs);
  // The sale's own speech is evidence even when the transcript archive lags.
  if (sale.rawTranscript && !utterances.some((u) => u.text.includes(oneLine(sale.rawTranscript)))) {
    utterances.push({ at: sale.recognizedAt, text: oneLine(sale.rawTranscript) });
    utterances.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  const sellerLines = utterances.map((u) => `[${formatSellerTime(u.at)}] ${u.text}`);
  return `${VOICE_TEXT_REVIEW_INSTRUCTIONS}\n\n<검토 대상 판매>\n판매 ID: ${oneLine(sale.id)}\n방송 회차 ID: ${oneLine(sale.sessionId)}\n발화 시각: ${formatCommentTime(sale.recognizedAt)} (${sale.recognizedAt})\n원본 발화: ${oneLine(sale.rawTranscript)}\n현재 연결된 구매자: ${oneLine(sale.buyerNickname)}\n이 판매 하나의 구매자·가격만 답해라.\n\n<고객댓글>\n시각\t닉네임\t멘트\n${commentLines.join('\n')}\n\n<판매자멘트>\n시각 멘트 \n${sellerLines.join('\n')}`;
}

export function shouldReviewVoiceSaleText(sale: SaleRecord, comments: CommentRecord[]): boolean {
  return sale.source === 'WEB_VOICE' && sale.status === '보류' && sale.recordState !== 'CANCELLED'
    && !sale.workflowEvidence && getVoiceTextReviewComments(sale, comments).length > 0;
}

/** Ask once the minute after the held sale has been heard. */
export function isVoiceTextReviewReady(sale: Pick<SaleRecord, 'recognizedAt'>, now = Date.now()): boolean {
  const when = Date.parse(sale.recognizedAt);
  return Number.isFinite(when) && now >= when + VOICE_TEXT_REVIEW_WINDOW_MS;
}

export function voiceTextReviewFingerprint(sale: SaleRecord, comments: CommentRecord[], logs: ReviewTranscript[]): string {
  return JSON.stringify(['text-v2-target', sale.revision || 1, buildVoiceTextReviewPrompt(sale, comments, logs)]);
}

/** "닉네임: KH\n가격: 15,000원" → { nickname: 'KH', amount: 15000 }. */
export function parseVoiceTextReviewAnswer(answer: string): { nickname: string; amount: number } | null {
  const text = String(answer || '').replace(/[*`]/gu, '');
  const nickname = text.match(/닉네임\s*[:：]\s*([^\n\r]+)/u)?.[1]
    ?.replace(/^["'“”‘’「」\[\(]+|["'“”‘’「」\]\)]+$/gu, '').replace(/\s*(?:님|언니)$/u, '').trim();
  const priceText = text.match(/가격\s*[:：]\s*([^\n\r]+)/u)?.[1]?.trim() || '';
  let amount = 0;
  const won = priceText.match(/^([\d,]+)\s*원?/u);
  if (won && !/^\d{1,3}\.\d/u.test(priceText)) amount = Number(won[1].replace(/,/gu, ''));
  if (!amount) amount = extractSpeechPrice(priceText)?.amount || 0;
  if (!nickname || /^(?:없음|없습니다|미확인|모름|x+)$/iu.test(nickname) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return { nickname, amount };
}

const accountKeyOf = (c: CommentRecord) => c.buyerId || (c.platformUserId ? `platform:${c.platformUserId}`
  : c.uniqueId ? `handle:${c.uniqueId.toLowerCase()}` : `unresolved:${c.platformMessageId || c.id}`);

/** The comment nickname is the truth: the answer must name exactly one
 * commenter in the window (exactly, else by a close spelling). */
export function validateVoiceTextReviewAnswer(sale: SaleRecord, comments: CommentRecord[], answer: string | null,
  slot: 1 | 2, taskId: string, fingerprint: string, logs: ReviewTranscript[] = []): AiVerificationMeta {
  const base: AiVerificationMeta = { aiStatus: 'INSUFFICIENT_DATA', reviewDecision: 'INSUFFICIENT_DATA',
    reviewMode: 'TEXT_PROMPT', appliedSlot: slot, aiTaskId: taskId, reviewFingerprint: fingerprint, validatedAt: new Date().toISOString(),
    resolutionSummary: answer ? `AI 답변에서 닉네임과 가격을 찾지 못했습니다: ${oneLine(answer).slice(0, 120)}`
      : 'AI 응답을 확인하지 못했습니다. 판매자 확인이 필요합니다.' };
  const parsed = parseVoiceTextReviewAnswer(answer || '');
  if (!parsed) return base;
  const windowComments = getVoiceTextReviewComments(sale, comments);
  const key = (name: string) => oneLine(name).replace(/\s/gu, '').toLowerCase();
  let candidates = windowComments.filter((c) => key(c.nickname) === key(parsed.nickname));
  if (!candidates.length) candidates = windowComments.filter((c) => {
    const match = compareNicknames(c.nickname, parsed.nickname);
    return match.isSame || match.isSimilar;
  });
  const priced = { ...base, candidateAmount: parsed.amount, suggestedNickname: parsed.nickname, saleConfirmed: false,
    nicknameVerified: false, aiStatus: 'NEEDS_SELLER_CONFIRM' as const, reviewDecision: 'NEEDS_CONFIRMATION' as const };
  const reject = (reason: string): AiVerificationMeta => ({ ...priced, resolutionSummary: `${reason} 자동 적용하지 않고 보류를 유지합니다.` });
  if (new Set(candidates.map(accountKeyOf)).size !== 1) {
    return { ...priced, resolutionSummary: candidates.length
      ? `AI 답변 닉네임 '${parsed.nickname}'과 비슷한 댓글 계정이 여러 개입니다. 닉네임을 확인해 주세요.`
      : `AI 답변 닉네임 '${parsed.nickname}'이 앞뒤 1분 댓글에 없습니다. 닉네임을 확인해 주세요.` };
  }
  const linked = windowComments.filter(c => sale.sourceCommentIds?.includes(c.id)
    || sale.purchaseRequestId === `${c.sessionId || sale.sessionId}:${c.platformMessageId || c.id}`);
  if ((sale.buyerId && candidates.some(c => c.buyerId !== sale.buyerId))
    || (linked.length && candidates.some(c => !linked.some(l => accountKeyOf(l) === accountKeyOf(c))))) {
    return reject('AI 답변의 구매자가 이 판매에 이미 연결된 구매 댓글 계정과 다릅니다.');
  }
  const original = extractSaleFromTranscript(sale.rawTranscript);
  const speech = original?.allocationTranscript || sale.rawTranscript;
  const names = getBuyerNicknameCandidates(speech);
  const spoken = names.length === 1 ? getBuyerNicknamePhrase(speech, names[0]) || names[0] : '';
  const spokenMatches = windowComments.map(c => ({ comment: c, match: compareNicknames(spoken, c.nickname) }));
  const exactSpoken = spokenMatches.filter(c => c.match.isSame);
  const supported = (exactSpoken.length ? exactSpoken : spokenMatches.filter(c => c.match.isSimilar)).map(c => c.comment);
  if (!spoken || new Set(supported.map(accountKeyOf)).size !== 1
    || !supported.some(c => accountKeyOf(c) === accountKeyOf(candidates[0]))) {
    return reject('AI 답변의 구매자를 검토 대상 원본 발화에서 확인할 수 없습니다.');
  }
  const requests = getPurchaseRequests(windowComments, sale.sessionId);
  const chosen = [...candidates].reverse().find(c => Date.parse(c.capturedAt) <= Date.parse(sale.recognizedAt)
    && (!sale.purchaseRequestId || sale.purchaseRequestId === `${c.sessionId || sale.sessionId}:${c.platformMessageId || c.id}`)
    && (!sale.sourceCommentIds?.length || sale.sourceCommentIds.includes(c.id))
    && requests.some(r => r.commentId === c.id && !r.withdrawn && !r.conditional && !r.requiresReview));
  if (!chosen) return reject('AI 답변의 구매자에게 유효한 구매 의사 댓글이 없습니다.');
  const price = getVoiceTextReviewTargetPrice(sale, logs);
  if (!price || price.amount !== parsed.amount) return reject('AI 답변의 가격을 해당 판매에 이어진 발화 근거에서 확인할 수 없습니다.');
  if (sale.amount > 0 && sale.amount !== parsed.amount) return reject('AI 답변의 가격이 이 판매에 저장된 금액과 다릅니다.');
  return { ...priced, aiStatus: 'RESOLVED', reviewDecision: undefined, nicknameVerified: true,
    saleConfirmed: true,
    resolutionSummary: `AI 판정: 닉네임 ${chosen.nickname}, 가격 ${parsed.amount.toLocaleString('ko-KR')}원으로 판매 확정`,
    candidateBuyer: { buyerId: chosen.buyerId || '', nickname: chosen.nickname },
    candidatePurchaseRequestId: `${chosen.sessionId || sale.sessionId}:${chosen.platformMessageId || chosen.id}`,
    candidateCommentId: chosen.id,
    textReviewEvidence: { version: 1, saleId: sale.id, sessionId: sale.sessionId, recognizedAt: sale.recognizedAt,
      rawTranscript: sale.rawTranscript, buyerNickname: chosen.nickname, buyerId: chosen.buyerId || '',
      purchaseRequestId: `${chosen.sessionId || sale.sessionId}:${chosen.platformMessageId || chosen.id}`,
      amount: price.amount, priceQuote: price.quote, priceTranscript: price.transcript } };
}

/** Both application and automatic confirmation require the same target-bound
 * proof. Old RESOLVED metadata and metadata copied from another sale cannot apply. */
export function hasValidatedVoiceTextReview(sale: SaleRecord, meta = sale.aiVerification): boolean {
  const proof = meta?.textReviewEvidence;
  return Boolean(meta?.reviewMode === 'TEXT_PROMPT' && meta.aiStatus === 'RESOLVED'
    && !meta.reviewDecision && !meta.errorMessage && meta.saleConfirmed && meta.nicknameVerified && proof?.version === 1
    && proof.saleId === sale.id && proof.sessionId === sale.sessionId && proof.recognizedAt === sale.recognizedAt
    && proof.rawTranscript === sale.rawTranscript && proof.buyerNickname === meta.candidateBuyer?.nickname
    && (sale.quantity || 1) === 1 && (proof.appliedRevision === undefined || proof.appliedRevision === (sale.revision || 1))
    && proof.buyerId === (meta.candidateBuyer?.buyerId || '') && proof.amount === meta.candidateAmount
    && proof.purchaseRequestId === meta.candidatePurchaseRequestId && proof.priceQuote
    && extractSpeechPrice(proof.priceTranscript)?.amount === proof.amount);
}

/**
 * A held sale whose text-prompt answer named one comment account and a price
 * becomes 확정 (printable), exactly as if the seller had confirmed it.
 */
export function confirmVoiceTextReviewSale(sale: SaleRecord, now = new Date().toISOString()): SaleRecord | null {
  const meta = sale.aiVerification;
  if (sale.source !== 'WEB_VOICE' || sale.status !== '보류' || sale.recordState === 'CANCELLED'
    || sale.syncStatus === 'PENDING' || !hasValidatedVoiceTextReview(sale, meta)
    || meta?.textReviewEvidence?.appliedRevision !== (sale.revision || 1)
    || !meta?.candidateBuyer || !(meta.candidateAmount! > 0)
    || sale.buyerNickname !== meta.candidateBuyer.nickname || (sale.buyerId || '') !== (meta.candidateBuyer.buyerId || '')
    || sale.amount !== meta.candidateAmount || sale.purchaseRequestId !== meta.candidatePurchaseRequestId) return null;
  const revision = (sale.revision || 1) + 1;
  const amount = meta.candidateAmount!;
  return {
    ...sale,
    status: '확정',
    revision,
    buyerNickname: meta.candidateBuyer.nickname,
    buyerId: meta.candidateBuyer.buyerId || sale.buyerId,
    purchaseRequestId: sale.purchaseRequestId || meta.candidatePurchaseRequestId,
    amount,
    unitPrice: sale.amount === amount && sale.unitPrice ? sale.unitPrice : amount,
    history: [...(sale.history || []), {
      revision, changedAt: now, changedBy: 'AI', changeType: 'AI_RESOLVE',
      before: { status: sale.status, buyerNickname: sale.buyerNickname, amount: sale.amount },
      after: { status: '확정', buyerNickname: meta.candidateBuyer.nickname, amount },
      summary: meta.resolutionSummary || 'AI 판정으로 판매 확정',
    }],
  };
}
