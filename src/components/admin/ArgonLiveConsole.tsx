import React, { useState, useEffect } from 'react';
import {
  Terminal,
  Copy,
  Trash2,
  Download,
  Check,
  AlertCircle,
  Clock,
  Cpu,
  Hash,
  CheckCircle2,
  Radio,
  BookOpen,
} from 'lucide-react';
import type { ArgonDebugEntry } from '../../services/sellerLogic04Argon';

interface ArgonLiveConsoleProps {
  entries: ArgonDebugEntry[];
  onClear: () => void;
}

interface ResponseCounts {
  total: number;
  decisionsCount: number;
  confirmedCount: number;
  pendingCount: number;
  signalsCount: number;
  contextCount: number;
  summary?: string;
}

function parseCounts(response: unknown): ResponseCounts | null {
  if (!response || typeof response !== 'object') return null;
  const res = response as Record<string, unknown>;
  const decisions = Array.isArray(res.decisions) ? res.decisions : [];
  const signals = Array.isArray(res.signals) ? res.signals : [];
  const context = Array.isArray(res.context) ? res.context : [];
  const total = decisions.length + signals.length + context.length;
  const confirmed = decisions.filter(
    (d) => d && typeof d === 'object' && (d as { status?: string }).status === 'CONFIRMED',
  ).length;
  const pending = decisions.filter(
    (d) =>
      d &&
      typeof d === 'object' &&
      ((d as { status?: string }).status === 'PENDING' || (d as { status?: string }).status === 'REVIEW'),
  ).length;

  return {
    total,
    decisionsCount: decisions.length,
    confirmedCount: confirmed,
    pendingCount: pending,
    signalsCount: signals.length,
    contextCount: context.length,
    summary: typeof res.summary === 'string' ? res.summary : undefined,
  };
}

export const ArgonLiveConsole: React.FC<ArgonLiveConsoleProps> = ({ entries, onClear }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'SYSTEM' | 'INPUT' | 'RESPONSE'>('RESPONSE');
  const [copied, setCopied] = useState(false);

  // 새 로그가 들어오면 자동으로 최신 항목 선택
  useEffect(() => {
    if (entries.length > 0 && (!selectedId || !entries.some((e) => e.id === selectedId))) {
      setSelectedId(entries[0].id);
    }
  }, [entries, selectedId]);

  const currentEntry = entries.find((e) => e.id === selectedId) || entries[0] || null;
  const currentCounts = currentEntry ? parseCounts(currentEntry.rawResponse || currentEntry.parsedResponse) : null;
  const totalResponseEntries = entries.filter((e) => e.status === 'RESPONSE').length;

  const handleCopy = async () => {
    if (!currentEntry) return;
    const content = `=== [1] 사용한 프롬프트 (System Prompt) ===
${currentEntry.systemPrompt}

=== [2] 전달한 내용 (User Prompt & Input Payload) ===
${typeof currentEntry.inputPayload === 'string' ? currentEntry.inputPayload : JSON.stringify(currentEntry.inputPayload, null, 2)}

=== [3] 응답받은 내용 (AI Response) - 총 ${currentCounts?.total ?? 0}건 수신 (판정 ${currentCounts?.decisionsCount ?? 0}건, 신호 ${currentCounts?.signalsCount ?? 0}건, 문맥 ${currentCounts?.contextCount ?? 0}건) ===
${currentEntry.rawResponse ? (typeof currentEntry.rawResponse === 'string' ? currentEntry.rawResponse : JSON.stringify(currentEntry.rawResponse, null, 2)) : (currentEntry.error ? `오류: ${currentEntry.error}` : '응답 대기 중...')}`;

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('클립보드 복사 실패:', e);
    }
  };

  const handleDownload = () => {
    if (!entries.length) return;
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `argon04-live-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return (
        d.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        '.' +
        String(d.getMilliseconds()).padStart(3, '0')
      );
    } catch {
      return iso;
    }
  };

  return (
    <section
      aria-label="실시간 AI 프롬프트 및 응답 라이브 콘솔"
      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl font-mono text-xs"
    >
      {/* 1. 최상단 콘솔 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Terminal size={16} className="text-emerald-400" />
          <span className="font-bold tracking-tight text-slate-100">
            실시간 AI 호출 프롬프트 & 응답 라이브 콘솔
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 border border-slate-700">
            LIVE TERMINAL
          </span>
          {entries.length > 0 && (
            <span className="rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 text-[10px] font-bold">
              총 {entries.length}회 호출 (응답 완료 {totalResponseEntries}건)
            </span>
          )}
          {currentEntry && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400">
              <span className="text-slate-600">|</span>
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-slate-400" />
                {formatTime(currentEntry.at)}
              </span>
              <span className="flex items-center gap-1">
                <Cpu size={12} className="text-slate-400" />
                슬롯 {currentEntry.slotNumber}
                {currentEntry.model && ` (${currentEntry.model})`}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {currentEntry && (
            <div className="mr-1">
              {currentEntry.status === 'REQUEST' && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-950/80 px-2.5 py-1 text-[11px] font-semibold text-amber-300 border border-amber-800 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  REQUEST 호출중...
                </span>
              )}
              {currentEntry.status === 'RESPONSE' && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 border border-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  RESPONSE 응답완료
                  {currentEntry.durationMs !== undefined && ` (${currentEntry.durationMs}ms)`}
                  {currentCounts && (
                    <span className="ml-1 rounded bg-emerald-900/90 px-1.5 py-0.2 text-[10px] font-bold text-emerald-200">
                      응답 {currentCounts.total}건 수신 (판정 {currentCounts.decisionsCount}건, 신호 {currentCounts.signalsCount}건)
                    </span>
                  )}
                </span>
              )}
              {currentEntry.status === 'ERROR' && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-950/80 px-2.5 py-1 text-[11px] font-semibold text-rose-300 border border-rose-800">
                  <AlertCircle size={12} />
                  ERROR 오류
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            disabled={!currentEntry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white disabled:opacity-40"
            title="현재 선택된 호출의 프롬프트와 응답 전체 복사"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? '복사됨!' : '프롬프트/응답 복사'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!entries.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white disabled:opacity-40"
            title="디버그 로그 전체를 JSON 파일로 다운로드"
          >
            <Download size={13} />
            <span className="hidden sm:inline">디버그 로그 JSON 내려받기</span>
            <span className="sm:hidden">내려받기</span>
          </button>

          <button
            type="button"
            onClick={onClear}
            disabled={!entries.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-400 transition hover:bg-rose-950 hover:text-rose-200 disabled:opacity-40"
            title="콘솔 로그 비우기"
          >
            <Trash2 size={13} />
            <span className="hidden sm:inline">콘솔 비우기</span>
          </button>
        </div>
      </div>

      {/* 2. 호출 히스토리 타임라인 바 */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-800/80 bg-slate-900/40 px-4 py-2 scrollbar-thin scrollbar-thumb-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
            호출 이력 ({entries.length}건):
          </span>
          {entries.map((entry) => {
            const isSelected = entry.id === (currentEntry?.id || '');
            const counts = parseCounts(entry.rawResponse || entry.parsedResponse);
            const badgeColor =
              entry.status === 'RESPONSE'
                ? isSelected
                  ? 'bg-emerald-900/80 text-emerald-200 border-emerald-500'
                  : 'bg-emerald-950/40 text-emerald-400 border-emerald-900/60 hover:bg-emerald-900/40'
                : entry.status === 'ERROR'
                ? isSelected
                  ? 'bg-rose-900/80 text-rose-200 border-rose-500'
                  : 'bg-rose-950/40 text-rose-400 border-rose-900/60 hover:bg-rose-900/40'
                : isSelected
                ? 'bg-amber-900/80 text-amber-200 border-amber-500 animate-pulse'
                : 'bg-amber-950/40 text-amber-400 border-amber-900/60 hover:bg-amber-900/40';

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition border flex items-center gap-1.5 ${badgeColor}`}
              >
                <span>{formatTime(entry.at)}</span>
                <span className="text-[10px] opacity-75">#{entry.segmentId.slice(-4)}</span>
                {entry.status === 'RESPONSE' && counts && (
                  <span className="rounded bg-emerald-800/60 px-1 text-[10px] font-bold text-emerald-200">
                    응답 {counts.total}개
                  </span>
                )}
                {entry.durationMs !== undefined && (
                  <span className="text-[9px] opacity-60">{entry.durationMs}ms</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 3. 메인 콘텐츠 영역: 탭 + 상세 뷰어 */}
      {!currentEntry ? (
        <div className="py-16 text-center text-slate-500">
          <Terminal size={32} className="mx-auto mb-2 text-slate-700" />
          <p className="text-sm font-medium">아직 AI 호출 기록이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-600">
            실시간 청취를 시작하거나 분석이 실행되면 실시간 프롬프트와 응답이 여기에 출력됩니다.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {/* 탭 네비게이션 */}
          <div className="flex items-center border-b border-slate-800 bg-slate-900/60 px-4 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('SYSTEM')}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 transition ${
                activeTab === 'SYSTEM'
                  ? 'border-brand-500 text-brand-400 bg-slate-800/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>[1] 사용한 프롬프트</span>
              <span className="text-[10px] opacity-70">(System Prompt)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('INPUT')}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 transition ${
                activeTab === 'INPUT'
                  ? 'border-brand-500 text-brand-400 bg-slate-800/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>[2] 전달한 내용</span>
              <span className="text-[10px] opacity-70">(User Payload)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('RESPONSE')}
              className={`flex items-center gap-2 border-b-2 px-3 py-2.5 transition ${
                activeTab === 'RESPONSE'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-800/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>[3] 응답받은 내용</span>
              <span className="text-[10px] opacity-70">(AI Response)</span>
              {currentCounts && (
                <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 px-2 py-0.5 text-[10px] font-bold">
                  총 {currentCounts.total}개 응답
                </span>
              )}
              {currentEntry.status === 'RESPONSE' && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>

          {/* 탭 본문 내용 */}
          <div className="max-h-[380px] overflow-auto p-4 bg-slate-950 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
            {activeTab === 'SYSTEM' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-slate-900">
                  <span>시스템 프롬프트 전문 및 다중 판매방식 규칙 지침</span>
                  <span>{currentEntry.systemPrompt.length.toLocaleString()} 글자</span>
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-300">
                  {currentEntry.systemPrompt}
                </pre>
              </div>
            )}

            {activeTab === 'INPUT' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-slate-900">
                  <span>AI에 전송한 입력 원문 JSON (Timeline, Segment, Context, Candidates)</span>
                  <span className="text-slate-500 font-mono text-[10px]">
                    세그먼트: {currentEntry.segmentId}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-cyan-200/90">
                  {typeof currentEntry.inputPayload === 'string'
                    ? currentEntry.inputPayload
                    : JSON.stringify(currentEntry.inputPayload, null, 2)}
                </pre>
              </div>
            )}

            {activeTab === 'RESPONSE' && (
              <div className="space-y-3">
                {currentEntry.status === 'REQUEST' && (
                  <div className="py-8 text-center text-amber-400/90 animate-pulse">
                    <p className="font-semibold text-sm">AI 슬롯 모델이 시간대 분석을 수행 중입니다...</p>
                    <p className="mt-1 text-xs text-slate-500">잠시만 기다려주세요.</p>
                  </div>
                )}

                {currentEntry.error && (
                  <div className="rounded-xl border border-rose-900/80 bg-rose-950/60 p-3 text-rose-300">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-rose-200 mb-1">
                      <AlertCircle size={14} />
                      AI 호출 오류 발생:
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-[11px] font-mono">
                      {currentEntry.error}
                    </pre>
                  </div>
                )}

                {/* 응답 갯수 요약 대시보드 바 */}
                {currentCounts && (
                  <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-900/40 pb-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={15} className="text-emerald-400" />
                        <span className="font-bold text-emerald-200 text-xs">
                          AI 응답 결과 요약 (총 {currentCounts.total}개 항목 수신)
                        </span>
                      </div>
                      {currentEntry.durationMs !== undefined && (
                        <span className="text-[10px] text-slate-400">
                          응답 소요: <strong className="text-emerald-300">{currentEntry.durationMs}ms</strong>
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                        <div className="text-slate-400 text-[10px]">총 응답 갯수</div>
                        <div className="mt-0.5 text-base font-bold text-emerald-400">
                          {currentCounts.total}
                          <span className="text-xs font-normal text-slate-400 ml-0.5">건</span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                        <div className="text-slate-400 text-[10px]">거래 판정 (Decisions)</div>
                        <div className="mt-0.5 text-base font-bold text-slate-200">
                          {currentCounts.decisionsCount}
                          <span className="text-xs font-normal text-slate-400 ml-0.5">건</span>
                          <span className="ml-1 text-[10px] font-normal text-emerald-400">
                            (확정 {currentCounts.confirmedCount} / 대기 {currentCounts.pendingCount})
                          </span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                        <div className="text-slate-400 text-[10px]">감지 신호 (Signals)</div>
                        <div className="mt-0.5 text-base font-bold text-cyan-300">
                          {currentCounts.signalsCount}
                          <span className="text-xs font-normal text-slate-400 ml-0.5">건</span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                        <div className="text-slate-400 text-[10px]">다음 문맥 (Context)</div>
                        <div className="mt-0.5 text-base font-bold text-amber-300">
                          {currentCounts.contextCount}
                          <span className="text-xs font-normal text-slate-400 ml-0.5">건</span>
                        </div>
                      </div>
                    </div>

                    {currentCounts.summary && (
                      <p className="mt-2.5 rounded-lg bg-slate-900/80 border border-slate-800 p-2 text-[11px] leading-relaxed text-slate-300">
                        <strong className="text-brand-300">AI 요약:</strong> {currentCounts.summary}
                      </p>
                    )}
                  </div>
                )}

                {currentEntry.rawResponse !== undefined && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-slate-900 mb-2">
                      <span className="text-emerald-400 font-semibold">
                        AI 원본 응답 JSON {currentCounts && `(총 ${currentCounts.total}개)`}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-emerald-200/90 max-h-64 overflow-y-auto">
                      {typeof currentEntry.rawResponse === 'string'
                        ? currentEntry.rawResponse
                        : JSON.stringify(currentEntry.rawResponse, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
