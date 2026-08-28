import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import {
  Radio,
  Sliders,
  Sparkles,
  ShoppingBag,
  CheckSquare,
  BarChart3,
  CreditCard,
  Bell,
  User,
  Shield,
  Users,
  AlertTriangle,
  FileSpreadsheet,
  Smartphone,
  MessageCircle,
  MessageSquareText
} from 'lucide-react';

interface NavItem {
  name: string;
  path?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  isLiveOnly?: boolean;
}

interface NavGroup {
  groupName: string;
  items: NavItem[];
}

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, onCloseMobile }) => {
  const { user } = useAuth();
  const { isListening } = useLive();

  // 판매자 네비게이션
  const sellerGroups: NavGroup[] = [
    {
      groupName: '라이브 방송 관제',
      items: [
        { name: '라이브 청취 홈', path: '/live', icon: Radio, badge: isListening ? 'ON AIR' : undefined },
        { name: '음성인식 훈련 (학습)', path: '/voice-training', icon: Sparkles },
        { name: '캡처 영역 & 단어 규칙', path: '/recognition-rules', icon: Sliders },
      ]
    },
    {
      groupName: '판매 & 정산 관리',
      items: [
        { name: '판매 내역 목록', path: '/sales', icon: ShoppingBag },
        { name: '댓글 캡처 기록', path: '/comments', icon: MessageSquareText },
        { name: '방송 후 일괄 확인', path: '/sales/review', icon: CheckSquare },
        { name: '정산 및 엑셀 다운로드', path: '/settlement', icon: FileSpreadsheet },
      ]
    },
    {
      groupName: '고객 관리',
      items: [
        { name: '고객 관리 (모바일)', icon: Smartphone },
        { name: '고객 관리 (카카오톡)', icon: MessageCircle },
      ]
    },
    {
      groupName: '계정 및 구독',
      items: [
        { name: '요금제 및 멤버십', path: '/subscription/plans', icon: CreditCard },
        { name: '구독 & 결제 관리', path: '/subscription/manage', icon: BarChart3 },
        { name: '알림 설정', path: '/settings/notifications', icon: Bell },
        { name: '마이페이지 & 백업', path: '/my', icon: User },
      ]
    }
  ];

  // 관리자 네비게이션
  const adminGroups: NavGroup[] = [
    {
      groupName: '시스템 관제',
      items: [
        { name: '관리자 대시보드', path: '/admin', icon: Shield },
        { name: '회원 관리 & 정지', path: '/admin/members', icon: Users },
        { name: '신고 처리 센터', path: '/admin/reports', icon: AlertTriangle },
        { name: '이용 통계 & 시스템 로그', path: '/admin/stats', icon: BarChart3 },
      ]
    }
  ];

  const currentGroups = user?.role === '관리자' ? adminGroups : sellerGroups;

  const content = (
    <div className="flex flex-col h-full select-none">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {user?.role === '관리자' ? '관리자 관제 센터' : '판매자 방송 관제'}
        </span>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
            v1.0.0
          </span>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              aria-label="메뉴 닫기"
            >
              <span className="text-lg leading-none font-bold">×</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {currentGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              {group.groupName}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                if (!item.path) {
                  return (
                    <button
                      key={item.name}
                      type="button"
                      disabled
                      title="준비 중인 메뉴입니다"
                      className="flex w-full items-center px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-500 cursor-not-allowed"
                    >
                      <div className="flex items-center space-x-2.5">
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.name}</span>
                      </div>
                    </button>
                  );
                }

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => onCloseMobile && onCloseMobile()}
                    end={item.path === '/live' || item.path === '/admin' || item.path === '/sales'}
                    className={({ isActive }) =>
                      `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 font-bold border border-brand-200 shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`
                    }
                  >
                    <div className="flex items-center space-x-2.5">
                      <Icon className="w-4 h-4 flex-shrink-0 text-slate-500" />
                      <span>{item.name}</span>
                    </div>
                    {item.badge && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        item.badge === 'ON AIR'
                          ? 'bg-rose-500 text-white animate-pulse'
                          : 'bg-brand-100 text-brand-700'
                      }`}>
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

      {/* 하단 시스템 상태 안내 위젯 */}
      <div className="p-3 border-t border-slate-200 bg-slate-50">
        <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="font-bold text-slate-800 text-[11px]">VoiceCAP AI</span>
          </div>
          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
            정상 가동
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* 1. 데스크톱 고정 사이드바 */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-slate-200 text-slate-700 flex-col h-[calc(100vh-4rem)] sticky top-16 select-none shadow-sm">
        {content}
      </aside>

      {/* 2. 모바일 슬라이드 드로어 */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* 백드롭 */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm animate-in fade-in"
            onClick={onCloseMobile}
          />
          {/* 드로어 컨텐츠 */}
          <div className="relative w-72 max-w-[85vw] bg-white h-full shadow-2xl z-10 flex flex-col animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
