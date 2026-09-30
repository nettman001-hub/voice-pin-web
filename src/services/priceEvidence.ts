/** A quoted, reproducible price from the seller's actual utterance. */
export interface SpeechPriceEvidence {
  quote: string;
  amount: number;
  notation: 'DECIMAL_MAN' | 'EXPLICIT_WON' | 'EXPLICIT_MAN';
}

const KOREAN_DIGITS: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5,
  육: 6, 칠: 7, 팔: 8, 구: 9,
};

export function extractSpeechPrice(text: string): SpeechPriceEvidence | null {
  const found: Array<SpeechPriceEvidence & { offset: number }> = [];
  const add = (quote: string, amount: number, notation: SpeechPriceEvidence['notation'], offset: number) => {
    if (Number.isSafeInteger(amount) && amount > 0 && amount <= 99_999_999) {
      found.push({ quote, amount, notation, offset });
    }
  };

  for (const match of text.matchAll(/(?<![\d.])(\d{1,3})\s*(?:\.|점)\s*(\d{1,2})(?![\d.])/gu)) {
    const offset = match.index;
    const after = text.slice(offset + match[0].length);
    const before = text.slice(Math.max(0, offset - 10), offset);
    if (/^\s*(?:월|일|시|분|초|미터|센티|cm|개|번|사이즈|버전)/iu.test(after)
      || /(?:번호|뒷자리|사이즈|길이|높이|폭)\s*$/u.test(before)) continue;
    const [whole, fraction] = [match[1], match[2]];
    const amount = Number(whole) * 10_000 + Number(fraction) * (fraction.length === 1 ? 1000 : 100);
    add(match[0], amount, 'DECIMAL_MAN', offset);
  }
  for (const match of text.matchAll(/([영공일이삼사오육칠팔구])\s*점\s*([영공일이삼사오육칠팔구])/gu)) {
    const amount = KOREAN_DIGITS[match[1]] * 10_000 + KOREAN_DIGITS[match[2]] * 1000;
    add(match[0], amount, 'DECIMAL_MAN', match.index);
  }
  for (const match of text.matchAll(/(\d{1,2})\s*만\s*(?:(\d{1,2})\s*천)?\s*원?/gu)) {
    if (found.some((item) => item.notation === 'DECIMAL_MAN'
      && match.index > item.offset && match.index < item.offset + item.quote.length)) continue;
    const amount = Number(match[1]) * 10_000 + Number(match[2] || 0) * 1000;
    add(match[0].trim(), amount, 'EXPLICIT_MAN', match.index);
  }
  for (const match of text.matchAll(/(\d[\d,]{2,8})\s*원/gu)) {
    add(match[0], Number(match[1].replace(/,/g, '')), 'EXPLICIT_WON', match.index);
  }
  for (const match of text.matchAll(/([일이삼사오육칠팔구]?만)?\s*([일이삼사오육칠팔구]?천)?\s*([일이삼사오육칠팔구]?백)?\s*원/gu)) {
    if (!match[1] && !match[2] && !match[3]) continue;
    const before = text.slice(Math.max(0, match.index - 10), match.index);
    if (/(?:\d+\s*(?:\.|점)\s*\d+|[영공일이삼사오육칠팔구]\s*점\s*[영공일이삼사오육칠팔구])\s*$/u.test(before)) continue;
    const value = (part: string | undefined, unit: string, scale: number) => {
      if (!part) return 0;
      const digit = part.replace(unit, '');
      return (digit ? KOREAN_DIGITS[digit] : 1) * scale;
    };
    add(match[0].trim(), value(match[1], '만', 10_000) + value(match[2], '천', 1000)
      + value(match[3], '백', 100), 'EXPLICIT_WON', match.index);
  }
  if (!found.length) return null;
  const last = found.sort((a, b) => a.offset - b.offset).at(-1)!;
  return { quote: last.quote, amount: last.amount, notation: last.notation };
}
