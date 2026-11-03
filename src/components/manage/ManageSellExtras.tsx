import React, { useEffect, useMemo, useState } from 'react';
import { useOptionalCommerce } from '../../context/CommerceContext';
import { useNewManageUi } from '../../services/manage/useNewManageUi';
import { useManageServerState } from '../../services/manage/useManageData';
import { broadcastCallList, buyerManageInfo, keptCountByBuyer, stripParts } from '../../services/manage/buyerStrip';
import { callListText } from '../../services/manage/contactWorklist';

interface BuyerRef { buyerId?: string | null; nickname: string }

interface Props {
  /** 지금 고른 댓글의 구매자 (없으면 띠를 숨긴다) */
  selected?: BuyerRef | null;
  /** 이번 방송 구매자 (불러 줄 명단) */
  buyers: readonly BuyerRef[];
  /** 띠 없이 명단만 (PC 청취 홈) */
  callListOnly?: boolean;
}

const REFRESH_MS = 2 * 60 * 1000;

/**
 * [판매] 탭·청취 홈 추가 정보: 고객 띠(킵·연락처)와 방송에서 불러 줄 명단.
 * "새 관리 화면 사용"을 켠 기기에서만 보이고, 꺼져 있으면 서버를 읽지도 않는다.
 * 판매 흐름(댓글 고르기·가격·출력)에는 손대지 않는다.
 */
export const ManageSellExtras: React.FC<Props> = (props) => {
  const [enabled] = useNewManageUi();
  if (!enabled) return null;
  return <Extras {...props} />;
};

const Extras: React.FC<Props> = ({ selected, buyers, callListOnly }) => {
  const commerce = useOptionalCommerce();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((value) => value + 1); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  const server = useManageServerState(tick);
  const messages = useMemo(() => (commerce?.messages || []).map((message) => ({
    phone: message.phoneNumber, direction: message.direction, body: message.body, receivedAt: message.receivedAt,
  })), [commerce?.messages]);
  const kept = useMemo(() => keptCountByBuyer(server.fulfillmentItems), [server.fulfillmentItems]);
  const info = useMemo(
    () => (selected?.nickname ? buyerManageInfo(selected, server.contactLinks, kept, messages) : null),
    [selected?.buyerId, selected?.nickname, server.contactLinks, kept, messages], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const callList = useMemo(() => broadcastCallList(buyers, server.contactLinks, messages), [buyers, server.contactLinks, messages]);
  const [copied, setCopied] = useState(false);
  if (!server.loadedAt) return null;

  const parts = info ? stripParts(info) : [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(callListText(callList));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* 복사가 막힌 기기: 명단을 보고 읽는다 */ }
  };

  return (
    <div className="manage-sell-extras space-y-1 px-2 py-1 text-xs" data-testid="manage-sell-extras">
      {!callListOnly && info && parts.length > 0 && (
        <p className="truncate rounded-lg bg-amber-50 px-2 py-1 font-bold text-amber-800" aria-live="polite">
          {selected!.nickname} · {parts.join(' · ')}
        </p>
      )}
      {callList.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-white px-2 py-1">
          <summary className="cursor-pointer font-bold text-amber-800">불러 줄 명단 {callList.length}명 (연락처 없음)</summary>
          <p className="mt-1 leading-relaxed text-slate-700">{callList.map((buyer) => buyer.nickname).join(', ')}</p>
          <button type="button" onClick={copy} className="mt-1 h-8 rounded-md border border-slate-200 px-2 font-bold text-slate-700">
            {copied ? '복사했습니다' : '안내 문구 복사'}
          </button>
        </details>
      )}
    </div>
  );
};

export default ManageSellExtras;
