import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import { Modal } from './Modal';
import {
  Mic,
  Radio,
  User,
  Shield,
  LogOut,
  Settings,
  Bell,
  ChevronDown,
  HelpCircle,
  Sparkles,
  CheckCircle2,
  Camera,
  Download,
  Menu,
  X
} from 'lucide-react';

interface HeaderProps {
  onToggleMobileMenu?: () => void;
  isMobileMenuOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onToggleMobileMenu, isMobileMenuOpen }) => {
  const { user, isAuthenticated, logout, switchUserRole } = useAuth();
  const {
    isListening,
    currentSessionId,
    isScreenShareConnected,
    hasScreenShareAudio,
    stopListening,
    disconnectScreenShare
  } = useLive();
  const navigate = useNavigate();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  const handleLogoutKeepingShare = () => {
    setShowUserMenu(false);
    stopListening();
    logout();
    navigate('/login');
  };

  const handleLogoutDisconnectingShare = () => {
    setShowUserMenu(false);
    stopListening();
    disconnectScreenShare();
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-800 shadow-sm select-none">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* 좌측: 햄버거 버튼 + 로고 & 버전 배지 */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {isAuthenticated && onToggleMobileMenu && (
            <button
              onClick={onToggleMobileMenu}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition active:scale-95"
              aria-label="전체 메뉴 열기"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          <Link to={isAuthenticated ? (user?.role === '관리자' ? '/admin' : '/live') : '/onboarding'} className="flex items-center space-x-2 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-brand-600 via-brand-500 to-rose-500 flex items-center justify-center shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform flex-shrink-0">
              <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-1 sm:space-x-1.5">
                <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900">
                  VoiceCAP
                </span>
                <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.2 sm:py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                  v1.0
                </span>
              </div>
            </div>
          </Link>

          {/* 청취 상태 & 방송 회차 배지 (데스크톱 및 태블릿) */}
          {isAuthenticated && user?.role === '판매자' && (
            <div className="hidden sm:flex items-center space-x-2 ml-2 pl-2 border-l border-slate-200">
              <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                isListening
                  ? 'bg-rose-50 text-rose-600 border border-rose-200 animate-pulse'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>
                <Radio className={`w-3 h-3 ${isListening ? 'animate-spin text-rose-500' : ''}`} />
                <span>{isListening ? 'ON AIR' : '대기 중'}</span>
              </div>
              <span className="text-xs text-slate-600 font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                {currentSessionId}
              </span>
            </div>
          )}
        </div>

        {/* 상단 네비게이션 & 빠른 도움말 / 계정 메뉴 */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* 로그아웃 화면에서도 공유 연결이 살아 있음을 숨기지 않고 즉시 해제 가능하게 한다. */}
          {isAuthenticated && isScreenShareConnected && (
            <button
              onClick={disconnectScreenShare}
              className={`flex items-center space-x-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-bold transition border active:scale-95 ${
                hasScreenShareAudio
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
              }`}
              title="AI 청취는 중지할 수 있으며, 이 버튼을 누르면 방송 탭 공유 연결 자체가 해제됩니다."
              aria-label="방송 탭 공유 연결 해제"
            >
              <Camera className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">
                {hasScreenShareAudio ? '탭 공유 유지 중' : '공유 오디오 없음'}
              </span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 가이드 버튼 (모바일: 아이콘만, 데스크톱: 텍스트 포함) */}
          <button
            onClick={() => setShowGuideModal(true)}
            className="flex items-center space-x-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition border border-slate-200 active:scale-95"
            title="VoiceCAP 이용 가이드"
          >
            <HelpCircle className="w-4 h-4 text-brand-600 flex-shrink-0" />
            <span className="hidden sm:inline">이용 가이드</span>
          </button>

          {/* 데모용 빠른 역할 스위처 (데스크톱) */}
          {isAuthenticated && (
            <div className="hidden lg:flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-500 px-2 font-medium">모드:</span>
              <button
                onClick={() => { switchUserRole('판매자'); navigate('/live'); }}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  user?.role === '판매자' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                판매자
              </button>
              <button
                onClick={() => { switchUserRole('관리자'); navigate('/admin'); }}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  user?.role === '관리자' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                관리자
              </button>
            </div>
          )}

          {isAuthenticated ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-2 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 transition"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-brand-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
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
                        <User className="w-4 h-4 mr-2 text-emerald-500" /> 마이페이지 & 백업
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
                    onClick={handleLogoutKeepingShare}
                    className="w-full flex items-center px-4 py-2 text-xs text-rose-600 hover:bg-rose-50"
                    title={isScreenShareConnected ? 'AI 청취와 전송은 중지되고, 같은 브라우저 탭의 공유 연결만 유지됩니다.' : '로그아웃'}
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    {isScreenShareConnected ? '로그아웃 · 공유 유지' : '로그아웃'}
                  </button>
                  {isScreenShareConnected && (
                    <button
                      onClick={handleLogoutDisconnectingShare}
                      className="w-full flex items-center px-4 py-2 text-xs text-slate-600 hover:bg-slate-100"
                      title="AI 청취와 전송을 중지하고 방송 탭 공유 연결도 해제한 뒤 로그아웃합니다."
                    >
                      <X className="w-4 h-4 mr-2" />
                      공유 해제 후 로그아웃
                    </button>
                  )}
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

      {!isAuthenticated && isScreenShareConnected && (
        <div className="border-t border-amber-200 bg-amber-50 text-amber-950">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2 text-[11px] sm:text-xs font-black">
              <Camera className="w-4 h-4 flex-shrink-0 text-amber-700" />
              <span>공유 연결 유지 · AI 청취/전송 중지</span>
            </div>
            <button
              onClick={disconnectScreenShare}
              className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-[10px] sm:text-xs font-bold text-amber-900 transition active:scale-95"
              aria-label="유지 중인 방송 탭 공유 연결 해제"
            >
              공유 연결 해제
            </button>
          </div>
        </div>
      )}

      {/* 처음 사용자를 위한 퀵 스타트 가이드 모달 */}
      <Modal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title="✨ VoiceCAP v1.0.0 정식 이용 가이드"
        maxWidth="max-w-xl"
      >
        <div className="space-y-4 text-xs text-slate-700">
          <p className="text-slate-600 leading-relaxed">
            'VoiceCAP'은 틱톡 라이브 판매자님의 음성을 VoiceCAP AI로 실시간 인식하여 주문을 자동 저장하고 정산하는 상용 솔루션입니다.
          </p>

          <div className="space-y-3 pt-2">
            <div className="p-3.5 rounded-2xl bg-brand-50 border border-brand-200 flex items-start space-x-3">
              <div className="w-7 h-7 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">1</div>
              <div>
                <strong className="text-brand-900 block text-sm">라이브 청취 시작</strong>
                <span className="text-slate-600 mt-0.5 block">
                  홈 화면에서 [라이브 청취 시작]을 누르고 방송 탭과 [탭 오디오 공유]를 선택합니다. 청취 중지나 로그아웃 후에도 같은 브라우저 탭에서는 공유 연결을 재사용하며, 상단의 [탭 공유 유지 중] 버튼으로 완전히 해제할 수 있습니다.
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start space-x-3">
              <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">2</div>
              <div>
                <strong className="text-emerald-900 block text-sm">자연스러운 판매 멘트 발화</strong>
                <span className="text-slate-600 mt-0.5 block">
                  "구매확정 됐습니다! 닉네임 러블리님 금액 35,000원입니다."라고 말씀하시면 0.1초 만에 판매 카드가 자동 적재됩니다.
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-start space-x-3">
              <div className="w-7 h-7 rounded-xl bg-cyan-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">3</div>
              <div>
                <strong className="text-cyan-900 block text-sm">화면 자동 캡처 & 음성 수정</strong>
                <span className="text-slate-600 mt-0.5 block">
                  "캡처"라고 말씀하시면 댓글창 영역이 자동 크롭되며, 잘못 말했을 땐 "수정 시작" ➡️ "닉네임은 xxx, 금액은 xxx" ➡️ "수정 완료"로 수정됩니다.
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-purple-50 border border-purple-200 flex items-start space-x-3">
              <div className="w-7 h-7 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">4</div>
              <div>
                <strong className="text-purple-900 block text-sm">방송 후 일괄 확정 및 엑셀 정산</strong>
                <span className="text-slate-600 mt-0.5 block">
                  방송 종료 후 '방송 후 일괄 확인'에서 보류 건을 확인하고, 엑셀 한글 깨짐 방지(UTF-8 BOM) CSV로 즉시 다운로드합니다.
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-md shadow-brand-500/20 text-xs transition"
            >
              이해했습니다! 방송 시작하기
            </button>
          </div>
        </div>
      </Modal>
    </header>
  );
};
