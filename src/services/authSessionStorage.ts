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

// 판매 앱(WebView)은 [판매]·[관리] 탭이 서로 다른 WebView라 sessionStorage를 나눠 쓸 수 없다.
// 앱 안에서는 항상 localStorage에 둬서 두 탭이 같은 로그인을 쓴다.
const isSalesApp = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as unknown as { VoiceCapAndroid?: unknown }).VoiceCapAndroid);

// 앱에서 localStorage에 쓰지 못해 이 화면이 sessionStorage에 둔 키(이 화면이 떠 있는 동안만 기억한다).
// 이 표시가 없는 sessionStorage 세션은 예전 버전이 남긴 것이라 읽지 않고 지운다.
const appSessionFallbackKeys = new Set<string>();

export const isKeepLoginEnabled = (): boolean => isSalesApp() || safeGet(getLocal(), KEEP_LOGIN_FLAG_KEY) === '1';

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
 * localStorage에 새 값을 쓴다. 공간이 모자라 실패하면 같은 키의 예전 값을 지우고 한 번 더 쓴다.
 * 그래도 실패하면 예전 값은 지운 채로 둔다. 예전 토큰이 남아 있으면 다음 읽기가 방금 받은 새 토큰 대신
 * 예전 토큰(이미 바뀐 refresh token)을 쓰게 된다.
 */
const writeLocalReplacing = (key: string, value: string): boolean => {
  const local = getLocal();
  if (safeSet(local, key, value)) return true;
  safeRemove(local, key);
  return safeSet(local, key, value);
};

/**
 * 판매 앱: 이 화면만 들고 있던 대체 세션(sessionStorage)을 버린다.
 * 다른 탭(웹뷰)에서 로그아웃했다는 알림을 받았을 때 부른다. 로그아웃은 두 탭 모두에 적용돼야 한다.
 */
export const dropAppSessionFallback = () => {
  for (const key of appSessionFallbackKeys) safeRemove(getSession(), key);
  appSessionFallbackKeys.clear();
};

/**
 * Supabase 클라이언트의 auth.storage로 넘기는 어댑터.
 */
export const authSessionStorage = {
  getItem(key: string): string | null {
    // 앱에서는 localStorage만 본다. 웹뷰마다 따로 남은 예전 sessionStorage 세션은 지운다.
    // (그대로 두면 다른 탭에서 로그아웃한 뒤 이 웹뷰가 예전 계정 세션으로 되돌아갈 수 있다.)
    if (isSalesApp()) {
      const local = safeGet(getLocal(), key);
      if (local !== null || !appSessionFallbackKeys.has(key)) {
        appSessionFallbackKeys.delete(key);
        safeRemove(getSession(), key);
        return local;
      }
      // localStorage 쓰기가 실패해 방금 이 화면이 sessionStorage에 둔 세션은 그대로 쓴다.
      return safeGet(getSession(), key);
    }
    if (isKeepLoginEnabled()) {
      return safeGet(getLocal(), key) ?? safeGet(getSession(), key);
    }
    return safeGet(getSession(), key);
  },
  setItem(key: string, value: string) {
    if (isKeepLoginEnabled() && writeLocalReplacing(key, value)) {
      appSessionFallbackKeys.delete(key);
      safeRemove(getSession(), key);
      return;
    }
    if (safeSet(getSession(), key, value) && isSalesApp()) appSessionFallbackKeys.add(key);
  },
  removeItem(key: string) {
    appSessionFallbackKeys.delete(key);
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
