import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, AuthState, UserRole } from '../types/auth';
import { storageService } from '../services/storageService';

interface AuthContextType extends AuthState {
  login: (email: string, pass: string, autoLogin?: boolean) => { success: boolean; message?: string };
  signup: (email: string, pass: string, role: UserRole, nickname: string) => { success: boolean; message?: string };
  logout: () => void;
  resetPassword: (email: string, newPass: string) => boolean;
  updateProfile: (nickname: string, phone?: string) => void;
  switchUserRole: (role: UserRole) => void; // 데모 편의용 역할 전환
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCK_DURATION_MS = 15 * 60 * 1000; // 15분

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [autoLogin, setAutoLogin] = useState<boolean>(true);
  const [loginAttempts, setLoginAttempts] = useState<number>(0);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);

  useEffect(() => {
    storageService.init();
    const savedToken = storageService.getToken();
    const savedUser = storageService.getCurrentUser();

    if (savedToken && savedUser) {
      setUser(savedUser);
      setToken(savedToken);
    } else if (savedUser) {
      // 기본 판매자 계정으로 편리한 시작 지원
      setUser(savedUser);
      setToken('mock_jwt_token_seller_1');
    }
  }, []);

  const login = (email: string, pass: string, rememberMe: boolean = true) => {
    // 1. 계정 잠금 여부 확인
    if (isLocked && lockUntil && Date.now() < lockUntil) {
      const remainMin = Math.ceil((lockUntil - Date.now()) / 60000);
      return { success: false, message: `로그인 5회 실패로 계정이 잠겼습니다. ${remainMin}분 후 다시 시도해주세요.` };
    }

    const users = storageService.getUsers();
    const found = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (!found) {
      const nextAttempts = loginAttempts + 1;
      setLoginAttempts(nextAttempts);
      if (nextAttempts >= 5) {
        setIsLocked(true);
        setLockUntil(Date.now() + LOCK_DURATION_MS);
        return { success: false, message: '로그인 5회 연속 실패로 15분간 로그인이 제한됩니다.' };
      }
      return { success: false, message: '가입되지 않은 이메일이거나 비밀번호가 올바르지 않습니다.' };
    }

    if (found.status === '정지') {
      return { success: false, message: `정지된 계정입니다. (사유: ${found.suspendedReason || '관리자 문의 필요'})` };
    }

    // 로그인 성공
    const newToken = `token_${found.id}_${Date.now()}`;
    setUser(found);
    setToken(newToken);
    setAutoLogin(rememberMe);
    setLoginAttempts(0);
    setIsLocked(false);
    setLockUntil(null);

    storageService.setCurrentUser(found);
    if (rememberMe) {
      storageService.setToken(newToken);
    }

    return { success: true };
  };

  const signup = (email: string, pass: string, role: UserRole, nickname: string) => {
    const users = storageService.getUsers();
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return { success: false, message: '이미 가입된 이메일입니다.' };
    }

    const newUser: User = {
      id: `u-${Date.now()}`,
      email,
      nickname: nickname || (role === '판매자' ? '신규 판매자' : '신규 관리자'),
      role,
      status: '활성',
      createdAt: new Date().toISOString().split('T')[0],
      subscriptionPlan: role === '판매자' ? '프로' : undefined,
      isTrial: true,
      subscriptionExpiresAt: new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0]
    };

    const updatedUsers = [...users, newUser];
    storageService.saveUsers(updatedUsers);

    // 자동 로그인 처리
    const newToken = `token_${newUser.id}_${Date.now()}`;
    setUser(newUser);
    setToken(newToken);
    storageService.setCurrentUser(newUser);
    storageService.setToken(newToken);

    return { success: true };
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    storageService.setCurrentUser(null);
    storageService.setToken(null);
  };

  const resetPassword = (email: string, _newPass: string): boolean => {
    const users = storageService.getUsers();
    const found = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return !!found;
  };

  const updateProfile = (nickname: string, phone?: string) => {
    if (!user) return;
    const updated: User = { ...user, nickname, phone };
    setUser(updated);
    storageService.setCurrentUser(updated);

    const users = storageService.getUsers().map((u) => (u.id === user.id ? updated : u));
    storageService.saveUsers(users);
  };

  const switchUserRole = (targetRole: UserRole) => {
    const users = storageService.getUsers();
    const targetUser = users.find((u) => u.role === targetRole) || {
      id: `demo-${targetRole}`,
      email: `${targetRole.toLowerCase()}@dadryeo.com`,
      nickname: `데모 ${targetRole}`,
      role: targetRole,
      status: '활성',
      createdAt: '2026-08-24'
    };
    setUser(targetUser as User);
    storageService.setCurrentUser(targetUser as User);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        token,
        autoLogin,
        loginAttempts,
        isLocked,
        lockUntil,
        login,
        signup,
        logout,
        resetPassword,
        updateProfile,
        switchUserRole
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
