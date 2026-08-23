import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Mic, Camera, RefreshCw, X } from 'lucide-react';

interface PermissionErrorModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onRetry?: () => void;
}

export const PermissionErrorModal: React.FC<PermissionErrorModalProps> = ({
  isOpen = true,
  onClose,
  onRetry
}) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleRetry = () => {
    if (onRetry) onRetry();
    navigate('/live');
  };

  const handleClose = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-8 shadow-2xl text-center space-y-6 animate-in zoom-in-95 relative">
        <button
          onClick={handleClose}
          className="absolute right-5 top-5 p-1 rounded-xl text-slate-400 hover:text-slate-700"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
          <AlertTriangle className="w-8 h-8" />
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-900">오디오 / 화면 권한 필요 안내</h2>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            다들려 서비스를 이용하기 위해서는 브라우저의 <strong className="text-slate-800">마이크 및 화면 공유 권한</strong> 허용이 반드시 필요합니다.
          </p>
        </div>

        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left space-y-2 text-xs text-slate-600">
          <div className="flex items-start space-x-2">
            <Mic className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
            <span>브라우저 주소창 좌측의 <strong>자물쇠 아이콘</strong>을 클릭하세요.</span>
          </div>
          <div className="flex items-start space-x-2">
            <Camera className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-0.5" />
            <span>마이크 및 화면 공유 권한을 <strong>'허용'</strong>으로 변경해 주세요.</span>
          </div>
        </div>

        <button
          onClick={handleRetry}
          className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition"
        >
          <RefreshCw className="w-4 h-4" />
          <span>권한 재시도 및 라이브로 이동</span>
        </button>
      </div>
    </div>
  );
};
