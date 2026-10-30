/** 판매 앱의 [관리] 탭 화면 틀에서 쓰는 순수 계산(테스트용으로 화면 코드와 분리). */

export type AppTabId = 'sales' | 'invoices' | 'messages' | 'settlement' | 'more';

export const APP_TABS: { id: AppTabId; name: string; path: string }[] = [
  { id: 'sales', name: '판매내역', path: '/sales' },
  { id: 'invoices', name: '정산서', path: '/invoices' },
  { id: 'messages', name: '문자비교', path: '/customer-messages' },
  { id: 'settlement', name: '정산', path: '/settlement' },
  { id: 'more', name: '더보기', path: '/more' },
];

const startsWithPath = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** 지금 주소가 하단 메뉴 중 어디에 속하는지. */
export function appTabFor(pathname: string): AppTabId {
  if (pathname === '/sales/review' || pathname === '/sales/product') return 'more';
  if (startsWithPath(pathname, '/sales')) return 'sales';
  if (startsWithPath(pathname, '/invoices')) return 'invoices';
  if (
    startsWithPath(pathname, '/customer-messages') ||
    startsWithPath(pathname, '/seller/customer-messages')
  )
    return 'messages';
  if (startsWithPath(pathname, '/settlement')) return 'settlement';
  return 'more';
}

/** 앱에서 열지 않는 PC 전용 화면. */
const PC_ONLY_PATHS = [
  '/live',
  '/live-test',
  '/stt-vocabulary',
  '/voice-training',
  '/training',
  '/recognition-rules',
  '/rules',
  '/seller/devices',
  '/devices',
  '/seller/helper',
  '/helper',
];

export const isPcOnlyPath = (pathname: string) =>
  PC_ONLY_PATHS.some((p) => startsWithPath(pathname, p));

/** 상단 헤더에 보이는 화면 이름. */
export function appScreenTitle(pathname: string): string {
  if (startsWithPath(pathname, '/invoices')) return '정산서';
  if (startsWithPath(pathname, '/shipments')) return '택배발송';
  if (startsWithPath(pathname, '/settlement')) return '정산';
  if (startsWithPath(pathname, '/customer-messages') || startsWithPath(pathname, '/seller/customer-messages'))
    return '판매내역/문자비교';
  if (pathname === '/sales/review') return '방송 후 일괄 확인';
  if (startsWithPath(pathname, '/sales')) return '판매내역';
  if (startsWithPath(pathname, '/comments')) return '댓글 기록';
  if (startsWithPath(pathname, '/my')) return '판매자 설정 & 백업';
  if (startsWithPath(pathname, '/subscription')) return '요금제 · 구독';
  if (startsWithPath(pathname, '/notifications')) return '알림 설정';
  if (startsWithPath(pathname, '/admin')) return '관리자';
  return '더보기';
}

export type SellingSummary = { count: number; amount: number };

type BootstrapRun = {
  running?: boolean;
  lease_expires_at?: string;
  last_state?: { totalCount?: number; totalAmount?: number };
} | null;

/** 서버의 판매 실행 상태에서 "판매 중" 띠에 보일 값. 판매 중이 아니면 null. */
export function sellingSummary(
  run: BootstrapRun | undefined,
  serverNow: number | undefined,
): SellingSummary | null {
  if (!run?.running) return null;
  const lease = Date.parse(run.lease_expires_at || '');
  const now = typeof serverNow === 'number' && serverNow > 0 ? serverNow : Date.now();
  if (!Number.isFinite(lease) || lease <= now) return null;
  return {
    count: Math.max(0, Number(run.last_state?.totalCount) || 0),
    amount: Math.max(0, Number(run.last_state?.totalAmount) || 0),
  };
}

export const formatWon = (amount: number) =>
  `${Math.round(amount).toLocaleString('ko-KR')}원`;
