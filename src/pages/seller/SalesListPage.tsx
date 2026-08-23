import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { SaleRecord, SaleStatus } from '../../types/live';
import { ShoppingBag, Search, Filter, CheckSquare, Calculator, Camera, Clock, ArrowRight } from 'lucide-react';

export const SalesListPage: React.FC = () => {
  const { sales } = useSales();

  const [searchTerm, setSearchTerm] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'ALL' | 'TODAY' | '7DAYS' | '30DAYS'>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'LATEST' | 'OLDEST' | 'AMOUNT_DESC'>('LATEST');

  // 필터링 로직
  const filteredSales = sales.filter((item) => {
    // 1. 검색어 필터
    const matchesSearch =
      item.buyerNickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.rawTranscript.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.amount.toString().includes(searchTerm);
    if (!matchesSearch) return false;

    // 2. 상태 필터
    if (statusFilter !== 'ALL' && item.status !== statusFilter) {
      return false;
    }

    // 3. 기간 필터
    if (periodFilter !== 'ALL') {
      const now = Date.now();
      const itemTime = new Date(item.recognizedAt).getTime();
      if (periodFilter === 'TODAY') {
        const todayStart = new Date().setHours(0, 0, 0, 0);
        if (itemTime < todayStart) return false;
      } else if (periodFilter === '7DAYS') {
        if (now - itemTime > 7 * 24 * 3600000) return false;
      } else if (periodFilter === '30DAYS') {
        if (now - itemTime > 30 * 24 * 3600000) return false;
      }
    }

    return true;
  });

  // 정렬
  filteredSales.sort((a, b) => {
    if (sortOrder === 'LATEST') {
      return new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime();
    } else if (sortOrder === 'OLDEST') {
      return new Date(a.recognizedAt).getTime() - new Date(b.recognizedAt).getTime();
    } else if (sortOrder === 'AMOUNT_DESC') {
      return b.amount - a.amount;
    }
    return 0;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 & 상단 CTA */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">판매 내역 목록</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold">
              총 {sales.length}건
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            틱톡 라이브에서 음성으로 자동 기록된 모든 판매 주문 내역을 시간순으로 조회합니다.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            to="/sales/review"
            className="px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center space-x-1.5 transition"
          >
            <CheckSquare className="w-4 h-4" />
            <span>방송 후 일괄 확인</span>
          </Link>
          <Link
            to="/settlement"
            className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/25 flex items-center space-x-1.5 transition"
          >
            <Calculator className="w-4 h-4" />
            <span>정산 내보내기</span>
          </Link>
        </div>
      </div>

      {/* 검색 & 필터 바 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* 검색창 */}
          <div className="sm:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="구매자 닉네임, 발화 내용, 금액 검색..."
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* 기간 필터 */}
          <div className="sm:col-span-2">
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as any)}
              className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none"
            >
              <option value="ALL">전체 기간</option>
              <option value="TODAY">오늘</option>
              <option value="7DAYS">최근 7일</option>
              <option value="30DAYS">최근 30일</option>
            </select>
          </div>

          {/* 상태 필터 */}
          <div className="sm:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none"
            >
              <option value="ALL">전체 상태</option>
              <option value="확정">확정됨</option>
              <option value="자동저장">자동저장</option>
              <option value="수동수정">수동수정</option>
              <option value="보류">보류(미확인)</option>
            </select>
          </div>

          {/* 정렬 */}
          <div className="sm:col-span-2">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none"
            >
              <option value="LATEST">최신순</option>
              <option value="OLDEST">오래된순</option>
              <option value="AMOUNT_DESC">금액 높은순</option>
            </select>
          </div>
        </div>

        {/* 판매 목록 카드 그리드 */}
        <div className="space-y-3 pt-2">
          {filteredSales.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-2xl">
              조회 조건에 맞는 판매 내역이 없습니다.
            </div>
          ) : (
            filteredSales.map((sale) => (
              <Link
                key={sale.id}
                to={`/sales/${sale.id}`}
                className="block p-4 rounded-2xl bg-slate-950/70 border border-slate-800 hover:border-brand-500/50 hover:bg-slate-950 transition group"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-start space-x-4">
                    {/* 썸네일 or 아이콘 */}
                    <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {sale.captureImageUrls && sale.captureImageUrls.length > 0 ? (
                        <img src={sale.captureImageUrls[0]} alt="캡처" className="w-full h-full object-cover" />
                      ) : (
                        <ShoppingBag className="w-5 h-5 text-brand-400" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-base font-bold text-white group-hover:text-brand-300 transition">
                          {sale.buyerNickname}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            sale.status === '보류'
                              ? 'bg-amber-400 text-slate-950'
                              : sale.status === '수동수정'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : sale.status === '확정'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-brand-500/20 text-brand-300'
                          }`}
                        >
                          {sale.status}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-1.5 py-0.5 rounded">
                          회차: {sale.sessionId}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                        "{sale.rawTranscript}"
                      </p>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-baseline sm:items-end justify-between w-full sm:w-auto gap-1">
                    <div className="text-lg font-black text-brand-400">
                      {sale.amount > 0 ? `${sale.amount.toLocaleString()}원` : '금액 미확인'}
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(sale.recognizedAt).toLocaleString('ko-KR')}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
