/**
 * VoiceCAP 자동 로그인 자격 증명 관리 서비스
 *
 * 사용자가 "자동 로그인"을 체크하고 로그인하면 계정 정보(이메일, 비밀번호)를
 * 브라우저의 localStorage에 안전하게 보관하여,
 * 다음 로그인 시 폼에 미리 채워져 사용자가 로그인 버튼만 누를 수 있게 지원합니다.
 */

const STORAGE_KEY = 'voicecap_saved_login_credentials';

export interface SavedLoginCredentials {
  email: string;
  password: string;
  autoLogin: boolean;
  savedAt: string;
}

/**
 * 평문 노출 방지를 위해 데이터를 안전하게 인코딩합니다.
 */
function encodeCredentials(raw: string): string {
  try {
    return btoa(encodeURIComponent(raw));
  } catch {
    return raw;
  }
}

/**
 * 인코딩된 데이터를 디코딩합니다.
 */
function decodeCredentials(encoded: string): string {
  try {
    return decodeURIComponent(atob(encoded));
  } catch {
    return encoded;
  }
}

/**
 * 자동 로그인용 계정 정보를 저장합니다.
 */
export function saveAutoLoginCredentials(email: string, password: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const payload: SavedLoginCredentials = {
      email: email.trim(),
      password,
      autoLogin: true,
      savedAt: new Date().toISOString()
    };
    const serialized = JSON.stringify(payload);
    const encoded = encodeCredentials(serialized);
    window.localStorage.setItem(STORAGE_KEY, encoded);
  } catch (error) {
    console.error('[AuthCredentials] 계정 정보 저장 실패:', error);
  }
}

/**
 * 저장된 자동 로그인 계정 정보를 불러옵니다.
 */
export function getAutoLoginCredentials(): SavedLoginCredentials | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let jsonStr: string;
    try {
      jsonStr = decodeCredentials(raw);
    } catch {
      jsonStr = raw;
    }

    const parsed = JSON.parse(jsonStr) as SavedLoginCredentials;
    if (parsed && typeof parsed.email === 'string' && typeof parsed.password === 'string' && parsed.autoLogin) {
      return {
        email: parsed.email,
        password: parsed.password,
        autoLogin: Boolean(parsed.autoLogin),
        savedAt: parsed.savedAt || ''
      };
    }
    return null;
  } catch (error) {
    console.warn('[AuthCredentials] 저장된 계정 정보 파싱 실패:', error);
    return null;
  }
}

/**
 * 저장된 자동 로그인 계정 정보를 삭제합니다.
 */
export function clearAutoLoginCredentials(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[AuthCredentials] 계정 정보 삭제 실패:', error);
  }
}

/**
 * 자동 로그인 계정 정보가 존재하는지 여부를 반환합니다.
 */
export function hasAutoLoginCredentials(): boolean {
  return getAutoLoginCredentials() !== null;
}
