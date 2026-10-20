/** "캡처" and the spellings STT produces for it ("캡쳐", "갭처", "켑처", "캡챠"). */
export const CAPTURE_WORD_SOURCE = '[캡갭켑][처쳐챠]';

/** A spoken capture request ("캡처하세요", "캡처해 주시고요", "캡처해 놓으세요"). Shared by the
 * sale-confirmation and screen-capture patterns so they cannot drift apart. */
export const CAPTURE_REQUEST_SOURCE =
  `${CAPTURE_WORD_SOURCE}\\s*(?:하세요|해\\s*주세요|해\\s*주시고(?:요)?|해\\s*주시구요|해\\s*주십시오|해\\s*줘요|요|부탁(?:드려요|드립니다|해요)|해\\s*줘|해요|할게요|합니다`
  + `|하시고(?:요)?|해\\s*(?:놓으|놓|두)(?:세요|시고(?:요)?|십시오)|해\\s*가세요|찍(?:으세요|어\\s*주세요)`
  + `|(?:해\\s*주시면|하시면|하셔야)\\s*(?:돼요|되요|됩니다|해요))`;

/** Keep STT sentence boundaries without breaking decimal prices or ellipses. */
export function splitTranscriptClauses(text: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    const isDecimalPoint = char === '.' && /\d/u.test(previous) && /^\s*\d/u.test(text.slice(index + 1));
    const isEllipsis = char === '.' && (previous === '.' || next === '.');
    if (!/[!?？。\n]/u.test(char) && (char !== '.' || isDecimalPoint || isEllipsis)) continue;
    const clause = text.slice(start, index + 1).trim();
    if (clause) clauses.push(clause);
    start = index + 1;
  }
  const remaining = text.slice(start).trim();
  if (remaining) clauses.push(remaining);
  return clauses;
}

/** A standalone thank-you adds no sale fact and may sit between its steps.
 * Keep questions, quoted instructions and buyer/product names as boundaries. */
export function isSaleCourtesyUtterance(text: string): boolean {
  return /^(?:(?:네|넵|예|자|아|어|음)[\s,，]+)*(?:감사\s*합니다|감사\s*해요|고맙\s*습니다|고마워요)[.!。…\s]*$/u.test(text.trim());
}

export function isQuestionUtterance(text: string): boolean {
  const clean = text.trim();
  if (/[?？]\s*$/u.test(clean)) return true;
  const ending = clean.replace(/[.!。…\s]+$/u, '')
    .replace(/[,，]?\s*(?:언니들?|여러분)$/u, '').trim();
  return /(?:어때(?:요)?|어떠세요|어떻습니까|인가(?:요)?|건가요|맞나요|맞죠|할까요|드릴까요|바꿀까요|되나요|입니까|일까요)$/u.test(ending);
}

/** A general "하지 마세요" is not a command to change a sale. */
export function isNegatedVoiceAction(text: string): boolean {
  return /(?:변경|수정|정정|삭제)(?:을|를|은|는)?\s*(?:하지\s*(?:마|않)|하면\s*안|마세요|마라)|바꾸(?:지\s*(?:마|않)|면\s*안)/u.test(text);
}

export function isStandaloneBuyerAddress(text: string): boolean {
  return /^(?:네[,，]?\s*)?[가-힣a-zA-Z0-9_]{1,20}\s*(?:언니|님|씨)(?:께|에게|한테)?[.!。\s]*$/u.test(text.trim());
}
