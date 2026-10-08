import React, { useMemo, useState } from 'react';
import { Check, WalletCards, X } from 'lucide-react';
import type { PaymentReceipt, SettlementInvoice } from '../../types/commerce';
import { isOpenInvoice } from '../../services/paymentMatching';

interface Props {
  payments: PaymentReceipt[];
  invoices: SettlementInvoice[];
  onConfirm: (paymentId: string, invoiceIds: string[]) => Promise<void> | void;
  onDismiss: (paymentId: string) => void;
}

const statusView: Record<PaymentReceipt['matchStatus'], { label: string; tone: string }> = {
  MATCHED: { label: '자동 확정', tone: 'bg-emerald-50 text-emerald-700' },
  NEEDS_REVIEW: { label: '확인 필요', tone: 'bg-amber-50 text-amber-700' },
  UNMATCHED: { label: '미확인', tone: 'bg-slate-100 text-slate-600' },
};

const sourceLabel = (payment: PaymentReceipt) =>
  [payment.bank, payment.source === 'SMS' ? '입금 문자' : payment.source === 'MANUAL' ? '직접 입력' : payment.source ? '은행 알림' : '']
    .filter(Boolean)
    .join(' · ');

const invoiceLine = (invoice: SettlementInvoice) =>
  `${invoice.customerNickname} · ${invoice.amount.toLocaleString()}원${invoice.depositCode ? ` · ${invoice.depositCode}` : ''}`;

/** 금액이 같은 후보 중 하나를 고르는지, 여러 정산서 합계로 한 번에 낸 입금인지 */
const isCombined = (payment: PaymentReceipt, candidates: SettlementInvoice[]) =>
  candidates.length > 1
  && candidates.some((invoice) => invoice.amount !== payment.amount)
  && candidates.reduce((sum, invoice) => sum + invoice.amount, 0) === payment.amount;

const PaymentRow: React.FC<Props & { payment: PaymentReceipt }> = ({ payment, invoices, onConfirm, onDismiss }) => {
  const [manualId, setManualId] = useState('');
  const [busy, setBusy] = useState(false);
  const linked = invoices.find((invoice) => invoice.id === payment.invoiceId);
  const candidates = (payment.candidateIds || [])
    .map((id) => invoices.find((invoice) => invoice.id === id))
    .filter((invoice): invoice is SettlementInvoice => Boolean(invoice) && isOpenInvoice(invoice!));
  const openInvoices = invoices.filter((invoice) => isOpenInvoice(invoice));
  const combined = isCombined(payment, candidates);
  const view = statusView[payment.matchStatus];

  const confirm = async (invoiceIds: string[]) => {
    if (invoiceIds.length === 0 || busy) return;
    setBusy(true);
    try {
      await onConfirm(payment.id, invoiceIds);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-1.5 rounded-xl border border-slate-200 p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="text-slate-900">{payment.payerName}</strong>
          <span className="text-slate-500"> · {new Date(payment.paidAt).toLocaleString('ko-KR')}</span>
          {sourceLabel(payment) && <p className="mt-0.5 text-[10px] text-slate-400">{sourceLabel(payment)}{payment.receiverName ? ` · 받는 통장 ${payment.receiverName}` : ''}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <strong className="font-black text-slate-900">{payment.amount.toLocaleString()}원</strong>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${view.tone}`}>{view.label}</span>
        </div>
      </div>

      {payment.matchStatus === 'MATCHED' && linked && (
        <p className="mt-1 text-[10px] text-emerald-700">연결된 정산서: {invoiceLine(linked)}</p>
      )}

      {payment.matchStatus !== 'MATCHED' && candidates.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {combined ? (
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-amber-50 px-2 py-1">
              <span className="text-[10px] text-amber-800">정산서 {candidates.length}건 합계와 같습니다: {candidates.map(invoiceLine).join(' / ')}</span>
              <button disabled={busy} onClick={() => void confirm(candidates.map((invoice) => invoice.id))} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50">
                <Check className="h-3 w-3" /> 합산 확정
              </button>
            </div>
          ) : candidates.map((invoice, index) => (
            <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-amber-50 px-2 py-1">
              <span className="text-[10px] text-amber-800">{index === 0 ? '추천 · ' : ''}{invoiceLine(invoice)}</span>
              <button disabled={busy} onClick={() => void confirm([invoice.id])} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50">
                <Check className="h-3 w-3" /> 이 정산서로 확정
              </button>
            </div>
          ))}
        </div>
      )}

      {payment.matchStatus !== 'MATCHED' && (
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
          {openInvoices.length > 0 && (
            <>
              <select value={manualId} onChange={(event) => setManualId(event.target.value)} className="max-w-[60%] rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px]">
                <option value="">다른 정산서 직접 선택</option>
                {openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoiceLine(invoice)}</option>)}
              </select>
              <button disabled={!manualId || busy} onClick={() => void confirm([manualId])} className="rounded-lg bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-40">연결</button>
            </>
          )}
          {candidates.length > 0 && (
            <button onClick={() => onDismiss(payment.id)} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              <X className="h-3 w-3" /> 판매와 관계없음
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const PaymentReconciliationPanel: React.FC<Props> = (props) => {
  const { payments } = props;
  const sorted = useMemo(() => {
    const order = { NEEDS_REVIEW: 0, UNMATCHED: 1, MATCHED: 2 } as const;
    return [...payments].sort((left, right) => order[left.matchStatus] - order[right.matchStatus]
      || new Date(right.paidAt).getTime() - new Date(left.paidAt).getTime());
  }, [payments]);
  const reviewCount = payments.filter((payment) => payment.matchStatus === 'NEEDS_REVIEW').length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs sm:text-sm font-black text-slate-900"><WalletCards className="h-4 w-4 text-emerald-600" /> 입금 대조</h2>
        <span className="text-[10px] text-slate-500">{reviewCount > 0 ? `확인 필요 ${reviewCount}건` : '입금자명·입금코드로 자동 대조'}</span>
      </div>
      {sorted.length === 0
        ? <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-400">수신된 입금내역이 없습니다. 휴대폰 앱이 은행 입금 알림을 보내면 자동 대조됩니다.</p>
        : sorted.map((payment) => <PaymentRow key={payment.id} {...props} payment={payment} />)}
      <p className="mt-1.5 text-[10px] text-slate-400">금액만 같은 입금은 자동으로 확정하지 않습니다. 확정하면 입금자명을 기억해 다음부터 자동 확정합니다.</p>
    </section>
  );
};
