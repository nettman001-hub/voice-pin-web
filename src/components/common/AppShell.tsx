import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { FileSpreadsheet, GitCompare, MoreHorizontal, Monitor, ReceiptText, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { useProductSales } from '../../context/ProductSalesContext';
import { TouchSalesApi } from '../../services/touchSalesApi';
import { APP_TOAST_EVENT, type AppToastDetail } from '../../services/appDownload';
import { androidNative } from '../../services/labelPrinter/androidBridge';
import {
  APP_TABS,
  appScreenTitle,
  appTabFor,
  formatWon,
  sellingSummary,
  type AppTabId,
  type SellingSummary,
} from '../../services/appShellState';

/** 판매 앱([관리] 탭) 안에서만 쓰는 화면 틀: 얇은 헤더, 하단 메뉴 5개, 판매 중 띠, PC 전용 안내. */

const TAB_ICONS: Record<AppTabId, React.ComponentType<{ className?: string }>> = {
  sales: ShoppingBag,
  invoices: ReceiptText,
  messages: GitCompare,
  settlement: FileSpreadsheet,
  more: MoreHorizontal,
};

export const AppHeader: React.FC = () => {
  const { pathname } = useLocation();
  const activeSession = useProductSales()?.activeSession;
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur select-none">
      <div className="min-w-0 truncate text-base font-extrabold tracking-tight text-slate-900">
        {appScreenTitle(pathname)}
      </div>
      {activeSession?.displayCode && (
        <span className="flex-shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
          {activeSession.displayCode}
        </span>
      )}
    </header>
  );
};

export const AppBottomNav: React.FC = () => {
  const { pathname } = useLocation();
  const active = appTabFor(pathname);
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/95 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.05)] backdrop-blur-lg select-none"
      aria-label="관리 하단 메뉴"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-1">
        {APP_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const on = active === tab.id;
          return (
            <NavLink
              key={tab.id}
              to={tab.path}
              aria-current={on ? 'page' : undefined}
              className={`flex h-full min-w-[44px] flex-1 flex-col items-center justify-center rounded-2xl px-1 py-1 ${
                on ? 'font-black text-brand-600' : 'font-medium text-slate-500'
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                  on ? 'bg-brand-50 text-brand-600 shadow-sm' : ''
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-0.5 whitespace-nowrap text-[10px] tracking-tight">{tab.name}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};

const POLL_MS = 8000;

/** [판매] 탭에서 판매가 돌고 있으면 위에 띠로 알리고, 건수가 바뀌면 판매내역을 다시 불러온다. */
export const AppSellingBanner: React.FC = () => {
  const { workspaceId } = useAuth();
  const { refreshSales } = useSales();
  const api = useMemo(() => (workspaceId ? new TouchSalesApi(workspaceId) : null), [workspaceId]);
  const [summary, setSummary] = useState<SellingSummary | null>(null);
  const last = useRef<{ selling: boolean; count: number } | null>(null);

  useEffect(() => {
    if (!api) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        if (document.visibilityState !== 'hidden') {
          const boot = await api.bootstrap();
          const next = sellingSummary(boot.run, boot.serverNow);
          if (stopped) return;
          setSummary(next);
          const prev = last.current;
          const now = { selling: !!next, count: next?.count ?? 0 };
          // 판매 중 건수가 바뀌었거나 판매가 막 끝났으면 목록을 새로 받는다(처음 한 번은 화면이 이미 불러온다).
          if (prev && (prev.selling !== now.selling || prev.count !== now.count)) void refreshSales().catch(() => {});
          last.current = now;
        }
      } catch {
        // 연결이 잠시 끊겨도 띠만 그대로 두고 다음에 다시 본다.
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (!summary) return null;
  // 앱 1.0.2부터 [판매] 탭으로 바로 간다. 옛 앱은 안내 문구만 보여 준다.
  const canGoSell = typeof androidNative()?.showSell === 'function';
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800"
    >
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
        판매 중 · {summary.count}건 {formatWon(summary.amount)}
      </span>
      {canGoSell ? (
        <button
          type="button"
          onClick={() => androidNative()?.showSell?.()}
          className="min-h-[36px] rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white active:bg-rose-700"
        >
          판매 화면으로
        </button>
      ) : (
        <span className="font-medium text-rose-700">[판매] 탭에서 이어서 판매하세요</span>
      )}
    </div>
  );
};

export const PcOnlyNotice: React.FC = () => (
  <div className="mx-auto max-w-md p-6 text-center">
    <Monitor className="mx-auto mb-3 h-10 w-10 text-slate-400" />
    <h1 className="text-lg font-extrabold text-slate-900">PC에서 쓰는 화면입니다</h1>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">
      이 화면은 PC의 음성 청취와 댓글 도우미를 쓰는 기능이라 판매 앱에서는 열지 않습니다. 폰으로 판매할 때는
      [판매] 탭을 쓰시고, 판매 기록과 정산은 아래 메뉴에서 보실 수 있습니다.
    </p>
    <Link
      to="/sales"
      className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-bold text-white"
    >
      판매내역 보기
    </Link>
  </div>
);


/** 파일 저장 같은 결과를 화면 아래에 잠깐 보여 준다(앱 WebView는 alert()를 보여 주지 않는다). */
export const AppToastHost: React.FC = () => {
  const [toast, setToast] = useState<AppToastDetail | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (event: Event) => {
      setToast((event as CustomEvent<AppToastDetail>).detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 7000);
    };
    window.addEventListener(APP_TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(APP_TOAST_EVENT, onToast);
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-20 left-3 right-3 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
    >
      <span className="min-w-0 break-words">{toast.message}</span>
      {toast.onAction && (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.();
            setToast(null);
          }}
          className="flex-shrink-0 rounded-lg bg-white/15 px-3 py-1.5 font-bold"
        >
          {toast.actionLabel || '확인'}
        </button>
      )}
    </div>
  );
};
