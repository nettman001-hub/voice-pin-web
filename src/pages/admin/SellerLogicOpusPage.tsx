import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLive } from "../../context/LiveContext";
import { useCommentCapture } from "../../context/CommentCaptureContext";
import { commentStreamService } from "../../services/commentStreamService";
import { logicOpusApi } from "../../services/logicOpus/opusApi";
import { OpusJudgeLoop, type JudgeLogEntry } from "../../services/logicOpus/opusJudgeLoop";
import { OpusCapture } from "../../services/logicOpus/opusCapture";
import { HintRotationScheduler } from "../../services/logicOpus/opusHintPlanner";
import { ledgerTotals, type LedgerApplyResult } from "../../services/logicOpus/opusLedger";
import { mergeTimeline, parseTranscript, replayWindows } from "../../services/logicOpus/opusReplay";
import type { SttManagerStatus } from "../../services/logicOpus/opusSttManager";
import {
  LOGIC_OPUS_SALES_MODE_LABELS,
  type LogicOpusClassification,
  type LogicOpusEvent,
  type LogicOpusProductState,
  type LogicOpusRunSummary,
  type LogicOpusSale,
  type LogicOpusSalesMode,
  type LogicOpusSlot,
  type LogicOpusSlotInfo,
} from "../../types/logicOpus";

const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50";
const button = "rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40";
const ghost = "rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40";

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  PURCHASE_INTENT: { label: "구매의사", cls: "bg-amber-100 text-amber-800" },
  PRODUCT_ANNOUNCE: { label: "상품안내", cls: "bg-sky-100 text-sky-800" },
  PRICE_CHANGE: { label: "가격변경", cls: "bg-violet-100 text-violet-800" },
  SELLER_CONFIRM: { label: "판매확정", cls: "bg-emerald-100 text-emerald-800" },
  OPTION_CHANGE: { label: "옵션변경", cls: "bg-violet-100 text-violet-800" },
  SOLD_OUT: { label: "품절", cls: "bg-rose-100 text-rose-800" },
  CANCEL: { label: "취소", cls: "bg-rose-100 text-rose-800" },
  QUESTION: { label: "질문", cls: "bg-slate-100 text-slate-600" },
  ANSWER: { label: "답변", cls: "bg-slate-100 text-slate-600" },
  CHATTER: { label: "잡담", cls: "bg-slate-50 text-slate-400" },
};

const STATUS_LABEL: Record<LogicOpusSale["status"], { label: string; cls: string }> = {
  CONFIRMED: { label: "확정", cls: "bg-emerald-600 text-white" },
  REVIEW: { label: "검토 필요", cls: "bg-amber-400 text-amber-950" },
  CANCELLED: { label: "취소", cls: "bg-slate-300 text-slate-700" },
};

const PRINT_LABEL: Record<LogicOpusSale["printStatus"], string> = {
  NOT_REQUESTED: "인쇄 전",
  QUEUED: "인쇄 중",
  PRINTED: "인쇄됨",
  FAILED: "인쇄 실패",
};

function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ko-KR", { hour12: false });
}

function won(v: number | null) {
  return v === null ? "가격 미정" : `${v.toLocaleString("ko-KR")}원`;
}

function splitList(text: string) {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

type Tab = "LIVE" | "REPLAY" | "HISTORY";

export default function SellerLogicOpusPage() {
  const live = useLive();
  const capture = useCommentCapture();
  const [tab, setTab] = useState<Tab>("LIVE");
  const [slots, setSlots] = useState<LogicOpusSlotInfo[]>([]);
  const [slotNumber, setSlotNumber] = useState<LogicOpusSlot>(1);
  const [autoFallback, setAutoFallback] = useState(true);
  const [salesMode, setSalesMode] = useState<LogicOpusSalesMode>("AUTO");
  const [sellerNicks, setSellerNicks] = useState("");
  const [fixedWords, setFixedWords] = useState("");
  const [autoPrint, setAutoPrint] = useState(true);
  const [username, setUsername] = useState("");
  const [commentText, setCommentText] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [replayWindowMs, setReplayWindowMs] = useState(8000);

  const [running, setRunning] = useState<null | "LIVE" | "REPLAY">(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sttStatus, setSttStatus] = useState<SttManagerStatus | null>(null);
  const [interim, setInterim] = useState("");
  const [replayProgress, setReplayProgress] = useState<{ done: number; total: number } | null>(null);

  const [events, setEvents] = useState<LogicOpusEvent[]>([]);
  const [classes, setClasses] = useState<Map<string, LogicOpusClassification>>(new Map());
  const [product, setProduct] = useState<LogicOpusProductState | null>(null);
  const [sales, setSales] = useState<LogicOpusSale[]>([]);
  const [aiLog, setAiLog] = useState<JudgeLogEntry[]>([]);
  const [knownNicks, setKnownNicks] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<LogicOpusRunSummary[]>([]);

  const loopRef = useRef<OpusJudgeLoop | null>(null);
  const captureRef = useRef<OpusCapture | null>(null);
  const schedulerRef = useRef<HintRotationScheduler | null>(null);
  const runIdRef = useRef<string | null>(null);
  const autoPrintRef = useRef(autoPrint);
  const lastTermsKeyRef = useRef("");
  const saveQueueRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayAbortRef = useRef(false);
  autoPrintRef.current = autoPrint;

  useEffect(() => {
    logicOpusApi.slots().then((r) => {
      setSlots(r.slots);
      setSlotNumber(r.primarySlot);
      setAutoFallback(r.autoFallbackEnabled);
    }).catch((e) => setError(`AI 슬롯 정보를 불러오지 못했습니다: ${e.message}`));
  }, []);

  const refreshRuns = useCallback(() => {
    logicOpusApi.listRuns().then((r) => setRuns(r.runs)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (tab === "HISTORY") refreshRuns();
  }, [tab, refreshRuns]);

  // 화면을 떠나면 청취 정리
  useEffect(() => () => {
    replayAbortRef.current = true;
    schedulerRef.current?.stop();
    loopRef.current?.stop();
    void captureRef.current?.stop();
  }, []);

  const syncFromLoop = useCallback(() => {
    const loop = loopRef.current;
    if (!loop) return;
    setEvents([...loop.events]);
    setClasses(new Map(loop.classifications));
    setProduct(loop.productState);
    setSales([...loop.sales]);
    setAiLog([...loop.log]);
    setKnownNicks(loop.knownNicknames);
  }, []);

  const flushSave = useCallback(() => {
    const loop = loopRef.current;
    const runId = runIdRef.current;
    saveTimerRef.current = null;
    if (!loop || !runId || !saveQueueRef.current.size) return;
    const ids = saveQueueRef.current;
    saveQueueRef.current = new Set();
    const changed = loop.sales.filter((s) => ids.has(s.id));
    logicOpusApi.saveLedger(runId, changed, loop.sales).catch((e) => setError(`원장 저장 실패: ${e.message}`));
  }, []);

  const queueSave = useCallback((ids: string[]) => {
    ids.forEach((id) => saveQueueRef.current.add(id));
    if (!saveTimerRef.current) saveTimerRef.current = setTimeout(flushSave, 1000);
  }, [flushSave]);

  const printSale = useCallback(async (saleId: string, manual = false) => {
    const loop = loopRef.current;
    const sale = loop?.sales.find((s) => s.id === saleId);
    if (!loop || !sale || sale.price === null) return;
    // 도우미는 saleId:회차가 같으면 다시 찍지 않으므로, 이미 찍힌 건을 다시 찍을 때는 회차를 올린다
    const revision = manual && sale.printStatus === "PRINTED" ? sale.printRevision + 1 : Math.max(1, sale.printRevision);
    loop.updateSale(saleId, { printStatus: "QUEUED", printRevision: revision, printError: undefined });
    const result = await commentStreamService.printSale({
      saleId: `${runIdRef.current}:${sale.id}`,
      printRevision: revision,
      buyerNickname: sale.buyerNickname,
      amount: sale.price * sale.quantity,
      recognizedAt: sale.createdAt,
    });
    const latest = loop.sales.find((s) => s.id === saleId);
    if (!latest || latest.printRevision !== revision) return;
    loop.updateSale(saleId, {
      printStatus: result.ok ? "PRINTED" : "FAILED",
      printError: result.ok ? undefined : result.error,
      history: [...latest.history, {
        at: new Date().toISOString(),
        action: "PRINT",
        summary: result.ok ? `전표 인쇄 (${revision}회차)` : `인쇄 실패: ${result.error}`,
        by: "SYSTEM",
      }],
    });
    queueSave([saleId]);
  }, [queueSave]);

  const handleLedger = useCallback((result: LedgerApplyResult) => {
    const loop = loopRef.current;
    if (!loop) return;
    if (result.rejected.length) setStatus(`AI 원장 변경 무시: ${result.rejected.join(", ")}`);
    for (const id of result.printIds) {
      if (autoPrintRef.current) void printSale(id);
      else loop.updateSale(id, { printStatus: "NOT_REQUESTED" });
    }
    queueSave(result.changedIds);
  }, [printSale, queueSave]);

  const settingsSnapshot = () => ({
    autoFallback,
    autoPrint,
    fixedWords: splitList(fixedWords),
    replayWindowMs,
  });

  const createLoop = (runId: string) => {
    const sellerNicknames = splitList(sellerNicks);
    const loop = new OpusJudgeLoop(
      { runId, slotNumber, autoFallback, salesMode, sellerNicknames },
      {
        judge: (req) => logicOpusApi.judge(req),
        pronounce: (nicks) => logicOpusApi.pronounce(slotNumber, nicks, autoFallback).then((r) => r.pronunciations),
        onLedger: handleLedger,
        onChange: syncFromLoop,
        onHintRequest: () => schedulerRef.current?.request(),
        onError: (m) => setError(m),
      },
    );
    loopRef.current = loop;
    setEvents([]);
    setSales([]);
    setClasses(new Map());
    setProduct(null);
    setAiLog([]);
    setSelected(null);
    return loop;
  };

  const ensureSlotReady = () => {
    const info = slots.find((s) => s.slot === slotNumber);
    if (info && !info.ready) {
      throw new Error(`${slotNumber}번 슬롯을 쓸 수 없습니다: ${info.note || "설정을 확인해 주세요."}`);
    }
  };

  const startLive = async () => {
    setError("");
    try {
      ensureSlotReady();
      if (live.isListening || capture.isActive) {
        throw new Error("기존 라이브 청취와 댓글 수집을 끈 뒤 시작해 주세요.");
      }
      if (!username.trim()) throw new Error("분석할 방송의 TikTok 아이디를 입력해 주세요.");
      if (!live.sonioxApiKey) throw new Error("관리자 Soniox API 키를 먼저 설정해 주세요.");
      const { runId } = await logicOpusApi.startRun({
        mode: "LIVE",
        broadcastUsername: username.trim(),
        slotNumber,
        salesMode,
        sellerNicknames: splitList(sellerNicks),
        settings: settingsSnapshot(),
      });
      runIdRef.current = runId;
      const loop = createLoop(runId);
      const cap = new OpusCapture();
      captureRef.current = cap;
      const fixed = splitList(fixedWords);
      lastTermsKeyRef.current = fixed.join("|");
      schedulerRef.current = new HintRotationScheduler({
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        rotate: async () => {
          const manager = cap.manager;
          if (!manager) return true;
          const { terms } = loop.hintTerms(fixed);
          const key = terms.join("|");
          if (key === lastTermsKeyRef.current) return true; // 바뀐 닉네임이 없으면 교체하지 않음
          const ok = await manager.rotate(terms);
          if (ok) lastTermsKeyRef.current = key;
          return ok;
        },
      });
      setRunning("LIVE");
      setStatus("방송 탭을 선택해 주세요 (탭 오디오 공유 켜기).");
      await cap.start({
        username: username.trim(),
        serverUrl: capture.config.serverUrl,
        sonioxApiKey: live.sonioxApiKey,
        initialTerms: fixed,
        onComment: (e) => loop.addEvent(e),
        onSpeech: (e) => loop.addEvent(e),
        onInterim: setInterim,
        onSttStatus: setSttStatus,
        onStatus: (m) => {
          setStatus(m);
          if (m.startsWith("청취 중지")) void stopLive();
        },
      });
      setStatus("청취 중");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await stopLive();
    }
  };

  const stopLive = async () => {
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    const cap = captureRef.current;
    captureRef.current = null;
    if (cap) await cap.stop();
    const loop = loopRef.current;
    if (loop) {
      await loop.flush();
      syncFromLoop();
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      flushSave();
    }
    if (runIdRef.current) await logicOpusApi.endRun(runIdRef.current).catch(() => undefined);
    setInterim("");
    setRunning(null);
  };

  const startReplay = async () => {
    setError("");
    try {
      ensureSlotReady();
      const comments = parseTranscript(commentText, "COMMENT");
      const speech = parseTranscript(speechText, "SPEECH");
      if (!comments.length && !speech.length) {
        throw new Error("'오후 11:30:57 · 닉네임: 댓글' / '오후 11:30:55 · 멘트' 형식의 기록을 넣어 주세요.");
      }
      const timeline = mergeTimeline(comments, speech);
      const windows = replayWindows(timeline, replayWindowMs);
      const { runId } = await logicOpusApi.startRun({
        mode: "REPLAY",
        broadcastUsername: "",
        slotNumber,
        salesMode,
        sellerNicknames: splitList(sellerNicks),
        settings: { ...settingsSnapshot(), comments: comments.length, speech: speech.length },
      });
      runIdRef.current = runId;
      const loop = createLoop(runId);
      replayAbortRef.current = false;
      setRunning("REPLAY");
      setReplayProgress({ done: 0, total: windows.length });
      for (let i = 0; i < windows.length; i++) {
        if (replayAbortRef.current) break;
        windows[i].forEach((e) => loop.addEvent(e));
        await loop.flush();
        setReplayProgress({ done: i + 1, total: windows.length });
      }
      setStatus(replayAbortRef.current ? "재생을 중단했습니다." : "재생 테스트를 마쳤습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        flushSave();
      }
      if (runIdRef.current) await logicOpusApi.endRun(runIdRef.current).catch(() => undefined);
      setRunning(null);
    }
  };

  const loadRun = async (runId: string) => {
    try {
      const { sales: saved } = await logicOpusApi.getRun(runId);
      loopRef.current = null;
      runIdRef.current = null;
      setSales(saved);
      setEvents([]);
      setClasses(new Map());
      setTab("LIVE");
      setStatus("지난 기록을 불러왔습니다 (읽기 전용).");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const totals = useMemo(() => ledgerTotals(sales), [sales]);
  const eventMap = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const selectedSale = sales.find((s) => s.id === selected) || null;
  const editable = Boolean(loopRef.current);
  const recentEvents = events.slice(-120).reverse();
  const buyers = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    sales.filter((s) => s.status === "CONFIRMED").forEach((s) => {
      const v = map.get(s.buyerNickname) || { count: 0, amount: 0 };
      map.set(s.buyerNickname, { count: v.count + s.quantity, amount: v.amount + (s.price ?? 0) * s.quantity });
    });
    return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [sales]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">판매자 로직분석01opus</h1>
          <p className="text-sm text-slate-500">
            판매자 멘트(Soniox STT)와 댓글을 AI가 실시간으로 읽고 구매자·가격·상품을 확정합니다. 결과는 운영 판매 목록과 분리해 저장합니다.
          </p>
        </div>
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-bold">
          {([["LIVE", "실시간 청취"], ["REPLAY", "재생 테스트"], ["HISTORY", "지난 기록"]] as const).map(([k, label]) => (
            <button
              key={k}
              className={`rounded-lg px-3 py-1.5 ${tab === k ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-3 xl:grid-cols-6">
        <label className="text-xs font-bold text-slate-600">
          AI 슬롯
          <select
            className={field}
            value={slotNumber}
            disabled={!!running}
            onChange={(e) => setSlotNumber(Number(e.target.value) as LogicOpusSlot)}
          >
            {([1, 2] as const).map((n) => {
              const info = slots.find((s) => s.slot === n);
              return (
                <option key={n} value={n}>
                  {n}번 슬롯{info ? ` · ${info.provider} ${info.model}${info.ready ? "" : " (사용 불가)"}` : ""}
                </option>
              );
            })}
          </select>
          {slots.find((s) => s.slot === slotNumber)?.note && (
            <span className="mt-1 block font-normal text-rose-600">{slots.find((s) => s.slot === slotNumber)?.note}</span>
          )}
        </label>
        <label className="text-xs font-bold text-slate-600">
          판매방식
          <select className={field} value={salesMode} disabled={!!running} onChange={(e) => setSalesMode(e.target.value as LogicOpusSalesMode)}>
            {Object.entries(LOGIC_OPUS_SALES_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          판매자·매니저 닉네임 (쉼표)
          <input className={field} value={sellerNicks} disabled={!!running} placeholder="예: 네네" onChange={(e) => setSellerNicks(e.target.value)} />
        </label>
        <label className="text-xs font-bold text-slate-600">
          STT 고정 힌트 단어 (쉼표)
          <input className={field} value={fixedWords} disabled={!!running} placeholder="예: 가디건, 부츠컷, 당가라" onChange={(e) => setFixedWords(e.target.value)} />
        </label>
        <div className="flex flex-col justify-end gap-1 text-xs font-bold text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={autoFallback} disabled={!!running} onChange={(e) => setAutoFallback(e.target.checked)} /> 실패 시 다른 슬롯으로 자동 전환</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} /> 확정 즉시 전표 자동 인쇄</label>
        </div>
        <div className="flex items-end">
          {tab === "LIVE" && (
            <div className="flex w-full gap-2">
              <input className={field} value={username} disabled={!!running} placeholder="TikTok 아이디" onChange={(e) => setUsername(e.target.value)} />
              {running === "LIVE"
                ? <button className={`${button} bg-rose-600`} onClick={() => void stopLive()}>중지</button>
                : <button className={button} disabled={!!running} onClick={() => void startLive()}>청취 시작</button>}
            </div>
          )}
          {tab === "REPLAY" && (
            running === "REPLAY"
              ? <button className={`${button} w-full bg-rose-600`} onClick={() => { replayAbortRef.current = true; }}>재생 중단</button>
              : <button className={`${button} w-full`} disabled={!!running} onClick={() => void startReplay()}>재생 시작</button>
          )}
        </div>
      </section>

      {(error || status) && (
        <div className="space-y-1 text-sm">
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
          {status && <p className="rounded-xl bg-slate-50 px-3 py-2 text-slate-600">{status}</p>}
        </div>
      )}

      {tab === "REPLAY" && (
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-600">
            고객 댓글 기록 (오후 11:30:57 · 닉네임: 댓글)
            <textarea className={`${field} h-48 font-mono text-xs`} value={commentText} disabled={!!running} onChange={(e) => setCommentText(e.target.value)} />
          </label>
          <label className="text-xs font-bold text-slate-600">
            판매자 멘트 기록 (오후 11:30:55 · 멘트)
            <textarea className={`${field} h-48 font-mono text-xs`} value={speechText} disabled={!!running} onChange={(e) => setSpeechText(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 md:col-span-2">
            <label className="flex items-center gap-2 font-bold">
              AI 호출 묶음
              <select className="rounded-lg border border-slate-200 px-2 py-1" value={replayWindowMs} disabled={!!running} onChange={(e) => setReplayWindowMs(Number(e.target.value))}>
                <option value={2000}>방송 2초 (실방송과 비슷)</option>
                <option value={5000}>방송 5초</option>
                <option value={8000}>방송 8초</option>
                <option value={15000}>방송 15초 (빠름)</option>
              </select>
            </label>
            {replayProgress && <span>진행 {replayProgress.done}/{replayProgress.total} 묶음</span>}
            <span>재생 테스트도 실제 AI 슬롯을 호출합니다. 자동 인쇄를 끄면 전표가 나가지 않습니다.</span>
          </div>
        </section>
      )}

      {tab === "HISTORY" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-black">지난 기록</h2>
            <button className={ghost} onClick={refreshRuns}>새로고침</button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">시작</th><th>방식</th><th>방송</th><th>슬롯</th><th>확정</th><th>금액</th><th /></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1.5">{new Date(r.startedAt).toLocaleString("ko-KR")}</td>
                  <td>{r.mode === "LIVE" ? "실시간" : "재생"}</td>
                  <td>{r.broadcastUsername || "-"}</td>
                  <td>{r.slotNumber}번</td>
                  <td>{r.saleCount}건</td>
                  <td>{r.totalAmount.toLocaleString("ko-KR")}원</td>
                  <td><button className={ghost} onClick={() => void loadRun(r.id)}>판매 목록 보기</button></td>
                </tr>
              ))}
              {!runs.length && <tr><td colSpan={7} className="py-4 text-center text-slate-400">기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
            <h2 className="text-lg font-black">판매확정 리스트</h2>
            <div className="flex gap-4 text-sm font-bold">
              <span className="text-emerald-700">확정 {totals.confirmed}건</span>
              <span className="text-amber-700">검토 {totals.review}건</span>
              <span>{totals.amount.toLocaleString("ko-KR")}원</span>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th><th>시각</th><th>구매자 (댓글 닉네임)</th><th>상품 (옵션)</th>
                  <th className="text-right">가격</th><th className="px-2">상태</th><th>전표</th><th />
                </tr>
              </thead>
              <tbody>
                {[...sales].reverse().map((s) => (
                  <React.Fragment key={s.id}>
                    <tr
                      className={`cursor-pointer border-t border-slate-100 ${s.status === "REVIEW" ? "bg-amber-50" : s.status === "CANCELLED" ? "text-slate-400 line-through" : ""} ${selected === s.id ? "ring-2 ring-inset ring-brand-500" : ""}`}
                      onClick={() => setSelected(selected === s.id ? null : s.id)}
                    >
                      <td className="px-3 py-2 text-xs text-slate-400">{s.seq}</td>
                      <td className="text-xs">{time(s.createdAt)}</td>
                      <td className="text-base font-black">
                        {s.buyerNickname}
                        {s.spokenName && s.spokenName !== s.buyerNickname && <span className="ml-1 text-xs font-normal text-slate-400">(멘트: {s.spokenName})</span>}
                      </td>
                      <td>{s.product}{s.option ? <span className="text-slate-500"> ({s.option})</span> : null}{s.quantity > 1 ? ` ×${s.quantity}` : ""}</td>
                      <td className="text-right font-bold">{won(s.price)}</td>
                      <td className="px-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_LABEL[s.status].cls}`}>{STATUS_LABEL[s.status].label}</span>
                        {s.corrected && <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">정정</span>}
                      </td>
                      <td className={`text-xs ${s.printStatus === "FAILED" ? "font-bold text-rose-600" : "text-slate-500"}`}>{PRINT_LABEL[s.printStatus]}</td>
                      <td className="px-2 text-right">
                        {editable && s.status !== "CANCELLED" && (
                          <button className={ghost} disabled={s.price === null} onClick={(e) => { e.stopPropagation(); void printSale(s.id, true); }}>
                            {s.printRevision > 0 ? "재인쇄" : "인쇄"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {s.status === "REVIEW" && (
                      <tr className="bg-amber-50">
                        <td />
                        <td colSpan={7} className="pb-2 text-xs text-amber-900">
                          {s.reviewReasons.join(" · ")}
                          {editable && s.candidates.length > 0 && (
                            <span className="ml-2 inline-flex flex-wrap gap-1">
                              {s.candidates.map((c) => (
                                <button key={c} className={ghost} onClick={() => loopRef.current?.manualEdit(s.id, { buyerNickname: c })}>
                                  {c}로 확정
                                </button>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {!sales.length && (
                  <tr><td colSpan={8} className="py-10 text-center text-slate-400">아직 확정된 판매가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {selectedSale && (
            <SaleDetail
              sale={selectedSale}
              eventMap={eventMap}
              knownNicks={knownNicks}
              editable={editable}
              onSave={(edit) => loopRef.current?.manualEdit(selectedSale.id, edit)}
            />
          )}
          {buyers.length > 0 && (
            <details className="border-t border-slate-100 p-4 text-sm">
              <summary className="cursor-pointer font-bold">구매자별 합계 ({buyers.length}명)</summary>
              <ul className="mt-2 grid gap-1 md:grid-cols-3">
                {buyers.map(([n, v]) => <li key={n}><b>{n}</b> · {v.count}개 · {v.amount.toLocaleString("ko-KR")}원</li>)}
              </ul>
            </details>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-black">현재 판매 상품 (AI 추정)</h2>
            {product ? (
              <div className="space-y-1 text-sm">
                <p className="text-lg font-black">{product.name} <span className="text-base font-bold text-brand-700">{won(product.price)}</span></p>
                {product.salesMode && <p className="text-xs text-slate-500">{LOGIC_OPUS_SALES_MODE_LABELS[product.salesMode]}</p>}
                <div className="flex flex-wrap gap-1">
                  {product.options.map((o, i) => (
                    <span key={i} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs">
                      {o.no !== undefined ? `${o.no}번 ` : ""}{o.label}{o.price ? ` ${won(o.price)}` : ""}{o.limit ? ` (${o.limit}명)` : ""}
                    </span>
                  ))}
                </div>
                {product.note && <p className="text-xs text-slate-500">{product.note}</p>}
              </div>
            ) : <p className="text-sm text-slate-400">아직 없음</p>}
          </section>

          {tab === "LIVE" && sttStatus && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
              <h2 className="mb-1 text-sm font-black text-slate-900">STT 상태</h2>
              <p>{sttStatus.message} · 세션 #{sttStatus.sessionNo} · 힌트 {sttStatus.hintTermCount}개</p>
              <p>교체 {sttStatus.rotations}회 (마지막 겹침 {sttStatus.lastOverlapMs}ms, 병합 제외 {sttStatus.lastMergeDropped}개) · 재연결 {sttStatus.recoveries}회 (다시 보낸 오디오 {sttStatus.lastReplayMs}ms)</p>
              {interim && <p className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-500">🎙️ {interim}</p>}
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-black">실시간 타임라인</h2>
            <div className="max-h-[50vh] space-y-1 overflow-auto text-xs">
              {recentEvents.map((e) => {
                const c = classes.get(e.id);
                const label = c ? TYPE_LABEL[c.type] : null;
                return (
                  <p key={e.id} className={`leading-5 ${c?.type === "CHATTER" ? "text-slate-400" : ""}`}>
                    <span className="text-slate-400">{time(e.at)}</span>{" "}
                    {label ? <span className={`rounded px-1 font-bold ${label.cls}`}>{label.label}</span> : <span className="rounded bg-slate-50 px-1 text-slate-300">판단 중</span>}{" "}
                    {e.kind === "COMMENT" ? <><b>{e.nickname}</b>: {e.text}</> : <span className="text-indigo-900">🎙️ {e.text}</span>}
                  </p>
                );
              })}
              {!recentEvents.length && <p className="text-slate-400">댓글과 멘트가 여기에 표시됩니다.</p>}
            </div>
          </section>

          <details className="rounded-2xl border border-slate-200 bg-white p-4 text-xs">
            <summary className="cursor-pointer text-sm font-black">AI 호출 기록 ({aiLog.length})</summary>
            <ul className="mt-2 space-y-1">
              {[...aiLog].reverse().slice(0, 40).map((l, i) => (
                <li key={i} className={l.error ? "text-rose-600" : "text-slate-600"}>
                  {time(l.at)} · 이벤트 {l.newEvents}개 · {l.usedSlot ? `${l.usedSlot}번 슬롯` : "실패"} · {(l.latencyMs / 1000).toFixed(1)}초 · 원장 변경 {l.ops}
                  {l.error ? ` · ${l.error}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  );
}

function SaleDetail(props: {
  sale: LogicOpusSale;
  eventMap: Map<string, LogicOpusEvent>;
  knownNicks: string[];
  editable: boolean;
  onSave: (edit: { buyerNickname?: string; product?: string; option?: string; price?: number | null; quantity?: number; cancel?: boolean; restore?: boolean }) => void;
}) {
  const { sale } = props;
  const [buyer, setBuyer] = useState(sale.buyerNickname);
  const [productName, setProductName] = useState(sale.product);
  const [option, setOption] = useState(sale.option || "");
  const [price, setPrice] = useState(sale.price === null ? "" : String(sale.price));
  const [qty, setQty] = useState(String(sale.quantity));
  useEffect(() => {
    setBuyer(sale.buyerNickname);
    setProductName(sale.product);
    setOption(sale.option || "");
    setPrice(sale.price === null ? "" : String(sale.price));
    setQty(String(sale.quantity));
  }, [sale.id, sale.buyerNickname, sale.product, sale.option, sale.price, sale.quantity]);

  return (
    <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-4 text-sm md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-black">{sale.id} 근거 · AI 신뢰도 {Math.round(sale.confidence * 100)}%</h3>
        <p className="text-slate-600">{sale.reason}</p>
        <ul className="space-y-1 text-xs">
          {sale.evidence.map((id) => {
            const e = props.eventMap.get(id);
            return (
              <li key={id} className="rounded-lg bg-white px-2 py-1">
                {e ? (e.kind === "COMMENT" ? <>💬 {time(e.at)} <b>{e.nickname}</b>: {e.text}</> : <>🎙️ {time(e.at)} {e.text}</>) : id}
              </li>
            );
          })}
        </ul>
        <ul className="space-y-0.5 text-xs text-slate-500">
          {sale.history.map((h, i) => <li key={i}>{time(h.at)} · {h.by === "AI" ? "AI" : h.by === "ADMIN" ? "관리자" : "시스템"} · {h.summary}</li>)}
        </ul>
      </div>
      {props.editable && (
        <div className="space-y-2">
          <h3 className="font-black">수정 후 확정</h3>
          <label className="block text-xs font-bold text-slate-600">구매자 (댓글 닉네임)
            <input className={field} list="logic-opus-nicks" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
            <datalist id="logic-opus-nicks">{props.knownNicks.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">상품<input className={field} value={productName} onChange={(e) => setProductName(e.target.value)} /></label>
            <label className="text-xs font-bold text-slate-600">옵션<input className={field} value={option} onChange={(e) => setOption(e.target.value)} /></label>
            <label className="text-xs font-bold text-slate-600">가격(원)<input className={field} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} /></label>
            <label className="text-xs font-bold text-slate-600">수량<input className={field} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() => props.onSave({
                buyerNickname: buyer.trim(),
                product: productName.trim() || sale.product,
                option: option.trim() || undefined,
                price: price ? Number(price) : null,
                quantity: Math.max(1, Number(qty) || 1),
              })}
            >
              저장하고 확정
            </button>
            {sale.status === "CANCELLED"
              ? <button className={ghost} onClick={() => props.onSave({ restore: true })}>복구</button>
              : <button className={ghost} onClick={() => props.onSave({ cancel: true })}>판매 취소</button>}
          </div>
          <p className="text-xs text-slate-500">구매자는 댓글에 실제로 있는 닉네임이어야 확정됩니다. 전표에는 구매자와 금액만 인쇄됩니다.</p>
        </div>
      )}
    </div>
  );
}
