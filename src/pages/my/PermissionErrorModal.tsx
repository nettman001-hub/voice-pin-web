import React from 'react';
import { MicOff, AlertTriangle, RefreshCw, X, ShieldAlert } from 'lucide-react';

interface PermissionErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  errorMessage?: string;
}

export const PermissionErrorModal: React.FC<PermissionErrorModalProps> = ({
  isOpen,
  onClose,
  onRetry,
  errorMessage = '마이크 또는 시스템 오디오 캡처 권한이 차단되었습니다.'
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
          <MicOff className="w-8 h-8" />
        </div>

        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">오디오 캡처 권한 필요</h3>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            {errorMessage}<br />
            브라우저 주소창 좌측의 <strong>자물쇠 아이콘</strong>을 클릭하여 <strong>마이크 및 화면 공유 권한</strong>을 허용해 주세요.
          </p>
        </div>

        <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-left text-xs text-slate-300 space-y-1.5">
          <div className="flex items-center space-x-2 font-bold text-slate-200">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>해결 방법:</span>
          </div>
          <p>1. 브라우저 주소창 좌측 자물쇠 아이콘 클릭</p>
          <p>2. '마이크' 권한을 [허용]으로 변경</p>
          <p>3. '시스템 오디오 공유' 체크 후 재시도</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="w-1/3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
          >
            닫기
          </button>
          <button
            onClick={onRetry}
            className="w-2/3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md flex items-center justify-center space-x-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span>권한 재요청 및 다시 시도</span>
          </button>
        </div>
      </div>
    </div>
  );
};
