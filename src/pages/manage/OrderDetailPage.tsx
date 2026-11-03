import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Send, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useManageDashboard } from '../../services/manage/useManageData';
import { ManageApi } from '../../services/manage/manageApi';
import { MONEY_STAGE_LABEL } from '../../services/manage/orderPipeline';
import { GOODS_STATE_LABEL, goodsStateOf, type GoodsState } from '../../services/manage/fulfillment';
import { formatPhone } from '../../services/manage/contactWorklist';
import {
  INVOICE_FORM_ERROR_TEXT, readSavedBankAccount, saveBankAccount, defaultDueDate, invoiceSmsBody, validateInvoiceForm,
} from '../../services/manage/orderInvoice';
import { sendOrderInvoice } from '../../services/manage/invoiceSender';
import { generateDepositCode } from '../../services/paymentMatching';
import { formatWon } from '../../services/appShellState';
import { appToast } from '../../services/appDownload';
import type { SettlementInvoice } from '../../types/commerce';

const STATUS_TEXT: Record<string, string> = {
  DRAFT: '아직 안 보냄', QUEUED: '보내는 중', SENT: '보냄', PAID: '입금 완료', CANCELLED: '취소됨',
};


/**
 * 주문 상세 (회차×구매자 한 장).
 * 정산서는 서버에서 만든다 (회차×구매자마다 하나). 보내기는 서버 잠금을 잡고 한 번만 보낸다.
 */
export const OrderDetailPage: React.FC = () => {
  const { orderKey = '' } = useParams();
  const key = useMemo(() => { try { return decodeURIComponent(orderKey); } catch { return orderKey; } }, [orderKey]);
  const { workspaceId } = useAuth();
  const { sales } = useSales();
  const commerce = useCommerce();
  const api = useMemo(() => (workspaceId ? new ManageApi(workspaceId) : null), [workspaceId]);
  const [reloadKey, setReloadKey] = useState(0);
  const { dashboard } = useManageDashboard(0, reloadKey);
  const order = dashboard.orders.find((item) => item.key === key);
  const [bankAccount, setBankAccount] = useState(readSavedBankAccount);
  const [dueDate, setDueDate] = useState(() => defaultDueDate(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (order?.contact?.phone) setPhone(order.contact.phone);
  }, [order?.contact?.phone]);

  const items = useMemo(() => {
    if (!order) return [];
    const ids = new Set(order.saleIds);
    return sales.filter((sale) => ids.has(sale.id)).sort((a, b) => a.recognizedAt.localeCompare(b.recognizedAt));
  }, [order, sales]);

  const stateOf = (saleId: string): GoodsState =>
    goodsStateOf(dashboard.paidSaleIds.has(saleId), dashboard.fulfillmentItems.get(saleId));

  const invoicesById = useMemo(() => new Map(commerce.invoices.map((invoice) => [invoice.id, invoice])), [commerce.invoices]);
  const invoice: SettlementInvoice | undefined = order?.invoiceId ? invoicesById.get(order.invoiceId) : undefined;

  if (!order) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-3">
        <Link to="/manage/orders" className="inline-flex items-center gap-1 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />주문 목록</Link>
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">주문을 찾지 못했습니다. 판매가 취소됐거나 아직 불러오는 중입니다.</p>
      </div>
    );
  }

  const run = async (label: string, action: () => Promise<string>) => {
    if (!api) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setError('인터넷 연결 후 다시 해 주세요.'); return; }
    setBusy(label); setError(null); setNotice(null);
    try {
      const message = await action();
      setNotice(message); appToast({ message });
      setReloadKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const sendBody = (target: Pick<SettlementInvoice, 'bankAccount' | 'dueDate' | 'depositCode'>) => invoiceSmsBody({
    nickname: order.nickname, productAmount: order.productAmount, shippingFee: order.shipping.fee,
    deferredShipping: order.shipping.deferredToShipment, itemCount: order.itemCount,
    bankAccount: target.bankAccount, dueDate: target.dueDate, depositCode: target.depositCode,
  });

  const sendExisting = (target: SettlementInvoice, resend: boolean) => run('send', async () => {
    const result = await api!.sendInvoiceOnce(target.id, async () => {
      const sms = await commerce.sendSms(target.phoneNumber, sendBody(target), 'INVOICE', target.saleIds);
      return sms.status === 'FAILED' ? { sent: false, error: sms.error || '문자 보내기 실패' } : { sent: true, smsMessageId: sms.id };
    }, { resend });
    if (result.sendError) throw new Error(`문자를 보내지 못했습니다: ${String(result.sendError)}`);
    return `${order.nickname}님께 정산서를 보냈습니다.`;
  });

  const createAndSend = () => {
    const usedCodes = commerce.invoices.filter((item) => item.depositCode && !['PAID', 'CANCELLED'].includes(item.status))
      .map((item) => item.depositCode as string);
    const form = { phone, bankAccount, dueDate, depositCode: generateDepositCode(usedCodes) };
    const invalid = validateInvoiceForm(order, form);
    if (invalid) { setError(INVOICE_FORM_ERROR_TEXT[invalid]); return; }
    saveBankAccount(form.bankAccount);
    return run('send', async () => {
      const outcome = await sendOrderInvoice({
        api: api!, order, form, invoicesById,
        sendSms: (to, body, saleIds) => commerce.sendSms(to, body, 'INVOICE', saleIds),
      });
      if (outcome.status === 'FAILED') throw new Error(`정산서는 만들었지만 문자를 보내지 못했습니다: ${outcome.reason}`);
      if (outcome.status === 'SKIPPED') return `${outcome.reason}.`;
      return `${order.nickname}님께 정산서를 보냈습니다.`;
    });
  };

  const cancel = (target: SettlementInvoice) => {
    if (!window.confirm('이 정산서를 취소할까요? 고객에게는 따로 알리지 않습니다.')) return;
    return run(`cancel:${target.id}`, async () => { await api!.cancelInvoice(target.id); return '정산서를 취소했습니다.'; });
  };

  const open = invoice && ['DRAFT', 'QUEUED', 'SENT'].includes(invoice.status);
  const readyIds = items.filter((sale) => stateOf(sale.id) === 'READY_TO_SHIP').map((sale) => sale.id);
  const keptIds = items.filter((sale) => stateOf(sale.id) === 'KEPT').map((sale) => sale.id);

  const keep = () => run('keep', async () => {
    await api!.keep(order.buyerKey, readyIds);
    return `${readyIds.length}개를 보관했습니다. 다음 출고 때 함께 나갑니다.`;
  });
  const unkeep = () => run('unkeep', async () => {
    await api!.unkeep(keptIds);
    return `보관을 풀었습니다. ${keptIds.length}개가 발송 대기로 돌아갔습니다.`;
  });
  const cancelItem = (saleId: string, label: string) => {
    const reason = window.prompt(`${label}: 고객이 취소한 이유를 적어 주세요.`, '고객 요청');
    if (reason === null) return;
    return run(`cancel-item:${saleId}`, async () => {
      await api!.cancelItems({ buyerKey: order.buyerKey, saleIds: [saleId], reason: reason.trim() || '고객 요청', cancelledBy: 'CUSTOMER' });
      return dashboard.paidSaleIds.has(saleId) ? '취소했습니다. 입금된 상품이라 [출고 › 환불 필요]에 올렸습니다.' : '취소했습니다.';
    });
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <Link to={`/manage/orders?stage=${order.stage}`} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600">
        <ArrowLeft className="h-4 w-4" />주문 목록
      </Link>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-slate-900">{order.nickname}</h2>
            <p className="text-xs text-slate-500">회차 {order.sessionId}</p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{MONEY_STAGE_LABEL[order.stage]}</span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] text-slate-500">상품 {order.itemCount}개</dt><dd className="text-sm font-black tabular-nums">{formatWon(order.productAmount)}</dd></div>
          <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] text-slate-500">배송비</dt><dd className="text-sm font-black tabular-nums">{order.shipping.deferredToShipment ? '출고 때' : formatWon(order.shipping.fee)}</dd></div>
          <div className="rounded-xl bg-slate-900 p-2 text-white"><dt className="text-[11px] text-slate-300">청구</dt><dd className="text-sm font-black tabular-nums">{formatWon(order.totalAmount)}</dd></div>
        </dl>
        {order.shipping.reason && <p className="mt-2 text-[11px] text-slate-500">{order.shipping.reason}</p>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2 text-xs font-extrabold text-slate-600">상품</h3>
        <ul className="divide-y divide-slate-100">
          {items.map((sale) => (
            <li key={sale.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{sale.productName || sale.productCode || '상품'}{(sale.quantity || 1) > 1 ? ` × ${sale.quantity}` : ''}</p>
                <p className="text-[11px] text-slate-500">{new Date(sale.recognizedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{GOODS_STATE_LABEL[stateOf(sale.id)]}</span>
                <span className="text-sm font-black tabular-nums">{formatWon(sale.amount)}</span>
                {['UNPAID', 'READY_TO_SHIP', 'KEPT'].includes(stateOf(sale.id)) && (
                  <button type="button" disabled={busy !== null} aria-label="고객 취소" onClick={() => cancelItem(sale.id, sale.productName || '상품')} className="h-8 rounded-lg border border-slate-200 px-2 text-[11px] font-bold text-slate-500 disabled:opacity-50">취소</button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {(readyIds.length > 0 || keptIds.length > 0) && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
            {readyIds.length > 0 && (
              <button type="button" disabled={busy !== null} onClick={keep} className="h-10 rounded-xl bg-slate-900 px-3 text-sm font-bold text-white disabled:opacity-50">보관하기 {readyIds.length}개 (다음에 함께 보내기)</button>
            )}
            {keptIds.length > 0 && (
              <button type="button" disabled={busy !== null} onClick={unkeep} className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 disabled:opacity-50">보관 풀기 {keptIds.length}개</button>
            )}
            <Link to="/manage/ship" className="inline-flex h-10 items-center text-sm font-bold text-brand-700">출고 화면</Link>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-extrabold text-slate-600">정산서</h3>
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}

        {order.stage === 'NEEDS_CONTACT' && (
          <>
            <p className="text-sm text-slate-600">{order.contact?.reason || '연락처가 없습니다.'} 연락처를 연결해야 정산서를 보낼 수 있습니다.</p>
            <Link to="/manage/contacts" className="flex h-12 items-center justify-center rounded-xl bg-amber-500 text-sm font-extrabold text-white">연락처 연결하기</Link>
          </>
        )}

        {order.stage === 'PAID' && <p className="text-sm font-bold text-emerald-700">입금이 확인됐습니다.</p>}

        {invoice && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-bold text-slate-900">{STATUS_TEXT[invoice.status] || invoice.status} · {formatWon(invoice.amount)}</p>
            <p>{formatPhone(invoice.phoneNumber)} · 기한 {invoice.dueDate}{invoice.depositCode ? ` · 입금코드 ${invoice.depositCode}` : ''}</p>
            {invoice.sentAt && <p>보낸 시각 {new Date(invoice.sentAt).toLocaleString('ko-KR')}</p>}
            {invoice.amount !== order.totalAmount && invoice.status !== 'PAID' && (
              <p className="mt-1 font-bold text-amber-700">정산서 금액이 지금 주문 합계({formatWon(order.totalAmount)})와 다릅니다. 취소하고 새로 보내 주세요.</p>
            )}
          </div>
        )}

        {order.stage === 'READY_TO_BILL' && !open && (
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600">받을 번호
              <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="block text-xs font-bold text-slate-600">입금계좌
              <input value={bankAccount} onChange={(event) => setBankAccount(event.target.value)} placeholder="예: 국민 123-45-6789 홍길동" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="block text-xs font-bold text-slate-600">입금기한
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <button type="button" disabled={busy !== null} onClick={createAndSend} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-extrabold text-white disabled:opacity-50">
              <Send className="h-4 w-4" />{busy === 'send' ? '보내는 중…' : `정산서 보내기 ${formatWon(order.totalAmount)}`}
            </button>
          </div>
        )}

        {open && invoice && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy !== null} onClick={() => sendExisting(invoice, invoice.status !== 'DRAFT')} className="flex h-11 items-center justify-center gap-1 rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-50">
              <Send className="h-4 w-4" />{invoice.status === 'DRAFT' ? '보내기' : '다시 보내기'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => cancel(invoice)} className="flex h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 disabled:opacity-50">
              <XCircle className="h-4 w-4" />정산서 취소
            </button>
          </div>
        )}

      </section>
    </div>
  );
};

export default OrderDetailPage;
