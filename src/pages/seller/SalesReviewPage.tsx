import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { useLive } from '../../context/LiveContext';
import { SaleRecord } from '../../types/live';
import {
  CheckSquare,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Trash2,
  ArrowRight,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';

export const SalesReviewPage: React.FC = () => {
  const { sales, updateSale, deleteSale, confirmBatchSales } = useSales();
  const { currentSessionId } = useLive();
  const navigate = useNavigate();

  const [selectedIds, setSelectedIds] = useState<string[]>(sales.map((s) => s.id));
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const pendingCount = sales.filter((s) => s.status === '보류').length;

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === sales.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sales.map((s) => s.id));
    }
  };

  const startEdit = (sale: SaleRecord) => {
    setEditingSaleId(sale.id);
    setEditNickname(sale.buyerNickname);
    setEditAmount(sale.amount.toString());
  };

  const saveEdit = (id: string) => {
    const target = sales.find((s) => s.id === id);
    if (!target) return;

    const parsedAmount = parseInt(editAmount, 10) || 0;
    const isStillPending = !editNickname.trim() || parsedAmount <= 0;

    const updated: SaleRecord = {
      ...target,
      buyerNickname: editNickname.trim() || '미확인(보류)',
      amount: parsedAmount,
      status: isStillPending ? '보류' : '수동수정'
    };

    updateSale(updated);
    setEditingSaleId(null);
    setToastMsg('수정사항이 저장되었습니다.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleConfirmBatch = () => {
    const selectedSales = sales.filter((s) => selectedIds.includes(s.id));
    const selectedPending = selectedSales.filter((s) => s.status === '보류');

    if (selectedPending.length > 0) {
      if (
        !window.confirm(
          `선택 항목 중 금액이나 닉네임이 확인되지 않은 '보류' 건이 ${selectedPending.length}개 있습니다. 그래도 확정하시겠습니까?`
        )
      ) {
        return;
      }
    }

    confirmBatchSales(selectedIds);
    setToastMsg(`선택된 ${selectedIds.length}건의 판매 내역이 최종 '확정'되었습니다! 🎉`);
    setTimeout(() => {
      navigate('/settlement');
    }, 1500);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 & 방송 회차 정보 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">방송 후 일괄 확인·수정</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
              세션 검토 모드
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center space-x-2">
            <span>방송 회차 ID: <strong className="text-slate-200 font-mono">{currentSessionId}</strong></span>
            <span>•</span>
            <span>총 {sales.length}건 중 보류 건 {pendingCount}개</span>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleConfirmBatch}
            disabled={selectedIds.length === 0}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center space-x-2 transition disabled:opacity-40"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>선택한 {selectedIds.length}건 일괄 확정하기</span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 보류 건 안내 배너 */}
      {pendingCount > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>
              <strong>노란색으로 표시된 {pendingCount}개의 보류 건</strong>은 닉네임 또는 금액이 누락된 항목입니다. 수정 후 일괄 확정해주세요.
            </span>
          </div>
        </div>
      )}

      {/* 일괄 확인 테이블 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs text-slate-400">
          <label className="flex items-center space-x-2 cursor-pointer font-bold text-slate-300">
            <input
              type="checkbox"
              checked={selectedIds.length === sales.length && sales.length > 0}
              onChange={handleSelectAll}
              className="rounded border-slate-700 bg-slate-950 text-brand-500 w-4 h-4"
            />
            <span>전체 선택 ({selectedIds.length}/{sales.length})</span>
          </label>
          <span>항목을 클릭하여 개별 수정 가능</span>
        </div>

        <div className="space-y-3">
          {sales.map((sale) => {
            const isSelected = selectedIds.includes(sale.id);
            const isEditing = editingSaleId === sale.id;
            const isPending = sale.status === '보류';

            return (
              <div
                key={sale.id}
                className={`p-4 rounded-2xl border transition ${
                  isPending
                    ? 'bg-amber-500/10 border-amber-500/40 shadow-sm'
                    : sale.status === '확정'
                    ? 'bg-slate-950/80 border-slate-800'
                    : 'bg-slate-950/50 border-slate-800'
                }`}
              >
                {isEditing ? (
                  /* 인라인 수정 폼 */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">구매자 닉네임</label>
                        <input
                          type="text"
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">금액 (원)</label>
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingSaleId(null)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs font-bold"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => saveEdit(sale.id)}
                        className="px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 기본 행 뷰 */
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-3.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(sale.id)}
                        className="rounded border-slate-700 bg-slate-950 text-brand-500 w-4 h-4 cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-white">{sale.buyerNickname}</span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isPending
                                ? 'bg-amber-400 text-slate-950 font-black animate-pulse'
                                : sale.status === '수동수정'
                                ? 'bg-purple-500/20 text-purple-300'
                                : sale.status === '확정'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-brand-500/20 text-brand-300'
                            }`}
                          >
                            {sale.status}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(sale.recognizedAt).toLocaleTimeString('ko-KR')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                          "{sale.rawTranscript}"
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 w-full sm:w-auto justify-between sm:justify-end">
                      <div className="text-base font-black text-brand-400">
                        {sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '0원 (미확인)'}
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => startEdit(sale)}
                          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>수정</span>
                        </button>
                        <button
                          onClick={() => deleteSale(sale.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
