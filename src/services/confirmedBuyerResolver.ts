import type { CommentRecord } from '../types/comment.ts';
import type { SaleRecord } from '../types/live.ts';
import type { ConfirmedBuyerAlias, ConfirmedBuyerCandidate, ConfirmedBuyerResolution } from '../types/confirmedBuyer.ts';
import { compareNicknames, generateNicknameAliases, normalizeNickname } from './nicknameMatcher.ts';
import { hangulSoundScore } from './hangulSound.ts';
import { getPurchaseRequests, linkedCommentAccountKeys, spokenNicknameVariants, type PurchaseRequest } from './purchaseFirstSales.ts';

export const BUYER_LINK_PENDING = '구매자 연결 대기';

export function commentAccountKey(comment: CommentRecord): string {
  return comment.buyerId || (comment.platformUserId ? `platform:${comment.platformUserId}`
    : comment.uniqueId ? `handle:${comment.uniqueId.toLowerCase()}` : `unresolved:${comment.id}`);
}

/** Preserve server identity while enriching it with the local platform handle. */
export function mergeBuyerComments(comments: CommentRecord[]): CommentRecord[] {
  const merged = new Map<string, CommentRecord>();
  for (const comment of comments) {
    const key = `${comment.sessionId}:${comment.platformMessageId || comment.id}`;
    const previous = merged.get(key);
    if (!previous) { merged.set(key, comment); continue; }
    const preferred = previous.buyerId && !comment.buyerId ? previous : comment;
    const fallback = preferred === previous ? comment : previous;
    merged.set(key, { ...fallback, ...preferred,
      platformUserId: preferred.platformUserId || fallback.platformUserId,
      uniqueId: preferred.uniqueId || fallback.uniqueId });
  }
  return [...merged.values()];
}

function nicknameScore(spoken: string, nickname: string): number {
  const variants = spokenNicknameVariants(spoken).map(normalizeNickname).filter(Boolean);
  const clean = normalizeNickname(nickname);
  const aliases = generateNicknameAliases(nickname);
  const forms = [clean, ...aliases.wordPronunciations, ...aliases.spelledPronunciations, ...aliases.combinedPronunciations]
    .map(normalizeNickname).filter(Boolean);
  return Math.max(0, ...variants.map((variant) => {
    const leftDigits = variant.match(/\d+/gu)?.join('');
    const rightDigits = clean.match(/\d+/gu)?.join('');
    if (leftDigits && rightDigits && leftDigits !== rightDigits) return 0;
    const parts = nickname.split(/[\s\p{P}\p{S}]+/u).map(normalizeNickname).filter(Boolean);
    const prefix = variant.length >= 2 && parts.length > 1 && parts[0] === variant ? 94 : 0;
    return Math.max(prefix, compareNicknames(variant, nickname).score,
      ...forms.map((form) => /[가-힣]/u.test(variant) && /[가-힣]/u.test(form) ? hangulSoundScore(variant, form) : 0));
  }));
}

/** Four-point speech proves the sale; all commenters in that broadcast can identify its buyer. */
export function resolveConfirmedBuyer(input: {
  spokenNickname: string;
  sessionId: string;
  recognizedAt: string;
  comments: CommentRecord[];
  requests?: PurchaseRequest[];
  consumed?: ReadonlySet<string>;
  aliases?: ConfirmedBuyerAlias[];
}): ConfirmedBuyerResolution {
  const { spokenNickname, sessionId } = input;
  const when = Date.parse(input.recognizedAt);
  const resolution: ConfirmedBuyerResolution = { saleConfirmed: true, status: 'NO_MATCH', spokenNickname, candidates: [] };
  if (!Number.isFinite(when)) return resolution;
  const comments = mergeBuyerComments(input.comments);
  const requests = input.requests || getPurchaseRequests(comments, sessionId);
  // An uploaded purchase comment carries the server buyer ID while the same
  // viewer's other comments carry only the platform ID: one account, not two.
  const sessionComments = comments.filter((comment) => comment.sessionId === sessionId);
  const linkedKeys = linkedCommentAccountKeys(sessionComments);
  const accountOf = (comment: CommentRecord) => linkedKeys.get(comment.id) || commentAccountKey(comment);
  const identityKeysByAccount = new Map<string, Set<string>>();
  const accountByMessage = new Map<string, string>();
  const buyerByAccount = new Map<string, string>();
  for (const comment of sessionComments) {
    const account = accountOf(comment);
    const keys = identityKeysByAccount.get(account) || new Set<string>();
    for (const key of [commentAccountKey(comment), comment.buyerId || '',
      comment.platformUserId ? `platform:${comment.platformUserId}` : '',
      comment.uniqueId ? `handle:${comment.uniqueId.toLowerCase()}` : '']) if (key) keys.add(key);
    identityKeysByAccount.set(account, keys);
    if (comment.buyerId) buyerByAccount.set(account, comment.buyerId);
    accountByMessage.set(comment.id, account);
    if (comment.platformMessageId) accountByMessage.set(`message:${comment.platformMessageId}`, account);
  }
  const requestAccount = (request: PurchaseRequest) => accountByMessage.get(request.commentId)
    || (request.platformMessageId ? accountByMessage.get(`message:${request.platformMessageId}`) : undefined)
    || [...identityKeysByAccount].find(([, keys]) => keys.has(request.accountKey))?.[0]
    || request.accountKey;
  const requestsByAccount = new Map<string, PurchaseRequest[]>();
  for (const request of requests) {
    const delay = when - Date.parse(request.capturedAt);
    if (request.sessionId !== sessionId || request.withdrawn || request.conditional || input.consumed?.has(request.id)
      || !Number.isFinite(delay) || delay < -10_000 || delay > 5 * 60_000) continue;
    const account = requestAccount(request);
    const list = requestsByAccount.get(account) || [];
    list.push(request);
    requestsByAccount.set(account, list);
  }
  const scoresByNickname = new Map<string, number>();
  const accounts = new Map<string, ConfirmedBuyerCandidate>();
  for (const comment of comments) {
    const at = Date.parse(comment.capturedAt);
    // No age cutoff: search the whole current broadcast, allowing slight comment transport lag.
    if (comment.sessionId !== sessionId || !comment.nickname?.trim() || !Number.isFinite(at) || at > when + 10_000) continue;
    const account = accountOf(comment);
    let nameScore = scoresByNickname.get(comment.nickname);
    if (nameScore === undefined) {
      nameScore = nicknameScore(spokenNickname, comment.nickname);
      scoresByNickname.set(comment.nickname, nameScore);
    }
    const spokenDigits = normalizeNickname(spokenNickname).match(/\d+/gu)?.join('');
    const candidateDigits = normalizeNickname(comment.nickname).match(/\d+/gu)?.join('');
    const digitConflict = spokenDigits && candidateDigits && spokenDigits !== candidateDigits;
    const identityKeys = identityKeysByAccount.get(account) || new Set<string>();
    const alias = input.aliases?.some((item) => identityKeys.has(item.accountKey)
      && normalizeNickname(item.spokenNickname) === normalizeNickname(spokenNickname));
    if (alias && !digitConflict) nameScore = 100;
    const accountRequests = requestsByAccount.get(account) || [];
    const purchase = accountRequests.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    // Keep the established key format (server buyer ID first) for saved aliases.
    const buyerId = purchase?.buyerId || comment.buyerId || buyerByAccount.get(account) || undefined;
    const accountKey = buyerId || [...identityKeys][0] || commentAccountKey(comment);
    const recentPurchase = Boolean(purchase && when - Date.parse(purchase.capturedAt) <= 90_000);
    const score = nameScore + (recentPurchase ? 8 : 0);
    const candidate: ConfirmedBuyerCandidate = {
      nickname: comment.nickname, accountKey, buyerId,
      commentId: purchase?.commentId || comment.id, capturedAt: purchase?.capturedAt || comment.capturedAt,
      platformMessageId: purchase?.platformMessageId || comment.platformMessageId,
      commentText: purchase?.content || comment.content, uniqueId: comment.uniqueId,
      nameScore, score, recentPurchase, purchaseRequestId: purchase?.id,
    };
    const previous = accounts.get(account);
    if (!previous || candidate.score > previous.score
      || (candidate.score === previous.score && candidate.capturedAt > previous.capturedAt)) accounts.set(account, candidate);
  }
  const ranked = [...accounts.values()].sort((a, b) => Number(b.nameScore === 100) - Number(a.nameScore === 100)
    || b.score - a.score || b.capturedAt.localeCompare(a.capturedAt));
  // Keep the top candidates even below the automatic threshold, so the sale never disappears.
  resolution.candidates = ranked.slice(0, 3);
  const first = ranked[0], second = ranked[1];
  if (!first || first.nameScore < 84) return resolution;
  // A similar name's purchase bonus must never displace a unique exact name.
  if (second && !(first.nameScore === 100 && second.nameScore < 100) && first.score - second.score < 8) return { ...resolution, status: 'AMBIGUOUS' };
  return { ...resolution, status: 'MATCHED', matchedBy: 'RULE' };
}

export function applyConfirmedBuyer<T extends Omit<SaleRecord, 'id'>>(sale: T, resolution: ConfirmedBuyerResolution): T {
  const candidate = resolution.status === 'MATCHED' ? resolution.candidates[0] : undefined;
  return {
    ...sale, status: '확정', buyerNickname: candidate?.nickname || BUYER_LINK_PENDING,
    buyerId: candidate?.buyerId, purchaseRequestId: candidate?.purchaseRequestId,
    sourceCommentIds: candidate ? [candidate.commentId] : [], pendingReasons: [],
    evidenceSnapshot: sale.evidenceSnapshot ? { ...sale.evidenceSnapshot, buyerResolution: resolution,
      relevantCommentIds: candidate ? [candidate.commentId] : [] } : undefined,
    note: candidate ? `4단 멘트 판매 확정 · 발화 "${resolution.spokenNickname}" → 댓글 "${candidate.nickname}" (${candidate.nameScore}점)`
      : '4단 멘트 판매 확정 · 댓글 닉네임 연결 확인 필요',
  };
}
