import React, { useState } from 'react';
import { Package, ChevronRight, X, Sparkles, Clock } from 'lucide-react';
import { BuyerKeepingSummary } from '../../types/keeping';

interface KeepingBadgeProps {
  summary: BuyerKeepingSummary;
  className?: string;
  onCombineWithCurrent?: () => void;
  showDetailsOnClick?: boolean;
}

export const KeepingBadge: React.FC<KeepingBadgeProps> = ({
  summary,
  className = '',
  onCombineWithCurrent,
  showDetailsOnClick = true
}) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  if (!summary.hasActiveKeeping || summary.activeCount === 0) {
    return null;
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (showDetailsOnClick) setIsPopoverOpen(!isPopoverOpen);
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black bg-purple-100 text-purple-800 border border-purple-300 hover:bg-purple-200 transition shadow-2xs group"
        title="클릭하여 이전 회차 키핑(보관) 상품 상세 확인"
      >
        <Package className="w-3 h-3 text-purple-600 group-hover:scale-110 transition-transform" />
        <span>키핑 {summary.activeCount}건 ({summary.totalKeptAmount.toLocaleString()}원) 보관중</span>
      </button>

      {/* 키핑 상세 팝오버 */}
      {isPopoverOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsPopoverOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1.5 z-50 w-72 sm:w-80 rounded-2xl bg-white shadow-xl border border-purple-200 p-3 text-xs text-slate-800 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
              <div className="flex items-center gap-1.5 font-black text-purple-900 text-xs">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>{summary.buyerNickname}님 이전 키핑 내역</span>
              </div>
              <button
                type="button"
                onClick={() => setIsPopoverOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
              {summary.records.map((rec) => (
                <div
                  key={rec.id}
                  className="p-2 rounded-xl bg-purple-50/60 border border-purple-100 space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-purple-950 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-purple-500" />
                      {rec.sessionCode || rec.sessionId}
                    </span>
                    <span className="font-black text-purple-700">
                      {(rec.totalAmount || 0).toLocaleString()}원
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-600 pl-4 truncate">
                    {rec.productNames?.length > 0 ? rec.productNames.join(', ') : '상품 내역'}
                  </div>
                  {rec.memo && (
                    <div className="text-[9px] text-amber-700 pl-4 italic">
                      메모: {rec.memo}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                총 보관: <strong className="text-purple-700 font-black">{summary.totalKeptAmount.toLocaleString()}원</strong>
              </div>
              {onCombineWithCurrent && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPopoverOpen(false);
                    onCombineWithCurrent();
                  }}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-600 hover:bg-purple-700 text-white transition flex items-center gap-0.5 shadow-xs"
                >
                  이번 회차 묶음적용 <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
