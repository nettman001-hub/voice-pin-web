/**
 * Supabase 로그인 세션 보관 위치
 *
 * - "자동 로그인"을 켜고 로그인하면 세션을 localStorage에 둔다.
 *   브라우저를 닫았다 열어도, PC를 껐다 켜도 로그인이 유지된다.
 * - 끄고 로그인하면 sessionStorage에 둔다. 새로고침은 유지되고 브라우저를 닫으면 로그아웃된다.
 *
 * Supabase 클라이언트가 이 저장소를 직접 쓰므로 토큰 갱신(회전)도 클라이언트가
 * 탭 간 잠금을 걸고 처리한다. 여러 창이 같은 세션을 써도 오래된 토큰으로 갱신하지 않는다.
 */

export const KEEP_LOGIN_FLAG_KEY = 'voicecap_keep_login';
// 예전 버전이 탭 단위로만 보관하던 refresh token (이전 세션을 한 번 이어받기 위해서만 읽는다)
export const LEGACY_REFRESH_TOKEN_KEY = 'voicecap_session_refresh_token';
// Supabase 클라이언트가 쓰는 키 접두사 (sb-<project>-auth-token, ...-code-verifier)
const SUPABASE_KEY_PREFIX = 'sb-';

type WebStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const getLocal = (): WebStorage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const getSession = (): WebStorage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const safeGet = (storage: WebStorage | null, key: string) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const safeSet = (storage: WebStorage | null, key: string, value: string) => {
  try {
    storage?.setItem(key, value);
    return Boolean(storage);
  } catch {
    return false;
  }
};

const safeRemove = (storage: WebStorage | null, key: string) => {
  try {
    storage?.removeItem(key);
  } catch {
    // 저장소 접근이 차단된 브라우저는 무시한다.
  }
};

const supabaseKeys = (storage: WebStorage | null): string[] => {
  if (!storage) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(SUPABASE_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
};

export const isKeepLoginEnabled = (): boolean => safeGet(getLocal(), KEEP_LOGIN_FLAG_KEY) === '1';

/**
 * 로그인 직전에 호출한다. 이미 있는 세션은 새 위치로 옮긴다.
 */
export const setKeepLogin = (enabled: boolean) => {
  const local = getLocal();
  const session = getSession();
  if (enabled) safeSet(local, KEEP_LOGIN_FLAG_KEY, '1');
  else safeRemove(local, KEEP_LOGIN_FLAG_KEY);

  const from = enabled ? session : local;
  const to = enabled ? local : session;
  for (const key of supabaseKeys(from)) {
    const value = safeGet(from, key);
    if (value !== null && safeSet(to, key, value)) safeRemove(from, key);
  }
};

/**
 * Supabase 클라이언트의 auth.storage로 넘기는 어댑터.
 */
export const authSessionStorage = {
  getItem(key: string): string | null {
    if (isKeepLoginEnabled()) {
      return safeGet(getLocal(), key) ?? safeGet(getSession(), key);
    }
    return safeGet(getSession(), key);
  },
  setItem(key: string, value: string) {
    if (isKeepLoginEnabled() && safeSet(getLocal(), key, value)) {
      safeRemove(getSession(), key);
      return;
    }
    safeSet(getSession(), key, value);
  },
  removeItem(key: string) {
    safeRemove(getLocal(), key);
    safeRemove(getSession(), key);
  },
};

/**
 * 로그아웃 시 두 저장소에 남은 세션을 모두 지운다.
 */
export const clearStoredAuthSession = () => {
  const local = getLocal();
  const session = getSession();
  for (const key of supabaseKeys(local)) safeRemove(local, key);
  for (const key of supabaseKeys(session)) safeRemove(session, key);
  safeRemove(session, LEGACY_REFRESH_TOKEN_KEY);
};

/**
 * 예전 버전이 남긴 refresh token을 꺼내고 지운다 (한 번만 사용).
 */
export const takeLegacyRefreshToken = (): string | null => {
  const session = getSession();
  const token = safeGet(session, LEGACY_REFRESH_TOKEN_KEY);
  if (token) safeRemove(session, LEGACY_REFRESH_TOKEN_KEY);
  return token;
};
