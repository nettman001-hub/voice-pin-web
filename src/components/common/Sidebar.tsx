import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import { useSales } from '../../context/SalesContext';
import { useAppData } from '../../context/AppDataContext';
import {
  Radio,
  ShoppingBag,
  CheckSquare,
  Calculator,
  Mic2,
  Sliders,
  CreditCard,
  Bell,
  User,
  LayoutDashboard,
  Users,
  AlertTriangle,
  BarChart3,
  Sparkles,
  KeyRound
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeColor?: string;
}

interface NavSection {
  category: string;
  items: NavItem[];
}

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const { isListening, deepgramApiKey, setDeepgramApiKey } = useLive();
  const { sales } = useSales();
  const { completedTrainingCount } = useAppData();
  const location = useLocation();

  const pendingSalesCount = sales.filter((s) => s.status === '보류').length;

  const sellerNav: NavSection[] = [
    {
      category: '라이브 & 판매 자동화',
      items: [
        { to: '/live', label: '라이브 청취 홈', icon: Radio, badge: isListening ? 'ON AIR' : undefined, badgeColor: 'bg-rose-500 text-white' },
        { to: '/sales', label: '판매 내역 목록', icon: ShoppingBag, badge: `${sales.length}건` },
        { to: '/sales/review', label: '방송 후 일괄 확인', icon: CheckSquare, badge: pendingSalesCount > 0 ? `보류 ${pendingSalesCount}` : undefined, badgeColor: 'bg-amber-500 text-white font-bold' },
        { to: '/settlement', label: '판매 정산·내보내기', icon: Calculator },
      ]
    },
    {
      category: 'AI 음성 & 규칙 설정',
      items: [
        { to: '/voice-training', label: '음성 학습 & 훈련', icon: Mic2, badge: `${completedTrainingCount}/7 완료` },
        { to: '/recognition-rules', label: '인식 단어·동작 규칙', icon: Sliders },
      ]
    },
    {
      category: '계정 & 구독',
      items: [
        { to: '/subscription/plans', label: '요금제 선택', icon: Sparkles },
        { to: '/subscription/manage', label: '구독 관리·결제 내역', icon: CreditCard },
        { to: '/notifications/settings', label: '알림 설정', icon: Bell },
        { to: '/my', label: '마이페이지', icon: User },
      ]
    }
  ];

  const adminNav: NavSection[] = [
    {
      category: '관리자 대시보드',
      items: [
        { to: '/admin', label: '통합 대시보드', icon: LayoutDashboard },
        { to: '/admin/members', label: '회원 관리 (정지/해제)', icon: Users },
        { to: '/admin/reports', label: '신고 처리 센터', icon: AlertTriangle },
        { to: '/admin/stats', label: '이용 통계 & 시스템 로그', icon: BarChart3 },
      ]
    }
  ];

  const navSections = user?.role === '관리자' ? adminNav : sellerNav;

  return (
    <aside className="w-64 bg-white border-r border-slate-200 text-slate-700 flex flex-col flex-shrink-0 min-h-[calc(100vh-4rem)] shadow-sm">
      {/* 메뉴 리스트 */}
      <div className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {navSections.map((section, idx) => (
          <div key={idx}>
            <div className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {section.category}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to || (item.to !== '/live' && item.to !== '/admin' && location.pathname.startsWith(item.to));

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 border border-brand-200 shadow-sm'
                        : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 truncate">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-brand-600' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${item.badgeColor || 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 하단 Deepgram Nova-3 API Key 설정 인라인 위젯 */}
      <div className="p-3 border-t border-slate-200 bg-slate-50">
        <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-slate-800 flex items-center">
              <KeyRound className="w-3.5 h-3.5 mr-1 text-brand-600" /> Deepgram Nova-3
            </span>
            <span className="text-[10px] text-emerald-600 font-bold">
              {deepgramApiKey ? 'Key 연동됨' : '시뮬레이터'}
            </span>
          </div>
          <input
            type="password"
            placeholder="Deepgram API Key (선택)"
            value={deepgramApiKey}
            onChange={(e) => setDeepgramApiKey(e.target.value)}
            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-brand-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            * 미입력 시 틱톡 판매 음성 시뮬레이터로 동작합니다.
          </p>
        </div>
      </div>
    </aside>
  );
};
