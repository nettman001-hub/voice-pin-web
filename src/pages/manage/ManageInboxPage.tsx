import { ManageScopeControl } from '../../components/manage/ManageScopeControl';
import { useManagePeriod } from '../../services/manage/useManagePeriod';
import { withManageScope, manageScopeLabel } from '../../services/manage/scope';
import { ManageBackLink } from '../../components/manage/ManageBackLink';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, GitCompare, ReceiptText, UserCheck } from 'lucide-react';
import { useCommerce } from '../../context/CommerceContext';
import { useSales } from '../../context/SalesContext';
import { scopeManageInbox } from '../../services/manage/scopedInbox';
import { useManageDashboard } from '../../services/manage/useManageData';
import { buildBuyerThreads, buildPaymentReview, reviewInvoiceSelection, type PaymentReviewItem, type InvoiceForReview } from '../../services/manage/inboxWorklist';
import { formatPhone } from '../../services/manage/contactWorklist';
import { formatWon } from '../../services/appShellState';
import { appToast } from '../../services/appDownload';

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * 문자·입금 확인 필요.
 * 입금: 자동으로 못 붙인 입금을 정산서에 붙이거나 "판매와 관계없음"으로 둔다. 금액만 같으면 자동으로 붙이지 않는다.
 * 문자·입금은 종료 뒤에도 판매·정산서·구매자 연결로 표시하며, 회차 미확인은 별도 목록으로 둔다.
 */
export const ManageInboxPage: React.FC = () => {
  const commerce = useCommerce();
  const { sales } = useSales();
  const selection = useManagePeriod();
  const { scope } = selection;
  const { dashboard } = useManageDashboard(scope, 0, selection.sessions, selection.now);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'messages' ? 'messages' : params.get('tab') === 'unassigned' ? 'unassigned' : 'payments';
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setPicked({}); setError(null); }, [selection.scopeKey]);

  const allSessions = (scope.mode === 'session' && scope.sessionId === 'ALL') || (scope.mode === 'period' && scope.periodDays === 0);
  const scoped = useMemo(() => scopeManageInbox({
    sales, selectedSessionIds: dashboard.selectedSessionIds, invoices: commerce.invoices,
    payments: commerce.payments, messages: commerce.messages, contactBook: dashboard.contactBook, allSessions,
  }), [sales, dashboard.selectedSessionIds, dashboard.contactBook, commerce.invoices, commerce.payments, commerce.messages, allSessions]);
  const selectedInvoices = useMemo(() => {
    if (allSessions) return commerce.invoices;
    const ids = new Set(sales.filter((sale) => dashboard.selectedSessionIds.has(sale.sessionId)).map((sale) => sale.id));
    return commerce.invoices.filter((invoice) => (invoice.sessionId && dashboard.selectedSessionIds.has(invoice.sessionId))
      || invoice.saleIds.some((id) => ids.has(id)));
  }, [allSessions, sales, dashboard.selectedSessionIds, commerce.invoices]);
  const review = useMemo(() => buildPaymentReview(scoped.payments, selectedInvoices, { days: Infinity }), [scoped.payments, selectedInvoices]);
  const unassignedReview = useMemo(() => buildPaymentReview(scoped.unassignedPayments, commerce.invoices, { days: Infinity }), [scoped.unassignedPayments, commerce.invoices]);
  const toThreads = (messages: typeof commerce.messages) => buildBuyerThreads(messages.map((message) => ({
    id: message.id, phone: message.phoneNumber, body: message.body, direction: message.direction,
    at: message.receivedAt || message.createdAt,
  })), dashboard.contactBook, { days: Infinity });
  const threads = useMemo(() => toThreads(scoped.messages), [scoped.messages, dashboard.contactBook]);
  const unassignedThreads = useMemo(() => toThreads(scoped.unassignedMessages), [scoped.unassignedMessages, dashboard.contactBook]);
  const visibleReview = tab === 'unassigned' ? unassignedReview : review;
  const visibleThreads = tab === 'unassigned' ? unassignedThreads : threads;
  const invoiceSessionLabel = (invoice: InvoiceForReview) => {
    const ids = new Set(invoice.sessionId ? [invoice.sessionId] : []);
    const saleIds = new Set(invoice.saleIds);
    for (const sale of sales) if (saleIds.has(sale.id)) ids.add(sale.sessionId);
    return [...ids].map((id) => manageScopeLabel({ mode: 'session', sessionId: id }, selection.sessions)).join(' · ') || '회차 확인안됨';
  };

  const toggle = (paymentId: string, invoiceId: string) => setPicked((prev) => {
    const item = visibleReview.find((entry) => entry.payment.id === paymentId);
    const current = item ? reviewInvoiceSelection(item, prev[paymentId]) : [];
    return { ...prev, [paymentId]: current.includes(invoiceId) ? current.filter((id) => id !== invoiceId) : [...current, invoiceId] };
  });

  const confirm = async (item: PaymentReviewItem) => {
    const chosen = reviewInvoiceSelection(item, picked[item.payment.id]);
    if (chosen.length === 0) { setError('붙일 정산서를 골라 주세요.'); return; }
    const total = item.candidates.filter((invoice) => chosen.includes(invoice.id)).reduce((sum, invoice) => sum + invoice.amount, 0);
    if (total !== item.payment.amount && !window.confirm(`입금 ${formatWon(item.payment.amount)}과 고른 정산서 합계 ${formatWon(total)}가 다릅니다. 그래도 붙일까요?`)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setError('인터넷 연결 후 다시 해 주세요.'); return; }
    setBusy(item.payment.id); setError(null);
    try {
      await commerce.confirmPayment(item.payment.id, chosen);
      const target = item.candidates.filter((invoice) => chosen.includes(invoice.id)).map(invoiceSessionLabel).join(', ');
      appToast({ message: `${item.payment.payerName} 입금을 ${target} 정산서에 연결했습니다.` });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const dismiss = (item: PaymentReviewItem) => {
    if (!window.confirm(`${item.payment.payerName} ${formatWon(item.payment.amount)} 입금을 판매와 관계없는 입금으로 둘까요?`)) return;
    commerce.dismissPayment(item.payment.id);
    appToast({ message: '판매와 관계없는 입금으로 두었습니다.' });
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <ManageScopeControl selection={selection} leading={<ManageBackLink />} />
      <div role="tablist" aria-label="문자·입금" className="flex gap-1 overflow-x-auto pb-1">
        {[{ id: 'payments', label: `입금 확인 ${review.length}` }, { id: 'messages', label: `받은 문자 ${threads.length}` }, { id: 'unassigned', label: `회차 미확인 ${unassignedReview.length + unassignedThreads.length}` }].map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
            onClick={() => setParams((previous) => { const next = new URLSearchParams(previous); if (item.id === 'payments') next.delete('tab'); else next.set('tab', item.id); return next; })}
            className={`min-h-[36px] flex-shrink-0 rounded-full px-3 text-xs font-bold ${tab === item.id ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            {item.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}

      <p className="text-[11px] text-slate-500">{tab === 'unassigned' ? '어느 회차인지 확인되지 않은 내역입니다. 판매·정산서 또는 구매자를 확인해 연결하세요.' : '방송 종료 뒤 들어온 입금도 판매·정산서 연결로 표시합니다. 문자는 선택 회차의 구매자 연락처 또는 판매 연결 기준입니다.'}</p>

      {(tab === 'payments' || tab === 'unassigned') && (
        visibleReview.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">확인할 입금이 없습니다. 입금은 들어오면 자동으로 정산서에 붙습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {visibleReview.map((item) => {
              const chosen = reviewInvoiceSelection(item, picked[item.payment.id]);
              return (
                <li key={item.payment.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-extrabold">{item.payment.payerName || '이름 없음'}</span>
                    <span className="text-sm font-black tabular-nums">{formatWon(item.payment.amount)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {when(item.payment.paidAt)}{item.payment.bank ? ` · ${item.payment.bank}` : ''} ·{' '}
                    <span className={item.kind === 'NEEDS_REVIEW' ? 'font-bold text-amber-700' : 'font-bold text-slate-600'}>
                      {item.kind === 'NEEDS_REVIEW' ? '후보가 여럿이거나 금액만 같음' : '맞는 정산서를 못 찾음'}
                    </span>
                  </p>
                  {item.candidates.length === 0 ? (
                    <p className="text-xs text-slate-500">같은 금액의 열린 정산서가 없습니다. <Link to="/invoices" className="font-bold text-brand-700">정산서 화면</Link>에서 직접 붙이세요.</p>
                  ) : (
                    <ul className="space-y-1">
                      {item.candidates.slice(0, 6).map((invoice, index) => (
                        <li key={invoice.id}>
                          <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 px-2 text-xs">
                            <input type="checkbox" checked={chosen.includes(invoice.id)} onChange={() => toggle(item.payment.id, invoice.id)} />
                            <span className="min-w-0 flex-1 text-slate-800">
                              <span className="block truncate font-bold">{invoice.customerNickname}{index === 0 ? ' (추천)' : ''}</span>
                              <span className="block break-words text-[10px] text-slate-500">{invoiceSessionLabel(invoice)}</span>
                            </span>
                            <span className="tabular-nums">{formatWon(invoice.amount)}</span>
                            {invoice.depositCode && <span className="text-slate-400">{invoice.depositCode}</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <button type="button" disabled={busy !== null || item.candidates.length === 0} onClick={() => confirm(item)} className="h-10 flex-1 rounded-xl bg-slate-900 text-sm font-bold text-white disabled:opacity-40">이 정산서에 붙이기</button>
                    <button type="button" disabled={busy !== null} onClick={() => dismiss(item)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600">관계없는 입금</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}

      {(tab === 'messages' || tab === 'unassigned') && (
        visibleThreads.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">표시할 받은 문자가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {visibleThreads.map((thread) => (
              <li key={thread.phone} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-extrabold">{thread.nickname || formatPhone(thread.phone)}</span>
                  <span className="flex-shrink-0 text-[11px] text-slate-500">{when(thread.lastAt)}{thread.incomingCount > 1 ? ` · ${thread.incomingCount}통` : ''}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{thread.lastBody}</p>
                {!thread.nickname && <Link to={withManageScope('/manage/contacts', scope)} className="mt-1 inline-block text-xs font-bold text-amber-700">누군지 모르는 번호: 연락처 연결</Link>}
              </li>
            ))}
          </ul>
        )
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {[
          { to: '/manage/contacts', icon: UserCheck, name: '연락처 연결', hint: '구매자가 보낸 닉네임·번호 확인, 모르는 번호 지정' },
          { to: '/customer-messages', icon: GitCompare, name: '문자 전체 (기존 화면)', hint: '받은 문자와 판매내역을 맞춰 봅니다' },
          { to: '/invoices', icon: ReceiptText, name: '정산서·입금 (기존 화면)', hint: '정산서와 입금 전체 기록' },
        ].map((item) => (
          <li key={item.to}>
            <Link to={withManageScope(item.to, scope)} className="flex min-h-[52px] items-center gap-3 px-4 py-2 active:bg-slate-50">
              <item.icon className="h-5 w-5 flex-shrink-0 text-brand-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">{item.name}</span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{item.hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ManageInboxPage;
