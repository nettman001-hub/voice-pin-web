import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Play,
  Square,
  Radio,
  Download,
  CheckCircle2,
  Clock,
  Sparkles,
  Cpu,
  Trash2,
  Terminal,
  Volume2,
  Zap,
  MessageSquareText,
  RotateCcw
} from 'lucide-react';
import { useLive } from '../../context/LiveContext';
import { useCommentCapture } from '../../context/CommentCaptureContext';
import { getSellerLogicSlots } from '../../services/sellerLogicApi';
import { SellerLogicCapture } from '../../services/sellerLogicCapture';
import type { SellerLogicSlots } from '../../types/sellerLogicAnalysis';
import type {
  AiDebugLog,
  SellerLogic02AntiDecision,
  SellerLogic02AntiResult,
  SttDebugLog
} from '../../types/sellerLogic02Anti';
import {
  koreanCalendarDate,
  parseSellerLogic02AntiText,
  SELLER_LOGIC_METHOD1_EXAMPLE,
  SELLER_LOGIC_METHOD2_EXAMPLE,
  type SellerLogic02AntiEvidence
} from '../../services/anti/sellerLogic02AntiInput';
import {
  SttVocabularyManager,
  generateKoreanPronunciationHints
} from '../../services/anti/sellerLogic02AntiVocabulary';
import { SttSeamlessCaptureService } from '../../services/anti/sellerLogic02AntiCapture';
import {
  AI_SLOT_CONFIGS,
  runSellerLogic02AntiAnalysis
} from '../../services/anti/sellerLogic02AntiContract';

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40';
const visibleCommentLimit = 200;
const visibleTimelineLimit = 200;
const time = (value: string) => new Date(value).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });

export default function SellerLogicAnalysis02AntiPage() {
  const live = useLive();
  const commentCapture = useCommentCapture();

  // 1. 상태 변수: 슬롯 및 방송 설정
  const [username, setUsername] = useState(commentCapture.config.tiktokUsername || 'gonow_74');
  const [slot, setSlot] = useState<1 | 2>(1);
  const [slotSettings, setSlotSettings] = useState<SellerLogicSlots | null>(null);
  const [slotSettingsError, setSlotSettingsError] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(true);

  // 실시간 청취 상태
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('방송을 청취하거나 프리셋 대화 자료를 불러오세요.');
  const [errorMessage, setErrorMessage] = useState('');

  // 방송 데이터
  const [broadcastDate, setBroadcastDate] = useState(koreanCalendarDate);
  const [inputText, setInputText] = useState(SELLER_LOGIC_METHOD1_EXAMPLE);
  const [evidence, setEvidence] = useState<SellerLogic02AntiEvidence>({ comments: [], transcripts: [] });

  // 분석 결과
  const [analysisResult, setAnalysisResult] = useState<SellerLogic02AntiResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState({ current: 0, total: 0 });

  // 실시간 디버그 로그 목록
  const [aiDebugLogs, setAiDebugLogs] = useState<AiDebugLog[]>([]);
  const [sttDebugLogs, setSttDebugLogs] = useState<SttDebugLog[]>([]);
  const [currentVocabulary, setCurrentVocabulary] = useState<string[]>([]);
  const [handoverCount, setHandoverCount] = useState(0);

  // 콘솔 필터 및 자동 스크롤
  const [aiLogFilter, setAiLogFilter] = useState<'ALL' | 'REQUEST' | 'RESPONSE' | 'ERROR'>('ALL');
  const [autoScrollAi, setAutoScrollAi] = useState(true);
  const [autoScrollStt, setAutoScrollStt] = useState(true);

  // DOM Refs & 서비스 인스턴스
  const aiConsoleRef = useRef<HTMLDivElement>(null);
  const sttConsoleRef = useRef<HTMLDivElement>(null);
  const simTimerRef = useRef<any>(null);
  const captureRef = useRef<SellerLogicCapture | null>(null);
  const sessionRef = useRef(crypto.randomUUID());
  const rowsRef = useRef(evidence);
  const mounted = useRef(true);

  const vocabManagerRef = useRef<SttVocabularyManager | null>(null);
  const captureServiceRef = useRef<SttSeamlessCaptureService | null>(null);

  // 슬롯 정보 로드
  const loadSlots = async () => {
    setLoadingSlots(true);
    setSlotSettingsError('');
    try {
      const settings = await getSellerLogicSlots();
      if (!mounted.current) return;
      setSlotSettings(settings);
      setSlot(settings.primarySlot);
    } catch (e: any) {
      if (mounted.current) {
        setSlotSettingsError(e.message || '기존 AI 슬롯 설정을 불러오지 못했습니다.');
      }
    } finally {
      if (mounted.current) setLoadingSlots(false);
    }
  };

  // 초기화 및 서비스 인스턴스 생성
  useEffect(() => {
    mounted.current = true;
    void loadSlots();

    // STT 어휘 매니저 초기화 (첫번째 즉시 0ms + 두번째부터 5초 쿨다운 룰)
    vocabManagerRef.current = new SttVocabularyManager({
      maxVocabularySize: 50,
      batchCooldownMs: 5000,
      onUpdate: (event) => {
        setCurrentVocabulary(event.vocabularyWithPronunciations);
        setHandoverCount((prev) => prev + 1);
        if (captureServiceRef.current) {
          captureServiceRef.current.handoverToNewSession(
            event.vocabularyWithPronunciations,
            event.triggerType === 'IMMEDIATE_FIRST' ? '첫 번째 구매의사자 즉시 교체 (0ms)' : '5초 쿨다운 배치 만료 교체'
          );
        }
      },
      onDebugLog: (log) => {
        setSttDebugLogs((prev) => [...prev.slice(-150), log]);
      }
    });

    // 무중단 캡처 서비스 초기화
    captureServiceRef.current = new SttSeamlessCaptureService({
      ringBufferSeconds: 15,
      onDebugLog: (log) => {
        setSttDebugLogs((prev) => [...prev.slice(-150), log]);
      }
    });

    // 기본 예시 데이터 파싱
    try {
      const parsed = parseSellerLogic02AntiText(inputText, broadcastDate, sessionRef.current);
      setEvidence(parsed);
      rowsRef.current = parsed;
      const nicks = parsed.comments.map((c) => c.nickname);
      vocabManagerRef.current.seedInitialNicknames(nicks);
      setCurrentVocabulary(vocabManagerRef.current.getSttPayloadVocabulary());
    } catch (_err) {}

    return () => {
      mounted.current = false;
      if (vocabManagerRef.current) vocabManagerRef.current.destroy();
      if (captureServiceRef.current) captureServiceRef.current.stopCapture();
      if (captureRef.current) captureRef.current.stop();
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, []);

  // 콘솔 자동 스크롤
  useEffect(() => {
    if (autoScrollAi && aiConsoleRef.current) {
      aiConsoleRef.current.scrollTop = aiConsoleRef.current.scrollHeight;
    }
  }, [aiDebugLogs, autoScrollAi]);

  useEffect(() => {
    if (autoScrollStt && sttConsoleRef.current) {
      sttConsoleRef.current.scrollTop = sttConsoleRef.current.scrollHeight;
    }
  }, [sttDebugLogs, autoScrollStt]);

  // AI 디버그 로그 핸들러
  const handleAiDebugLog = (log: AiDebugLog) => {
    setAiDebugLogs((prev) => [...prev.slice(-150), log]);
  };

  // 1. 실시간 청취 시작 / 종료 (이미지 1의 핵심 동작)
  const handleStartLiveCapture = async () => {
    if (live.isListening || commentCapture.isActive) {
      setErrorMessage('기존 청취와 댓글 수집을 종료한 뒤 시작해 주세요.');
      return;
    }
    if (!username.trim()) {
      setErrorMessage('방송 TikTok 아이디를 입력해 주세요.');
      return;
    }
    if (!live.sonioxApiKey) {
      setErrorMessage('회원 관리 & STT에서 Soniox API 키를 설정해 주세요.');
      return;
    }

    setStarting(true);
    setCapturing(true);
    setErrorMessage('');
    setStatusMessage('실시간 청취 연결 중… 음성과 댓글을 기다립니다.');

    const service = new SellerLogicCapture();
    captureRef.current = service;
    if (captureServiceRef.current) captureServiceRef.current.startCapture();

    try {
      await service.start({
        username: username.trim().replace(/^@/u, ''),
        serverUrl: commentCapture.config.serverUrl,
        sessionId: sessionRef.current,
        stt: {
          provider: 'SONIOX',
          apiKey: live.sonioxApiKey,
          model: 'nova-3',
          language: 'ko',
          keyterms: currentVocabulary,
          punctuate: true,
          interimResults: true,
          endpointing: 800,
          allowBrowserSpeechFallback: false
        },
        comment: (c) => {
          if (!mounted.current) return;
          const rows = rowsRef.current;
          if (rows.comments.some((r) => r.id === c.id)) return;
          const updated = { ...rows, comments: [...rows.comments, c] };
          rowsRef.current = updated;
          setEvidence(updated);

          // 구매의사 감지 후 STT 어휘 매니저에 등록 (첫 번째 즉시 0ms / 두 번째 5초 쿨다운 룰)
          const isIntent = /^(ㅈㅇ|저요|저여|저용|나나|나줘|콜|1|2|6|7)/u.test(c.content);
          if (vocabManagerRef.current) {
            vocabManagerRef.current.registerNickname(c.nickname, isIntent);
          }
        },
        transcript: (t) => {
          if (!mounted.current) return;
          const rows = rowsRef.current;
          const existing = rows.transcripts.findIndex((r) => r.id === t.id);
          const updatedTranscripts = existing < 0
            ? [...rows.transcripts, t]
            : rows.transcripts.map((r, i) => (i === existing ? t : r));
          const updated = { ...rows, transcripts: updatedTranscripts };
          rowsRef.current = updated;
          setEvidence(updated);
        },
        status: (msg) => {
          if (!mounted.current) return;
          setStatusMessage(msg);
          if (msg.startsWith('청취 중지')) {
            setErrorMessage(msg);
            void handleStopLiveCapture();
          }
        }
      });
      setStatusMessage(`방송 [${username}] 실시간 청취 중 · AI 자율 판단 대기`);
    } catch (err: any) {
      setErrorMessage(err.message || '청취 시작 실패');
      await handleStopLiveCapture();
    } finally {
      setStarting(false);
    }
  };

  const handleStopLiveCapture = async () => {
    setStarting(true);
    setStatusMessage('청취를 종료하고 잔여 음성을 마무리합니다…');
    if (captureRef.current) {
      await captureRef.current.stop();
      captureRef.current = null;
    }
    if (captureServiceRef.current) {
      captureServiceRef.current.stopCapture();
    }
    setCapturing(false);
    setStarting(false);
    setStatusMessage('실시간 청취 종료 완료.');
  };

  // 프리셋 로드
  const handleLoadPreset = (method: 1 | 2) => {
    const text = method === 1 ? SELLER_LOGIC_METHOD1_EXAMPLE : SELLER_LOGIC_METHOD2_EXAMPLE;
    setInputText(text);
    try {
      const parsed = parseSellerLogic02AntiText(text, broadcastDate, `session-preset-${method}`);
      setEvidence(parsed);
      rowsRef.current = parsed;
      setAnalysisResult(null);
      if (vocabManagerRef.current) {
        vocabManagerRef.current.seedInitialNicknames(parsed.comments.map((c) => c.nickname));
        setCurrentVocabulary(vocabManagerRef.current.getSttPayloadVocabulary());
      }
      setStatusMessage(`판매방식 ${method} 프리셋 데이터를 성공적으로 불러왔습니다.`);
    } catch (e: any) {
      alert(`파싱 오류: ${e.message}`);
    }
  };

  // 1회 일괄 AI 분석 실행
  const handleRunFullAnalysis = async () => {
    if (!evidence.comments.length && !evidence.transcripts.length) {
      alert('먼저 대화 데이터를 입력하거나 실시간 청취를 진행해 주세요.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const res = await runSellerLogic02AntiAnalysis(
        {
          sessionId: sessionRef.current,
          slotNumber: slot,
          comments: evidence.comments,
          transcripts: evidence.transcripts
        },
        { onDebugLog: handleAiDebugLog }
      );
      setAnalysisResult(res);
    } catch (err: any) {
      alert(`분석 중 오류 발생: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 실시간 시뮬레이션 플레이어
  const handleStartSimulation = () => {
    if (!evidence.comments.length && !evidence.transcripts.length) {
      alert('시뮬레이션할 데이터가 없습니다.');
      return;
    }

    setSimulating(true);
    setAnalysisResult(null);
    if (captureServiceRef.current) captureServiceRef.current.startCapture();

    const allEvents = [
      ...evidence.comments.map((c) => ({ type: 'COMMENT' as const, time: Date.parse(c.capturedAt), data: c })),
      ...evidence.transcripts.map((t) => ({ type: 'SPEECH' as const, time: Date.parse(t.recognizedAt), data: t }))
    ].sort((a, b) => a.time - b.time);

    let currentIndex = 0;
    const accumulatedComments: any[] = [];
    const accumulatedTranscripts: any[] = [];

    setSimProgress({ current: 0, total: allEvents.length });
    if (simTimerRef.current) clearInterval(simTimerRef.current);

    simTimerRef.current = setInterval(async () => {
      if (currentIndex >= allEvents.length) {
        clearInterval(simTimerRef.current);
        setSimulating(false);
        return;
      }

      const event = allEvents[currentIndex];
      currentIndex++;
      setSimProgress({ current: currentIndex, total: allEvents.length });

      if (event.type === 'COMMENT') {
        accumulatedComments.push(event.data);
        const isIntent = /^(ㅈㅇ|저요|저여|저용|나나|나줘|콜|1|2|6|7)/u.test(event.data.content);
        if (vocabManagerRef.current) {
          vocabManagerRef.current.registerNickname(event.data.nickname, isIntent);
        }
      } else {
        accumulatedTranscripts.push(event.data);
      }

      // 8개 이벤트마다 AI 자율 판단 동기화
      if (currentIndex % 8 === 0 || currentIndex === allEvents.length) {
        try {
          const partialResult = await runSellerLogic02AntiAnalysis(
            {
              sessionId: 'session-sim',
              slotNumber: slot,
              comments: [...accumulatedComments],
              transcripts: [...accumulatedTranscripts]
            },
            { onDebugLog: handleAiDebugLog }
          );
          setAnalysisResult(partialResult);
        } catch (_e) {}
      }
    }, 120);
  };

  const handleStopSimulation = () => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
    setSimulating(false);
    if (captureServiceRef.current) captureServiceRef.current.stopCapture();
  };

  const resetAll = () => {
    handleStopSimulation();
    if (capturing) void handleStopLiveCapture();
    sessionRef.current = crypto.randomUUID();
    const empty: SellerLogic02AntiEvidence = { comments: [], transcripts: [] };
    setEvidence(empty);
    rowsRef.current = empty;
    setAnalysisResult(null);
    setStatusMessage('새 분석을 준비했습니다.');
    setErrorMessage('');
    setAiDebugLogs([]);
    setSttDebugLogs([]);
  };

  // 통계 계산
  const confirmedCount = analysisResult?.decisions.filter((d) => d.status === 'CONFIRMED').length ?? 0;
  const totalConfirmedPrice = analysisResult?.decisions
    .filter((d) => d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + (d.unitPrice ?? 0) * d.quantity, 0) ?? 0;

  const sellerTranscripts = [...evidence.transcripts].reverse().slice(0, visibleTimelineLimit);
  const recentComments = [...evidence.comments].reverse().slice(0, visibleCommentLimit);

  return (
    <div className="mx-auto max-w-[1560px] space-y-6 p-4 md:p-8 bg-slate-50 text-slate-800 antialiased">
      {/* 1. 상단 타이틀 & 헤더 */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-600">
            <Bot size={16} /> AI AUTONOMOUS LIVE ANALYSIS 02ANTI
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">판매자 로직분석02anti</h1>
          <p className="mt-2 text-sm text-slate-500">
            100% AI 자율 판단(발화 의미/음성 닉네임 교차 매칭) + STT 선행 즉시(0ms) & 후속 5초 쿨다운 무중단 세션 엔진
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={`${button} border border-slate-200 bg-white hover:bg-slate-100 text-slate-700`}
            disabled={capturing || simulating}
            onClick={resetAll}
          >
            <RotateCcw size={16} /> 새 분석
          </button>
        </div>
      </header>

      {/* =========================================================================
          사용자 요청 이미지 1: 실시간 청취 및 판매 AI 슬롯 설정 카드
          ========================================================================= */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
          {/* 방송 TikTok 아이디 */}
          <label className="space-y-2 text-sm font-semibold">
            방송 TikTok 아이디
            <input
              className={field}
              aria-label="방송 TikTok 아이디"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={capturing || simulating}
              placeholder="@방송아이디"
            />
          </label>

          {/* 판매 AI 설정의 슬롯 */}
          <label className="space-y-2 text-sm font-semibold">
            판매 AI 설정의 슬롯
            <select
              className={field}
              aria-label="분석 AI 슬롯"
              value={slot}
              disabled={capturing || simulating || loadingSlots}
              onChange={(e) => setSlot(Number(e.target.value) as 1 | 2)}
            >
              {slotSettings ? (
                slotSettings.slots.map((configured) => (
                  <option key={configured.slotNumber} value={configured.slotNumber}>
                    슬롯 {configured.slotNumber} · {configured.provider} / {configured.model}
                  </option>
                ))
              ) : (
                <>
                  <option value={1}>슬롯 1 · LM_STUDIO / gemma-4-e4b-it</option>
                  <option value={2}>슬롯 2 · GEMINI / gemini-2.5-pro</option>
                </>
              )}
            </select>
          </label>

          {/* 실시간 청취 시작 / 종료 버튼 */}
          {capturing ? (
            <button
              type="button"
              className={`${button} bg-rose-600 hover:bg-rose-700 text-white shadow-sm`}
              disabled={starting}
              onClick={() => void handleStopLiveCapture()}
            >
              <Square size={16} />
              {starting ? '연결 처리 중…' : '청취 종료'}
            </button>
          ) : (
            <button
              type="button"
              className={`${button} bg-brand-600 hover:bg-brand-700 text-white shadow-sm bg-blue-600`}
              disabled={starting || simulating}
              onClick={() => void handleStartLiveCapture()}
            >
              <Radio size={16} />
              실시간 청취 시작
            </button>
          )}
        </div>

        {/* 설명 및 설정 링크 */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>Soniox 음성 + 플랫폼 댓글 · 5초마다 새 시간대 심층 분석 · 최근 닉네임 50개 STT 힌트</span>
          <Link className="font-semibold text-blue-600 hover:underline" to="/admin/ai">
            판매 AI 설정(보류·정정) →
          </Link>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          기존 판매 AI 설정의 슬롯과 API 키를 그대로 사용합니다.
          {slotSettings && ` 운영 적용 버전 v${slotSettings.appliedVersion || 33}`}
        </p>

        {slotSettingsError && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            <span>{slotSettingsError}</span>
            <button className="font-semibold underline" disabled={loadingSlots} onClick={() => void loadSlots()}>
              슬롯 다시 불러오기
            </button>
          </div>
        )}
      </section>

      {/* 에러 및 상태 안내 배너 */}
      {errorMessage && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {errorMessage}
        </div>
      )}

      {/* 프리셋 및 시뮬레이션 컨트롤 */}
      <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">방송 프리셋 불러오기:</span>
          <button
            type="button"
            disabled={capturing || simulating}
            onClick={() => handleLoadPreset(1)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
          >
            판매방식 1 (호명형 대화)
          </button>
          <button
            type="button"
            disabled={capturing || simulating}
            onClick={() => handleLoadPreset(2)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
          >
            판매방식 2 (숫자/초스피드형)
          </button>
        </div>

        <div className="flex items-center gap-2">
          {!simulating ? (
            <button
              type="button"
              disabled={capturing}
              onClick={handleStartSimulation}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
            >
              <Play className="w-3.5 h-3.5" />
              실시간 재생 시뮬레이션 시작
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStopSimulation}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
            >
              <Square className="w-3.5 h-3.5" />
              시뮬레이션 중지 ({simProgress.current}/{simProgress.total})
            </button>
          )}

          <button
            type="button"
            disabled={isAnalyzing || simulating || capturing}
            onClick={handleRunFullAnalysis}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isAnalyzing ? 'AI 자율 분석 중...' : '전체 데이터 일괄 분석'}
          </button>
        </div>
      </section>

      {/* 핵심 지표 통계 카드 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>판매 확정 건수</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {confirmedCount} <span className="text-xs font-normal text-slate-500">건</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>확정 총 매출액</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-indigo-600 mt-2">
            {totalConfirmedPrice.toLocaleString()} <span className="text-xs font-normal text-slate-500">원</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>구매의사 감지 댓글</span>
            <Clock className="w-4 h-4 text-sky-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {analysisResult?.purchaseIntentCommentIds.length ?? 0} <span className="text-xs font-normal text-slate-500">건</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>STT 세션 교체 (0ms/5초)</span>
            <Volume2 className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600 mt-2">
            {handoverCount} <span className="text-xs font-normal text-slate-500">회</span>
          </p>
        </div>
      </section>

      {/* =========================================================================
          사용자 요청 이미지 2: 2열 그리드 실시간 패널 (판매멘트 전사 + 실시간 댓글)
          ========================================================================= */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {/* 좌측 패널: 판매멘트 전사 */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <MessageSquareText size={18} className="text-indigo-600" /> 판매멘트 전사
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              판매자 멘트 {evidence.transcripts.length}개 · 최신순 · 한국 시각
            </p>
          </div>
          <div className="max-h-[520px] overflow-auto p-4">
            {!sellerTranscripts.length ? (
              <p className="py-16 text-center text-sm text-slate-400">수집된 판매자 멘트가 없습니다.</p>
            ) : (
              sellerTranscripts.map((r) => (
                <div key={r.id} className="mb-3 rounded-xl bg-indigo-50/60 border border-indigo-100/60 p-3 text-sm">
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <strong className="text-indigo-700">판매자</strong>
                    <time className="shrink-0 text-slate-400">{time(r.recognizedAt || (r as any).at)}</time>
                  </div>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-800">{r.text}</p>
                </div>
              ))
            )}
            {evidence.transcripts.length > visibleTimelineLimit && (
              <p className="text-center text-xs text-slate-400">
                화면은 최근 {visibleTimelineLimit}개를 표시합니다.
              </p>
            )}
          </div>
        </section>

        {/* 우측 패널: 실시간 댓글 */}
        <section aria-label="실시간 댓글" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-slate-900">
                <MessageSquareText size={18} className="text-emerald-600" /> 실시간 댓글
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                수집한 댓글을 바로 표시합니다. 최근 수집한 댓글이 위에 표시됩니다.
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p className="font-semibold text-slate-700">누적 {evidence.comments.length.toLocaleString()}개</p>
              <p className="mt-1">
                최근 {recentComments.length}개 표시 · 최대 {visibleCommentLimit}개 · 한국 시각
              </p>
            </div>
          </div>
          {!recentComments.length ? (
            <p className="px-5 py-16 text-center text-sm leading-relaxed text-slate-400">
              아직 수집된 댓글이 없습니다.
              <br />
              실시간 청취를 시작하면 댓글이 여기에 표시됩니다.
            </p>
          ) : (
            <ul aria-label="실시간 댓글 목록" className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto overscroll-contain p-2">
              {recentComments.map((comment) => (
                <li key={comment.id} className="px-4 py-3 hover:bg-slate-50/60 rounded-xl transition">
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <strong className="min-w-0 break-words text-slate-800 font-semibold">{comment.nickname}</strong>
                    <time dateTime={comment.capturedAt} className="shrink-0 tabular-nums text-slate-400">
                      {time(comment.capturedAt)}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                    {comment.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {evidence.comments.length > visibleCommentLimit && (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
              화면에는 최근 {visibleCommentLimit}개를 표시합니다.
            </p>
          )}
        </section>
      </div>

      {/* AI 자율 판단 거래 확정 결과 테이블 */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">AI 실시간 거래 확정 현황</h2>
          </div>
          {analysisResult?.model && (
            <span className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 font-medium rounded-full border border-indigo-100">
              분석 모델: {analysisResult.model}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">상태</th>
                <th className="py-3 px-4">확정 시각</th>
                <th className="py-3 px-4">고객 닉네임 (원문)</th>
                <th className="py-3 px-4">판매자 호명 STT</th>
                <th className="py-3 px-4">확정 단가</th>
                <th className="py-3 px-4">수량</th>
                <th className="py-3 px-4">AI 선정 이유 및 교차 매칭 근거</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {!analysisResult || analysisResult.decisions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    아직 확정된 거래 내역이 없습니다. '실시간 청취 시작' 또는 프리셋 분석을 실행하세요.
                  </td>
                </tr>
              ) : (
                analysisResult.decisions.map((dec) => (
                  <tr key={dec.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {dec.status === 'CONFIRMED' ? '판매 확정' : dec.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {new Date(dec.decidedAt).toLocaleTimeString('ko-KR', { hour12: false })}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">{dec.nickname ?? '미식별'}</td>
                    <td className="py-3 px-4 text-indigo-600 font-medium">{dec.spokenNickname ?? '-'}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {dec.unitPrice ? `${dec.unitPrice.toLocaleString()}원` : '미정'}
                    </td>
                    <td className="py-3 px-4">{dec.quantity}개</td>
                    <td className="py-3 px-4 text-slate-600 max-w-md leading-relaxed">{dec.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* =========================================================================
          화면 맨 아래 2개의 실시간 디버그 콘솔창 (스크롤 적용)
          ========================================================================= */}

      {/* 콘솔 1: AI 실시간 통신 콘솔 */}
      <section className="bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
        <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-slate-200">
              AI 실시간 통신 콘솔 (Prompt, Model, Latency, Response JSON)
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-mono">
              {aiDebugLogs.length} logs
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-[11px]">
              {(['ALL', 'REQUEST', 'RESPONSE', 'ERROR'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAiLogFilter(mode)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                    aiLogFilter === mode ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScrollAi}
                onChange={(e) => setAutoScrollAi(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-indigo-500"
              />
              자동스크롤
            </label>

            <button
              type="button"
              onClick={() => setAiDebugLogs([])}
              className="text-slate-400 hover:text-rose-400 transition"
              title="로그 지우기"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div
          ref={aiConsoleRef}
          className="h-64 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-2 select-text"
        >
          {aiDebugLogs.length === 0 ? (
            <div className="text-slate-500 text-center py-10">AI 호출 내역이 여기에 실시간으로 표출됩니다.</div>
          ) : (
            aiDebugLogs
              .filter((log) => aiLogFilter === 'ALL' || log.type === aiLogFilter)
              .map((log) => {
                const isReq = log.type === 'REQUEST';
                const isErr = log.type === 'ERROR';
                return (
                  <div key={log.id} className="border-b border-slate-900 pb-2">
                    <div className="flex items-center gap-2 text-slate-400">
                      <span className="text-slate-500">[{log.timestamp}]</span>
                      <span
                        className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
                          isReq
                            ? 'bg-blue-900/50 text-blue-300'
                            : isErr
                            ? 'bg-rose-900/50 text-rose-300'
                            : 'bg-emerald-900/50 text-emerald-300'
                        }`}
                      >
                        {log.type}
                      </span>
                      <span className="text-indigo-400">슬롯 #{log.slotNumber} ({log.model})</span>
                      <span className="text-slate-200">{log.message}</span>
                    </div>

                    {log.payload && (
                      <pre className="mt-1 p-2 bg-slate-900/80 rounded border border-slate-800/80 text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap">
                        {typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })
          )}
        </div>
      </section>

      {/* 콘솔 2: STT 실시간 전송 콘솔 */}
      <section className="bg-slate-900 text-emerald-300 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
        <div className="bg-slate-800/90 px-4 py-2.5 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-200">
              STT 실시간 전송 콘솔 (최근 50개 어휘 단어장, G2P 발음, 첫번째 즉시 0ms vs 두번째 후속 5초 쿨다운, 듀얼 소켓 핸드오버)
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-mono">
              {sttDebugLogs.length} events
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScrollStt}
                onChange={(e) => setAutoScrollStt(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-emerald-500"
              />
              자동스크롤
            </label>

            <button
              type="button"
              onClick={() => setSttDebugLogs([])}
              className="text-slate-400 hover:text-rose-400 transition"
              title="로그 지우기"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="bg-slate-950/60 p-2.5 border-b border-slate-800 flex flex-wrap gap-1.5 items-center text-[10px] font-mono">
          <span className="text-slate-400 font-semibold">현재 활성 어휘 ({currentVocabulary.length}/50):</span>
          {currentVocabulary.slice(0, 15).map((word, idx) => (
            <span key={idx} className="px-1.5 py-0.5 bg-slate-800 text-emerald-300 rounded border border-emerald-900/40">
              {word}
            </span>
          ))}
          {currentVocabulary.length > 15 && (
            <span className="text-slate-500">외 {currentVocabulary.length - 15}개...</span>
          )}
        </div>

        <div
          ref={sttConsoleRef}
          className="h-64 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-2 select-text"
        >
          {sttDebugLogs.length === 0 ? (
            <div className="text-slate-500 text-center py-10">
              STT 핫스왑 및 소켓 핸드오버 이벤트가 여기에 실시간으로 표출됩니다.
            </div>
          ) : (
            sttDebugLogs.map((log) => {
              const isImmediate = log.type === 'IMMEDIATE_TRIGGER';
              const isBatch = log.type === 'BATCH_COOLDOWN';
              const isHandover = log.type === 'HANDOVER';
              return (
                <div key={log.id} className="border-b border-slate-800/60 pb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">[{log.timestamp}]</span>
                    <span
                      className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
                        isImmediate
                          ? 'bg-amber-400 text-slate-950'
                          : isBatch
                          ? 'bg-cyan-900/80 text-cyan-300'
                          : isHandover
                          ? 'bg-rose-900/80 text-rose-300'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {log.type}
                    </span>
                    <span className="text-emerald-200 font-medium">{log.message}</span>
                  </div>

                  {log.details && (
                    <div className="mt-1 pl-4 text-[10px] text-slate-400">
                      <code>{JSON.stringify(log.details)}</code>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
