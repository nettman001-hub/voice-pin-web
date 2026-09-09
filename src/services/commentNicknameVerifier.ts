import type { CommentRecord } from '../types/comment';
import {
  compareNicknames,
  extractPhoneSuffix4Digits,
  normalizeNickname
} from './nicknameMatcher';

const COMMENT_TIME_WINDOW_MS = 3 * 60 * 1000;
const PURCHASE_INTENT_PATTERN = /(저요|ㅈ\s*ㅇ|구매|살게요|살께요|주세요|주문|결제|입금|확정)/u;

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
  if (candidate.distanceMs <= 30_000) score += 6;
  else if (candidate.distanceMs <= 90_000) score += 3;
  if (candidate.hasPurchaseIntent) score += 3;
  return Math.min(score, 100);
};

const uniqueNicknameCandidates = (candidates: CommentCandidate[]) => {
  const byNickname = new Map<string, CommentCandidate>();
  for (const candidate of candidates) {
    const existing = byNickname.get(candidate.normalizedNickname);
    if (
      !existing ||
      candidate.distanceMs < existing.distanceMs ||
      (candidate.distanceMs === existing.distanceMs && candidate.hasPurchaseIntent && !existing.hasPurchaseIntent)
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
        return {
          record,
          normalizedNickname: normalizeNickname(record.nickname),
          distanceMs: Number.isFinite(capturedAtMs) ? Math.abs(capturedAtMs - recognizedAtMs) : Number.POSITIVE_INFINITY,
          hasPurchaseIntent: PURCHASE_INTENT_PATTERN.test(record.content || '')
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
