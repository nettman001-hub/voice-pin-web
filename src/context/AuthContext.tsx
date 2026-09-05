import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, AuthState, UserRole } from '../types/auth';
import {
  isSupabaseConfigured,
  rememberSessionRefreshToken,
  requireSupabase,
  restoreSupabaseSession,
  supabase,
} from '../services/supabaseClient';

interface AuthResult {
  success: boolean;
  message?: string;
  requiresEmailConfirmation?: boolean;
}

interface AuthContextType extends AuthState {
  isInitialized: boolean;
  isRemoteAuth: boolean;
  workspaceId: string | null;
  login: (email: string, pass: string, autoLogin?: boolean) => Promise<AuthResult>;
  signup: (email: string, pass: string, role: UserRole, nickname: string) => Promise<AuthResult>;
  confirmSignup: (email: string, code: string) => Promise<AuthResult>;
  resendSignupCode: (email: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  resetPassword: (email: string, newPass?: string) => Promise<AuthResult>;
  updateProfile: (nickname: string, phone?: string) => Promise<void>;
  switchUserRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const LOCK_DURATION_MS = 15 * 60 * 1000;

const formatUser = async (authUser: { id: string; email?: string | null; created_at?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) => {
  const client = requireSupabase();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    client.from('profiles').select('display_name, phone').eq('id', authUser.id).maybeSingle(),
    client.from('workspace_members').select('workspace_id, role').eq('user_id', authUser.id).order('created_at').limit(1).maybeSingle(),
  ]);
  const role: UserRole = authUser.app_metadata?.role === 'ADMIN' ? '관리자' : '판매자';
  const user: User = {
    id: authUser.id,
    email: authUser.email ?? '',
    nickname: profile?.display_name || String(authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || '판매자'),
    phone: profile?.phone || undefined,
    role,
    status: authUser.app_metadata?.voicecap_status === '정지' ? '정지' : '활성',
    suspendedReason: typeof authUser.app_metadata?.voicecap_suspended_reason === 'string'
      ? authUser.app_metadata.voicecap_suspended_reason
      : undefined,
    createdAt: authUser.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    allowAdminSttKey: authUser.app_metadata?.role === 'ADMIN' || Boolean(authUser.app_metadata?.voicecap_stt_allowed),
    subscriptionPlan: ['베이직', '프로', '프리미엄'].includes(String(authUser.app_metadata?.voicecap_subscription_plan))
      ? authUser.app_metadata?.voicecap_subscription_plan as User['subscriptionPlan']
      : '프로',
    subscriptionExpiresAt: typeof authUser.app_metadata?.voicecap_subscription_expires_at === 'string'
      ? authUser.app_metadata.voicecap_subscription_expires_at
      : undefined,
    isTrial: authUser.app_metadata?.voicecap_is_trial !== false,
  };
  return { user, workspaceId: membership?.workspace_id ?? null };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [autoLogin] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const identitySyncRef = React.useRef<Promise<void> | null>(null);

  const setRemoteIdentity = useCallback(async (authUser: Parameters<typeof formatUser>[0], accessToken?: string | null) => {
    const { data: onboarding, error } = await requireSupabase().functions.invoke('voicecap-onboard');
    if (error || !onboarding?.ok) throw new Error(onboarding?.error || error?.message || 'VoiceCAP 작업공간을 준비하지 못했습니다.');
    const identity = await formatUser(authUser);
    setUser(identity.user);
    setWorkspaceId(identity.workspaceId);
    setToken(accessToken ?? null);
  }, []);

  const syncRemoteIdentity = useCallback((authUser: Parameters<typeof formatUser>[0], accessToken?: string | null) => {
    if (identitySyncRef.current) return identitySyncRef.current;

    identitySyncRef.current = setRemoteIdentity(authUser, accessToken).finally(() => {
      identitySyncRef.current = null;
    });
    return identitySyncRef.current;
  }, [setRemoteIdentity]);

  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client) {
      setIsInitialized(true);
      return;
    }

    let active = true;
    const initialize = async () => {
      const session = await restoreSupabaseSession();
      if (session?.user && active) {
        try {
          await syncRemoteIdentity(session.user, session.access_token);
        } catch (error) {
          console.error('[Auth] Supabase profile load failed', error);
        }
      }
      if (active) setIsInitialized(true);
    };
    void initialize();
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session?.user) {
        rememberSessionRefreshToken(null);
        setUser(null); setWorkspaceId(null); setToken(null);
        return;
      }
      rememberSessionRefreshToken(session.refresh_token);
      const authUser = session.user;
      const accessToken = session.access_token;
      window.setTimeout(() => {
        if (!active) return;
        void syncRemoteIdentity(authUser, accessToken).catch((error) => console.error('[Auth] session update failed', error));
      }, 0);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [syncRemoteIdentity]);

  const login = async (email: string, pass: string, _rememberMe = false): Promise<AuthResult> => {
    if (isLocked && lockUntil && Date.now() < lockUntil) {
      return { success: false, message: `로그인이 잠겨 있습니다. ${Math.ceil((lockUntil - Date.now()) / 60000)}분 후 다시 시도해 주세요.` };
    }
    if (isSupabaseConfigured) {
      const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password: pass });
      if (error || !data.user) return { success: false, message: error?.message || '로그인에 실패했습니다.' };
      rememberSessionRefreshToken(data.session?.refresh_token);
      await syncRemoteIdentity(data.user, data.session?.access_token);
      return { success: true };
    }
    return { success: false, message: '클라우드 회원 서버가 설정되지 않았습니다.' };
  };

  const signup = async (email: string, pass: string, role: UserRole, nickname: string): Promise<AuthResult> => {
    if (isSupabaseConfigured) {
      if (role === '관리자') return { success: false, message: '관리자 계정은 운영자가 초대 방식으로 생성합니다.' };
      const { data, error } = await requireSupabase().auth.signUp({
        email,
        password: pass,
        options: {
          emailRedirectTo: window.location.origin,
          data: { display_name: nickname, workspace_name: `${nickname}의 VoiceCAP`, auth_app: 'voicecap' },
        },
      });
      if (error) return { success: false, message: error.message };
      if (data.session?.user) {
        rememberSessionRefreshToken(data.session.refresh_token);
        await syncRemoteIdentity(data.session.user, data.session.access_token);
      }
      return { success: true, requiresEmailConfirmation: !data.session };
    }

    return { success: false, message: '클라우드 회원 서버가 설정되지 않았습니다.' };
  };

  const confirmSignup = async (email: string, code: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return { success: false, message: '인증번호 확인은 수파베이스 설정 후 사용할 수 있습니다.' };
    const { data, error } = await requireSupabase().auth.verifyOtp({ email, token: code, type: 'email' });
    if (error || !data.session?.user) return { success: false, message: error?.message || '인증번호를 확인하지 못했습니다. 새 인증번호를 요청해 주세요.' };
    rememberSessionRefreshToken(data.session.refresh_token);
    await syncRemoteIdentity(data.session.user, data.session.access_token);
    return { success: true };
  };

  const resendSignupCode = async (email: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return { success: false, message: '인증번호 재발송은 수파베이스 설정 후 사용할 수 있습니다.' };
    const { error } = await requireSupabase().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return error ? { success: false, message: error.message } : { success: true, message: '새 인증번호를 이메일로 보냈습니다.' };
  };

  const logout = async () => {
    rememberSessionRefreshToken(null);
    if (isSupabaseConfigured) await requireSupabase().auth.signOut();
    setUser(null); setWorkspaceId(null); setToken(null);
  };

  const resetPassword = async (email: string, _newPass?: string): Promise<AuthResult> => {
    if (isSupabaseConfigured) {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/password/reset` });
      return error ? { success: false, message: error.message } : { success: true, message: '비밀번호 재설정 링크를 이메일로 보냈습니다.' };
    }
    return { success: false, message: '클라우드 회원 서버가 설정되지 않았습니다.' };
  };

  const updateProfile = async (nickname: string, phone?: string) => {
    if (!user) return;
    if (!isSupabaseConfigured) throw new Error('클라우드 회원 서버가 설정되지 않았습니다.');
    const { error } = await requireSupabase().from('profiles').update({ display_name: nickname, phone: phone || null }).eq('id', user.id);
    if (error) throw error;
    setUser((previous) => previous ? { ...previous, nickname, phone } : previous);
  };

  const switchUserRole = (_targetRole: UserRole) => {};

  return <AuthContext.Provider value={{
    user, isAuthenticated: !!user, isInitialized, isRemoteAuth: isSupabaseConfigured, workspaceId,
    token, autoLogin, loginAttempts, isLocked, lockUntil, login, signup, confirmSignup, resendSignupCode, logout, resetPassword, updateProfile, switchUserRole,
  }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
