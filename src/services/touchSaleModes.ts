import type { TouchComment, TouchSalesMode } from '../types/touchSales.ts';
import { isTouchPurchase } from './touchCommentState.ts';

export const TOUCH_SALES_MODES: { value: TouchSalesMode; label: string }[] = [
  { value: 'BASIC', label: '기본' },
  { value: 'NUMBER', label: '상품번호' },
  { value: 'SIZE_COLOR', label: '사이즈·색상' },
];
export const touchModeUsesNumber = (mode?: TouchSalesMode) =>
  mode === 'NUMBER' || mode === 'SIZE_COLOR';
export const touchProductLabel = (n: number) => `${n}번`;
export const touchLabelNumber = (label?: string | null) => {
  const match = /^(\d{1,3})번$/.exec((label || '').trim());
  return match ? Number(match[1]) : null;
};

const valid = (value: string) => {
  const n = Number(value);
  return n >= 1 && n <= 999 ? n : null;
};
/** Rule-based, no AI: "1번", "1번이요", "1주세요", "1", "1요", "1 살께요", "1️⃣". Prices, counts and parts of other numbers are not product numbers. */
export function commentProductNumber(content: string): number | null {
  const text = (content || '').normalize('NFC');
  const withBeon = /(?<![\d.,])(\d{1,3})\s*번(?!\s*째)/.exec(text);
  if (withBeon) return valid(withBeon[1]);
  const keycap = /(?<!\d)(\d)️?⃣/.exec(text);
  if (keycap) return valid(keycap[1]);
  const suffix =
    /(?<![\d.,])(\d{1,3})(?![\d.,])\s*(?:이요|요|주세요|살게요|살께요|할게요|할께요|저요)/.exec(
      text,
    );
  if (suffix) return valid(suffix[1]);
  const alone = /^\s*(\d{1,3})\s*[!~.?ㅎㅋ]*\s*$/.exec(text);
  if (alone && !/^\s*\d+\.\d/.test(text)) return valid(alone[1]);
  return null;
}

export type TouchCommentTone = 'CURRENT' | 'OTHER' | 'INTENT' | null;
export function touchCommentTone(
  comment: Pick<TouchComment, 'content'>,
  mode: TouchSalesMode | undefined,
  current: number,
): { tone: TouchCommentTone; number: number | null } {
  if (!touchModeUsesNumber(mode)) return { tone: null, number: null };
  const purchase = isTouchPurchase(comment);
  if (mode === 'SIZE_COLOR')
    return { tone: purchase ? 'INTENT' : null, number: null };
  const number = commentProductNumber(comment.content);
  if (number === current) return { tone: 'CURRENT', number };
  if (number !== null) return { tone: 'OTHER', number };
  return { tone: purchase ? 'INTENT' : null, number: null };
}

export function nextUnsoldNumber(after: number, sold: ReadonlySet<number>) {
  let next = after + 1;
  while (sold.has(next) && next < 999) next++;
  return next;
}

/** Third slip line: number, plus the customer's comment in the size/color mode. */
export function touchSlipLine(
  mode: TouchSalesMode | undefined,
  number: number,
  content: string,
) {
  if (!touchModeUsesNumber(mode)) return '';
  const label = touchProductLabel(number);
  if (mode !== 'SIZE_COLOR') return label;
  const short = (content || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return short ? `${label} · ${short}` : label;
}
