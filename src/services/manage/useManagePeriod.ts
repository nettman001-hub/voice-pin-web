import { useSearchParams } from 'react-router-dom';
import { readManagePeriod } from './period';

export function useManagePeriod(fallback = 7) {
  const [params, setParams] = useSearchParams();
  const periodDays = readManagePeriod(params.get('period'), fallback);
  const setPeriodDays = (days: number) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set('period', String(days));
    return next;
  }, { replace: true });
  return { periodDays, setPeriodDays };
}
