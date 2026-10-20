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

export type CommentAuthorMatch =
  | { kind: 'MATCH'; comment: CommentRecord; score: number }
  | { kind: 'AMBIGUOUS' | 'DIGIT_CONFLICT' | 'NO_MATCH'; candidates: CommentRecord[] };

interface NicknameCandidate {
  nickname: string;
  capturedAt: string;
  accountKey: string;
}

type NicknameMatch<T> =
  | { kind: 'MATCH'; candidate: T; score: number }
  | { kind: 'AMBIGUOUS' | 'DIGIT_CONFLICT' | 'NO_MATCH'; candidates: T[] };

const isNearbyComment = (capturedAt: string, recognizedAt: string) => {
  const delay = Date.parse(recognizedAt) - Date.parse(capturedAt);
  return delay >= -10_000 && delay <= 5 * 60_000;
};

const spokenBase = (value: string) => normalizeNickname(value).replace(/(?:언니|님|씨)$/u, '');
const digits = (value: string) => spokenBase(value).match(/\d+/gu) || [];

/** A short spoken name may identify the first complete component of a display
 * name, but never an arbitrary substring. This is only a local speech match;
 * aliases must never merge customer accounts or their histories. */
function matchesDelimitedNicknamePrefix(spoken: string, nickname: string): boolean {
  if (!/^\p{L}{2,}$/u.test(spoken)) return false;
  const parts = nickname.normalize('NFKC').split(/[\s\p{P}\p{S}]+/u)
    .map((part) => normalizeNickname(part)).filter((part) => /[\p{L}\p{N}]/u.test(part));
  return parts.length >= 2 && parts[0] === spoken;
}

/** Endings of a spoken multi-word name, longest first: "맨투맨 엑소" →
 * ["맨투맨 엑소", "엑소"]. A product or color word may precede the name, and a
 * display name may itself contain a space, so both readings stay possible. */
export function spokenNicknameVariants(spoken: string): string[] {
  // "가윤 언니" is one name with its honorific, not two words.
  const words = spoken.trim().replace(/\s+(?=(?:언니|님|씨)$)/u, '').split(/\s+/u).filter(Boolean);
  if (words.length <= 1 || /^(?:뒷|끝|앞|첫|마지막|처음)/u.test(words[0])) return words.length ? [words.join(' ')] : [];
  return words.map((_, i) => words.slice(i).join(' '));
}

/** Without a linked purchase comment, keep a spaced spoken name only when a
 * commenter in this broadcast really has that name ("성훈 맘"); otherwise use
 * the last word, since the earlier words are usually a product or color. */
export function resolveSpokenNicknameWithoutRequest(spokenNickname: string, commenterNicknames: string[]): string {
  const variants = spokenNicknameVariants(spokenNickname);
  if (variants.length <= 1) return spokenNickname;
  for (const variant of variants) {
    const key = spokenBase(variant);
    const commenter = commenterNicknames.find((nickname) => nickname && normalizeNickname(nickname) === key);
    if (commenter) return commenter.trim();
  }
  return variants[variants.length - 1];
}

export function matchPurchaseRequest(
  spokenNickname: string,
  requests: PurchaseRequest[],
  recognizedAt: string,
  consumedRequestIds: ReadonlySet<string> = new Set(),
): RequestMatch {
  const available = requests.filter((request) => !request.withdrawn && !request.conditional
    && !consumedRequestIds.has(request.id) && isNearbyComment(request.capturedAt, recognizedAt));
  const result = matchNicknameCandidates(spokenNickname, available);
  return result.kind === 'MATCH'
    ? { kind: 'MATCH', request: result.candidate, score: result.score }
    : { kind: result.kind === 'NO_MATCH' ? 'NO_REQUEST' : result.kind, candidates: result.candidates };
}

/** Identify a recent commenter independently of purchase intent or allocation.
 * Only shared IDs (including a duplicate platform message) connect local and
 * canonical records. Identical display names alone are never account evidence. */
export function matchCommentAuthor(
  spokenNickname: string,
  comments: CommentRecord[],
  sessionId: string,
  recognizedAt: string,
): CommentAuthorMatch {
  const nearby = comments.filter((comment) => comment.sessionId === sessionId
    && comment.nickname.trim() && comment.nickname.trim() !== '알 수 없음'
    && isNearbyComment(comment.capturedAt, recognizedAt));
  const result = matchNicknameCandidates(spokenNickname, commentAuthorCandidates(nearby));
  return result.kind === 'MATCH'
    ? { kind: 'MATCH', comment: result.candidate.comment, score: result.score }
    : { kind: result.kind, candidates: result.candidates.map((candidate) => candidate.comment) };
}

/** Compare account evidence, never display-name similarity. The caller supplies
 * the same-session evidence it has retained; contradictory IDs never establish
 * equivalence, even when a message/handle happens to connect the records. */
export function areSameCommentAuthor(left: CommentRecord, right: CommentRecord, comments: CommentRecord[]): boolean {
  if (!left.sessionId || left.sessionId !== right.sessionId) return false;
  const candidates = commentAuthorCandidates([
    ...comments.filter((comment) => comment.sessionId === left.sessionId), left, right,
  ]);
  const a = candidates[candidates.length - 2], b = candidates[candidates.length - 1];
  return !a.identityConflict && !b.identityConflict && a.accountKey === b.accountKey;
}

/** One account key per comment, joining records that share an ID (server buyer,
 * platform user, handle or message), e.g. an uploaded "ㅈㅇ" and the same
 * viewer's local-only comments. Conflicting IDs stay separate. */
export function linkedCommentAccountKeys(comments: CommentRecord[]): Map<string, string> {
  return new Map(commentAuthorCandidates(comments).map((candidate) => [candidate.id, candidate.accountKey]));
}

function commentAuthorCandidates(comments: CommentRecord[]) {
  const parents = new Map<string, string>();
  const find = (key: string): string => {
    const parent = parents.get(key);
    if (!parent) { parents.set(key, key); return key; }
    if (parent === key) return key;
    const root = find(parent);
    parents.set(key, root);
    return root;
  };
  const tokensFor = (comment: CommentRecord) => [
    `comment:${comment.platformMessageId || comment.id}`,
    ...(comment.buyerId ? [`buyer:${comment.buyerId}`] : []),
    ...(comment.platformUserId ? [`platform:${comment.platformUserId}`] : []),
    ...(comment.uniqueId ? [`handle:${comment.uniqueId.toLowerCase()}`] : []),
  ];
  for (const comment of comments) {
    const tokens = tokensFor(comment);
    for (const token of tokens.slice(1)) parents.set(find(token), find(tokens[0]));
  }
  const identities = new Map<string, { buyers: Set<string>; platforms: Set<string> }>();
  for (const comment of comments) {
    const root = find(tokensFor(comment)[0]);
    const identity = identities.get(root) || { buyers: new Set<string>(), platforms: new Set<string>() };
    if (comment.buyerId) identity.buyers.add(comment.buyerId);
    if (comment.platformUserId) identity.platforms.add(comment.platformUserId);
    identities.set(root, identity);
  }
  return comments.map((comment) => {
    const root = find(tokensFor(comment)[0]);
    const identity = identities.get(root)!;
    const conflictingIds = identity.buyers.size > 1 || identity.platforms.size > 1;
    const accountKey = conflictingIds
      ? (comment.buyerId ? `buyer:${comment.buyerId}` : comment.platformUserId
        ? `platform:${comment.platformUserId}` : `unresolved:${comment.id}`)
      : root;
    const resolvedComment = !conflictingIds && !comment.buyerId && identity.buyers.size === 1
      ? { ...comment, buyerId: [...identity.buyers][0] } : comment;
    return { ...comment, accountKey, comment: resolvedComment, identityConflict: conflictingIds };
  });
}

function matchNicknameCandidates<T extends NicknameCandidate>(spokenNickname: string, candidates: T[]): NicknameMatch<T> {
  // A spoken phrase like "이거 성훈 맘" may hold a spaced display name ("성훈 맘")
  // or a product word before the name ("맨투맨 엑소"). A longer reading wins
  // only when it equals a requesting commenter's nickname exactly; otherwise
  // the last word is matched as before, including similar-sounding names.
  const variants = spokenNicknameVariants(spokenNickname);
  for (const variant of variants.slice(0, -1)) {
    const result = matchSpokenVariant(variant, candidates);
    if (result.kind === 'MATCH' && result.score === 100) return result;
    if (result.kind === 'AMBIGUOUS' && result.candidates.some((candidate) =>
      spokenBase(candidate.nickname) === spokenBase(variant))) return result;
  }
  return matchSpokenVariant(variants[variants.length - 1] || '', candidates);
}

function matchSpokenVariant<T extends NicknameCandidate>(
  spokenNickname: string,
  available: T[],
): NicknameMatch<T> {
  const spoken = spokenBase(spokenNickname);
  if (!spoken) return { kind: 'NO_MATCH', candidates: [] };
  const explicitDigits = digits(spoken);
  const contenders = new Map<string, { candidate: T; score: number }>();
  let digitConflict = false;
  for (const request of available) {
    const candidateDigits = digits(request.nickname);
    if (explicitDigits.length && candidateDigits.length && explicitDigits.join('') !== candidateDigits.join('')) {
      digitConflict = true;
      continue;
    }
    const comparison = compareNicknames(spoken, request.nickname);
    const prefixAlias = matchesDelimitedNicknamePrefix(spoken, request.nickname);
    // 94 stays within the ambiguity margin of an exact short-name account
    // (100): "가윤" cannot silently choose between "가윤" and "가윤♡예준맘".
    const score = prefixAlias ? Math.max(comparison.score, 94) : comparison.score;
    if (score < 84 || (!prefixAlias && !comparison.isSame && !comparison.isSimilar)) continue;
    const prior = contenders.get(request.accountKey);
    if (!prior || score > prior.score || (score === prior.score && request.capturedAt > prior.candidate.capturedAt)) {
      contenders.set(request.accountKey, { candidate: request, score });
    }
  }
  const ranked = [...contenders.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return { kind: digitConflict ? 'DIGIT_CONFLICT' : 'NO_MATCH', candidates: [] };
  // Equal/near names are not resolved using purchase recency or AI confidence.
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 8) {
    return { kind: 'AMBIGUOUS', candidates: ranked.map((item) => item.candidate) };
  }
  return { kind: 'MATCH', candidate: ranked[0].candidate, score: ranked[0].score };
}
