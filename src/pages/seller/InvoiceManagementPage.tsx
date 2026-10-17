import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Check,
  CreditCard,
  FileText,
  RefreshCw,
  Send,
  Smartphone,
  Layers,
  X,
  ChevronDown,
  ChevronUp,
  Truck,
  Calculator,
  RotateCcw
} from 'lucide-react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useAuth } from '../../context/AuthContext';
import { productSalesApi } from '../../services/productSalesApi';
import { LiveSession } from '../../types/productSales';
import { SaleRecord } from '../../types/live';
import { formatSessionDisplay } from '../../utils/sessionFormatter';
import { shippingService } from '../../services/shippingService';
import { PaymentReconciliationPanel } from '../../components/seller/PaymentReconciliationPanel';

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
    phonePush,
    syncBridge,
    getClaimForSales,
    isPaid,
    createInvoice,
    sendInvoice,
    cancelInvoice,
    confirmPayment,
    dismissPayment
  } = useCommerce();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [bankAccount, setBankAccount] = useState(() => localStorage.getItem('voicecap_invoice_bank_account') || '');
  const [includeShippingInInvoice, setIncludeShippingInInvoice] = useState(true);
  const [expandedBuyerKeys, setExpandedBuyerKeys] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const { isRemoteAuth, workspaceId } = useAuth();

  const shippingConfig = useMemo(() => shippingService.getConfig(workspaceId), [workspaceId]);

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
    setSelectedIds([]); // 회차 변경 시 선택 초기화
  };

  const selectableSales = useMemo(
    () => sales.filter((sale) => {
      if (sale.status === '보류' || sale.status === '취소' || sale.syncStatus === 'PENDING' || isPaid([sale.id])) return false;
      if (sessionFilter !== 'ALL' && sale.sessionId !== sessionFilter) return false;
      return true;
    }),
    [sales, isPaid, sessionFilter]
  );

  const selectedSession = sessionFilter === 'ALL'
    ? null
    : availableSessions.find((session) => session.id === sessionFilter) || null;

  const sessionStartTime = useMemo(() => {
    if (!selectedSession?.startedAt) return null;
    const t = new Date(selectedSession.startedAt).getTime();
    return isNaN(t) ? null : t;
  }, [selectedSession]);

  const filteredInvoices = useMemo(() => {
    if (sessionFilter === 'ALL') return invoices;
    const saleSessionMap = new Map(sales.map((s) => [s.id, s.sessionId]));
    return invoices.filter((inv) =>
      inv.saleIds.some((id) => saleSessionMap.get(id) === sessionFilter)
    );
  }, [invoices, sales, sessionFilter]);

  // 선택한 회차 이전에 수신된 입금 내역은 제외
  const filteredPayments = useMemo(() => {
    if (!sessionStartTime) return payments;
    return payments.filter((p) => {
      const timeStr = p.paidAt || p.createdAt;
      const t = new Date(timeStr).getTime();
      return isNaN(t) || t >= sessionStartTime;
    });
  }, [payments, sessionStartTime]);

  // 구매자별 판매 그룹 목록 생성 (금액 수식, 택배비 포함 금액 포함)
  interface BuyerGroup {
    buyerNickname: string;
    sales: SaleRecord[];
    totalProductAmount: number;
    shippingFee: number;
    totalWithShipping: number;
    formula: string; // 예: "구매 3건: 5,000원 + 8,000원 + 15,000원 = 합 28,000원"
    selectedCount: number;
    isFullySelected: boolean;
    isPartiallySelected: boolean;
  }

  const buyerGroups = useMemo<BuyerGroup[]>(() => {
    const map = new Map<string, SaleRecord[]>();
    selectableSales.forEach((sale) => {
      const nick = sale.buyerNickname?.trim() || '미확인';
      const list = map.get(nick) || [];
      list.push(sale);
      map.set(nick, list);
    });

    return Array.from(map.entries()).map(([buyerNickname, list]) => {
      const totalProductAmount = list.reduce((sum, s) => sum + (s.amount || 0), 0);
      const shippingFee = shippingService.calculateShippingFee(totalProductAmount, shippingConfig).fee;
      const totalWithShipping = totalProductAmount + shippingFee;

      // 구매 n건: 금액1 + 금액2 = 합 N원 형식의 수식 생성
      let formula = '';
      if (list.length === 1) {
        formula = `구매 1건: ${list[0].amount.toLocaleString()}원 = 합 ${totalProductAmount.toLocaleString()}원`;
      } else {
        const parts = list.map((s) => `${s.amount.toLocaleString()}원`).join(' + ');
        formula = `구매 ${list.length}건: ${parts} = 합 ${totalProductAmount.toLocaleString()}원`;
      }

      const saleIds = list.map((s) => s.id);
      const selectedCount = saleIds.filter((id) => selectedIds.includes(id)).length;
      const isFullySelected = selectedCount === saleIds.length && saleIds.length > 0;
      const isPartiallySelected = selectedCount > 0 && selectedCount < saleIds.length;

      return {
        buyerNickname,
        sales: list,
        totalProductAmount,
        shippingFee,
        totalWithShipping,
        formula,
        selectedCount,
        isFullySelected,
        isPartiallySelected,
      };
    });
  }, [selectableSales, shippingConfig, selectedIds]);

  // 현재 선택된 판매 건들
  const selectedSales = selectableSales.filter((sale) => selectedIds.includes(sale.id));
  const selectedNickname = selectedSales[0]?.buyerNickname || '';
  const selectedAmount = selectedSales.reduce((sum, sale) => sum + sale.amount, 0);
  const selectedShippingFee = shippingService.calculateShippingFee(selectedAmount, shippingConfig).fee;
  const selectedTotalWithShipping = selectedAmount + selectedShippingFee;

  // 선택된 건들에 대한 수식 생성
  const selectedFormula = useMemo(() => {
    if (selectedSales.length === 0) return '';
    if (selectedSales.length === 1) {
      return `구매 1건: ${selectedSales[0].amount.toLocaleString()}원 = 합 ${selectedAmount.toLocaleString()}원`;
    }
    const parts = selectedSales.map((s) => `${s.amount.toLocaleString()}원`).join(' + ');
    return `구매 ${selectedSales.length}건: ${parts} = 합 ${selectedAmount.toLocaleString()}원`;
  }, [selectedSales, selectedAmount]);

  useEffect(() => {
    const claim = getClaimForSales(selectedIds);
    setPhoneNumber(claim?.phoneNumber || '');
    setAddress(claim?.address || '');
  }, [selectedIds, getClaimForSales]);

  // 스마트 스위칭: 구매자 단위 원클릭 전체 선택 / 해제
  const handleToggleBuyerGroup = (group: BuyerGroup) => {
    const groupSaleIds = group.sales.map((s) => s.id);

    if (group.isFullySelected) {
      // 이미 이 구매자의 전체가 선택되어 있으면 해제
      setSelectedIds([]);
      setFeedback(`${group.buyerNickname}님의 선택을 해제했습니다.`);
    } else {
      // 다른 구매자가 선택되어 있었더라도 이전 선택을 자동으로 풀고 이 구매자로 즉시 전환!
      setSelectedIds(groupSaleIds);
      setFeedback(`${group.buyerNickname}님의 주문 ${group.sales.length}건을 모두 선택했습니다.`);
    }
  };

  // 개별 판매 건 토글 (다른 구매자의 품목을 클릭하면 스마트하게 전환)
  const toggleSale = (sale: SaleRecord) => {
    setSelectedIds((previous) => {
      if (previous.includes(sale.id)) {
        return previous.filter((item) => item !== sale.id);
      }
      const first = selectableSales.find((item) => item.id === previous[0]);
      // 만약 다른 구매자의 판매건을 클릭하면, 이전 선택을 풀고 이 구매자로 자동 전환!
      if (first && first.buyerNickname !== sale.buyerNickname) {
        setFeedback(`${sale.buyerNickname}님으로 선택 대상을 전환했습니다.`);
        return [sale.id];
      }
      return [...previous, sale.id];
    });
  };

  // 전체 선택 해제
  const handleClearSelection = () => {
    setSelectedIds([]);
    setFeedback('선택이 모두 해제되었습니다.');
  };

  // 아코디언 토글
  const toggleExpand = (buyerNickname: string) => {
    setExpandedBuyerKeys((prev) =>
      prev.includes(buyerNickname) ? prev.filter((k) => k !== buyerNickname) : [...prev, buyerNickname]
    );
  };

  const finalInvoiceAmount = includeShippingInInvoice ? selectedTotalWithShipping : selectedAmount;

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
      amount: finalInvoiceAmount,
      bankAccount: bankAccount.trim(),
      dueDate
    });
    setSelectedIds([]);
    setFeedback(`${invoice.customerNickname}님 정산서를 생성했습니다. (${selectedFormula}, 청구액: ${finalInvoiceAmount.toLocaleString()}원)`);
  };

  const handleSend = async (invoiceId: string) => {
    const result = await sendInvoice(invoiceId);
    setFeedback(result?.status === 'FAILED' ? `발송 요청 실패: ${result.error || ''}` : 'voicecapSMS 앱에 정산서 발송을 요청했습니다.');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-2.5 sm:space-y-3 p-2.5 sm:p-4">
      <header className="rounded-2xl border border-slate-200 bg-white px-3 py-2 sm:px-4 sm:py-2.5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-1.5 text-sm sm:text-base font-black text-slate-900">
              <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-brand-600" /> 정산서 관리 & 발송
            </h1>
            <p className="mt-0.5 text-[10px] sm:text-[11px] text-slate-500">
              판매내역으로 청구 정산서를 만들고 voicecapSMS 앱을 통해 고객에게 발송합니다.
            </p>
          </div>
          <button
            onClick={() => void syncBridge()}
            className="h-8 px-2.5 sm:px-3 flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex-shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 입금·문자 동기화
          </button>
        </div>
      </header>

      {/* 방송 회차 선택 바 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <label htmlFor="invoice-session-filter" className="text-xs font-bold text-slate-700 flex items-center flex-shrink-0">
            <Layers className="w-3.5 h-3.5 mr-1.5 text-brand-600" /> 회차 선택:
          </label>
          <select
            id="invoice-session-filter"
            value={sessionFilter}
            onChange={(e) => handleSessionFilterChange(e.target.value)}
            className="min-w-0 flex-1 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-brand-500"
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
      </div>

      {feedback && (
        <div role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback('')} className="p-0.5 text-cyan-600 hover:text-cyan-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:gap-3 lg:grid-cols-[1.1fr_.9fr]">
        {/* 1. 청구할 판매내역 선택 패널 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3.5 shadow-sm flex flex-col">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
                <span>1. 청구할 내역 선택</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                  {buyerGroups.length}명 ({selectableSales.length}건)
                </span>
              </h2>
            </div>

            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                  title="현재 선택된 모든 내역을 해제합니다"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>선택 해제 ({selectedIds.length}건)</span>
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-slate-500 mb-2">
            * 구매자 카드를 클릭하면 <strong>해당 구매자의 모든 내역이 한 번에 선택</strong>되며, 다른 구매자로 언제든 <strong>원클릭 자동 전환</strong>됩니다.
          </p>

          <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {buyerGroups.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-400">
                선택된 회차에 청구 가능한 판매내역이 없습니다.
              </p>
            ) : (
              buyerGroups.map((group) => {
                const isSelected = group.isFullySelected;
                const isPartially = group.isPartiallySelected;
                const isExpanded = expandedBuyerKeys.includes(group.buyerNickname);

                return (
                  <div
                    key={group.buyerNickname}
                    className={`rounded-2xl border transition-all ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50/60 shadow-xs ring-1 ring-brand-200'
                        : isPartially
                        ? 'border-brand-300 bg-brand-50/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* 구매자 요약 헤더 (클릭 시 원클릭 선택 / 스마트 전환) */}
                    <div
                      onClick={() => handleToggleBuyerGroup(group)}
                      className="p-3 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      title={
                        isSelected
                          ? '클릭 시 선택을 해제합니다'
                          : '클릭 시 이 구매자의 모든 내역으로 즉시 선택 전환합니다'
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = isPartially;
                            }}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleBuyerGroup(group);
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 cursor-pointer"
                          />
                          <span className="text-sm font-black text-slate-900">
                            {group.buyerNickname}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            총 {group.sales.length}건
                          </span>
                        </div>

                        {/* 사용자가 요구한 덧셈 계산식 표시: 구매 3건: 5,000원 + 8,000원 + 15,000원 = 합 28,000원 */}
                        <div className="mt-1 text-xs font-bold text-brand-700 font-mono">
                          {group.formula}
                        </div>

                        {/* 사용자가 요구한 택비포함 금액 표시 */}
                        <div className="mt-0.5 text-xs font-bold text-slate-600 flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-slate-400" />
                          <span>택비포함 : {group.totalWithShipping.toLocaleString()}원</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            (택배비 {group.shippingFee.toLocaleString()}원)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto flex-shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleBuyerGroup(group);
                          }}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors shadow-2xs ${
                            isSelected
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                              : 'bg-brand-600 hover:bg-brand-700 text-white'
                          }`}
                        >
                          {isSelected ? '선택 풀기' : '이 구매자 선택'}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(group.buyerNickname);
                          }}
                          className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                          title="상세 상품 목록 열기/닫기"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* 아코디언: 개별 품목 목록 */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-slate-100 bg-slate-50/60 divide-y divide-slate-100 rounded-b-2xl">
                        {group.sales.map((sale) => {
                          const isSaleSelected = selectedIds.includes(sale.id);
                          return (
                            <label
                              key={sale.id}
                              className="py-1.5 flex items-center justify-between gap-2 text-xs cursor-pointer hover:text-brand-600 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isSaleSelected}
                                  onChange={() => toggleSale(sale)}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                                />
                                <span className="font-medium text-slate-800 truncate">
                                  {sale.productName || '상품명 미입력'}
                                  {sale.quantity && sale.quantity > 1 ? ` (${sale.quantity}개)` : ''}
                                </span>
                              </div>
                              <span className="font-bold text-slate-900 whitespace-nowrap">
                                {sale.amount.toLocaleString()}원
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 2. 정산서 정보 작성 패널 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3.5 shadow-sm">
          <h2 className="mb-2 text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
            <Calculator className="w-4 h-4 text-brand-600" />
            <span>2. 정산서 정보</span>
          </h2>

          <div className="space-y-2.5">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">선택된 구매자</label>
              <input
                value={selectedNickname}
                readOnly
                placeholder="왼쪽 목록에서 구매자를 선택하세요"
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">고객 전화번호</label>
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="010-0000-0000"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">입금기한</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">배송주소</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="배송주소 입력"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">판매자 입금계좌</label>
              <input
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="예: 국민 123-456 김미정"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            </div>

            {/* 정산서 금액 요약 박스 (수식 + 택비포함 금액) */}
            <div className="rounded-2xl bg-brand-50/70 border border-brand-200 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>구매 내역 계산식:</span>
                <span className="text-[10px] text-brand-700 bg-white px-2 py-0.5 rounded-full border border-brand-200">
                  선택 {selectedSales.length}건
                </span>
              </div>

              {selectedFormula ? (
                <div className="p-2 rounded-xl bg-white border border-brand-100 text-xs font-bold text-brand-800 font-mono break-words leading-relaxed shadow-2xs">
                  {selectedFormula}
                </div>
              ) : (
                <div className="p-2 text-center text-xs text-slate-400">
                  선택된 내역이 없습니다.
                </div>
              )}

              <div className="pt-2 border-t border-brand-200/60 flex items-center justify-between">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeShippingInInvoice}
                    onChange={(e) => setIncludeShippingInInvoice(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                  />
                  <span>택배비 포함 청구 (+{selectedShippingFee.toLocaleString()}원)</span>
                </label>

                <div className="text-right">
                  <span className="text-[10px] text-slate-500 block">최종 청구금액</span>
                  <span className="text-lg font-black text-brand-700">
                    {finalInvoiceAmount.toLocaleString()}원
                  </span>
                </div>
              </div>

              {includeShippingInInvoice && (
                <p className="text-[10px] text-right text-slate-500">
                  * 상품 합계 {selectedAmount.toLocaleString()}원 + 배송비 {selectedShippingFee.toLocaleString()}원 = 총 {finalInvoiceAmount.toLocaleString()}원
                </p>
              )}
            </div>

            <button
              onClick={handleCreate}
              disabled={selectedIds.length === 0}
              className="h-10 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-xs font-bold text-white transition active:scale-95 shadow-md shadow-brand-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="h-4 w-4" /> 정산서 생성하기
            </button>
          </div>
        </section>
      </div>

      {/* 3. 생성된 정산서 목록 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3 shadow-sm">
        <h2 className="mb-2 flex items-center gap-1.5 text-xs sm:text-sm font-black text-slate-900">
          <Smartphone className="h-4 w-4 text-cyan-600" /> 생성된 정산서 ({filteredInvoices.length})
        </h2>
        <div className="space-y-2">
          {filteredInvoices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
              선택된 회차에 생성된 정산서가 없습니다.
            </p>
          ) : (
            filteredInvoices.map((invoice) => (
              <article key={invoice.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold text-slate-900">{invoice.customerNickname}</strong>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {invoiceStatusLabel[invoice.status]}
                      </span>
                      {invoice.depositCode && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700" title="고객이 입금자명에 적으면 자동 확정됩니다">
                          입금코드 {invoice.depositCode}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {invoice.phoneNumber} · 기한 {invoice.dueDate}
                    </p>
                  </div>
                  <strong className="text-sm font-black text-brand-700">{invoice.amount.toLocaleString()}원</strong>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                  {invoice.saleIds.map((id) => {
                    const sale = sales.find((s) => s.id === id);
                    const sessionText = sale?.sessionId
                      ? formatSessionDisplay(sale.sessionId, { sessions: cloudSessions, recognizedAt: sale.recognizedAt })
                      : '회차 미확인';
                    return (
                      <Link
                        key={id}
                        to={`/sales/${id}`}
                        className="rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-700 transition"
                        title="판매 상세내역 보기"
                      >
                        회차: {sessionText}
                      </Link>
                    );
                  })}
                  {invoice.status === 'DRAFT' && (
                    <button
                      onClick={() => void handleSend(invoice.id)}
                      className="flex items-center gap-1 rounded-lg bg-cyan-600 hover:bg-cyan-700 px-2.5 py-1 text-[10px] font-bold text-white transition"
                    >
                      <Send className="h-3 w-3" /> SMS 발송
                    </button>
                  )}
                  {!['PAID', 'CANCELLED'].includes(invoice.status) && (
                    <button
                      onClick={() => cancelInvoice(invoice.id)}
                      className="rounded-lg bg-rose-50 hover:bg-rose-100 px-2.5 py-1 text-[10px] font-bold text-rose-700 transition"
                    >
                      취소
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* 4. voicecapSMS 상태 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xs sm:text-sm font-black text-slate-900">voicecapSMS 연결 상태</h2>
            <p className="mt-0.5 text-[10px] text-slate-500">마이페이지에서 만든 1회용 연결 코드로 휴대폰을 연결합니다.</p>
          </div>
          <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${bridgeStatus === 'ONLINE' ? 'bg-emerald-50 text-emerald-700' : bridgeStatus === 'CHECKING' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            {isRemoteAuth ? bridgeMessage : '수파베이스 설정 후 사용 가능'}
          </span>
        </div>
        {isRemoteAuth && phonePush === 'DELAYED' && (
          <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
            휴대폰에 즉시 발송 알림을 보내지 못했습니다. 휴대폰 앱이 문자를 가져갈 때까지 최대 15분 늦어질 수 있습니다.
          </p>
        )}
      </section>

      <PaymentReconciliationPanel payments={filteredPayments} invoices={invoices} onConfirm={confirmPayment} onDismiss={dismissPayment} />
    </div>
  );
};
