import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Radio, Square, Upload, Download, Play, MessageSquareText, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import { useLive } from '../../context/LiveContext';
import { useCommentCapture } from '../../context/CommentCaptureContext';
import { analyzeSellerLogicDeep, getSellerLogicSlots } from '../../services/sellerLogicDeepApi';
import { runSellerLogicDeep, type SellerLogicDeepRunResult } from '../../services/sellerLogicDeepEngine';
import { SellerLogicCapture } from '../../services/sellerLogicCapture';
import { koreanCalendarDate, parseSellerLogicText, SELLER_LOGIC_EXAMPLE, type SellerLogicEvidence } from '../../services/sellerLogicInput';
import { SellerLogicScheduler } from '../../services/sellerLogicScheduler';
import type { SellerLogicDeepDecision } from '../../types/sellerLogicDeep';
import type { SellerLogicSlots } from '../../types/sellerLogicAnalysis';

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm disabled:bg-slate-100';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40';
const visibleCommentLimit = 200;
const visibleTimelineLimit = 200;
const emptyEvidence = (): SellerLogicEvidence => ({ comments: [], transcripts: [] });
const time = (value: string) => new Date(value).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
const statusLabels = { CONFIRMED: '판매 확정', PENDING: '대화 진행 중', REVIEW: '확인 필요', CANCELLED: '취소' };
const statusColors = { CONFIRMED: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-700', REVIEW: 'bg-orange-50 text-orange-700', CANCELLED: 'bg-slate-100 text-slate-500' };
type QueuedAnalysis = { sessionId: string; slotNumber: 1 | 2; comments: SellerLogicEvidence['comments']; transcripts: SellerLogicEvidence['transcripts'] };

export default function SellerLogicAnalysis03DeepPage() {
  const live = useLive();
  const commentCapture = useCommentCapture();
  const [slot, setSlot] = useState<1 | 2>(1);
  const [slotSettings, setSlotSettings] = useState<SellerLogicSlots | null>(null);
  const [slotSettingsError, setSlotSettingsError] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [username, setUsername] = useState(commentCapture.config.tiktokUsername || '');
  const [date, setDate] = useState(koreanCalendarDate);
  const [paste, setPaste] = useState('');
  const [evidence, setEvidence] = useState<SellerLogicEvidence>(emptyEvidence);
  const [result, setResult] = useState<SellerLogicDeepRunResult | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [analysisInterval, setAnalysisInterval] = useState(5);
  const [status, setStatus] = useState('방송을 청취하거나 대화 자료를 불러오면 AI가 시간대별로 구매자와 가격을 판단합니다.');
  const [error, setError] = useState('');
  const [resultSlot, setResultSlot] = useState<1 | 2 | null>(null);
  const [filter, setFilter] = useState('ALL');
  const rowsRef = useRef(evidence);
  const resultRef = useRef<SellerLogicDeepRunResult | null>(null);
  const stateRef = useRef<SellerLogicDeepRunResult['state'] | null>(null);
  const stateSlotRef = useRef<1 | 2 | null>(null);
  const resultSlotRef = useRef<1 | 2 | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const captureFailure = useRef('');
  const prioritizedCommentIds = useRef(new Set<string>());
  const sessionRef = useRef(crypto.randomUUID());
  const slotRef = useRef(slot);
  const analysisIntervalRef = useRef(analysisInterval);
  const selectedSlotExplicitly = useRef(false);
  const slotLoadGeneration = useRef(0);
  const captureRef = useRef<SellerLogicCapture | null>(null);
  const liveMode = useRef(false);
  const runningRef = useRef(false);
  const automaticRef = useRef(false);
  const finalizePending = useRef(false);
  const queueRef = useRef<SellerLogicScheduler<QueuedAnalysis, SellerLogicDeepRunResult> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadSlots = async () => {
    const loadId = ++slotLoadGeneration.current;
    setLoadingSlots(true);
    setSlotSettingsError('');
    try {
      const settings = await getSellerLogicSlots();
      if (!mounted.current || loadId !== slotLoadGeneration.current) return;
      setSlotSettings(settings);
      if (!selectedSlotExplicitly.current) {
        slotRef.current = settings.primarySlot;
        setSlot(settings.primarySlot);
      }
      submit();
    } catch (e) {
      if (mounted.current && loadId === slotLoadGeneration.current) {
        setSlotSettingsError(e instanceof Error ? e.message : '기존 AI 슬롯 설정을 불러오지 못했습니다.');
      }
    } finally {
      if (mounted.current && loadId === slotLoadGeneration.current) setLoadingSlots(false);
    }
  };

  const acceptResult = (next: SellerLogicDeepRunResult) => {
    resultRef.current = next;
    stateRef.current = next.state;
    stateSlotRef.current = next.state.slotNumber;
    const inputSlot = next.state.slotNumber;
    resultSlotRef.current = inputSlot;
    setResult(next);
    setResultSlot(inputSlot);
    setError(captureFailure.current);
    const confirmed = next.decisions.filter((decision) => decision.status === 'CONFIRMED');
    const pending = next.decisions.filter((decision) => decision.status === 'PENDING' || decision.status === 'REVIEW');
    setStatus(next.stats.segmentCalls
      ? `심층 분석 ${next.stats.segmentCalls}개 시간대 · 확정 ${confirmed.length}명 · 확인 필요 ${pending.length}명`
      : '새로 분석할 시간대가 없습니다.');
    const fresh = next.decisions.filter((decision) => (decision.status === 'CONFIRMED' || decision.status === 'PENDING') &&
      decision.nickname && decision.commentIds.some((id) => !prioritizedCommentIds.current.has(id)));
    const names: string[] = [];
    fresh.forEach((decision) => {
      decision.commentIds.forEach((id) => prioritizedCommentIds.current.add(id));
      if (decision.nickname) names.push(decision.nickname);
    });
    if (names.length) captureRef.current?.prioritizeNicknames(names);
  };

  const makeQueue = () => new SellerLogicScheduler<QueuedAnalysis, SellerLogicDeepRunResult>({
    intervalMs: analysisIntervalRef.current * 1000,
    execute: (input) => {
      const controller = new AbortController();
      analysisAbort.current = controller;
      const currentGeneration = generation.current;
      const state = stateSlotRef.current === input.slotNumber && stateRef.current ? stateRef.current : undefined;
      return runSellerLogicDeep(
        { sessionId: input.sessionId, slotNumber: input.slotNumber, comments: input.comments, transcripts: input.transcripts, state },
        (packet) => analyzeSellerLogicDeep(packet, { signal: controller.signal }),
        {
          signal: controller.signal,
          onProgress: (partial) => {
            if (mounted.current && generation.current === currentGeneration && !controller.signal.aborted) acceptResult(partial);
          },
        },
      );
    },
    result: (next) => { if (mounted.current && !analysisAbort.current?.signal.aborted) acceptResult(next); },
    error: (e) => {
      finalizePending.current = false;
      if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') {
        setError('');
        setStatus('AI 분석 중지 · 완료된 결과와 원문은 유지됩니다.');
        return;
      }
      setError(`${e instanceof Error ? e.message : String(e)} 자동 분석을 일시 중지했습니다. 자료는 유지됩니다.`);
      setStatus('분석 실패 · 슬롯 설정을 확인한 뒤 다시 분석해 주세요.');
    },
    state: ({ running: busy, automatic: auto }) => {
      runningRef.current = busy;
      automaticRef.current = auto;
      setRunning(busy); setAutomatic(auto);
      if (!busy && finalizePending.current) {
        finalizePending.current = false;
        queueRef.current?.analyzeNow();
      }
    },
  });

  useEffect(() => {
    mounted.current = true;
    queueRef.current = makeQueue();
    void loadSlots();
    return () => {
      mounted.current = false;
      slotLoadGeneration.current++;
      generation.current++;
      liveMode.current = false;
      finalizePending.current = false;
      analysisAbort.current?.abort();
      queueRef.current?.dispose();
      captureRef.current?.stop();
      captureRef.current = null;
    };
  }, []);

  const submit = (rows = rowsRef.current) => {
    if (!rows.comments.length && !rows.transcripts.length) return;
    queueRef.current?.submit({
      sessionId: sessionRef.current, slotNumber: slotRef.current,
      comments: rows.comments, transcripts: rows.transcripts,
    });
  };
  const stop = async () => {
    const currentGeneration = generation.current;
    const service = captureRef.current;
    if (!service) return;
    captureRef.current = null;
    setStarting(true);
    setStatus('청취를 종료하고 남은 음성의 전사를 기다립니다…');
    await service.stop();
    if (!mounted.current || currentGeneration !== generation.current) return;
    liveMode.current = false;
    setCapturing(false);
    setStarting(false);
    setStatus('청취 종료 · 마지막 대화와 남은 발화를 마감 분석합니다.');
    submit();
    if (rowsRef.current.comments.length || rowsRef.current.transcripts.length) {
      if (runningRef.current) finalizePending.current = true;
      else queueRef.current?.analyzeNow();
    }
  };
  const acceptEvidence = (rows: SellerLogicEvidence) => {
    rowsRef.current = rows;
    setEvidence(rows);
    submit(rows);
  };
  const reset = () => {
    generation.current++;
    liveMode.current = false;
    finalizePending.current = false;
    analysisAbort.current?.abort();
    captureRef.current?.stop();
    captureRef.current = null;
    queueRef.current?.dispose();
    queueRef.current = makeQueue();
    sessionRef.current = crypto.randomUUID();
    rowsRef.current = emptyEvidence();
    resultRef.current = null;
    stateRef.current = null;
    stateSlotRef.current = null;
    resultSlotRef.current = null;
    captureFailure.current = '';
    prioritizedCommentIds.current.clear();
    setEvidence(rowsRef.current);
    setResult(null);
    setResultSlot(null);
    setError('');
    setCapturing(false);
    setStarting(false);
    setRunning(false);
    setAutomatic(false);
    setFilter('ALL');
  };
  const loadText = () => {
    try {
      parseSellerLogicText(paste, date, 'import');
      reset();
      acceptEvidence(parseSellerLogicText(paste, date, sessionRef.current));
      setStatus('대화 자료를 불러왔습니다. 선택한 슬롯으로 AI 심층 분석을 실행해 주세요.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const start = async () => {
    if (!slotSettings || loadingSlots || slotSettingsError) return;
    if (live.isListening || commentCapture.isActive) {
      setError('기존 청취와 댓글 수집을 종료한 뒤 시작해 주세요.'); return;
    }
    if (!username.trim()) { setError('방송 TikTok 아이디를 입력해 주세요.'); return; }
    if (!live.sonioxApiKey) { setError('회원 관리 & STT에서 Soniox API 키를 설정해 주세요.'); return; }
    if (rowsRef.current.comments.length || rowsRef.current.transcripts.length) {
      setError('새 방송을 청취하려면 현재 결과를 내려받은 뒤 새 분석을 눌러 주세요.'); return;
    }
    const currentGeneration = ++generation.current;
    captureFailure.current = '';
    liveMode.current = true;
    setStarting(true); setCapturing(true); setError('');
    const service = new SellerLogicCapture();
    captureRef.current = service;
    const current = () => mounted.current && currentGeneration === generation.current && liveMode.current;
    queueRef.current?.setAutomatic(true);
    try {
      await service.start({
        username: username.trim().replace(/^@/u, ''), serverUrl: commentCapture.config.serverUrl,
        sessionId: sessionRef.current,
        stt: { provider: 'SONIOX', apiKey: live.sonioxApiKey, model: 'nova-3', language: 'ko', keyterms: [],
          punctuate: true, interimResults: true, endpointing: 800, allowBrowserSpeechFallback: false },
        comment: (c) => {
          if (!current()) return;
          const rows = rowsRef.current;
          if (rows.comments.some((r) => r.id === c.id || (r.platformMessageId && r.platformMessageId === c.platformMessageId))) return;
          acceptEvidence({ ...rows, comments: [...rows.comments, c] });
        },
        transcript: (t) => {
          if (!current()) return;
          const rows = rowsRef.current;
          const existing = rows.transcripts.findIndex((r) => r.id === t.id);
          if (existing >= 0 && JSON.stringify(rows.transcripts[existing]) === JSON.stringify(t)) return;
          acceptEvidence({ ...rows, transcripts: existing < 0 ? [...rows.transcripts, t]
            : rows.transcripts.map((row, index) => index === existing ? t : row) });
        },
        status: (message) => {
          if (!current()) return;
          setStatus(message);
          if (message.startsWith('청취 중지')) {
            captureFailure.current = message;
            setError(message);
            void stop();
          }
        },
      });
    } catch (e) {
      if (current()) { setError(e instanceof Error ? e.message : String(e)); await stop(); queueRef.current?.setAutomatic(false); }
    } finally { if (current() && captureRef.current === service) setStarting(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({
      schemaVersion: 1, sessionId: sessionRef.current, exportedAt: new Date().toISOString(),
      slotNumber: resultSlot, ...rowsRef.current, result: resultRef.current,
    }, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `판매자-로직분석03deep-${sessionRef.current}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const decisions = result?.decisions || [];
  const segments = result?.segments || [];
  const confirmed = decisions.filter((d) => d.status === 'CONFIRMED');
  const total = confirmed.reduce((sum, d) => sum + (d.unitPrice || 0) * d.quantity, 0);
  const count = evidence.comments.length + evidence.transcripts.length;
  const processedSegments = result ? Object.keys(result.state.processedSegments).length : 0;
  const recentComments = evidence.comments.slice(-visibleCommentLimit).reverse();
  const timeline = [
    ...evidence.comments.map((c) => ({ id: c.id, at: c.capturedAt, author: c.nickname, text: c.content, kind: 'comment' })),
    ...evidence.transcripts.map((t) => ({ id: t.id, at: t.recognizedAt, author: '판매자', text: t.text, kind: 'speech' })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const segmentDecisions = (commentIds: string[], transcriptIds: string[]) =>
    decisions.filter((d) => d.commentIds.some((id) => commentIds.includes(id)) || d.transcriptIds.some((id) => transcriptIds.includes(id)));

  return <div className="mx-auto max-w-[1560px] space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-600"><Bot size={16} /> AI DEEP TIME-BUCKET ANALYSIS</div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">판매자 로직분석03deep</h1>
        <p className="mt-2 text-sm text-slate-500">AI가 시간대별로 구매 의사·판매자 확정·숫자 역할을 심층 판단해 판매 확정 구매자와 가격을 선정합니다.</p></div>
      <div className="flex gap-2"><button className={`${button} border border-slate-200 bg-white`} disabled={!count} onClick={download}><Download size={16} /> 결과 내려받기</button>
        <button className={`${button} border border-slate-200 bg-white`} disabled={starting || capturing || running} onClick={() => { reset(); setStatus('새 분석을 준비했습니다.'); }}><RotateCcw size={16} /> 새 분석</button></div>
    </header>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="space-y-2 text-sm font-semibold">방송 TikTok 아이디<input className={field} aria-label="방송 TikTok 아이디" value={username} onChange={(e) => setUsername(e.target.value)} disabled={capturing || running} placeholder="@방송아이디" /></label>
        <label className="space-y-2 text-sm font-semibold">판매 AI 설정의 슬롯<select className={field} aria-label="분석 AI 슬롯" value={slot} disabled={running || capturing || loadingSlots || !slotSettings || Boolean(slotSettingsError)} onChange={(e) => {
          const next = Number(e.target.value) as 1 | 2;
          selectedSlotExplicitly.current = true;
          slotRef.current = next;
          if (stateSlotRef.current !== next) { stateRef.current = null; stateSlotRef.current = null; }
          setSlot(next); resultRef.current = null; setResult(null);
          submit();
        }}>
          {slotSettings ? slotSettings.slots.map((configured) => <option key={configured.slotNumber} value={configured.slotNumber}>슬롯 {configured.slotNumber} · {configured.provider} / {configured.model}</option>)
            : <option value={slot}>{loadingSlots ? '기존 슬롯 설정 불러오는 중…' : '기존 슬롯 설정 확인 필요'}</option>}</select></label>
        {capturing ? <button className={`${button} bg-rose-600 text-white`} disabled={starting} onClick={() => void stop()}><Square size={16} />{starting ? '연결 처리 중…' : '청취 종료'}</button>
          : <button className={`${button} bg-brand-600 text-white`} disabled={starting || running || Boolean(count) || loadingSlots || !slotSettings || Boolean(slotSettingsError)} onClick={() => void start()}><Radio size={16} /> 실시간 청취 시작</button>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>Soniox 음성 + 플랫폼 댓글 · {analysisInterval}초마다 새 시간대 심층 분석 · 최근 닉네임 50개 STT 힌트</span>
        <Link className="font-semibold text-brand-600 hover:underline" to="/admin/ai">판매 AI 설정(보류·정정) →</Link>
      </div>
      <p className="mt-2 text-xs text-slate-500">기존 판매 AI 설정의 슬롯과 API 키를 그대로 사용합니다.{slotSettings && ` 운영 적용 버전 v${slotSettings.appliedVersion}`}</p>
      {slotSettingsError && <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><span>{slotSettingsError}</span><button className="font-semibold underline" disabled={loadingSlots} onClick={() => void loadSlots()}>슬롯 다시 불러오기</button></div>}
    </section>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 px-5 py-4 text-sm text-white">
      <div role="status" aria-live="polite" className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${capturing ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} />{running ? `슬롯 ${slot} AI 심층 분석 중 · 시간대 ${processedSegments}개 처리` : status}</div>
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-slate-300">시간대 {segments.length}개 · 처리 {processedSegments}개</span>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={automatic} disabled={loadingSlots || !slotSettings || Boolean(slotSettingsError)} onChange={(e) => queueRef.current?.setAutomatic(e.target.checked)} />변경 시 자동 분석</label>
        <label className="flex items-center gap-2 text-xs">자동 분석 주기<select aria-label="자동 분석 주기" className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-white" value={analysisInterval} onChange={(e) => {
          const seconds = Number(e.target.value);
          analysisIntervalRef.current = seconds;
          setAnalysisInterval(seconds);
          queueRef.current?.setIntervalMs(seconds * 1000);
        }}>{[5, 10, 15, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds}초</option>)}</select></label>
        {running && <button className={`${button} border border-slate-600 text-white`} onClick={() => { queueRef.current?.setAutomatic(false); analysisAbort.current?.abort(); }}>분석 중지</button>}
        <button className={`${button} bg-white text-slate-900`} disabled={running || !count || loadingSlots || !slotSettings || Boolean(slotSettingsError)} onClick={() => {
          setError('');
          submit();
          queueRef.current?.analyzeNow();
        }}><Play size={14} />{running ? '분석 중' : '지금 AI 분석'}</button></div>
    </div>

    <div className="grid gap-4 sm:grid-cols-3">
      {[{ label: '판매 확정 구매자', value: `${confirmed.length}명`, icon: CheckCircle2, color: 'text-emerald-600' },
        { label: '확정 금액', value: `${total.toLocaleString()}원`, icon: Bot, color: 'text-brand-600' },
        { label: '진행 중 · 확인 필요', value: `${decisions.filter((d) => d.status === 'PENDING' || d.status === 'REVIEW').length}명`, icon: Clock, color: 'text-amber-600' }].map(({ label, value, icon: Icon, color }) =>
          <div key={label} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"><Icon className={color} size={24} /><div><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div></div>)}
    </div>

    <section aria-label="시간대별 확정 구매자" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5"><h2 className="flex items-center gap-2 font-bold text-slate-900"><Clock size={18} /> 시간대별 판매 확정 구매자</h2>
        <p className="mt-1 text-xs text-slate-500">30초 이상 대화가 끊기거나 상품이 바뀌면 시간대가 닫힙니다. 각 시간대에서 AI가 선정한 구매자와 가격입니다.</p></div>
      {!segments.length ? <p className="px-6 py-16 text-center text-sm text-slate-500"><Bot className="mx-auto mb-3 text-slate-300" size={34} />분석할 시간대가 없습니다. 방송을 청취하거나 대화 자료를 불러오세요.</p>
        : <div className="divide-y divide-slate-100">{[...segments].reverse().map((segment) => {
          const matched = segmentDecisions(segment.commentIds, segment.transcriptIds).sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));
          const segmentConfirmed = matched.filter((d) => d.status === 'CONFIRMED');
          const open = matched.filter((d) => d.status === 'PENDING' || d.status === 'REVIEW');
          return <article key={segment.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${segment.closed ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-700'}`}>{segment.closed ? '시간대 마감' : '진행 중'}</span>
                <h3 className="text-sm font-bold text-slate-900">{time(segment.startedAt)} ~ {time(segment.endedAt)}</h3></div>
              <span className="text-xs text-slate-500">댓글 {segment.commentIds.length} · 멘트 {segment.transcriptIds.length} · 확정 {segmentConfirmed.length}명</span></div>
            {!segmentConfirmed.length && !open.length ? <p className="mt-3 text-sm text-slate-400">이 시간대에는 AI가 선정한 판매가 없습니다.</p>
              : <div className="mt-3 flex flex-wrap gap-2">{segmentConfirmed.map((decision) => <span key={decision.id} className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <strong>{decision.nickname}</strong>{decision.productName && <span>{decision.productName}</span>}{decision.orderCode && <span>번호 {decision.orderCode}</span>}
                <span className="font-bold tabular-nums">{decision.unitPrice === null ? '가격 확인 필요' : `${(decision.unitPrice * decision.quantity).toLocaleString()}원`}</span>
                {decision.quantity > 1 && <span>× {decision.quantity}</span>}</span>)}
                {open.map((decision) => <span key={decision.id} className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <strong>{decision.nickname || '구매자 확인 필요'}</strong><span>{statusLabels[decision.status]}</span>{decision.unitPrice !== null && <span className="tabular-nums">{(decision.unitPrice * decision.quantity).toLocaleString()}원</span>}</span>)}</div>}
          </article>;
        })}</div>}
    </section>

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-bold text-slate-900">판매 적재함</h2>
          <p className="mt-1 text-xs text-slate-500">{result ? `슬롯 ${resultSlot} · ${result.provider} / ${result.model}` : 'AI 심층 분석을 실행하면 구매자 후보와 가격이 표시됩니다.'}</p></div>
          <select aria-label="판매 상태 필터" className="rounded-lg border border-slate-200 p-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">전체 상태</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        {result?.summary && <p className="border-b border-slate-100 bg-brand-50/40 px-5 py-4 text-sm leading-relaxed text-slate-700">{result.summary}</p>}
        {result && <p className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">슬롯 {resultSlot} 심층 분석 {result.stats.segmentCalls}회 · 시간대 {segments.length}개 · 신호 {result.signals.length}개</p>}
        {!decisions.length ? <div className="px-6 py-16 text-center text-sm text-slate-500"><Bot className="mx-auto mb-3 text-slate-300" size={34} />{result ? 'AI가 아직 판매 후보를 찾지 못했습니다.' : '댓글과 판매자 멘트를 연결해 판매 판단을 기다립니다.'}</div>
          : <div className="divide-y divide-slate-100">{decisions.filter((d) => filter === 'ALL' || d.status === filter).map((d: SellerLogicDeepDecision) => <article key={d.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColors[d.status]}`}>{statusLabels[d.status]}</span><h3 className="font-bold text-slate-900">{d.nickname || '구매자 확인 필요'}</h3></div><div className="text-lg font-bold tabular-nums text-slate-900">{d.unitPrice === null ? '가격 확인 필요' : `${(d.unitPrice * d.quantity).toLocaleString()}원`}</div></div>
            <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500"><span>{time(d.decidedAt)}</span>{d.productName && <span>{d.productName}</span>}{d.orderCode && <span>상품번호 {d.orderCode}</span>}<span>수량 {d.quantity}</span>{d.spokenNickname && d.spokenNickname !== d.nickname && <span>STT 호칭: {d.spokenNickname}</span>}</div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{d.reason}</p>
            <details className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><summary className="cursor-pointer font-semibold text-slate-600">근거 대화 {d.commentIds.length + d.transcriptIds.length}개</summary><div className="mt-3 space-y-2">{timeline.filter((r) => (r.kind === 'comment' ? d.commentIds : d.transcriptIds).includes(r.id)).reverse().map((r) => <div key={`${r.kind}:${r.id}`} className="leading-relaxed"><span className="text-slate-400">{time(r.at)}</span> <strong>{r.author}</strong> · {r.text}</div>)}</div></details>
          </article>)}</div>}
        <p className="border-t border-slate-100 px-5 py-3 text-xs leading-relaxed text-slate-400">이 화면의 AI 심층 분석 결과이며 판매 장부에는 자동 등록되지 않습니다. 결과와 근거 대화는 내려받아 보관할 수 있습니다.</p>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><h2 className="flex items-center gap-2 font-bold text-slate-900"><MessageSquareText size={18} /> 대화 타임라인</h2><p className="mt-1 text-xs text-slate-500">댓글 {evidence.comments.length}개 · 판매자 멘트 {evidence.transcripts.length}개 · 한국 시각</p></div>
        <div className="max-h-[720px] overflow-auto p-4">{!timeline.length ? <p className="py-16 text-center text-sm text-slate-400">수집된 대화가 없습니다.</p> : timeline.slice(0, visibleTimelineLimit).map((r) => <div key={r.id} className={`mb-3 rounded-xl p-3 text-sm ${r.kind === 'speech' ? 'bg-brand-50' : 'bg-slate-50'}`}><div className="mb-1 flex justify-between gap-2 text-xs"><strong className={r.kind === 'speech' ? 'text-brand-700' : 'text-slate-700'}>{r.author}</strong><time className="shrink-0 text-slate-400">{time(r.at)}</time></div><p className="whitespace-pre-wrap break-words leading-relaxed">{r.text}</p></div>)}{timeline.length > visibleTimelineLimit && <p className="text-center text-xs text-slate-400">화면은 최근 {visibleTimelineLimit}개를 표시합니다. 분석과 내려받기에는 전체 대화가 포함됩니다.</p>}</div>
      </section>
    </div>

    <section aria-label="실시간 댓글" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div><h2 className="flex items-center gap-2 font-bold text-slate-900"><MessageSquareText size={18} /> 실시간 댓글</h2>
          <p className="mt-1 text-xs text-slate-500">수집한 댓글을 바로 표시합니다. 최근 수집한 댓글이 위에 표시됩니다.</p></div>
        <div className="text-right text-xs text-slate-500"><p className="font-semibold text-slate-700">누적 {evidence.comments.length.toLocaleString()}개</p>
          <p className="mt-1">최근 {recentComments.length}개 표시 · 최대 {visibleCommentLimit}개 · 한국 시각</p></div>
      </div>
      {!recentComments.length ? <p className="px-5 py-10 text-center text-sm leading-relaxed text-slate-400">아직 수집된 댓글이 없습니다.<br />실시간 청취를 시작하면 댓글이 여기에 표시됩니다.</p>
        : <ul aria-label="실시간 댓글 목록" className="max-h-80 divide-y divide-slate-100 overflow-y-auto overscroll-contain sm:max-h-96">
          {recentComments.map((comment) => <li key={comment.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3 text-xs"><strong className="min-w-0 break-words text-slate-800">{comment.nickname}</strong>
              <time dateTime={comment.capturedAt} className="shrink-0 tabular-nums text-slate-400">{time(comment.capturedAt)}</time></div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{comment.content}</p>
          </li>)}
        </ul>}
      {evidence.comments.length > visibleCommentLimit && <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">화면에는 최근 {visibleCommentLimit}개를 표시합니다. 전체 댓글은 분석과 내려받기에 포함됩니다.</p>}
    </section>

    <details open={!count} className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-bold text-slate-900">대화 텍스트로 분석하기</summary>
      <div className="mt-4 space-y-4"><p className="text-sm text-slate-500">[고객 댓글]과 [판매자 멘트]가 포함된 자료를 붙여넣으세요. 자정을 지난 대화는 다음 날짜로 연결합니다.</p>
        <div className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-xs font-semibold">방송 시작 날짜 (한국)<input aria-label="방송 시작 날짜" type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} disabled={capturing || running} /></label>
          <button className={`${button} border border-slate-200`} disabled={capturing || running} onClick={() => setPaste(SELLER_LOGIC_EXAMPLE)}>테스트 예시 불러오기</button>
          <button className={`${button} border border-slate-200`} disabled={capturing || running} onClick={() => fileRef.current?.click()}><Upload size={15} /> 텍스트 파일 열기</button>
          <input type="file" accept=".txt,text/plain" ref={fileRef} className="hidden" aria-label="대화 텍스트 파일" onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            const current = generation.current;
            try { const text = await file.text(); if (mounted.current && current === generation.current) setPaste(text); }
            catch { if (mounted.current) setError('텍스트 파일을 읽지 못했습니다.'); }
          }} /></div>
        <textarea aria-label="분석할 대화 텍스트" className={`${field} min-h-[230px] font-mono leading-relaxed`} value={paste} onChange={(e) => setPaste(e.target.value)} disabled={capturing || running} placeholder={'[고객 댓글]\n오후 11:58:22 · 루비: 저요\n\n[판매자 멘트]\n오후 11:58:31 · 루비 언니 2만 원에 드릴게요.'} />
        <button className={`${button} bg-slate-900 text-white`} disabled={capturing || running || !paste.trim()} onClick={loadText}>대화 자료 적용</button>
        <p className="text-xs text-slate-400">전체 대화는 이 화면을 열어 둔 동안 보관합니다. 자료 적용 시 새 회차로 바뀌므로 필요한 결과는 먼저 내려받아 주세요.</p>
      </div>
    </details>
  </div>;
}
