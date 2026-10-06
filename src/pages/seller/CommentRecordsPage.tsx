import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCommentCapture } from '../../context/CommentCaptureContext';
import { useLive } from '../../context/LiveContext';
import { productSalesApi } from '../../services/productSalesApi';
import { remoteWorkspaceService } from '../../services/remoteWorkspaceService';
import { storageService } from '../../services/storageService';
import { CommentRecord } from '../../types/comment';
import { SellerTranscriptRecord } from '../../types/live';
import { LiveSession } from '../../types/productSales';
import { formatSessionDisplay } from '../../utils/sessionFormatter';
import { buildTranscriptCsv, buildTranscriptTxt, filterTranscriptHistory, mergeTranscriptHistory, transcriptActionLabel } from '../../utils/transcriptHistory';
import {
  MessageSquareText,
  Trash2,
  ArrowRight,
  BellRing,
  Search,
  RefreshCw,
  FileText,
  FileSpreadsheet,
  Mic
} from 'lucide-react';

export const CommentRecordsPage: React.FC = () => {
  const { workspaceId, user } = useAuth();
  const recordWorkspaceId = workspaceId || user?.id || '';
  const ownerRef = useRef(recordWorkspaceId);
  ownerRef.current = recordWorkspaceId;
  const refreshGenerationRef = useRef(0);
  const { isActive, isRunning } = useCommentCapture();
  const { currentSessionId, totalSessionTranscriptCount, getCurrentSessionTranscripts } = useLive();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allRecords, setAllRecords] = useState<CommentRecord[]>([]);
  const [cloudSessions, setCloudSessions] = useState<LiveSession[]>([]);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recordKind, setRecordKind] = useState<'comments' | 'transcripts'>('comments');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [cloudTranscriptHistory, setCloudTranscriptHistory] = useState<{ workspaceId: string; records: SellerTranscriptRecord[] }>({ workspaceId: '', records: [] });
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');

  // 필터 상태: 기간 + 검색어
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    const isCurrent = () => ownerRef.current === recordWorkspaceId && refreshGenerationRef.current === generation;
    setIsLoading(true);
    try {
      const [{ comments }, sessionData] = await Promise.all([
        productSalesApi.listLiveComments({ limit: 5000 }),
        productSalesApi.listSessions().catch((error) => {
          console.error('[CommentRecords] 방송 회차 이름 조회 실패', error);
          return { sessions: [] as LiveSession[] };
        }),
      ]);
      if (!isCurrent()) return;
      setLoadedWorkspaceId(recordWorkspaceId);
      setCloudSessions(sessionData.sessions);
      setAllRecords(comments.map((comment) => ({
        id: comment.id,
        sessionId: comment.sessionId,
        nickname: comment.nicknameSnapshot,
        content: comment.content,
        capturedAt: comment.capturedAt,
      })));
    } catch (error) {
      if (isCurrent()) alert(error instanceof Error ? error.message : '클라우드 댓글 기록을 불러오지 못했습니다.');
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
        setHistoryRevision((value) => value + 1);
      }
    }
  }, [recordWorkspaceId]);

  useEffect(() => {
    setSelectedIds(new Set());
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(`voicecap_transcripts:${encodeURIComponent(recordWorkspaceId)}:`)) {
        setHistoryRevision((value) => value + 1);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [recordWorkspaceId]);

  const localTranscripts = useMemo(() => storageService.getTranscriptHistory(recordWorkspaceId),
    [recordWorkspaceId, historyRevision, currentSessionId]);
  const currentTranscripts = useMemo(() => getCurrentSessionTranscripts().map((log) => ({ ...log, sessionId: currentSessionId })),
    [getCurrentSessionTranscripts, currentSessionId, totalSessionTranscriptCount]);
  const allTranscripts = useMemo(() => mergeTranscriptHistory(
    cloudTranscriptHistory.workspaceId === recordWorkspaceId ? cloudTranscriptHistory.records : [],
    localTranscripts, currentTranscripts,
  ), [cloudTranscriptHistory, recordWorkspaceId, localTranscripts, currentTranscripts]);

  const sessionOptions = useMemo(() => {
    const visibleSessions = loadedWorkspaceId === recordWorkspaceId ? cloudSessions : [];
    const sessionsById = new Map(visibleSessions.map((session) => [session.id, session]));
    const firstCommentAtBySession = new Map<string, string>();

    // 1) 클라우드 세션 목록 기본 등록 (댓글이 아직 없는 진행 중 회차 등도 포함)
    visibleSessions.forEach((session) => {
      firstCommentAtBySession.set(session.id, session.startedAt || new Date().toISOString());
    });

    // 2) 실제 댓글 기록에 있는 세션 등록
    (loadedWorkspaceId === recordWorkspaceId ? allRecords : []).forEach((record) => {
      const current = firstCommentAtBySession.get(record.sessionId);
      if (!current || record.capturedAt < current) {
        firstCommentAtBySession.set(record.sessionId, record.capturedAt);
      }
    });
    allTranscripts.forEach((record) => {
      const current = firstCommentAtBySession.get(record.sessionId);
      if (!current || record.timestamp < current) firstCommentAtBySession.set(record.sessionId, record.timestamp);
    });

    return Array.from(firstCommentAtBySession.entries())
      .map(([sessionId, firstCommentAt]) => {
        const session = sessionsById.get(sessionId);
        const label = formatSessionDisplay(sessionId, {
          sessions: visibleSessions,
          recognizedAt: session?.startedAt || firstCommentAt
        });

        return {
          id: sessionId,
          label,
          status: session?.status,
          startedAt: session?.startedAt || firstCommentAt,
        };
      })
      .sort((left, right) => (
        new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
      ));
  }, [allRecords, cloudSessions, allTranscripts, loadedWorkspaceId, recordWorkspaceId]);

  // 가장 최근 회차 세션 (진행 중인 세션 우선, 없으면 시작시각 기준 가장 최근 회차)
  const latestSessionId = useMemo(() => {
    if (sessionOptions.length === 0) return null;
    const active = sessionOptions.find((s) => s.status === 'ACTIVE');
    return active ? active.id : sessionOptions[0].id;
  }, [sessionOptions]);

  // URL 파라미터가 없으면 최근 회차를 기본값으로 지정
  const sessionFilter = useMemo(() => {
    const raw = searchParams.get('session');
    if (raw !== null) {
      return raw;
    }
    return latestSessionId || 'ALL';
  }, [searchParams, latestSessionId]);

  // 초기 진입 시 URL에 session 파라미터가 없으면 최근 회차로 URL 동기화 (기본값 최근회차)
  useEffect(() => {
    if (searchParams.get('session') === null && latestSessionId && loadedWorkspaceId === recordWorkspaceId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('session', latestSessionId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, latestSessionId, setSearchParams, loadedWorkspaceId, recordWorkspaceId]);

  const handleSessionFilterChange = (nextSessionId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('session', nextSessionId);
    setSearchParams(nextParams);
  };

  const sessionLabelById = useMemo(
    () => new Map(sessionOptions.map((session) => [session.id, session.label])),
    [sessionOptions]
  );
  const selectedSessionLabel = sessionFilter === 'ALL'
    ? null
    : sessionLabelById.get(sessionFilter) || '이전 방송 회차';

  useEffect(() => {
    if (recordKind !== 'transcripts' || !recordWorkspaceId) {
      setIsLoadingTranscripts(false);
      return;
    }
    let active = true;
    setIsLoadingTranscripts(true);
    setTranscriptError('');
    void remoteWorkspaceService.fetchSessionTranscriptHistory(recordWorkspaceId, sessionFilter === 'ALL' ? undefined : sessionFilter)
      .then((records) => {
        if (active && ownerRef.current === recordWorkspaceId) setCloudTranscriptHistory({ workspaceId: recordWorkspaceId, records });
      })
      .catch((error) => {
        if (active && ownerRef.current === recordWorkspaceId) {
          setCloudTranscriptHistory({ workspaceId: recordWorkspaceId, records: [] });
          setTranscriptError(error instanceof Error ? error.message : '클라우드 판매멘트 기록 조회에 실패했습니다. 이 PC의 기록만 표시합니다.');
        }
      })
      .finally(() => { if (active) setIsLoadingTranscripts(false); });
    return () => { active = false; };
  }, [recordKind, recordWorkspaceId, sessionFilter, historyRevision]);

  const filteredTranscripts = useMemo(() => filterTranscriptHistory(allTranscripts, {
    sessionId: sessionFilter, fromDate, toDate, searchText,
  }), [allTranscripts, sessionFilter, fromDate, toDate, searchText]);

  // 아래쪽이 최신글이 되도록 시간 오름차순 정렬
  const filteredRecords = useMemo(() => {
    if (loadedWorkspaceId !== recordWorkspaceId) return [];
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    const query = searchText.trim().toLowerCase();

    return allRecords
      .filter((r) => (sessionFilter === 'ALL' ? true : r.sessionId === sessionFilter))
      .filter((r) => {
        const t = new Date(r.capturedAt).getTime();
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
        return true;
      })
      .filter((r) =>
        query
          ? r.nickname.toLowerCase().includes(query) || r.content.toLowerCase().includes(query)
          : true
      )
      .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  }, [allRecords, sessionFilter, fromDate, toDate, searchText, loadedWorkspaceId, recordWorkspaceId]);

  const deleteRecords = async (ids: string[]) => {
    if (ids.length === 0) return;
    const owner = storageService.getWorkspaceId();
    try {
      await productSalesApi.deleteLiveComments(ids);
      storageService.deleteCommentRecords(ids, owner);
      if (ownerRef.current !== recordWorkspaceId) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : '클라우드 댓글 기록을 삭제하지 못했습니다.');
    }
  };

  const handleDeleteOne = (id: string) => {
    void deleteRecords([id]);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    void deleteRecords(Array.from(selectedIds));
  };

  const handleDeleteAllFiltered = () => {
    if (filteredRecords.length === 0) return;
    if (!window.confirm(`현재 필터 조건의 댓글 ${filteredRecords.length}건을 모두 삭제할까요?`)) return;
    void deleteRecords(filteredRecords.map((r) => r.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildCsv = (rows: CommentRecord[]) => {
    const headers = ['캡처 시각', '닉네임', '내용', '감지 단어', '방송 회차'];
    const lines = rows.map((r) => {
      const time = `"${new Date(r.capturedAt).toLocaleString('ko-KR')}"`;
      const nickname = `"${(r.nickname || '').replace(/"/g, '""')}"`;
      const content = `"${(r.content || '').replace(/"/g, '""')}"`;
      const word = `"${(r.matchedAlertWord || '').replace(/"/g, '""')}"`;
      const session = `"${(sessionLabelById.get(r.sessionId) || '이전 방송 회차').replace(/"/g, '""')}"`;
      return [time, nickname, content, word, session].join(',');
    });
    return '\uFEFF' + [headers.join(','), ...lines].join('\r\n');
  };

  const downloadBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildTxt = (rows: CommentRecord[]) => {
    const lines = rows.map((r) => {
      const time = new Date(r.capturedAt).toLocaleString('ko-KR');
      const session = sessionLabelById.get(r.sessionId) || '이전 방송 회차';
      const word = r.matchedAlertWord ? ` [감지단어: ${r.matchedAlertWord}]` : '';
      return `[${time}] [${session}] ${r.nickname}: ${r.content}${word}`;
    });
    return lines.join('\r\n');
  };

  const handleDownloadTxt = () => {
    const isTranscript = recordKind === 'transcripts';
    if (isTranscript ? isLoadingTranscripts || filteredTranscripts.length === 0 : filteredRecords.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      isTranscript ? buildTranscriptTxt(filteredTranscripts, (id) => sessionLabelById.get(id) || formatSessionDisplay(id)) : buildTxt(filteredRecords),
      `${isTranscript ? '판매멘트기록' : '댓글캡처기록'}_${stamp}.txt`,
      'text/plain;charset=utf-8;'
    );
  };

  const handleDownloadCsv = () => {
    const isTranscript = recordKind === 'transcripts';
    if (isTranscript ? isLoadingTranscripts || filteredTranscripts.length === 0 : filteredRecords.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      isTranscript ? buildTranscriptCsv(filteredTranscripts, (id) => sessionLabelById.get(id) || formatSessionDisplay(id)) : buildCsv(filteredRecords),
      `${isTranscript ? '판매멘트기록' : '댓글캡처기록'}_${stamp}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  const downloadDisabled = recordKind === 'transcripts'
    ? isLoadingTranscripts || filteredTranscripts.length === 0
    : filteredRecords.length === 0;

  return (
    <div className="p-2.5 sm:p-4 max-w-7xl mx-auto space-y-2.5 sm:space-y-3">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight flex items-center space-x-1.5">
            <MessageSquareText className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-600" />
            <span>댓글/판매멘트 기록</span>
          </h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
            댓글과 판매자의 음성인식 멘트를 회차/기간별로 확인하고 TXT·CSV로 다운로드할 수 있습니다.
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
            isRunning
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : isActive
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            {isRunning ? '자동 캡처 중' : isActive ? '대기 중' : '중지됨'}
          </span>
          <Link
            to="/recognition-rules"
            className="h-8 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 flex items-center space-x-1 transition"
          >
            <span>설정</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading || isLoadingTranscripts}
            className="h-8 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold border border-slate-200 flex items-center space-x-1 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isLoadingTranscripts ? 'animate-spin' : ''}`} />
            <span>새로고침</span>
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="기록 종류" className="flex gap-1.5">
        {([
          { kind: 'comments', label: '댓글', icon: MessageSquareText },
          { kind: 'transcripts', label: '판매멘트', icon: Mic },
        ] as const).map(({ kind, label, icon: Icon }) => (
          <button key={kind} type="button" role="tab" id={`records-tab-${kind}`} aria-controls={`records-${kind}`}
            aria-selected={recordKind === kind} onClick={() => setRecordKind(kind)}
            className={`h-9 px-4 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition ${recordKind === kind
              ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* 필터 바 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
        <div className="space-y-0.5">
          <label className="text-[11px] font-bold text-slate-600">방송 회차</label>
          <select
            value={sessionFilter}
            onChange={(e) => handleSessionFilterChange(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-brand-500 font-medium text-xs"
          >
            {sessionOptions.map((session) => {
              const isLatest = session.id === latestSessionId;
              return (
                <option key={session.id} value={session.id}>
                  {session.label}
                  {session.status === 'ACTIVE' ? ' · 진행 중 (실시간)' : isLatest ? ' (최근 회차)' : ''}
                </option>
              );
            })}
            <option value="ALL">전체 회차 (모든 방송 합산)</option>
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[11px] font-bold text-slate-600">시작일</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 text-xs"
          />
        </div>

        <div className="space-y-0.5">
          <label className="text-[11px] font-bold text-slate-600">종료일</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 text-xs"
          />
        </div>

        <div className="space-y-0.5">
          <label className="text-[11px] font-bold text-slate-600">{recordKind === 'transcripts' ? '검색 (판매멘트 내용)' : '검색 (닉네임/내용)'}</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="검색어"
              className="w-full pl-7 pr-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 text-xs"
            />
          </div>
        </div>

        <div className="space-y-0.5">
          <label className="text-[11px] font-bold text-slate-600">{recordKind === 'transcripts' ? '판매멘트 다운로드' : '댓글 다운로드'}</label>
          <div className="flex gap-1.5">
            <button
              onClick={handleDownloadTxt}
              disabled={downloadDisabled}
              className="flex-1 h-8 px-2 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center space-x-1 transition active:scale-95"
              title={`${recordKind === 'transcripts' ? '판매멘트' : '댓글'} 목록을 텍스트(.txt) 파일로 다운로드`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>TXT</span>
            </button>
            <button
              onClick={handleDownloadCsv}
              disabled={downloadDisabled}
              className="flex-1 h-8 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center space-x-1 transition active:scale-95"
              title={`${recordKind === 'transcripts' ? '판매멘트' : '댓글'} 목록을 엑셀(.csv) 파일로 다운로드`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* 목록 카드 */}
      {recordKind === 'comments' ? (
      <div id="records-comments" role="tabpanel" aria-labelledby="records-tab-comments" className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs sm:text-sm font-bold text-slate-900">
            캡처된 댓글 <span className="text-brand-600">{filteredRecords.length}</span>건
            {selectedSessionLabel && <span className="text-slate-400 font-normal"> · {selectedSessionLabel}</span>}
          </h3>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-600 text-xs font-bold border border-rose-200 flex items-center space-x-1 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>선택 삭제 ({selectedIds.size})</span>
            </button>
            <button
              onClick={handleDeleteAllFiltered}
              disabled={filteredRecords.length === 0}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-xs font-bold border border-slate-200 flex items-center space-x-1 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>전체 삭제</span>
            </button>
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="py-14 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
            조건에 맞는 캡처 댓글이 없습니다.<br />
            라이브 청취 중 "캡처 영역 & 단어 규칙"에서 자동 캡처를 시작하면 여기에 기록됩니다.
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-1.5">
            {filteredRecords.map((r) => (
              <div
                key={r.id}
                className={`flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl border text-xs transition ${
                  r.matchedAlertWord
                    ? 'bg-rose-50/70 border-rose-200'
                    : 'bg-slate-50/70 border-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.id)}
                  onChange={() => toggleSelect(r.id)}
                  className="w-4 h-4 accent-brand-600 flex-shrink-0"
                />

                <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 hidden sm:block">
                  {new Date(r.capturedAt).toLocaleTimeString('ko-KR')}
                </span>
                <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 sm:hidden">
                  {new Date(r.capturedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>

                <span className={`font-bold flex-shrink-0 max-w-[120px] truncate ${r.matchedAlertWord ? 'text-rose-700' : 'text-brand-700'}`}>
                  {r.nickname}
                </span>

                <span className="text-slate-800 font-medium break-words min-w-0 flex-1">
                  {r.content}
                </span>

                {r.matchedAlertWord && (
                  <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold whitespace-nowrap flex items-center space-x-1">
                    <BellRing className="w-3 h-3" />
                    <span>{r.matchedAlertWord}</span>
                  </span>
                )}

                <button
                  onClick={() => handleDeleteOne(r.id)}
                  className="flex-shrink-0 p-1.5 rounded-lg hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition"
                  aria-label="삭제"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      ) : (
        <div id="records-transcripts" role="tabpanel" aria-labelledby="records-tab-transcripts" className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm space-y-2">
          <h3 className="text-xs sm:text-sm font-bold text-slate-900">
            판매자 멘트 <span className="text-brand-600">{filteredTranscripts.length}</span>건
            {selectedSessionLabel && <span className="text-slate-400 font-normal"> · {selectedSessionLabel}</span>}
            {isLoadingTranscripts && <span className="ml-2 text-slate-400 font-normal">불러오는 중…</span>}
          </h3>
          <p className="text-[11px] text-slate-500">
            판매·상품 설명·수정 등 음성인식이 확정한 전체 멘트를 시간순으로 표시합니다. 다운로드에도 현재 필터가 적용됩니다.
            방송 중 기록은 이 PC에서 바로 확인되며, 다른 기기에서는 방송 종료 시 클라우드에 저장된 기록을 확인할 수 있습니다.
          </p>
          {transcriptError && <p role="alert" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">{transcriptError}</p>}
          {filteredTranscripts.length === 0 ? (
            <div className="py-14 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
              {isLoadingTranscripts ? '판매멘트 기록을 불러오고 있습니다.' : '조건에 맞는 판매멘트 기록이 없습니다.'}<br />
              라이브 청취를 시작하면 판매자의 확정된 음성인식 멘트가 기록됩니다. 저장되지 않은 과거 멘트는 복원할 수 없습니다.
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-1.5">
              {filteredTranscripts.map((record) => (
                <div key={JSON.stringify([record.sessionId, record.id || record.timestamp + record.text])}
                  className="p-2.5 sm:p-3 rounded-2xl border border-slate-200 bg-slate-50/70 text-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                    <Mic className="w-3.5 h-3.5 text-brand-600" /><span className="font-bold text-brand-700">판매자</span>
                    <time dateTime={record.timestamp}>{new Date(record.timestamp).toLocaleString('ko-KR')}</time>
                    {sessionFilter === 'ALL' && <span>{sessionLabelById.get(record.sessionId) || formatSessionDisplay(record.sessionId)}</span>}
                    {transcriptActionLabel(record.actionTriggered) && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{transcriptActionLabel(record.actionTriggered)}</span>}
                  </div>
                  <p className="text-slate-800 font-medium whitespace-pre-wrap break-words">{record.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
