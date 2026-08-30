import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const requireSupabase = (): SupabaseClient => {
  if (!supabase) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  return supabase;
};

export const supabaseFunctionUrl = (functionName: string) => {
  if (!url) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  return `${url.replace(/\/$/, '')}/functions/v1/${functionName}`;
};
