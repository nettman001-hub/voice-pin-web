import {
  ALPHABET_SPELLED_MAP,
  ENGLISH_TO_KOREAN_DICT,
  convertDigitsToKoreanPronunciations,
} from './nicknameMatcher.ts';

/**
 * 라이브 청취 홈 STT 닉네임 힌트.
 * - 구매의사 댓글 작성자를 최신 순으로 먼저, 남는 자리는 최근 댓글 작성자로 채워 최대 50명
 * - 영어가 들어간 닉네임은 원문과 함께 한국어 발음(단어식, 짧으면 알파벳 읽기)도 보낸다
 */

export const LIVE_HINT_NICKNAME_LIMIT = 50;
export const LIVE_HINT_MIN_INTERVAL_MS = 5_000;
const MAX_PRONUNCIATIONS_PER_NICKNAME = 2;
const MAX_TERM_LENGTH = 40;

export interface HintPurchaseRequest {
  sessionId: string;
  nickname: string;
  capturedAt: string;
  withdrawn?: boolean;
}

export function hintNicknameKey(nickname: string): string {
  return stripPictographs(nickname).toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');
}

function stripPictographs(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

/** 이번 방송의 구매의사자(철회 제외)를 최신 순으로. */
export function getPurchaserNicknames(requests: HintPurchaseRequest[], sessionId: string): string[] {
  const latest = new Map<string, { nickname: string; at: number }>();
  for (const request of requests) {
    if (request.sessionId !== sessionId || request.withdrawn) continue;
    const nickname = request.nickname?.trim();
    if (!nickname) continue;
    const key = hintNicknameKey(nickname);
    if (!key) continue;
    const at = Date.parse(request.capturedAt);
    const time = Number.isFinite(at) ? at : 0;
    const previous = latest.get(key);
    if (!previous || time > previous.at) latest.set(key, { nickname, at: time });
  }
  return [...latest.values()].sort((a, b) => b.at - a.at).map((item) => item.nickname);
}

/** 구매의사자 먼저, 그다음 최근 댓글 작성자. 같은 사람은 한 번만. */
export function selectHintNicknames(
  purchaserNicknames: string[],
  recentCommenterNicknames: string[],
  limit = LIVE_HINT_NICKNAME_LIMIT,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const nickname of [...purchaserNicknames, ...recentCommenterNicknames]) {
    if (result.length >= limit) break;
    const key = hintNicknameKey(nickname || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(nickname.trim());
  }
  return result;
}

/** 아직 STT에 보내지 않은 닉네임. 구매의사자면 즉시(두 번째부터는 5초 간격), 평상시에는 5초마다 확인해 보낸다. */
export function findUnsentNicknames(nicknames: string[], sentNicknames: string[]): string[] {
  const sent = new Set(sentNicknames.map(hintNicknameKey));
  return nicknames.slice(0, LIVE_HINT_NICKNAME_LIMIT).filter((nickname) => !sent.has(hintNicknameKey(nickname)));
}

/* ------------------------------------------------------------------ */
/* 영어 닉네임 한국어 발음                                              */
/* ------------------------------------------------------------------ */

const ONSETS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const CODAS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// 로마자 표기(minji, hyeon)와 흔한 영어 철자를 함께 다룬다. 긴 것부터 맞춘다.
const VOWEL_UNITS: Array<[string, string]> = [
  ['yeo', 'ㅕ'], ['yae', 'ㅒ'], ['wae', 'ㅙ'], ['yoo', 'ㅠ'], ['wee', 'ㅟ'], ['woo', 'ㅜ'],
  ['eo', 'ㅓ'], ['eu', 'ㅡ'], ['ae', 'ㅐ'], ['oe', 'ㅚ'], ['ui', 'ㅢ'], ['oo', 'ㅜ'], ['ee', 'ㅣ'], ['ea', 'ㅣ'],
  ['ya', 'ㅑ'], ['yo', 'ㅛ'], ['yu', 'ㅠ'], ['ye', 'ㅖ'], ['yi', 'ㅣ'],
  ['wa', 'ㅘ'], ['wo', 'ㅝ'], ['we', 'ㅞ'], ['wi', 'ㅟ'], ['wu', 'ㅜ'],
  ['a', 'ㅏ'], ['e', 'ㅔ'], ['i', 'ㅣ'], ['o', 'ㅗ'], ['u', 'ㅜ'], ['y', 'ㅣ'],
];

interface ConsonantUnit {
  text: string;
  onset: string;
  /** 받침으로 쓸 때. null이면 받침이 되지 않고 "으" 음절로 읽는다. 'DROP'은 묵음(영어 r). */
  coda: string | null;
  standalone: string;
}

const CONSONANT_UNITS: ConsonantUnit[] = [
  { text: 'ng', onset: 'ㅇ', coda: 'ㅇ', standalone: '응' },
  { text: 'kk', onset: 'ㄲ', coda: 'ㄱ', standalone: '끄' },
  { text: 'tt', onset: 'ㄸ', coda: 'ㅅ', standalone: '뜨' },
  { text: 'pp', onset: 'ㅃ', coda: 'ㅂ', standalone: '쁘' },
  { text: 'ss', onset: 'ㅆ', coda: null, standalone: '쓰' },
  { text: 'jj', onset: 'ㅉ', coda: null, standalone: '찌' },
  { text: 'ch', onset: 'ㅊ', coda: null, standalone: '치' },
  { text: 'sh', onset: 'ㅅ', coda: null, standalone: '시' },
  { text: 'th', onset: 'ㅅ', coda: null, standalone: '스' },
  { text: 'g', onset: 'ㄱ', coda: null, standalone: '그' },
  { text: 'k', onset: 'ㅋ', coda: 'ㄱ', standalone: '크' },
  { text: 'c', onset: 'ㅋ', coda: 'ㄱ', standalone: '크' },
  { text: 'q', onset: 'ㅋ', coda: 'ㄱ', standalone: '크' },
  { text: 'n', onset: 'ㄴ', coda: 'ㄴ', standalone: '느' },
  { text: 'd', onset: 'ㄷ', coda: null, standalone: '드' },
  { text: 'r', onset: 'ㄹ', coda: 'DROP', standalone: '르' },
  { text: 'l', onset: 'ㄹ', coda: 'ㄹ', standalone: '르' },
  { text: 'm', onset: 'ㅁ', coda: 'ㅁ', standalone: '므' },
  { text: 'b', onset: 'ㅂ', coda: null, standalone: '브' },
  { text: 'v', onset: 'ㅂ', coda: null, standalone: '브' },
  { text: 's', onset: 'ㅅ', coda: null, standalone: '스' },
  { text: 'j', onset: 'ㅈ', coda: null, standalone: '지' },
  { text: 'z', onset: 'ㅈ', coda: null, standalone: '즈' },
  { text: 't', onset: 'ㅌ', coda: 'ㅅ', standalone: '트' },
  { text: 'p', onset: 'ㅍ', coda: 'ㅂ', standalone: '프' },
  { text: 'f', onset: 'ㅍ', coda: null, standalone: '프' },
  { text: 'h', onset: 'ㅎ', coda: 'DROP', standalone: '' },
];

// "sh" 뒤 모음은 반모음이 붙은 소리(샤·쇼·슈)로 읽는다.
const SH_GLIDE: Record<string, string> = { 'ㅏ': 'ㅑ', 'ㅗ': 'ㅛ', 'ㅜ': 'ㅠ', 'ㅔ': 'ㅖ', 'ㅓ': 'ㅕ' };

type Unit = { kind: 'V'; vowel: string } | { kind: 'C'; unit: ConsonantUnit };

function tokenizeLatin(word: string): Unit[] {
  const text = word
    .replace(/ck/g, 'k')
    .replace(/ch(?=[rl])/g, 'k')
    .replace(/([bcdfghvz])\1/g, '$1')
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'kw')
    .replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's');
  const units: Unit[] = [];
  let i = 0;
  while (i < text.length) {
    const vowel = VOWEL_UNITS.find(([pattern]) => text.startsWith(pattern, i));
    // y/w 다음에 모음이 없으면 자음 자리의 반모음이 아니라 단독 모음으로 읽는다
    if (vowel && !(vowel[0] === 'y' && i + 1 < text.length && /[aeiou]/.test(text[i + 1]))) {
      units.push({ kind: 'V', vowel: vowel[1] });
      i += vowel[0].length;
      continue;
    }
    const consonant = CONSONANT_UNITS.find((unit) => text.startsWith(unit.text, i));
    if (consonant) {
      units.push({ kind: 'C', unit: consonant });
      i += consonant.text.length;
      continue;
    }
    if (text[i] === 'w') units.push({ kind: 'V', vowel: 'ㅜ' });
    i += 1;
  }
  return units;
}

function compose(onset: string, vowel: string, coda = ''): string {
  return String.fromCharCode(0xac00 + (ONSETS.indexOf(onset) * 21 + VOWELS.indexOf(vowel)) * 28 + CODAS.indexOf(coda));
}

/** 로마자/영어 철자를 한글 음절로 옮긴다(규칙 기반 근사치). */
export function romanizedToHangul(word: string): string {
  const units = tokenizeLatin(word.toLowerCase().replace(/[^a-z]/g, ''));
  const syllables: Array<{ onset: string; vowel: string; coda: string } | string> = [];
  // 직전 음절이 받침을 받을 수 있는지. 'r' 묵음 뒤에는 ㄹ·ㄴ·ㅁ만 받침이 된다(world → 월드, park → 파크).
  let codaMode: 'ANY' | 'SONORANT' | 'NONE' = 'NONE';
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.kind === 'V') {
      syllables.push({ onset: 'ㅇ', vowel: unit.vowel, coda: '' });
      codaMode = 'ANY';
      continue;
    }
    const next = units[i + 1];
    const { onset, coda, standalone, text } = unit.unit;
    if (next?.kind === 'V' && text !== 'ng') {
      const vowel = text === 'sh' ? SH_GLIDE[next.vowel] || next.vowel : next.vowel;
      syllables.push({ onset, vowel, coda: '' });
      i += 1;
      codaMode = 'ANY';
      continue;
    }
    const last = syllables[syllables.length - 1];
    const canTake = typeof last === 'object' && !last.coda && coda !== null && (
      codaMode === 'ANY' || (codaMode === 'SONORANT' && ['ㄹ', 'ㄴ', 'ㅁ'].includes(coda))
    );
    if (canTake && coda === 'DROP') {
      codaMode = 'SONORANT';
      continue;
    }
    if (canTake && typeof last === 'object' && coda) {
      last.coda = coda;
      codaMode = 'NONE';
      continue;
    }
    if (text === 'ng' && next?.kind === 'V') {
      syllables.push({ onset: 'ㄴ', vowel: next.vowel, coda: '' });
      i += 1;
      codaMode = 'ANY';
      continue;
    }
    if (standalone) syllables.push(standalone);
    codaMode = 'NONE';
  }
  return syllables
    .map((item) => (typeof item === 'string' ? item : compose(item.onset, item.vowel, item.coda)))
    .join('');
}

/** 사전 단어로만 나뉘면 사전 발음을 쓴다(lovelymint → 러블리민트). */
function segmentByDictionary(word: string): string | null {
  const best: Array<string | null> = new Array(word.length + 1).fill(null);
  best[0] = '';
  for (let end = 1; end <= word.length; end++) {
    for (let start = Math.max(0, end - 12); start < end; start++) {
      const prefix = best[start];
      const piece = ENGLISH_TO_KOREAN_DICT[word.slice(start, end)];
      if (prefix !== null && piece && end - start >= 2) {
        best[end] = prefix + piece;
        break;
      }
    }
  }
  return best[word.length];
}

function pronounceLatinWord(word: string): string {
  const lower = word.toLowerCase();
  const fromDictionary = segmentByDictionary(lower);
  if (fromDictionary) return fromDictionary;
  // 앞부분만 사전 단어(4글자 이상)면 나머지만 규칙으로 읽는다(lovelyjin → 러블리진)
  for (let length = lower.length - 1; length >= 4; length--) {
    const head = ENGLISH_TO_KOREAN_DICT[lower.slice(0, length)];
    if (head) return head + romanizedToHangul(lower.slice(length));
  }
  return romanizedToHangul(lower);
}

function spellLetters(word: string): string {
  return Array.from(word.toLowerCase()).map((ch) => ALPHABET_SPELLED_MAP[ch] || '').join('');
}

/**
 * 영어가 들어간 닉네임의 한국어 발음 후보. 한글만 있는 닉네임은 빈 배열.
 * 1) 단어식 발음(mint_choco22 → 민트초코이이)
 * 대문자 약어나 모음 없는 영어는 알파벳 읽기(JJ → 제이제이)가 먼저, 아주 짧은 영어(3글자 이하)는 둘 다
 */
export function koreanPronunciationsForNickname(nickname: string): string[] {
  const clean = stripPictographs(nickname);
  if (!/[A-Za-z]/.test(clean)) return [];
  const parts = clean.match(/[A-Za-z]+|\d+|[가-힣]+/g) || [];
  const latinParts = parts.filter((part) => /^[A-Za-z]+$/.test(part));
  const latinLength = latinParts.join('').length;

  const readDigits = (digits: string) => (
    digits.length <= 4 ? convertDigitsToKoreanPronunciations(digits)[0] || digits : digits
  );
  // 대문자 약어(JJ, ABC)나 모음 없는 영어(kbs)는 알파벳을 하나씩 읽는 쪽이 자연스럽다
  const isSpelledPart = (part: string) => (
    (part.length >= 2 && part.length <= 6 && part === part.toUpperCase()) || !/[aeiouy]/i.test(part)
  );
  const read = (spellAll: boolean) => parts.map((part) => {
    if (/^\d+$/.test(part)) return readDigits(part);
    if (!/^[A-Za-z]+$/.test(part)) return part;
    return spellAll || isSpelledPart(part) ? spellLetters(part) : pronounceLatinWord(part);
  }).join('');

  const result: string[] = [];
  const push = (value: string) => {
    const term = value.trim();
    if (!term || [...term].length > MAX_TERM_LENGTH || !/[가-힣]/.test(term) || result.includes(term)) return;
    result.push(term);
  };
  push(read(false));
  if (latinParts.some(isSpelledPart)) {
    // 약어가 섞였으면 단어식 발음도 하나 더 둔다(KIM → 케이아이엠, 킴)
    push(parts.map((part) => (
      /^[A-Za-z]+$/.test(part) ? pronounceLatinWord(part) : /^\d+$/.test(part) ? readDigits(part) : part
    )).join(''));
  } else if (latinLength <= 3) {
    push(read(true));
  }
  return result.slice(0, MAX_PRONUNCIATIONS_PER_NICKNAME);
}

/** 닉네임마다 원문 + 한국어 발음. STT 힌트 단어 목록에 그대로 넣는다. */
export function buildNicknameHintTerms(nicknames: string[]): string[] {
  const terms: string[] = [];
  for (const nickname of nicknames) {
    const clean = stripPictographs(nickname);
    if (/[\p{L}\p{N}]/u.test(clean)) terms.push(clean);
    terms.push(...koreanPronunciationsForNickname(nickname));
  }
  return terms;
}
