import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { SystemErrorLog } from '../../types/admin';
import {
  BarChart3,
  Calendar,
  AlertCircle,
  TrendingUp,
  Server,
  Activity,
  Filter
} from 'lucide-react';

export const AdminStatsPage: React.FC = () => {
  const { errorLogs } = useAppData();
  const [period, setPeriod] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');
  const [logLevelFilter, setLogLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');

  const filteredLogs = errorLogs.filter((l: SystemErrorLog) => {
    if (logLevelFilter !== 'ALL' && l.level !== logLevelFilter) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">이용 통계 & 시스템 로그</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-bold border border-purple-200">
              인프라 모니터링
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            일별/주별/월별 음성인식 호출량, 화면 캡처 발생 통계 및 시스템 에러 로그를 조회합니다.
          </p>
        </div>

        <div className="flex items-center space-x-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs">
          {(['DAY', 'WEEK', 'MONTH'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-xl font-bold transition ${
                period === p
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {p === 'DAY' ? '일별 통계' : p === 'WEEK' ? '주간 통계' : '월간 통계'}
            </button>
          ))}
        </div>
      </div>

      {/* 통계 요약 지표 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500">STT 실시간 전사 요청량</span>
          <div className="text-2xl font-black text-brand-600 mt-1">42,850건</div>
          <div className="text-[11px] text-emerald-600 mt-1 font-semibold">▲ 지난 기간 대비 +18.4%</div>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500">화면 자동 캡처 처리량</span>
          <div className="text-2xl font-black text-cyan-700 mt-1">12,410장</div>
          <div className="text-[11px] text-emerald-600 mt-1 font-semibold">▲ 지난 기간 대비 +24.1%</div>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500">평균 인식 지연 시간 (Latency)</span>
          <div className="text-2xl font-black text-emerald-600 mt-1">115ms</div>
          <div className="text-[11px] text-slate-400 mt-1">안정적 실시간 스트리밍 유지</div>
        </div>
      </div>

      {/* 모의 차트 바 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
          <BarChart3 className="w-4 h-4 text-brand-600" />
          <span>기간별 음성인식 및 캡처 사용량 추이 (그래프)</span>
        </h3>

        <div className="h-44 flex items-end justify-between gap-3 pt-6 px-4 bg-slate-50 rounded-2xl border border-slate-200">
          {[
            { label: '08/18', height: '40%' },
            { label: '08/19', height: '65%' },
            { label: '08/20', height: '55%' },
            { label: '08/21', height: '80%' },
            { label: '08/22', height: '70%' },
            { label: '08/23', height: '95%' },
            { label: '08/24', height: '85%' },
          ].map((bar, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div
                className="w-full max-w-[40px] bg-gradient-to-t from-brand-600 to-cyan-500 rounded-t-lg transition-all duration-500 hover:opacity-80"
                style={{ height: bar.height }}
              />
              <span className="text-[10px] text-slate-500 font-mono">{bar.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 시스템 에러 및 이벤트 로그 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Server className="w-4 h-4 text-slate-600" />
            <span>시스템 로그 실시간 스트림 ({filteredLogs.length}건)</span>
          </h3>

          <div className="flex items-center space-x-1 text-xs">
            {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLogLevelFilter(lvl)}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  logLevelFilter === lvl
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {filteredLogs.map((log: SystemErrorLog) => (
            <div
              key={log.id}
              className={`p-3 rounded-2xl border text-xs flex items-center justify-between font-mono ${
                log.level === 'ERROR'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : log.level === 'WARN'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  log.level === 'ERROR' ? 'bg-rose-600 text-white' : log.level === 'WARN' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {log.level}
                </span>
                <span className="font-sans font-medium">{log.message}</span>
              </div>
              <span className="text-[10px] text-slate-400">{log.timestamp}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
