import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, AuthState, UserRole } from '../types/auth';
import {
  isSupabaseConfigured,
  requireSupabase,
  restoreSupabaseSession,
  supabase,
} from '../services/supabaseClient';
import { storageService } from '../services/storageService';
import { clearStoredAuthSession, dropAppSessionFallback, setKeepLogin } from '../services/authSessionStorage';
import { watchSalesAppAuthSync } from '../services/salesAppAuthSync';

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
  const [autoLogin, setAutoLogin] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const identitySyncRef = React.useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const identityGenerationRef = React.useRef(0);
  const requestedUserRef = React.useRef<string | null>(null);
  const requestedTokenRef = React.useRef<string | null>(null);
  const appliedIdentityRef = React.useRef<{ userId: string; token: string | null } | null>(null);
  const authRevisionRef = React.useRef(0);

  const clearRemoteIdentity = useCallback(() => {
    requestedUserRef.current = null;
    requestedTokenRef.current = null;
    appliedIdentityRef.current = null;
    identityGenerationRef.current += 1;
    identitySyncRef.current = null;
    storageService.setWorkspaceId(null);
    setUser(null); setWorkspaceId(null); setToken(null);
    setIsInitialized(true);
  }, []);

  const setRemoteIdentity = useCallback(async (authUser: Parameters<typeof formatUser>[0], accessToken?: string | null) => {
    const generation = identityGenerationRef.current;
    try {
      const { data: onboarding, error } = await requireSupabase().functions.invoke('voicecap-onboard');
      if (error || !onboarding?.ok) {
        console.warn('[Auth] voicecap-onboard 응답 경고 (DB 직접 조회 진행):', error || onboarding?.error);
      }
    } catch (e) {
      console.warn('[Auth] voicecap-onboard 호출 실패 (DB 직접 조회 진행):', e);
    }
    const identity = await formatUser(authUser);
    if (generation !== identityGenerationRef.current || requestedUserRef.current !== authUser.id) return;
    if (!identity.workspaceId) {
      throw new Error('VoiceCAP 작업공간을 찾지 못했습니다. 관리자에게 문의하세요.');
    }
    await storageService.restoreWorkspace(identity.workspaceId);
    if (generation !== identityGenerationRef.current || requestedUserRef.current !== authUser.id) return;
    storageService.setWorkspaceId(identity.workspaceId);
    setUser(identity.user);
    setWorkspaceId(identity.workspaceId);
    // 같은 계정의 토큰 갱신이 프로필 조회 중 도착했으면 최신 토큰을 쓴다.
    setToken(requestedTokenRef.current);
    appliedIdentityRef.current = { userId: authUser.id, token: requestedTokenRef.current };
  }, []);

  const syncRemoteIdentity = useCallback((authUser: Parameters<typeof formatUser>[0], accessToken?: string | null, refreshIdentity = true) => {
    if (requestedUserRef.current !== authUser.id) {
      requestedUserRef.current = authUser.id;
      identityGenerationRef.current += 1;
      // 계정 전환 중 이전 계정의 작업공간을 화면에 남기지 않는다.
      appliedIdentityRef.current = null;
      storageService.setWorkspaceId(null);
      setUser(null); setWorkspaceId(null); setToken(null);
      setIsInitialized(false);
    }
    requestedTokenRef.current = accessToken ?? null;
    if (!refreshIdentity && appliedIdentityRef.current?.userId === authUser.id) {
      if (appliedIdentityRef.current.token !== requestedTokenRef.current) {
        setToken(requestedTokenRef.current);
        appliedIdentityRef.current.token = requestedTokenRef.current;
      }
      return Promise.resolve();
    }
    if (identitySyncRef.current?.userId === authUser.id) return identitySyncRef.current.promise;
    const generation = identityGenerationRef.current;
    const promise = setRemoteIdentity(authUser, accessToken).finally(() => {
      if (identitySyncRef.current?.promise === promise) identitySyncRef.current = null;
      if (generation === identityGenerationRef.current && requestedUserRef.current === authUser.id)
        setIsInitialized(true);
    });
    identitySyncRef.current = { userId: authUser.id, promise };
    return promise;
  }, [setRemoteIdentity]);

  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client) {
      try {
        const saved = localStorage.getItem('voicecap_local_user');
        if (saved) {
          const parsed = JSON.parse(saved);
          setUser(parsed.user);
          setWorkspaceId(parsed.workspaceId || null);
          setToken('local-dev-token');
        }
      } catch (e) {
        console.error('로컬 유저 복원 오류:', e);
      }
      setIsInitialized(true);
      return;
    }

    let active = true;
    const initialize = async () => {
      const revision = authRevisionRef.current;
      const session = await restoreSupabaseSession();
      if (session?.user && active && revision === authRevisionRef.current) {
        try {
          await syncRemoteIdentity(session.user, session.access_token);
        } catch (error) {
          console.error('[Auth] Supabase profile load failed', error);
        }
      }
      if (active && revision === authRevisionRef.current) setIsInitialized(true);
    };
    void initialize();
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const revision = ++authRevisionRef.current;
      if (!session?.user) {
        // 판매 앱의 다른 탭에서 로그아웃한 알림도 여기로 온다. 이 탭에만 남은 대체 세션도 버린다.
        dropAppSessionFallback();
        clearRemoteIdentity();
        return;
      }
      const authUser = session.user;
      const accessToken = session.access_token;
      window.setTimeout(() => {
        if (!active || revision !== authRevisionRef.current) return;
        void syncRemoteIdentity(authUser, accessToken).catch((error) => console.error('[Auth] session update failed', error));
      }, 0);
    });
    const stopAppSync = watchSalesAppAuthSync((sharedSessionChanged) => {
      const revision = ++authRevisionRef.current;
      // 다른 웹뷰가 로그인/로그아웃했다면 이 화면만 보관하던 대체 세션은 버린다.
      if (sharedSessionChanged) dropAppSessionFallback();
      // 초기 복원 함수는 첫 결과(null 포함)를 캐시하므로 여기서는 직접 다시 읽는다.
      void client.auth.getSession().then(async ({ data, error }) => {
        if (!active || revision !== authRevisionRef.current || error) return;
        if (data.session?.user) await syncRemoteIdentity(data.session.user, data.session.access_token, false);
        else clearRemoteIdentity();
      }).catch((error) => console.error('[Auth] app session sync failed', error));
    });
    return () => {
      active = false;
      authRevisionRef.current += 1;
      identityGenerationRef.current += 1;
      identitySyncRef.current = null;
      stopAppSync();
      listener.subscription.unsubscribe();
    };
  }, [syncRemoteIdentity, clearRemoteIdentity]);

  const login = async (email: string, pass: string, rememberMe = false): Promise<AuthResult> => {
    setAutoLogin(Boolean(rememberMe));
    if (isLocked && lockUntil && Date.now() < lockUntil) {
      return { success: false, message: `로그인이 잠겨 있습니다. ${Math.ceil((lockUntil - Date.now()) / 60000)}분 후 다시 시도해 주세요.` };
    }
    if (isSupabaseConfigured) {
      // 세션이 저장되기 전에 보관 위치(자동 로그인 = 브라우저를 닫아도 유지)를 정한다.
      setKeepLogin(Boolean(rememberMe));
      const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password: pass });
      if (error || !data.user) return { success: false, message: error?.message || '로그인에 실패했습니다.' };
      await syncRemoteIdentity(data.user, data.session?.access_token);
      return { success: true };
    }

    // 로컬 개발/오프라인 환경용 데모 계정 로그인 허용
    const isDemoSeller = email.includes('seller') || email === 'seller@dadryeo.com';
    const isDemoAdmin = email.includes('admin') || email === 'admin@dadryeo.com';
    if (isDemoSeller || isDemoAdmin || pass.includes('demo')) {
      const demoUser: User = {
        id: isDemoAdmin ? 'local-admin-id' : 'local-seller-id',
        email,
        nickname: isDemoAdmin ? '관리자(데모)' : '판매자(데모)',
        role: isDemoAdmin ? '관리자' : '판매자',
        status: '활성',
        createdAt: new Date().toISOString().slice(0, 10),
        allowAdminSttKey: true,
        subscriptionPlan: '프로',
        isTrial: false,
      };
      setUser(demoUser);
      setWorkspaceId(isDemoAdmin ? 'local-admin-ws' : 'local-seller-ws');
      setToken('local-dev-token');
      try {
        localStorage.setItem('voicecap_local_user', JSON.stringify({ user: demoUser, workspaceId: isDemoAdmin ? 'local-admin-ws' : 'local-seller-ws' }));
      } catch (e) {}
      return { success: true };
    }

    return { success: false, message: '클라우드 회원 서버가 설정되지 않았습니다. 하단의 데모 계정 버튼을 눌러 로그인해 주세요.' };
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
    authRevisionRef.current += 1;
    clearRemoteIdentity();
    if (isSupabaseConfigured) {
      try {
        await requireSupabase().auth.signOut();
      } finally {
        clearStoredAuthSession();
      }
    }
    try {
      localStorage.removeItem('voicecap_local_user');
      storageService.clearWorkspaceSessionData(workspaceId || undefined);
      storageService.setWorkspaceId(null);
    } catch (e) {}
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
