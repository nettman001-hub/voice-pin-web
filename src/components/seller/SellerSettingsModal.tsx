import React from 'react';
import {
  X,
  Sparkles,
  Play,
  Square,
  Settings,
  MonitorSpeaker,
  Mic,
  Cpu,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { Link } from 'react-router-dom';

export interface SellerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDemoActive: boolean;
  demoElapsedSeconds: number;
  onToggleDemo: () => void;
  audioSourceMode: 'TAB_AUDIO' | 'MIC';
  onChangeAudioSourceMode?: (mode: 'TAB_AUDIO' | 'MIC') => void;
  sttProvider: string;
  sttMode: string;
  onChangeSttMode?: (mode: 'CLOUD' | 'LOCAL') => void;
  isListening?: boolean;
  canUseCloudStt?: boolean;
  localSttModel?: string;
  localSttMessage?: string;
}

export const SellerSettingsModal: React.FC<SellerSettingsModalProps> = ({
  isOpen,
  onClose,
  isDemoActive,
  demoElapsedSeconds,
  onToggleDemo,
  audioSourceMode,
  onChangeAudioSourceMode,
  sttProvider,
  sttMode,
  onChangeSttMode,
  isListening = false,
  canUseCloudStt = false,
  localSttModel = 'base',
  localSttMessage
}) => {
  if (!isOpen) return null;

  const formatSeconds = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="seller-settings-modal-title"
    >
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center border border-brand-200/60">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 id="seller-settings-modal-title" className="text-base font-black text-slate-900">
                판매자 설정
              </h2>
              <p className="text-[11px] text-slate-500">
                실제 판매 데모보기 및 방송 환경 설정을 관리합니다
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200/70 text-slate-400 hover:text-slate-600 transition"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모달 본문 스크롤 영역 */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* 핵심: 실제 판매 데모보기 카드 */}
          <div className="rounded-2xl border-2 border-purple-200 bg-gradient-to-br from-purple-50/80 via-indigo-50/50 to-white p-4 sm:p-5 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm shadow-purple-500/30">
                  <Sparkles className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-black text-slate-900">
                      실제 판매하는 것처럼 데모보기
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold border border-purple-200">
                      체험 시연
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    실제 방송 없이도 <strong>실시간 오디오 파형, 틱톡 댓글 유입, AI 호스트 음성 전사, 주문 자동 적재 및 실시간 음성 정정</strong> 시나리오를 라이브 화면에서 그대로 체험합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* 시나리오 하이라이트 안내 */}
            <div className="mt-3.5 grid grid-cols-2 gap-2 text-[11px] bg-white/80 p-3 rounded-xl border border-purple-100">
              <div className="flex items-center space-x-1.5 text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>실시간 방송 오디오 파형</span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>틱톡 라이브 댓글 실시간 수집</span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>주문 즉시 DB 자동 저장 & 전표</span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span>"아니고, 변경" 음성 정정 시연</span>
              </div>
            </div>

            {/* 데모 제어 버튼 */}
            <div className="mt-4 pt-1">
              <button
                type="button"
                onClick={() => {
                  onToggleDemo();
                }}
                className={`w-full py-3 px-4 rounded-xl font-black text-xs transition active:scale-[0.99] flex items-center justify-center gap-2 shadow-sm ${
                  isDemoActive
                    ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                    : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-brand-600 hover:brightness-110 text-white shadow-purple-600/20'
                }`}
              >
                {isDemoActive ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>실제 판매 데모 중지 ({formatSeconds(demoElapsedSeconds)})</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>🎬 실제 판매 데모 시작</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 방송 음성 입력 방식 설정 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 flex items-center space-x-2">
                <MonitorSpeaker className="w-4 h-4 text-brand-600" />
                <span>라이브 방송 음성 입력 방식</span>
              </h4>
              <span className="text-[10px] text-slate-400">
                현재: {audioSourceMode === 'TAB_AUDIO' ? '방송 탭 소리' : '마이크'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeAudioSourceMode?.('TAB_AUDIO')}
                className={`p-2.5 rounded-xl border text-left transition flex items-center space-x-2 ${
                  audioSourceMode === 'TAB_AUDIO'
                    ? 'border-brand-500 bg-brand-50/70 text-brand-900 ring-1 ring-brand-500/30'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <MonitorSpeaker className={`w-4 h-4 flex-shrink-0 ${audioSourceMode === 'TAB_AUDIO' ? 'text-brand-600' : 'text-slate-400'}`} />
                <div>
                  <span className="block text-xs font-bold">방송 탭 소리</span>
                  <span className="block text-[10px] text-slate-500">PC 브라우저 탭 오디오</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeAudioSourceMode?.('MIC')}
                className={`p-2.5 rounded-xl border text-left transition flex items-center space-x-2 ${
                  audioSourceMode === 'MIC'
                    ? 'border-brand-500 bg-brand-50/70 text-brand-900 ring-1 ring-brand-500/30'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Mic className={`w-4 h-4 flex-shrink-0 ${audioSourceMode === 'MIC' ? 'text-brand-600' : 'text-slate-400'}`} />
                <div>
                  <span className="block text-xs font-bold">실제 마이크</span>
                  <span className="block text-[10px] text-slate-500">직접 육성 발화 청취</span>
                </div>
              </button>
            </div>
          </div>

          {/* STT 엔진 & AI 상태 안내 */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-emerald-600" />
                <span>STT AI 엔진 정보</span>
              </h4>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {sttMode === 'CLOUD' ? '클라우드 AI' : '내 PC STT'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              현재 선택한 STT 엔진: <strong className="text-slate-700">{sttMode === 'LOCAL' ? `내 PC Whisper (${localSttModel})` : sttProvider === 'SONIOX' ? 'Soniox v5' : 'Deepgram Nova-3'}</strong>
            </p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="음성인식 엔진 선택">
              {(['CLOUD', 'LOCAL'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={sttMode === mode}
                  disabled={isListening || !onChangeSttMode || (mode === 'CLOUD' && !canUseCloudStt)}
                  onClick={() => onChangeSttMode?.(mode)}
                  className={`rounded-xl border p-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${sttMode === mode ? 'border-brand-500 bg-brand-50 text-brand-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {mode === 'CLOUD' ? '클라우드 STT' : '내 PC STT'}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {isListening ? '엔진을 바꾸려면 먼저 청취를 중지해 주세요.' : !canUseCloudStt ? '클라우드 STT는 관리자 이용 승인과 API 키 등록이 필요합니다.' : '선택한 엔진은 다음 청취 시작부터 적용됩니다.'}
            </p>
            {sttMode === 'LOCAL' && <p className="text-[11px] leading-relaxed text-amber-800">
              내 PC 모드에서는 클라우드 STT를 호출하지 않습니다. {localSttMessage || '댓글 도우미의 로컬 STT 엔진이 실행 중이어야 합니다.'}
            </p>}
            <div className="pt-1 flex items-center justify-between text-xs">
              <Link
                to="/my"
                onClick={onClose}
                className="text-brand-600 hover:underline font-bold flex items-center gap-1"
              >
                <span>판매자 설정 & 백업 상세 관리</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>

        {/* 모달 하단 닫기 */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-300 text-slate-700 font-bold text-xs transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
