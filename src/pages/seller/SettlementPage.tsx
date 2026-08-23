import React, { useState } from 'react';
import { useSales } from '../../context/SalesContext';
import {
  Calculator,
  Download,
  Calendar,
  DollarSign,
  Users,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  CheckCircle2
} from 'lucide-react';

export const SettlementPage: React.FC = () => {
  const { getSettlementSummary, exportCsv } = useSales();

  const [period, setPeriod] = useState<'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('MONTH');
  const [customStart, setCustomStart] = useState('2026-08-01');
  const [customEnd, setCustomEnd] = useState('2026-08-31');
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const { summary, records, groupedByDate } = getSettlementSummary(
    period,
    period === 'CUSTOM' ? { start: customStart, end: customEnd } : undefined
  );

  const toggleExpandDate = (dateStr: string) => {
    setExpandedDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]
    );
  };

  const handleExportCsv = () => {
    const success = exportCsv(records, `다들려_정산내역_${period}_${Date.now()}.csv`);
    if (success) {
      setToastMsg('정산용 UTF-8 BOM CSV 파일이 다운로드 폴더에 저장되었습니다.');
      setTimeout(() => setToastMsg(null), 3000);
    } else {
      alert('내보낼 확정 판매 내역이 없습니다.');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 & CSV 내보내기 버튼 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">판매 정산 & CSV 내보내기</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
              엑셀 호환 UTF-8 BOM
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            기간별 판매 금액과 구매자 수를 합산 집계하고 엑셀에서 바로 열리는 CSV 파일로 다운로드합니다.
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          disabled={records.length === 0}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/25 flex items-center space-x-2 transition disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          <span>정산용 CSV 다운로드 ({records.length}건)</span>
        </button>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 기간 선택 탭 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
            {(['TODAY', 'WEEK', 'MONTH', 'CUSTOM'] as const).map((p) => {
              const labels = { TODAY: '오늘', WEEK: '이번 주', MONTH: '이번 달', CUSTOM: '직접 지정' };
              const isSelected = period === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                    isSelected
                      ? 'bg-brand-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>

          {period === 'CUSTOM' && (
            <div className="flex items-center space-x-2 text-xs text-slate-300">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
              />
              <span>~</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
              />
            </div>
          )}
        </div>

        {/* 4대 정산 요약 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-xs text-slate-400 flex items-center">
              <DollarSign className="w-4 h-4 mr-1 text-emerald-400" /> 총 판매 금액
            </span>
            <div className="text-2xl font-black text-white mt-2">
              {summary.totalAmount.toLocaleString()} <span className="text-xs font-normal text-slate-400">원</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-xs text-slate-400 flex items-center">
              <Calculator className="w-4 h-4 mr-1 text-brand-400" /> 총 판매 건수
            </span>
            <div className="text-2xl font-black text-brand-400 mt-2">
              {summary.totalCount} <span className="text-xs font-normal text-slate-400">건</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-xs text-slate-400 flex items-center">
              <Users className="w-4 h-4 mr-1 text-purple-400" /> 고유 구매자 수
            </span>
            <div className="text-2xl font-black text-purple-300 mt-2">
              {summary.uniqueBuyersCount} <span className="text-xs font-normal text-slate-400">명</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-xs text-slate-400 flex items-center">
              <AlertCircle className="w-4 h-4 mr-1 text-amber-400" /> 보류 건수 (집계 제외)
            </span>
            <div className="text-2xl font-black text-amber-300 mt-2">
              {summary.pendingCount} <span className="text-xs font-normal text-slate-400">건</span>
            </div>
          </div>
        </div>
      </div>

      {/* 일자별 판매 내역 그룹화 목록 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-brand-400" />
          <span>일자별 정산 상세 내역</span>
        </h3>

        {groupedByDate.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-2xl">
            해당 기간의 판매 정산 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {groupedByDate.map((group) => {
              const isExpanded = expandedDates.includes(group.date);

              return (
                <div key={group.date} className="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden">
                  {/* 일자 요약 헤더 */}
                  <div
                    onClick={() => toggleExpandDate(group.date)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-900/60 transition"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-sm text-white">
                        {group.date} ({group.dayName})
                      </span>
                      <span className="text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full">
                        {group.count}건
                      </span>
                    </div>

                    <div className="flex items-center space-x-4">
                      <span className="text-base font-black text-brand-400">
                        {group.totalAmount.toLocaleString()}원
                      </span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>

                  {/* 펼쳐진 상세 내역 테이블 */}
                  {isExpanded && (
                    <div className="p-4 border-t border-slate-800/80 bg-slate-900/30 space-y-2">
                      {group.records.map((rec) => (
                        <div
                          key={rec.id}
                          className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-white">{rec.buyerNickname}</span>
                            <span className="text-[11px] text-slate-400">{rec.rawTranscript}</span>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-slate-200">{rec.amount.toLocaleString()}원</span>
                            <span className="text-[10px] text-slate-400">{new Date(rec.recognizedAt).toLocaleTimeString('ko-KR')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
