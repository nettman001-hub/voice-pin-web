import React from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { useSales } from '../../context/SalesContext';
import { User } from '../../types/auth';
import { ReportItem } from '../../types/admin';
import {
  Users,
  AlertTriangle,
  Radio,
  CreditCard,
  ArrowRight,
  TrendingUp,
  Activity,
  Server
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const { allMembers, reports } = useAppData();
  const { sales } = useSales();

  const totalMembers = allMembers.length;
  const activeMembers = allMembers.filter((m: User) => m.status === '활성').length;
  const pendingReports = reports.filter((r: ReportItem) => r.status === '접수').length;
  const totalRevenue = sales.filter((s) => s.status !== '보류').reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">관리자 통합 대시보드</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-bold border border-purple-200">
              전체 시스템 관제
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            다들려 서비스의 핵심 KPI 지표, 회원 현황, 신고 처리 상태를 실시간으로 모니터링합니다.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>STT 서버 정상 가동 중 (Nova-3)</span>
          </span>
        </div>
      </div>

      {/* 4대 KPI 요약 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/admin/members"
          className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition block group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">전체 회원 수</span>
            <Users className="w-4 h-4 text-brand-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {totalMembers} <span className="text-xs font-normal text-slate-400">명</span>
          </div>
          <div className="text-[11px] text-emerald-600 mt-2 flex items-center font-semibold">
            <span>활성 계정: {activeMembers}명</span>
          </div>
        </Link>

        <Link
          to="/admin/reports"
          className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition block group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">미처리 신고 건수</span>
            <AlertTriangle className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-amber-600 mt-2">
            {pendingReports} <span className="text-xs font-normal text-slate-400">건</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            <span>총 접수: {reports.length}건</span>
          </div>
        </Link>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">전체 거래 발생액</span>
            <CreditCard className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {totalRevenue.toLocaleString()} <span className="text-xs font-normal text-slate-400">원</span>
          </div>
          <div className="text-[11px] text-purple-700 mt-2 font-semibold">
            <span>총 {sales.length}건의 판매 기록</span>
          </div>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">시스템 가동률</span>
            <Activity className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-2">99.98%</div>
          <div className="text-[11px] text-slate-400 mt-2">
            <span>Deepgram API 레이턴시: 120ms</span>
          </div>
        </div>
      </div>

      {/* 최근 신고 및 주요 관리자 숏컷 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>최근 접수된 사용자 신고 목록</span>
            </h3>
            <Link to="/admin/reports" className="text-xs text-brand-600 hover:underline font-bold flex items-center">
              <span>전체 보기</span>
              <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </div>

          <div className="space-y-3">
            {reports.slice(0, 3).map((r: ReportItem) => (
              <div
                key={r.id}
                className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900">{r.memberNickname}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      r.status === '접수' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-slate-500 mt-0.5">{r.reason}</p>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{r.createdAt}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Server className="w-4 h-4 text-brand-600" />
            <span>빠른 관리 메뉴</span>
          </h3>

          <div className="space-y-2">
            <Link
              to="/admin/members"
              className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800 transition block"
            >
              <span>👥 회원 관리 및 부정 사용자 정지</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </Link>
            <Link
              to="/admin/reports"
              className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800 transition block"
            >
              <span>🚨 신고 처리 센터 및 소명 관리</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </Link>
            <Link
              to="/admin/stats"
              className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800 transition block"
            >
              <span>📊 상세 통계 및 시스템 에러 로그</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
