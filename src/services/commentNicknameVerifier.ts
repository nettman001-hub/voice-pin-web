import type { CommentRecord } from '../types/comment.ts';
import {
  compareNicknames,
  extractPhoneSuffix4Digits,
  normalizeNickname
} from './nicknameMatcher.ts';

const COMMENT_TIME_WINDOW_MS = 3 * 60 * 1000;

// "보여주세요", "입어주세요", "알려주세요", "해주세요" 등 단순 문의/요청형 어구 패턴 (구매 의사 아님)
export const NON_PURCHASE_VERB_PREFIX = /(?:보여|입어|비춰|알려|해|답변|설명|확인|바꿔|틀어)\s*(?:주세요|주세용|주세여)/u;

// "주세요" 앞에 동사 어간이 오지 않는 구매형 "주세요" 및 구매 키워드 패턴
export const PURCHASE_INTENT_PATTERN = /(저요|ㅈ\s*ㅇ|구매|살게요|살께요|(?<!보여\s*|입어\s*|비춰\s*|알려\s*|해\s*|답변\s*|설명\s*|확인\s*|바꿔\s*|틀어\s*)주세요|주문|결제|입금|확정)/u;

/**
 * 댓글의 구매 의사 여부 정밀 판별
 * "보여주세요", "입어주세요" 등은 제외하고, "1번 주세요", "저요", "살게요" 등만 구매 의사로 판정
 */
export function hasCommentPurchaseIntent(content?: string): boolean {
  if (!content) return false;
  const text = String(content).trim();

  // 1. "보여주세요", "입어주세요" 등 비구매 요청어가 포함된 경우
  if (NON_PURCHASE_VERB_PREFIX.test(text)) {
    // 단, 문장 내에 "1번 저요 보여주세요" 처럼 별도의 구매 키워드가 있다면 구매 의사로 인정
    const cleanWithoutRequest = text.replace(NON_PURCHASE_VERB_PREFIX, ' ');
    return /(저요|ㅈ\s*ㅇ|구매|살게요|살께요|주문|결제|입금|확정)/u.test(cleanWithoutRequest);
  }

  // 2. 순수 구매 의사 표현 (저요, ㅈㅇ, 살게요, 구매 등)
  if (/(저요|ㅈ\s*ㅇ|구매|살게요|살께요|주문|결제|입금|확정)/u.test(text)) {
    return true;
  }

  // 3. 단독 "주세요" 또는 구매 목적어 결합형 "주세요" ("1번 주세요", "이거 주세요", "하나 주세요")
  const isDirectGive = /^(?:제가\s*)?(?:주세요|주세용|주세여)[!?.~]*$/u.test(text);
  const isObjectGive = /(\b\d+번|\b이거|\b요거|\b그거|\b하나|\b1개|\b저|\b제게|\b\d{4})\s*(?:주세요|주세용|주세여)/u.test(text);

  return isDirectGive || isObjectGive;
}

export type NicknameVerificationKind =
  | 'EXACT'
  | 'SIMILAR'
  | 'SUFFIX'
  | 'AMBIGUOUS'
  | 'NO_NEARBY_COMMENT'
  | 'NO_MATCH'
  | 'NO_SPOKEN_NICKNAME';

export interface NicknameVerificationResult {
  kind: NicknameVerificationKind;
  verifiedNickname?: string;
  spokenNickname?: string;
  suffixDigits?: string;
  commentId?: string;
}

interface VerificationInput {
  transcript: string;
  spokenNickname: string;
  sessionId: string;
  recognizedAt: string;
  comments: CommentRecord[];
}

interface CommentCandidate {
  record: CommentRecord;
  normalizedNickname: string;
  distanceMs: number;
  isPriorComment: boolean; // 판매자 발화 이전에 작성된 선행 댓글인지 여부 (인과성 보장)
  hasPurchaseIntent: boolean;
}

const getSuffixDigits = (transcript: string) => {
  const match = String(transcript || '').match(/(?:끝|뒷|뒤)\s*(?:번호|자리)\s*(\d{3,12})\s*(?:번)?\s*(?:님|고객)?/u);
  return match?.[1] || undefined;
};

const similarityScore = (spoken: string, candidate: CommentCandidate) => {
  const comp = compareNicknames(spoken, candidate.record.nickname);
  if (!comp.isSimilar && !comp.isSame) return 0;

  let score = comp.score;

  // 1. 인과성 가산점: 판매자 발화 이전(선행) 5초~60초 이내 댓글 우선
  if (candidate.isPriorComment) {
    if (candidate.distanceMs <= 30_000) score += 8;
    else if (candidate.distanceMs <= 60_000) score += 5;
    else score += 2;
  } else {
    // 발화 이후(미래)에 올라온 댓글은 점수 차감/보수적 평가
    score -= 5;
  }

  // 2. 구매 의사("저요", "살게요" 등) 댓글 대폭 가산점 (+10점)
  // 마인드셋 ↔ 마일드셋 등 편집 거리 1(86점)인 경우도 "저요"가 있으면 96점 이상으로 상승하여 유력 후보 선정
  if (candidate.hasPurchaseIntent) {
    score += 10;
  }

  return Math.min(Math.max(score, 0), 100);
};

const uniqueNicknameCandidates = (candidates: CommentCandidate[]) => {
  const byNickname = new Map<string, CommentCandidate>();
  for (const candidate of candidates) {
    const existing = byNickname.get(candidate.normalizedNickname);
    if (
      !existing ||
      (candidate.hasPurchaseIntent && !existing.hasPurchaseIntent) ||
      (candidate.isPriorComment && !existing.isPriorComment) ||
      candidate.distanceMs < existing.distanceMs
    ) {
      byNickname.set(candidate.normalizedNickname, candidate);
    }
  }
  return [...byNickname.values()];
};

export function verifyNicknameFromComments({
  transcript,
  spokenNickname,
  sessionId,
  recognizedAt,
  comments
}: VerificationInput): NicknameVerificationResult {
  const suffixDigits =
    extractPhoneSuffix4Digits(transcript) ||
    extractPhoneSuffix4Digits(spokenNickname) ||
    getSuffixDigits(transcript);
  const normalizedSpoken = normalizeNickname(spokenNickname);
  const recognizedAtMs = new Date(recognizedAt).getTime();

  if (!Number.isFinite(recognizedAtMs)) {
    return { kind: 'NO_NEARBY_COMMENT', spokenNickname, suffixDigits };
  }

  const candidates = uniqueNicknameCandidates(
    comments
      .filter((comment) => comment.sessionId === sessionId)
      .map((record) => {
        const capturedAtMs = new Date(record.capturedAt).getTime();
        const diffMs = recognizedAtMs - capturedAtMs;
        // 판매자 발화 이전(또는 네트워크 지연 3초 이내)에 도착한 댓글을 선행 댓글로 판정
        const isPriorComment = diffMs >= -3000;
        return {
          record,
          normalizedNickname: normalizeNickname(record.nickname),
          distanceMs: Number.isFinite(capturedAtMs) ? Math.abs(diffMs) : Number.POSITIVE_INFINITY,
          isPriorComment,
          hasPurchaseIntent: hasCommentPurchaseIntent(record.content || '')
        };
      })
      .filter((candidate) => candidate.normalizedNickname && candidate.distanceMs <= COMMENT_TIME_WINDOW_MS)
  );

  if (candidates.length === 0) {
    return { kind: 'NO_NEARBY_COMMENT', spokenNickname, suffixDigits };
  }

  if (suffixDigits) {
    const suffixMatches = candidates.filter(
      (candidate) =>
        candidate.normalizedNickname.endsWith(suffixDigits) ||
        compareNicknames(spokenNickname, candidate.record.nickname).isSame
    );
    if (suffixMatches.length === 1) {
      const matched = suffixMatches[0];
      return {
        kind: 'SUFFIX',
        verifiedNickname: matched.record.nickname,
        spokenNickname,
        suffixDigits,
        commentId: matched.record.id
      };
    }
    return {
      kind: suffixMatches.length > 1 ? 'AMBIGUOUS' : 'NO_MATCH',
      spokenNickname,
      suffixDigits
    };
  }

  if (!normalizedSpoken || normalizedSpoken === normalizeNickname('미확인(보류)')) {
    return { kind: 'NO_SPOKEN_NICKNAME', spokenNickname };
  }

  const scored = candidates
    .map((candidate) => ({ candidate, score: similarityScore(normalizedSpoken, candidate) }))
    .filter((item) => item.score >= 74)
    .sort((left, right) => right.score - left.score || left.candidate.distanceMs - right.candidate.distanceMs);

  if (scored.length === 0) {
    return { kind: 'NO_MATCH', spokenNickname };
  }

  const first = scored[0];
  const second = scored[1];
  if (second && first.score !== 100 && first.score - second.score < 8) {
    return { kind: 'AMBIGUOUS', spokenNickname };
  }

  const comp = compareNicknames(normalizedSpoken, first.candidate.record.nickname);
  const kind: NicknameVerificationKind =
    comp.reason === 'EXACT'
      ? 'EXACT'
      : comp.reason === 'SUFFIX_CONFIRMED'
        ? 'SUFFIX'
        : 'SIMILAR';

  return {
    kind,
    verifiedNickname: first.candidate.record.nickname,
    spokenNickname,
    suffixDigits: comp.matchedSuffixDigits || suffixDigits,
    commentId: first.candidate.record.id
  };
}

export function nicknameVerificationNote(result: NicknameVerificationResult) {
  if (result.kind === 'EXACT') {
    return `댓글 닉네임 검증 완료: 발화 "${result.spokenNickname}" → 댓글 "${result.verifiedNickname}"`;
  }
  if (result.kind === 'SIMILAR') {
    return `댓글 닉네임 검증 완료(유사 일치): 발화 "${result.spokenNickname}" → 댓글 "${result.verifiedNickname}"`;
  }
  if (result.kind === 'SUFFIX') {
    return `댓글 닉네임 검증 완료(끝번호 ${result.suffixDigits}): 댓글 "${result.verifiedNickname}"`;
  }
  if (result.kind === 'AMBIGUOUS') {
    return `댓글 닉네임 검증 필요: "${result.spokenNickname}"에 맞는 댓글 닉네임 후보가 여러 명입니다.`;
  }
  if (result.kind === 'NO_MATCH' && result.suffixDigits) {
    return `댓글 닉네임 검증 필요: 끝번호 ${result.suffixDigits}와 일치하는 같은 회차 댓글 닉네임을 찾지 못했습니다.`;
  }
  if (result.kind === 'NO_SPOKEN_NICKNAME') {
    return '댓글 닉네임 검증 필요: 판매자 발화에서 구매자 닉네임을 찾지 못했습니다.';
  }
  return `댓글 닉네임 검증 필요: "${result.spokenNickname}"와 비슷한 시간대의 같은 회차 댓글 닉네임을 찾지 못했습니다.`;
}
