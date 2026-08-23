import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Mic, Mail, Lock, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';

export const PasswordResetPage: React.FC = () => {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('654321');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSendCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.includes('@')) {
      setErrorMsg('올바른 이메일을 입력해주세요.');
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    setStep(2);
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (authCode !== generatedCode && authCode !== '654321') {
      setErrorMsg(`인증번호가 일치하지 않습니다. (테스트용 코드: ${generatedCode})`);
      return;
    }
    setStep(3);
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword.length < 8) {
      setErrorMsg('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('비밀번호가 일치하지 않습니다.');
      return;
    }

    resetPassword(email, newPassword);
    setSuccessMsg('비밀번호가 성공적으로 변경되었습니다! 로그인 페이지로 이동합니다.');
    setTimeout(() => {
      navigate('/login');
    }, 2000);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto shadow-md shadow-brand-500/20 mb-3">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">비밀번호 찾기·재설정</h2>
          <p className="text-xs text-slate-500 mt-1">
            {step === 1 && '1단계: 가입 이메일 인증번호 요청'}
            {step === 2 && '2단계: 인증번호 확인'}
            {step === 3 && '3단계: 새 비밀번호 설정'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-start space-x-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-500" />
            <span>{successMsg}</span>
          </div>
        )}

        {step === 1 && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">가입 이메일 주소</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seller@dadryeo.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition"
            >
              인증번호 전송
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="p-3 bg-brand-50 border border-brand-200 rounded-2xl text-center text-xs text-brand-700">
              <p>인증번호 6자리가 발송되었습니다.</p>
              <p className="font-mono font-bold text-slate-900 mt-1">테스트 코드: {generatedCode}</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">인증번호 6자리</label>
              <input
                type="text"
                required
                maxLength={6}
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder="6자리 입력"
                className="w-full text-center tracking-widest text-lg font-bold py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-brand-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-1/3 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
              >
                이전
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md"
              >
                인증 확인
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">새 비밀번호 (8자 이상)</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="새 비밀번호 입력"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">새 비밀번호 확인</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="새 비밀번호 재입력"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition"
            >
              비밀번호 변경 완료
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-xs">
          <Link to="/login" className="text-slate-500 hover:text-slate-900 inline-flex items-center space-x-1">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            <span>로그인 화면으로 돌아가기</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
