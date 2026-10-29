/** 댓글 연결 키(Euler) 보관·토큰 발급에 쓰는 순수 함수. 키 원문은 응답에 넣지 않는다. */
export const COMMENT_KEY_NAME = 'euler_comment_key';
export const EULER_API_BASE = 'https://tiktok.eulerstream.com';
/** 판매 한 번(8시간)을 넘기면 폰이 새 토큰을 받아 다시 연결한다. */
export const COMMENT_TOKEN_SECONDS = 8 * 3600;

export type CommentKeyValue = { apiKey?: string; accountId?: string };

/** "@id", 틱톡 주소, 공백을 걷어 낸 틱톡 ID. 영문·숫자·밑줄·점만 남는다. */
export function normalizeTikTokId(input: unknown) {
  if (typeof input !== 'string') return '';
  const id = input
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '')
    .replace(/\/live\/?$/i, '')
    .replace(/^@/, '')
    .trim();
  return /^[A-Za-z0-9_.]{2,24}$/.test(id) ? id : '';
}

export function maskKey(key: unknown) {
  if (typeof key !== 'string' || !key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function cleanAccountId(input: unknown) {
  const value = String(input ?? '').trim();
  return /^\d{1,12}$/.test(value) ? value : '';
}

/** 저장 요청 정리. apiKey가 비어 있으면 기존 키를 그대로 둔다. */
export function mergeCommentKey(
  current: CommentKeyValue,
  body: { apiKey?: unknown; accountId?: unknown; clearKey?: unknown },
): { value: CommentKeyValue; error?: string } {
  const apiKey =
    typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (apiKey && !/^[\x21-\x7e]{16,200}$/.test(apiKey))
    return { value: current, error: '키 형식이 올바르지 않습니다.' };
  const accountRaw = String(body.accountId ?? '').trim();
  const accountId = cleanAccountId(accountRaw);
  if (accountRaw && !accountId)
    return { value: current, error: '계정 번호는 숫자만 입력해 주세요.' };
  const value: CommentKeyValue = {
    apiKey: body.clearKey === true ? undefined : apiKey || current.apiKey,
    accountId: accountId || undefined,
  };
  return { value };
}

export function publicCommentKey(row: {
  value?: CommentKeyValue;
  updated_at?: string;
} | null) {
  const value = row?.value || {};
  return {
    configured: !!value.apiKey,
    maskedKey: maskKey(value.apiKey),
    accountId: value.accountId || '',
    jwtReady: !!value.apiKey && !!value.accountId,
    updatedAt: row?.updated_at || null,
  };
}

export function jwtRequest(
  value: CommentKeyValue,
  uniqueId: string,
  workspaceId: string,
) {
  return {
    url: `${EULER_API_BASE}/accounts/${encodeURIComponent(value.accountId || '')}/jwt/create`,
    init: {
      method: 'POST',
      headers: {
        'x-api-key': value.apiKey || '',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        expireAfter: COMMENT_TOKEN_SECONDS,
        name: `voicecap-${workspaceId.slice(0, 8)}`,
        // 재연결 때 잠깐 겹칠 수 있어 2개까지 허용한다.
        websockets: { allowedCreators: [uniqueId], maxWebSockets: 2 },
      }),
    },
  };
}

/** Euler 응답에서 토큰만 꺼낸다. 실패하면 이유(키 원문 없음)를 돌려준다. */
export function readJwtResponse(status: number, json: any) {
  const token = typeof json?.token === 'string' ? json.token : '';
  if (status >= 200 && status < 300 && token) return { token };
  const message =
    typeof json?.message === 'string' ? json.message.slice(0, 160) : '';
  return { error: `HTTP ${status}${message ? ` · ${message}` : ''}` };
}
