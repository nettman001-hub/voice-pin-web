import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { User, Mail, Phone, Shield, Trash2, CheckCircle2 } from 'lucide-react';

export const MyPage: React.FC = () => {
  const { user, updateProfile } = useAuth();

  const [nickname, setNickname] = useState(user?.nickname || '');
  const [phone, setPhone] = useState(user?.phone || '010-1234-5678');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(nickname, phone);
    setToastMsg('계정 정보가 성공적으로 수정되었습니다.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleDeleteAccount = () => {
    if (window.confirm('정말 회원 탈퇴를 요청하시겠습니까? 30일간의 유예기간 후 모든 데이터가 영구 삭제됩니다.')) {
      alert('회원 탈퇴 요청이 정상적으로 접수되었습니다.');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-black text-white tracking-tight">마이페이지 & 계정 정보 관리</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold">
            {user?.role} 계정
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">프로필 정보와 연락처를 관리하고 탈퇴를 요청할 수 있습니다.</p>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 계정 정보 수정 폼 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">가입 이메일 (변경 불가)</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                disabled
                value={user?.email || ''}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 cursor-not-allowed"
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
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">알림 수신 휴대폰 번호</label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md transition mt-2"
          >
            변경사항 저장하기
          </button>
        </form>

        {/* 계정 삭제 영역 */}
        <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-300">계정 삭제 (회원 탈퇴)</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              탈퇴 시 저장된 모든 판매 기록 및 캡처 데이터는 30일 후 자동 삭제됩니다.
            </p>
          </div>
          <button
            onClick={handleDeleteAccount}
            className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/30 transition flex items-center space-x-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>탈퇴 요청</span>
          </button>
        </div>
      </div>
    </div>
  );
};
