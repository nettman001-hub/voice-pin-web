import { ManageBackLink } from '../../components/manage/ManageBackLink';
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useManageDashboard } from '../../services/manage/useManageData';
import { ManageApi } from '../../services/manage/manageApi';
import { shippingService } from '../../services/shippingService';
import {
  SHIPMENT_STATUS_LABEL, buildShipmentBoard, nextShipmentSteps, shippingNoticeText, type ShipBuyer, type ShipmentCard,
} from '../../services/manage/shipmentBoard';
import { formatPhone } from '../../services/manage/contactWorklist';
import { formatWon } from '../../services/appShellState';
import { appToast } from '../../services/appDownload';

const CARRIERS = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', 'GS편의점택배', 'CU편의점택배'];
const daysSince = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : 0);

/**
 * 출고 (보관함·합배송).
 * 출고는 보관 중 전체 + 결제된 새 상품. 고르지 않는다. 고객이 취소한 상품만 빠진다.
 * 예약은 서버가 판정해서 두 기기가 같은 상품을 두 번 출고하지 않는다.
 */
export const ShipPage: React.FC = () => {
  const { workspaceId } = useAuth();
  const { sales } = useSales();
  const commerce = useCommerce();
  const api = useMemo(() => (workspaceId ? new ManageApi(workspaceId) : null), [workspaceId]);
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter');
  const tab = filter === 'keeping' || filter === 'active' || filter === 'refund' ? filter : 'ready';
  const [reloadKey, setReloadKey] = useState(0);
  const { dashboard, server } = useManageDashboard(0, reloadKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { phone?: string; address?: string; recipientName?: string; feePaid?: boolean }>>({});
  const [tracking, setTracking] = useState<Record<string, { carrier: string; number: string }>>({});

  const contactPhones = useMemo(() => {
    const map = new Map<string, string>();
    for (const [buyerKey, contact] of dashboard.contactBook.byBuyer) if (contact.state === 'LINKED' && contact.phone) map.set(buyerKey, contact.phone);
    return map;
  }, [dashboard.contactBook]);

  const board = useMemo(() => buildShipmentBoard({
    sales, paidSaleIds: dashboard.paidSaleIds, items: dashboard.fulfillmentItems, shipments: commerce.shipments,
    invoices: commerce.invoices, claims: commerce.claims, contactPhones,
    shippingConfig: shippingService.getConfig(workspaceId),
    getOverride: (nickname, sessionId) => shippingService.getOverride(nickname, sessionId, workspaceId),
  }), [sales, dashboard.paidSaleIds, dashboard.fulfillmentItems, commerce.shipments, commerce.invoices, commerce.claims, contactPhones, workspaceId]);

  const run = async (key: string, action: () => Promise<string>) => {
    if (!api) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setError('인터넷 연결 후 다시 해 주세요.'); return; }
    setBusy(key); setError(null); setNotice(null);
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

  const reserve = (buyer: ShipBuyer) => {
    const edit = edits[buyer.buyerKey] || {};
    const phone = (edit.phone ?? buyer.phone).replace(/\D/g, '');
    const address = (edit.address ?? buyer.address).trim();
    const recipientName = (edit.recipientName ?? buyer.recipientName).trim();
    if (phone.length < 10) { setError(`${buyer.nickname}님 휴대폰 번호를 적어 주세요.`); return; }
    if (!address) { setError(`${buyer.nickname}님 주소를 적어 주세요.`); return; }
    return run(`reserve:${buyer.buyerKey}`, async () => {
      await api!.reserveShipment({
        buyerKey: buyer.buyerKey, saleIds: buyer.plan.saleIds, recipientName, phone, address,
        shippingFee: buyer.plan.feeDue, feeBasis: buyer.plan.productAmount, shippingPaid: buyer.plan.feeDue === 0 || edit.feePaid === true,
      });
      return `${buyer.nickname}님 ${buyer.plan.saleIds.length}개를 출고 예약했습니다.`;
    });
  };

  const step = (card: ShipmentCard, to: 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED') => {
    const shipment = card.shipment;
    if (to === 'CANCELLED' && !window.confirm(`${card.nickname}님 출고를 취소할까요? 보관하던 상품은 다시 보관 중으로 돌아갑니다.`)) return;
    const entry = tracking[shipment.id] || { carrier: shipment.carrier || CARRIERS[0], number: shipment.trackingNumber || '' };
    if (to === 'SHIPPED' && !entry.number.trim()) { setError('송장번호를 적어 주세요.'); return; }
    return run(`step:${shipment.id}`, async () => {
      await api!.setShipmentStatus({
        shipmentId: shipment.id, status: to, expectedRevision: shipment.revision ?? undefined,
        carrier: to === 'SHIPPED' ? entry.carrier : undefined, trackingNumber: to === 'SHIPPED' ? entry.number.trim() : undefined,
      });
      if (to === 'SHIPPED' && shipment.phoneNumber) {
        const sms = await commerce.sendSms(shipment.phoneNumber, shippingNoticeText(shipment.recipientName || card.nickname, entry.carrier, entry.number.trim()), 'SHIPPING', [...shipment.saleIds]);
        if (sms.status === 'FAILED') return '발송으로 바꿨지만 배송 안내 문자는 보내지 못했습니다.';
        return `${card.nickname}님께 배송 안내 문자를 보냈습니다.`;
      }
      return `${card.nickname}님 출고를 ${SHIPMENT_STATUS_LABEL[to]}(으)로 바꿨습니다.`;
    });
  };

  const tabs = [
    { id: 'ready', label: `출고할 고객 ${board.ready.length}` },
    { id: 'keeping', label: `보관만 ${board.keptOnly.length}` },
    { id: 'active', label: `진행 중 ${board.active.length}` },
    { id: 'refund', label: `환불 필요 ${board.refundNeeded.length}` },
  ] as const;

  const buyerCard = (buyer: ShipBuyer) => {
    const edit = edits[buyer.buyerKey] || {};
    const setEdit = (patch: typeof edit) => setEdits((prev) => ({ ...prev, [buyer.buyerKey]: { ...prev[buyer.buyerKey], ...patch } }));
    return (
      <li key={buyer.buyerKey} className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-extrabold text-slate-900">{buyer.nickname}</span>
          <span className="text-sm font-black tabular-nums">{formatWon(buyer.plan.productAmount)}</span>
        </div>
        <p className="text-[11px] text-slate-500">
          보관 {buyer.plan.keptSaleIds.length}개 + 새 결제 {buyer.plan.newSaleIds.length}개
          {buyer.oldestKeptAt ? ` · 보관 ${daysSince(buyer.oldestKeptAt)}일째` : ''}
          {' · '}배송비 {buyer.plan.feeDue > 0 ? `${formatWon(buyer.plan.feeDue)} 받을 것` : buyer.plan.shipping.fee > 0 ? '이미 받음' : '무료'}
        </p>
        {buyer.plan.excluded.length > 0 && (
          <p className="text-[11px] text-amber-700">빠지는 상품 {buyer.plan.excluded.length}개: {[...new Set(buyer.plan.excluded.map((item) => item.reason))].join(', ')}</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="받는 사람" value={edit.recipientName ?? buyer.recipientName} onChange={(event) => setEdit({ recipientName: event.target.value })} placeholder="받는 사람" className="h-10 rounded-lg border border-slate-200 px-2 text-sm" />
          <input aria-label="휴대폰" value={edit.phone ?? formatPhone(buyer.phone)} onChange={(event) => setEdit({ phone: event.target.value })} inputMode="tel" placeholder="휴대폰" className="h-10 rounded-lg border border-slate-200 px-2 text-sm" />
        </div>
        <textarea aria-label="주소" value={edit.address ?? buyer.address} onChange={(event) => setEdit({ address: event.target.value })} placeholder="주소" rows={2} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        {buyer.plan.feeDue > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={edit.feePaid === true} onChange={(event) => setEdit({ feePaid: event.target.checked })} />
            배송비 {formatWon(buyer.plan.feeDue)}를 받았습니다
          </label>
        )}
        <button type="button" disabled={busy !== null} onClick={() => reserve(buyer)} className="flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-slate-900 text-sm font-extrabold text-white disabled:opacity-50">
          <Package className="h-4 w-4" />{busy === `reserve:${buyer.buyerKey}` ? '예약하는 중…' : `${buyer.plan.saleIds.length}개 출고 예약`}
        </button>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <div className="flex items-start gap-1">
        <ManageBackLink />
        <div role="tablist" aria-label="출고" className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
              onClick={() => setParams(item.id === 'ready' ? {} : { filter: item.id })}
              className={`min-h-[36px] flex-shrink-0 rounded-full px-3 text-xs font-bold ${tab === item.id ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {!server.serverReady && server.loadedAt && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">보관·출고 기록을 서버에서 읽지 못했습니다. 인터넷 연결을 확인해 주세요.</p>
      )}
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
      {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}

      {tab === 'ready' && (
        <>
          <p className="text-[11px] text-slate-500">결제된 새 상품이 있는 고객입니다. 보관 중인 상품은 모두 함께 나갑니다.</p>
          {board.ready.length === 0 ? <Empty text="출고할 고객이 없습니다." /> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">{board.ready.map(buyerCard)}</ul>
          )}
        </>
      )}

      {tab === 'keeping' && (
        <>
          <p className="text-[11px] text-slate-500">보관 상품만 있는 고객입니다. 자동으로 출고하지 않습니다. 고객이 요청하면 출고 예약하세요. <Link to="/manage/settings/keeping" className="font-bold underline">알림 일수</Link></p>
          {board.keptOnly.length === 0 ? <Empty text="보관 중인 고객이 없습니다." /> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">{board.keptOnly.map(buyerCard)}</ul>
          )}
        </>
      )}

      {tab === 'refund' && (
        <>
          <p className="text-[11px] text-slate-500">고객이 취소했는데 이미 입금된 상품입니다. 돈을 돌려준 뒤 [환불했음]을 누르세요.</p>
          {board.refundNeeded.length === 0 ? <Empty text="환불할 상품이 없습니다." /> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {board.refundNeeded.map((item) => (
                <li key={item.saleId} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{item.nickname} · {item.productName}</p>
                    <p className="text-[11px] text-slate-500">{formatWon(item.amount)} · 회차 {item.sessionId}</p>
                  </div>
                  <button type="button" disabled={busy !== null} onClick={() => run(`refund:${item.saleId}`, async () => { await api!.markRefunded([item.saleId]); return `${item.nickname}님 환불을 기록했습니다.`; })} className="h-10 flex-shrink-0 rounded-xl bg-slate-900 px-3 text-sm font-bold text-white disabled:opacity-50">환불했음</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'active' && (
        <>
          {board.active.length === 0 ? <Empty text="진행 중인 출고가 없습니다." /> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {board.active.map((card) => {
                const shipment = card.shipment;
                const entry = tracking[shipment.id] || { carrier: shipment.carrier || CARRIERS[0], number: shipment.trackingNumber || '' };
                const steps = nextShipmentSteps(shipment.status);
                return (
                  <li key={shipment.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-extrabold">{card.nickname}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{SHIPMENT_STATUS_LABEL[shipment.status] || shipment.status}</span>
                    </div>
                    <p className="text-[11px] text-slate-500">{card.itemCount}개 · {formatWon(card.productAmount)} · {shipment.recipientName} {formatPhone(shipment.phoneNumber)}</p>
                    <p className="text-[11px] text-slate-500">{shipment.address}</p>
                    {steps.includes('SHIPPED') && (
                      <div className="grid grid-cols-[auto_1fr] gap-2">
                        <select aria-label="택배사" value={entry.carrier} onChange={(event) => setTracking((prev) => ({ ...prev, [shipment.id]: { ...entry, carrier: event.target.value } }))} className="h-10 rounded-lg border border-slate-200 px-1 text-sm">
                          {CARRIERS.map((carrier) => <option key={carrier}>{carrier}</option>)}
                        </select>
                        <input aria-label="송장번호" value={entry.number} inputMode="numeric" placeholder="송장번호" onChange={(event) => setTracking((prev) => ({ ...prev, [shipment.id]: { ...entry, number: event.target.value } }))} className="h-10 min-w-0 rounded-lg border border-slate-200 px-2 text-sm" />
                      </div>
                    )}
                    <div className="flex gap-2">
                      {steps.filter((to) => to !== 'CANCELLED').map((to) => (
                        <button key={to} type="button" disabled={busy !== null} onClick={() => step(card, to)} className="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-900 text-sm font-bold text-white disabled:opacity-50">
                          {to === 'SHIPPED' && <Truck className="h-4 w-4" />}
                          {to === 'PACKED' ? '포장 완료' : to === 'SHIPPED' ? '발송 + 안내 문자' : '배송 완료'}
                        </button>
                      ))}
                      {steps.includes('CANCELLED') && (
                        <button type="button" disabled={busy !== null} onClick={() => step(card, 'CANCELLED')} className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 disabled:opacity-50">취소</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {board.done.length > 0 && (
            <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <summary className="text-xs font-bold text-slate-600">최근 끝난 출고 {board.done.length}건</summary>
              <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                {board.done.map((card) => (
                  <li key={card.shipment.id} className="flex justify-between gap-2">
                    <span className="truncate">{card.nickname} · {card.itemCount}개 · {card.shipment.carrier} {card.shipment.trackingNumber}</span>
                    <span className="flex-shrink-0 font-bold">{SHIPMENT_STATUS_LABEL[card.shipment.status]}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">{text}</p>
);

export default ShipPage;
