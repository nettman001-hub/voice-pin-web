import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/auth';
import { Mic, Mail, Lock, User, CheckCircle2, AlertCircle, ArrowRight, Shield } from 'lucide-react';

export const SignupPage: React.FC = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'INPUT' | 'VERIFY'>('INPUT');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('판매자');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  // 인증 코드
  const [verifyCode, setVerifyCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('123456');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRequestCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email || !email.includes('@')) {
      setErrorMsg('올바른 이메일 주소를 입력해주세요.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setErrorMsg('필수 약관에 모두 동의해주세요.');
      return;
    }

    // 모의 6자리 인증 코드 발송
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    setStep('VERIFY');
  };

  const handleConfirmVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (verifyCode !== generatedCode && verifyCode !== '123456') {
      setErrorMsg('인증 코드가 일치하지 않습니다. (테스트용 코드: ' + generatedCode + ')');
      return;
    }

    const res = signup(email, password, role, nickname || (role === '판매자' ? '라이브판매자' : '관리자'));
    if (!res.success) {
      setErrorMsg(res.message || '회원가입에 실패했습니다.');
    } else {
      if (role === '관리자') navigate('/admin');
      else navigate('/live');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-tiktok-cyan flex items-center justify-center mx-auto shadow-lg shadow-brand-500/20 mb-3">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">다들려 회원가입</h2>
          <p className="text-xs text-slate-400 mt-1">
            {step === 'INPUT' ? '계정 정보 입력 및 이메일 인증' : '이메일 6자리 인증번호 확인'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {step === 'INPUT' ? (
          <form onSubmit={handleRequestCode} className="space-y-4">
            {/* 역할 선택 */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">가입 유형 선택</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole('판매자')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
                    role === '판매자'
                      ? 'bg-brand-600/20 border-brand-500 text-brand-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>틱톡 판매자</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('관리자')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
                    role === '관리자'
                      ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>서비스 관리자</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">이메일</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">활동 닉네임</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="예: 러블리마켓"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">비밀번호 (8자 이상)</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문, 숫자 포함 8자 이상"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">비밀번호 확인</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호 재입력"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            {/* 약관 동의 */}
            <div className="pt-2 space-y-2 border-t border-slate-800">
              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-brand-500 focus:ring-0 w-4 h-4"
                />
                <span>[필수] 서비스 이용약관 동의</span>
              </label>
              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreePrivacy}
                  onChange={(e) => setAgreePrivacy(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-brand-500 focus:ring-0 w-4 h-4"
                />
                <span>[필수] 개인정보 수집 및 이용 동의</span>
              </label>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-bold text-xs shadow-lg shadow-brand-500/25 transition mt-4"
            >
              이메일 인증번호 받기
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmVerify} className="space-y-4">
            <div className="p-4 rounded-xl bg-brand-500/10 border border-brand-500/20 text-center">
              <p className="text-xs text-brand-300">
                <strong>{email}</strong> 주소로<br />6자리 인증 코드를 발송했습니다.
              </p>
              <div className="mt-2 text-sm font-mono font-bold text-white bg-slate-950/60 py-1 px-3 rounded inline-block border border-brand-500/30">
                발송된 코드: {generatedCode}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">인증 코드 (6자리)</label>
              <input
                type="text"
                required
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="6자리 숫자 입력"
                className="w-full text-center tracking-widest text-lg font-bold py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-brand-500 transition"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('INPUT')}
                className="w-1/3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                이전
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 text-white text-xs font-bold shadow-lg shadow-brand-500/25"
              >
                인증 확인 및 가입 완료
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-slate-400">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="text-brand-400 hover:text-brand-300 font-bold ml-1">
            로그인하기
          </Link>
        </div>
      </div>
    </div>
  );
};
