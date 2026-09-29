export const MAX_STT_VOCABULARY_WORDS = 50;
export const MAX_STT_VOCABULARY_WORD_LENGTH = 40;
export const MAX_CLOUD_STT_TERMS = 100;

/** User-entered pronunciation hints, not model-training data. */
function collectTerms(input: unknown, limit: number): string[] {
  if (!Array.isArray(input)) return [];
  const words: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(/[,\r\n]+/u)) {
      const word = part.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().replace(/\s+/gu, ' ');
      if (!word || [...word].length > MAX_STT_VOCABULARY_WORD_LENGTH) continue;
      const key = word.toLocaleLowerCase('ko-KR');
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
      if (words.length === limit) return words;
    }
  }
  return words;
}

export function normalizeSttVocabulary(input: unknown): string[] {
  return collectTerms(input, MAX_STT_VOCABULARY_WORDS);
}

/** Preset words take priority; existing recognition-rule words fill remaining slots. */
export function buildCloudSttTerms(presetWords: unknown, ruleWords: unknown): string[] {
  return collectTerms([
    ...normalizeSttVocabulary(presetWords),
    ...(Array.isArray(ruleWords) ? ruleWords : []),
  ], MAX_CLOUD_STT_TERMS);
}
