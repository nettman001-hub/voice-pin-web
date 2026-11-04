export const MANAGE_PERIODS = [
  { days: 1, label: '오늘' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: 0, label: '전체' },
] as const;

export function readManagePeriod(value: string | null, fallback = 7): number {
  return value !== null && MANAGE_PERIODS.some((period) => String(period.days) === value) ? Number(value) : fallback;
}

const periodKey = (workspaceId?: string | null) => `voicecap_manage_period_${workspaceId || 'local'}`;

export function readStoredManagePeriod(workspaceId?: string | null, fallback = 7,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): number {
  try {
    return readManagePeriod(storage?.getItem(periodKey(workspaceId)) ?? null, fallback);
  } catch {
    return fallback;
  }
}

export function storeManagePeriod(workspaceId: string | null | undefined, days: number,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(periodKey(workspaceId), String(days));
  } catch {
    // 저장이 차단되어도 현재 주소의 기간은 유지한다.
  }
}

export function withManagePeriod(path: string, days: number): string {
  const url = new URL(path, 'https://voicecap.shop');
  url.searchParams.set('period', String(days));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 기간 필터는 판매일 기준이며 0은 전체 기간이다. */
export function inManagePeriod(at: string, days: number, now: Date): boolean {
  return days === 0 || Date.parse(at) >= now.getTime() - days * 86400000;
}
