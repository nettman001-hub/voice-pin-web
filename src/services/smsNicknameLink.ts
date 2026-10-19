/**
 * 고객 문자 본문 ↔ 판매내역 구매자 닉네임 연결 규칙.
 *
 * - EXACT: 본문에 닉네임이 그대로 들어 있음 (대소문자 무시)
 * - SPACING: 띄어쓰기·문장부호만 다름 ("꽃 심이" ↔ "꽃심이")
 * - SIMILAR: 자모 1~2개 차이 정도로 비슷함 ("꼿심이" ↔ "꽃심이") → "닉네임 확인필요"
 *
 * EXACT/SPACING 은 확정 연결로 보고 전화번호에 저장할 수 있으며,
 * SIMILAR 는 화면에만 연결해 보여 주고 판매자 확인 전에는 저장하지 않는다.
 */

export type SmsNicknameMatchKind = 'EXACT' | 'SPACING' | 'SIMILAR';

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

  const words = String(body)
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);
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

  const lowerBody = body.toLocaleLowerCase('ko-KR');
  for (const nickname of sorted) {
    if (nickname.length >= 2 && lowerBody.includes(nickname.toLocaleLowerCase('ko-KR'))) {
      return { nickname, kind: 'EXACT' };
    }
  }

  const compactBody = compactText(body);
  for (const nickname of sorted) {
    const compactNick = compactText(nickname);
    if (compactNick.length >= 2 && compactBody.includes(compactNick)) {
      return { nickname, kind: 'SPACING' };
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
    if (match.kind !== 'SIMILAR') return match;
    if (!similar) similar = match;
  }
  return similar;
}

/** 받은 문자 본문에 이 닉네임이 (띄어쓰기 무시하고) 들어 있는지 */
export function messageMentionsNickname(body: string | null | undefined, nickname: string): boolean {
  const compactNick = compactText(nickname);
  if (!body || compactNick.length < 2) return false;
  return compactText(body).includes(compactNick);
}
