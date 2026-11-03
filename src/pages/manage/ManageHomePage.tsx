import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Package, RefreshCw } from 'lucide-react';
import { useManageDashboard, useManageHomeSummary } from '../../services/manage/useManageData';
import { formatWon } from '../../services/appShellState';
import type { MoneyStage } from '../../services/manage/orderPipeline';

const PERIODS = [
  { days: 1, label: '오늘' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: 0, label: '전체' },
];

const STAGE_TONE: Record<MoneyStage, string> = {
  NEEDS_CONTACT: 'border-amber-300 bg-amber-50 text-amber-900',
  READY_TO_BILL: 'border-sky-200 bg-sky-50 text-sky-900',
  AWAITING_PAYMENT: 'border-violet-200 bg-violet-50 text-violet-900',
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

/** 관리 홈: 숫자 3개, 돈 4칸(연락처 연결 맨 앞), 물건 4칸, 할 일, 보관 카드. 읽기만 한다. 숫자는 서버 요약을 먼저 쓴다. */
export const ManageHomePage: React.FC = () => {
  const [periodDays, setPeriodDays] = useState(7);
  const [reloadKey, setReloadKey] = useState(0);
  const { dashboard: local, server } = useManageDashboard(periodDays, reloadKey);
  const { summary } = useManageHomeSummary(periodDays, reloadKey);
  // 서버 요약이 있으면 그것을, 없으면(오프라인 등) 폰이 센 값을 보여 준다
  const dashboard = summary || local;
  const alertDays = summary?.alertDays || server.alertDays;
  const { goods, keeping } = dashboard;

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="기간" className="flex gap-1">
          {PERIODS.map((period) => (
            <button
              key={period.days}
              type="button"
              role="tab"
              aria-selected={periodDays === period.days}
              onClick={() => setPeriodDays(period.days)}
              className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${
                periodDays === period.days ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="flex min-h-[36px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
      </div>

      {!summary && !server.serverReady && server.loadedAt && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          연락처·보관 기록을 서버에서 읽지 못했습니다. 인터넷 연결을 확인해 주세요.
        </div>
      )}

      <section aria-label="오늘의 숫자" className="grid grid-cols-3 gap-2">
        {[
          { label: '판매액', value: dashboard.salesAmount },
          { label: '입금 완료', value: dashboard.paidAmount },
          { label: '남은 입금', value: dashboard.unpaidAmount },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
            <div className="text-[11px] font-bold text-slate-500">{item.label}</div>
            <div className="mt-1 break-all text-base font-black tabular-nums text-slate-900">{formatWon(item.value)}</div>
          </div>
        ))}
      </section>

      <section aria-label="주문 단계">
        <h2 className="mb-1.5 text-xs font-extrabold text-slate-500">
          주문 {dashboard.orderCount}건 ({dashboard.sessionCount ?? local.sessionCount}회차/{dashboard.buyerCount ?? local.buyerCount}구매자)
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {dashboard.stages.map((stage) => (
            <Link
              key={stage.stage}
              to={stage.stage === 'NEEDS_CONTACT' ? '/manage/contacts' : `/manage/orders?stage=${stage.stage}`}
              className={`rounded-2xl border px-3 py-3 ${STAGE_TONE[stage.stage]}`}
            >
              <div className="text-xs font-bold">{stage.stage === 'NEEDS_CONTACT' ? '연락 대기/연결' : stage.label}</div>
              <div className="mt-1 text-xl font-black tabular-nums">{stage.orderCount}</div>
              <div className="text-[11px] tabular-nums opacity-80">{formatWon(stage.amount)}</div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="물건">
        <h2 className="mb-1.5 text-xs font-extrabold text-slate-500">물건 (전체 기간)</h2>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '발송 대기', value: goods.readyToShip, to: '/manage/ship' },
            { label: '보관 중', value: goods.kept, to: '/manage/ship?filter=keeping' },
            { label: '출고 진행', value: goods.inProgress, to: '/manage/ship?filter=active' },
            { label: '환불 필요', value: goods.refundNeeded, warn: goods.refundNeeded > 0, to: '/manage/ship?filter=refund' },
          ].map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={`rounded-2xl border px-2 py-3 text-center ${
                item.warn ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              <div className="text-[11px] font-bold opacity-80">{item.label}</div>
              <div className="mt-1 text-lg font-black tabular-nums">{item.value}</div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="할 일" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-extrabold text-slate-900">할 일</h2>
        {dashboard.todos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">지금 처리할 일이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {dashboard.todos.map((todo) => (
              <li key={todo.kind}>
                <Link to={todo.path} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 active:bg-slate-50">
                  {(todo.kind === 'REFUND_NEEDED' || todo.kind === 'KEEPING_ALERT') && (
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-rose-500" />
                  )}
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-800">{todo.label}</span>
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-black tabular-nums text-white">{todo.count}</span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="보관함" className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
            <Package className="h-4 w-4 text-brand-600" /> 보관함
          </h2>
          <Link to="/manage/settings/keeping" className="text-xs font-bold text-slate-500 underline">
            알림 {alertDays.warnDays}일 · {alertDays.alertDays}일
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-700">
          {keeping.buyers}명 · {keeping.items}개 · {formatWon(keeping.amount)}
          {keeping.alert > 0 && <span className="ml-1 font-bold text-rose-600">경고 {keeping.alert}명</span>}
          {keeping.warn > 0 && <span className="ml-1 font-bold text-amber-600">주의 {keeping.warn}명</span>}
        </p>
        {keeping.top.length > 0 && (
          <ul className="mt-2 space-y-1">
            {keeping.top.map((alert) => (
              <li key={alert.buyerKey} className="flex justify-between text-xs text-slate-600">
                <span className="truncate">{alert.nickname} · {alert.itemCount}개</span>
                <span className={alert.level === 'ALERT' ? 'font-bold text-rose-600' : alert.level === 'WARN' ? 'font-bold text-amber-600' : ''}>
                  {alert.days}일째
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/manage/ship?filter=keeping" className="mt-2 inline-flex min-h-[40px] items-center text-sm font-bold text-brand-700">
          출고(보관함·합배송)로 <ChevronRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
};

export default ManageHomePage;
