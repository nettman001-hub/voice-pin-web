import { parseBuyerNickname, parseKoreanAmount } from './salesExtractor';

export interface VoiceCommandResult {
  type: 'START_EDIT' | 'FIELD_UPDATE' | 'FINISH_EDIT' | 'DELETE_LAST' | 'NONE';
  updatedNickname?: string;
  updatedAmount?: number;
  rawText: string;
}

export function parseVoiceCommand(text: string, isCurrentlyEditing: boolean): VoiceCommandResult {
  if (!text) return { type: 'NONE', rawText: '' };
  const clean = text.trim();

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

  // 3. "방금 건 삭제", "삭제해줘"
  if (clean.includes('방금 건 삭제') || clean.includes('방금거 삭제') || clean.includes('삭제')) {
    return {
      type: 'DELETE_LAST',
      rawText: clean,
    };
  }

  // 4. 수정 대기 상태에서 필드 업데이트 ("닉네임은 xxx, 금액은 xxx", "금액 3만원으로 변경", "닉네임 영희")
  if (isCurrentlyEditing) {
    const updatedNickname = parseBuyerNickname(clean) || undefined;
    const updatedAmount = parseKoreanAmount(clean) || undefined;

    // 만약 닉네임만 말했을 때 ("닉네임 홍길동", "이름 홍길동")
    let directNickname: string | undefined = updatedNickname;
    if (!directNickname) {
      const nameMatch = clean.match(/(?:닉네임|이름)(?:은|이)?\s*([가-힣a-zA-Z0-9_]+)/);
      if (nameMatch) {
        directNickname = nameMatch[1].trim();
      }
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
