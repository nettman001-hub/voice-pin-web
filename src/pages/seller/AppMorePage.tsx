import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckSquare,
  ChevronRight,
  CreditCard,
  LogOut,
  MessageSquareText,
  Shield,
  Truck,
  User,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { androidJson, androidNative } from '../../services/labelPrinter/androidBridge';

type Item = {
  name: string;
  hint?: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ITEMS: Item[] = [
  { name: '택배발송 관리', hint: '송장 등록, 포장·배송 상태, 배송 안내 문자', path: '/shipments', icon: Truck },
  { name: '방송 후 일괄 확인', hint: '보류·확인 필요 판매를 한꺼번에 정리', path: '/sales/review', icon: CheckSquare },
  {
    name: '댓글 기록',
    hint: '댓글을 올린 판매만 기록됩니다. 터치 판매는 댓글을 올리지 않아 비어 있을 수 있습니다.',
    path: '/comments',
    icon: MessageSquareText,
  },
  { name: '판매자 설정 & 백업', hint: '설정, 전체 데이터 백업·복원', path: '/my', icon: User },
  { name: '알림 설정', path: '/notifications/settings', icon: Bell },
  { name: '요금제 및 멤버십', path: '/subscription/plans', icon: CreditCard },
  { name: '구독 & 결제 관리', path: '/subscription/manage', icon: BarChart3 },
];

/** 판매 앱 [관리] 탭의 "더보기": 하단 메뉴에 없는 화면 모음. */
export const AppMorePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const version = androidJson<{ version?: string }>(androidNative()?.info(), {}).version;
  const rows: Item[] =
    user?.role === '관리자'
      ? [...ITEMS, { name: '관리자 메뉴', hint: '관리자 계정에만 보입니다', path: '/admin', icon: Shield }]
      : ITEMS;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm font-bold text-slate-900">{user?.nickname || '판매자'}</div>
        {user?.email && <div className="truncate text-xs text-slate-500">{user.email}</div>}
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {rows.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <Link to={item.path} className="flex min-h-[56px] items-center gap-3 px-4 py-3 active:bg-slate-50">
                <Icon className="h-5 w-5 flex-shrink-0 text-brand-600" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900">{item.name}</span>
                  {item.hint && <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{item.hint}</span>}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white text-sm font-bold text-rose-600 active:bg-rose-50"
      >
        <LogOut className="h-4 w-4" /> 로그아웃
      </button>
      <p className="text-center text-[11px] text-slate-400">VoiceCAP 판매{version ? ` ${version}` : ''}</p>
    </div>
  );
};
