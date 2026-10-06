/** Keep STT sentence boundaries without breaking decimal prices or ellipses. */
export function splitTranscriptClauses(text: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    const isDecimalPoint = char === '.' && /\d/u.test(previous) && /\d/u.test(next);
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
