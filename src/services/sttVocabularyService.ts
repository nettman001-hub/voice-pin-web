export const MAX_STT_VOCABULARY_WORDS = 50;
export const MAX_STT_VOCABULARY_WORD_LENGTH = 40;
export const MAX_CLOUD_STT_TERMS = 100;
export const MAX_RECENT_COMMENT_NICKNAMES = 25;

interface CommentNicknameSource {
  nickname?: unknown;
  nicknameSnapshot?: unknown;
  capturedAt?: unknown;
  ingestSequence?: unknown;
}

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

/** Latest distinct commenters, ordered newest first, for the next cloud STT connection. */
export function getRecentCommentNicknames(
  input: unknown,
  limit = MAX_RECENT_COMMENT_NICKNAMES,
): string[] {
  if (!Array.isArray(input)) return [];
  const safeLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(MAX_RECENT_COMMENT_NICKNAMES, Math.floor(limit)))
    : MAX_RECENT_COMMENT_NICKNAMES;
  if (safeLimit === 0) return [];

  const sorted = input
    .map((value, index) => ({ value: value as CommentNicknameSource, index }))
    .filter(({ value }) => value && typeof value === 'object')
    .sort((left, right) => {
      const leftTime = Date.parse(typeof left.value.capturedAt === 'string' ? left.value.capturedAt : '');
      const rightTime = Date.parse(typeof right.value.capturedAt === 'string' ? right.value.capturedAt : '');
      const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
      const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : 0;
      if (normalizedLeftTime !== normalizedRightTime) return normalizedRightTime - normalizedLeftTime;

      const leftSequence = Number(left.value.ingestSequence);
      const rightSequence = Number(right.value.ingestSequence);
      const normalizedLeftSequence = Number.isFinite(leftSequence) ? leftSequence : 0;
      const normalizedRightSequence = Number.isFinite(rightSequence) ? rightSequence : 0;
      if (normalizedLeftSequence !== normalizedRightSequence) return normalizedRightSequence - normalizedLeftSequence;
      return right.index - left.index;
    })
    .map(({ value }) => (
      typeof value.nicknameSnapshot === 'string' ? value.nicknameSnapshot : value.nickname
    ));

  return collectTerms(sorted, safeLimit);
}

/** Seller words take priority, then recent nicknames, then recognition-rule words. */
export function buildCloudSttTerms(
  presetWords: unknown,
  recentNicknames: unknown = [],
  ruleWords: unknown = [],
): string[] {
  return collectTerms([
    ...normalizeSttVocabulary(presetWords),
    ...(Array.isArray(recentNicknames) ? recentNicknames : []),
    ...(Array.isArray(ruleWords) ? ruleWords : []),
  ], MAX_CLOUD_STT_TERMS);
}
