import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { User, Mail, Phone, Shield, Save, CheckCircle2 } from 'lucide-react';

export const MyPage: React.FC = () => {
  const { user, updateProfile, logout } = useAuth();

  const [nickname, setNickname] = useState(user?.nickname || '');
  const [phone, setPhone] = useState('010-1234-5678');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(nickname, phone);
    setToastMsg('프로필 정보가 성공적으로 변경되었습니다.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleDeleteAccount = () => {
    if (window.confirm('정말 회원 탈퇴를 진행하시겠습니까? 저장된 판매 내역과 음성 훈련 데이터가 영구 삭제됩니다.')) {
      alert('회원 탈퇴가 접수되었습니다.');
      logout();
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">마이페이지</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200">
            {user?.role} 계정
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          계정 프로필 정보 및 기본 설정을 관리합니다.
        </p>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 프로필 수정 폼 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">가입 이메일 (변경 불가)</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                disabled
                value={user?.email || ''}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">활동 닉네임 / 스토어명</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">연락처</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition"
          >
            <Save className="w-4 h-4" />
            <span>프로필 저장하기</span>
          </button>
        </form>

        <div className="border-t border-slate-100 pt-4 flex justify-between items-center text-xs">
          <span className="text-slate-400">더 이상 서비스를 이용하지 않으시나요?</span>
          <button
            type="button"
            onClick={handleDeleteAccount}
            className="text-rose-600 hover:text-rose-700 hover:underline font-bold"
          >
            회원 탈퇴 신청
          </button>
        </div>
      </div>
    </div>
  );
};
