import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import { useCommentCapture, getCommentStatusBadge } from '../../context/CommentCaptureContext';
import { useSales } from '../../context/SalesContext';
import { AudioVisualizer } from '../../components/common/AudioVisualizer';
import { screenCaptureService } from '../../services/screenCaptureService';
import { storageService } from '../../services/storageService';
import {
  Radio,
  Square,
  Play,
  Volume2,
  Camera,
  CheckCircle2,
  Clock,
  ArrowRight,
  Edit3,
  Sparkles,
  Key,
  X,
  MessageSquareText,
  VolumeX,
  Cpu
} from 'lucide-react';
import { LocalSttModel, SttMode } from '../../types/stt';

const SILENCE_WARNING_DELAY_MS = 5 * 60 * 1000;
const SILENCE_STOP_COUNTDOWN_SECONDS = 20;

export const LiveHomePage: React.FC = () => {
  const {
    isListening,
    currentSessionId,
    audioLevel,
    waveform,
    currentInterimTranscript,
    liveTranscriptFlow,
    lastMatchedRuleItem,
    transcriptLogs,
    recentCaptures,
    isVoiceEditing,
    editingFieldInfo,
    deepgramApiKey,
    setDeepgramApiKey,
    sonioxApiKey,
    setSonioxApiKey,
    sttProvider,
    sttMode,
    setSttMode,
    localSttModel,
    setLocalSttModel,
    localSttStatus,
    sttEngineStatus,
    sttEngineMessage,
    hasScreenShareAudio,
    startListening,
    stopListening,
    injectTestMent,
    captureCurrentScreen
  } = useLive();

  const { user } = useAuth();
  const isAdmin = user?.role === '관리자';
  const {
    isActive: isCommentCaptureActive,
    isRunning: isCommentCaptureRunning,
    serverStatus: commentServerStatus,
    serverMessage: commentServerMessage,
    newCount: commentNewCount,
    liveComments,
    startCapture: startCommentCapture,
    stopCapture: stopCommentCapture,
    config: commentConfig
  } = useCommentCapture();

  const { sales } = useSales();
  const navigate = useNavigate();
  const [selectedCaptureModal, setSelectedCaptureModal] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [showAdminOnlyModal, setShowAdminOnlyModal] = useState<boolean>(false);
  const [showAreaNotSetModal, setShowAreaNotSetModal] = useState<boolean>(false);
  const [isCapturingNow, setIsCapturingNow] = useState<boolean>(false);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const selectedSttApiKey = sttProvider === 'SONIOX' ? sonioxApiKey : deepgramApiKey;
  const selectedSttName = sttProvider === 'SONIOX' ? 'Soniox v5' : 'Deepgram Nova-3';
  const [keyInput, setKeyInput] = useState<string>(selectedSttApiKey || '');
  const [audioSourceMode, setAudioSourceMode] = useState<'TAB_AUDIO' | 'MIC'>('TAB_AUDIO');
  const flowContainerRef = React.useRef<HTMLDivElement | null>(null);
  const commentFeedRef = React.useRef<HTMLDivElement | null>(null);
  const silenceWarningTimerRef = React.useRef<number | null>(null);

  const latestCaptionId = liveTranscriptFlow[liveTranscriptFlow.length - 1]?.id
    || transcriptLogs[0]?.id
    || '';

  // 청취 시작 또는 마지막 자막 생성 후 5분 동안 새 자막이 없으면 자동 중지 경고를 연다.
  React.useEffect(() => {
    if (silenceWarningTimerRef.current !== null) {
      window.clearTimeout(silenceWarningTimerRef.current);
      silenceWarningTimerRef.current = null;
    }

    setSilenceCountdown(null);
    if (!isListening) return;

    silenceWarningTimerRef.current = window.setTimeout(() => {
      setSilenceCountdown(SILENCE_STOP_COUNTDOWN_SECONDS);
      silenceWarningTimerRef.current = null;
    }, SILENCE_WARNING_DELAY_MS);

    return () => {
      if (silenceWarningTimerRef.current !== null) {
        window.clearTimeout(silenceWarningTimerRef.current);
        silenceWarningTimerRef.current = null;
      }
    };
  }, [isListening, latestCaptionId, currentInterimTranscript]);

  // 경고 후에도 20초 동안 자막이 없으면 경고창을 닫고 청취와 댓글 캡처를 함께 중지한다.
  React.useEffect(() => {
    if (silenceCountdown === null) return;

    if (!isListening) {
      setSilenceCountdown(null);
      return;
    }

    if (silenceCountdown <= 0) {
      setSilenceCountdown(null);
      stopListening();
      stopCommentCapture();
      return;
    }

    const countdownTimer = window.setTimeout(() => {
      setSilenceCountdown((seconds) => seconds === null ? null : seconds - 1);
    }, 1000);

    return () => window.clearTimeout(countdownTimer);
  }, [isListening, silenceCountdown, stopCommentCapture, stopListening]);

  React.useEffect(() => {
    if (flowContainerRef.current) {
      flowContainerRef.current.scrollTop = flowContainerRef.current.scrollHeight;
    }
  }, [liveTranscriptFlow, currentInterimTranscript]);

  // 댓글 피드: 아래쪽이 최신글이 되도록 새 댓글이 오면 자동 스크롤한다.
  React.useEffect(() => {
    if (commentFeedRef.current) {
      commentFeedRef.current.scrollTop = commentFeedRef.current.scrollHeight;
    }
  }, [liveComments]);

  const currentSessionSales = sales.filter((s) => s.sessionId === currentSessionId);
  const todayTotalAmount = currentSessionSales
    .filter((s) => s.status !== '보류')
    .reduce((sum, item) => sum + item.amount, 0);

  const handleToggleListening = () => {
    if (isListening) {
      stopListening();
      stopCommentCapture();
    } else {
      startListening(audioSourceMode);
    }
  };

  // 즉시 캡처: 저장된 캡처 영역으로 바로 캡처한다.
  // 영역이 설정되지 않았으면 안내창을 띄우고 캡처 영역 & 단어 규칙 페이지로 안내한다.
  const handleInstantCapture = async () => {
    if (!storageService.getCaptureAreaConfig()) {
      setShowAreaNotSetModal(true);
      return;
    }

    setIsCapturingNow(true);
    try {
      if (!screenCaptureService.getActiveStream()) {
        const stream = await screenCaptureService.getOrCreateStream(false);
        if (!stream) return;
      }
      await captureCurrentScreen();
    } finally {
      setIsCapturingNow(false);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 상단 헤더 & 제어 바 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-md transition-all flex-shrink-0 ${
            isListening
              ? 'bg-rose-500 text-white shadow-rose-500/20 animate-pulse'
              : 'bg-slate-100 text-slate-500'
          }`}>
            <Radio className={`w-6 h-6 sm:w-8 sm:h-8 ${isListening ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-1">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">라이브 청취 홈</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs font-bold ${
                isListening ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-100 text-slate-600'
              }`}>
                {isListening ? 'ON AIR' : '대기 중'}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span>회차: <strong className="text-slate-900 font-mono">{currentSessionId}</strong></span>
              <span>•</span>
              <span className="flex items-center space-x-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  sttEngineStatus === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' :
                  sttEngineStatus === 'CONNECTING' ? 'bg-amber-500 animate-spin' :
                  sttEngineStatus === 'ERROR' ? 'bg-rose-500' : 'bg-slate-400'
                }`}></span>
                <span className="font-medium text-slate-700">{sttEngineMessage}</span>
              </span>
            </p>
          </div>
        </div>

        {/* 오디오 소스 선택 및 제어 버튼 (모바일 뷰 친화적 그리드) */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
          {/* 음성인식 방식 선택 (클라우드 vs 내 PC 무료) */}
          <div className="grid grid-cols-2 sm:flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 text-xs">
            <button
              onClick={() => setSttMode('CLOUD')}
              disabled={isListening}
              className={`px-3 py-2 sm:py-1.5 rounded-xl font-bold transition flex items-center justify-center space-x-1.5 ${
                sttMode === 'CLOUD'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Deepgram Nova-3 또는 Soniox v5 클라우드 API (API 키 필요)"
            >
              <span>☁️ 클라우드 STT</span>
            </button>
            <button
              onClick={() => setSttMode('LOCAL')}
              disabled={isListening}
              className={`px-3 py-2 sm:py-1.5 rounded-xl font-bold transition flex items-center justify-center space-x-1.5 ${
                sttMode === 'LOCAL'
                  ? 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-500/20'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="내 PC faster-whisper 오프라인 STT (무료, API 키 불필요)"
            >
              <span className="flex items-center space-x-1">
                <span>💻 내 PC 무료 STT</span>
                <span className="px-1 py-0.2 text-[9px] bg-brand-100 text-brand-700 font-black rounded">무료</span>
              </span>
            </button>
          </div>

          {/* 로컬 STT 전용 모델 선택 및 상태 표시 */}
          {sttMode === 'LOCAL' && (
            <div className="flex items-center space-x-1.5 bg-brand-50/70 border border-brand-200/70 px-2.5 py-1.5 rounded-2xl text-xs">
              <Cpu className="w-3.5 h-3.5 text-brand-600 shrink-0" />
              <span className="font-bold text-brand-900 shrink-0">모델:</span>
              <select
                value={localSttModel}
                disabled={isListening}
                onChange={(e) => setLocalSttModel(e.target.value as LocalSttModel)}
                className="bg-white border border-brand-300 text-brand-900 font-bold rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
              >
                <option value="base">base (가장 가벼움 · 기본)</option>
                <option value="small">small (보통 속도)</option>
                <option value="large-v3-turbo">large-v3-turbo (고성능 PC 권장)</option>
              </select>
              <span
                className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded shrink-0 ${
                  localSttStatus.state === 'READY' || localSttStatus.state === 'LISTENING'
                    ? 'bg-emerald-100 text-emerald-700'
                    : localSttStatus.state === 'LOADING'
                    ? 'bg-amber-100 text-amber-700 animate-pulse'
                    : 'bg-rose-100 text-rose-700'
                }`}
                title={localSttStatus.error || localSttStatus.message}
              >
                {localSttStatus.state === 'READY'
                  ? (localSttStatus.model !== localSttModel
                      ? `전환 중 (${localSttStatus.model} ➡️ ${localSttModel})`
                      : `준비됨 (${localSttStatus.model})`)
                  : localSttStatus.state === 'LISTENING'
                  ? (localSttStatus.model !== localSttModel
                      ? `청취 중 (${localSttStatus.model} ➡️ ${localSttModel})`
                      : `청취 중 (${localSttStatus.model})`)
                  : localSttStatus.state === 'LOADING'
                  ? `로딩 중 (${localSttModel})...`
                  : localSttStatus.state === 'ERROR'
                  ? `오류 (${localSttStatus.error?.slice(0, 15) || '실패'})`
                  : localSttStatus.state === 'HELPER_OFFLINE'
                  ? '도우미 미실행'
                  : '대기'}
              </span>
            </div>
          )}

          {/* 소리 입력 소스 선택 셀렉터 */}
          <div className="grid grid-cols-2 sm:flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 text-xs">
            <button
              onClick={() => setAudioSourceMode('TAB_AUDIO')}
              disabled={isListening}
              className={`px-3 py-2 sm:py-1.5 rounded-xl font-bold transition flex items-center justify-center space-x-1.5 ${
                audioSourceMode === 'TAB_AUDIO'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>📺 방송 탭 소리</span>
            </button>
            <button
              onClick={() => setAudioSourceMode('MIC')}
              disabled={isListening}
              className={`px-3 py-2 sm:py-1.5 rounded-xl font-bold transition flex items-center justify-center space-x-1.5 ${
                audioSourceMode === 'MIC'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>🎙️ 내 마이크</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-2 sm:gap-3">
            {sttMode === 'CLOUD' ? (
              <button
                onClick={() => {
                  if (isAdmin) {
                    setKeyInput(selectedSttApiKey || '');
                    setShowKeyModal(true);
                  } else {
                    setShowAdminOnlyModal(true);
                  }
                }}
                className={`px-3 py-2.5 sm:px-3.5 sm:py-3 rounded-xl text-xs font-bold border flex items-center justify-center space-x-1.5 transition ${
                  isAdmin
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 cursor-pointer'
                    : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-80'
                }`}
                title={isAdmin ? `${selectedSttName} AI Key 설정 (관리자 전용)` : 'AI 키 설정은 관리자만 변경할 수 있습니다'}
              >
                <Key className={`w-3.5 h-3.5 ${isAdmin ? 'text-amber-500' : 'text-slate-400'}`} />
                <span>{sttProvider === 'SONIOX' ? 'Soniox' : 'Deepgram'} 키 {selectedSttApiKey ? '연결됨' : '설정'}</span>
                {!isAdmin && <span className="text-[9px] text-slate-400 bg-slate-200/60 px-1 py-0.2 rounded">관리자</span>}
              </button>
            ) : (
              <div
                className="px-3 py-2.5 sm:px-3.5 sm:py-3 rounded-xl text-xs font-bold border border-emerald-200 bg-emerald-50/80 text-emerald-800 flex items-center justify-center space-x-1.5 select-none"
                title="내 PC 무료 STT는 API 사용료가 없는 완전 무료 오프라인 모드입니다."
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>무료 모드 (키 불필요)</span>
              </div>
            )}

            <button
              onClick={handleInstantCapture}
              disabled={isCapturingNow}
              className="px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 text-xs font-bold border border-cyan-200 flex items-center justify-center space-x-1.5 transition shadow-sm disabled:opacity-60"
            >
              <Camera className="w-3.5 h-3.5 text-cyan-600" />
              <span>{isCapturingNow ? '캡처 중...' : '즉시 캡처'}</span>
            </button>

            <label
              className={`px-3 py-2.5 sm:px-3.5 sm:py-3 rounded-xl text-xs font-bold border flex items-center justify-center space-x-2 cursor-pointer transition select-none ${
                isCommentCaptureActive
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
              }`}
              title="라이브 청취 시작 시 로컬 수집 서버가 틱톡 라이브 댓글을 실시간 수집합니다"
            >
              <input
                type="checkbox"
                checked={isCommentCaptureActive}
                onChange={(e) => (e.target.checked ? startCommentCapture() : stopCommentCapture())}
                className="w-4 h-4 accent-rose-600 cursor-pointer"
              />
              <MessageSquareText className={`w-3.5 h-3.5 ${isCommentCaptureRunning ? 'text-rose-500 animate-pulse' : 'text-slate-400'}`} />
              <span>댓글캡처 함께시작</span>
              {commentNewCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black">
                  +{commentNewCount}
                </span>
              )}
            </label>
          </div>

          <button
            onClick={handleToggleListening}
            className={`w-full sm:w-auto px-6 py-3.5 sm:py-3 rounded-xl font-black text-sm shadow-md flex items-center justify-center space-x-2 transition transform active:scale-95 ${
              isListening
                ? 'bg-slate-100 hover:bg-slate-200 text-rose-600 border border-rose-200'
                : 'bg-gradient-to-r from-brand-600 via-brand-500 to-rose-500 text-white shadow-brand-500/20'
            }`}
          >
            {isListening ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>청취 중지하기</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {audioSourceMode === 'TAB_AUDIO' && hasScreenShareAudio
                    ? '연결된 방송 탭으로 청취 시작'
                    : '라이브 청취 시작'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 방송 소리 청취 안내 배너 */}
      {isListening && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm animate-in fade-in">
          <div className="flex items-center space-x-2.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping flex-shrink-0"></span>
            <div>
              <span className="text-xs sm:text-sm font-black text-emerald-950 block">
                {audioSourceMode === 'TAB_AUDIO' ? '📺 라이브 방송 탭 소리를 실시간 분석 중입니다!' : '🎙️ 실제 마이크 음성을 실시간 청취 중입니다!'}
              </span>
              <p className="text-[11px] sm:text-xs text-emerald-700 font-normal mt-0.5">
                {audioSourceMode === 'TAB_AUDIO'
                  ? '방송에서 나오는 "구매확정 닉네임 금액" 소리를 AI가 실시간으로 포착하여 판매 내역에 자동 등록합니다.'
                  : '마이크에 대고 "구매확정 러블리샵 삼만 오천원"이라고 말씀하시면 판매 내역에 등록됩니다.'}
              </p>
            </div>
          </div>
          <div className="px-2.5 py-1 bg-white rounded-xl border border-emerald-200 text-emerald-800 text-[10px] sm:text-[11px] font-bold shadow-sm whitespace-nowrap self-end sm:self-center">
            ⚡ {audioSourceMode === 'TAB_AUDIO' ? '방송 탭 AI 분석 중' : '실시간 마이크 STT 가동 중'}
          </div>
        </div>
      )}

      {/* 음성 수정 명령 배너 */}
      {isVoiceEditing && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-900 text-xs font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 animate-pulse shadow-sm">
          <div className="flex items-center space-x-3">
            <Edit3 className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <span className="text-xs sm:text-sm font-black block">🎙️ 방송 중 음성 수정 모드 작동 중!</span>
              <p className="text-[11px] sm:text-xs text-amber-800 font-normal mt-0.5">{editingFieldInfo}</p>
            </div>
          </div>
          <span className="text-[10px] sm:text-[11px] bg-amber-500 text-white px-2.5 py-1 rounded-lg font-bold whitespace-nowrap">
            "수정 완료"를 말씀하세요
          </span>
        </div>
      )}

      {/* 메인 2열 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* 좌측 영역 (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4 sm:gap-6">
          {/* 오디오 파형 & 실시간 자막 */}
          <div className="order-1 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Volume2 className="w-4 h-4 text-brand-600" />
                <span>실시간 오디오 스트림 & 파형 분석</span>
              </h3>
              <div className="text-[11px] sm:text-xs text-slate-500 font-mono">
                레벨: <span className="text-brand-600 font-bold">{audioLevel}%</span>
              </div>
            </div>

            <AudioVisualizer waveform={waveform} audioLevel={audioLevel} isActive={isListening} />

            {/* 실시간 STT 변환 자막 박스 (상/하단 2단 분할 - 밝은색 화이트 테마) */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              {/* [상단] 실시간 전체 인식 자막 스트림 (밝은색 배경) */}
              <div className="p-3.5 sm:p-4 bg-slate-50/60 border-b border-slate-200">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                  <div className="text-[11px] font-bold text-brand-700 uppercase tracking-wider flex items-center">
                    <span className={`w-2 h-2 rounded-full mr-1.5 ${isListening ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`}></span>
                    <span>1. 실시간 전체 자막 스트림</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => injectTestMent('구매확정! 닉네임 러블리샵님 금액 35,000원입니다.')}
                      className="px-2 py-0.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[10px] border border-emerald-200 transition"
                      title="실제 발화 멘트 주입 테스트"
                    >
                      ⚡ 3.5만 구매확정
                    </button>
                    <button
                      onClick={() => injectTestMent('화면 캡처하세요.')}
                      className="px-2 py-0.5 rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-700 font-bold text-[10px] border border-cyan-200 transition"
                      title="캡처 명령 테스트 ('캡처하세요')"
                    >
                      📸 캡처하세요
                    </button>
                  </div>
                </div>

                <div
                  ref={flowContainerRef}
                  className="max-h-[120px] sm:max-h-[140px] min-h-[60px] overflow-y-auto space-y-1.5 pr-1 font-sans text-xs text-slate-800 flex flex-col justify-end scroll-smooth"
                >
                  {liveTranscriptFlow.length === 0 && !currentInterimTranscript ? (
                    <div className="text-slate-400 text-xs italic py-2">
                      {isListening ? '마이크로 말씀하시는 모든 발화가 실시간으로 흘러갑니다...' : '상단의 [라이브 청취 시작]을 누르면 실시간 자막이 표시됩니다.'}
                    </div>
                  ) : (
                    <>
                      {liveTranscriptFlow.slice(-6).map((flow) => (
                        <div key={flow.id} className="leading-relaxed flex items-baseline space-x-2 text-slate-700 font-medium">
                          <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{flow.timestamp}</span>
                          <span className="break-words">{flow.text}</span>
                        </div>
                      ))}
                      {currentInterimTranscript && (
                        <div className="leading-relaxed flex items-baseline space-x-2 text-brand-600 font-bold animate-pulse">
                          <span className="text-[10px] text-brand-400 font-mono flex-shrink-0">듣는 중...</span>
                          <span className="break-words">{currentInterimTranscript}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* [하단] 규칙 지정된 문장 & 액션 하이라이트 박스 (밝은색 배경) */}
              <div className="p-3.5 sm:p-4 bg-amber-50/40 border-t border-amber-100">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>2. 규칙 감지 핵심 발화 & 액션</span>
                  </div>
                  {lastMatchedRuleItem && (
                    <span className="text-[10px] text-slate-400 font-mono">{lastMatchedRuleItem.timestamp}</span>
                  )}
                </div>

                {lastMatchedRuleItem ? (
                  <div className="p-3 rounded-xl bg-white border border-amber-200 shadow-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                        {lastMatchedRuleItem.matchedKeywords.map((kw, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold text-[10px] border border-amber-300">
                            #{kw}
                          </span>
                        ))}
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[10px] font-bold">
                        {lastMatchedRuleItem.action}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm font-black text-slate-900 tracking-tight leading-snug break-words">
                      "{lastMatchedRuleItem.text}"
                    </p>
                  </div>
                ) : (
                  <div className="py-2.5 px-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-400 italic">
                    "구매확정, 금액, 닉네임, 캡처, 수정" 등 규칙 지정 단어가 포함된 문장이 감지되면 이곳에 하이라이트됩니다.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 최근 전사 로그 */}
          <div className="order-3 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Clock className="w-4 h-4 text-brand-600" />
                <span>최근 실시간 전사 로그 ({transcriptLogs.length}건)</span>
              </h3>
              <span className="text-[10px] sm:text-[11px] text-slate-400">자동 스크롤</span>
            </div>

            <div className="space-y-2 max-h-[250px] sm:max-h-[300px] overflow-y-auto pr-1">
              {transcriptLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  아직 전사된 발화 로그가 없습니다.
                </div>
              ) : (
                transcriptLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-2xl border text-xs transition ${
                      log.actionTriggered === 'SALE_SAVED'
                        ? 'bg-brand-50 border-brand-200 text-brand-900'
                        : log.actionTriggered === 'SCREEN_CAPTURED'
                        ? 'bg-cyan-50 border-cyan-200 text-cyan-900'
                        : log.actionTriggered === 'VOICE_EDIT_START' || log.actionTriggered === 'VOICE_EDIT_DONE'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
                      {log.actionTriggered === 'SALE_SAVED' && (
                        <span className="text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">
                          🛍️ 판매 자동 저장
                        </span>
                      )}
                      {log.actionTriggered === 'SCREEN_CAPTURED' && (
                        <span className="text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                          📸 댓글창 캡처
                        </span>
                      )}
                      {log.actionTriggered === 'VOICE_EDIT_START' && (
                        <span className="text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          ✏️ 수정 모드 진입
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-slate-900 break-words">{log.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 실시간 댓글 캡처 피드 (아래쪽이 최신글) */}
          <div className="order-2 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2 flex-wrap gap-y-1">
                <MessageSquareText className={`w-4 h-4 ${isCommentCaptureRunning ? 'text-rose-500 animate-pulse' : 'text-cyan-600'}`} />
                <span>실시간 댓글 캡처 ({liveComments.length}건)</span>
                {!isCommentCaptureActive ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                    함께시작 꺼짐
                  </span>
                ) : (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      getCommentStatusBadge(commentServerStatus).tone === 'ok'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : getCommentStatusBadge(commentServerStatus).tone === 'warn'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : getCommentStatusBadge(commentServerStatus).tone === 'bad'
                        ? 'bg-rose-50 text-rose-600 border-rose-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {getCommentStatusBadge(commentServerStatus).label}
                  </span>
                )}
              </h3>
              <Link to="/comments" className="text-xs text-brand-600 hover:underline font-bold flex items-center">
                <span>전체 기록</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </div>

            {isCommentCaptureActive && (commentServerStatus === 'DISCONNECTED' || commentServerStatus === 'ERROR') && (
              <p className="mb-3 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
                ⚠️ {commentServerMessage || 'VoiceCAP 댓글 도우미가 실행 중인지 확인하세요.'}
              </p>
            )}

            <div ref={commentFeedRef} className="max-h-[220px] min-h-[60px] overflow-y-auto space-y-1.5 pr-1">
              {liveComments.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                  {isCommentCaptureRunning
                    ? `@${commentConfig.tiktokUsername || '?'} 라이브 댓글을 실시간 수집 중입니다...`
                    : '"댓글캡처 함께시작" 체크 후 라이브 청취를 시작하면 틱톡 댓글이 실시간 표시됩니다.'}
                </div>
              ) : (
                liveComments.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-baseline space-x-2 p-2 rounded-xl border text-xs ${
                      c.matchedAlertWord
                        ? 'bg-rose-50/70 border-rose-200'
                        : 'bg-slate-50/70 border-slate-200'
                    }`}
                  >
                    <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                      {new Date(c.capturedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`font-bold flex-shrink-0 max-w-[110px] truncate ${c.matchedAlertWord ? 'text-rose-700' : 'text-brand-700'}`}>
                      {c.nickname}
                    </span>
                    <span className="text-slate-800 font-medium break-words min-w-0 flex-1">{c.content}</span>
                    {c.matchedAlertWord && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black whitespace-nowrap">
                        {c.matchedAlertWord}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 테스트 멘트 주입 툴바 (모바일 가로 스크롤 지원) */}
          <div className="order-4 bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 text-xs shadow-sm space-y-2">
            <p className="font-bold text-slate-700 flex items-center">
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
              <span>빠른 시연 & 테스트 멘트 주입 버튼</span>
            </p>
            <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar pb-1">
              <button
                onClick={() => injectTestMent('구매확정 됐습니다! 구매하신 분은 러블리님 이시구요 금액은 3만5천원입니다.')}
                className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold whitespace-nowrap active:scale-95 transition"
              >
                + "러블리님 35,000원"
              </button>
              <button
                onClick={() => injectTestMent('구매확정! 닉네임 민트초코님 가격 19,900원입니다. 캡처하세요.')}
                className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold whitespace-nowrap active:scale-95 transition"
              >
                + "민트초코 19,900원 + 캡처하세요"
              </button>
              <button
                onClick={() => injectTestMent('수정 시작')}
                className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                + "수정 시작"
              </button>
              <button
                onClick={() => injectTestMent('닉네임은 달콤한하루님, 금액은 48,000원')}
                className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                + "닉네임/금액 수정"
              </button>
              <button
                onClick={() => injectTestMent('수정 완료')}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                + "수정 완료"
              </button>
            </div>
          </div>
        </div>

        {/* 우측 영역 (5 cols) */}
        <div className="lg:col-span-5 space-y-4 sm:space-y-6">
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-[11px] sm:text-xs text-slate-500 font-medium">이번 회차 판매</span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">
                {currentSessionSales.length} <span className="text-xs font-normal text-slate-400">건</span>
              </div>
            </div>
            <div className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-[11px] sm:text-xs text-slate-500 font-medium">실시간 합계</span>
              <div className="text-xl sm:text-3xl font-black text-brand-600 mt-1 truncate">
                {todayTotalAmount.toLocaleString()} <span className="text-xs font-normal text-slate-400">원</span>
              </div>
            </div>
          </div>

          {/* 판매 내역 카드 리스트 */}
          <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>자동 적재된 판매 내역</span>
              </h3>
              <Link to="/sales/review" className="text-xs text-brand-600 hover:underline font-bold flex items-center">
                <span>일괄 검토</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </div>

            <div className="space-y-2.5 sm:space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {currentSessionSales.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                  이번 방송 회차에서 저장된 판매 내역이 없습니다.<br />
                  "구매확정" 멘트를 말씀하시면 자동 등록됩니다.
                </div>
              ) : (
                currentSessionSales.map((sale) => (
                  <Link
                    key={sale.id}
                    to={`/sales/${sale.id}`}
                    className={`block p-3.5 sm:p-4 rounded-2xl border transition active:scale-[0.99] hover:shadow-sm ${
                      sale.status === '보류'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                        : sale.status === '수동수정'
                        ? 'bg-purple-50/70 border-purple-200 text-slate-800'
                        : 'bg-slate-50/70 border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2 flex-wrap gap-1">
                          <span className="font-bold text-sm text-slate-900 truncate">{sale.buyerNickname}</span>
                          <span className={`text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            sale.status === '보류'
                              ? 'bg-amber-400 text-slate-950'
                              : sale.status === '수동수정'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {sale.status}
                          </span>
                          {sale.note?.startsWith('댓글 닉네임 검증 완료') && (
                            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
                              댓글 닉네임 확인됨
                            </span>
                          )}
                          {sale.note?.startsWith('댓글 닉네임 검증 필요') && (
                            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              댓글 닉네임 확인 필요
                            </span>
                          )}
                          {sale.printStatus === 'QUEUED' && (
                            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-50 text-sky-700 border border-sky-200">
                              전표 출력 중
                            </span>
                          )}
                          {sale.printStatus === 'PRINTED' && (
                            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              전표 출력 완료
                            </span>
                          )}
                          {sale.printStatus === 'FAILED' && (
                            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              전표 출력 실패
                            </span>
                          )}
                        </div>
                        <div className="text-base font-black text-brand-600 mt-1">
                          {sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '금액 미확인'}
                        </div>
                      </div>

                      {sale.captureImageUrls && sale.captureImageUrls.length > 0 && (
                        <div className="w-12 h-12 sm:w-10 sm:h-10 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0 shadow-sm">
                          <img src={sale.captureImageUrls[0]} alt="캡처" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500 mt-2 truncate">
                      "{sale.rawTranscript}"
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* 최근 캡처 이미지 스트립 */}
          {recentCaptures.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 mb-3 flex items-center space-x-2">
                <Camera className="w-4 h-4 text-cyan-600" />
                <span>최근 화면 캡처 ({recentCaptures.length}장)</span>
              </h3>
              <div className="flex space-x-2.5 sm:space-x-3 overflow-x-auto pb-2 no-scrollbar">
                {recentCaptures.map((cap) => (
                  <div
                    key={cap.id}
                    onClick={() => setSelectedCaptureModal(cap.imageUrl)}
                    className="w-20 h-28 flex-shrink-0 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer hover:opacity-85 active:scale-95 transition relative group shadow-sm"
                  >
                    <img src={cap.imageUrl} alt="캡처" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-bold transition">
                      확대
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5분 무자막 지속 시 자동 청취 중지 경고 */}
      {silenceCountdown !== null && isListening && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="silence-warning-title"
        >
          <div className="max-w-sm w-full bg-white p-6 rounded-3xl border border-amber-200 shadow-2xl space-y-5 text-center animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto">
              <VolumeX className="w-7 h-7" />
            </div>
            <div>
              <h3 id="silence-warning-title" className="text-lg font-black text-slate-900">무음 지속 감지</h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                5분 동안 생성된 자막이 없습니다.<br />
                무음이 지속되어 <strong className="text-rose-600">{silenceCountdown}초 뒤</strong> 청취를 중지합니다.
              </p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-1000 ease-linear"
                style={{ width: `${(silenceCountdown / SILENCE_STOP_COUNTDOWN_SECONDS) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              새 자막이 생성되면 경고가 자동으로 해제됩니다.
            </p>
          </div>
        </div>
      )}

      {/* 캡처 이미지 확대 모달 */}
      {selectedCaptureModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in"
          onClick={() => setSelectedCaptureModal(null)}
        >
          <div className="relative max-w-2xl w-full max-h-[85vh] bg-slate-900 rounded-3xl overflow-hidden shadow-2xl flex flex-col p-2">
            <button
              onClick={() => setSelectedCaptureModal(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 z-10 transition"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 flex items-center justify-center overflow-auto">
              <img src={selectedCaptureModal} alt="확대 캡처" className="max-w-full max-h-[75vh] object-contain rounded-2xl" />
            </div>
            <div className="text-center py-2 text-xs text-slate-300">
              화면을 탭하거나 우상단 X 버튼을 눌러 닫습니다.
            </div>
          </div>
        </div>
      )}

      {/* Deepgram API Key 설정 모달 */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-md w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">{selectedSttName} AI 키 설정</h3>
                  <p className="text-xs text-slate-500">실시간 방송 소리 0.1초 AI 분석</p>
                </div>
              </div>
              <button onClick={() => setShowKeyModal(false)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">{sttProvider === 'SONIOX' ? 'Soniox' : 'Deepgram'} API Key</label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={`${sttProvider === 'SONIOX' ? 'Soniox' : 'Deepgram'} 콘솔에서 발급한 API Key`}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:border-brand-500"
              />
              <p className="text-[11px] text-slate-500">
                현재 관리자가 선택한 {selectedSttName}의 API Key를 설정합니다. 기본 STT 서비스 선택은 관리자 통합 대시보드에서 변경할 수 있습니다.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (sttProvider === 'SONIOX') {
                    setSonioxApiKey(keyInput.trim());
                  } else {
                    setDeepgramApiKey(keyInput.trim());
                  }
                  setShowKeyModal(false);
                }}
                className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 전용 기능 안내 팝업 모달 */}
      {showAdminOnlyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-sm w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto">
              <Key className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">관리자 전용 기능</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                STT AI 키 설정 및 수정은 <strong className="text-slate-800">최고 관리자(ADMIN)</strong> 권한으로 로그인한 계정만 접근할 수 있습니다.
              </p>
            </div>
            <button
              onClick={() => setShowAdminOnlyModal(false)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 캡처 영역 미설정 안내창 → 캡처 영역 & 단어 규칙 페이지로 안내 */}
      {showAreaNotSetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-sm w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 text-cyan-600 border border-cyan-200 flex items-center justify-center mx-auto">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">캡처 영역이 설정되지 않았습니다</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                먼저 <strong className="text-slate-800">캡처 영역 & 단어 규칙</strong> 페이지에서 화면을 연결하고 캡처할 영역을 지정해 주세요.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowAreaNotSetModal(false);
                  navigate('/recognition-rules');
                }}
                className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-brand-500/20"
              >
                캡처 영역 설정하러 이동
              </button>
              <button
                onClick={() => setShowAreaNotSetModal(false)}
                className="w-full py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                나중에 하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
