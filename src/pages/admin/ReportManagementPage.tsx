import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { ReportItem } from '../../types/admin';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, ArrowRight, X } from 'lucide-react';

export const ReportManagementPage: React.FC = () => {
  const { reports, updateReportStatus, suspendMember, allMembers } = useAppData();

  const [statusFilter, setStatusFilter] = useState<'ALL' | '접수' | '처리 중' | '완료'>('ALL');
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const filteredReports = reports.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const handleUpdateStatus = (reportId: string, status: ReportItem['status']) => {
    updateReportStatus(reportId, status);
    setToastMsg(`신고 상태가 '${status}'(으)로 변경되었습니다.`);
    setTimeout(() => setToastMsg(null), 3000);
    setSelectedReport(null);
  };

  const handleSuspendFromReport = (report: ReportItem) => {
    const targetMember = allMembers.find((m) => m.email === report.memberEmail);
    if (targetMember) {
      suspendMember(targetMember.id, `신고 건 조치: ${report.reason}`);
      updateReportStatus(report.id, '완료', '회원 이용 정지 조치 완료');
      setToastMsg(`신고 대상 회원(${targetMember.nickname})이 정지되고 신고가 완료 처리되었습니다.`);
      setTimeout(() => setToastMsg(null), 3000);
      setSelectedReport(null);
    } else {
      alert('해당 이메일의 회원을 찾을 수 없습니다.');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">신고 처리 센터</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold">
              총 {reports.length}건
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">접수된 이용자 신고를 확인하고 처리 상태를 변경하거나 후속 조치를 취합니다.</p>
        </div>

        {/* 상태 필터 */}
        <div className="flex items-center space-x-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs">
          {(['ALL', '접수', '처리 중', '완료'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl font-bold transition ${
                statusFilter === s ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'ALL' ? '전체' : s}
            </button>
          ))}
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 신고 목록 테이블 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-3">
        {filteredReports.map((report) => (
          <div
            key={report.id}
            className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:border-slate-700 transition"
          >
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-white">{report.reason}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    report.status === '완료'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : report.status === '처리 중'
                      ? 'bg-brand-500/20 text-brand-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {report.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                대상: <strong className="text-slate-300">{report.memberNickname}</strong> ({report.memberEmail}) • {report.detail}
              </p>
            </div>

            <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end">
              <span className="text-[11px] text-slate-400">{report.createdAt}</span>
              <button
                onClick={() => setSelectedReport(report)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl"
              >
                상세 보기
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 신고 상세 & 후속 조치 모달 */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>신고 상세 내역</span>
              </h3>
              <button onClick={() => setSelectedReport(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400">신고 사유</span>
                <p className="text-sm font-bold text-white">{selectedReport.reason}</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400">대상 회원</span>
                <p className="text-xs font-semibold text-slate-200">
                  {selectedReport.memberNickname} ({selectedReport.memberEmail})
                </p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400">신고 상세 내용</span>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedReport.detail}</p>
              </div>
              {selectedReport.actionTaken && (
                <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/30 text-emerald-300">
                  <span className="font-bold">조치 내용:</span> {selectedReport.actionTaken}
                </div>
              )}
            </div>

            {/* 후속 조치 액션 버튼 */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateStatus(selectedReport.id, '처리 중')}
                  className="w-1/2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold"
                >
                  [처리 중]으로 변경
                </button>
                <button
                  onClick={() => handleUpdateStatus(selectedReport.id, '완료')}
                  className="w-1/2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold"
                >
                  [처리 완료] 확정
                </button>
              </div>
              <button
                onClick={() => handleSuspendFromReport(selectedReport)}
                className="w-full py-2.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold"
              >
                🚨 대상 회원 즉시 이용 정지 & 완료 처리
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
