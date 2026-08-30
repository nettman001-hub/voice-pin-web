import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, AuthState, UserRole } from '../types/auth';
import { storageService } from '../services/storageService';
import { isSupabaseConfigured, requireSupabase, supabase } from '../services/supabaseClient';

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
    status: '활성',
    createdAt: authUser.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  };
  return { user, workspaceId: membership?.workspace_id ?? null };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [autoLogin, setAutoLogin] = useState(true);
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
      storageService.init();
      const savedToken = storageService.getToken();
      const savedUser = storageService.getCurrentUser();
      if (savedUser) {
        setUser(savedUser);
        setToken(savedToken || 'mock_jwt_token_seller_1');
      }
      setIsInitialized(true);
      return;
    }

    let active = true;
    const initialize = async () => {
      const { data } = await client.auth.getSession();
      if (data.session?.user && active) {
        try {
          await syncRemoteIdentity(data.session.user, data.session.access_token);
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
        setUser(null); setWorkspaceId(null); setToken(null);
        return;
      }
      const authUser = session.user;
      const accessToken = session.access_token;
      window.setTimeout(() => {
        if (!active) return;
        void syncRemoteIdentity(authUser, accessToken).catch((error) => console.error('[Auth] session update failed', error));
      }, 0);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [syncRemoteIdentity]);

  const login = async (email: string, pass: string, rememberMe = true): Promise<AuthResult> => {
    if (isLocked && lockUntil && Date.now() < lockUntil) {
      return { success: false, message: `로그인이 잠겨 있습니다. ${Math.ceil((lockUntil - Date.now()) / 60000)}분 후 다시 시도해 주세요.` };
    }
    if (isSupabaseConfigured) {
      const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password: pass });
      if (error || !data.user) return { success: false, message: error?.message || '로그인에 실패했습니다.' };
      await syncRemoteIdentity(data.user, data.session?.access_token);
      setAutoLogin(rememberMe);
      return { success: true };
    }

    const found = storageService.getUsers().find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
    if (!found || found.status === '정지') {
      const nextAttempts = loginAttempts + 1;
      setLoginAttempts(nextAttempts);
      if (nextAttempts >= 5) { setIsLocked(true); setLockUntil(Date.now() + LOCK_DURATION_MS); }
      return { success: false, message: found?.status === '정지' ? '정지된 계정입니다.' : '가입되지 않은 이메일이거나 비밀번호가 올바르지 않습니다.' };
    }
    const nextToken = `token_${found.id}_${Date.now()}`;
    setUser(found); setToken(nextToken); setAutoLogin(rememberMe); setLoginAttempts(0); setIsLocked(false); setLockUntil(null);
    storageService.setCurrentUser(found);
    if (rememberMe) storageService.setToken(nextToken);
    return { success: true };
  };

  const signup = async (email: string, pass: string, role: UserRole, nickname: string): Promise<AuthResult> => {
    if (isSupabaseConfigured) {
      if (role === '관리자') return { success: false, message: '관리자 계정은 운영자가 초대 방식으로 생성합니다.' };
      const { data, error } = await requireSupabase().auth.signUp({
        email,
        password: pass,
        options: { data: { display_name: nickname, workspace_name: `${nickname}의 VoiceCAP` } },
      });
      if (error) return { success: false, message: error.message };
      if (data.session?.user) await syncRemoteIdentity(data.session.user, data.session.access_token);
      return { success: true, requiresEmailConfirmation: !data.session };
    }

    const users = storageService.getUsers();
    if (users.some((candidate) => candidate.email.toLowerCase() === email.toLowerCase())) return { success: false, message: '이미 가입된 이메일입니다.' };
    const newUser: User = {
      id: `u-${Date.now()}`, email, nickname: nickname || '신규 판매자', role, status: '활성',
      createdAt: new Date().toISOString().slice(0, 10), subscriptionPlan: role === '판매자' ? '프로' : undefined, isTrial: true,
      subscriptionExpiresAt: new Date(Date.now() + 7 * 24 * 3600000).toISOString().slice(0, 10),
    };
    storageService.saveUsers([...users, newUser]);
    const nextToken = `token_${newUser.id}_${Date.now()}`;
    setUser(newUser); setToken(nextToken); storageService.setCurrentUser(newUser); storageService.setToken(nextToken);
    return { success: true };
  };

  const logout = async () => {
    if (isSupabaseConfigured) await requireSupabase().auth.signOut();
    setUser(null); setWorkspaceId(null); setToken(null);
    if (!isSupabaseConfigured) { storageService.setCurrentUser(null); storageService.setToken(null); }
  };

  const resetPassword = async (email: string, _newPass?: string): Promise<AuthResult> => {
    if (isSupabaseConfigured) {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/password/reset` });
      return error ? { success: false, message: error.message } : { success: true, message: '비밀번호 재설정 링크를 이메일로 보냈습니다.' };
    }
    return storageService.getUsers().some((candidate) => candidate.email.toLowerCase() === email.toLowerCase())
      ? { success: true } : { success: false, message: '가입되지 않은 이메일입니다.' };
  };

  const updateProfile = async (nickname: string, phone?: string) => {
    if (!user) return;
    if (isSupabaseConfigured) {
      const { error } = await requireSupabase().from('profiles').update({ display_name: nickname, phone: phone || null }).eq('id', user.id);
      if (error) throw error;
    } else {
      storageService.saveUsers(storageService.getUsers().map((candidate) => candidate.id === user.id ? { ...candidate, nickname, phone } : candidate));
      storageService.setCurrentUser({ ...user, nickname, phone });
    }
    setUser((previous) => previous ? { ...previous, nickname, phone } : previous);
  };

  const switchUserRole = (targetRole: UserRole) => {
    if (isSupabaseConfigured) return;
    const selected = storageService.getUsers().find((candidate) => candidate.role === targetRole);
    if (selected) { setUser(selected); storageService.setCurrentUser(selected); }
  };

  return <AuthContext.Provider value={{
    user, isAuthenticated: !!user, isInitialized, isRemoteAuth: isSupabaseConfigured, workspaceId,
    token, autoLogin, loginAttempts, isLocked, lockUntil, login, signup, logout, resetPassword, updateProfile, switchUserRole,
  }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
