import type { SaleRecord } from '../../types/live.ts';

/** 회차별 조회와 방송 시작일 기준 기간 조회는 동시에 적용하지 않는다. */
export type ManageScope =
  | { mode: 'session'; sessionId: string }
  | { mode: 'period'; periodDays: number };

export interface ManageSessionLike {
  id: string;
  displayCode?: string | null;
  status?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  /** 서버의 회차 시작 기록이 없어 가장 이른 판매 시각으로 보완한 회차. */
  estimated?: boolean;
}

const DAY_MS = 86400000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
const PERIODS = new Set([0, 1, 7, 30]);
const timeOf = (value?: string | null) => value ? Date.parse(value) : NaN;
const sortTime = (session: ManageSessionLike) => {
  const time = timeOf(session.startedAt);
  return Number.isFinite(time) ? time : -Infinity;
};
const newestFirst = (left: ManageSessionLike, right: ManageSessionLike) => {
  const leftTime = sortTime(left);
  const rightTime = sortTime(right);
  return leftTime === rightTime ? left.id.localeCompare(right.id) : leftTime > rightTime ? -1 : 1;
};

/** 서버와 기기의 시간대에 영향받지 않는 옛 회차 표시명. ID는 그대로 보존한다. */
function fallbackDisplayCode(id: string, startedAt?: string | null): string {
  if (id.includes('회차')) return id.replace(/임시\s*회차/g, '라이브 회차');
  const started = timeOf(startedAt);
  const shortId = id.length > 12 ? `${id.slice(0, 8)}…` : id;
  if (!Number.isFinite(started)) return `방송 회차 (${shortId})`;
  const korean = new Date(started + KOREA_OFFSET_MS).toISOString();
  return `${korean.slice(0, 10)} ${korean.slice(11, 16)} 방송 (${shortId})`;
}

/** 서버 회차 목록에 없는 옛 판매도 원래 sessionId별로 모아 보완한다. */
export function buildManageSessions(
  sessions: readonly ManageSessionLike[],
  sales: readonly SaleRecord[],
): ManageSessionLike[] {
  const firstSaleAt = new Map<string, string>();
  for (const sale of sales) {
    if (!sale.sessionId || !sale.sessionId.trim()) continue;
    const time = timeOf(sale.recognizedAt);
    if (!Number.isFinite(time)) continue;
    const previous = firstSaleAt.get(sale.sessionId);
    if (!previous || time < Date.parse(previous)) firstSaleAt.set(sale.sessionId, sale.recognizedAt);
  }

  const byId = new Map<string, ManageSessionLike>();
  for (const session of sessions) {
    if (!session.id || !session.id.trim()) continue;
    const inferred = firstSaleAt.get(session.id);
    const hasServerStart = Number.isFinite(timeOf(session.startedAt));
    const startedAt = hasServerStart ? session.startedAt : inferred || session.startedAt;
    byId.set(session.id, {
      ...session,
      startedAt,
      displayCode: session.displayCode?.trim() || fallbackDisplayCode(session.id, startedAt),
      estimated: hasServerStart ? session.estimated : !!inferred || session.estimated,
    });
  }
  for (const sale of sales) {
    if (!sale.sessionId || !sale.sessionId.trim() || byId.has(sale.sessionId)) continue;
    const startedAt = firstSaleAt.get(sale.sessionId);
    byId.set(sale.sessionId, {
      id: sale.sessionId,
      displayCode: fallbackDisplayCode(sale.sessionId, startedAt),
      startedAt,
      status: 'ENDED',
      estimated: true,
    });
  }
  return [...byId.values()].sort(newestFirst);
}

/** 진행 중 회차 우선, 없으면 가장 최근에 시작한 회차. */
export function latestManageSessionId(sessions: readonly ManageSessionLike[]): string | null {
  const sorted = [...sessions].sort(newestFirst);
  return (sorted.find((session) => session.status === 'ACTIVE') || sorted[0])?.id || null;
}

export function selectedManageSessionIds(
  scope: ManageScope,
  sessions: readonly ManageSessionLike[],
  now: Date,
): Set<string> {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return new Set();
  const available = sessions.filter((session) => {
    const startedAt = timeOf(session.startedAt);
    return !Number.isFinite(startedAt) || startedAt <= nowTime;
  });
  if (scope.mode === 'session') {
    if (scope.sessionId === 'ALL') return new Set(available.map((session) => session.id));
    if (scope.sessionId === 'LATEST') {
      const latest = latestManageSessionId(available);
      return new Set(latest ? [latest] : []);
    }
    // 목록에 없는 옛 회차의 직접 링크도 원래 ID로 조회할 수 있다.
    const known = sessions.find((session) => session.id === scope.sessionId);
    return new Set(known && !available.includes(known) ? [] : [scope.sessionId]);
  }
  if (!PERIODS.has(scope.periodDays)) return new Set();
  if (scope.periodDays === 0) return new Set(available.map((session) => session.id));

  const todayStart = Math.floor((nowTime + KOREA_OFFSET_MS) / DAY_MS) * DAY_MS - KOREA_OFFSET_MS;
  const since = todayStart - (scope.periodDays - 1) * DAY_MS;
  return new Set(available.filter((session) => timeOf(session.startedAt) >= since).map((session) => session.id));
}

/** 판매 시각으로 회차를 자르지 않고 선택한 회차의 판매 전체를 가져온다. */
export function selectManageSales(
  sales: readonly SaleRecord[],
  sessions: readonly ManageSessionLike[],
  scope: ManageScope,
  now: Date,
): SaleRecord[] {
  const available = buildManageSessions(sessions, sales);
  const selected = selectedManageSessionIds(scope, available, now);
  return sales.filter((sale) => selected.has(sale.sessionId));
}

export function normalizeManageScope(value: unknown): ManageScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  if (scope.mode === 'session' && typeof scope.sessionId === 'string') {
    const id = scope.sessionId.trim();
    return id && id.length <= 200 ? { mode: 'session', sessionId: id } : null;
  }
  if (scope.mode === 'period' && typeof scope.periodDays === 'number' && PERIODS.has(scope.periodDays)) {
    return { mode: 'period', periodDays: scope.periodDays };
  }
  return null;
}

export function withManageScope(path: string, scope: ManageScope): string {
  const url = new URL(path, 'https://voicecap.shop');
  if (scope.mode === 'session') {
    url.searchParams.delete('period');
    url.searchParams.set('session', scope.sessionId);
  } else {
    url.searchParams.delete('session');
    url.searchParams.set('period', String(scope.periodDays));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function manageScopeLabel(scope: ManageScope, sessions: readonly ManageSessionLike[]): string {
  if (scope.mode === 'period') {
    if (scope.periodDays === 0) return '전체 기간 · 방송 시작일 기준';
    return scope.periodDays === 1 ? '오늘 시작한 방송' : `최근 ${scope.periodDays}일 시작한 방송`;
  }
  if (scope.sessionId === 'ALL') return '전체 방송 회차';
  const id = scope.sessionId === 'LATEST' ? latestManageSessionId(sessions) : scope.sessionId;
  const session = sessions.find((item) => item.id === id);
  return session?.displayCode?.trim() || (id ? fallbackDisplayCode(id, session?.startedAt) : '최근 방송 회차 없음');
}
