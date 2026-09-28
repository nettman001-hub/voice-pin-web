import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, CreditCard, FileText, RefreshCw, Send, Smartphone, WalletCards, Layers } from 'lucide-react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useAuth } from '../../context/AuthContext';
import { productSalesApi } from '../../services/productSalesApi';
import { LiveSession } from '../../types/productSales';
import { formatSessionDisplay } from '../../utils/sessionFormatter';

const invoiceStatusLabel = {
  DRAFT: '작성중',
  QUEUED: '문자 발송대기',
  SENT: '발송완료',
  PAID: '입금완료',
  CANCELLED: '취소'
} as const;

export const InvoiceManagementPage: React.FC = () => {
  const { sales } = useSales();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cloudSessions, setCloudSessions] = useState<LiveSession[]>([]);
  const {
    invoices,
    payments,
    bridgeStatus,
    bridgeMessage,
    syncBridge,
    getClaimForSales,
    isPaid,
    createInvoice,
    sendInvoice,
    cancelInvoice
  } = useCommerce();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [bankAccount, setBankAccount] = useState(() => localStorage.getItem('voicecap_invoice_bank_account') || '');
  const [feedback, setFeedback] = useState('');
  const { isRemoteAuth } = useAuth();

  useEffect(() => {
    productSalesApi.listSessions()
      .then((data) => setCloudSessions(data.sessions))
      .catch((err) => console.warn('[InvoiceManagement] 세션 목록 로드 실패:', err));
  }, []);

  // 고유 방송 회차 세션 목록 추출
  const availableSessions = useMemo(() => {
    const sessionsById = new Map(cloudSessions.map((session) => [session.id, session]));
    sales.forEach((sale) => {
      if (sale.sessionId && !sessionsById.has(sale.sessionId)) {
        sessionsById.set(sale.sessionId, {
          id: sale.sessionId,
          displayCode: formatSessionDisplay(sale.sessionId, { recognizedAt: sale.recognizedAt }),
          status: 'ENDED',
          revision: 1,
          startedAt: sale.recognizedAt,
        });
      }
    });
    return Array.from(sessionsById.values()).sort((left, right) => (
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
    ));
  }, [cloudSessions, sales]);

  // 가장 최근 회차 세션 (진행 중인 세션 우선, 없으면 시작시각 기준 가장 최근 회차)
  const latestSessionId = useMemo(() => {
    if (availableSessions.length === 0) return null;
    const active = availableSessions.find((s) => s.status === 'ACTIVE');
    return active ? active.id : availableSessions[0].id;
  }, [availableSessions]);

  // URL 파라미터가 없으면 최근 회차를 기본값으로 지정
  const sessionFilter = useMemo(() => {
    const raw = searchParams.get('session');
    if (raw !== null) {
      return raw;
    }
    return latestSessionId || 'ALL';
  }, [searchParams, latestSessionId]);

  // 초기 진입 시 URL에 session 파라미터가 없으면 최근 회차로 URL 동기화 (기본값 최근회차)
  useEffect(() => {
    if (searchParams.get('session') === null && latestSessionId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('session', latestSessionId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, latestSessionId, setSearchParams]);

  const handleSessionFilterChange = (nextSessionId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('session', nextSessionId);
    setSearchParams(nextParams);
  };

  const selectableSales = useMemo(
    () => sales.filter((sale) => {
      if (sale.status === '보류' || isPaid([sale.id])) return false;
      if (sessionFilter !== 'ALL' && sale.sessionId !== sessionFilter) return false;
      return true;
    }),
    [sales, isPaid, sessionFilter]
  );

  const filteredInvoices = useMemo(() => {
    if (sessionFilter === 'ALL') return invoices;
    const saleSessionMap = new Map(sales.map((s) => [s.id, s.sessionId]));
    return invoices.filter((inv) =>
      inv.saleIds.some((id) => saleSessionMap.get(id) === sessionFilter)
    );
  }, [invoices, sales, sessionFilter]);
  const selectedSales = selectableSales.filter((sale) => selectedIds.includes(sale.id));
  const selectedNickname = selectedSales[0]?.buyerNickname || '';
  const selectedAmount = selectedSales.reduce((sum, sale) => sum + sale.amount, 0);

  useEffect(() => {
    const claim = getClaimForSales(selectedIds);
    setPhoneNumber(claim?.phoneNumber || '');
    setAddress(claim?.address || '');
  }, [selectedIds, getClaimForSales]);

  const toggleSale = (id: string) => {
    const sale = selectableSales.find((item) => item.id === id);
    if (!sale) return;
    setSelectedIds((previous) => {
      if (previous.includes(id)) return previous.filter((item) => item !== id);
      const first = selectableSales.find((item) => item.id === previous[0]);
      if (first && first.buyerNickname !== sale.buyerNickname) {
        setFeedback('정산서는 구매자 한 명씩 만들어 주세요.');
        return previous;
      }
      return [...previous, id];
    });
  };

  const handleCreate = () => {
    if (selectedIds.length === 0 || !phoneNumber.trim() || !bankAccount.trim()) {
      setFeedback('판매내역, 고객 전화번호, 입금계좌를 모두 입력해 주세요.');
      return;
    }
    localStorage.setItem('voicecap_invoice_bank_account', bankAccount.trim());
    const invoice = createInvoice({
      saleIds: selectedIds,
      customerNickname: selectedNickname,
      phoneNumber: phoneNumber.trim(),
      address: address.trim(),
      amount: selectedAmount,
      bankAccount: bankAccount.trim(),
      dueDate
    });
    setSelectedIds([]);
    setFeedback(`${invoice.customerNickname}님 정산서를 생성했습니다.`);
  };

  const handleSend = async (invoiceId: string) => {
    const result = await sendInvoice(invoiceId);
    setFeedback(result?.status === 'FAILED' ? `발송 요청 실패: ${result.error || ''}` : 'voicecapSMS 앱에 정산서 발송을 요청했습니다.');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3.5 sm:p-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl"><FileText className="h-6 w-6 text-brand-600" /> 정산서 관리 & 발송</h1>
            <p className="mt-1 text-xs text-slate-500">판매내역으로 청구 정산서를 만들고 voicecapSMS 앱을 통해 고객에게 발송합니다.</p>
          </div>
          <button onClick={() => void syncBridge()} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
            <RefreshCw className="h-4 w-4" /> 입금·문자 동기화
          </button>
        </div>
      </header>

      {feedback && <div role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs font-bold text-cyan-800">{feedback}</div>}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-black text-slate-900">voicecapSMS 연결 상태</h2><p className="mt-1 text-[11px] text-slate-500">서버 주소와 API 키를 직접 넣지 않습니다. 마이페이지에서 만든 1회용 연결 코드로 휴대폰을 연결합니다.</p></div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${bridgeStatus === 'ONLINE' ? 'bg-emerald-50 text-emerald-700' : bridgeStatus === 'CHECKING' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{isRemoteAuth ? bridgeMessage : '수파베이스 설정 후 사용 가능'}</span>
        </div>
      </section>

      {/* 방송 회차 선택 바 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-brand-600" />
          <span className="text-xs font-bold text-slate-800">방송 회차 선택:</span>
        </div>
        <select
          value={sessionFilter}
          onChange={(e) => handleSessionFilterChange(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-brand-500"
        >
          {availableSessions.map((session) => {
            const isLatest = session.id === latestSessionId;
            return (
              <option key={session.id} value={session.id}>
                {session.displayCode}
                {session.status === 'ACTIVE' ? ' · 진행 중 (실시간)' : isLatest ? ' (최근 회차)' : ''}
              </option>
            );
          })}
          <option value="ALL">전체 회차 (모든 방송 합산)</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-black text-slate-900">1. 청구할 판매내역 선택</h2>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {selectableSales.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-400">선택된 회차에 청구 가능한 판매내역이 없습니다.</p> : selectableSales.map((sale) => {
              const selected = selectedIds.includes(sale.id);
              const locked = selectedIds.length > 0 && !selected && selectedNickname !== sale.buyerNickname;
              return (
                <label key={sale.id} className={`flex items-center gap-3 rounded-xl border p-3 ${selected ? 'border-brand-400 bg-brand-50' : 'border-slate-200'} ${locked ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={selected} disabled={locked} onChange={() => toggleSale(sale.id)} className="h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-900">{sale.buyerNickname} · {sale.productName || '상품명 미입력'}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">회차: {formatSessionDisplay(sale.sessionId, { sessions: cloudSessions, recognizedAt: sale.recognizedAt })}</div>
                  </div>
                  <strong className="text-sm text-brand-700">{sale.amount.toLocaleString()}원</strong>
                </label>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-black text-slate-900">2. 정산서 정보</h2>
          <div className="space-y-2.5">
            <input value={selectedNickname} readOnly placeholder="구매자" className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-xs font-bold" />
            <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="고객 전화번호" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="배송주소" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
            <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="입금계좌 예: 국민 123-456 김미정" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
            <label className="block text-[10px] font-bold text-slate-500">입금기한<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" /></label>
            <div className="rounded-xl bg-brand-50 p-3 text-right"><span className="text-[10px] text-slate-500">청구금액</span><div className="text-xl font-black text-brand-700">{selectedAmount.toLocaleString()}원</div></div>
            <button onClick={handleCreate} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-3 text-xs font-bold text-white"><Check className="h-4 w-4" /> 정산서 생성</button>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 flex items-center gap-1.5 text-sm font-black text-slate-900"><Smartphone className="h-4 w-4 text-cyan-600" /> 생성된 정산서 ({filteredInvoices.length})</h2>
        <div className="space-y-3">
          {filteredInvoices.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">선택된 회차에 생성된 정산서가 없습니다.</p> : filteredInvoices.map((invoice) => (
            <article key={invoice.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="flex items-center gap-2"><strong className="text-sm text-slate-900">{invoice.customerNickname}</strong><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{invoiceStatusLabel[invoice.status]}</span></div><p className="mt-1 text-[10px] text-slate-500">{invoice.phoneNumber} · 기한 {invoice.dueDate}</p></div>
                <strong className="text-lg text-brand-700">{invoice.amount.toLocaleString()}원</strong>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {invoice.saleIds.map((id) => <Link key={id} to={`/sales/${id}`} className="rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">판매 #{id}</Link>)}
                {invoice.status === 'DRAFT' && <button onClick={() => void handleSend(invoice.id)} className="flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-[10px] font-bold text-white"><Send className="h-3 w-3" /> SMS 발송</button>}
                {!['PAID', 'CANCELLED'].includes(invoice.status) && <button onClick={() => cancelInvoice(invoice.id)} className="rounded-lg bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-700">취소</button>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-1.5 text-sm font-black text-slate-900"><WalletCards className="h-4 w-4 text-emerald-600" /> 입금 대조</h2><span className="text-[10px] text-slate-500">스마트폰 입금 감지 앱 연동용 API 준비 완료</span></div>
        {payments.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-400">수신된 입금내역이 없습니다. 추후 입금 감지 앱이 전달하면 자동 대조됩니다.</p> : payments.map((payment) => (
          <div key={payment.id} className="mb-2 flex items-center justify-between rounded-xl border border-slate-200 p-3 text-xs"><span><strong>{payment.payerName}</strong> · {new Date(payment.paidAt).toLocaleString('ko-KR')}</span><span className="font-black text-emerald-700">{payment.amount.toLocaleString()}원 · {payment.matchStatus === 'MATCHED' ? '입금완료' : '확인필요'}</span></div>
        ))}
      </section>
    </div>
  );
};
