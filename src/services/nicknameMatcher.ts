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

export type NicknameMatchType =
  | 'exact'
  | 'spelled-pronunciation'
  | 'word-pronunciation'
  | 'prefix'
  | 'suffix'
  | 'numeric'
  | 'fuzzy'
  | 'none';

export type NicknameMatchReason =
  | 'EXACT'                        // 완전 일치
  | 'SPELLED_PRONUNCIATION'        // 영문 철자 발음 완전 일치 (gieblsmdi = 지아이이비엘에스엠디아이)
  | 'SUFFIX_CONFIRMED'            // 규칙 3: 뒷번호/뒷자리 식별자 일치 (같은 닉네임 확정)
  | 'PREFIX_CONFIRMED'            // 앞자리 식별자 일치 (같은 닉네임 확정)
  | 'BASE_EXACT'                  // 숫자 제거 후 기본 텍스트 완전 일치
  | 'PHONETIC_EXACT'              // 규칙 2: 영문-한글 발음 완전 일치 (mindset = 마인드셋)
  | 'PHONETIC_SIMILAR'            // 규칙 2: 영문-한글 발음 후 유사 일치
  | 'NUMERIC_MATCH'               // 숫자 부분 전체 일치
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
  matchType?: NicknameMatchType;
  matchedSuffixDigits?: string;
  normalizedLeft?: string;
  normalizedRight?: string;
  details?: string;
}

export interface NicknameAliases {
  original: string;
  normalized: string;
  spelledPronunciations: string[];
  wordPronunciations: string[];
  numericPronunciations: string[];
  combinedPronunciations: string[];
}

export interface NicknameMatchResult {
  matched: boolean;
  ambiguous: boolean;
  score: number;
  matchType: NicknameMatchType;
  matchedNickname?: string;
  candidates?: string[];
  reason: string;
}

// =========================================================================
// 1. 영문자별 한국어 철자 발음 매핑 (A-Z)
// =========================================================================
export const ALPHABET_SPELLED_MAP: Record<string, string> = {
  a: '에이',
  b: '비',
  c: '씨',
  d: '디',
  e: '이',
  f: '에프',
  g: '지',
  h: '에이치',
  i: '아이',
  j: '제이',
  k: '케이',
  l: '엘',
  m: '엠',
  n: '엔',
  o: '오',
  p: '피',
  q: '큐',
  r: '알',
  s: '에스',
  t: '티',
  u: '유',
  v: '브이',
  w: '더블유',
  x: '엑스',
  y: '와이',
  z: '지'
};

// 철자 발음 역변환 토큰 (긴 음절 우선)
export const SPELLED_KOREAN_TOKENS: Array<{ kor: string; letter: string }> = [
  { kor: '더블유', letter: 'w' },
  { kor: '에이치', letter: 'h' },
  { kor: '에이', letter: 'a' },
  { kor: '에프', letter: 'f' },
  { kor: '아이', letter: 'i' },
  { kor: '제이', letter: 'j' },
  { kor: '케이', letter: 'k' },
  { kor: '에스', letter: 's' },
  { kor: '브이', letter: 'v' },
  { kor: '엑스', letter: 'x' },
  { kor: '와이', letter: 'y' },
  { kor: '비', letter: 'b' },
  { kor: '씨', letter: 'c' },
  { kor: '디', letter: 'd' },
  { kor: '이', letter: 'e' },
  { kor: '지', letter: 'g' },
  { kor: '엘', letter: 'l' },
  { kor: '엠', letter: 'm' },
  { kor: '엔', letter: 'n' },
  { kor: '오', letter: 'o' },
  { kor: '피', letter: 'p' },
  { kor: '큐', letter: 'q' },
  { kor: '알', letter: 'r' },
  { kor: '티', letter: 't' },
  { kor: '유', letter: 'u' }
];

// =========================================================================
// 2. 숫자 한 자리씩 발음 매핑 (0-9)
// =========================================================================
export const DIGIT_PRONUNCIATION_MAP: Record<string, string[]> = {
  '0': ['공', '영', '제로'],
  '1': ['일', '하나'],
  '2': ['이', '둘'],
  '3': ['삼', '셋'],
  '4': ['사', '넷'],
  '5': ['오', '다섯'],
  '6': ['육', '여섯'],
  '7': ['칠', '일곱'],
  '8': ['팔', '여덟'],
  '9': ['구', '아홉']
};

export const KOREAN_DIGIT_TOKENS: Array<{ kor: string; digit: string }> = [
  { kor: '제로', digit: '0' },
  { kor: '하나', digit: '1' },
  { kor: '다섯', digit: '5' },
  { kor: '여섯', digit: '6' },
  { kor: '일곱', digit: '7' },
  { kor: '여덟', digit: '8' },
  { kor: '아홉', digit: '9' },
  { kor: '영', digit: '0' },
  { kor: '공', digit: '0' },
  { kor: '일', digit: '1' },
  { kor: '이', digit: '2' },
  { kor: '둘', digit: '2' },
  { kor: '삼', digit: '3' },
  { kor: '셋', digit: '3' },
  { kor: '사', digit: '4' },
  { kor: '넷', digit: '4' },
  { kor: '오', digit: '5' },
  { kor: '육', digit: '6' },
  { kor: '칠', digit: '7' },
  { kor: '팔', digit: '8' },
  { kor: '구', digit: '9' }
];

// =========================================================================
// 3. 접두부/접미부 위치 표현 및 안내어/호칭 목록
// =========================================================================
export const SUFFIX_KEYWORDS = [
  '마지막자리',
  '마지막번호',
  '전화번호뒤',
  '전화번호 뒤',
  '핸드폰뒤',
  '핸드폰 뒤',
  '전화뒤',
  '전화 뒤',
  '폰뒤',
  '폰 뒤',
  '뒷자리',
  '뒷번호',
  '뒤번호',
  '끝자리',
  '끝번호',
  '마지막'
];

export const PREFIX_KEYWORDS = [
  '처음자리',
  '앞자리',
  '앞번호',
  '첫자리',
  '첫번호',
  '처음'
];

export const REMOVABLE_HONORIFICS = [
  '고객님',
  '회원님',
  '아이디',
  '닉네임',
  '계정명',
  '사용자',
  '고객',
  '회원',
  '계정',
  '유저',
  '님',
  '씨',
  '이'
];

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
 * 불필요한 호칭 및 안내어 안전 제거 (문자열 앞뒤 경계 기반)
 */
export function cleanHonorificsAndGuides(text?: string): string {
  if (!text) return '';
  let clean = String(text)
    .normalize('NFKC')
    .trim()
    .replace(/^@/, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');

  // 앞부분 안내어 제거: 닉네임은, 닉네임, 아이디, 계정명, 계정, 사용자, 유저, 회원님, 회원, 고객님, 고객
  clean = clean.replace(/^(?:닉네임은?|닉네임|아이디|계정명|계정|사용자|유저|회원님|회원|고객님|고객)[:：#\s]*/u, '');

  // 뒷부분 호칭 제거: 고객님, 회원님, 아이디, 닉네임, 계정명, 계정, 사용자, 유저, 고객, 회원, 님
  clean = clean.replace(/(?:고객님|회원님|아이디|닉네임|계정명|계정|사용자|유저|고객|회원|님)$/u, '');

  return clean;
}

// 접두부/접미부 감지용 정규식 (호칭/위치 표현에 띄어쓰기가 들어간 경우도 완벽 대응)
const SUFFIX_REGEX = /^(?:마지막\s*자리|마지막\s*번호|전화\s*번호\s*뒤|핸드폰\s*뒤|폰\s*뒤|전화\s*뒤|뒷\s*자리|뒷\s*번호|뒤\s*번호|끝\s*자리|끝\s*번호|마지막)\s*[:：#]?\s*(.+)$/u;
const PREFIX_REGEX = /^(?:처음\s*자리|앞\s*자리|앞\s*번호|첫\s*자리|첫\s*번호|처음)\s*[:：#]?\s*(.+)$/u;

/**
 * 접두부/접미부 위치 표현 감지
 */
export function detectPositionExpression(text?: string): {
  position: 'prefix' | 'suffix' | 'none';
  keyword?: string;
  cleanTarget: string;
} {
  if (!text) return { position: 'none', cleanTarget: '' };
  const raw = String(text).normalize('NFKC').trim().replace(/^@/, '');

  // 1. 접미부 정규식 검사
  const suffixMatch = raw.match(SUFFIX_REGEX);
  if (suffixMatch && suffixMatch[1]) {
    const target = cleanHonorificsAndGuides(suffixMatch[1]);
    if (target) {
      return { position: 'suffix', cleanTarget: target };
    }
  }

  // 2. 접두부 정규식 검사
  const prefixMatch = raw.match(PREFIX_REGEX);
  if (prefixMatch && prefixMatch[1]) {
    const target = cleanHonorificsAndGuides(prefixMatch[1]);
    if (target) {
      return { position: 'prefix', cleanTarget: target };
    }
  }

  // 3. 띄어쓰기 제거된 문자열에서도 접미부/접두부 시작 확인
  const cleanRaw = raw.replace(/[\s\p{P}\p{S}]+/gu, '');
  for (const kw of SUFFIX_KEYWORDS) {
    const kwClean = kw.replace(/\s+/g, '');
    if (cleanRaw.startsWith(kwClean) && cleanRaw.length > kwClean.length) {
      const target = cleanHonorificsAndGuides(cleanRaw.slice(kwClean.length));
      if (target) {
        return { position: 'suffix', keyword: kw, cleanTarget: target };
      }
    }
  }

  for (const kw of PREFIX_KEYWORDS) {
    const kwClean = kw.replace(/\s+/g, '');
    if (cleanRaw.startsWith(kwClean) && cleanRaw.length > kwClean.length) {
      const target = cleanHonorificsAndGuides(cleanRaw.slice(kwClean.length));
      if (target) {
        return { position: 'prefix', keyword: kw, cleanTarget: target };
      }
    }
  }

  return {
    position: 'none',
    cleanTarget: cleanHonorificsAndGuides(raw)
  };
}

/**
 * 영문 알파벳 철자 한국어 발음 변환 (예: "gieblsmdi" -> "지아이이비엘에스엠디아이")
 */
export function spellEnglishToKorean(text?: string): string {
  if (!text) return '';
  const clean = text.toLowerCase().replace(/[^a-z]/g, '');
  return Array.from(clean)
    .map((ch) => ALPHABET_SPELLED_MAP[ch] || '')
    .join('');
}

/**
 * 한국어 철자 발음 영문 역변환 (예: "지아이이비엘에스엠디아이" -> "gieblsmdi", "에스엠디아이" -> "smdi")
 */
export function parseSpelledKoreanToEnglish(text?: string): string {
  if (!text) return '';
  const clean = text.replace(/[\s\p{P}\p{S}]+/gu, '');
  let remaining = clean;
  let result = '';

  while (remaining.length > 0) {
    let matched = false;
    for (const token of SPELLED_KOREAN_TOKENS) {
      if (remaining.startsWith(token.kor)) {
        result += token.letter;
        remaining = remaining.slice(token.kor.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      break;
    }
  }

  return remaining.length === 0 ? result : '';
}

/**
 * 숫자를 한 자리씩 읽은 한국어 발음 생성 (예: "0517" -> ["공오일칠", "영오일칠", "제로오일칠"])
 */
export function convertDigitsToKoreanPronunciations(digits?: string): string[] {
  if (!digits || !/^\d+$/.test(digits)) return [];
  const chars = Array.from(digits);

  const gongVersion = chars.map((ch) => (ch === '0' ? '공' : DIGIT_PRONUNCIATION_MAP[ch]?.[0] || ch)).join('');
  const youngVersion = chars.map((ch) => (ch === '0' ? '영' : DIGIT_PRONUNCIATION_MAP[ch]?.[0] || ch)).join('');
  const zeroVersion = chars.map((ch) => (ch === '0' ? '제로' : DIGIT_PRONUNCIATION_MAP[ch]?.[0] || ch)).join('');

  const result = new Set<string>();
  result.add(gongVersion);
  result.add(youngVersion);
  result.add(zeroVersion);
  return Array.from(result);
}

/**
 * 한 자리씩 읽은 한국어 숫자 발음을 아라비아 숫자로 변환 (예: "공오일칠" -> "0517", "오일칠" -> "517")
 */
export function parseKoreanDigitsToNumber(text?: string): string | null {
  if (!text) return null;
  const clean = text.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (/^\d+$/.test(clean)) return clean;

  let remaining = clean;
  let digits = '';

  while (remaining.length > 0) {
    let matched = false;
    for (const token of KOREAN_DIGIT_TOKENS) {
      if (remaining.startsWith(token.kor)) {
        digits += token.digit;
        remaining = remaining.slice(token.kor.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (/^\d/.test(remaining)) {
        digits += remaining[0];
        remaining = remaining.slice(1);
        matched = true;
      } else {
        break;
      }
    }
  }

  return remaining.length === 0 && digits.length > 0 ? digits : null;
}

/**
 * 철자 발음(영문/숫자 혼합)과 일반 문자를 종합 파싱
 */
export function parseSpelledKoreanOrAlphanumeric(text?: string): { converted: string; isFullSpelled: boolean } {
  if (!text) return { converted: '', isFullSpelled: false };
  const clean = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!clean) return { converted: '', isFullSpelled: false };

  let remaining = clean;
  let converted = '';
  let fullSpelled = true;

  while (remaining.length > 0) {
    let matched = false;

    // 1. Korean digit tokens 우선 매칭 (예: '공', '영', '제로', '일', '오', '칠' 등 숫자 발음)
    for (const token of KOREAN_DIGIT_TOKENS) {
      if (remaining.startsWith(token.kor)) {
        converted += token.digit;
        remaining = remaining.slice(token.kor.length);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 2. Spelled Korean letter tokens (예: '더블유', '에이치', '에이', '에스', '엠', '지' 등 영문 철자)
    for (const token of SPELLED_KOREAN_TOKENS) {
      if (remaining.startsWith(token.kor)) {
        converted += token.letter;
        remaining = remaining.slice(token.kor.length);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 3. Raw alphanumeric character [a-z0-9]
    if (/^[a-z0-9]/.test(remaining)) {
      converted += remaining[0];
      remaining = remaining.slice(1);
      continue;
    }

    // 4. Other characters
    converted += remaining[0];
    remaining = remaining.slice(1);
    fullSpelled = false;
  }

  return { converted, isFullSpelled: fullSpelled };
}

/**
 * 각 닉네임에 대한 가능한 비교용 별칭 표현 생성
 */
export function generateNicknameAliases(nickname?: string): NicknameAliases {
  const original = String(nickname || '').trim();
  const normalized = normalizeNickname(cleanHonorificsAndGuides(original));
  if (!normalized) {
    return {
      original,
      normalized: '',
      spelledPronunciations: [],
      wordPronunciations: [],
      numericPronunciations: [],
      combinedPronunciations: []
    };
  }

  const match = normalized.match(/^([a-z가-힣_]+)?(\d+)?$/i);
  const letters = (match?.[1] || '').toLowerCase().replace(/[^a-z가-힣]/g, '');
  const digits = match?.[2] || '';

  const spelledPronunciations = new Set<string>();
  const wordPronunciations = new Set<string>();
  const numericPronunciations = new Set<string>();
  const combinedPronunciations = new Set<string>();

  combinedPronunciations.add(normalized);

  // 1. 영문 철자 발음 (순수 문자 및 문자+숫자 복합 발음)
  if (/^[a-z]+$/.test(letters)) {
    const spelledLetters = spellEnglishToKorean(letters);
    if (spelledLetters) {
      spelledPronunciations.add(spelledLetters);
      combinedPronunciations.add(spelledLetters);

      if (digits) {
        spelledPronunciations.add(`${spelledLetters}${digits}`);
        const digitProns = convertDigitsToKoreanPronunciations(digits);
        for (const dp of digitProns) {
          spelledPronunciations.add(`${spelledLetters}${dp}`);
        }
      }
    }
  }

  // 2. 단어식 음역 발음 (순수 문자 및 문자+숫자 복합 발음)
  if (letters) {
    const wordPron = transliterateEnglishToKorean(letters);
    if (wordPron && wordPron !== letters) {
      wordPronunciations.add(wordPron);
      combinedPronunciations.add(wordPron);

      if (digits) {
        wordPronunciations.add(`${wordPron}${digits}`);
        const digitProns = convertDigitsToKoreanPronunciations(digits);
        for (const dp of digitProns) {
          wordPronunciations.add(`${wordPron}${dp}`);
        }
      }
    }
  }

  // 3. 숫자 한 자리씩 발음
  if (digits) {
    numericPronunciations.add(digits);
    const digitProns = convertDigitsToKoreanPronunciations(digits);
    for (const dp of digitProns) {
      numericPronunciations.add(dp);
      combinedPronunciations.add(dp);
    }
  }

  // 4. 결합 발음
  for (const sp of spelledPronunciations) combinedPronunciations.add(sp);
  for (const wp of wordPronunciations) combinedPronunciations.add(wp);

  return {
    original,
    normalized,
    spelledPronunciations: Array.from(spelledPronunciations),
    wordPronunciations: Array.from(wordPronunciations),
    numericPronunciations: Array.from(numericPronunciations),
    combinedPronunciations: Array.from(combinedPronunciations)
  };
}

/**
 * 닉네임 정밀 비교 메인 함수
 * 원본 문자열, 철자 발음, 단어 음역, 접두/접미부, 숫자, 편집거리 등을 종합 평가한다.
 */
export function compareNicknames(left?: string, right?: string): NicknameComparisonResult {
  const rawLeft = String(left || '').trim();
  const rawRight = String(right || '').trim();

  if (!rawLeft || !rawRight) {
    return { isSame: false, isSimilar: false, score: 0, reason: 'NO_MATCH', matchType: 'none' };
  }

  const cleanLeft = normalizeNickname(rawLeft);
  const cleanRight = normalizeNickname(rawRight);

  // 1. 완전 일치 (100점: 정규화한 전체 문자열이 정확히 일치)
  if (cleanLeft === cleanRight) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'EXACT',
      matchType: 'exact',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: '닉네임 문자열 완전 일치'
    };
  }

  // -------------------------------------------------------------
  // 2. 접두부/접미부 위치 표현 감지 검사 (94점)
  // "뒷자리 에스엠디아이", "끝번호 smdi", "앞자리 지아이이", "뒷번호 0517" 등
  // -------------------------------------------------------------
  const posLeft = detectPositionExpression(rawLeft);
  const posRight = detectPositionExpression(rawRight);

  if (posLeft.position !== 'none' || posRight.position !== 'none') {
    const isLeftQuery = posLeft.position !== 'none';
    const posType = isLeftQuery ? posLeft.position : posRight.position;
    const cleanTarget = isLeftQuery ? posLeft.cleanTarget : posRight.cleanTarget;
    const candRaw = isLeftQuery ? rawRight : rawLeft;
    const candNorm = isLeftQuery ? cleanRight : cleanLeft;

    const parsedTarget = parseSpelledKoreanOrAlphanumeric(cleanTarget).converted;
    const targetDigits = parseKoreanDigitsToNumber(cleanTarget);
    const candLetters = candNorm.replace(/[^a-z]/g, '');
    const candSpelled = spellEnglishToKorean(candLetters);

    if (posType === 'suffix') {
      const matchSuffix =
        (parsedTarget && candNorm.endsWith(parsedTarget)) ||
        (cleanTarget && candNorm.endsWith(cleanTarget)) ||
        (targetDigits && candNorm.endsWith(targetDigits)) ||
        (cleanTarget && candSpelled.endsWith(cleanTarget));

      if (matchSuffix) {
        const isPhone4 = /^\d{4}$/.test(targetDigits || '') || /^\d{4}$/.test(parsedTarget || '');
        return {
          isSame: true,
          isSimilar: true,
          score: isPhone4 ? 100 : 94,
          reason: 'SUFFIX_CONFIRMED',
          matchType: 'suffix',
          matchedSuffixDigits: targetDigits || parsedTarget || cleanTarget,
          normalizedLeft: cleanLeft,
          normalizedRight: cleanRight,
          details: `접미부("${cleanTarget}" -> "${parsedTarget || cleanTarget}") 일치로 같은 닉네임 확정`
        };
      }
    } else if (posType === 'prefix') {
      const matchPrefix =
        (parsedTarget && candNorm.startsWith(parsedTarget)) ||
        (cleanTarget && candNorm.startsWith(cleanTarget)) ||
        (targetDigits && candNorm.startsWith(targetDigits)) ||
        (cleanTarget && candSpelled.startsWith(cleanTarget));

      if (matchPrefix) {
        return {
          isSame: true,
          isSimilar: true,
          score: 94,
          reason: 'PREFIX_CONFIRMED',
          matchType: 'prefix',
          normalizedLeft: cleanLeft,
          normalizedRight: cleanRight,
          details: `접두부("${cleanTarget}" -> "${parsedTarget || cleanTarget}") 일치로 같은 닉네임 확정`
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 3. 기존 규칙 3: 전화번호 뒷번호 4자리 식별자 일치 판정 (100점)
  // "뒷번호 0517님" ↔ "mindset0517"
  // -------------------------------------------------------------
  const phoneSuffixLeft = extractPhoneSuffix4Digits(rawLeft);
  const phoneSuffixRight = extractPhoneSuffix4Digits(rawRight);
  const trailing4Left = extractTrailing4Digits(rawLeft);
  const trailing4Right = extractTrailing4Digits(rawRight);

  if (phoneSuffixLeft && trailing4Right && phoneSuffixLeft === trailing4Right) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'SUFFIX_CONFIRMED',
      matchType: 'suffix',
      matchedSuffixDigits: phoneSuffixLeft,
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `뒷번호 호칭(${phoneSuffixLeft})과 식별자(${trailing4Right}) 일치로 같은 닉네임 확정`
    };
  }

  if (phoneSuffixRight && trailing4Left && phoneSuffixRight === trailing4Left) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'SUFFIX_CONFIRMED',
      matchType: 'suffix',
      matchedSuffixDigits: phoneSuffixRight,
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `뒷번호 호칭(${phoneSuffixRight})과 식별자(${trailing4Left}) 일치로 같은 닉네임 확정`
    };
  }

  if (phoneSuffixLeft && phoneSuffixRight && phoneSuffixLeft === phoneSuffixRight) {
    return {
      isSame: true,
      isSimilar: true,
      score: 100,
      reason: 'SUFFIX_CONFIRMED',
      matchType: 'suffix',
      matchedSuffixDigits: phoneSuffixLeft,
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `양측 뒷번호 호칭(${phoneSuffixLeft}) 일치로 같은 닉네임 확정`
    };
  }

  // -------------------------------------------------------------
  // 4. 전체 영문 철자 및 숫자 발음 일치 검사 (98점)
  // "gieblsmdi" ↔ "지아이이비엘에스엠디아이"
  // "gie0517" ↔ "지아이이공오일칠"
  // "mindset0517" ↔ "엠아이엔디에스이티공오일칠"
  // -------------------------------------------------------------
  const aliasesLeft = generateNicknameAliases(rawLeft);
  const aliasesRight = generateNicknameAliases(rawRight);

  const cleanNoHonorificLeft = cleanHonorificsAndGuides(cleanLeft);
  const cleanNoHonorificRight = cleanHonorificsAndGuides(cleanRight);

  // 별칭의 spelledPronunciations 교차 검사
  const matchSpelled =
    aliasesLeft.spelledPronunciations.includes(cleanNoHonorificRight) ||
    aliasesRight.spelledPronunciations.includes(cleanNoHonorificLeft) ||
    aliasesLeft.spelledPronunciations.some((sp) => aliasesRight.spelledPronunciations.includes(sp));

  const spelledParsedLeft = parseSpelledKoreanOrAlphanumeric(cleanNoHonorificLeft);
  const spelledParsedRight = parseSpelledKoreanOrAlphanumeric(cleanNoHonorificRight);

  if (
    matchSpelled ||
    (spelledParsedLeft.isFullSpelled && spelledParsedLeft.converted === aliasesRight.normalized) ||
    (spelledParsedRight.isFullSpelled && spelledParsedRight.converted === aliasesLeft.normalized) ||
    (spelledParsedLeft.isFullSpelled &&
      spelledParsedRight.isFullSpelled &&
      spelledParsedLeft.converted === spelledParsedRight.converted &&
      spelledParsedLeft.converted.length > 0)
  ) {
    return {
      isSame: true,
      isSimilar: true,
      score: 98,
      reason: 'SPELLED_PRONUNCIATION',
      matchType: 'spelled-pronunciation',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `전체 영문/숫자 철자 발음 일치`
    };
  }

  // -------------------------------------------------------------
  // 5. 전체 영단어 음역 발음 일치 검사 (96점)
  // "mindset0517" ↔ "마인드셋"
  // "mindset" ↔ "마인드셋"
  // "pinkstar77" ↔ "핑크스타"
  // -------------------------------------------------------------
  const matchWord =
    aliasesLeft.wordPronunciations.includes(cleanNoHonorificRight) ||
    aliasesRight.wordPronunciations.includes(cleanNoHonorificLeft) ||
    aliasesLeft.wordPronunciations.some((wp) => aliasesRight.wordPronunciations.includes(wp));

  const baseLeft = cleanNoHonorificLeft.replace(/\d+/g, '');
  const baseRight = cleanNoHonorificRight.replace(/\d+/g, '');

  if (baseLeft && baseRight) {
    // A. 숫자 제거 후 기본 문자열 완전 일치 (예: mindset0517 vs mindset)
    if (baseLeft === baseRight) {
      return {
        isSame: true,
        isSimilar: true,
        score: 98,
        reason: 'BASE_EXACT',
        matchType: 'exact',
        normalizedLeft: cleanLeft,
        normalizedRight: cleanRight,
        details: `숫자 제거 후 기본 닉네임 일치 ("${baseLeft}")`
      };
    }

    // B. 한글 발음 변환 (English -> Hangul)
    const phoneticLeft = transliterateEnglishToKorean(baseLeft);
    const phoneticRight = transliterateEnglishToKorean(baseRight);

    if (
      matchWord ||
      (phoneticLeft && phoneticLeft === baseRight) ||
      (phoneticRight && phoneticRight === baseLeft) ||
      (phoneticLeft && phoneticRight && phoneticLeft === phoneticRight && phoneticLeft !== baseLeft)
    ) {
      return {
        isSame: true,
        isSimilar: true,
        score: 96,
        reason: 'PHONETIC_EXACT',
        matchType: 'word-pronunciation',
        normalizedLeft: cleanLeft,
        normalizedRight: cleanRight,
        details: `영문-한글 음역 발음 변환 일치 ("${baseLeft}" ↔ "${baseRight}")`
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
          score: 85,
          reason: 'PHONETIC_SIMILAR',
          matchType: 'fuzzy',
          normalizedLeft: cleanLeft,
          normalizedRight: cleanRight,
          details: `영문-한글 발음 변환 후 유사 ("${phoneticLeft}" ↔ "${phoneticRight}")`
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 6. 숫자 부분 전체 일치 검사 (90점)
  // -------------------------------------------------------------
  const numDigitsLeft = parseKoreanDigitsToNumber(cleanLeft);
  const numDigitsRight = parseKoreanDigitsToNumber(cleanRight);
  if (
    (numDigitsLeft && trailing4Right && numDigitsLeft === trailing4Right) ||
    (numDigitsRight && trailing4Left && numDigitsRight === trailing4Left)
  ) {
    return {
      isSame: true,
      isSimilar: true,
      score: 90,
      reason: 'NUMERIC_MATCH',
      matchType: 'numeric',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `숫자 식별자 일치 (${numDigitsLeft || numDigitsRight})`
    };
  }

  // -------------------------------------------------------------
  // 7. 규칙 1: 편집 거리 <= 1 또는 포함 관계 또는 마지막 글자 반복 (80점대 fuzzy)
  // "코맹" ↔ "코맹맹"
  // -------------------------------------------------------------
  // 1) 마지막 글자가 반복 추가·삭제됨 (예: "코맹" + "맹" = "코맹맹")
  if (checkRepeatedTrailingChars(cleanLeft, cleanRight)) {
    return {
      isSame: false,
      isSimilar: true,
      score: 88,
      reason: 'REPEATED_TRAILING_CHAR',
      matchType: 'fuzzy',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `마지막 글자 반복 추가/삭제 일치 ("${cleanLeft}" ↔ "${cleanRight}")`
    };
  }

  // 2) 한쪽이 다른 쪽에 완전히 포함되고 길이 차이 <= 1
  const inclusionDiff1 =
    (cleanLeft.includes(cleanRight) || cleanRight.includes(cleanLeft)) &&
    Math.abs(cleanLeft.length - cleanRight.length) <= 1;

  if (inclusionDiff1) {
    return {
      isSame: false,
      isSimilar: true,
      score: 88,
      reason: 'INCLUSION_DIFF_1',
      matchType: 'fuzzy',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `상호 포함 및 길이 차이 1 이하 ("${cleanLeft}" ↔ "${cleanRight}")`
    };
  }

  // 3) 편집 거리(Levenshtein distance) <= 1
  const dist = levenshteinDistance(cleanLeft, cleanRight);
  if (dist <= 1) {
    return {
      isSame: false,
      isSimilar: true,
      score: 86,
      reason: 'EDIT_DISTANCE_1',
      matchType: 'fuzzy',
      normalizedLeft: cleanLeft,
      normalizedRight: cleanRight,
      details: `편집 거리 1 이하 ("${cleanLeft}" ↔ "${cleanRight}", distance=${dist})`
    };
  }

  // 4) 일반 유사도 비율 (길이 3 이상에서 72% 이상인 경우)
  const maxLen = Math.max(cleanLeft.length, cleanRight.length);
  if (maxLen >= 3) {
    const ratio = 1 - dist / maxLen;
    if (ratio >= 0.72) {
      return {
        isSame: false,
        isSimilar: true,
        score: Math.round(ratio * 90),
        reason: 'SIMILAR_RATIO',
        matchType: 'fuzzy',
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
    matchType: 'none',
    normalizedLeft: cleanLeft,
    normalizedRight: cleanRight
  };
}

/** 동일 닉네임 확정 여부 (완전 일치, 철자/음역/접두/접미/뒷번호 식별자 확정) */
export function areNicknamesSame(left?: string, right?: string): boolean {
  const result = compareNicknames(left, right);
  return result.isSame;
}

/** 유사 닉네임 여부 (규칙 1, 2, 3 및 퍼지 매칭 포함) */
export function areNicknamesSimilar(left?: string, right?: string): boolean {
  const result = compareNicknames(left, right);
  return result.isSame || result.isSimilar;
}

/**
 * 복수 후보 닉네임 목록 중에서 발화 닉네임과 가장 부합하는 닉네임을 판정
 * - 오탐 방지: 동일한 접두부/접미부를 가진 후보가 복수 존재하면 ambiguous: true 반환 (자동 확정 금지)
 */
export function matchNicknameAgainstCandidates(
  query: string,
  candidateNicknames: string[]
): NicknameMatchResult {
  const rawQuery = String(query || '').trim();
  if (!rawQuery || !candidateNicknames || candidateNicknames.length === 0) {
    return {
      matched: false,
      ambiguous: false,
      score: 0,
      matchType: 'none',
      reason: '후보군 또는 검색어가 비어 있습니다.'
    };
  }

  // 고유 후보군 추출
  const uniqueCandidates = Array.from(
    new Set(candidateNicknames.map((c) => String(c || '').trim()).filter(Boolean))
  );
  if (uniqueCandidates.length === 0) {
    return {
      matched: false,
      ambiguous: false,
      score: 0,
      matchType: 'none',
      reason: '유효한 후보 닉네임이 없습니다.'
    };
  }

  const scoredCandidates = uniqueCandidates.map((candidate) => {
    const comp = compareNicknames(rawQuery, candidate);
    return {
      candidate,
      comp,
      score: comp.score,
      matchType: comp.matchType || 'none',
      isSame: comp.isSame,
      isSimilar: comp.isSimilar
    };
  });

  // 점수 80점 이상의 유효 매칭 필터링
  const validMatches = scoredCandidates.filter((item) => item.score >= 80);
  if (validMatches.length === 0) {
    return {
      matched: false,
      ambiguous: false,
      score: 0,
      matchType: 'none',
      reason: '일치하는 후보를 찾지 못했습니다.'
    };
  }

  // 최고 점수순 정렬
  validMatches.sort((a, b) => b.score - a.score);

  const topScore = validMatches[0].score;
  const topMatches = validMatches.filter((item) => item.score === topScore);

  // Section 8: 오탐 방지 (동일 조건 복수 후보 존재 시 ambiguous)
  if (topMatches.length > 1) {
    const topNames = topMatches.map((m) => m.candidate);
    return {
      matched: false,
      ambiguous: true,
      score: topScore,
      matchType: topMatches[0].matchType,
      candidates: topNames,
      reason: `동일 조건을 만족하는 복수 후보가 존재하여 자동 확정 금지 (${topNames.join(', ')})`
    };
  }

  const best = topMatches[0];
  const isAutoConfirmed = best.score >= 90 && best.isSame;

  return {
    matched: isAutoConfirmed,
    ambiguous: false,
    score: best.score,
    matchType: best.matchType,
    matchedNickname: best.candidate,
    candidates: [best.candidate],
    reason: best.comp.details || `닉네임 일치 (${best.matchType})`
  };
}
