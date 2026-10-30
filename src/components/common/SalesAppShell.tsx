import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginPage } from '../../pages/auth/LoginPage';
import TouchMobileSalesPage from '../../pages/seller/TouchMobileSalesPage';
import { androidJson, androidNative, isSalesApp } from '../../services/labelPrinter/androidBridge';

export const APP_SELL_PATH = '/app/sell';
const AUTH_PATHS = ['/login', '/signup', '/onboarding', '/password/reset'];

/** One router and one authentication session own both native tabs. */
export function SalesAppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isInitialized, isRemoteAuth, user, workspaceId } = useAuth();
  const entered = useRef(false);
  const managementPath = useRef('/sales');
  const native = androidNative();
  const info = androidJson<{ singleWebView?: boolean; tab?: string }>(native?.info?.(), {});
  const initialTab = useRef(info.singleWebView ? info.tab : undefined);
  const adoptedInitialTab = useRef(false);
  if (isSalesApp() && (location.pathname === APP_SELL_PATH || info.singleWebView)) entered.current = true;
  const integrated = isSalesApp() && entered.current;
  const selling = location.pathname === APP_SELL_PATH;
  if (integrated && !selling && !AUTH_PATHS.includes(location.pathname))
    managementPath.current = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (!integrated) return;
    const changeTab = (event: Event) => {
      const raw = (event as CustomEvent).detail;
      const detail = typeof raw === 'string' ? androidJson<{ type?: string; tab?: string }>(raw, {}) : raw;
      if (detail?.type !== 'app-tab-change') return;
      if (detail.tab === 'sell') navigate(APP_SELL_PATH);
      else if (detail.tab === 'manage') navigate(managementPath.current);
    };
    window.addEventListener('voicecap-android', changeTab);
    return () => window.removeEventListener('voicecap-android', changeTab);
  }, [integrated, navigate]);

  useEffect(() => {
    if (!integrated) return;
    if (!adoptedInitialTab.current) {
      adoptedInitialTab.current = true;
      if (initialTab.current === 'manage' && selling) {
        navigate(managementPath.current, { replace: true });
        return;
      }
    }
    androidNative()?.setTab?.(selling ? 'sell' : 'manage');
  }, [integrated, selling, navigate]);

  if (!integrated) return <>{children}</>;
  return (
    <>
      <div hidden={!selling} data-sales-app-page="sell">
        {isAuthenticated && isRemoteAuth && workspaceId ? (
          // Route changes only hide this node. They never stop its comment stream or printer.
          <TouchMobileSalesPage key={`${user?.id}:${workspaceId}`} />
        ) : !selling ? null : !isInitialized ? (
          <div role="status" className="p-8 text-center text-slate-500">판매자 로그인 확인 중…</div>
        ) : !isAuthenticated ? (
          <LoginPage returnTo={APP_SELL_PATH} />
        ) : (
          <div className="p-8 text-center">실제 판매자 계정으로 로그인해 주세요.</div>
        )}
      </div>
      <div hidden={selling} data-sales-app-page="manage">{children}</div>
    </>
  );
}
