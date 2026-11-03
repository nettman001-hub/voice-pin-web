import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useManageDashboard } from '../../services/manage/useManageData';
import { formatWon } from '../../services/appShellState';
import { MONEY_STAGE_LABEL, MONEY_STAGE_ORDER, type MoneyStage } from '../../services/manage/orderPipeline';

/**
 * 주문 목록 (읽기). 회차×구매자 주문서를 돈 단계별로 본다.
 * 정산서 만들기·보내기는 다음 단계에서 이 화면으로 옮긴다. 지금은 정산서 화면으로 이어 준다.
 */
export const ManageOrdersPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get('stage');
  const stage: MoneyStage = MONEY_STAGE_ORDER.includes(raw as MoneyStage) ? (raw as MoneyStage) : 'NEEDS_CONTACT';
  const duplicateOnly = params.get('filter') === 'duplicate';
  const { dashboard } = useManageDashboard(30);
  const orders = useMemo(
    () => dashboard.orders.filter((order) => (duplicateOnly ? order.duplicateOpenInvoiceIds.length > 0 : order.stage === stage)),
    [dashboard.orders, stage, duplicateOnly],
  );

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <div role="tablist" aria-label="주문 단계" className="flex gap-1 overflow-x-auto pb-1">
        {MONEY_STAGE_ORDER.map((item) => {
          const count = dashboard.stages.find((summary) => summary.stage === item)?.orderCount ?? 0;
          const on = !duplicateOnly && item === stage;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setParams({ stage: item })}
              className={`min-h-[36px] flex-shrink-0 rounded-full px-3 text-xs font-bold ${
                on ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {MONEY_STAGE_LABEL[item]} {count}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">최근 30일. 정산서 만들기와 보내기는 [정산서] 화면에서 합니다.</p>
      {orders.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">해당하는 주문이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {orders.map((order) => (
            <li key={order.key} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-extrabold text-slate-900">{order.nickname}</span>
                <span className="text-sm font-black tabular-nums text-slate-900">{formatWon(order.totalAmount)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                <span>{order.itemCount}개</span>
                <span>{order.shipping.deferredToShipment ? '배송비는 출고 때' : `배송비 ${formatWon(order.shipping.fee)}`}</span>
                {order.contact?.state === 'NEEDS_CONFIRM' && <span className="font-bold text-amber-700">{order.contact.reason}</span>}
                {order.contact?.state === 'NONE' && <span className="font-bold text-amber-700">연락처 없음</span>}
                {order.duplicateOpenInvoiceIds.length > 0 && <span className="font-bold text-rose-600">열린 정산서 {order.duplicateOpenInvoiceIds.length}장</span>}
              </div>
              <Link to="/invoices" className="mt-1 inline-block text-xs font-bold text-brand-700">정산서 화면에서 보기</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ManageOrdersPage;
