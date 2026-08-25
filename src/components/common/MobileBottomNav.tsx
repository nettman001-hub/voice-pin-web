import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import {
  Radio,
  ShoppingBag,
  Sliders,
  FileSpreadsheet,
  User,
  Shield,
  Users,
  AlertTriangle,
  BarChart3
} from 'lucide-react';

interface MobileTabItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  isLive?: boolean;
}

export const MobileBottomNav: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const { isListening } = useLive();
  const location = useLocation();

  // 온보딩 및 인증 페이지는 하단 바 숨김
  const authRoutes = ['/onboarding', '/login', '/signup', '/password/reset', '/pricing'];
  const isAuthRoute = authRoutes.some((route) => location.pathname === route);

  if (!isAuthenticated || isAuthRoute) {
    return null;
  }

  const isSeller = user?.role === '판매자';

  const sellerTabs: MobileTabItem[] = [
    {
      name: '라이브',
      path: '/live',
      icon: Radio,
      badge: isListening ? 'ON' : undefined,
      isLive: true
    },
    {
      name: '판매내역',
      path: '/sales',
      icon: ShoppingBag
    },
    {
      name: '단어/규칙',
      path: '/recognition-rules',
      icon: Sliders
    },
    {
      name: '정산',
      path: '/settlement',
      icon: FileSpreadsheet
    },
    {
      name: '마이',
      path: '/my',
      icon: User
    }
  ];

  const adminTabs: MobileTabItem[] = [
    {
      name: '대시보드',
      path: '/admin',
      icon: Shield
    },
    {
      name: '회원관리',
      path: '/admin/members',
      icon: Users
    },
    {
      name: '신고센터',
      path: '/admin/reports',
      icon: AlertTriangle
    },
    {
      name: '통계로그',
      path: '/admin/stats',
      icon: BarChart3
    },
    {
      name: '마이',
      path: '/my',
      icon: User
    }
  ];

  const tabs: MobileTabItem[] = isSeller ? sellerTabs : adminTabs;

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pb-safe select-none transition-all"
      aria-label="모바일 하단 내비게이션"
    >
      <div className="flex items-center justify-around h-16 px-1 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isLiveTab = tab.isLive && isListening;

          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.path === '/live' || tab.path === '/admin' || tab.path === '/sales'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center flex-1 h-full py-1 px-1 rounded-2xl transition-all relative ${
                  isActive
                    ? 'text-brand-600 font-black'
                    : 'text-slate-500 hover:text-slate-800 font-medium'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-transform ${
                        isActive
                          ? 'bg-brand-50 text-brand-600 scale-105 shadow-sm'
                          : 'hover:bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 transition-transform ${
                          isLiveTab ? 'text-rose-500 animate-pulse' : ''
                        }`}
                      />
                    </div>

                    {tab.badge && (
                      <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-rose-500 text-white animate-pulse border border-white">
                        {tab.badge}
                      </span>
                    )}

                    {isActive && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-brand-600" />
                    )}
                  </div>

                  <span className="text-[10px] tracking-tight mt-0.5 whitespace-nowrap">
                    {tab.name}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
