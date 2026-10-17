const CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const SOUND_CLASSES = ['ㅏㅑㅘ', 'ㅓㅕㅝ', 'ㅗㅛ', 'ㅜㅠ', 'ㅐㅔㅒㅖㅙㅚㅞ', 'ㅡㅢㅣㅟ',
  'ㄱㄲㅋ', 'ㄷㄸㅌ', 'ㅂㅃㅍ', 'ㅅㅆ', 'ㅈㅉㅊ', 'ㅇㅎ', 'ㄴㅁ', 'ㄴㄹ'];
const indelCost = (ch: string) => ch === 'ㅇ' || ch === 'ㅎ' ? 0.5 : 1;

export function toJamo(text: string): string[] {
  const out: string[] = [];
  for (const ch of text.normalize('NFKC')) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      out.push(CHO[Math.floor(code / 588)], JUNG[Math.floor(code % 588 / 28)]);
      if (JONG[code % 28]) out.push(JONG[code % 28]);
    } else out.push(ch);
  }
  return out;
}

/** Weighted jamo distance tolerates missing codas and similar STT spellings. */
export function soundDistance(a: string[], b: string[]): number {
  let prev = [0];
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + indelCost(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    const cur = [prev[0] + indelCost(a[i - 1])];
    for (let j = 1; j <= b.length; j++) {
      const x = a[i - 1], y = b[j - 1];
      const cost = x === y ? 0 : SOUND_CLASSES.some((group) => group.includes(x) && group.includes(y)) ? 0.3 : 1;
      cur[j] = Math.min(prev[j] + indelCost(x), cur[j - 1] + indelCost(y), prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function hangulSoundScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = toJamo(a), right = toJamo(b);
  return Math.round(Math.max(0, 1 - soundDistance(left, right) / Math.max(left.length, right.length)) * 100);
}
