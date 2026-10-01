export const STT_ROTATION_POLICY = {
  EMPTY_TO_ACTIVE_MS: 10_000,
  MANY_NEW_NICKNAMES_MS: 30_000,
  ANY_NICKNAME_CHANGE_MS: 60_000,
  MANY_NEW_NICKNAMES_COUNT: 5,
  PROVIDER_LIMIT_REFRESH_MS: 4 * 60 * 60 * 1000 + 50 * 60 * 1000,
  CHECK_INTERVAL_MS: 2_000,
} as const;

export type SttRotationReason =
  | 'INITIAL_NICKNAMES'
  | 'MANY_NEW_NICKNAMES'
  | 'NICKNAME_SET_CHANGED'
  | 'PROVIDER_DURATION_LIMIT';

export interface SttRotationDecision {
  shouldRotate: boolean;
  reason?: SttRotationReason;
  addedNicknameCount: number;
}

function nicknameKey(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR');
}

function nicknameSet(values: string[]): Set<string> {
  return new Set(values.map(nicknameKey).filter(Boolean));
}

export function decideSttSessionRotation(
  sentNicknames: string[],
  currentNicknames: string[],
  elapsedSinceSuccessfulConnectionMs: number,
): SttRotationDecision {
  const sent = nicknameSet(sentNicknames);
  const current = nicknameSet(currentNicknames);
  const addedNicknameCount = [...current].filter((nickname) => !sent.has(nickname)).length;
  const sameSet = sent.size === current.size && [...sent].every((nickname) => current.has(nickname));

  if (elapsedSinceSuccessfulConnectionMs >= STT_ROTATION_POLICY.PROVIDER_LIMIT_REFRESH_MS) {
    return { shouldRotate: true, reason: 'PROVIDER_DURATION_LIMIT', addedNicknameCount };
  }
  if (sameSet) return { shouldRotate: false, addedNicknameCount };
  if (
    sent.size === 0 &&
    current.size > 0 &&
    elapsedSinceSuccessfulConnectionMs >= STT_ROTATION_POLICY.EMPTY_TO_ACTIVE_MS
  ) {
    return { shouldRotate: true, reason: 'INITIAL_NICKNAMES', addedNicknameCount };
  }
  if (
    addedNicknameCount >= STT_ROTATION_POLICY.MANY_NEW_NICKNAMES_COUNT &&
    elapsedSinceSuccessfulConnectionMs >= STT_ROTATION_POLICY.MANY_NEW_NICKNAMES_MS
  ) {
    return { shouldRotate: true, reason: 'MANY_NEW_NICKNAMES', addedNicknameCount };
  }
  if (elapsedSinceSuccessfulConnectionMs >= STT_ROTATION_POLICY.ANY_NICKNAME_CHANGE_MS) {
    return { shouldRotate: true, reason: 'NICKNAME_SET_CHANGED', addedNicknameCount };
  }
  return { shouldRotate: false, addedNicknameCount };
}
