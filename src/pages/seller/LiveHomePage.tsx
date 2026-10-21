import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { useLive } from '../../context/LiveContext';
import { useCommentCapture, getCommentStatusBadge } from '../../context/CommentCaptureContext';
import { useSales } from '../../context/SalesContext';
import { AudioVisualizer } from '../../components/common/AudioVisualizer';
import { screenCaptureService } from '../../services/screenCaptureService';

import { getPurchaseRequests } from '../../services/purchaseFirstSales';
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
  Download,
  FileSpreadsheet,
  ShoppingBag,
  RefreshCw,
  Bot,
  Settings,
  Cloud,
  ZoomIn
} from 'lucide-react';
import { COMMENT_HELPER_DOWNLOAD_URL } from '../../types/comment';
import { CustomerStatsBadge } from '../../components/sales/CustomerStatsBadge';
import { useProductSales } from '../../context/ProductSalesContext';
import { formatMultiSaleAmount } from '../../services/salesExtractor';
import { getSalePurchaseHistory, isCountedSale } from '../../services/saleRowHistory';
import { SaleAiActionButtons } from '../../components/sales/SaleAiActionButtons';
import { ListeningStopControl, ListeningStopStatus } from '../../components/live/ListeningStopControl';
import { AiSaleBadge } from '../../components/sales/AiSaleBadge';
import { formatSessionDisplay } from '../../utils/sessionFormatter';
import { ImageViewerModal } from '../../components/common/ImageViewerModal';
import { CommentHelperModal } from '../../components/helper/CommentHelperModal';
import { SellerSettingsModal } from '../../components/seller/SellerSettingsModal';
import { salesDemoService } from '../../services/salesDemoService';
import { CommentRecord } from '../../types/comment';
import { SaleRecord, SttTranscriptLog } from '../../types/live';
import { MatchedRuleItem } from '../../context/LiveContext';

import { KeepingBadge } from '../../components/shipping/KeepingBadge';
import { SalesModeSelector } from '../../components/live/SalesModeSelector';
import { TouchDesktopPanel } from '../../components/live/TouchDesktopPanel';
import { useTouchMode } from '../../context/TouchModeContext';
import { VoicePhoneStatusReporter } from '../../components/live/VoicePhoneStatusReporter';

const SILENCE_WARNING_DELAY_MS = 5 * 60 * 1000;
const SILENCE_STOP_COUNTDOWN_SECONDS = 20;

function getBuyerPurchaseIntentWord(
  sale: SaleRecord,
  comments: CommentRecord[] = []
): string | null {
  if (sale.note) {
    const match = String(sale.note).match(/구매 댓글 ["']([^"']+)["']/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  if (sale.sourceCommentIds && sale.sourceCommentIds.length > 0) {
    const matchedComment = comments.find((c) => sale.sourceCommentIds?.includes(c.id));
    if (matchedComment && matchedComment.content) {
      return matchedComment.content.trim();
    }
  }

  const normTarget = sale.buyerNickname ? sale.buyerNickname.trim().toLowerCase().replace(/[\s_.-]+/g, '') : '';
  const buyerComments = comments.filter((c) => {
    if (sale.buyerId && c.buyerId) return c.buyerId === sale.buyerId;
    const cNorm = c.nickname.trim().toLowerCase().replace(/[\s_.-]+/g, '');
    return cNorm === normTarget;
  });
  if (buyerComments.length > 0) {
    const purchasePattern = /(?:구매|주문|살게요|살께요|결제|입금|저요|손|찜|예약|드려요|원)/u;
    const purchaseComment = buyerComments.find((c) => purchasePattern.test(c.content)) || buyerComments[0];
    if (purchaseComment && purchaseComment.content) {
      return purchaseComment.content.trim();
    }
  }

  return null;
}

export const LiveHomePage: React.FC = () => {
  const touchMode = useTouchMode();
  const runtime = useWorkspaceRuntime();
  const { storageService, customerKeepingService } = runtime;
  const {
    isListening,
    currentSessionId,
    audioLevel,
    waveform,
    currentInterimTranscript,
    liveTranscriptFlow,
    lastMatchedRuleItem,
    transcriptLogs,
    totalSessionTranscriptCount,
    downloadSessionTranscripts,
    downloadSttDiagnostics,
    recentCaptures,
    isVoiceEditing,
    editingFieldInfo,
    deepgramApiKey,
    setDeepgramApiKey,
    sonioxApiKey,
    setSonioxApiKey,
    sttProvider,
    sttMode,
    localSttModel,
    localSttStatus,
    sttEngineStatus,
    sttEngineMessage,
    pipelineDiagnostics,
    salesWorkflow,
    workflowProcessingError,
    setSttMode,
    startListening,
    stopListening,
    injectTestMent,
    cloudSyncStatus
  } = useLive();

  const { user, workspaceId } = useAuth();
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

  const { sales, refreshSales } = useSales();
  const { activeSession, activeProduct, loadBootstrap, startNewSession } = useProductSales();
  const [selectedCaptureModal, setSelectedCaptureModal] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [showAdminOnlyModal, setShowAdminOnlyModal] = useState<boolean>(false);
  const [showSellerKeyInfoModal, setShowSellerKeyInfoModal] = useState<boolean>(false);
  const [showNoPermissionModal, setShowNoPermissionModal] = useState<boolean>(false);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const [showHelperModal, setShowHelperModal] = useState<boolean>(false);
  const [showSellerSettingsModal, setShowSellerSettingsModal] = useState<boolean>(false);
  const [showSessionChoice, setShowSessionChoice] = useState(false);
  const [isSessionStarting, setIsSessionStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [diagnosticDownloading, setDiagnosticDownloading] = useState(false);
  const [diagnosticDownloadError, setDiagnosticDownloadError] = useState('');
  const [hasTestStopped, setHasTestStopped] = useState(false);
  const [testMentText, setTestMentText] = useState('');
  const startAttemptRef = React.useRef(0);
  const [isSalesRefreshing, setIsSalesRefreshing] = useState(false);
  const [viewerModal, setViewerModal] = useState<{
    isOpen: boolean;
    images: string[];
    initialIndex: number;
    title: string;
  }>({
    isOpen: false,
    images: [],
    initialIndex: 0,
    title: ''
  });

  // 실제 판매 시연 데모 상태
  const [isDemoActive, setIsDemoActive] = useState<boolean>(false);
  const [demoElapsedSeconds, setDemoElapsedSeconds] = useState<number>(0);
  const [demoWaveform, setDemoWaveform] = useState<Uint8Array>(() => new Uint8Array(128));
  const [demoAudioLevel, setDemoAudioLevel] = useState<number>(0);
  const [demoComments, setDemoComments] = useState<CommentRecord[]>([]);
  const [demoTranscriptLogs, setDemoTranscriptLogs] = useState<SttTranscriptLog[]>([]);
  const [demoInterimTranscript, setDemoInterimTranscript] = useState<string>('');
  const [demoMatchedRuleItem, setDemoMatchedRuleItem] = useState<MatchedRuleItem | null>(null);
  const [demoSales, setDemoSales] = useState<SaleRecord[]>([]);
  const [demoSalesCount, setDemoSalesCount] = useState<number>(0);
  const [demoTotalAmount, setDemoTotalAmount] = useState<number>(0);

  const selectedSttApiKey = sttProvider === 'SONIOX' ? sonioxApiKey : deepgramApiKey;
  const selectedSttName = sttProvider === 'SONIOX' ? 'Soniox v5' : 'Deepgram Nova-3';
  const isAllowedByAdmin = Boolean(user?.allowAdminSttKey);
  const canUseAdminKey = isAdmin || isAllowedByAdmin;
  const hasAdminSttKey = Boolean(selectedSttApiKey);
  const [keyInput, setKeyInput] = useState<string>(selectedSttApiKey || '');
  const [audioSourceMode, setAudioSourceMode] = useState<'TAB_AUDIO' | 'MIC'>(() => runtime.isTest ? 'MIC' : storageService.getAudioSourceMode());
  const handleAudioSourceModeChange = (mode: 'TAB_AUDIO' | 'MIC') => {
    storageService.setAudioSourceMode(mode);
    setAudioSourceMode(mode);
  };
  const commentFeedRef = React.useRef<HTMLDivElement | null>(null);
  const silenceWarningTimerRef = React.useRef<number | null>(null);

  const latestCaptionId = liveTranscriptFlow[liveTranscriptFlow.length - 1]?.id
    || transcriptLogs[0]?.id
    || '';

  // 실제 판매 데모 시작 / 데모 중지 토글
  const handleToggleDemo = () => {
    if (runtime.isTest) return;
    if (isDemoActive) {
      salesDemoService.stop();
      setIsDemoActive(false);
      setDemoElapsedSeconds(0);
      return;
    }

    if (isListening) {
      stopListening();
      stopCommentCapture();
    }

    setIsDemoActive(true);
    setDemoElapsedSeconds(0);
    salesDemoService.start({
      onWaveform: (level, wave) => {
        setDemoAudioLevel(Math.round(level * 100));
        setDemoWaveform(wave);
      },
      onComment: () => {},
      onCommentsBatch: (comments) => setDemoComments(comments),
      onTranscriptInterim: (text) => setDemoInterimTranscript(text),
      onTranscriptFinal: (log) => setDemoTranscriptLogs((prev) => [log, ...prev].slice(0, 300)),
      onTranscriptReset: (logs) => setDemoTranscriptLogs(logs),
      onMatchedRule: (item) => setDemoMatchedRuleItem(item),
      onSalesUpdate: (updatedSales) => setDemoSales(updatedSales),
      onTotalsUpdate: (count, amount) => {
        setDemoSalesCount(count);
        setDemoTotalAmount(amount);
      },
      onStatusChange: (running, seconds) => {
        setIsDemoActive(running);
        setDemoElapsedSeconds(seconds);
      }
    });
  };

  React.useEffect(() => {
    return () => {
      salesDemoService.stop();
    };
  }, []);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('demo=start')) {
      handleToggleDemo();
    }
  }, []);

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

  // 댓글 피드: 아래쪽이 최신글이 되도록 새 댓글이 오면 자동 스크롤한다.
  // 회차를 고른 뒤에는 서버 판매 회차 UUID를 사용하고, 오프라인 호환 시에만 로컬 ID를 보조로 사용한다.
  const currentSessionSales = React.useMemo(() => sales.filter((sale) => (
    sale.aiVerification?.reviewDecision !== 'NOT_SALE' && (sale.sessionId === currentSessionId ||
    (activeSession?.id && sale.sessionId === activeSession.id))
  )), [activeSession?.id, currentSessionId, sales]);
  const sessionSalesScope = JSON.stringify([user?.id, workspaceId, currentSessionId, activeSession?.id]);
  const [stoppedSessionSales, setStoppedSessionSales] = useState<{
    scope: string;
    records: SaleRecord[];
  } | null>(null);
  const wasListeningRef = React.useRef(isListening);

  // 최초 진입에서는 회차·판매의 비동기 복원을 그대로 반영한다.
  // 실제 청취를 중지한 뒤에만 해당 계정·회차의 목록을 고정한다.
  React.useEffect(() => {
    const justStopped = !isListening && wasListeningRef.current;
    setStoppedSessionSales((snapshot) => {
      if (justStopped) return { scope: sessionSalesScope, records: currentSessionSales };
      if (isListening || snapshot?.scope !== sessionSalesScope) return null;
      const records = snapshot.records.map((record) => {
        const latest = currentSessionSales.find((sale) => sale.id === record.id);
        return latest?.aiVerification && latest.aiVerification !== record.aiVerification ? latest : record;
      }).filter((sale) => sale.aiVerification?.reviewDecision !== 'NOT_SALE');
      return records.some((record, index) => record !== snapshot.records[index]) || records.length !== snapshot.records.length
        ? { ...snapshot, records } : snapshot;
    });
    wasListeningRef.current = isListening;
  }, [currentSessionSales, isListening, sessionSalesScope]);
  const displayedSessionSales = !isListening && stoppedSessionSales?.scope === sessionSalesScope
    ? stoppedSessionSales.records
    : currentSessionSales;

  const todayTotalAmount = currentSessionSales
    .filter(isCountedSale)
    .reduce((sum, item) => sum + item.amount, 0);

  const purchaseRequests = React.useMemo(() => {
    const sessionId = activeSession?.id || currentSessionId;
    const persisted = storageService.getPurchaseRequests(workspaceId)
      .filter((item) => item.sessionId === sessionId);
    const derived = getPurchaseRequests(liveComments, sessionId);
    return [...new Map([...derived, ...persisted].map((item) => [item.id, item])).values()]
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)).slice(0, 10);
  }, [activeSession?.id, currentSessionId, liveComments, workspaceId]);

  const effectiveAudioLevel = isDemoActive ? demoAudioLevel : audioLevel;
  const effectiveWaveform = isDemoActive ? demoWaveform : waveform;
  const effectiveComments = isDemoActive ? demoComments : liveComments;
  const effectiveTranscriptLogs = isDemoActive ? demoTranscriptLogs : transcriptLogs;
  const effectiveInterimTranscript = isDemoActive ? demoInterimTranscript : currentInterimTranscript;
  const effectiveMatchedRuleItem = isDemoActive ? demoMatchedRuleItem : lastMatchedRuleItem;
  const effectiveSessionSales = isDemoActive ? demoSales : displayedSessionSales;
  const effectiveSalesCount = isDemoActive ? demoSalesCount : currentSessionSales.filter(isCountedSale).length;
  const effectiveTotalAmount = isDemoActive ? demoTotalAmount : todayTotalAmount;


  // 댓글 피드: 아래쪽이 최신글이 되도록 새 댓글이 오면 자동 스크롤한다.
  React.useEffect(() => {
    if (commentFeedRef.current) {
      commentFeedRef.current.scrollTop = commentFeedRef.current.scrollHeight;
    }
  }, [effectiveComments]);

  const handleToggleListening = () => {
    if (runtime.isTest && isSessionStarting) {
      startAttemptRef.current += 1;
      stopListening();
      setIsSessionStarting(false);
      setStartError('');
      setHasTestStopped(false);
      return;
    }
    if (isListening) {
      stopListening();
      if (!runtime.isTest) stopCommentCapture();
      setStartError('');
      if (runtime.isTest) setHasTestStopped(true);
      return;
    }

    if (sttMode === 'CLOUD') {
      if (!canUseAdminKey) {
        setShowNoPermissionModal(true);
        return;
      }
      if (!hasAdminSttKey) {
        setShowSellerKeyInfoModal(true);
        return;
      }
    }

    if (runtime.isTest) {
      void handleStartWithSession(activeSession?.status === 'ACTIVE' ? 'CONTINUE' : 'NEW');
      return;
    }
    setShowSessionChoice(true);
  };

  const handleStartWithSession = async (choice: 'CONTINUE' | 'NEW') => {
    if (isSessionStarting) return;

    const attempt = ++startAttemptRef.current;
    setStartError('');
    setHasTestStopped(false);
    setIsSessionStarting(true);
    const captureMode = runtime.isTest ? 'MIC' : audioSourceMode;
    try {
      // getDisplayMedia는 버튼 클릭의 사용자 동작 안에서 요청해야 한다.
      // 회차 API와 병렬로 준비해 새 회차 선택 시에도 탭 공유 창이 차단되지 않게 한다.
      const tabAudioReady = captureMode !== 'TAB_AUDIO'
        ? Promise.resolve(true)
        : (() => {
            const activeAudioTrack = screenCaptureService.getActiveAudioTrack();
            if (activeAudioTrack?.readyState === 'live') return Promise.resolve(true);
            const activeScreenStream = screenCaptureService.getActiveStream();
            return screenCaptureService
              .getOrCreateStream(Boolean(activeScreenStream))
              .then((stream) => Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live')));
          })();

      const selectedSession = choice === 'NEW'
        ? startNewSession()
        : (() => loadBootstrap().then((data) => {
            if (!data?.activeSession) {
              throw new Error('이어갈 활성 회차가 없습니다. 새 회차로 시작해 주세요.');
            }
            return data.activeSession;
          }))();

      const [hasTabAudio, session] = await Promise.all([tabAudioReady, selectedSession]);
      if (attempt !== startAttemptRef.current) return;
      if (!hasTabAudio) {
        alert('방송 탭 오디오 공유를 취소했거나 오디오를 선택하지 않았습니다. 다시 시도해 주세요.');
        return;
      }

      setShowSessionChoice(false);
      await startListening(captureMode, session.id);
    } catch (error) {
      if (attempt === startAttemptRef.current) {
        const message = error instanceof Error ? error.message : '청취를 시작하지 못했습니다. 다시 시도해 주세요.';
        if (runtime.isTest) setStartError(message);
        else alert(message);
      }
    } finally {
      if (attempt === startAttemptRef.current) setIsSessionStarting(false);
    }
  };

  const handleRefreshSessionSales = async () => {
    setIsSalesRefreshing(true);
    try {
      const latestSales = await refreshSales();
      setStoppedSessionSales((snapshot) => snapshot?.scope === sessionSalesScope ? {
        scope: sessionSalesScope,
        records: latestSales.filter((sale) => (
          sale.aiVerification?.reviewDecision !== 'NOT_SALE' && (sale.sessionId === currentSessionId
          || (activeSession?.id && sale.sessionId === activeSession.id))
        )),
      } : snapshot);
    } catch (error) {
      alert(error instanceof Error ? error.message : '판매 내역을 새로고침하지 못했습니다.');
    } finally {
      setIsSalesRefreshing(false);
    }
  };

  const testStartFailure = startError || (!isSessionStarting && !isListening && sttEngineStatus === 'ERROR' ? sttEngineMessage : '');

  if (!runtime.isTest && touchMode.settings.mode === 'COMMENT_TOUCH') return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <SalesModeSelector locked={Boolean(touchMode.runningSession) || isListening} />
      <TouchDesktopPanel />
    </div>
  );

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-3 sm:space-y-5">
      {!runtime.isTest && <SalesModeSelector locked={isListening || isSessionStarting} />}
      {!runtime.isTest && <VoicePhoneStatusReporter />}
      {workflowProcessingError&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">판매방식 처리를 재시도하고 있습니다. 원본 전사는 유지됩니다. {workflowProcessingError}</p>}
      {/* 최소 높이 상단 헤더 & 핵심 제어 */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 px-2.5 py-2 sm:px-3 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
            isListening
              ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20 animate-pulse'
              : 'bg-slate-100 text-slate-500'
          }`}>
            <Radio className={`w-4 h-4 ${isListening ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight whitespace-nowrap">{runtime.isTest ? '라이브 청취 홈 테스트' : '라이브 청취 홈'}</h1>
              <span className={`${runtime.isTest ? 'inline-flex' : 'hidden sm:inline-flex'} px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap ${
                isListening ? 'bg-rose-50 text-rose-600 border border-rose-200' : isSessionStarting ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-600'
              }`}>
                {isListening ? 'ON AIR' : isSessionStarting ? '연결 준비 중' : '대기 중'}
              </span>
              {salesWorkflow && <span className="text-[10px] text-brand-700">판매방식 v{salesWorkflow.version} · {salesWorkflow.mode==='SHADOW'?'관찰':'적용'}</span>}
            </div>
            <p className="hidden sm:block text-[10px] leading-none text-slate-400 mt-0.5 truncate">
              회차 <strong className="text-slate-700 font-bold">{formatSessionDisplay(activeSession?.displayCode || currentSessionId)}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 ml-auto">
          {/* 실제 판매 데모보기 버튼 (상단 헤더 직접 노출) */}
          {!runtime.isTest && <button
            type="button"
            onClick={handleToggleDemo}
            className={`h-8 px-2.5 sm:px-3 rounded-lg text-[11px] font-black border flex items-center justify-center gap-1.5 transition active:scale-95 shadow-xs ${
              isDemoActive
                ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-400 animate-pulse'
                : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-brand-600 hover:brightness-110 text-white border-transparent shadow-purple-500/20'
            }`}
            title="실제 판매 데모 시작 / 중지"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>{isDemoActive ? `데모 중지 (${Math.floor(demoElapsedSeconds / 60).toString().padStart(2, '0')}:${(demoElapsedSeconds % 60).toString().padStart(2, '0')})` : '🎬 데모보기'}</span>
          </button>}

          {/* 판매자 설정 버튼 (모달 열기) */}
          <button
            type="button"
            onClick={() => setShowSellerSettingsModal(true)}
            className="h-8 px-2 rounded-lg text-[11px] font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center gap-1 transition active:scale-95"
            title="판매자 설정 & 실제 판매 데모보기"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">판매자 설정</span>
          </button>

          <label
            className={`h-8 px-2 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1.5 cursor-pointer transition select-none ${
                isCommentCaptureActive
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
              }`}
              title="라이브 청취 시작 시 댓글을 함께 수집합니다"
            >
              <input
                type="checkbox"
                checked={isCommentCaptureActive}
                onChange={(e) => (e.target.checked ? startCommentCapture() : stopCommentCapture())}
                className="w-3.5 h-3.5 accent-rose-600 cursor-pointer"
              />
              <MessageSquareText className={`hidden sm:block w-3.5 h-3.5 ${isCommentCaptureRunning ? 'text-rose-500 animate-pulse' : 'text-slate-400'}`} />
              <span>댓글캡처</span>
              {commentNewCount > 0 && (
                <span className="px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black">
                  +{commentNewCount}
                </span>
              )}
            </label>

          {runtime.isTest && !isListening && activeSession && <button type="button"
            disabled={isSessionStarting} onClick={() => setShowSessionChoice(true)}
            className="h-8 px-2 rounded-lg border border-amber-300 bg-amber-50 text-xs font-bold text-amber-900">새 테스트 회차</button>}
          <ListeningStopControl />

          <button
            disabled={isSessionStarting && !runtime.isTest}
            onClick={handleToggleListening}
            className={`h-8 min-w-16 px-2.5 rounded-lg font-black text-xs shadow-sm flex items-center justify-center gap-1.5 transition active:scale-95 ${
              isListening || (runtime.isTest && isSessionStarting)
                ? 'bg-slate-100 hover:bg-slate-200 text-rose-600 border border-rose-200'
                : 'bg-gradient-to-r from-brand-600 via-brand-500 to-rose-500 text-white shadow-brand-500/20'
            }`}
          >
            {isListening || (runtime.isTest && isSessionStarting) ? (
              <>
                <Square className="w-3 h-3 fill-current" />
                <span>{runtime.isTest ? isSessionStarting ? '준비 취소' : '방송중지' : '중지'}</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>{runtime.isTest ? '방송시작' : '시작'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {runtime.isTest && (isSessionStarting || isListening || testStartFailure || hasTestStopped) && (
        <div role={testStartFailure ? 'alert' : 'status'}
          className={`rounded-xl border px-3 py-2 text-sm font-semibold ${testStartFailure
            ? 'border-rose-300 bg-rose-50 text-rose-800'
            : isSessionStarting ? 'border-amber-300 bg-amber-50 text-amber-900'
              : isListening ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-slate-50 text-slate-700'}`}>
          {testStartFailure || (isSessionStarting ? '방송 시작 준비 중 · 마이크와 음성인식을 연결하고 있습니다.'
            : isListening ? '방송 중 · 마이크와 음성인식이 연결되었습니다.' : '방송이 중지되었습니다.')}
        </div>
      )}

      <ListeningStopStatus />

      {/* 영업 시연용 실시간 데모 배너 */}
      {isDemoActive && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-brand-600 text-white shadow-md shadow-purple-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center flex-shrink-0 animate-pulse">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs sm:text-sm font-black tracking-tight">
                  🎬 영업 시연용 실시간 데모 가동 중
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/25 text-[10px] font-bold font-mono">
                  {Math.floor(demoElapsedSeconds / 60).toString().padStart(2, '0')}:{(demoElapsedSeconds % 60).toString().padStart(2, '0')}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-purple-100 font-normal mt-0.5">
                실제 방송 오디오 파형, 틱톡 실시간 댓글 유입, AI 호스트 음성 전사, 주문 자동 적재 및 실시간 음성 정정 시나리오를 시연 중입니다.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 self-end sm:self-center flex-shrink-0">
            <button
              onClick={handleToggleDemo}
              className="px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 active:scale-95 text-white font-bold text-xs transition border border-white/30 flex items-center space-x-1.5 shadow-xs"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>데모 중지</span>
            </button>
          </div>
        </div>
      )}

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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-3.5">
        {/* 좌측 영역 (6 cols) */}
        <div className="lg:col-span-6 flex flex-col gap-2.5 sm:gap-3.5">
          {/* 오디오상태 및 이번회차판매 */}
          <div className="bg-white border border-slate-200 rounded-2xl px-2.5 py-2 sm:px-3 shadow-sm flex items-center justify-between gap-2 sm:gap-3 min-h-[48px] sm:min-h-[50px]">
            {/* 타이틀 및 아이콘 */}
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-shrink-0">
              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                isListening
                  ? 'bg-brand-50 text-brand-600 ring-1 ring-brand-500/20 shadow-xs'
                  : 'bg-slate-100 text-slate-400'
              }`}>
                <Volume2 className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isListening ? 'text-brand-600 animate-pulse' : 'text-slate-400'}`} />
              </div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 whitespace-nowrap">
                오디오상태
              </h3>
            </div>

            {/* 좌우 길이 절반으로 줄인 파형 표시 및 레벨 */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-16 sm:w-24 h-6 flex items-center">
                <AudioVisualizer
                  waveform={effectiveWaveform}
                  audioLevel={effectiveAudioLevel}
                  isActive={isListening}
                  variant="inline"
                  className="h-6 w-full"
                />
              </div>
              <div className="text-[10px] sm:text-[11px] text-slate-500 font-mono flex-shrink-0 whitespace-nowrap bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                {effectiveAudioLevel}%
              </div>
            </div>

            {/* 생긴 빈 공간에 합쳐서 표시: 이번회차판매 : x건 / xxxx원 */}
            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 pl-2 sm:pl-3 border-l border-slate-200 text-xs sm:text-sm font-bold text-slate-700 whitespace-nowrap ml-auto">
              <span className="text-slate-600">이번회차판매 :</span>
              <span className="text-slate-900 font-black">{effectiveSalesCount}건</span>
              <span className="text-slate-300">/</span>
              <span className="text-brand-600 font-black">{effectiveTotalAmount.toLocaleString()}원</span>
            </div>
          </div>

          {/* 판매 내역 카드 리스트 (위아래 높낮이 낮춘 슬림 목록: 상품명, 회차/확정멘트, 근거보기 제외) */}
          <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2.5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>판매 내역 · 확인 대기</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRefreshSessionSales()}
                  disabled={isSalesRefreshing}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  title="판매 내역 새로고침"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSalesRefreshing ? 'animate-spin' : ''}`} />
                  <span>새로고침</span>
                </button>
                <Link to={runtime.path('/sales/review')} className="text-xs text-brand-600 hover:underline font-bold flex items-center">
                  <span>일괄 검토</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </div>
            </div>

            <div className="space-y-1.5 max-h-[220px] sm:max-h-[260px] overflow-y-auto pr-1">
              {effectiveSessionSales.length === 0 ? (
                <div className="py-2.5 sm:py-3 px-3 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl min-h-[38px] flex items-center justify-center">
                  판매자 배정 발화와 구매 댓글이 연결되면 판매가 등록됩니다.
                </div>
              ) : (
                effectiveSessionSales.map((sale) => {
                  const nicknameNeedsConfirmation = sale.source === 'WEB_VOICE' && sale.status === '보류'
                    && (sale.aiVerification?.nicknameVerified === false || !sale.sourceCommentIds?.length);
                  const productImage = sale.productImageUrl
                    || sale.captureImageUrls?.[0]
                    || (sale.productCode && sale.productCode === activeProduct?.productCode ? activeProduct?.imageUrl : undefined);
                  const sourceLabel = sale.source === 'ANDROID_COMMENTS'
                    ? '앱'
                    : sale.source === 'WEB_VOICE'
                      ? '음성'
                      : sale.source === 'MANUAL'
                        ? '수동'
                        : '기타';
                  const buyerSessionSales = getSalePurchaseHistory(sale, effectiveSessionSales);
                  const multiAmount = formatMultiSaleAmount(buyerSessionSales.map((s) => s.amount));
                  const purchaseIntentWord = getBuyerPurchaseIntentWord(sale, effectiveComments);

                  return (
                  <Link
                    key={sale.id}
                    to={isDemoActive ? '#' : runtime.path(`/sales/${sale.id}`)}
                    state={{ returnTo: runtime.path('/live') }}
                    onClick={(e) => { if (isDemoActive) e.preventDefault(); }}
                    className={`block p-2 sm:p-2.5 rounded-xl border transition active:scale-[0.99] hover:shadow-xs ${
                      sale.status === '보류'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                        : sale.status === '수동수정'
                        ? 'bg-purple-50/70 border-purple-200 text-slate-800'
                        : 'bg-slate-50/70 border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-2.5">
                      {/* 상품 이미지 썸네일 (컴팩트) */}
                      <div
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg overflow-hidden border border-slate-200/80 bg-slate-100 flex-shrink-0 shadow-xs flex items-center justify-center relative group/thumb ${
                          productImage ? 'cursor-pointer hover:ring-2 hover:ring-brand-500' : ''
                        }`}
                        onClick={(e) => {
                          if (productImage) {
                            e.preventDefault();
                            e.stopPropagation();
                            const images = sale.captureImageUrls && sale.captureImageUrls.length > 0
                              ? sale.captureImageUrls
                              : [productImage];
                            setViewerModal({
                              isOpen: true,
                              images,
                              initialIndex: 0,
                              title: `${sale.buyerNickname} 상품/캡처`
                            });
                          }
                        }}
                        title={productImage ? '클릭하여 원본 크기로 보기' : undefined}
                      >
                        {productImage ? (
                          <>
                            <img
                              src={productImage}
                              alt={`${sale.productCode || sale.buyerNickname} 상품`}
                              className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <ZoomIn className="w-3 h-3" />
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-center text-slate-400">
                            <ShoppingBag className="w-4 h-4 text-brand-600/70" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5 flex-wrap">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span
                              className="font-bold text-xs sm:text-sm text-slate-900 truncate hover:text-brand-600 transition-colors"
                              title={purchaseIntentWord ? `구매의사: "${purchaseIntentWord}"` : undefined}
                            >
                              {sale.buyerNickname === '미확인(보류)' ? '구매자 미확인' : sale.buyerNickname}
                            </span>
                            {nicknameNeedsConfirmation && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                추정 닉네임
                              </span>
                            )}
                            {sale.evidenceSnapshot?.buyerResolution && sale.evidenceSnapshot.buyerResolution.status !== 'MATCHED' && (
                              <span className="text-[9px] rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-amber-800">판매 확정 · 구매자 연결 확인</span>
                            )}
                            {multiAmount.isMulti && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                                ★ 다건 {buyerSessionSales.length}건
                              </span>
                            )}
                            {!nicknameNeedsConfirmation && (
                              <>
                                <CustomerStatsBadge
                                  nickname={sale.buyerNickname}
                                  buyerId={sale.buyerId}
                                  variant="pill"
                                  currentSessionId={sale.sessionId || currentSessionId || activeSession?.id}
                                />
                                {(() => {
                                  const keepingSummary = customerKeepingService.getBuyerSummary(
                                    sale.buyerNickname,
                                    sale.sessionId || currentSessionId || activeSession?.id,
                                    workspaceId
                                  );
                                  return keepingSummary.hasActiveKeeping ? (
                                    <KeepingBadge summary={keepingSummary} />
                                  ) : null;
                                })()}
                              </>
                            )}
                            <AiSaleBadge sale={sale} />

                          </div>

                          {/* 금액 표시 */}
                          {multiAmount.isMulti ? (
                            <div className="flex items-baseline gap-1 font-bold">
                              <span className="text-[11px] text-brand-600 font-mono">{multiAmount.decimalExpression} =</span>
                              <span className="text-sm sm:text-base font-black text-brand-700">{multiAmount.totalFormatted}</span>
                            </div>
                          ) : (
                            <div className="text-xs sm:text-sm font-black text-brand-600">
                              {sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '금액 미확인'}
                            </div>
                          )}
                        </div>

                        {/* 출처 및 동기화/전표 배지 */}
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold border ${
                            sale.source === 'ANDROID_COMMENTS'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : sale.source === 'WEB_VOICE'
                                ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {sourceLabel}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                            sale.status === '보류'
                              ? 'bg-amber-400 text-slate-950'
                              : sale.status === '수동수정'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {sale.syncStatus === 'PENDING' ? (runtime.isTest ? '테스트 DB 저장 대기' : '서버 저장 대기') : sale.status}
                          </span>
                          {sale.printStatus === 'PRINTED' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {runtime.isTest ? '가상 전표 완료' : '전표 출력 완료'}
                            </span>
                          )}
                          {sale.printStatus === 'QUEUED' && sale.syncStatus !== 'PENDING' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-sky-50 text-sky-700 border border-sky-200">
                              전표 출력 중
                            </span>
                          )}
                        </div>

                        {/* AI 작업 이력 배지 (근거보기 제외) */}
                        <div className="mt-1 pt-1 border-t border-slate-200/40">
                          <SaleAiActionButtons sale={sale} hideEvidence={true} />
                        </div>
                      </div>
                    </div>
                  </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* 구매요청 · 판매자 배정 대기 (판매내역 밑으로 이동) */}
          <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 sm:px-3.5 sm:py-3 shadow-sm">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 mb-2">구매요청 · 판매자 배정 대기</h3>
            {purchaseRequests.length === 0 ? (
              <p className="text-xs text-slate-400">저요·ㅈㅇ 등 구매 의사 댓글이 들어오면 여기에 표시됩니다.</p>
            ) : (
              <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                {purchaseRequests.map((request) => {
                  const linked = currentSessionSales.find((sale) => sale.purchaseRequestId === request.id && sale.status !== '취소');
                  const state = request.withdrawn ? '구매 의사 철회'
                    : request.conditional ? '조건 확인'
                    : linked?.status === '보류' ? '확인 필요'
                    : linked?.syncStatus === 'PENDING' ? '서버 저장 대기'
                      : linked ? '판매 확정' : '배정 대기';
                  return <div key={request.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                    <span className="truncate"><strong>{request.nickname}</strong> · {request.content}</span>
                    <span className={`shrink-0 font-bold ${linked?.syncStatus === 'SYNCED' && linked.status !== '보류' ? 'text-emerald-700' : 'text-amber-700'}`}>{state}</span>
                  </div>;
                })}
              </div>
            )}
          </div>

          {/* 실시간 판매 멘트 */}
          <div className="order-3 bg-white border border-slate-200 rounded-2xl px-3 py-2.5 sm:px-3.5 sm:py-3 shadow-sm">
            {!isListening && sttEngineStatus === 'ERROR' && sttEngineMessage && (
              <p role="alert" className="mb-2 text-xs leading-relaxed text-rose-700 bg-rose-50 px-2.5 py-1.5 rounded-xl border border-rose-200">
                ⚠️ {sttEngineMessage}
              </p>
            )}
            {isListening && pipelineDiagnostics && <div className="mb-2 space-y-1 text-[11px] text-slate-600" aria-label="실시간 전사 연결 진단">
              <p>실제 오디오 입력 {pipelineDiagnostics.audio.audioSeconds.toFixed(1)}초
                {sttMode === 'CLOUD' && <> · 현재 STT 연결 전송 {pipelineDiagnostics.stt.audioSeconds.toFixed(1)}초 · 서버 응답 {pipelineDiagnostics.stt.receivedResponses}회 · 전사 수신 {pipelineDiagnostics.stt.receivedTextCharacters}자</>}
              </p>
              <p title={sttEngineMessage}>{sttMode === 'LOCAL' ? '내 PC STT' : selectedSttName} · {sttEngineStatus === 'CONNECTED' ? '소켓 연결됨' : sttEngineStatus === 'CONNECTING' ? '연결 중' : sttEngineStatus === 'ERROR' ? '연결 오류' : '연결 끊김'} · {pipelineDiagnostics.audio.processor === 'AUDIO_WORKLET' ? '오디오 전용 처리' : pipelineDiagnostics.audio.processor === 'SCRIPT_PROCESSOR' ? '호환 오디오 처리' : '오디오 처리 대기'}</p>
              {pipelineDiagnostics.elapsedSeconds >= 10 && pipelineDiagnostics.audio.chunks === 0 && <p role="alert" className="text-amber-800">오디오 데이터가 생성되지 않습니다. 청취를 중지한 뒤 다시 시작해 주세요.</p>}
              {pipelineDiagnostics.elapsedSeconds >= 10 && pipelineDiagnostics.audio.chunks > 0 && !pipelineDiagnostics.audio.lastSignalAt && <p role="alert" className="text-amber-800">공유한 탭에서 소리가 들어오지 않습니다. 실제 방송 탭과 탭 오디오 공유를 확인해 주세요.</p>}
              {sttMode === 'CLOUD' && pipelineDiagnostics.stt.audioSeconds >= 10 && pipelineDiagnostics.stt.receivedResponses === 0 && <p role="alert" className="text-amber-800">오디오는 전송됐지만 STT 서버 응답이 없습니다. 연결 상태를 확인해 주세요.</p>}
              {sttEngineStatus === 'ERROR' && <p role="alert" className="text-rose-700">{sttEngineMessage}</p>}
            </div>}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center space-x-2 flex-wrap">
                <Clock className="w-4 h-4 text-brand-600 shrink-0" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  실시간 판매 멘트
                </h3>
                {!isListening && (
                  <span
                    role="status"
                    className={`text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      sttEngineStatus === 'ERROR'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {sttEngineMessage || '대기 중'}
                  </span>
                )}
                <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  화면 {effectiveTranscriptLogs.length}건 / 오늘 누적 {totalSessionTranscriptCount || transcriptLogs.length}건
                </span>
                {cloudSyncStatus === 'saving' && (
                  <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full animate-pulse">
                    <Cloud className="w-3 h-3 animate-spin" />
                    <span>{runtime.isTest ? '테스트 DB 저장 중…' : 'Supabase 저장 중...'}</span>
                  </span>
                )}
                {cloudSyncStatus === 'saved' && (
                  <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full" title={runtime.isTest ? '방송 발화 로그를 이 PC의 테스트 DB에 보관했습니다.' : '방송 발화 전체 로그가 Supabase 클라우드에 안전하게 영구 보관되었습니다.'}>
                    <Cloud className="w-3 h-3 text-emerald-600" />
                    <span>{runtime.isTest ? '테스트 DB 보관됨' : 'Supabase 보관됨'}</span>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={diagnosticDownloading}
                  onClick={() => {
                    setDiagnosticDownloading(true);
                    setDiagnosticDownloadError('');
                    void downloadSttDiagnostics().catch(() => setDiagnosticDownloadError('진단 로그를 내려받지 못했습니다. 다시 시도해 주세요.'))
                      .finally(() => setDiagnosticDownloading(false));
                  }}
                  className="px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] sm:text-[11px] font-bold border border-blue-200 disabled:opacity-40"
                  title="이 회차의 STT 원본 응답·문장 조립·판매 판정·저장 결과를 JSON 파일 하나로 저장합니다."
                >
                  {diagnosticDownloading ? '진단 로그 준비 중…' : 'STT 진단 로그 저장'}
                </button>
                <button
                  onClick={() => downloadSessionTranscripts('txt')}
                  disabled={(totalSessionTranscriptCount || transcriptLogs.length) === 0}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] sm:text-[11px] font-bold border border-slate-300 transition flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                  title="오늘 방송 전체 음성 전사 로그를 텍스트(.txt) 파일로 다운로드"
                >
                  <Download className="w-3 h-3" />
                  <span>TXT 저장</span>
                </button>
                <button
                  onClick={() => downloadSessionTranscripts('csv')}
                  disabled={(totalSessionTranscriptCount || transcriptLogs.length) === 0}
                  className="px-2 py-0.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] sm:text-[11px] font-bold border border-emerald-200 transition flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                  title="오늘 방송 전체 음성 전사 로그를 엑셀(.csv) 파일로 다운로드 (한글 엑셀 호환)"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>엑셀(CSV) 저장</span>
                </button>
              </div>
            </div>

            {diagnosticDownloadError && <p role="alert" className="mb-2 text-xs text-rose-700">{diagnosticDownloadError}</p>}
            <div className="space-y-1.5 max-h-[140px] sm:max-h-[160px] overflow-y-auto pr-1">
              {/* 실시간 타이핑 중인 중간 자막 표시 */}
              {effectiveInterimTranscript && (
                <div className="p-2 sm:p-2.5 rounded-xl border border-brand-300 bg-brand-50/80 text-xs text-brand-900 animate-pulse flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-500 animate-ping flex-shrink-0" />
                  <span className="font-semibold">{effectiveInterimTranscript}</span>
                </div>
              )}

              {effectiveTranscriptLogs.length === 0 && !effectiveInterimTranscript ? (
                <div className="py-2.5 sm:py-3 px-3 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl min-h-[38px] flex items-center justify-center">
                  아직 전사된 발화 로그가 없습니다.
                </div>
              ) : (
                effectiveTranscriptLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-2 sm:p-2.5 rounded-xl border text-xs transition ${
                      log.actionTriggered === 'SALE_SAVED'
                        ? 'bg-brand-50 border-brand-200 text-brand-900'
                        : log.actionTriggered === 'SCREEN_CAPTURED'
                        ? 'bg-cyan-50 border-cyan-200 text-cyan-900'
                        : log.actionTriggered === 'VOICE_EDIT_START' || log.actionTriggered === 'VOICE_EDIT_DONE'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
                      {log.actionTriggered === 'SALE_SAVED' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-brand-100 text-brand-700">
                          🛍️ 판매 자동 저장
                        </span>
                      )}
                      {log.actionTriggered === 'SCREEN_CAPTURED' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-cyan-100 text-cyan-700">
                          📸 댓글창 캡처
                        </span>
                      )}
                      {log.actionTriggered === 'VOICE_EDIT_START' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800">
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
        </div>

        {/* 우측 영역 (6 cols) */}
        <div className="lg:col-span-6 flex flex-col gap-2.5 sm:gap-3.5">
          {/* 실시간 댓글 캡처 피드 (넓어진 우측 열에서 시원하게 표시) */}
          <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 sm:px-3.5 sm:py-3 shadow-sm flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2 flex-wrap gap-y-1">
                <MessageSquareText className={`w-4 h-4 ${isCommentCaptureRunning ? 'text-rose-500 animate-pulse' : 'text-cyan-600'}`} />
                <span>실시간 댓글 캡처 ({effectiveComments.length}건)</span>
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
              <div className="flex items-center space-x-2.5">
                <Link to={runtime.isTest ? '/live-test/comments' : '/seller/helper'} className="text-xs text-slate-500 hover:text-brand-600 font-bold flex items-center transition">
                  <Bot className="w-3.5 h-3.5 mr-1 text-brand-600" />
                  <span>{runtime.isTest ? '테스트 댓글 기록' : '도우미 설정'}</span>
                </Link>
                <Link to={runtime.path('/comments')} className="text-xs text-brand-600 hover:underline font-bold flex items-center">
                  <span>전체 기록</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </div>
            </div>

            {isCommentCaptureActive && (commentServerStatus === 'DISCONNECTED' || commentServerStatus === 'ERROR') && (
              <div className="mb-2 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold flex items-center justify-between">
                <span>⚠️ {commentServerMessage || 'VoiceCAP 내장 댓글 도우미 연결을 확인하세요.'}</span>
                <button
                  type="button"
                  onClick={() => setShowHelperModal(true)}
                  className="underline text-rose-800 hover:text-rose-950 ml-2 whitespace-nowrap flex items-center gap-1 font-bold"
                >
                  <Bot className="w-3 h-3" />
                  도우미 설정/재시작
                </button>
              </div>
            )}

            {isCommentCaptureActive && !commentConfig.tiktokUsername && (
              <div className="mb-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
                <span>⚠️ 수집 대상 틱톡 ID가 설정되지 않았습니다.</span>
                <Link to="/recognition-rules" className="font-bold underline text-amber-800 hover:text-amber-950 ml-2">
                  ID 설정하러 가기
                </Link>
              </div>
            )}

            <div ref={commentFeedRef} className="max-h-[380px] sm:max-h-[440px] min-h-[140px] overflow-y-auto space-y-1.5 pr-1 flex-1">
              {effectiveComments.length === 0 ? (
                <div className="py-2.5 sm:py-3 px-3 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl min-h-[38px] flex items-center justify-center">
                  {isCommentCaptureRunning
                    ? (runtime.isTest ? '가상 댓글을 실시간 생성하고 있습니다…' : `@${commentConfig.tiktokUsername || '?'} 라이브 댓글을 실시간 수집 중입니다...`)
                    : (runtime.isTest ? '방송시작을 누르면 가상 댓글이 실시간으로 표시됩니다.' : '"댓글캡처" 체크 후 라이브 청취를 시작하면 틱톡 댓글이 실시간 표시됩니다.')}
                </div>
              ) : (
                effectiveComments.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border text-xs ${
                      c.matchedAlertWord
                        ? 'bg-rose-50/70 border-rose-200'
                        : 'bg-slate-50/70 border-slate-200'
                    }`}
                  >
                    <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                      {new Date(c.capturedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`font-bold flex-shrink-0 max-w-[120px] truncate ${c.matchedAlertWord ? 'text-rose-700' : 'text-brand-700'}`}>
                      {c.nickname}
                    </span>
                    <span className="text-slate-800 font-medium break-words min-w-0 flex-1">{c.content}</span>
                    {c.matchedAlertWord && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black whitespace-nowrap">
                        {c.matchedAlertWord}
                      </span>
                    )}
                    <CustomerStatsBadge
                      nickname={c.nickname} platformUserId={c.platformUserId} uniqueId={c.uniqueId}
                      buyerId={c.buyerId || undefined}
                      variant="compact"
                      currentSessionId={currentSessionId || activeSession?.id}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 최근 감지된 단어 규칙 및 음성 처리 결과 */}
          <div className="bg-white border border-slate-200 rounded-2xl px-2.5 py-2 sm:px-3 shadow-sm flex items-center justify-between gap-2 sm:gap-3 min-h-[48px] sm:min-h-[50px]">
            <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-amber-500" />
              </div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 whitespace-nowrap">
                최근 감지·처리 결과
              </h3>
            </div>

            {effectiveMatchedRuleItem ? (
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2 p-1.5 sm:px-2.5 rounded-xl bg-amber-50/70 border border-amber-200">
                <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                  <div className="flex items-center space-x-1 flex-shrink-0">
                    {effectiveMatchedRuleItem.matchedKeywords.slice(0, 2).map((kw, idx) => (
                      <span key={idx} className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 font-bold text-[10px] border border-amber-300">
                        #{kw}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-900 truncate">
                    "{effectiveMatchedRuleItem.text}"
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[10px] font-bold whitespace-nowrap">
                    {effectiveMatchedRuleItem.action}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">{effectiveMatchedRuleItem.timestamp}</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0 flex items-center justify-center py-1 px-2.5 rounded-xl border border-dashed border-slate-200 text-[11px] sm:text-xs text-slate-400 truncate italic">
                등록된 단어 규칙과 판매·음성 정정·캡처 처리 결과를 표시합니다.
              </div>
            )}
          </div>

          {/* 테스트 멘트 주입 툴바 (모바일 가로 스크롤 지원) */}
          <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2.5 text-xs shadow-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-bold text-slate-700 flex items-center">
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                <span>빠른 시연 & 테스트 멘트 주입 버튼</span>
              </p>
              {!runtime.isTest && <button
                type="button"
                onClick={handleToggleDemo}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-black whitespace-nowrap active:scale-95 transition flex items-center gap-1 shadow-xs ${
                  isDemoActive
                    ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'
                }`}
              >
                {isDemoActive ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>데모 중지 ({Math.floor(demoElapsedSeconds / 60).toString().padStart(2, '0')}:{(demoElapsedSeconds % 60).toString().padStart(2, '0')})</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    <span>🎬 실시간 전체 데모</span>
                  </>
                )}
              </button>}
            </div>
            <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar pb-0.5">
              <button
                onClick={() => injectTestMent('러블리언니 이거 드릴게요 1.5 캡처하세요.')}
                className="px-2.5 py-1 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-300 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                🎯 "러블리언니 드릴게요 1.5 캡처"
              </button>
              <button
                onClick={() => injectTestMent('닉네임 민트초코 확정이요 2.3 캡처해주세요.')}
                className="px-2.5 py-1 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-300 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                🎯 "닉네임 민트초코 2.3 캡처"
              </button>
              <button
                onClick={() => injectTestMent('구매확정 됐습니다! 구매하신 분은 러블리님 이시구요 금액은 3만5천원입니다.')}
                className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold whitespace-nowrap active:scale-95 transition"
              >
                + "러블리님 35,000원"
              </button>
              <button
                onClick={() => injectTestMent('구매확정! 닉네임 민트초코님 가격 19,900원입니다. 캡처하세요.')}
                className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold whitespace-nowrap active:scale-95 transition"
              >
                + "민트초코 19,900원 + 캡처하세요"
              </button>
              <button
                onClick={() => injectTestMent('화면 캡처하세요.')}
                className="px-2.5 py-1 rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 text-xs font-semibold whitespace-nowrap active:scale-95 transition"
              >
                + "화면 캡처하세요"
              </button>
              <button
                onClick={() => injectTestMent('수정 시작')}
                className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                + "수정 시작"
              </button>
              <button
                onClick={() => injectTestMent('닉네임은 달콤한하루님, 금액은 48,000원')}
                className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                + "닉네임/금액 수정"
              </button>
              <button
                onClick={() => injectTestMent('수정 완료')}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                + "수정 완료"
              </button>
            </div>
            {runtime.isTest && <form
              className="space-y-2 border-t border-slate-200 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = testMentText.trim();
                if (text) injectTestMent(text);
              }}
            >
              <label htmlFor="test-sale-ment" className="block font-bold text-slate-700">테스트 멘트 직접 입력</label>
              <textarea
                id="test-sale-ment"
                value={testMentText}
                onChange={(event) => setTestMentText(event.target.value)}
                placeholder="별이님 드릴게요. 감사합니다. 가격 1.2 캡처해주세요."
                rows={2}
                maxLength={4000}
                aria-describedby="test-sale-ment-help"
                className="w-full rounded-xl border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p id="test-sale-ment-help" className="text-slate-500">마이크 없이 입력한 문장으로 판매 판정을 재현합니다.</p>
                <button type="submit" disabled={!testMentText.trim()}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">
                  입력한 멘트 재현
                </button>
              </div>
            </form>}
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

      {/* 청취 시작 전 회차 선택 */}
      {showSessionChoice && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-choice-title"
        >
          <div className="w-full max-w-md space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="session-choice-title" className="text-lg font-black text-slate-900">방송 회차 선택</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  청취를 중지해도 회차는 유지됩니다. 이어서 시작하면 기존 판매·댓글에 계속 기록됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSessionChoice(false)}
                disabled={isSessionStarting}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
                aria-label="회차 선택 닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeSession && (
              <button
                type="button"
                onClick={() => void handleStartWithSession('CONTINUE')}
                disabled={isSessionStarting}
                className="w-full rounded-2xl border border-brand-200 bg-brand-50 p-4 text-left transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="block text-sm font-black text-brand-900">기존 회차와 이어서 하기</span>
                <span className="mt-1 block text-xs text-brand-700">
                  {activeSession.displayCode} · 현재 상품과 판매 기록을 그대로 사용합니다.
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleStartWithSession('NEW')}
              disabled={isSessionStarting}
              className="w-full rounded-2xl bg-gradient-to-r from-brand-600 via-brand-500 to-rose-500 p-4 text-left text-white shadow-md transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
            >
              <span className="block text-sm font-black">새 회차로 시작하기</span>
              <span className="mt-1 block text-xs text-white/85">
                {activeSession ? '기존 회차를 마감하고 새 판매·댓글 회차를 만듭니다.' : '새 판매·댓글 회차를 만들고 청취를 시작합니다.'}
              </span>
            </button>

            {isSessionStarting && (
              <p className="text-center text-xs font-medium text-slate-500">회차와 방송 탭 오디오를 준비하고 있습니다…</p>
            )}
          </div>
        </div>
      )}

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

      {/* 관리자가 허락한 판매자용 STT API 키 안내 모달 */}
      {showSellerKeyInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-sm w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">
                {hasAdminSttKey ? '✨ 관리자 STT 키 무료 지원 중' : '⚠️ 관리자 키 등록 대기'}
              </h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                {hasAdminSttKey ? (
                  <>
                    관리자가 등록한 기본 STT 서비스(<strong className="text-slate-800 font-bold">{selectedSttName}</strong>)를 <strong className="text-emerald-700 font-bold">키 입력 없이 무료</strong>로 이용하실 수 있습니다.<br />
                    방송 시작 시 자동으로 연결됩니다! 🎉
                  </>
                ) : (
                  <>
                    관리자가 기본 STT 서비스(<strong className="text-slate-800 font-bold">{selectedSttName}</strong>)를 선택했으나 아직 API Key를 등록하지 않았습니다.<br />
                    관리자에게 키 등록을 요청하시거나 <strong className="text-brand-700 font-bold">[내 PC 무료 STT]</strong> 모드를 이용해 주세요.
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              {hasAdminSttKey ? (
                <button
                  onClick={() => setShowSellerKeyInfoModal(false)}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
                >
                  확인 완료
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setSttMode('LOCAL');
                      setShowSellerKeyInfoModal(false);
                    }}
                    className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
                  >
                    내 PC 무료 STT로 전환하기
                  </button>
                  <button
                    onClick={() => setShowSellerKeyInfoModal(false)}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                  >
                    닫기
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 미허락 판매자용 승인 필요 안내 모달 */}
      {showNoPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-sm w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto">
              <Key className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">🔒 관리자 승인이 필요합니다</h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                현재 계정은 관리자의 클라우드 STT API 키 무료 이용 승인이 완료되지 않았습니다.<br />
                관리자에게 승인을 요청하시거나, API 사용료가 전혀 없는 <strong className="text-brand-700 font-bold">[내 PC 무료 STT (Whisper)]</strong> 모드를 이용해 주세요!
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  setSttMode('LOCAL');
                  setShowNoPermissionModal(false);
                }}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
              >
                내 PC 무료 STT로 전환하기
              </button>
              <button
                onClick={() => setShowNoPermissionModal(false)}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 댓글 도우미 및 장치 설정 모달 */}
      <CommentHelperModal isOpen={!runtime.isTest && showHelperModal} onClose={() => setShowHelperModal(false)} />

      {/* 판매자 설정 및 실제 판매 데모보기 모달 */}
      <SellerSettingsModal
        isTest={runtime.isTest}
        isOpen={showSellerSettingsModal}
        onClose={() => setShowSellerSettingsModal(false)}
        isDemoActive={isDemoActive}
        demoElapsedSeconds={demoElapsedSeconds}
        onToggleDemo={handleToggleDemo}
        audioSourceMode={audioSourceMode}
        onChangeAudioSourceMode={handleAudioSourceModeChange}
        sttProvider={sttProvider}
        sttMode={sttMode}
        onChangeSttMode={setSttMode}
        isListening={isListening || isSessionStarting}
        canUseCloudStt={canUseAdminKey && hasAdminSttKey}
        localSttModel={localSttModel}
        localSttMessage={localSttStatus.message}
      />

      {viewerModal.isOpen && (
        <ImageViewerModal
          isOpen={viewerModal.isOpen}
          onClose={() => setViewerModal((prev) => ({ ...prev, isOpen: false }))}
          images={viewerModal.images}
          initialIndex={viewerModal.initialIndex}
          titlePrefix={viewerModal.title}
        />
      )}
    </div>
  );
};
