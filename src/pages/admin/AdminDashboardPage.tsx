import React from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  BarChart3,
  Shield,
  Activity,
  CheckCircle2,
  TrendingUp,
  ArrowRight
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const { adminKpis, allMembers, reports, errorLogs } = useAppData();

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">관리자 통합 대시보드</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/30">
              Admin Ops
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            다들려 서비스의 회원 가입, 활성 구독, 신고 및 시스템 오류 현황을 실시간으로 모니터링합니다.
          </p>
        </div>
      </div>

      {/* 핵심 4대 KPI 요약 카드 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 당일 가입자 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>당일 신규 가입자</span>
            <Users className="w-4 h-4 text-brand-400" />
          </div>
          <div className="text-3xl font-black text-white mt-2">
            {adminKpis.dailyNewUsers} <span className="text-xs font-normal text-slate-400">명</span>
          </div>
          <div className="text-[11px] text-emerald-400 font-semibold mt-2 flex items-center">
            <TrendingUp className="w-3.5 h-3.5 mr-1" /> 전일 대비 +15%
          </div>
        </div>

        {/* 활성 구독자 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>총 활성 유료 구독자</span>
            <Shield className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-emerald-400 mt-2">
            {adminKpis.activeSubscribers} <span className="text-xs font-normal text-slate-400">명</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            전환율 18.5% (목표 15% 달성)
          </div>
        </div>

        {/* 미처리 신고 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>접수된 신고 건수</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-black text-amber-300 mt-2">
            {adminKpis.openReportsCount} <span className="text-xs font-normal text-slate-400">건</span>
          </div>
          <div className="text-[11px] text-amber-400 mt-2">
            {adminKpis.openReportsCount > 0 ? '조속한 처리 필요' : '모두 처리 완료'}
          </div>
        </div>

        {/* 시스템 오류 건수 */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>시스템 오류 발생</span>
            <Activity className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-3xl font-black text-rose-400 mt-2">
            {adminKpis.systemErrorsCount} <span className="text-xs font-normal text-slate-400">건</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            Deepgram 평균 정확도: {adminKpis.sttAccuracyAvg}%
          </div>
        </div>
      </div>

      {/* 관리자 바로가기 메뉴 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          to="/admin/members"
          className="p-6 rounded-3xl bg-slate-900 border border-slate-800 hover:border-brand-500/50 transition group flex flex-col justify-between"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center mb-3">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white group-hover:text-brand-300 transition">회원 관리 센터</h3>
            <p className="text-xs text-slate-400 mt-1">
              전체 판매자 회원 조회, 구독 상태 모니터링 및 계정 정지/해제 조치
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center text-xs font-bold text-brand-400">
            <span>회원 목록 바로가기</span>
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        <Link
          to="/admin/reports"
          className="p-6 rounded-3xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 transition group flex flex-col justify-between"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white group-hover:text-amber-300 transition">신고 처리 센터</h3>
            <p className="text-xs text-slate-400 mt-1">
              부적절한 음성 학습, 스팸, 인식 오류 신고 접수 건 확인 및 상태 변경
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center text-xs font-bold text-amber-400">
            <span>신고 내역 확인 ({reports.filter(r => r.status !== '완료').length}건 미완료)</span>
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        <Link
          to="/admin/stats"
          className="p-6 rounded-3xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 transition group flex flex-col justify-between"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-3">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white group-hover:text-purple-300 transition">이용 통계 & 시스템 로그</h3>
            <p className="text-xs text-slate-400 mt-1">
              일별/주별 트렌드 지표 차트 및 실시간 서버·STT 오류 로그 필터링
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center text-xs font-bold text-purple-400">
            <span>통계 및 로그 모니터링</span>
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>
    </div>
  );
};
