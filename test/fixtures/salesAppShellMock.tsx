import React, { createContext, useContext, useEffect, useState } from 'react';
import { phoneLifecycleState } from './phoneLifecycleMock';
export { TouchSalesApi, isSupabaseConfigured, requireSupabase, productSalesApi, remoteWorkspaceService } from './phoneLifecycleMock';

export const shellDiagnostics = { logins: 0, providerMounts: 0, providerUnmounts: 0, tabs: [] as string[] };
const Auth = createContext<any>(null);
export function FixtureAuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => {
    shellDiagnostics.providerMounts++;
    return () => { shellDiagnostics.providerUnmounts++; };
  }, []);
  return <Auth.Provider value={{
    isAuthenticated: authenticated, isInitialized: true, isRemoteAuth: true,
    workspaceId: authenticated ? phoneLifecycleState.workspace : null,
    user: authenticated ? { id: 'seller', nickname: '테스트 판매자', role: '판매자' } : null,
    isLocked: false, lockUntil: null, loginAttempts: 0,
    login: async () => { shellDiagnostics.logins++; setAuthenticated(true); return { success: true }; },
    logout: async () => setAuthenticated(false),
  }}>{children}</Auth.Provider>;
}
export const useAuth = () => useContext(Auth);
