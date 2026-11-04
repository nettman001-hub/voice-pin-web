import { ManagePeriodTabs } from '../../components/manage/ManagePeriodTabs';
import { useManagePeriod } from '../../services/manage/useManagePeriod';
import { withManagePeriod } from '../../services/manage/period';
import { ManageBackLink } from '../../components/manage/ManageBackLink';
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCommerce } from '../../context/CommerceContext';
import { useManageDashboard } from '../../services/manage/useManageData';
import { ManageApi } from '../../services/manage/manageApi';
import { formatWon } from '../../services/appShellState';
import { defaultDueDate, orderPath, readSavedBankAccount, saveBankAccount } from '../../services/manage/orderInvoice';
import { bulkSummary, runBulk, sendOrderInvoice, type BulkResult } from '../../services/manage/invoiceSender';
import { MONEY_STAGE_LABEL, MONEY_STAGE_ORDER, type ManageOrder, type MoneyStage } from '../../services/manage/orderPipeline';
import { generateDepositCode } from '../../services/paymentMatching';
import { appToast } from '../../services/appDownload';

/**
 * 주문 목록. 회차×구매자 주문서를 돈 단계별로 본다.
 * 청구 전 주문은 여러 개 골라 정산서를 한 번에 보낼 수 있다 (보냄 + 실패 + 건너뜀 = 고른 수).
 */
export const ManageOrdersPage: React.FC = () => {
  const { workspaceId } = useAuth();
  const commerce = useCommerce();
  const api = useMemo(() => (workspaceId ? new ManageApi(workspaceId) : null), [workspaceId]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { orderKey: openKey } = useParams();
  const openOrder = (() => { try { return openKey ? decodeURIComponent(openKey) : null; } catch { return openKey || null; } })();
  const raw = params.get('stage');
  const stage: MoneyStage = MONEY_STAGE_ORDER.includes(raw as MoneyStage) ? (raw as MoneyStage) : 'NEEDS_CONTACT';
  const { periodDays, setPeriodDays } = useManagePeriod(30);
  const [reloadKey, setReloadKey] = useState(0);
  const { dashboard } = useManageDashboard(periodDays, reloadKey);
  const orders = useMemo(
    () => dashboard.orders.filter((order) => order.stage === stage),
    [dashboard.orders, stage],
  );
  const bulkMode = stage === 'READY_TO_BILL';
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bankAccount, setBankAccount] = useState(readSavedBankAccount);
  const [dueDate, setDueDate] = useState(() => defaultDueDate(new Date()));
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult<ManageOrder> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleSelected = orders.filter((order) => selected.has(order.key));
  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const sendSelected = async () => {
    if (!api || visibleSelected.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setError('인터넷 연결 후 다시 해 주세요.'); return; }
    if (!bankAccount.trim()) { setError('입금계좌를 적어 주세요.'); return; }
    const total = visibleSelected.reduce((sum, order) => sum + order.totalAmount, 0);
    if (!window.confirm(`${visibleSelected.length}명에게 정산서 문자를 보낼까요? 합계 ${formatWon(total)}`)) return;
    saveBankAccount(bankAccount);
    setError(null); setResult(null);
    const invoicesById = new Map(commerce.invoices.map((invoice) => [invoice.id, invoice]));
    const usedCodes = new Set(commerce.invoices.filter((item) => item.depositCode && !['PAID', 'CANCELLED'].includes(item.status))
      .map((item) => item.depositCode as string));
    const outcome = await runBulk(visibleSelected, async (order) => {
      const depositCode = generateDepositCode(usedCodes);
      usedCodes.add(depositCode);
      return sendOrderInvoice({
        api, order, invoicesById,
        form: { phone: order.contact?.phone || '', bankAccount, dueDate, depositCode },
        sendSms: (to, body, saleIds) => commerce.sendSms(to, body, 'INVOICE', saleIds),
      });
    }, (done, all) => setProgress(`${done}/${all} 처리 중…`));
    setProgress(null);
    setResult(outcome);
    setSelected(new Set(outcome.failed.map((entry) => entry.item.key)));
    setReloadKey((value) => value + 1);
    appToast({ message: bulkSummary(outcome) });
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <div className="flex items-start gap-1">
        <ManageBackLink />
        <ManagePeriodTabs days={periodDays} onChange={setPeriodDays} />
      </div>
      <div role="tablist" aria-label="주문 단계" className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
        {MONEY_STAGE_ORDER.map((item) => {
          const count = dashboard.stages.find((summary) => summary.stage === item)?.orderCount ?? 0;
          const on = item === stage;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => { navigate(withManagePeriod(`/manage/orders?stage=${item}`, periodDays)); setSelected(new Set()); setResult(null); }}
              className={`min-h-[36px] flex-shrink-0 rounded-full px-3 text-xs font-bold ${
                on ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {MONEY_STAGE_LABEL[item]} {count}
            </button>
          );
        })}
      </div>
      {stage === 'NEEDS_CONTACT' && (
        <Link to={withManagePeriod('/manage/contacts', periodDays)} className="flex h-12 items-center justify-center rounded-xl bg-amber-500 text-sm font-extrabold text-white">
          연락처 연결하기
        </Link>
      )}
      <p className="text-[11px] text-slate-500">{periodDays === 0 ? '전체 기간' : periodDays === 1 ? '오늘' : `최근 ${periodDays}일`}. 주문을 눌러 자세히 보고, 정산서를 보내거나 취소합니다.</p>

      {bulkMode && orders.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-slate-700">한 번에 보내기</span>
            <button type="button" onClick={() => setSelected(visibleSelected.length === orders.length ? new Set() : new Set(orders.map((order) => order.key)))} className="h-8 rounded-lg border border-slate-200 px-2 text-[11px] font-bold text-slate-600">
              {visibleSelected.length === orders.length ? '모두 풀기' : '모두 고르기'}
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input aria-label="입금계좌" value={bankAccount} onChange={(event) => setBankAccount(event.target.value)} placeholder="입금계좌 (예: 국민 123-45-6789 홍길동)" className="h-10 min-w-0 rounded-lg border border-slate-200 px-2 text-sm" />
            <input aria-label="입금기한" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-1 text-sm" />
          </div>
          <button type="button" disabled={visibleSelected.length === 0 || progress !== null} onClick={sendSelected} className="flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-brand-600 text-sm font-extrabold text-white disabled:opacity-40">
            <Send className="h-4 w-4" />{progress || `고른 ${visibleSelected.length}명에게 정산서 보내기`}
          </button>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-bold text-rose-700">{error}</p>}
          {result && (
            <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
              <p className="font-bold">{bulkSummary(result)}</p>
              {[...result.failed.map((entry) => ({ ...entry, kind: '실패' })), ...result.skipped.map((entry) => ({ ...entry, kind: '건너뜀' }))].map((entry) => (
                <p key={entry.item.key} className="mt-0.5">{entry.kind} · {entry.item.nickname}: {entry.reason}</p>
              ))}
              {result.failed.length > 0 && <p className="mt-0.5 text-slate-500">실패한 주문은 골라 둔 채로 남겼습니다. 문자 앱을 확인한 뒤 다시 누르세요.</p>}
            </div>
          )}
        </section>
      )}

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">해당하는 주문이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {orders.map((order) => (
            <li key={order.key} className={`flex items-start gap-3 px-4 py-3 ${openOrder === order.key ? 'bg-brand-50' : ''}`}>
              {bulkMode && (
                <input type="checkbox" aria-label={`${order.nickname} 고르기`} checked={selected.has(order.key)} onChange={() => toggle(order.key)} className="mt-1 h-5 w-5 flex-shrink-0" />
              )}
              <Link to={`${orderPath(order.key)}${params.toString() ? `?${params.toString()}` : `?stage=${order.stage}`}`} aria-current={openOrder === order.key ? 'true' : undefined} className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-extrabold text-slate-900">{order.nickname}</span>
                  <span className="text-sm font-black tabular-nums text-slate-900">{formatWon(order.totalAmount)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                  <span>{order.itemCount}개</span>
                  <span>{order.shipping.deferredToShipment ? '배송비는 출고 때' : `배송비 ${formatWon(order.shipping.fee)}`}</span>
                  {order.contact?.state === 'NEEDS_CONFIRM' && <span className="font-bold text-amber-700">{order.contact.reason}</span>}
                  {order.contact?.state === 'NONE' && <span className="font-bold text-amber-700">연락처 없음</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ManageOrdersPage;
