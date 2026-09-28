import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, CheckCircle2, PackageCheck, Send, Truck, Layers } from 'lucide-react';
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
  const { shipments, isVerified, getClaimForSales, createShipmentsForSales, updateShipment, sendShippingNotice } = useCommerce();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');

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

  const shippedSaleIds = new Set(shipments.flatMap((shipment) => shipment.saleIds));
  const candidates = useMemo(
    () => sales.filter((sale) => {
      if (sale.status === '보류' || shippedSaleIds.has(sale.id)) return false;
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
    const created = createShipmentsForSales(selectedIds);
    setSelectedIds([]);
    setFeedback(`${created.length}건의 택배 발송 업무를 만들었습니다.`);
  };

  const patchShipment = (shipment: Shipment, patch: Partial<Shipment>) => updateShipment({ ...shipment, ...patch });

  const handleShippingNotice = async (shipment: Shipment) => {
    const result = await sendShippingNotice(shipment.id);
    setFeedback(!result ? '전화번호와 운송장 번호를 먼저 입력해 주세요.' : result.status === 'FAILED' ? `발송 실패: ${result.error || ''}` : '배송안내 문자를 발송 요청했습니다.');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3.5 sm:p-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 sm:text-2xl"><Truck className="h-6 w-6 text-brand-600" /> 택배발송 관리</h1>
        <p className="mt-1 text-xs text-slate-500">확인된 구매정보의 배송지를 바탕으로 포장, 운송장, 발송 문자, 배송완료까지 관리합니다.</p>
      </header>

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

      {feedback && <div role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs font-bold text-cyan-800">{feedback}</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['READY', 'PACKED', 'SHIPPED', 'DELIVERED'] as ShipmentStatus[]).map((status) => (
          <div key={status} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] text-slate-500">{shipmentLabels[status]}</div>
            <strong className="mt-1 block text-xl text-slate-900">{filteredShipments.filter((item) => item.status === status).length}</strong>
          </div>
        ))}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">판매내역에서 발송 업무 만들기 ({candidates.length}건)</h2>
            <p className="text-[10px] text-slate-500">확인완료 건을 우선 표시하며 주소가 없으면 생성 후 직접 입력할 수 있습니다.</p>
          </div>
          <button onClick={handleCreate} className="flex flex-shrink-0 items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white"><Box className="h-4 w-4" /> 선택 등록</button>
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {candidates.map((sale) => {
            const claim = getClaimForSales([sale.id]);
            return (
              <label key={sale.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 transition">
                <input type="checkbox" checked={selectedIds.includes(sale.id)} onChange={() => setSelectedIds((prev) => prev.includes(sale.id) ? prev.filter((id) => id !== sale.id) : [...prev, sale.id])} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-900">
                    {sale.buyerNickname}
                    <span className={`rounded-full px-2 py-0.5 text-[9px] ${isVerified([sale.id]) ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{isVerified([sale.id]) ? '확인완료' : '미확인'}</span>
                    <span className="text-[10px] text-slate-400 font-normal">회차: {formatSessionDisplay(sale.sessionId, { sessions: cloudSessions, recognizedAt: sale.recognizedAt })}</span>
                  </div>
                  <p className="truncate text-[10px] text-slate-500">{claim?.address || '배송주소 미수신'} · {sale.amount.toLocaleString()}원</p>
                </div>
              </label>
            );
          })}
          {candidates.length === 0 && <p className="p-5 text-center text-xs text-slate-400">선택된 회차에 추가할 판매내역이 없습니다.</p>}
        </div>
      </section>

      <section className="space-y-3">
        {filteredShipments.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-xs text-slate-400">선택된 회차에 등록된 택배 발송 업무가 없습니다.</div> : filteredShipments.map((shipment) => (
          <article key={shipment.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-brand-600" /><strong className="text-sm text-slate-900">{shipment.recipientName}</strong><span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">{shipmentLabels[shipment.status]}</span></div><div className="flex gap-1">{shipment.saleIds.map((id) => <Link key={id} to={`/sales/${id}`} className="rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">#{id}</Link>)}</div></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input value={shipment.recipientName} onChange={(e) => patchShipment(shipment, { recipientName: e.target.value })} aria-label="수령인" placeholder="수령인" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
              <input value={shipment.phoneNumber} onChange={(e) => patchShipment(shipment, { phoneNumber: e.target.value })} aria-label="연락처" placeholder="연락처" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
              <select value={shipment.carrier} onChange={(e) => patchShipment(shipment, { carrier: e.target.value })} aria-label="택배사" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs"><option>CJ대한통운</option><option>우체국택배</option><option>한진택배</option><option>롯데택배</option><option>로젠택배</option></select>
              <input value={shipment.trackingNumber} onChange={(e) => patchShipment(shipment, { trackingNumber: e.target.value })} aria-label="운송장 번호" placeholder="운송장 번호" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs" />
              <input value={shipment.address} onChange={(e) => patchShipment(shipment, { address: e.target.value })} aria-label="배송주소" placeholder="배송주소" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs sm:col-span-2" />
              <input value={shipment.memo} onChange={(e) => patchShipment(shipment, { memo: e.target.value })} aria-label="배송 메모" placeholder="배송 메모" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs sm:col-span-2" />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {shipment.status === 'READY' && <button onClick={() => patchShipment(shipment, { status: 'PACKED' })} className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">포장완료</button>}
              {!['DELIVERED', 'CANCELLED'].includes(shipment.status) && <button onClick={() => void handleShippingNotice(shipment)} className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-[10px] font-bold text-white"><Send className="h-3 w-3" /> 발송처리 & 문자</button>}
              {shipment.status === 'SHIPPED' && <button onClick={() => patchShipment(shipment, { status: 'DELIVERED', deliveredAt: new Date().toISOString() })} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> 배송완료</button>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
};

