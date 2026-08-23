import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import { Mic, Radio, User, Shield, LogOut, Settings, Bell, ChevronDown } from 'lucide-react';

export const Header: React.FC = () => {
  const { user, isAuthenticated, logout, switchUserRole } = useAuth();
  const { isListening, currentSessionId } = useLive();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 text-slate-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* 로고 & 방송 회차 */}
        <div className="flex items-center space-x-4">
          <Link to={isAuthenticated ? (user?.role === '관리자' ? '/admin' : '/live') : '/onboarding'} className="flex items-center space-x-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-brand-500 flex items-center justify-center shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-slate-900">
                다들려
              </span>
              <span className="ml-1.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-brand-50 text-brand-600 border border-brand-200">
                Nova-3 STT
              </span>
            </div>
          </Link>

          {/* 청취 상태 & 방송 회차 배지 */}
          {isAuthenticated && user?.role === '판매자' && (
            <div className="hidden sm:flex items-center space-x-2 ml-4 pl-4 border-l border-slate-200">
              <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                isListening
                  ? 'bg-rose-50 text-rose-600 border border-rose-200 animate-pulse'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>
                <Radio className={`w-3.5 h-3.5 ${isListening ? 'animate-spin text-rose-500' : ''}`} />
                <span>{isListening ? '라이브 청취 중' : '대기 중'}</span>
              </div>
              <span className="text-xs text-slate-600 font-mono bg-slate-100 px-2 py-1 rounded border border-slate-200">
                회차: {currentSessionId}
              </span>
            </div>
          )}
        </div>

        {/* 상단 네비게이션 & 사용자 메뉴 */}
        <div className="flex items-center space-x-3">
          {/* 데모용 역할 스위처 */}
          {isAuthenticated && (
            <div className="hidden md:flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-500 px-2 font-medium">데모전환:</span>
              <button
                onClick={() => { switchUserRole('판매자'); navigate('/live'); }}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  user?.role === '판매자' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                판매자 모드
              </button>
              <button
                onClick={() => { switchUserRole('관리자'); navigate('/admin'); }}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  user?.role === '관리자' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                관리자 모드
              </button>
            </div>
          )}

          {isAuthenticated ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-2 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 transition"
              >
                <div className="w-7 h-7 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs">
                  {user?.nickname ? user.nickname[0] : 'U'}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-bold text-slate-800">{user?.nickname}</div>
                  <div className="text-[10px] text-brand-600 font-semibold">{user?.role}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {/* 드롭다운 메뉴 */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-900">{user?.nickname}</p>
                    <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                  </div>
                  {user?.role === '판매자' ? (
                    <>
                      <Link
                        to="/live"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                      >
                        <Radio className="w-4 h-4 mr-2 text-rose-500" /> 라이브 청취 홈
                      </Link>
                      <Link
                        to="/sales"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                      >
                        <Settings className="w-4 h-4 mr-2 text-brand-500" /> 판매 내역 관리
                      </Link>
                      <Link
                        to="/subscription/manage"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                      >
                        <Shield className="w-4 h-4 mr-2 text-amber-500" /> 구독 관리
                      </Link>
                      <Link
                        to="/my"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                      >
                        <User className="w-4 h-4 mr-2 text-emerald-500" /> 마이페이지
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        to="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                      >
                        <Shield className="w-4 h-4 mr-2 text-purple-600" /> 관리자 대시보드
                      </Link>
                      <Link
                        to="/admin/members"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                      >
                        <User className="w-4 h-4 mr-2 text-cyan-600" /> 회원 관리
                      </Link>
                    </>
                  )}
                  <div className="border-t border-slate-100 my-1"></div>
                  <button
                    onClick={() => { setShowUserMenu(false); logout(); navigate('/login'); }}
                    className="w-full flex items-center px-4 py-2 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="w-4 h-4 mr-2" /> 로그아웃
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Link
                to="/pricing"
                className="text-xs font-bold px-3 py-2 text-slate-600 hover:text-slate-900 transition"
              >
                요금제 안내
              </Link>
              <Link
                to="/login"
                className="text-xs font-bold px-3 py-2 text-slate-600 hover:text-slate-900 transition"
              >
                로그인
              </Link>
              <Link
                to="/signup"
                className="text-xs font-bold px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-500/20 transition"
              >
                무료 시작하기
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
