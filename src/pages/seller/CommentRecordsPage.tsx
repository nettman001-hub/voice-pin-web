import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCommentCapture } from '../../context/CommentCaptureContext';
import { storageService } from '../../services/storageService';
import { CommentRecord } from '../../types/comment';
import {
  MessageSquareText,
  Trash2,
  Download,
  ArrowRight,
  BellRing,
  Search
} from 'lucide-react';

export const CommentRecordsPage: React.FC = () => {
  const { isActive, isRunning } = useCommentCapture();
  const [recordsVersion, setRecordsVersion] = useState(0);

  // 필터 상태: 회차 + 기간
  const [sessionFilter, setSessionFilter] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allRecords = useMemo(() => storageService.getCommentRecords(), [recordsVersion]);
  const refresh = () => setRecordsVersion((v) => v + 1);

  const sessionOptions = useMemo(() => {
    const sessions = Array.from(new Set(allRecords.map((r) => r.sessionId)));
    return sessions.sort((a, b) => b.localeCompare(a));
  }, [allRecords]);

  // 아래쪽이 최신글이 되도록 시간 오름차순 정렬
  const filteredRecords = useMemo(() => {
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
  }, [allRecords, sessionFilter, fromDate, toDate, searchText]);

  const handleDeleteOne = (id: string) => {
    storageService.deleteCommentRecord(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    refresh();
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    storageService.deleteCommentRecords(Array.from(selectedIds));
    setSelectedIds(new Set());
    refresh();
  };

  const handleDeleteAllFiltered = () => {
    if (filteredRecords.length === 0) return;
    if (!window.confirm(`현재 필터 조건의 댓글 ${filteredRecords.length}건을 모두 삭제할까요?`)) return;
    storageService.deleteCommentRecords(filteredRecords.map((r) => r.id));
    setSelectedIds(new Set());
    refresh();
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
      const session = `"${(r.sessionId || '').replace(/"/g, '""')}"`;
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

  const handleDownloadCsv = () => {
    if (filteredRecords.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      buildCsv(filteredRecords),
      `댓글캡처기록_${stamp}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  const handleDownloadJson = () => {
    if (filteredRecords.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      JSON.stringify(filteredRecords, null, 2),
      `댓글캡처기록_${stamp}.json`,
      'application/json;charset=utf-8;'
    );
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
            <MessageSquareText className="w-6 h-6 text-cyan-600" />
            <span>댓글 캡처 기록</span>
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            자동 캡처된 댓글을 회차/기간별로 확인하고 삭제·다운로드할 수 있습니다. (아래쪽이 최신 댓글)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border ${
            isRunning
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : isActive
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            {isRunning ? '자동 캡처 동작 중' : isActive ? '대기 중 (청취 필요)' : '자동 캡처 중지됨'}
          </span>
          <Link
            to="/recognition-rules"
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 flex items-center space-x-1 transition"
          >
            <span>설정</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="space-y-1">
          <label className="font-bold text-slate-600">방송 회차</label>
          <select
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-brand-500"
          >
            <option value="ALL">전체 회차</option>
            {sessionOptions.map((s) => (
              <option key={s} value={s}>{s} 회차</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="font-bold text-slate-600">시작일</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="space-y-1">
          <label className="font-bold text-slate-600">종료일</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="space-y-1">
          <label className="font-bold text-slate-600">검색 (닉네임/내용)</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="검색어"
              className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-bold text-slate-600">다운로드</label>
          <div className="flex gap-1.5">
            <button
              onClick={handleDownloadCsv}
              disabled={filteredRecords.length === 0}
              className="flex-1 px-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center justify-center space-x-1 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              onClick={handleDownloadJson}
              disabled={filteredRecords.length === 0}
              className="flex-1 px-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold flex items-center justify-center space-x-1 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* 목록 카드 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs sm:text-sm font-bold text-slate-900">
            캡처된 댓글 <span className="text-brand-600">{filteredRecords.length}</span>건
            {sessionFilter !== 'ALL' && <span className="text-slate-400 font-normal"> · {sessionFilter} 회차</span>}
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
    </div>
  );
};
