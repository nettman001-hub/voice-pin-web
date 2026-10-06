import { getBuyerNicknameCandidates, parseBuyerNickname, parseKoreanAmount } from './salesExtractor.ts';
import { isNegatedVoiceAction, isQuestionUtterance } from './voiceUtteranceService.ts';

export interface VoiceCommandResult {
  type: 'START_EDIT' | 'FIELD_UPDATE' | 'FINISH_EDIT' | 'DELETE_LAST' | 'NONE';
  updatedNickname?: string;
  updatedAmount?: number;
  rawText: string;
}

/** "댓글 삭제됐네요"처럼 판매와 무관한 "삭제"는 명령이 아니다. */
export const DELETE_LAST_PATTERN = /(?:방금|마지막)\s*(?:건|거|것|판매|주문)?\s*(?:을|를)?\s*삭제/u;

export function parseVoiceCommand(text: string, isCurrentlyEditing: boolean): VoiceCommandResult {
  if (!text) return { type: 'NONE', rawText: '' };
  const clean = text.trim();
  if (isQuestionUtterance(clean) || isNegatedVoiceAction(clean)) return { type: 'NONE', rawText: clean };

  // 1. "수정 완료", "수정 끝", "완료"
  if (isCurrentlyEditing && (clean.includes('수정 완료') || clean.includes('수정완료') || clean.includes('수정 끝') || clean === '완료')) {
    return {
      type: 'FINISH_EDIT',
      rawText: clean,
    };
  }

  // 2. "수정 시작", "방금 건 수정", "수정"
  if (!isCurrentlyEditing && (clean.includes('수정 시작') || clean.includes('방금 건 수정') || clean.includes('방금거 수정') || clean === '수정')) {
    return {
      type: 'START_EDIT',
      rawText: clean,
    };
  }

  // 3. "방금 건 삭제", "마지막 판매 삭제": 실제 판매를 지우므로 대상이 분명한 말만 받는다.
  if (DELETE_LAST_PATTERN.test(clean)) {
    return {
      type: 'DELETE_LAST',
      rawText: clean,
    };
  }

  // 4. 수정 대기 상태에서 필드 업데이트 ("닉네임은 xxx, 금액은 xxx", "금액 3만원으로 변경", "닉네임 영희")
  if (isCurrentlyEditing) {
    // The explicit-label fallback must not turn an ambiguous parser result
    // back into the first buyer (or update their amount as a side effect).
    if (getBuyerNicknameCandidates(clean).length > 1) return { type: 'NONE', rawText: clean };
    const updatedNickname = parseBuyerNickname(clean) || undefined;
    const updatedAmount = parseKoreanAmount(clean) || undefined;

    // 만약 닉네임만 말했을 때 ("닉네임 홍길동", "이름 홍길동")
    let directNickname: string | undefined = updatedNickname;
    if (!directNickname) {
      const directNames = [...new Set([...clean.matchAll(/(?:닉네임|이름)(?:은|이)?\s*([가-힣a-zA-Z0-9_]+)/gu)]
        .map((match) => match[1].trim()))];
      if (directNames.length > 1) return { type: 'NONE', rawText: clean };
      directNickname = directNames[0];
    }

    if (directNickname || updatedAmount) {
      return {
        type: 'FIELD_UPDATE',
        updatedNickname: directNickname,
        updatedAmount,
        rawText: clean,
      };
    }
  }

  return { type: 'NONE', rawText: clean };
}
