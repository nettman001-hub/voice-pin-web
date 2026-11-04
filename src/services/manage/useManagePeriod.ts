import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { readManagePeriod, readStoredManagePeriod, storeManagePeriod, withManagePeriod } from './period';

export function useManagePeriod(fallback = 7) {
  const [params, setParams] = useSearchParams();
  const { workspaceId } = useAuth();
  const periodDays = readManagePeriod(params.get('period'), readStoredManagePeriod(workspaceId, fallback));
  useEffect(() => {
    storeManagePeriod(workspaceId, periodDays);
    if (!params.has('period')) {
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('period', String(periodDays));
        return next;
      }, { replace: true });
    }
  }, [workspaceId, periodDays, params, setParams]);
  const setPeriodDays = (days: number) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set('period', String(days));
    return next;
  }, { replace: true });
  return { periodDays, setPeriodDays };
}

/** 사이드 메뉴와 앱 하단 메뉴에서도 현재 관리 기간을 이어 준다. */
export function useManageNavigationPath() {
  const { workspaceId } = useAuth();
  const { pathname, search } = useLocation();
  const stored = readStoredManagePeriod(workspaceId);
  const days = pathname === '/manage' || pathname.startsWith('/manage/')
    ? readManagePeriod(new URLSearchParams(search).get('period'), stored) : stored;
  return (path: string) => path === '/manage' || path.startsWith('/manage/') ? withManagePeriod(path, days) : path;
}
