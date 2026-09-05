import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && publishableKey);

const REFRESH_TOKEN_SESSION_KEY = 'voicecap_session_refresh_token';

const readRefreshToken = () => {
  try {
    return window.sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY);
  } catch {
    return null;
  }
};

export const rememberSessionRefreshToken = (refreshToken?: string | null) => {
  try {
    if (refreshToken) window.sessionStorage.setItem(REFRESH_TOKEN_SESSION_KEY, refreshToken);
    else window.sessionStorage.removeItem(REFRESH_TOKEN_SESSION_KEY);
  } catch {
    // 저장소 접근이 차단된 브라우저에서는 현재 메모리 세션만 사용한다.
  }
};

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        // Supabase의 전체 세션/회원 객체는 브라우저 저장소에 남기지 않는다.
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

let sessionRestorePromise: Promise<Session | null> | null = null;

// 새로고침 시에는 탭 단위 sessionStorage의 refresh token만 사용해 서버에서 세션을 다시 받는다.
// 이메일, 이름, 권한 등 회원 정보는 브라우저 저장소에 기록하지 않는다.
export const restoreSupabaseSession = async (): Promise<Session | null> => {
  const client = requireSupabase();
  const refreshToken = readRefreshToken();
  if (!refreshToken) {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  if (!sessionRestorePromise) {
    sessionRestorePromise = client.auth.refreshSession({ refresh_token: refreshToken })
      .then(({ data, error }) => {
        if (error || !data.session) {
          rememberSessionRefreshToken(null);
          return null;
        }
        rememberSessionRefreshToken(data.session.refresh_token);
        return data.session;
      })
      .catch(() => {
        rememberSessionRefreshToken(null);
        return null;
      });
  }
  return sessionRestorePromise;
};

export const requireSupabase = (): SupabaseClient => {
  if (!supabase) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  return supabase;
};

export const supabaseFunctionUrl = (functionName: string) => {
  if (!url) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  return `${url.replace(/\/$/, '')}/functions/v1/${functionName}`;
};
