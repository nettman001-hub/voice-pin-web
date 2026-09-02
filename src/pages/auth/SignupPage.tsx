import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/auth';
import { Mic, Mail, Lock, User, CheckCircle2, AlertCircle, Shield } from 'lucide-react';

export const SignupPage: React.FC = () => {
  const { signup, confirmSignup, resendSignupCode, isRemoteAuth } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'INPUT' | 'VERIFY'>('INPUT');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('판매자');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  const [verifyCode, setVerifyCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('123456');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);

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

    if (isRemoteAuth) {
      setIsSubmitting(true);
      const result = await signup(email, password, role, nickname || '라이브판매자');
      setIsSubmitting(false);
      if (!result.success) {
        setErrorMsg(result.message || '회원가입에 실패했습니다.');
        return;
      }
      if (result.requiresEmailConfirmation) {
        setGeneratedCode('');
        setStep('VERIFY');
        return;
      }
      navigate('/live');
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    setStep('VERIFY');
  };

  const handleConfirmVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isRemoteAuth) {
      const code = verifyCode.trim();
      if (!/^\d{6}$/.test(code)) {
        setErrorMsg('이메일로 받은 인증번호를 입력해주세요.');
        return;
      }
      setIsSubmitting(true);
      const result = await confirmSignup(email, code);
      setIsSubmitting(false);
      if (!result.success) {
        setErrorMsg(result.message || '인증번호를 확인하지 못했습니다.');
        return;
      }
      navigate('/live');
      return;
    }

    if (verifyCode !== generatedCode && verifyCode !== '123456') {
      setErrorMsg('인증 코드가 일치하지 않습니다. (테스트용 코드: ' + generatedCode + ')');
      return;
    }

    const res = await signup(email, password, role, nickname || (role === '판매자' ? '라이브판매자' : '관리자'));
    if (!res.success) {
      setErrorMsg(res.message || '회원가입에 실패했습니다.');
    } else {
      if (role === '관리자') navigate('/admin');
      else navigate('/live');
    }
  };

  const handleResendCode = async () => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setIsResending(true);
    const result = await resendSignupCode(email);
    setIsResending(false);
    if (!result.success) {
      setErrorMsg(result.message || '인증번호를 다시 보내지 못했습니다.');
      return;
    }
    setNoticeMsg(result.message || '새 인증번호를 이메일로 보냈습니다.');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto shadow-md shadow-brand-500/20 mb-3">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">VoiceCAP 회원가입</h2>
          <p className="text-xs text-slate-500 mt-1">틱톡 라이브 판매를 위한 스마트 AI 음성 자동화</p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-500" />
            <span>{errorMsg}</span>
          </div>
        )}
        {noticeMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
            {noticeMsg}
          </div>
        )}

        {step === 'INPUT' ? (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">가입 유형 선택</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole('판매자')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
                    role === '판매자'
                      ? 'bg-brand-50 border-brand-300 text-brand-700 shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700'
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
                      ? 'bg-purple-50 border-purple-300 text-purple-700 shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>서비스 관리자</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">이메일</label>
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
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">활동 닉네임</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="예: 러블리마켓"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">비밀번호 (8자 이상)</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문, 숫자 포함 8자 이상"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">비밀번호 확인</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호 재입력"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <div className="pt-2 space-y-2 border-t border-slate-100">
              <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                />
                <span>[필수] 서비스 이용약관 동의</span>
              </label>
              <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreePrivacy}
                  onChange={(e) => setAgreePrivacy(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                />
                <span>[필수] 개인정보 수집 및 이용 동의</span>
              </label>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition mt-4"
            >
              {isSubmitting ? '가입 처리 중...' : '이메일 인증번호 받기'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmVerify} className="space-y-4">
            <div className="p-4 rounded-2xl bg-brand-50 border border-brand-200 text-center">
              {isRemoteAuth ? <p className="text-xs text-brand-700"><strong>{email}</strong> 주소로 인증번호를 보냈습니다.<br />메일에 표시된 번호를 아래에 입력해 주세요.</p> : <>
                <p className="text-xs text-brand-700"><strong>{email}</strong> 주소로<br />6자리 인증 코드를 발송했습니다.</p>
                <div className="mt-2 text-sm font-mono font-bold text-slate-900 bg-white py-1 px-3 rounded-lg inline-block border border-brand-200 shadow-sm">발송된 코드: {generatedCode}</div>
              </>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">인증 코드 (6자리)</label>
              <input
                type="text"
                required
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="6자리 숫자 입력"
                className="w-full text-center tracking-widest text-lg font-bold py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-brand-500 transition"
              />
            </div>

            {isRemoteAuth && <button
              type="button"
              onClick={handleResendCode}
              disabled={isResending}
              className="w-full py-2.5 rounded-xl border border-brand-200 bg-white hover:bg-brand-50 text-brand-700 text-xs font-bold disabled:opacity-60"
            >
              {isResending ? '인증번호 재발송 중...' : '인증번호 다시 받기'}
            </button>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('INPUT')}
                className="w-1/3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                이전
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20"
              >
                {isSubmitting ? '인증 확인 중...' : '인증 확인 및 가입 완료'}
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-slate-500">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="text-brand-600 hover:underline font-bold ml-1">
            로그인하기
          </Link>
        </div>
      </div>
    </div>
  );
};
