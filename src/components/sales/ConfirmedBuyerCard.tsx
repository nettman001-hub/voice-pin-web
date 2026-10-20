import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import React, { useState } from 'react';
import type { SaleRecord } from '../../types/live';
import type { ConfirmedBuyerCandidate } from '../../types/confirmedBuyer';
import { useSales } from '../../context/SalesContext';

import { applyConfirmedBuyer } from '../../services/confirmedBuyerResolver';


export const ConfirmedBuyerCard: React.FC<{ sale: SaleRecord }> = ({ sale }) => {
  const runtime = useWorkspaceRuntime();
  const { confirmedBuyerAliases } = runtime;
  const { updateSale } = useSales();
  const { workspaceId } = useAuth();
  const [message, setMessage] = useState('');
  const [isChoosing, setIsChoosing] = useState(false);
  const resolution = sale.evidenceSnapshot?.buyerResolution;
  if (!resolution || sale.status === '취소' || sale.recordState === 'CANCELLED') return null;
  const choose = async (candidate: ConfirmedBuyerCandidate) => {
    if (sale.syncStatus === 'PENDING') return;
    const next = { ...resolution, status: 'MATCHED' as const, matchedBy: 'MANUAL' as const,
      candidates: [candidate, ...resolution.candidates.filter((item) => item.accountKey !== candidate.accountKey)] };
    const saved = updateSale(applyConfirmedBuyer(sale, next));
    if (!saved) return;
    setIsChoosing(false);
    setMessage(`${candidate.nickname}님으로 연결했습니다.`);
    if (workspaceId) {
      try {
        await confirmedBuyerAliases.remember(workspaceId, { spokenNickname: resolution.spokenNickname,
          nickname: candidate.nickname, accountKey: candidate.accountKey, updatedAt: new Date().toISOString() });
      } catch { setMessage('구매자 연결을 저장했습니다. 발음 별칭은 이 기기에 저장됐으며 클라우드 동기화에 실패했습니다.'); }
    }
  };
  return (
    <div className={`rounded-xl border p-3 text-xs ${resolution.status === 'MATCHED'
      ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
      <p className="font-bold">{resolution.status === 'MATCHED' ? '판매 확정 · 댓글 구매자 연결 완료' : '판매 확정 · 댓글 구매자 연결 확인'}</p>
      <p className="mt-1">발화: {resolution.spokenNickname}{resolution.status === 'MATCHED' ? ` → 댓글: ${sale.buyerNickname}` : ''}</p>
      {resolution.status === 'MATCHED' && <button type="button" className="mt-1 underline"
        onClick={() => setIsChoosing(!isChoosing)}>구매자 다시 연결</button>}
      {(resolution.status !== 'MATCHED' || isChoosing) && (
        <>
          <p className="mt-1 text-slate-600">판매금액은 확정되었습니다. 실제 댓글 구매자를 연결하면 전표가 출력됩니다.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {resolution.candidates.map((candidate) => (
              <button key={candidate.accountKey} type="button" disabled={sale.syncStatus === 'PENDING'}
                title={`댓글: ${candidate.commentText || ''} · 시각: ${candidate.capturedAt}`}
                onClick={() => void choose(candidate)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold disabled:opacity-50">
                {candidate.nickname} · {candidate.nameScore}점{candidate.recentPurchase ? ' · 구매 댓글' : ''} — 이 구매자로 연결
                <span className="block font-normal">{candidate.uniqueId ? `@${candidate.uniqueId} · ` : ''}{candidate.commentText}</span>
              </button>
            ))}
          </div>
          {resolution.candidates.length === 0 && <p className="mt-2">이 회차의 댓글을 기다리고 있습니다. 댓글이 도착하면 다시 연결합니다.</p>}
          {sale.syncStatus === 'PENDING' && <p className="mt-1">판매 저장 후 구매자를 선택할 수 있습니다.</p>}
        </>
      )}
      {message && <p role="status" className="mt-2">{message}</p>}
    </div>
  );
};
