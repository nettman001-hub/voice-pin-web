/**
 * 고객 문자 본문 ↔ 판매내역 구매자 닉네임 연결 규칙.
 *
 * - EXACT: 본문에 닉네임이 그대로 들어 있음 (대소문자 무시)
 * - SPACING: 띄어쓰기·문장부호만 다름 ("꽃 심이" ↔ "꽃심이")
 * - INTRO: 1~2글자 닉네임이 자기소개 맥락으로 쓰임 ("닉네임 하늘이에요", "안녕하세요 하늘입니다") → 확정
 * - SHORT: 1~2글자 닉네임이 한 단어로 따로 쓰였지만 맥락은 불분명 ("하늘 입금했어요") → "닉네임 확인필요"
 * - SIMILAR: 자모 1~2개 차이 정도로 비슷함 ("꼿심이" ↔ "꽃심이") → "닉네임 확인필요"
 *
 * EXACT/SPACING(3글자 이상)과 INTRO 는 확정 연결로 보고 전화번호에 저장할 수 있으며,
 * SHORT/SIMILAR 는 화면에만 연결해 보여 주고 판매자 확인 전에는 저장하지 않는다.
 * 짧은 닉네임은 "하늘색", "예쁨 받았어요"처럼 다른 고객의 평범한 문장에도 들어가기 때문이다.
 */

export type SmsNicknameMatchKind = 'EXACT' | 'SPACING' | 'INTRO' | 'SHORT' | 'SIMILAR';

/** 판매자 확인 전까지 "닉네임 확인필요"로 보여 줄 연결인지 */
export const needsNicknameConfirmation = (match: SmsNicknameMatch | null | undefined): boolean =>
  match?.kind === 'SHORT' || match?.kind === 'SIMILAR';

/** 확정 연결로 볼 최소 길이 (공백 제외) */
const MIN_CONFIRMED_CHARS = 3;

/** 짧은 닉네임 뒤에 붙어도 한 단어로 보는 호칭·어미 */
const SHORT_NICK_SUFFIX = /^(?:님|씨|이|이에요|예요|에요|입니다|이요|요|이고|고|인데요|인데|이구요|구요|이름|이름은|이름이)?$/u;

function wordsOf(body: string): string[] {
  return String(body)
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 닉네임 바로 뒤가 낱말의 끝인지 (호칭·어미는 허용) */
const NICK_END = '(?=$|[\\s\\p{P}\\p{S}]|님|씨|입니다|이에요|예요|에요|이요|요|임|이고|인데)';
const INTRO_ENDING = '\\s*(?:님|씨)?\\s*(?:입니다|이에요|예요|에요|이요|임니다|임|이구요|이고요|인데요)';

/**
 * 짧은 닉네임이 자기소개 맥락에 쓰였는지.
 * "닉네임 하늘이에요", "닉 하늘", "틱톡 하늘", "안녕하세요 하늘입니다", "저는 하늘이에요",
 * 문자 맨 앞의 "하늘입니다", 또는 문자 전체가 "하늘(님)" 뿐인 경우.
 */
function hasIntroductionContext(body: string, compactNick: string): boolean {
  const text = String(body).normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
  const nick = Array.from(compactNick).map(escapeRegExp).join('\\s*');
  const patterns = [
    `(?:닉네임|닉넴|닉|아이디|틱톡|이름)\\s*(?:은|는|이|:|=|-)?\\s*["'“‘]?${nick}${NICK_END}`,
    `(?:안녕하세요|안녕하세용|안녕하십니까|안녕하신가요)[\\s\\p{P}~]*(?:저는|전|저)?\\s*${nick}${NICK_END}`,
    `(?:^|[\\s\\p{P}])(?:저는|전|저)\\s*${nick}${INTRO_ENDING}`,
    `^${nick}${INTRO_ENDING}`,
    `^${nick}\\s*(?:님|씨)?[\\s\\p{P}~]*$`,
  ];
  return patterns.some((pattern) => new RegExp(pattern, 'u').test(text));
}

/** 1~2글자 닉네임이 다른 낱말의 일부가 아니라 한 단어로 따로 쓰였는지 */
function hasStandaloneShortNick(words: readonly string[], compactNick: string): boolean {
  return words.some((word) => word.startsWith(compactNick) && SHORT_NICK_SUFFIX.test(word.slice(compactNick.length)));
}

export interface SmsNicknameMatch {
  nickname: string;
  kind: SmsNicknameMatchKind;
}

interface MessageLike {
  direction?: string;
  body?: string | null;
}

/** 공백·문장부호·기호를 지우고 소문자로 맞춘 비교용 문자열 */
export function compactText(value?: string | null): string {
  if (!value) return '';
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNGSEONG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONGSEONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 한글 음절을 자모로 풀어 오타 한 글자(받침 하나 등)를 작은 차이로 본다 */
function toJamo(value: string): string[] {
  const out: string[] = [];
  for (const ch of value) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      out.push(CHOSEONG[Math.floor(code / 588)], JUNGSEONG[Math.floor((code % 588) / 28)]);
      const jong = JONGSEONG[code % 28];
      if (jong) out.push(jong);
    } else {
      out.push(ch);
    }
  }
  return out;
}

function editDistance(left: string[], right: string[]): number {
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (left[i - 1] === right[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[right.length];
}

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** 짧은 닉네임은 오탐이 많아 비슷함 판정에서 뺀다 (3글자 미만 또는 자모 5개 미만, 예: "하늘", "abcd") */
const MIN_SIMILAR_CHARS = 3;
const MIN_SIMILAR_JAMO = 5;

function similarThreshold(jamoLength: number): number {
  return jamoLength >= 12 ? 2 : 1;
}

/**
 * 본문 안에서 닉네임과 비슷한 부분을 찾는다.
 * 조사·어미는 뒤에 붙으므로 각 단어(와 이어진 두 단어)의 앞부분을 닉네임 길이 ±1 로 잘라 비교한다.
 */
function bestSimilarDistance(body: string, nickname: string): number | null {
  const target = compactText(nickname);
  const targetJamo = toJamo(target);
  if (Array.from(target).length < MIN_SIMILAR_CHARS || targetJamo.length < MIN_SIMILAR_JAMO) return null;
  const threshold = similarThreshold(targetJamo.length);
  const targetDigits = digitsOf(target);
  const targetChars = Array.from(target);

  const words = wordsOf(body);
  const candidates = new Set<string>(words);
  for (let i = 0; i + 1 < words.length; i += 1) candidates.add(words[i] + words[i + 1]);

  let best: number | null = null;
  for (const candidate of candidates) {
    const chars = Array.from(candidate);
    for (let len = targetChars.length - 1; len <= targetChars.length + 1; len += 1) {
      if (len < 2 || len > chars.length) continue;
      const window = chars.slice(0, len).join('');
      if (digitsOf(window) !== targetDigits) continue;
      const distance = editDistance(toJamo(window), targetJamo);
      if (distance <= threshold && (best === null || distance < best)) best = distance;
    }
  }
  return best;
}

/** 문자 한 통의 본문에서 구매자 닉네임을 찾는다. 확실한 일치를 비슷함보다 먼저 본다. */
export function findNicknameInText(body: string | null | undefined, nicknames: readonly string[]): SmsNicknameMatch | null {
  if (!body) return null;
  const sorted = Array.from(new Set(nicknames.map((n) => String(n || '').trim()).filter(Boolean)))
    .sort((a, b) => compactText(b).length - compactText(a).length);

  const longNicks = sorted.filter((n) => Array.from(compactText(n)).length >= MIN_CONFIRMED_CHARS);
  const shortNicks = sorted.filter((n) => {
    const length = Array.from(compactText(n)).length;
    return length > 0 && length < MIN_CONFIRMED_CHARS;
  });

  const lowerBody = body.toLocaleLowerCase('ko-KR');
  for (const nickname of longNicks) {
    if (lowerBody.includes(nickname.toLocaleLowerCase('ko-KR'))) {
      return { nickname, kind: 'EXACT' };
    }
  }

  const compactBody = compactText(body);
  for (const nickname of longNicks) {
    if (compactBody.includes(compactText(nickname))) {
      return { nickname, kind: 'SPACING' };
    }
  }

  for (const nickname of shortNicks) {
    if (hasIntroductionContext(body, compactText(nickname))) {
      return { nickname, kind: 'INTRO' };
    }
  }

  const words = wordsOf(body);
  for (const nickname of shortNicks) {
    if (hasStandaloneShortNick(words, compactText(nickname))) {
      return { nickname, kind: 'SHORT' };
    }
  }

  let best: { nickname: string; distance: number } | null = null;
  let ambiguous = false;
  for (const nickname of sorted) {
    const distance = bestSimilarDistance(body, nickname);
    if (distance === null) continue;
    if (!best || distance < best.distance) {
      best = { nickname, distance };
      ambiguous = false;
    } else if (distance === best.distance && compactText(nickname) !== compactText(best.nickname)) {
      ambiguous = true;
    }
  }
  if (best && !ambiguous) return { nickname: best.nickname, kind: 'SIMILAR' };
  return null;
}

/** 한 번호의 받은 문자들 중 가장 확실한 닉네임 연결 하나를 고른다. */
export function findNicknameInMessages(messages: readonly MessageLike[], nicknames: readonly string[]): SmsNicknameMatch | null {
  let similar: SmsNicknameMatch | null = null;
  for (const message of messages) {
    if (message.direction !== 'INCOMING' || !message.body) continue;
    const match = findNicknameInText(message.body, nicknames);
    if (!match) continue;
    if (!needsNicknameConfirmation(match)) return match;
    if (!similar) similar = match;
  }
  return similar;
}

/** 받은 문자 본문에 이 닉네임이 (띄어쓰기 무시하고, 짧은 닉네임은 한 단어로) 들어 있는지 */
export function messageMentionsNickname(body: string | null | undefined, nickname: string): boolean {
  const compactNick = compactText(nickname);
  if (!body || !compactNick) return false;
  if (Array.from(compactNick).length < MIN_CONFIRMED_CHARS) return hasStandaloneShortNick(wordsOf(body), compactNick);
  return compactText(body).includes(compactNick);
}
