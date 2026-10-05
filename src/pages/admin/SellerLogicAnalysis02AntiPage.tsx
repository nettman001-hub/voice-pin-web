import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  Sparkles,
  Cpu,
  Layers,
  ChevronDown,
  Terminal,
  Volume2,
  Zap,
  Radio,
  FileText
} from 'lucide-react';
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

export default function SellerLogicAnalysis02AntiPage() {
  // 1. 상태 변수
  const [broadcastDate, setBroadcastDate] = useState(koreanCalendarDate);
  const [selectedSlot, setSelectedSlot] = useState<1 | 2>(1);
  const [inputText, setInputText] = useState(SELLER_LOGIC_METHOD1_EXAMPLE);
  const [parsedEvidence, setParsedEvidence] = useState<SellerLogic02AntiEvidence | null>(null);

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

  // DOM Refs
  const aiConsoleRef = useRef<HTMLDivElement>(null);
  const sttConsoleRef = useRef<HTMLDivElement>(null);
  const simTimerRef = useRef<any>(null);

  // 서비스 인스턴스 참조
  const vocabManagerRef = useRef<SttVocabularyManager | null>(null);
  const captureServiceRef = useRef<SttSeamlessCaptureService | null>(null);

  // 초기 파싱 및 서비스 인스턴스 생성
  useEffect(() => {
    // STT 어휘 매니저 초기화
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

    // 캡처 서비스 초기화
    captureServiceRef.current = new SttSeamlessCaptureService({
      ringBufferSeconds: 15,
      onDebugLog: (log) => {
        setSttDebugLogs((prev) => [...prev.slice(-150), log]);
      }
    });

    // 초기 예시 데이터 파싱
    try {
      const parsed = parseSellerLogic02AntiText(inputText, broadcastDate, 'session-anti-02');
      setParsedEvidence(parsed);
      // 최근 닉네임 50개 시드
      const nicks = parsed.comments.map((c) => c.nickname);
      vocabManagerRef.current.seedInitialNicknames(nicks);
      setCurrentVocabulary(vocabManagerRef.current.getSttPayloadVocabulary());
    } catch (_err) {
      // ignore
    }

    return () => {
      if (vocabManagerRef.current) vocabManagerRef.current.destroy();
      if (captureServiceRef.current) captureServiceRef.current.stopCapture();
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

  // AI 디버그 로거
  const handleAiDebugLog = (log: AiDebugLog) => {
    setAiDebugLogs((prev) => [...prev.slice(-150), log]);
  };

  // 프리셋 로드
  const handleLoadPreset = (method: 1 | 2) => {
    const text = method === 1 ? SELLER_LOGIC_METHOD1_EXAMPLE : SELLER_LOGIC_METHOD2_EXAMPLE;
    setInputText(text);
    try {
      const parsed = parseSellerLogic02AntiText(text, broadcastDate, `session-preset-${method}`);
      setParsedEvidence(parsed);
      setAnalysisResult(null);
      if (vocabManagerRef.current) {
        vocabManagerRef.current.seedInitialNicknames(parsed.comments.map((c) => c.nickname));
        setCurrentVocabulary(vocabManagerRef.current.getSttPayloadVocabulary());
      }
    } catch (e: any) {
      alert(`파싱 오류: ${e.message}`);
    }
  };

  // 1회 일괄 AI 분석 실행
  const handleRunFullAnalysis = async () => {
    if (!parsedEvidence) {
      alert('먼저 대화 데이터를 입력해 주세요.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const res = await runSellerLogic02AntiAnalysis(
        {
          sessionId: 'session-anti-02-full',
          slotNumber: selectedSlot,
          comments: parsedEvidence.comments,
          transcripts: parsedEvidence.transcripts
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

  // 실시간 시뮬레이션 플레이어 시작
  const handleStartSimulation = () => {
    if (!parsedEvidence || parsedEvidence.comments.length === 0) {
      alert('분석할 데이터가 없습니다.');
      return;
    }

    setSimulating(true);
    setAnalysisResult(null);
    if (captureServiceRef.current) captureServiceRef.current.startCapture();

    // 시간 순 정렬 이벤트 생성
    const allEvents = [
      ...parsedEvidence.comments.map((c) => ({ type: 'COMMENT' as const, time: Date.parse(c.capturedAt), data: c })),
      ...parsedEvidence.transcripts.map((t) => ({ type: 'SPEECH' as const, time: Date.parse(t.recognizedAt), data: t }))
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
        // 구매의사 여부 간이 식별 후 STT 매니저에 전달 (첫번째 즉시 vs 후속 5초 룰 발동 테스트)
        const isIntent = /^(ㅈㅇ|저요|저여|나나|나줘|콜|1|2|6|7)/u.test(event.data.content);
        if (vocabManagerRef.current) {
          vocabManagerRef.current.registerNickname(event.data.nickname, isIntent);
        }
      } else {
        accumulatedTranscripts.push(event.data);
      }

      // 주기적으로(예: 8개 이벤트마다) AI 자율 분석 동기화
      if (currentIndex % 8 === 0 || currentIndex === allEvents.length) {
        try {
          const partialResult = await runSellerLogic02AntiAnalysis(
            {
              sessionId: 'session-sim',
              slotNumber: selectedSlot,
              comments: [...accumulatedComments],
              transcripts: [...accumulatedTranscripts]
            },
            { onDebugLog: handleAiDebugLog }
          );
          setAnalysisResult(partialResult);
        } catch (_e) {
          // ignore
        }
      }
    }, 120); // 120ms 간격 스피드 재생
  };

  const handleStopSimulation = () => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
    setSimulating(false);
    if (captureServiceRef.current) captureServiceRef.current.stopCapture();
  };

  // 통계 계산
  const confirmedCount = analysisResult?.decisions.filter((d) => d.status === 'CONFIRMED').length ?? 0;
  const totalConfirmedPrice = analysisResult?.decisions
    .filter((d) => d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + (d.unitPrice ?? 0) * d.quantity, 0) ?? 0;
  const pendingCount = (analysisResult?.decisions.length ?? 0) - confirmedCount;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6 space-y-6">
      {/* 1. 상단 타이틀 & 헤더 바 */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-md">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">판매자 로직분석02anti</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                AI 자율 판단(구매의사 감지/음성 닉네임 교차 매칭) + STT 선행 즉시(0ms) & 후속 5초 쿨다운 무중단 세션 엔진
              </p>
            </div>
          </div>
        </div>

        {/* AI 슬롯 선택기 (슬롯 1 / 슬롯 2) */}
        <div className="flex items-center gap-3 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setSelectedSlot(1)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              selectedSlot === 1 ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            슬롯 1 (Flash 실시간 초저지연)
          </button>
          <button
            type="button"
            onClick={() => setSelectedSlot(2)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              selectedSlot === 2 ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-violet-500" />
            슬롯 2 (Pro 심층 맥락 추론)
          </button>
        </div>
      </header>

      {/* 2. 핵심 지표 통계 카드 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>판매 확정 건수</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{confirmedCount} <span className="text-xs font-normal text-slate-500">건</span></p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>확정 총 매출액</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-indigo-600 mt-2">{totalConfirmedPrice.toLocaleString()} <span className="text-xs font-normal text-slate-500">원</span></p>
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
            <span>STT 세션 교체(핸드오버)</span>
            <Volume2 className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600 mt-2">{handoverCount} <span className="text-xs font-normal text-slate-500">회</span></p>
        </div>
      </section>

      {/* 3. 데이터 입력 & 프리셋 선택 컨트롤 */}
      <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">방송 프리셋 불러오기:</span>
            <button
              type="button"
              onClick={() => handleLoadPreset(1)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
            >
              판매방식 1 (호명형 대화)
            </button>
            <button
              type="button"
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
                onClick={handleStartSimulation}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
              >
                <Play className="w-3.5 h-3.5" />
                실시간 청취 시뮬레이션 시작
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
              disabled={isAnalyzing || simulating}
              onClick={handleRunFullAnalysis}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-semibold rounded-xl shadow-sm transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isAnalyzing ? 'AI 자율 분석 중...' : '전체 데이터 일괄 분석'}
            </button>
          </div>
        </div>

        {/* 텍스트 입력창 접기/펼치기 가능 */}
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-medium hover:text-slate-800">대화 및 멘트 원문 데이터 보기 / 직접 붙여넣기</summary>
          <textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              try {
                const parsed = parseSellerLogic02AntiText(e.target.value, broadcastDate, 'session-anti-02');
                setParsedEvidence(parsed);
              } catch (_e) {}
            }}
            rows={6}
            className="w-full mt-2 p-3 font-mono text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="[고객 댓글] 및 [판매자 멘트] 형식으로 입력해 주세요."
          />
        </details>
      </section>

      {/* 4. AI 자율 판단 결과 테이블 */}
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
                <th className="py-3 px-4">고객 닉네임 (댓글 원문)</th>
                <th className="py-3 px-4">판매자 호명 멘트</th>
                <th className="py-3 px-4">확정 단가</th>
                <th className="py-3 px-4">수량</th>
                <th className="py-3 px-4">AI 선정 이유 및 교차 매칭 근거</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {(!analysisResult || analysisResult.decisions.length === 0) ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    아직 확정된 거래 내역이 없습니다. '실시간 청취 시뮬레이션' 또는 '전체 데이터 일괄 분석'을 실행하세요.
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
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {dec.nickname ?? '미식별'}
                    </td>
                    <td className="py-3 px-4 text-indigo-600 font-medium">
                      {dec.spokenNickname ?? '-'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {dec.unitPrice ? `${dec.unitPrice.toLocaleString()}원` : '미정'}
                    </td>
                    <td className="py-3 px-4">{dec.quantity}개</td>
                    <td className="py-3 px-4 text-slate-600 max-w-md leading-relaxed">
                      {dec.reason}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* =========================================================================
          사용자 요청 핵심: 화면 맨 아래 2개의 실시간 디버그 콘솔창 (스크롤 적용)
          ========================================================================= */}

      {/* 5-1. 콘솔 1: AI 실시간 통신 콘솔 */}
      <section className="bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
        <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-slate-200">AI 실시간 통신 콘솔 (Prompt, Model, Latency, Response JSON)</h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-mono">
              {aiDebugLogs.length} logs
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* 필터 */}
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

        {/* 스크롤 가능한 AI 로그 뷰어 */}
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

      {/* 5-2. 콘솔 2: STT 전송 값 및 세션 실시간 디버그 콘솔 */}
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

        {/* 현재 STT 세션에 주입된 실시간 어휘 50개 배지 미리보기 */}
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

        {/* 스크롤 가능한 STT 로그 뷰어 */}
        <div
          ref={sttConsoleRef}
          className="h-64 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-2 select-text"
        >
          {sttDebugLogs.length === 0 ? (
            <div className="text-slate-500 text-center py-10">STT 핫스왑 및 소켓 핸드오버 이벤트가 여기에 실시간으로 표출됩니다.</div>
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
