import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Mic, Lock, Mail, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, isLocked, lockUntil, loginAttempts, isRemoteAuth } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const res = await login(email, password, false);
      if (!res.success) {
        setErrorMessage(res.message || '로그인에 실패했습니다.');
        return;
      }

      if (email.includes('admin')) {
        navigate('/admin');
      } else {
        navigate('/live');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillDemoAccount = (role: 'seller' | 'admin') => {
    if (role === 'seller') {
      setEmail('seller@dadryeo.com');
      setPassword('local-demo');
    } else {
      setEmail('admin@dadryeo.com');
      setPassword('local-admin-demo');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl">
        {/* 헤더 */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-rose-500 flex items-center justify-center mx-auto shadow-lg shadow-brand-500/20">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">VoiceCAP 로그인</h2>
          <p className="text-xs text-slate-500">틱톡 라이브 판매자를 위한 실시간 음성인식 & 자동 판매기록</p>
        </div>

        {/* 에러 배너 */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-500" />
            <div>
              <span className="font-semibold">{errorMessage}</span>
              {loginAttempts > 0 && loginAttempts < 5 && (
                <div className="text-[11px] text-rose-600 mt-0.5">
                  현재 {loginAttempts}회 실패 (5회 연속 실패 시 15분간 잠금)
                </div>
              )}
            </div>
          </div>
        )}

        {/* 계정 잠금 안내 배너 */}
        {isLocked && lockUntil && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
            <div>
              <span className="font-bold">보안 정책으로 계정이 잠겼습니다.</span>
              <p className="mt-0.5 text-[11px]">15분 후 다시 시도해주세요.</p>
            </div>
          </div>
        )}

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">이메일 주소</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">비밀번호</label>
              <Link to="/password/reset" className="text-[11px] text-brand-600 hover:underline">
                비밀번호 찾기
              </Link>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500">회원 정보는 저장하지 않고, 새로고침 유지용 임시 인증 토큰만 현재 탭에 보관합니다.</p>

          <button
            type="submit"
            disabled={isLocked || isSubmitting}
            className="w-full mt-2 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition disabled:opacity-50"
          >
            {isSubmitting ? '로그인 중...' : '로그인'}
          </button>
        </form>

        {/* 데모 빠른 계정 채우기 */}
        {!isRemoteAuth && <div className="mt-6 pt-6 border-t border-slate-100 text-center">
          <p className="text-[11px] text-slate-500 mb-2 font-medium">체험용 빠른 계정 선택</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => fillDemoAccount('seller')}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
            >
              🛍️ 판매자 계정
            </button>
            <button
              type="button"
              onClick={() => fillDemoAccount('admin')}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
            >
              🛡️ 관리자 계정
            </button>
          </div>
        </div>}

        {/* 하단 링크 */}
        <div className="mt-6 text-center text-xs text-slate-500">
          아직 계정이 없으신가요?{' '}
          <Link to="/signup" className="text-brand-600 hover:underline font-bold ml-1">
            회원가입하기
          </Link>
        </div>
      </div>
    </div>
  );
};
