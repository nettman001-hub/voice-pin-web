const blockedCodes = new Set([
  'COMMENT_ALREADY_COMMITTED',
  'SESSION_ENDED',
  'TOUCH_NOT_RUNNING',
  'VALIDATION_ERROR',
  'OPERATION_PAYLOAD_MISMATCH',
  'CLOCK_INVALID',
  'COMMENT_IDENTITY_CONFLICT',
]);

export interface TouchSaveFailure {
  code?: string;
  detail?: string;
  blocked: boolean;
  kind: 'BLOCKED' | 'AUTH' | 'SERVER' | 'NETWORK' | 'UNKNOWN';
  message: string;
}

/** A rejected save is not necessarily offline. Keep retry policy separate from its explanation. */
export function classifyTouchSaveFailure(error: unknown): TouchSaveFailure {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown; name?: unknown }
    : {};
  const code = typeof value.code === 'string' ? value.code : undefined;
  const detail = typeof value.message === 'string' ? value.message : undefined;
  const base = { code, detail, blocked: blockedCodes.has(code || '') };
  if (base.blocked)
    return { ...base, kind: 'BLOCKED', message: detail || '판매내역에서 저장 요청을 확인해 주세요.' };
  if (['AUTH_REQUIRED', 'UNAUTHORIZED', 'JWT_EXPIRED'].includes(code || ''))
    return {
      ...base, kind: 'AUTH',
      message: '로그인 상태를 확인하지 못해 판매 저장이 대기 중입니다. 다시 로그인한 뒤 판매내역을 확인해 주세요.',
    };
  if (['CAPABILITY_DENIED', 'FORBIDDEN'].includes(code || ''))
    return {
      ...base, kind: 'AUTH',
      message: '판매 저장 권한을 확인하지 못했습니다. 계정 권한과 판매내역의 보내는 중 항목을 확인해 주세요.',
    };
  if (['DATABASE_ERROR', 'SERVER_ERROR', 'INTERNAL_ERROR'].includes(code || ''))
    return {
      ...base, kind: 'SERVER',
      message: '서버 오류로 판매 저장을 확인하지 못했습니다. 자동으로 다시 시도합니다. 판매내역의 보내는 중 항목을 확인해 주세요.',
    };
  if (code === 'NETWORK_ERROR' || (!code && (
    value.name === 'FunctionsFetchError' ||
    /failed to fetch|network(?:error| error| timeout)|load failed|failed to send a request to the edge function/i.test(detail || '')
  )))
    return {
      ...base, kind: 'NETWORK',
      message: '연결 문제로 판매 저장이 대기 중입니다. 연결이 복구되면 자동으로 다시 보냅니다. 판매내역을 확인해 주세요.',
    };
  return {
    ...base, kind: 'UNKNOWN',
    message: '판매 저장을 확인하지 못했습니다. 자동으로 다시 시도합니다. 판매내역의 보내는 중 항목을 확인해 주세요.',
  };
}
