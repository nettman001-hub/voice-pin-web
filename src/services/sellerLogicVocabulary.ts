import { spellEnglishToKorean, transliterateEnglishToKorean } from './nicknameMatcher';

export const SELLER_LOGIC_NICKNAME_LIMIT = 50;
export interface SellerLogicNicknameSource { nickname: string; capturedAt?: string; receivedAt?: string }

/** Identity always remains the exact platform display name; hints are only STT context. */
export function recentSellerLogicNicknames(comments: SellerLogicNicknameSource[], priority: string[] = []): string[] {
  const recent = [...comments].map((comment, index) => ({ comment, index })).sort((a, b) => {
    const timeA = Date.parse(a.comment.capturedAt || a.comment.receivedAt || '') || 0;
    const timeB = Date.parse(b.comment.capturedAt || b.comment.receivedAt || '') || 0;
    return timeB - timeA || b.index - a.index;
  }).map(({ comment }) => comment.nickname);
  return [...new Set([...priority, ...recent].filter((name) => typeof name === 'string' && name.trim()))]
    .slice(0, SELLER_LOGIC_NICKNAME_LIMIT);
}

/** Fifty people, at most 100 terms: originals first, one Korean reading per Latin name. */
export function sellerLogicNicknameTerms(nicknames: string[]): string[] {
  const names = [...new Set(nicknames)].slice(0, SELLER_LOGIC_NICKNAME_LIMIT);
  const readings = names.filter((name) => /[a-z]/iu.test(name)).map((name) =>
    name.replace(/[a-z]+/giu, (letters) => letters.length === 1
      ? spellEnglishToKorean(letters)
      : transliterateEnglishToKorean(letters)));
  return [...new Set([...names, ...readings])];
}
