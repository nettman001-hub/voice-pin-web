import React, { useState } from 'react';
import { useAppData } from '../../context/AppDataContext';
import { BarChart3, Activity, AlertCircle, Filter, Clock, TrendingUp, CheckCircle2 } from 'lucide-react';

export const AdminStatsPage: React.FC = () => {
  const { errorLogs } = useAppData();

  const [period, setPeriod] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  const [logFilter, setLogFilter] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL');

  const filteredLogs = errorLogs.filter((l) => {
    if (logFilter !== 'ALL' && l.level !== logFilter) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">이용 통계 & 시스템 오류 로그</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold">
              실시간 모니터링
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Deepgram STT 인식 성공률과 일별 이용 추이, 시스템 로그를 확인합니다.</p>
        </div>

        {/* 기간 탭 */}
        <div className="flex items-center space-x-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs">
          {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((p) => {
            const labels = { DAILY: '일별', WEEKLY: '주별', MONTHLY: '월별' };
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-xl font-bold transition ${
                  period === p ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 통계 지표 차트 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 1. 활성 사용자 수 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">이용자 수 추이</span>
            <span className="text-xs text-emerald-400 font-bold">+18% 증가</span>
          </div>
          <div className="text-3xl font-black text-white">45 <span className="text-xs text-slate-400 font-normal">명/일</span></div>
          {/* 심플 막대 차트 시각화 */}
          <div className="h-20 flex items-end justify-between gap-2 pt-4">
            {[30, 45, 60, 50, 75, 85, 95].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-gradient-to-t from-brand-600 to-tiktok-cyan rounded-t-lg transition-all duration-500"
                  style={{ height: `${val}%` }}
                ></div>
                <span className="text-[10px] text-slate-400">{idx + 1}일</span>
              </div>
            ))}
          </div>
        </div>

        {/* 2. 판매 내역 자동 적재 건수 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">판매 저장 건수</span>
            <span className="text-xs text-brand-400 font-bold">+34% 증가</span>
          </div>
          <div className="text-3xl font-black text-brand-400">128 <span className="text-xs text-slate-400 font-normal">건/일</span></div>
          <div className="h-20 flex items-end justify-between gap-2 pt-4">
            {[40, 55, 70, 65, 80, 90, 100].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-lg transition-all duration-500"
                  style={{ height: `${val}%` }}
                ></div>
                <span className="text-[10px] text-slate-400">{idx + 1}일</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Deepgram Nova-3 STT 인식 성공률 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">음성 인식 정확도</span>
            <span className="text-xs text-tiktok-pink font-bold">Nova-3</span>
          </div>
          <div className="text-3xl font-black text-tiktok-pink">96.4 <span className="text-xs text-slate-400 font-normal">%</span></div>
          <div className="h-20 flex items-end justify-between gap-2 pt-4">
            {[92, 94, 95, 93, 97, 96, 98].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-gradient-to-t from-purple-600 to-tiktok-pink rounded-t-lg transition-all duration-500"
                  style={{ height: `${(val - 80) * 5}%` }}
                ></div>
                <span className="text-[10px] text-slate-400">{idx + 1}일</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 시스템 오류 로그 모니터링 섹션 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <Activity className="w-4 h-4 text-rose-400" />
            <span>시스템 및 STT 오류 로그 ({filteredLogs.length}건)</span>
          </h3>

          {/* 로그 레벨 필터 */}
          <div className="flex items-center space-x-2">
            {(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLogFilter(lvl)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  logFilter === lvl
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`p-3.5 rounded-2xl border text-xs font-mono flex items-start justify-between gap-3 ${
                log.level === 'ERROR'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  : log.level === 'WARN'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-start space-x-3">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    log.level === 'ERROR'
                      ? 'bg-rose-500 text-white'
                      : log.level === 'WARN'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {log.level}
                </span>
                <div>
                  <p className="font-semibold">{log.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">소스: {log.source}</p>
                </div>
              </div>

              <span className="text-[11px] text-slate-400 flex-shrink-0">{log.timestamp}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
