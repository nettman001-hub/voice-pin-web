import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { productSalesApi } from '../productSalesApi';
import {
  buildManageSessions, selectedManageSessionIds, normalizeManageScope, withManageScope,
  type ManageScope, type ManageSessionLike,
} from './scope';

const DEFAULT_SCOPE: ManageScope = { mode: 'session', sessionId: 'LATEST' };
const EMPTY_SESSIONS: ManageSessionLike[] = [];
const scopeStorageKey = (workspaceId?: string | null) => `voicecap_manage_scope_${workspaceId || 'local'}`;
const sessionCache = new Map<string, { sessions: ManageSessionLike[]; loadedAt: number; pending?: Promise<ManageSessionLike[]> }>();
const SESSION_CACHE_MS = 60_000;

function storedScope(workspaceId?: string | null): ManageScope | null {
  try {
    const value = globalThis.localStorage?.getItem(scopeStorageKey(workspaceId));
    return value ? normalizeManageScope(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

function saveScope(workspaceId: string | null | undefined, scope: ManageScope): void {
  try {
    globalThis.localStorage?.setItem(scopeStorageKey(workspaceId), JSON.stringify(scope));
  } catch {
    // 주소의 선택값은 저장소가 차단되어도 유지한다.
  }
}

function queryScope(params: URLSearchParams): ManageScope | null {
  if (params.has('session')) return normalizeManageScope({ mode: 'session', sessionId: params.get('session') });
  const period = params.get('period');
  if (period !== null && period.trim()) return normalizeManageScope({ mode: 'period', periodDays: Number(period) });
  return null;
}

/** 주문 상세 직접 주소는 마지막 조회 조건보다 그 주문의 원래 방송회차를 우선한다. */
function detailScope(pathname: string): ManageScope | null {
  const match = pathname.match(/^\/manage\/orders\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    const key = decodeURIComponent(match[1]);
    const buyerBoundary = key.search(/::(?:buyer|nickname):/);
    const boundary = buyerBoundary >= 0 ? buyerBoundary : key.indexOf('::');
    return boundary > 0 ? normalizeManageScope({ mode: 'session', sessionId: key.slice(0, boundary) }) : null;
  } catch {
    return null;
  }
}

function readSessions(workspaceId: string, force = false): Promise<ManageSessionLike[]> {
  const existing = sessionCache.get(workspaceId);
  if (existing?.pending) return existing.pending;
  if (!force && existing && Date.now() - existing.loadedAt < SESSION_CACHE_MS) return Promise.resolve(existing.sessions);
  const entry = existing || { sessions: EMPTY_SESSIONS, loadedAt: 0 };
  const pending = productSalesApi.listSessions().then(({ sessions }) => {
    entry.sessions = sessions;
    entry.loadedAt = Date.now();
    return sessions;
  }).finally(() => { entry.pending = undefined; });
  entry.pending = pending;
  sessionCache.set(workspaceId, entry);
  return pending;
}

export interface ManageSelection {
  scope: ManageScope;
  sessions: ManageSessionLike[];
  loading: boolean;
  sessionsLoaded: boolean;
  error: string | null;
  now: Date;
  scopeKey: string;
  mode: ManageScope['mode'];
  periodDays: number;
  setPeriodDays: (days: number) => void;
  setSessionId: (id: string) => void;
  setMode: (mode: ManageScope['mode']) => void;
  refreshSessions: () => void;
}

/** 새 관리는 회차 조회를 기본으로 하며, 날짜 조회는 방송 시작일을 기준으로 한다. */
export function useManagePeriod(_legacyFallback = 7): ManageSelection {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const { workspaceId } = useAuth();
  const { sales } = useSales();
  const [now, setNow] = useState(() => new Date());
  const [sessionState, setSessionState] = useState<{
    workspaceId: string | null; sessions: ManageSessionLike[]; loading: boolean; loaded: boolean; error: string | null;
  }>({ workspaceId: null, sessions: EMPTY_SESSIONS, loading: false, loaded: false, error: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshSessions = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!workspaceId) {
      setSessionState({ workspaceId: null, sessions: EMPTY_SESSIONS, loading: false, loaded: true, error: null });
      setNow(new Date());
      return;
    }
    let cancelled = false;
    setSessionState((previous) => ({
      workspaceId,
      sessions: previous.workspaceId === workspaceId ? previous.sessions : sessionCache.get(workspaceId)?.sessions || EMPTY_SESSIONS,
      loading: true, loaded: false, error: null,
    }));
    readSessions(workspaceId, refreshKey > 0).then((sessions) => {
      if (cancelled) return;
      setNow(new Date());
      setSessionState({ workspaceId, sessions, loading: false, loaded: true, error: null });
    }).catch((failure) => {
      if (cancelled) return;
      setNow(new Date());
      setSessionState((previous) => ({
        workspaceId,
        sessions: previous.workspaceId === workspaceId ? previous.sessions : EMPTY_SESSIONS,
        loading: false, loaded: true,
        error: failure instanceof Error ? failure.message : String(failure),
      }));
    });
    return () => { cancelled = true; };
  }, [workspaceId, refreshKey]);

  // 한국 자정과 앱 복귀 시 회차 목록과 기간 계산을 함께 갱신한다.
  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout>;
    const refresh = () => { setNow(new Date()); refreshSessions(); };
    const scheduleMidnight = () => {
      const current = Date.now();
      const nextMidnight = (Math.floor((current + 9 * 3600000) / 86400000) + 1) * 86400000 - 9 * 3600000;
      midnightTimer = setTimeout(() => { refresh(); scheduleMidnight(); }, nextMidnight - current + 100);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    scheduleMidnight();
    return () => {
      clearTimeout(midnightTimer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshSessions]);

  const cloudSessions = sessionState.workspaceId === workspaceId ? sessionState.sessions : EMPTY_SESSIONS;
  const sessions = useMemo(() => buildManageSessions(cloudSessions, sales), [cloudSessions, sales]);
  const sessionsLoaded = sessionState.workspaceId === workspaceId && sessionState.loaded;
  const latestId = useMemo(() => [...selectedManageSessionIds(DEFAULT_SCOPE, sessions, now)][0] || null, [sessions, now]);
  const stored = storedScope(workspaceId);
  const storedKey = JSON.stringify(stored);
  const requested = useMemo(() => queryScope(params) || detailScope(pathname) || stored || DEFAULT_SCOPE, [params, pathname, storedKey]);
  const scope = useMemo<ManageScope>(() => (
    requested.mode === 'session' && requested.sessionId === 'LATEST' && sessionsLoaded && latestId
      ? { mode: 'session', sessionId: latestId } : requested
  ), [requested, sessionsLoaded, latestId]);
  const scopeKey = JSON.stringify(scope);
  const lastChoices = useRef({ workspaceId, periodDays: 7, sessionId: 'LATEST' });
  if (lastChoices.current.workspaceId !== workspaceId) {
    lastChoices.current = { workspaceId, periodDays: 7, sessionId: 'LATEST' };
  }

  useEffect(() => {
    if (scope.mode === 'period') lastChoices.current.periodDays = scope.periodDays;
    else lastChoices.current.sessionId = scope.sessionId;
    saveScope(workspaceId, scope);
    const next = new URLSearchParams(params);
    next.delete('session');
    next.delete('period');
    next.set(scope.mode === 'session' ? 'session' : 'period', scope.mode === 'session' ? scope.sessionId : String(scope.periodDays));
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [workspaceId, scopeKey, params, setParams]);

  const choose = useCallback((nextScope: ManageScope) => {
    const valid = normalizeManageScope(nextScope);
    if (!valid) return;
    saveScope(workspaceId, valid);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('session');
      next.delete('period');
      next.set(valid.mode === 'session' ? 'session' : 'period', valid.mode === 'session' ? valid.sessionId : String(valid.periodDays));
      return next;
    }, { replace: true });
  }, [workspaceId, setParams]);

  const setPeriodDays = useCallback((days: number) => choose({ mode: 'period', periodDays: days }), [choose]);
  const setSessionId = useCallback((sessionId: string) => choose({ mode: 'session', sessionId }), [choose]);
  const setMode = useCallback((mode: ManageScope['mode']) => {
    if (mode === 'period') choose({ mode, periodDays: lastChoices.current.periodDays });
    else choose({ mode, sessionId: lastChoices.current.sessionId === 'LATEST' ? latestId || 'LATEST' : lastChoices.current.sessionId });
  }, [choose, latestId]);

  return {
    scope, sessions, now, scopeKey, sessionsLoaded,
    loading: !sessionsLoaded || (sessionState.workspaceId === workspaceId && sessionState.loading),
    error: sessionState.workspaceId === workspaceId ? sessionState.error : null,
    mode: scope.mode,
    periodDays: scope.mode === 'period' ? scope.periodDays : 0,
    setPeriodDays, setSessionId, setMode, refreshSessions,
  };
}

/** 사이드 메뉴와 앱 하단 메뉴에서도 회차 또는 방송 시작일 조회 조건을 이어 준다. */
export function useManageNavigationPath() {
  const { workspaceId } = useAuth();
  const { pathname, search } = useLocation();
  const stored = storedScope(workspaceId) || DEFAULT_SCOPE;
  const scope = pathname === '/manage' || pathname.startsWith('/manage/')
    ? queryScope(new URLSearchParams(search)) || detailScope(pathname) || stored : stored;
  return (path: string) => path === '/manage' || path.startsWith('/manage/') ? withManageScope(path, scope) : path;
}
