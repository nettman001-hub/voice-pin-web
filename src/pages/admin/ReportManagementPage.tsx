import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { ReportItem } from '../../types/admin';
import {
  AlertTriangle,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  ShieldCheck,
  FileText
} from 'lucide-react';

export const ReportManagementPage: React.FC = () => {
  const { reports, updateReportStatus, suspendMember } = useAppData();

  const [statusFilter, setStatusFilter] = useState<'ALL' | '접수' | '처리 중' | '완료'>('ALL');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const filteredReports = reports.filter((r: ReportItem) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    return true;
  });

  const handleUpdateStatus = (id: string, st: '접수' | '처리 중' | '완료') => {
    updateReportStatus(id, st);
    setToastMsg(`신고 상태가 '${st}'(으)로 변경되었습니다.`);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleSuspendAndComplete = (report: ReportItem) => {
    suspendMember(report.id, `신고건 조치 (${report.reason})`);
    updateReportStatus(report.id, '완료');
    setToastMsg(`'${report.memberNickname}' 회원이 정지되었으며 신고 처리가 완료되었습니다.`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">신고 처리 센터</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] sm:text-xs font-bold border border-amber-200">
              미처리 {reports.filter((r: ReportItem) => r.status === '접수').length}건
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            이용자들로부터 접수된 허위 판매/부정 행위 신고 내역을 확인하고 제재 조치를 수행합니다.
          </p>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 상태 필터 바 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <div className="flex items-center space-x-1.5 text-xs overflow-x-auto no-scrollbar pb-1">
          <span className="text-slate-500 font-bold px-1 flex-shrink-0">처리 상태:</span>
          {(['ALL', '접수', '처리 중', '완료'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex-shrink-0 ${
                statusFilter === st
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {st === 'ALL' ? '전체' : st}
            </button>
          ))}
        </div>

        {/* 신고 목록 카드 그리드 */}
        <div className="space-y-3">
          {filteredReports.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400">
              해당 조건의 신고 내역이 없습니다.
            </div>
          ) : (
            filteredReports.map((rep: ReportItem) => (
              <div
                key={rep.id}
                className="p-3.5 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 sm:gap-4"
              >
                <div className="space-y-1.5 flex-1 w-full">
                  <div className="flex items-center space-x-2 flex-wrap gap-1">
                    <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      rep.status === '접수'
                        ? 'bg-amber-100 text-amber-800 font-black'
                        : rep.status === '완료'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}>
                      {rep.status}
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      피신고자: <strong className="text-rose-600 font-bold">{rep.memberNickname}</strong>
                    </span>
                    <span className="text-[10px] sm:text-[11px] text-slate-400 font-mono">
                      ({rep.memberEmail})
                    </span>
                  </div>

                  <p className="text-xs font-semibold text-slate-800 break-words">
                    사유: {rep.reason}
                  </p>

                  <p className="text-xs text-slate-500 break-words">
                    상세 내용: {rep.detail}
                  </p>

                  <div className="text-[10px] text-slate-400 font-mono">
                    접수 시각: {rep.createdAt}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto border-t lg:border-t-0 border-slate-200/60 pt-2 lg:pt-0">
                  <select
                    value={rep.status}
                    onChange={(e) => handleUpdateStatus(rep.id, e.target.value as any)}
                    className="flex-1 lg:flex-none px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none"
                  >
                    <option value="접수">접수</option>
                    <option value="처리 중">처리 중</option>
                    <option value="완료">완료</option>
                  </select>

                  <button
                    onClick={() => handleSuspendAndComplete(rep)}
                    className="flex-1 lg:flex-none px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-sm flex items-center justify-center space-x-1 transition active:scale-95 text-center"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>회원 정지 & 완료</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
