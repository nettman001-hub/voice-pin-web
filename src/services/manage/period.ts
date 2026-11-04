export const MANAGE_PERIODS = [
  { days: 1, label: '오늘' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: 0, label: '전체' },
] as const;

export function readManagePeriod(value: string | null, fallback = 7): number {
  return value !== null && MANAGE_PERIODS.some((period) => String(period.days) === value) ? Number(value) : fallback;
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
