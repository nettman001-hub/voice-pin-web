import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { useLive } from '../../context/LiveContext';
import { SaleRecord } from '../../types/live';
import {
  CheckSquare,
  AlertCircle,
  Save,
  Trash2,
  Camera,
  CheckCircle2,
  ArrowLeft,
  Sparkles
} from 'lucide-react';

export const SalesReviewPage: React.FC = () => {
  const { sales, confirmBatchSales, updateSale, deleteSale } = useSales();
  const { currentSessionId } = useLive();
  const navigate = useNavigate();

  const [sessionFilter, setSessionFilter] = useState<string>(currentSessionId);
  const [editingRecords, setEditingRecords] = useState<{ [id: string]: { nickname: string; amount: string } }>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const availableSessions = Array.from(new Set(sales.map((s) => s.sessionId))).filter(Boolean);

  const targetSales = sessionFilter === 'ALL'
    ? sales
    : sales.filter((s) => s.sessionId === sessionFilter);

  const pendingSales = targetSales.filter((s) => s.status === '보류');
  const pendingCount = pendingSales.length;

  const handleInputChange = (id: string, field: 'nickname' | 'amount', value: string) => {
    setEditingRecords((prev) => ({
      ...prev,
      [id]: {
        nickname: field === 'nickname' ? value : (prev[id]?.nickname ?? sales.find((s) => s.id === id)?.buyerNickname ?? ''),
        amount: field === 'amount' ? value : (prev[id]?.amount ?? sales.find((s) => s.id === id)?.amount.toString() ?? '0')
      }
    }));
  };

  const handleSaveRow = (sale: SaleRecord) => {
    const edit = editingRecords[sale.id];
    if (!edit) return;

    updateSale({
      ...sale,
      buyerNickname: edit.nickname || sale.buyerNickname,
      amount: parseInt(edit.amount, 10) || sale.amount,
      status: '수동수정'
    });

    setToastMsg(`'${edit.nickname || sale.buyerNickname}'님의 주문이 수정 및 확정되었습니다.`);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleBulkConfirm = () => {
    const pendingIds = pendingSales.map((s) => s.id);
    confirmBatchSales(pendingIds);
    setToastMsg('모든 보류 건이 일괄 확정 처리되었습니다! 🎉');
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">방송 후 일괄 확인</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-bold border border-amber-200">
              보류 {pendingCount}건
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            방송 중 닉네임이나 금액이 불분명했던 '보류' 건을 확인하고 인라인으로 즉시 수정/일괄 확정합니다.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleBulkConfirm}
            disabled={pendingCount === 0}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-emerald-600 hover:from-brand-500 hover:to-emerald-500 disabled:opacity-40 text-white text-xs font-bold shadow-md shadow-brand-500/20 flex items-center space-x-1.5 transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>남은 보류 건 일괄 확정</span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 회차 선택 탭 */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
        <span className="text-slate-500 font-bold px-2">방송 회차:</span>
        <button
          onClick={() => setSessionFilter('ALL')}
          className={`px-3 py-1.5 rounded-xl font-bold transition ${
            sessionFilter === 'ALL'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}
        >
          전체 회차
        </button>
        {availableSessions.map((s) => (
          <button
            key={s}
            onClick={() => setSessionFilter(s)}
            className={`px-3 py-1.5 rounded-xl font-mono font-bold transition ${
              sessionFilter === s
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* 테이블 형태의 일괄 검토 뷰 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        {targetSales.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            해당 회차에 검토할 판매 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {targetSales.map((sale) => {
              const edit = editingRecords[sale.id];
              const curNickname = edit?.nickname ?? sale.buyerNickname;
              const curAmount = edit?.amount ?? sale.amount.toString();
              const isPending = sale.status === '보류';

              return (
                <div
                  key={sale.id}
                  className={`p-4 rounded-2xl border transition flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 ${
                    isPending
                      ? 'bg-amber-50/70 border-amber-300 shadow-sm'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isPending ? 'bg-amber-400 text-slate-950 font-black' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {sale.status}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(sale.recognizedAt).toLocaleTimeString('ko-KR')}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                        {sale.sessionId}
                      </span>
                    </div>

                    <p className="text-xs text-slate-800 font-medium">
                      "{sale.rawTranscript}"
                    </p>
                  </div>

                  {/* 인라인 수정 인풋들 */}
                  <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                    <input
                      type="text"
                      value={curNickname}
                      onChange={(e) => handleInputChange(sale.id, 'nickname', e.target.value)}
                      placeholder="닉네임"
                      className="w-28 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
                    />

                    <div className="relative">
                      <input
                        type="number"
                        value={curAmount}
                        onChange={(e) => handleInputChange(sale.id, 'amount', e.target.value)}
                        placeholder="금액"
                        className="w-28 pl-3 pr-6 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-bold"
                      />
                      <span className="text-[10px] text-slate-400 absolute right-2 top-2">원</span>
                    </div>

                    {sale.captureImageUrls && sale.captureImageUrls.length > 0 && (
                      <Link
                        to={`/sales/${sale.id}/capture`}
                        className="p-1.5 rounded-xl bg-white border border-slate-200 text-cyan-600 hover:bg-slate-50"
                        title="캡처 이미지 보기"
                      >
                        <Camera className="w-4 h-4" />
                      </Link>
                    )}

                    <button
                      onClick={() => handleSaveRow(sale)}
                      className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-sm flex items-center space-x-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>저장</span>
                    </button>

                    <button
                      onClick={() => deleteSale(sale.id)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title="삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
