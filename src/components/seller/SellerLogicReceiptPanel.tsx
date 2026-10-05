import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, CheckCircle2 } from 'lucide-react';
import { CommentStreamService } from '../../services/commentStreamService';
import { SellerLogicReceiptQueue, sellerLogicPrintable, type SellerLogicReceipt } from '../../services/sellerLogicReceipts';
import type { SellerLogicSalesToolsContext } from '../../pages/admin/SellerLogicAnalysisPage';

const labels = { READY: '출력 대기', QUEUED: '출력 중', PRINTED: '출력 완료', FAILED: '출력 실패' };
export default function SellerLogicReceiptPanel({ sessionId, decisions, serverUrl, sourceKind }: SellerLogicSalesToolsContext) {
  const [automatic, setAutomatic] = useState(true);
  const [receipts, setReceipts] = useState<SellerLogicReceipt[]>([]);
  const queue = useRef<SellerLogicReceiptQueue | null>(null);
  const printer = useRef<CommentStreamService | null>(null);
  useEffect(() => {
    const connection = new CommentStreamService();
    connection.connect(serverUrl);
    printer.current = connection;
    return () => { printer.current = null; connection.disconnect(); };
  }, [serverUrl]);
  useEffect(() => {
    const manager = new SellerLogicReceiptQueue({ sessionId, print: (job) => printer.current
      ? printer.current.printSale(job) : Promise.resolve({ ok: false, status: 'FAILED', error: '댓글 도우미를 연결해 주세요.' }), change: setReceipts });
    queue.current = manager;
    return () => { queue.current = null; manager.dispose(); };
  }, [sessionId]);
  useEffect(() => { queue.current?.update(decisions, automatic && sourceKind === 'LIVE'); }, [decisions, automatic, sourceKind, sessionId, serverUrl]);
  const confirmed = decisions.filter(sellerLogicPrintable);
  const states = new Map(receipts.map((row) => [row.decisionId, row]));
  const outdated = decisions.filter((row) => row.status !== 'CONFIRMED' && states.get(row.id)?.outdated);
  return <section aria-label="판매 확정 및 전표 출력" className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-100 bg-emerald-50/50 p-5">
      <div><h2 className="flex items-center gap-2 font-bold text-slate-900"><CheckCircle2 size={18} />판매 확정 · 전표 <span className="text-sm font-normal">{confirmed.length}건</span></h2>
        <p className="mt-1 text-xs text-slate-500">구매자·상품·옵션·가격을 확인하고 상품마다 전표를 붙이세요.</p></div>
      <div className="space-y-2 text-right text-xs"><label className="flex items-center gap-2 font-semibold"><input aria-label="확정 전표 자동 출력" type="checkbox" checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} />실시간 확정 즉시 자동 출력</label>
        <Link className="block text-brand-600 underline" to="/seller/helper">댓글 도우미 · 프린터 설정</Link></div>
    </div>
    {sourceKind === 'IMPORTED' && <p className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">불러온 자료는 자동 출력하지 않습니다. 필요한 거래의 출력 버튼을 눌러 주세요.</p>}
    {!confirmed.length ? <p className="px-5 py-8 text-sm text-slate-400">판매가 확정되면 구매자와 상품이 여기에 표시됩니다.</p>
      : <div className="divide-y divide-slate-100">{confirmed.map((decision) => {
        const receipt = states.get(decision.id);
        return <article key={decision.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0"><strong className="break-words text-slate-900">{decision.nickname}</strong>
            <p className="mt-1 break-words text-sm text-slate-600">{decision.productName || '상품명 확인 필요'}{decision.option && ` · ${decision.option}`}{decision.orderCode && ` · 상품번호 ${decision.orderCode}`} · 수량 {decision.quantity}</p>
            <p className="mt-1 text-lg font-bold">{(decision.unitPrice! * decision.quantity).toLocaleString()}원</p>
            {receipt?.error && <p role="alert" className="mt-2 text-xs text-rose-600">{receipt.error}</p>}
            {receipt?.outdated && <p className="mt-1 text-xs text-amber-700">정정 전 전표가 출력됐습니다. 새 전표로 교체해 주세요.</p>}</div>
          <div className="space-y-2 text-right"><p className={`text-xs font-semibold ${receipt?.status === 'FAILED' ? 'text-rose-600' : 'text-slate-500'}`}>{labels[receipt?.status || 'READY']}</p>
            <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-40" disabled={receipt?.status === 'QUEUED'}
              onClick={() => queue.current?.print(decision.id, receipt?.status === 'PRINTED')}><Printer size={14} />{receipt?.status === 'PRINTED' ? '다시 출력' : receipt?.status === 'FAILED' ? '출력 재시도' : '전표 출력'}</button></div>
        </article>;
      })}</div>}
    {outdated.length > 0 && <div role="status" className="border-t border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{outdated.map((row) => <p key={row.id}>{row.nickname || '구매자 확인 필요'} · {row.productName || '상품'}: {row.status === 'CANCELLED' ? '판매 취소' : '확정 재검토'} — 이전에 출력된 전표를 확인해 주세요.</p>)}</div>}
  </section>;
}
