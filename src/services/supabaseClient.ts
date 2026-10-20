import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { authSessionStorage, takeLegacyRefreshToken } from './authSessionStorage';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        // 자동 로그인을 켜면 localStorage(브라우저를 닫아도 유지), 끄면 sessionStorage(탭을 닫으면 로그아웃).
        persistSession: true,
        storage: authSessionStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

let sessionRestorePromise: Promise<Session | null> | null = null;

// 저장된 세션은 Supabase 클라이언트가 읽고, 만료됐으면 서버에서 갱신한다.
// 예전 버전이 탭에 남긴 refresh token이 있으면 한 번 이어받는다.
export const restoreSupabaseSession = async (): Promise<Session | null> => {
  const client = requireSupabase();
  if (!sessionRestorePromise) {
    sessionRestorePromise = (async () => {
      const { data } = await client.auth.getSession();
      if (data.session) {
        takeLegacyRefreshToken();
        return data.session;
      }
      const legacyToken = takeLegacyRefreshToken();
      if (!legacyToken) return null;
      const { data: refreshed, error } = await client.auth.refreshSession({ refresh_token: legacyToken });
      return error ? null : refreshed.session;
    })().catch(() => null);
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
