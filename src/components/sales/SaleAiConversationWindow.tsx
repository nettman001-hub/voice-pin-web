import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { aiSettingsApi } from '../../services/aiSettingsApi';
import type { SaleRecord } from '../../types/live';
import type { AiTask, AiTaskAttempt } from '../../types/aiTask';

interface ConversationHandle { finishReview: (message?: string) => void }
interface ConversationContextValue {
  openConversation: (sale: Partial<SaleRecord>, options?: { reviewing?: boolean }) => ConversationHandle | null;
}
interface ConversationEntry {
  key: string;
  popup: Window;
  container: HTMLElement;
  sale: Partial<SaleRecord> & { id: string };
  workspaceId: string;
  reviewing: boolean;
  message?: string;
  refreshVersion: number;
}
const ConversationContext = createContext<ConversationContextValue | null>(null);
const PAGE_SIZE = 20;
const popupStyles = `
  :root { color-scheme: light; font-family: "Pretendard", "Malgun Gothic", sans-serif; color: #17243b; background: #f7f9fc; }
  * { box-sizing: border-box; } body { margin: 0; } button, select { font: inherit; }
  button, select { border: 1px solid #cad5e4; background: white; color: #17243b; border-radius: 8px; padding: 9px 12px; }
  button { cursor: pointer; } button:disabled { opacity: .55; cursor: default; }
  button:focus-visible, select:focus-visible { outline: 3px solid #60a5fa; }
  main { max-width: 1280px; margin: auto; padding: 24px; line-height: 1.65; }
  h1 { font-size: 24px; margin: 0; } h2 { font-size: 18px; margin: 0 0 12px; } h3 { font-size: 15px; margin: 0 0 8px; }
  p { margin: 8px 0; overflow-wrap: anywhere; } small { color: #52647d; }
  header, .ai-log-toolbar { display: flex; gap: 12px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
  .ai-log-toolbar { margin: 18px 0; justify-content: flex-start; } select { max-width: 100%; }
  article, .ai-log-empty { background: white; border: 1px solid #dce3ed; border-radius: 12px; padding: 20px; margin: 16px 0; }
  .ai-log-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .ai-log-columns > section { min-width: 0; } .ai-log-notice { border-radius: 8px; background: #edf4ff; padding: 12px; }
  .ai-log-error { border-radius: 8px; color: #992f20; background: #fff1e9; padding: 12px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.75 "Malgun Gothic", monospace; background: #f5f7fb; padding: 14px; border-radius: 8px; margin: 8px 0 16px; max-height: 65vh; overflow: auto; }
  summary { cursor: pointer; font-weight: 600; } .ai-log-meta { color: #52647d; font-size: 13px; }
  @media (max-width: 720px) { main { padding: 16px; } .ai-log-columns { grid-template-columns: 1fr; } }
`;

/** Portals share the existing login, not another live-listening app instance. */
export const SaleAiConversationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspaceId, user, isAuthenticated } = useAuth();
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const windows = useRef(new Map<string, ConversationEntry>());
  const identity = `${isAuthenticated ? user?.id : ''}:${workspaceId || ''}`;

  useEffect(() => {
    const closeAll = () => {
      for (const entry of windows.current.values()) entry.popup.close();
      windows.current.clear();
      setEntries([]);
    };
    window.addEventListener('pagehide', closeAll);
    return () => {
      window.removeEventListener('pagehide', closeAll);
      closeAll();
    };
  }, [identity]);

  const openConversation = useCallback<ConversationContextValue['openConversation']>((sale, options) => {
    if (!isAuthenticated || !workspaceId || !sale.id) {
      window.alert('로그인과 판매 내역의 저장 상태를 확인한 후 다시 열어 주세요.');
      return null;
    }
    const key = `${identity}:${sale.id}`;
    let entry = windows.current.get(key);
    if (!entry || entry.popup.closed) {
      // Must run synchronously in the click gesture, before any cloud request.
      const popup = window.open('', '_blank', 'popup=yes,width=1120,height=820,resizable=yes,scrollbars=yes');
      if (!popup) {
        window.alert('AI 질문·답변 창이 차단되었습니다. 이 사이트의 팝업을 허용한 후 다시 눌러 주세요.');
        return null;
      }
      const doc = popup.document;
      doc.documentElement.lang = 'ko';
      doc.title = '판매 AI 질문·답변 기록';
      const meta = doc.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1';
      const style = doc.createElement('style');
      style.textContent = popupStyles;
      doc.head.append(meta, style);
      const container = doc.createElement('div');
      doc.body.replaceChildren(container);
      entry = { key, popup, container, sale: { ...sale, id: sale.id }, workspaceId,
        reviewing: Boolean(options?.reviewing), refreshVersion: 0 };
      windows.current.set(key, entry);
      popup.addEventListener('pagehide', () => {
        // A stale close event must not remove a subsequently reopened window.
        if (windows.current.get(key)?.popup !== popup) return;
        windows.current.delete(key);
        setEntries([...windows.current.values()]);
      }, { once: true });
    } else {
      entry = { ...entry, sale: { ...sale, id: sale.id }, message: undefined,
        reviewing: entry.reviewing || Boolean(options?.reviewing), refreshVersion: entry.refreshVersion + 1 };
      windows.current.set(key, entry);
      entry.popup.focus();
    }
    setEntries([...windows.current.values()]);
    const openedPopup = entry.popup;
    return { finishReview(message) {
      const current = windows.current.get(key);
      if (!current || current.popup !== openedPopup || current.popup.closed) return;
      windows.current.set(key, { ...current, reviewing: false, message, refreshVersion: current.refreshVersion + 1 });
      setEntries([...windows.current.values()]);
    } };
  }, [identity, isAuthenticated, workspaceId]);

  return <ConversationContext.Provider value={{ openConversation }}>
    {children}
    {entries.filter((entry) => entry.key.startsWith(`${identity}:`) && !entry.popup.closed).map((entry) =>
      createPortal(<SaleAiConversationView entry={entry} />, entry.container, entry.key))}
  </ConversationContext.Provider>;
};

export function useSaleAiConversationWindow(): ConversationContextValue {
  const context = useContext(ConversationContext);
  if (!context) throw new Error('SaleAiConversationProvider가 필요합니다.');
  return context;
}

const taskLabels: Record<string, string> = {
  QUEUED: '검토 대기', PROCESSING: '검토 중', RESOLVED: '검토 완료',
  INSUFFICIENT_DATA: '근거 부족', FAILED: '실패', CANCELLED: '취소',
  RUNNING: '응답 대기', COMPLETED: '응답 수신', EXPIRED: '만료',
};
const dateText = (value?: string) => value ? new Date(value).toLocaleString('ko-KR') : '시각 미기록';

export const AiAttemptConversation: React.FC<{ attempt: AiTaskAttempt }> = ({ attempt }) => {
  const trace = attempt.conversationTrace;
  const legacyResponse = attempt.result?.execution.rawResponse;
  const response = trace?.responseText ?? legacyResponse;
  return <article>
    <h2>AI 슬롯 {attempt.slotNumber} · {taskLabels[attempt.status] || attempt.status}</h2>
    <p className="ai-log-meta">{trace ? `${trace.provider} / ${trace.model} · ` : ''}{dateText(attempt.startedAt)}
      {typeof attempt.latencyMs === 'number' ? ` · ${(attempt.latencyMs / 1000).toFixed(2)}초` : ''}
      {trace?.httpStatus ? ` · HTTP ${trace.httpStatus}` : ''}</p>
    {attempt.errorMessage && <p className="ai-log-error">{attempt.errorMessage}</p>}
    <div className="ai-log-columns">
      <section><h3>AI에게 보낸 질문</h3>
        {trace ? <><details><summary>시스템 지침 원문</summary><pre>{trace.systemPrompt}</pre></details>
          <h3>질문·판매 근거 원문</h3><pre>{trace.userPrompt}</pre></>
          : <p className="ai-log-notice">전송한 질문 원문이 저장되지 않은 기록입니다. 과거 질문을 현재 설정으로 재구성하지 않습니다. 전송 전 오류로 호출되지 않은 경우에도 원문이 없습니다.</p>}
      </section>
      <section><h3>{trace?.responseKind === 'HTTP_ERROR' ? 'AI 서버 오류 응답 원문' : 'AI 답변 원문'}</h3>
        {response !== undefined ? <pre>{response || '(빈 응답)'}</pre>
          : <p className="ai-log-notice">{attempt.status === 'RUNNING' ? 'AI 답변을 기다리고 있습니다.' : '저장된 답변 원문이 없습니다. 시간 초과·연결 실패 또는 원문 미기록 여부를 확인해 주세요.'}</p>}
      </section>
    </div>
  </article>;
};

export const SaleAiConversationView: React.FC<{ entry: ConversationEntry }> = ({ entry }) => {
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollExpired, setPollExpired] = useState(false);
  useEffect(() => { setSelectedId(''); }, [entry.refreshVersion]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60_000;
    setPollExpired(false);
    const read = async () => {
      setLoading(true);
      try {
        const result = await aiSettingsApi.getAiTasks({ workspaceId: entry.workspaceId, saleId: entry.sale.id, limit });
        if (disposed) return;
        // Fail closed even if an incompatible server responds with unfiltered tasks.
        if (result.tasks.some((task) => task.workspaceId !== entry.workspaceId || task.saleId !== entry.sale.id)) {
          throw new Error('판매 내역에 연결되지 않은 AI 기록이 반환되었습니다. 다시 로그인한 후 확인해 주세요.');
        }
        setTasks(result.tasks);
        setError(null);
        setSelectedId((previous) => entry.reviewing || !result.tasks.some((task) => task.taskId === previous)
          ? result.tasks[0]?.taskId || '' : previous);
        const waiting = entry.reviewing || result.tasks.some((task) => task.status === 'QUEUED' || task.status === 'PROCESSING');
        if (waiting && Date.now() < deadline) timer = setTimeout(() => void read(), 2000);
        else if (waiting) setPollExpired(true);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'AI 기록을 불러오지 못했습니다.');
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void read();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [entry.workspaceId, entry.sale.id, entry.refreshVersion, entry.reviewing, limit, refresh]);
  const selected = tasks.find((task) => task.taskId === selectedId) || tasks[0];

  return <main>
    <header><div><h1>판매 AI 질문·답변 기록</h1>
      <p>{entry.sale.buyerNickname || '구매자 미확인'} · {(entry.sale.amount || 0).toLocaleString()}원</p>
      <small>판매 ID: {entry.sale.id}</small></div>
      <button onClick={() => entry.popup.close()}>창 닫기</button></header>
    <p className="ai-log-meta">이 창은 기록 조회 전용입니다. 기록 새로고침은 AI를 다시 호출하지 않습니다. 원래 앱 창을 닫거나 로그아웃하면 이 창도 닫힙니다.</p>
    {entry.reviewing && <p role="status" className="ai-log-notice">AI 검토를 요청했습니다. 저장된 질문·답변을 자동으로 확인하고 있습니다.</p>}
    {entry.message && <p role="status" className="ai-log-notice">{entry.message}</p>}
    {error && <p role="alert" className="ai-log-error">기록 조회 실패: {error}</p>}
    {pollExpired && <p className="ai-log-notice">자동 조회 대기시간이 지났습니다. ‘기록 새로고침’으로 다시 확인해 주세요.</p>}
    <div className="ai-log-toolbar">
      <button disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{loading ? '기록 조회 중…' : '기록 새로고침'}</button>
      {tasks.length > 0 && <label>검토 이력{' '}<select value={selected?.taskId || ''} onChange={(event) => setSelectedId(event.target.value)}>
        {tasks.map((task) => <option key={task.taskId} value={task.taskId}>{dateText(task.createdAt)} · {taskLabels[task.status] || task.status} · {task.taskType === 'VOICE_CORRECTION' ? '음성 정정' : '판매 검토'}</option>)}
      </select></label>}
      {tasks.length >= limit && <button disabled={loading} onClick={() => setLimit((value) => value + PAGE_SIZE)}>이전 기록 더 보기</button>}
    </div>
    {!loading && !error && tasks.length === 0 && <div className="ai-log-empty">아직 저장된 AI 질문·답변 기록이 없습니다. 기존 기록의 원문은 소급해서 복원할 수 없습니다.</div>}
    {selected && <>
      <p className="ai-log-meta">작업 ID: {selected.taskId} · 판매 버전 {selected.saleRevision}</p>
      {selected.switchReason && <p className="ai-log-notice">슬롯 전환: {selected.switchReason}</p>}
      {selected.failureReason && <p className="ai-log-error">{selected.failureReason}</p>}
      {selected.attempts?.map((attempt) => <AiAttemptConversation key={attempt.attemptId} attempt={attempt} />)}
      {!selected.attempts?.length && <article><p>슬롯별 호출 기록이 아직 없거나 저장되지 않았습니다.</p>
        {selected.resolutionResult?.execution.rawResponse !== undefined && <><h3>기존 AI 답변 원문</h3><pre>{selected.resolutionResult.execution.rawResponse}</pre></>}
      </article>}
      {!selected.attempts?.some((attempt) => attempt.conversationTrace) && <details>
        <summary>참고: 저장된 입력 자료 (실제 전송 질문 원문이 아님)</summary><pre>{JSON.stringify(selected.requestPayload, null, 2)}</pre>
      </details>}
    </>}
  </main>;
};
