/**
 * 닉네임 정밀 비교 및 매칭 엔진
 * 
 * 1. 규칙 1 (편집 거리 및 반복 글자):
 *    - 편집 거리(Levenshtein Distance) <= 1
 *    - 또는 한쪽이 다른 쪽에 완전히 포함되고 길이 차이 <= 1
 *    - 또는 마지막 글자가 반복 추가·삭제됨 (예: "코맹" ↔ "코맹맹")
 *    - 판정: 유사함 (SIMILAR)
 * 
 * 2. 규칙 2 (영문 단어 한글 발음 변환 및 숫자 식별자 분리):
 *    - 대소문자 통일 (lowercase)
 *    - 닉네임 앞뒤의 숫자 분리 (예: "mindset0517" -> "mindset", "0517")
 *    - 영문 단어를 한글 발음으로 변환 ("mindset" -> "마인드셋")
 *    - 변환 전/후 문자열 교차 비교 ("마인드셋" = "마인드셋")
 *    - 판정: 매우 유사함 (PHONETIC_EXACT / PHONETIC_SIMILAR)
 * 
 * 3. 규칙 3 (전화번호 뒷번호 4자리 식별자 일치 판정):
 *    - "님", 공백, 특수문자 제거
 *    - 뒷번호, 끝번호, 전화번호 뒤, 번호, 뒷자리 등 호칭 표현 감지
 *    - 뒤의 4자리 숫자 추출 ("0517")
 *    - 다른 닉네임 끝의 4자리 숫자와 비교 ("mindset0517" -> "0517")
 *    - 일치 시 동일인 후보가 아니라 "같은 닉네임"으로 확정 (SUFFIX_CONFIRMED)
 */

export type NicknameMatchReason =
  | 'EXACT'                        // 완전 일치
  | 'SUFFIX_CONFIRMED'            // 규칙 3: 뒷번호 4자리 식별자 일치 (같은 닉네임 확정)
  | 'BASE_EXACT'                  // 숫자 제거 후 기본 텍스트 완전 일치
  | 'PHONETIC_EXACT'              // 규칙 2: 영문-한글 발음 완전 일치 (mindset = 마인드셋)
  | 'PHONETIC_SIMILAR'            // 규칙 2: 영문-한글 발음 후 유사 일치
  | 'EDIT_DISTANCE_1'             // 규칙 1: 편집 거리 <= 1
  | 'INCLUSION_DIFF_1'            // 규칙 1: 한쪽 포함 및 길이차 <= 1 (코맹 ↔ 코맹맹)
  | 'REPEATED_TRAILING_CHAR'      // 규칙 1: 마지막 글자 반복 추가/삭제 (코맹 ↔ 코맹맹)
  | 'SIMILAR_RATIO'               // 일반 유사도 기준 충족
  | 'NO_MATCH';

export interface NicknameComparisonResult {
  isSame: boolean;                // 동일 닉네임으로 확정 여부 (EXACT or SUFFIX_CONFIRMED or BASE_EXACT with same suffix)
  isSimilar: boolean;             // 유사 닉네임 여부 (규칙 1, 2, 3 등)
  score: number;                  // 0 ~ 100 점수
  reason: NicknameMatchReason;
  matchedSuffixDigits?: string;
  normalizedLeft?: string;
  normalizedRight?: string;
  details?: string;
}

// 4자리 전화번호 뒷번호 호칭 정규식
// 예: "뒷번호 0517", "끝번호 1234", "전화번호 뒤 5678", "전화 뒤 0517", "뒷자리 0517", "끝자리 0517", "번호 0517", "0517번", "0517님"
const PHONE_SUFFIX_KEYWORD_REGEX = /(?:끝\s*번호|뒷\s*번호|뒤\s*번호|전화\s*번호\s*뒤|전화\s*뒤|뒷\s*자리|끝\s*자리|핸드폰\s*뒤|폰\s*뒤|번호)\s*[:：#]?\s*(\d{4})/u;
const TRAILING_4DIGITS_REGEX = /(\d{4})$/;
const DIGITS_ONLY_4_REGEX = /^\d{4}$/;

/** 닉네임 기본 문자열 정규화 */
export const normalizeNickname = (value?: string): string => {
  if (!value) return '';
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .trim()
    .replace(/^@/, '')
    .replace(/님\s*$/u, '')
    // 공백·문장부호·기호 제거 (한글, 영문, 숫자는 유지)
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/님$/u, '');
};

/** 뒷번호 호칭 및 4자리 식별자 추출 */
export function extractPhoneSuffix4Digits(text?: string): string | null {
  if (!text) return null;
  const raw = String(text).normalize('NFKC');
  
  // 1. "뒷번호 0517", "끝번호 1234" 등 명시적 호칭 패턴
  const kwMatch = raw.match(PHONE_SUFFIX_KEYWORD_REGEX);
  if (kwMatch && kwMatch[1]) {
    return kwMatch[1];
  }

  // 2. "0517님", "0517번" 처럼 숫자 4자리만으로 구성된 호칭
  const clean = normalizeNickname(raw);
  if (DIGITS_ONLY_4_REGEX.test(clean)) {
    return clean;
  }

  return null;
}

/** 닉네임 끝에 붙은 4자리 숫자 추출 (예: mindset0517 -> 0517) */
export function extractTrailing4Digits(text?: string): string | null {
  if (!text) return null;
  const clean = normalizeNickname(text);
  const match = clean.match(TRAILING_4DIGITS_REGEX);
  return match ? match[1] : null;
}

/**
 * 라이브 커머스 빈출 영문 닉네임 단어 사전 (한글 발음 매핑)
 */
const ENGLISH_TO_KOREAN_DICT: Record<string, string> = {
  mindset: '마인드셋',
  mind: '마인드',
  set: '셋',
  lovely: '러블리',
  love: '러브',
  shop: '샵',
  store: '스토어',
  market: '마켓',
  mart: '마트',
  sweet: '스윗',
  honey: '허니',
  candy: '캔디',
  jelly: '젤리',
  baby: '베이비',
  pink: '핑크',
  blue: '블루',
  black: '블랙',
  white: '화이트',
  red: '레드',
  green: '그린',
  yellow: '옐로우',
  gold: '골드',
  silver: '실버',
  rose: '로즈',
  flower: '플라워',
  star: '스타',
  moon: '문',
  sun: '선',
  sky: '스카이',
  queen: '퀸',
  king: '킹',
  prince: '프린스',
  princess: '프린세스',
  beauty: '뷰티',
  pretty: '프리티',
  angel: '엔젤',
  daily: '데일리',
  look: '룩',
  style: '스타일',
  closet: '클로젯',
  room: '룸',
  home: '홈',
  house: '하우스',
  coffee: '커피',
  cafe: '카페',
  latte: '라떼',
  choco: '초코',
  mint: '민트',
  berry: '베리',
  cherry: '체리',
  mango: '망고',
  peach: '피치',
  lemon: '레몬',
  apple: '애플',
  banana: '바나나',
  orange: '오렌지',
  happy: '해피',
  lucky: '럭키',
  smile: '스마일',
  boutique: '부티크',
  vintage: '빈티지',
  fashion: '패션',
  story: '스토리',
  dream: '드림',
  magic: '매직',
  rainbow: '레인보우',
  cat: '캣',
  dog: '도그',
  bear: '베어',
  rabbit: '래빗',
  mini: '미니',
  super: '슈퍼',
  mega: '메가',
  smart: '스마트',
  speed: '스피드',
  champion: '챔피언',
  hero: '히어로',
  master: '마스터',
  ace: '에이스',
  pro: '프로',
  best: '베스트',
  top: '탑',
  one: '원',
  two: '투',
  plus: '플러스',
  max: '맥스',
  zone: '존',
  club: '클럽',
  world: '월드',
  land: '랜드',
  park: '파크',
  time: '타임',
  day: '데이',
  night: '나이트',
  friend: '프렌드',
  family: '패밀리',
  ribbon: '리본',
  box: '박스',
  bag: '백',
  shoe: '슈즈',
  shoes: '슈즈',
  dress: '드레스',
  onepiece: '원피스',
  clear: '클리어',
  clean: '클린',
  pure: '퓨어',
  rich: '리치',
  fresh: '프레시',
  cool: '쿨',
  hot: '핫',
  warm: '웜',
  spring: '스프링',
  summer: '썸머',
  autumn: '어텀',
  winter: '윈터'
};

/**
 * 영문 단어 한글 발음 변환 (사전 + 복합어 분할 + 음운 음절 결합)
 */
export function transliterateEnglishToKorean(text?: string): string {
  if (!text) return '';
  const clean = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return text;

  // 1. 사전 완전 일치
  if (ENGLISH_TO_KOREAN_DICT[clean]) {
    return ENGLISH_TO_KOREAN_DICT[clean];
  }

  // 2. 복합어 탐색 (Greedy Match)
  let remaining = clean;
  let converted = '';
  let anyMatched = false;

  while (remaining.length > 0) {
    let matched = false;
    for (let len = remaining.length; len >= 2; len--) {
      const prefix = remaining.slice(0, len);
      if (ENGLISH_TO_KOREAN_DICT[prefix]) {
        converted += ENGLISH_TO_KOREAN_DICT[prefix];
        remaining = remaining.slice(len);
        matched = true;
        anyMatched = true;
        break;
      }
    }
    if (!matched) {
      // 1글자 단위 음운 변환
      converted += phoneticCharFallback(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return anyMatched || converted.length > 0 ? converted : clean;
}

/** 영문 1글자 음운 대체 (G2P 폴백) */
function phoneticCharFallback(ch: string): string {
  const map: Record<string, string> = {
    a: '아', b: '브', c: '크', d: '드', e: '에', f: '프', g: '그', h: '흐',
    i: '이', j: '즈', k: '크', l: '르', m: '므', n: '느', o: '오', p: '프',
    q: '큐', r: '르', s: '스', t: '트', u: '유', v: '브', w: '더블유', x: '엑스',
    y: '와이', z: '즈'
  };
  return map[ch] || ch;
}

/** 편집 거리 (Levenshtein Distance) */
export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** 끝 글자 연속 중복 문자 확인 (예: "코맹맹" -> "맹" 반복) */
function checkRepeatedTrailingChars(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (shorter.length === 0 || !longer.startsWith(shorter)) return false;

  const lastChar = shorter[shorter.length - 1];
  const trailing = longer.slice(shorter.length);
  // 남은 부분이 모두 마지막 글자의 반복인지 확인
  return Array.from(trailing).every((ch) => ch === lastChar);
}

/**
 * 닉네임 정밀 비교 메인 함수
 * 규칙 1, 2, 3을 순차 적용하여 비교 결과를 산출한다.
 */
export function compareNicknames(left?: string, right?: string): NicknameComparisonResult {
  const rawLeft = String(left || '').trim();
  const rawRight = String(right || '').trim();

  if (!rawLeft || !rawRight) {
    return { isSame: false, isSimilar: false, score: 0, reason: 'NO_MATCH' };
  }

  const cleanLeft = normalizeNickname(rawLeft);
  const cleanRight = normalizeNickname(rawRight);

  // 1. 완전 일치 (Exact Match)
  if (cleanLeft === cleanRight) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'EXACT',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: '닉네임 문자열 완전 일치'
    };
  }

  // -------------------------------------------------------------
  // 규칙 3: 전화번호 뒷번호 4자리 식별자 일치 판정
  // "뒷번호 0517님" ↔ "mindset0517"
  // 둘이 같으면 동일인 후보가 아니라 "같은 닉네임"으로 확정!
  // -------------------------------------------------------------
  const phoneSuffixLeft = extractPhoneSuffix4Digits(rawLeft);
  const phoneSuffixRight = extractPhoneSuffix4Digits(rawRight);
  const trailing4Left = extractTrailing4Digits(rawLeft);
  const trailing4Right = extractTrailing4Digits(rawRight);

  // Left가 뒷번호 호칭이고 Right의 끝 4자리와 일치할 때
  if (phoneSuffixLeft && trailing4Right && phoneSuffixLeft === trailing4Right) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'SUFFIX_CONFIRMED',
      matchedSuffixDigits: phoneSuffixLeft,
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `뒷번호 호칭(${phoneSuffixLeft})과 식별자(${trailing4Right}) 일치로 같은 닉네임 확정`
    };
  }

  // Right가 뒷번호 호칭이고 Left의 끝 4자리와 일치할 때
  if (phoneSuffixRight && trailing4Left && phoneSuffixRight === trailing4Left) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'SUFFIX_CONFIRMED',
      matchedSuffixDigits: phoneSuffixRight,
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `뒷번호 호칭(${phoneSuffixRight})과 식별자(${trailing4Left}) 일치로 같은 닉네임 확정`
    };
  }

  // 둘 다 뒷번호 호칭이고 4자리가 일치할 때
  if (phoneSuffixLeft && phoneSuffixRight && phoneSuffixLeft === phoneSuffixRight) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'SUFFIX_CONFIRMED',
      matchedSuffixDigits: phoneSuffixLeft,
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `양측 뒷번호 호칭(${phoneSuffixLeft}) 일치로 같은 닉네임 확정`
    };
  }

  // -------------------------------------------------------------
  // 규칙 2: 영문 단어 한글 발음 변환 및 숫자 식별자 분리
  // "mindset0517" ↔ "마인드셋"
  // 대소문자 통일 -> 숫자 제거 -> 한글 발음 변환 -> 교차 비교
  // -------------------------------------------------------------
  const baseLeft = cleanLeft.replace(/\d+/g, '');
  const baseRight = cleanRight.replace(/\d+/g, '');

  if (baseLeft && baseRight) {
    // A. 숫자 제거 후 기본 문자열 완전 일치 (예: mindset0517 vs mindset)
    if (baseLeft === baseRight) {
      return {
        isSame: true,
        isSimilar: true,
        score: 98,
        reason: 'BASE_EXACT',
        normalizedLeft: cleanLeft,
        normalizedRight: cleanRight,
        details: `숫자 제거 후 기본 닉네임 일치 ("${baseLeft}")`
      };
    }

    // B. 한글 발음 변환 (English -> Hangul)
    const phoneticLeft = transliterateEnglishToKorean(baseLeft);
    const phoneticRight = transliterateEnglishToKorean(baseRight);

    // 발음 변환 후 일치 검사:
    // 1) phoneticLeft === baseRight (예: "마인드셋" === "마인드셋")
    // 2) phoneticRight === baseLeft (예: "마인드셋" === "마인드셋")
    // 3) phoneticLeft === phoneticRight (둘 다 영문 변환 후 일치)
    if (
      (phoneticLeft && phoneticLeft === baseRight) ||
      (phoneticRight && phoneticRight === baseLeft) ||
      (phoneticLeft && phoneticRight && phoneticLeft === phoneticRight && phoneticLeft !== baseLeft)
    ) {
      return {
        isSame: false,
        isSimilar: true,
        score: 95,
        reason: 'PHONETIC_EXACT',
        normalizedLeft: cleanLeft,
        normalizedRight: cleanRight,
        details: `영문-한글 발음 변환 일치 ("${baseLeft}" ↔ "${baseRight}" [발음: ${phoneticLeft || phoneticRight}])`
      };
    }

    // 발음 변환본 간의 규칙 1 적용 (발음 후 편집거리 <= 1 등)
    if (phoneticLeft && phoneticRight && (phoneticLeft !== baseLeft || phoneticRight !== baseRight)) {
      const phoneticDist = levenshteinDistance(phoneticLeft, phoneticRight);
      const phoneticInclusion =
        (phoneticLeft.includes(phoneticRight) || phoneticRight.includes(phoneticLeft)) &&
        Math.abs(phoneticLeft.length - phoneticRight.length) <= 1;

      if (phoneticDist <= 1 || phoneticInclusion) {
        return {
          isSame: false,
          isSimilar: true,
          score: 90,
          reason: 'PHONETIC_SIMILAR',
          normalizedLeft: cleanLeft,
          normalizedRight: cleanRight,
          details: `영문-한글 발음 변환 후 유사 ("${phoneticLeft}" ↔ "${phoneticRight}")`
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 규칙 1: 편집 거리 <= 1 또는 포함 관계 또는 마지막 글자 반복
  // "코맹" ↔ "코맹맹"
  // -------------------------------------------------------------
  // 1. 마지막 글자가 반복 추가·삭제됨 (예: "코맹" + "맹" = "코맹맹")
  if (checkRepeatedTrailingChars(cleanLeft, cleanRight)) {
    return {
      isSame: false,
      isSimilar: true,
      score: 90,
      reason: 'REPEATED_TRAILING_CHAR',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `마지막 글자 반복 추가/삭제 일치 ("${cleanLeft}" ↔ "${cleanRight}")`
    };
  }

  // 2. 한쪽이 다른 쪽에 완전히 포함되고 길이 차이 <= 1
  const inclusionDiff1 =
    (cleanLeft.includes(cleanRight) || cleanRight.includes(cleanLeft)) &&
    Math.abs(cleanLeft.length - cleanRight.length) <= 1;

  if (inclusionDiff1) {
    return {
      isSame: false,
      isSimilar: true,
      score: 88,
      reason: 'INCLUSION_DIFF_1',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `상호 포함 및 길이 차이 1 이하 ("${cleanLeft}" ↔ "${cleanRight}")`
    };
  }

  // 3. 편집 거리(Levenshtein distance) <= 1
  const dist = levenshteinDistance(cleanLeft, cleanRight);
  if (dist <= 1) {
    return {
      isSame: false,
      isSimilar: true,
      score: 86,
      reason: 'EDIT_DISTANCE_1',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `편집 거리 1 이하 ("${cleanLeft}" ↔ "${cleanRight}", distance=${dist})`
    };
  }

  // 4. 일반 유사도 비율 (길이 3 이상에서 72% 이상인 경우)
  const maxLen = Math.max(cleanLeft.length, cleanRight.length);
  if (maxLen >= 3) {
    const ratio = 1 - dist / maxLen;
    if (ratio >= 0.72) {
      return {
        isSame: false,
        isSimilar: true,
        score: Math.round(ratio * 90),
        reason: 'SIMILAR_RATIO',
        normalizedLeft: cleanLeft,
        normalizedRight: cleanRight,
        details: `정규화 유사도 충족 (ratio=${(ratio * 100).toFixed(1)}%)`
      };
    }
  }

  return {
    isSame: false,
    isSimilar: false,
    score: 0,
    reason: 'NO_MATCH',
    normalizedLeft: cleanLeft,
    normalizedRight: cleanRight
  };
}

/** 동일 닉네임 확정 여부 (완전 일치 또는 뒷번호 식별자 확정) */
export function areNicknamesSame(left?: string, right?: string): boolean {
  const result = compareNicknames(left, right);
  return result.isSame;
}

/** 유사 닉네임 여부 (규칙 1, 2, 3 포함) */
export function areNicknamesSimilar(left?: string, right?: string): boolean {
  const result = compareNicknames(left, right);
  return result.isSame || result.isSimilar;
}
