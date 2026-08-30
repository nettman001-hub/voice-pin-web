import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import { storageService } from '../../services/storageService';
import {
  User,
  Mail,
  Phone,
  Shield,
  Save,
  CheckCircle2,
  Download,
  Upload,
  Database,
  RefreshCw
} from 'lucide-react';
import { Smartphone } from 'lucide-react';
import { devicePairingService, PairingCode } from '../../services/devicePairingService';

export const MyPage: React.FC = () => {
  const { user, updateProfile, logout, isRemoteAuth, workspaceId } = useAuth();
  const { disconnectScreenShare } = useLive();

  const [nickname, setNickname] = useState(user?.nickname || '');
  const [phone, setPhone] = useState('010-1234-5678');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(nickname, phone);
    setToastMsg('프로필 정보가 성공적으로 변경되었습니다.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  // 전체 데이터 JSON 백업 다운로드
  const handleExportBackup = () => {
    const jsonStr = storageService.exportFullBackup();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VoiceCAP_전체데이터백업_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToastMsg('전체 데이터(판매기록, 캡처, 설정)가 JSON 파일로 백업되었습니다! 💾');
    setTimeout(() => setToastMsg(null), 3000);
  };

  // JSON 백업 파일 업로드 및 복원
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        const success = storageService.importFullBackup(content);
        if (success) {
          setToastMsg('백업 데이터가 성공적으로 복원되었습니다! 화면을 새로고침합니다.');
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          alert('올바른 백업 JSON 파일 형식이 아닙니다.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleDeleteAccount = () => {
    if (window.confirm('정말 회원 탈퇴를 진행하시겠습니까? 저장된 판매 내역과 음성 훈련 데이터가 영구 삭제됩니다.')) {
      disconnectScreenShare();
      alert('회원 탈퇴가 접수되었습니다.');
      logout();
    }
  };

  const createPairingCode = async () => {
    if (!workspaceId) {
      setToastMsg('판매자 작업공간을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setPairingBusy(true);
    try {
      setPairing(await devicePairingService.createCode(workspaceId));
    } catch (error) {
      setToastMsg(error instanceof Error ? error.message : '연결 코드 생성에 실패했습니다.');
    } finally {
      setPairingBusy(false);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm">
        <div className="flex items-center space-x-2">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">마이페이지 & 데이터 관리</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] sm:text-xs font-bold border border-brand-200">
            {user?.role} 계정
          </span>
        </div>
        <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
          계정 프로필 정보 및 판매 데이터의 전체 백업/복원을 안전하게 관리합니다.
        </p>
      </div>

      {isRemoteAuth && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3">
          <div className="flex items-start gap-3"><div className="rounded-2xl bg-cyan-50 p-2.5"><Smartphone className="w-5 h-5 text-cyan-700" /></div><div><h3 className="text-sm font-black text-slate-900">voicecapSMS 휴대폰 연결</h3><p className="mt-1 text-[11px] text-slate-500">휴대폰 앱에서 이 코드만 입력하면 이 스토어에 연결됩니다. 코드는 10분 뒤 자동으로 만료되며 한 번만 사용할 수 있습니다.</p></div></div>
          {pairing ? <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-center"><p className="text-[11px] font-bold text-cyan-800">휴대폰 앱의 ‘기기 연결 코드’에 입력하세요</p><code className="mt-2 block select-all text-2xl font-black tracking-[0.2em] text-slate-900">{pairing.code}</code><p className="mt-2 text-[10px] text-cyan-700">만료: {new Date(pairing.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p></div> : <button type="button" onClick={() => void createPairingCode()} disabled={pairingBusy} className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-xs font-bold text-white disabled:opacity-50">{pairingBusy ? '연결 코드 생성 중…' : '휴대폰 연결 코드 만들기'}</button>}
          {pairing && <button type="button" onClick={() => void createPairingCode()} disabled={pairingBusy} className="w-full rounded-xl border border-cyan-200 bg-white px-4 py-2.5 text-xs font-bold text-cyan-700 disabled:opacity-50">새 코드 만들기</button>}
        </div>
      )}

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 프로필 수정 폼 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 sm:space-y-6">
        <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
          <User className="w-4 h-4 text-brand-600" />
          <span>프로필 설정</span>
        </h3>

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
            className="w-full py-3.5 sm:py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs sm:text-sm shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition active:scale-95"
          >
            <Save className="w-4 h-4" />
            <span>프로필 저장하기</span>
          </button>
        </form>
      </div>

      {/* 데이터 전체 백업 및 복원 카드 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Database className="w-4 h-4 text-brand-600" />
          <span>전체 데이터 백업 & 기기 간 복원</span>
        </h3>
        <p className="text-[11px] sm:text-xs text-slate-500">
          현재까지 누적된 모든 판매 내역, 캡처 이미지, 단어 규칙, 음성 학습 데이터를 안전하게 JSON 파일로 백업하거나 다른 컴퓨터/스마트폰으로 이전할 수 있습니다.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-1">
          <button
            onClick={handleExportBackup}
            className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left space-y-1 transition group active:scale-95"
          >
            <div className="flex items-center space-x-2 text-brand-600 font-bold text-xs">
              <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
              <span>전체 데이터 백업 파일 생성</span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-500">모든 판매 기록과 설정을 `.json` 파일로 내보냅니다.</p>
          </button>

          <label className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left space-y-1 transition cursor-pointer group block active:scale-95">
            <div className="flex items-center space-x-2 text-purple-600 font-bold text-xs">
              <Upload className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
              <span>백업 파일 불러오기 및 복원</span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-500">이전에 저장한 백업 `.json` 파일을 업로드하여 복원합니다.</p>
            <input
              type="file"
              accept=".json"
              onChange={handleImportBackup}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* 회원 탈퇴 */}
      <div className="p-4 sm:p-6 rounded-3xl bg-white border border-slate-200 flex justify-between items-center text-[11px] sm:text-xs shadow-sm">
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
  );
};
