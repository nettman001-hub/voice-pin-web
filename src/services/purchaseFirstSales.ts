import type { CommentRecord } from '../types/comment.ts';
import { hasCommentPurchaseIntent } from './commentNicknameVerifier.ts';
import { compareNicknames, normalizeNickname } from './nicknameMatcher.ts';

/** A request starts at the buyer's comment; a seller's voice never creates one. */
export interface PurchaseRequest {
  id: string;
  sessionId: string;
  commentId: string;
  platformMessageId?: string;
  buyerId?: string | null;
  accountKey: string;
  nickname: string;
  content: string;
  capturedAt: string;
  conditional?: boolean;
  withdrawn?: boolean;
  requestedQuantity?: number;
  requiresReview?: boolean;
}

export function commentWithdrawsPurchase(content: string): boolean {
  return /(?:취소\s*요?|안\s*살게요|구매\s*취소|저요\s*아니고|구경이요)/u.test(content);
}

export function purchaseRequestFromComment(comment: CommentRecord): PurchaseRequest | null {
  if (!comment.sessionId || commentWithdrawsPurchase(comment.content) || !hasCommentPurchaseIntent(comment.content)) return null;
  const nickname = comment.nickname.trim();
  if (!nickname || nickname === '알 수 없음') return null;
  const quantityText = comment.content.match(/(?:^|\s)(\d{1,2}|한|두|세|네)\s*개/u)?.[1];
  const requestedQuantity = quantityText
    ? ({ 한: 1, 두: 2, 세: 3, 네: 4 }[quantityText] || Number(quantityText)) : 1;
  const requiresReview = requestedQuantity !== 1 || /(?:빨강|파랑|검정|흰색|사이즈|옵션|\d+번)/u.test(comment.content);
  return {
    id: `${comment.sessionId}:${comment.platformMessageId || comment.id}`,
    sessionId: comment.sessionId,
    commentId: comment.id,
    platformMessageId: comment.platformMessageId,
    buyerId: comment.buyerId,
    // A display name is not an account identifier. Without a platform user ID,
    // preserve uncertainty instead of merging different people with that name.
    accountKey: comment.buyerId || (comment.platformUserId
      ? `platform:${comment.platformUserId}`
      : comment.uniqueId ? `handle:${comment.uniqueId.toLowerCase()}` : `unresolved:${comment.id}`),
    nickname,
    content: comment.content,
    capturedAt: comment.capturedAt,
    conditional: /(?:있으면|가능하면|되면|맞으면)\s*(?:살게요|살께요|구매|주세요)/u.test(comment.content),
    requestedQuantity,
    requiresReview,
  };
}

export function getPurchaseRequests(comments: CommentRecord[], sessionId: string): PurchaseRequest[] {
  const requests = new Map<string, PurchaseRequest>();
  for (const comment of [...comments].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))) {
    if (comment.sessionId !== sessionId) continue;
    if (commentWithdrawsPurchase(comment.content)) {
      const accountKey = comment.buyerId || (comment.platformUserId
        ? `platform:${comment.platformUserId}` : comment.uniqueId ? `handle:${comment.uniqueId.toLowerCase()}` : null);
      if (accountKey) for (const [id, request] of requests) {
        if (request.accountKey === accountKey) requests.set(id, { ...request, withdrawn: true });
      }
      continue;
    }
    const request = purchaseRequestFromComment(comment);
    if (request) requests.set(request.id, request);
  }
  return [...requests.values()].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

export type RequestMatch =
  | { kind: 'MATCH'; request: PurchaseRequest; score: number }
  | { kind: 'AMBIGUOUS' | 'DIGIT_CONFLICT' | 'NO_REQUEST'; candidates: PurchaseRequest[] };

const spokenBase = (value: string) => normalizeNickname(value).replace(/(?:언니|님|씨)$/u, '');
const digits = (value: string) => spokenBase(value).match(/\d+/gu) || [];

export function matchPurchaseRequest(
  spokenNickname: string,
  requests: PurchaseRequest[],
  recognizedAt: string,
  consumedRequestIds: ReadonlySet<string> = new Set(),
): RequestMatch {
  const when = Date.parse(recognizedAt);
  const spoken = spokenBase(spokenNickname);
  if (!spoken || !Number.isFinite(when)) return { kind: 'NO_REQUEST', candidates: [] };

  // A recently delayed comment may arrive a few seconds after the speech. It is
  // considered a candidate, but never outweighs a different exact account.
  const available = requests.filter((request) => {
    const delay = when - Date.parse(request.capturedAt);
    return !request.withdrawn && !request.conditional && !request.requiresReview
      && !consumedRequestIds.has(request.id)
      && delay >= -10_000 && delay <= 5 * 60_000;
  });
  const explicitDigits = digits(spoken);
  const contenders = new Map<string, { request: PurchaseRequest; score: number }>();
  let digitConflict = false;
  for (const request of available) {
    const candidateDigits = digits(request.nickname);
    if (explicitDigits.length && candidateDigits.length && explicitDigits.join('') !== candidateDigits.join('')) {
      digitConflict = true;
      continue;
    }
    const comparison = compareNicknames(spoken, request.nickname);
    const score = comparison.score;
    if (score < 84 || (!comparison.isSame && !comparison.isSimilar)) continue;
    const prior = contenders.get(request.accountKey);
    if (!prior || score > prior.score || (score === prior.score && request.capturedAt > prior.request.capturedAt)) {
      contenders.set(request.accountKey, { request, score });
    }
  }
  const ranked = [...contenders.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return { kind: digitConflict ? 'DIGIT_CONFLICT' : 'NO_REQUEST', candidates: [] };
  // Equal/near names are not resolved using purchase recency or AI confidence.
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 8) {
    return { kind: 'AMBIGUOUS', candidates: ranked.map((item) => item.request) };
  }
  return { kind: 'MATCH', request: ranked[0].request, score: ranked[0].score };
}
