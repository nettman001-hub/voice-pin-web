import React, { useState } from 'react';
import { useSales } from '../../context/SalesContext';
import {
  Calculator,
  Download,
  Calendar,
  Layers,
  ChevronDown,
  ChevronRight,
  ShoppingBag,
  TrendingUp,
  CreditCard
} from 'lucide-react';

export const SettlementPage: React.FC = () => {
  const { sales, exportCsv } = useSales();
  const [period, setPeriod] = useState<'DAY' | 'WEEK' | 'MONTH' | 'ALL'>('ALL');
  const [expandedDates, setExpandedDates] = useState<string[]>([]);

  const validSales = sales.filter((s) => s.status !== '보류');
  const totalRevenue = validSales.reduce((sum, s) => sum + s.amount, 0);
  const totalCount = validSales.length;
  const avgOrderPrice = totalCount > 0 ? Math.round(totalRevenue / totalCount) : 0;
  const pendingCount = sales.filter((s) => s.status === '보류').length;

  const groupedByDate: { [date: string]: typeof sales } = {};
  validSales.forEach((sale) => {
    const dateStr = sale.recognizedAt.split('T')[0] || sale.recognizedAt.substring(0, 10);
    if (!groupedByDate[dateStr]) groupedByDate[dateStr] = [];
    groupedByDate[dateStr].push(sale);
  });

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  const toggleDate = (d: string) => {
    setExpandedDates((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const handleExportAll = () => {
    exportCsv(sales, `다들려_정산내역_전체_${Date.now()}.csv`);
  };

  const handleExportDate = (dateStr: string) => {
    const target = groupedByDate[dateStr] || [];
    exportCsv(target, `다들려_정산내역_${dateStr}.csv`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">판매 정산 & CSV 내보내기</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200">
              엑셀 호환 UTF-8 BOM
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            일자별, 회차별로 집계된 판매 내역을 조회하고 엑셀에서 바로 열리는 CSV 파일로 다운로드합니다.
          </p>
        </div>

        <button
          onClick={handleExportAll}
          className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 flex items-center space-x-1.5 transition"
        >
          <Download className="w-4 h-4" />
          <span>전체 판매 내역 CSV 다운로드</span>
        </button>
      </div>

      {/* 4대 정산 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">총 판매 확정액</span>
          <div className="text-2xl font-black text-brand-600 mt-1">
            {totalRevenue.toLocaleString()} <span className="text-xs font-normal text-slate-500">원</span>
          </div>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">총 확정 주문 건수</span>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {totalCount} <span className="text-xs font-normal text-slate-500">건</span>
          </div>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">건당 평균 단가</span>
          <div className="text-2xl font-black text-purple-700 mt-1">
            {avgOrderPrice.toLocaleString()} <span className="text-xs font-normal text-slate-500">원</span>
          </div>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">미확인 보류 건수</span>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {pendingCount} <span className="text-xs font-normal text-slate-500">건</span>
          </div>
        </div>
      </div>

      {/* 일자별 아코디언 정산 목록 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-brand-600" />
          <span>일자별 판매 정산 목록</span>
        </h3>

        <div className="space-y-3">
          {sortedDates.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              정산할 확정 판매 내역이 없습니다.
            </div>
          ) : (
            sortedDates.map((dateStr) => {
              const list = groupedByDate[dateStr];
              const dateTotal = list.reduce((sum, item) => sum + item.amount, 0);
              const isExpanded = expandedDates.includes(dateStr);

              return (
                <div
                  key={dateStr}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden transition"
                >
                  <div
                    onClick={() => toggleDate(dateStr)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-100/80 transition"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-xl bg-brand-50 text-brand-700">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{dateStr}</div>
                        <div className="text-[11px] text-slate-500">총 {list.length}건 주문</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400">일매출 합계</span>
                        <div className="text-base font-black text-brand-600">
                          {dateTotal.toLocaleString()}원
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportDate(dateStr);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 flex items-center space-x-1 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>CSV</span>
                      </button>

                      <div className="text-slate-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-4 border-t border-slate-100 bg-white space-y-2">
                      {list.map((rec) => (
                        <div
                          key={rec.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-slate-900">{rec.buyerNickname}</span>
                            <span className="text-slate-500 font-mono text-[11px]">
                              {new Date(rec.recognizedAt).toLocaleTimeString('ko-KR')}
                            </span>
                            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                              회차: {rec.sessionId}
                            </span>
                          </div>
                          <div className="font-bold text-slate-900">
                            {rec.amount.toLocaleString()}원
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
