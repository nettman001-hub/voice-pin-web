import React, { useEffect, useState } from 'react';
import { customerKeepingService } from '../../services/customerKeepingService';
import type { CustomerKeepingRecord } from '../../types/keeping';
import type { TouchSale } from '../../types/touchSales';

export function TouchKeepingPanel({ sale, workspaceId, sessionCode }: { sale: TouchSale; workspaceId: string; sessionCode: string }) {
  const [records, setRecords] = useState<CustomerKeepingRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRecords([]); setError(''); setLoading(true);
    void customerKeepingService.fetchRemoteRecords(workspaceId).then(value => { if (active) { setRecords(value); setLoading(false); } });
    return () => { active = false; };
  }, [workspaceId, sale.id]);
  const kept = records.filter(r => r.status === 'KEPT' &&
    (r.buyerId ? r.buyerId === sale.buyerId : r.buyerNickname === sale.buyerNickname));
  const included = kept.some(r => r.saleIds.includes(sale.id));
  return <section className="touch-detail-section" aria-label="고객 키핑">
    <h3>{loading ? '키핑 확인 중…' : `기존 키핑 · ${kept.reduce((sum, r) => sum + r.totalAmount, 0).toLocaleString()}원`}</h3>
    {kept.length ? kept.map(r => <p key={r.id}>
      {r.sessionCode || r.sessionId} · {r.saleIds.length}건 · {r.totalAmount.toLocaleString()}원<br />
      {r.productNames.join(', ')}{r.memo ? ` · ${r.memo}` : ''}
    </p>) : <p className="touch-muted">보관 중인 상품이 없습니다.</p>}
    <button disabled={loading || busy || included || ['취소', '보류'].includes(sale.status) || sale.recordState === 'CANCELLED'} onClick={async () => {
      setBusy(true); setError('');
      try {
        const saved = await customerKeepingService.keepSale(sale, sessionCode, workspaceId);
        setRecords(old => [...old.filter(r => r.id !== saved.id), saved]);
      } catch (e) { setError((e as Error).message || '키핑을 저장하지 못했습니다.'); }
      finally { setBusy(false); }
    }}>{included ? '키핑 중' : busy ? '저장 중…' : '키핑하기'}</button>
    {error && <p role="alert" className="touch-error">{error}</p>}
  </section>;
}
