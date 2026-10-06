import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, CheckCircle2, PackageCheck, Send, Truck, Layers, Pencil, Check, X, AlertCircle, AlertTriangle } from 'lucide-react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { Shipment, ShipmentStatus } from '../../types/commerce';
import { productSalesApi } from '../../services/productSalesApi';
import { LiveSession } from '../../types/productSales';
import { formatSessionDisplay } from '../../utils/sessionFormatter';

const shipmentLabels: Record<ShipmentStatus, string> = {
  READY: '발송대기', PACKED: '포장완료', SHIPPED: '발송완료', DELIVERED: '배송완료', CANCELLED: '취소'
};

export const ShipmentManagementPage: React.FC = () => {
  const { sales } = useSales();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cloudSessions, setCloudSessions] = useState<LiveSession[]>([]);
  const { shipments, isVerified, getClaimForSales, createShipmentsForSales, updateShipment, sendShippingNotice, invoices } = useCommerce();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');

  // 고객 정보 수정 중인 shipment ID 및 폼 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    recipientName: string;
    phoneNumber: string;
    carrier: string;
    trackingNumber: string;
    address: string;
    memo: string;
  }>({
    recipientName: '',
    phoneNumber: '',
    carrier: 'CJ대한통운',
    trackingNumber: '',
    address: '',
    memo: ''
  });

  useEffect(() => {
    productSalesApi.listSessions()
      .then((data) => setCloudSessions(data.sessions))
      .catch((err) => console.warn('[ShipmentManagement] 세션 목록 로드 실패:', err));
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

  // 판매 건에 연결된 고객 정보(주소/연락처) 조회 헬퍼
  const getCustomerInfoForSale = useCallback((saleId: string) => {
    const claim = getClaimForSales([saleId]);
    const invoice = invoices.find((inv) => inv.saleIds.includes(saleId));
    const phoneNumber = (claim?.phoneNumber || invoice?.phoneNumber || '').trim();
    const address = (claim?.address || invoice?.address || '').trim();
    const recipientName = claim?.nickname || invoice?.customerNickname || '';
    const hasRequiredInfo = Boolean(phoneNumber && address);
    return { phoneNumber, address, recipientName, hasRequiredInfo };
  }, [getClaimForSales, invoices]);

  const shippedSaleIds = new Set(shipments.flatMap((shipment) => shipment.saleIds));
  const candidates = useMemo(
    () => sales.filter((sale) => {
      if (sale.status === '보류' || sale.status === '취소' || sale.syncStatus === 'PENDING' || shippedSaleIds.has(sale.id)) return false;
      if (sessionFilter !== 'ALL' && sale.sessionId !== sessionFilter) return false;
      return true;
    }),
    [sales, shippedSaleIds, sessionFilter]
  );

  const filteredShipments = useMemo(() => {
    if (sessionFilter === 'ALL') return shipments;
    const saleSessionMap = new Map(sales.map((s) => [s.id, s.sessionId]));
    return shipments.filter((shipment) =>
      shipment.saleIds.some((id) => saleSessionMap.get(id) === sessionFilter)
    );
  }, [shipments, sales, sessionFilter]);

  const handleCreate = () => {
    if (selectedIds.length === 0) return setFeedback('택배 업무로 등록할 판매내역을 선택해 주세요.');

    // 주소 또는 연락처가 없는 항목이 포함되어 있는지 검증
    const invalidCount = selectedIds.filter((id) => !getCustomerInfoForSale(id).hasRequiredInfo).length;
    if (invalidCount > 0) {
      return setFeedback('주소와 연락처가 모두 등록된 판매내역만 발송대기로 등록할 수 있습니다. 고객 정보를 먼저 확인해 주세요.');
    }

    const created = createShipmentsForSales(selectedIds);
    setSelectedIds([]);
    if (created.length === 0) {
      setFeedback('주소와 연락처가 등록되지 않은 판매내역은 발송대기로 등록할 수 없습니다.');
    } else {
      setFeedback(`${created.length}건의 택배 발송 업무(발송대기)를 만들었습니다.`);
    }
  };

  const patchShipment = (shipment: Shipment, patch: Partial<Shipment>) => updateShipment({ ...shipment, ...patch });

  // 고객 정보 수정 모드 시작
  const startEdit = (shipment: Shipment) => {
    setEditingId(shipment.id);
    setEditForm({
      recipientName: shipment.recipientName,
      phoneNumber: shipment.phoneNumber || '',
      carrier: shipment.carrier || 'CJ대한통운',
      trackingNumber: shipment.trackingNumber || '',
      address: shipment.address || '',
      memo: shipment.memo || ''
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = (shipmentId: string) => {
    const target = shipments.find((s) => s.id === shipmentId);
    if (!target) return;

    const updated: Shipment = {
      ...target,
      recipientName: editForm.recipientName.trim() || target.recipientName,
      phoneNumber: editForm.phoneNumber.trim(),
      carrier: editForm.carrier,
      trackingNumber: editForm.trackingNumber.trim(),
      address: editForm.address.trim(),
      memo: editForm.memo.trim(),
    };

    updateShipment(updated);
    setEditingId(null);
    setFeedback(`'${updated.recipientName}' 고객의 정보(주소·연락처)가 수정 및 저장되었습니다.`);
  };

  const handleShippingNotice = async (shipment: Shipment) => {
    const result = await sendShippingNotice(shipment.id);
    setFeedback(!result ? '전화번호와 운송장 번호를 먼저 입력해 주세요.' : result.status === 'FAILED' ? `발송 실패: ${result.error || ''}` : '배송안내 문자를 발송 요청했습니다.');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-2.5 sm:space-y-3 p-2.5 sm:p-4">
      <header className="rounded-2xl border border-slate-200 bg-white px-3 py-2 sm:px-4 sm:py-2.5 shadow-sm">
        <h1 className="flex items-center gap-1.5 text-sm sm:text-base font-black text-slate-900"><Truck className="h-4 w-4 sm:h-5 sm:w-5 text-brand-600" /> 택배발송 관리</h1>
        <p className="mt-0.5 text-[10px] sm:text-[11px] text-slate-500">확인된 구매정보의 배송지를 바탕으로 포장, 운송장, 발송 문자, 배송완료까지 관리합니다.</p>
      </header>

      {/* 방송 회차 선택 바 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <label htmlFor="shipment-session-filter" className="text-xs font-bold text-slate-700 flex items-center flex-shrink-0">
            <Layers className="w-3.5 h-3.5 mr-1.5 text-brand-600" /> 회차 선택:
          </label>
          <select
            id="shipment-session-filter"
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

      {feedback && <div role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800">{feedback}</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['READY', 'PACKED', 'SHIPPED', 'DELIVERED'] as ShipmentStatus[]).map((status) => (
          <div key={status} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
            <div className="text-[10px] text-slate-500">{shipmentLabels[status]}</div>
            <strong className="mt-0.5 block text-base sm:text-lg font-black text-slate-900">{filteredShipments.filter((item) => item.status === status).length}</strong>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs sm:text-sm font-black text-slate-900">판매내역에서 발송 업무 만들기 ({candidates.length}건)</h2>
            <p className="text-[10px] text-slate-500 font-medium">주소와 연락처가 모두 확인된 판매내역만 선택하여 발송대기로 등록할 수 있습니다.</p>
          </div>
          <button onClick={handleCreate} className="h-8 flex flex-shrink-0 items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-500 px-2.5 text-xs font-bold text-white transition active:scale-95"><Box className="h-3.5 w-3.5" /> 선택 등록</button>
        </div>
        <div className="max-h-60 space-y-1.5 overflow-y-auto">
          {candidates.map((sale) => {
            const customerInfo = getCustomerInfoForSale(sale.id);
            const canSelect = customerInfo.hasRequiredInfo;

            return (
              <label key={sale.id} className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition ${canSelect ? 'cursor-pointer hover:bg-slate-50 border-slate-200' : 'cursor-not-allowed opacity-60 bg-slate-50/70 border-dashed border-slate-200'}`}>
                <input
                  type="checkbox"
                  disabled={!canSelect}
                  checked={selectedIds.includes(sale.id)}
                  onChange={() => setSelectedIds((prev) => prev.includes(sale.id) ? prev.filter((id) => id !== sale.id) : [...prev, sale.id])}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900">
                    {sale.buyerNickname}
                    {canSelect ? (
                      <span className="rounded-full px-2 py-0.5 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">주소·연락처 확인</span>
                    ) : (
                      <span className="rounded-full px-2 py-0.5 text-[9px] bg-rose-50 text-rose-700 border border-rose-200 font-bold">주소·연락처 미등록 (선택 불가)</span>
                    )}
                    <span className="text-[10px] text-slate-400 font-normal">회차: {formatSessionDisplay(sale.sessionId, { sessions: cloudSessions, recognizedAt: sale.recognizedAt })}</span>
                  </div>
                  <p className="truncate text-[10px] text-slate-500">
                    {customerInfo.hasRequiredInfo ? (
                      <span>{customerInfo.address} ({customerInfo.phoneNumber}) · {sale.amount.toLocaleString()}원</span>
                    ) : (
                      <span className="text-rose-600 font-medium">연락처: {customerInfo.phoneNumber || '미등록'} · 주소: {customerInfo.address || '미등록'} · {sale.amount.toLocaleString()}원</span>
                    )}
                  </p>
                </div>
              </label>
            );
          })}
          {candidates.length === 0 && <p className="p-4 text-center text-xs text-slate-400">선택된 회차에 추가할 판매내역이 없습니다.</p>}
        </div>
      </section>

      <section className="space-y-2">
        {filteredShipments.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-400">선택된 회차에 등록된 택배 발송 업무가 없습니다.</div> : filteredShipments.map((shipment) => {
          const hasAddressAndContact = Boolean(shipment.phoneNumber?.trim() && shipment.address?.trim());
          const isEditing = editingId === shipment.id;

          return (
            <article key={shipment.id} className={`rounded-2xl border bg-white p-2.5 sm:p-3 shadow-sm transition ${isEditing ? 'border-brand-400 ring-2 ring-brand-400/20' : 'border-slate-200'}`}>
              <div className="mb-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PackageCheck className="h-4 w-4 text-brand-600 flex-shrink-0" />
                  <strong className="text-xs sm:text-sm text-slate-900">{shipment.recipientName}</strong>
                  {hasAddressAndContact ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">{shipmentLabels[shipment.status]}</span>
                  ) : (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> 주소·연락처 필요 (발송대기 불가)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex flex-wrap items-center gap-1">
                    {shipment.saleIds.map((id) => {
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
                  </div>
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(shipment)}
                      className="flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 border border-slate-200 transition active:scale-95"
                    >
                      <Pencil className="h-3 w-3 text-brand-600" />
                      <span>수정하기</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 고객 정보 영역: 수정 모드 vs 보기 모드 */}
              {isEditing ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50/20 p-2.5 sm:p-3 space-y-2">
                  <div className="flex items-center justify-between border-b border-brand-100 pb-1.5">
                    <span className="text-xs font-bold text-brand-800 flex items-center gap-1">
                      <Pencil className="h-3.5 w-3.5 text-brand-600" /> 고객 정보 수정
                    </span>
                    <span className="text-[10px] text-slate-500">주소와 연락처를 수정한 뒤 저장을 눌러주세요.</span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600">수령인</label>
                      <input
                        value={editForm.recipientName}
                        onChange={(e) => setEditForm({ ...editForm, recipientName: e.target.value })}
                        aria-label="수령인"
                        placeholder="수령인 성함"
                        className="w-full mt-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600">연락처 (필수)</label>
                      <input
                        value={editForm.phoneNumber}
                        onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                        aria-label="연락처"
                        placeholder="010-0000-0000"
                        className="w-full mt-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600">택배사</label>
                      <select
                        value={editForm.carrier}
                        onChange={(e) => setEditForm({ ...editForm, carrier: e.target.value })}
                        aria-label="택배사"
                        className="w-full mt-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-500"
                      >
                        <option>CJ대한통운</option>
                        <option>우체국택배</option>
                        <option>한진택배</option>
                        <option>롯데택배</option>
                        <option>로젠택배</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600">운송장 번호</label>
                      <input
                        value={editForm.trackingNumber}
                        onChange={(e) => setEditForm({ ...editForm, trackingNumber: e.target.value })}
                        aria-label="운송장 번호"
                        placeholder="운송장 번호"
                        className="w-full mt-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold text-slate-600">배송주소 (필수)</label>
                      <input
                        value={editForm.address}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                        aria-label="배송주소"
                        placeholder="도로명 상세 배송주소 입력"
                        className="w-full mt-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold text-slate-600">배송 메모</label>
                      <input
                        value={editForm.memo}
                        onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
                        aria-label="배송 메모"
                        placeholder="문 앞, 경비실 보관 등 배송 요청사항"
                        className="w-full mt-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-brand-100">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="h-7 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1 transition"
                    >
                      <X className="h-3 w-3" />
                      <span>취소</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(shipment.id)}
                      className="h-7 px-3.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-bold text-white shadow-xs flex items-center gap-1 transition active:scale-95"
                    >
                      <Check className="h-3 w-3" />
                      <span>수정 저장 완료</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs space-y-1.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5 text-[11px]">
                    <div>
                      <span className="text-[10px] text-slate-400 block">수령인</span>
                      <strong className="text-slate-900">{shipment.recipientName}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">연락처</span>
                      {shipment.phoneNumber ? (
                        <span className="font-bold text-slate-900">{shipment.phoneNumber}</span>
                      ) : (
                        <span className="text-rose-600 font-bold flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> 연락처 미등록</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">택배사 / 송장번호</span>
                      <span className="text-slate-800">{shipment.carrier} · {shipment.trackingNumber || '(운송장 미등록)'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">배송 메모</span>
                      <span className="text-slate-600 truncate block">{shipment.memo || '(요청사항 없음)'}</span>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4 border-t border-slate-200/60 pt-1">
                      <span className="text-[10px] text-slate-400 block">배송주소</span>
                      {shipment.address ? (
                        <span className="text-slate-800 font-medium">{shipment.address}</span>
                      ) : (
                        <span className="text-rose-600 font-bold flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> 배송주소 미등록</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 하단 액션 버튼 */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {!hasAddressAndContact && (
                    <span className="text-[11px] text-rose-600 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      주소와 연락처가 없으면 발송할 수 없습니다. [수정하기]를 눌러 입력해 주세요.
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(shipment)}
                      className="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 text-[10px] font-bold text-slate-700 flex items-center gap-1 border border-slate-200 transition"
                    >
                      <Pencil className="h-3 w-3 text-brand-600" />
                      <span>고객정보 수정</span>
                    </button>
                  )}
                  {shipment.status === 'READY' && (
                    <button
                      onClick={() => patchShipment(shipment, { status: 'PACKED' })}
                      disabled={!hasAddressAndContact}
                      className="rounded-lg bg-amber-50 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-[10px] font-bold text-amber-800 transition"
                    >
                      포장완료
                    </button>
                  )}
                  {!['DELIVERED', 'CANCELLED'].includes(shipment.status) && (
                    <button
                      onClick={() => void handleShippingNotice(shipment)}
                      disabled={!hasAddressAndContact}
                      className="flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-[10px] font-bold text-white transition active:scale-95"
                    >
                      <Send className="h-3 w-3" /> 발송처리 & 문자
                    </button>
                  )}
                  {shipment.status === 'SHIPPED' && (
                    <button
                      onClick={() => patchShipment(shipment, { status: 'DELIVERED', deliveredAt: new Date().toISOString() })}
                      className="flex items-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-[10px] font-bold text-emerald-700 transition"
                    >
                      <CheckCircle2 className="h-3 w-3" /> 배송완료
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
};

