import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { productionRuntime, type WorkspaceRuntime } from '../services/workspaceRuntime';

const RuntimeContext = createContext<WorkspaceRuntime>(productionRuntime);
export const useWorkspaceRuntime = () => useContext(RuntimeContext);

// Authentication stays real. Only the repository identity changes; disabling
// remote authentication would also disable the real workflow and AI scheduler.
export function useRuntimeAuth() {
  const auth = useAuth();
  const runtime = useWorkspaceRuntime();
  return { ...auth, workspaceId: runtime.workspaceId || auth.workspaceId };
}

export function WorkspaceRuntimeBoundary({ children }: { children: React.ReactNode }) {
  const { workspaceId, user, isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const testing = pathname === '/live-test' || pathname.startsWith('/live-test/');
  const identity = testing ? JSON.stringify([user?.id || '', workspaceId || '']) : 'production';
  const [loaded, setLoaded] = useState<{ identity: string; runtime: WorkspaceRuntime } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!testing || !isAuthenticated || !identity) return;
    let active = true;
    setError('');
    void import('../services/liveTest/testRuntime').then(module => module.getTestRuntime(workspaceId || user!.id, user!.id))
      .then(runtime => { if (active) setLoaded({ identity, runtime }); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '테스트 DB를 열지 못했습니다.'); });
    return () => { active = false; };
  }, [testing, identity, isAuthenticated]);

  if (testing && isAuthenticated && loaded?.identity !== identity) return <div role="status" className="p-8">
    {error || '로컬 테스트 DB를 준비하고 있습니다…'}
    {error && <button className="ml-3 underline" onClick={() => window.location.reload()}>다시 시도</button>}
  </div>;
  const runtime = testing && isAuthenticated && loaded?.identity === identity ? loaded.runtime : productionRuntime;
  return <RuntimeContext.Provider value={runtime}><React.Fragment key={runtime.id}>{children}</React.Fragment></RuntimeContext.Provider>;
}
