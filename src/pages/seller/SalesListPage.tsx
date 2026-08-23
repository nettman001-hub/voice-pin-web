import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { SaleRecord, SaleStatus } from '../../types/live';
import {
  ShoppingBag,
  Search,
  Users,
  CheckSquare,
  Calculator,
  Camera,
  Clock,
  ChevronDown,
  ChevronUp,
  Download,
  Layers,
  Sparkles,
  ArrowRight,
  UserCheck
} from 'lucide-react';

interface BuyerGroupedSale {
  buyerNickname: string;
  totalAmount: number;
  orderCount: number;
  records: SaleRecord[];
  hasPending: boolean;
  hasManualEdited: boolean;
  latestRecognizedAt: string;
  captureImageUrls: string[];
  sessionIds: string[];
}

export const SalesListPage: React.FC = () => {
  const { sales, exportCsv } = useSales();

  const [searchTerm, setSearchTerm] = useState('');
  const [sessionFilter, setSessionFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'BUYER_GROUPED' | 'INDIVIDUAL'>('BUYER_GROUPED');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'AMOUNT_DESC' | 'COUNT_DESC' | 'LATEST' | 'OLDEST'>('AMOUNT_DESC');
  const [expandedBuyers, setExpandedBuyers] = useState<string[]>([]);

  // 고유 방송 회차 세션 목록 추출
  const availableSessions = useMemo(() => {
    const sessions = Array.from(new Set(sales.map((s) => s.sessionId))).filter(Boolean);
    return sessions.sort((a, b) => b.localeCompare(a));
  }, [sales]);

  // 기본 1차 필터링 (회차, 상태, 검색어)
  const filteredSales = useMemo(() => {
    return sales.filter((item) => {
      // 1. 회차 필터
      if (sessionFilter !== 'ALL' && item.sessionId !== sessionFilter) {
        return false;
      }

      // 2. 검색어 필터
      const matchesSearch =
        item.buyerNickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.rawTranscript.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.amount.toString().includes(searchTerm) ||
        item.sessionId.includes(searchTerm);
      if (!matchesSearch) return false;

      // 3. 상태 필터
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [sales, sessionFilter, searchTerm, statusFilter]);

  // 회차별/선택조건별 구매자 묶음(Group by Buyer) 집계 데이터
  const buyerGroupedList: BuyerGroupedSale[] = useMemo(() => {
    const map: { [nickname: string]: BuyerGroupedSale } = {};

    filteredSales.forEach((sale) => {
      const key = sale.buyerNickname.trim() || '미확인(보류)';
      if (!map[key]) {
        map[key] = {
          buyerNickname: key,
          totalAmount: 0,
          orderCount: 0,
          records: [],
          hasPending: false,
          hasManualEdited: false,
          latestRecognizedAt: sale.recognizedAt,
          captureImageUrls: [],
          sessionIds: []
        };
      }

      const group = map[key];
      group.totalAmount += sale.amount || 0;
      group.orderCount += 1;
      group.records.push(sale);
      if (sale.status === '보류') group.hasPending = true;
      if (sale.status === '수동수정') group.hasManualEdited = true;
      if (new Date(sale.recognizedAt).getTime() > new Date(group.latestRecognizedAt).getTime()) {
        group.latestRecognizedAt = sale.recognizedAt;
      }
      if (sale.captureImageUrls) {
        group.captureImageUrls.push(...sale.captureImageUrls);
      }
      if (!group.sessionIds.includes(sale.sessionId)) {
        group.sessionIds.push(sale.sessionId);
      }
    });

    const list = Object.values(map);

    // 정렬
    list.sort((a, b) => {
      if (sortOrder === 'AMOUNT_DESC') return b.totalAmount - a.totalAmount;
      if (sortOrder === 'COUNT_DESC') return b.orderCount - a.orderCount;
      if (sortOrder === 'LATEST') return new Date(b.latestRecognizedAt).getTime() - new Date(a.latestRecognizedAt).getTime();
      if (sortOrder === 'OLDEST') return new Date(a.latestRecognizedAt).getTime() - new Date(b.latestRecognizedAt).getTime();
      return 0;
    });

    return list;
  }, [filteredSales, sortOrder]);

  // 개별 건별 정렬
  const sortedIndividualSales = useMemo(() => {
    const list = [...filteredSales];
    list.sort((a, b) => {
      if (sortOrder === 'AMOUNT_DESC') return b.amount - a.amount;
      if (sortOrder === 'LATEST') return new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime();
      if (sortOrder === 'OLDEST') return new Date(a.recognizedAt).getTime() - new Date(b.recognizedAt).getTime();
      return new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime();
    });
    return list;
  }, [filteredSales, sortOrder]);

  // 현재 선택된 회차의 요약 통계
  const currentSessionSummary = useMemo(() => {
    const targetSales = sessionFilter === 'ALL' ? sales : sales.filter((s) => s.sessionId === sessionFilter);
    const valid = targetSales.filter((s) => s.status !== '보류');
    const totalAmount = valid.reduce((sum, item) => sum + item.amount, 0);
    const uniqueBuyers = new Set(valid.map((s) => s.buyerNickname.trim()).filter(Boolean));
    const pendingCount = targetSales.filter((s) => s.status === '보류').length;

    return {
      sessionName: sessionFilter === 'ALL' ? '전체 방송 회차 합산' : `회차: ${sessionFilter}`,
      totalCount: targetSales.length,
      totalAmount,
      uniqueBuyerCount: uniqueBuyers.size,
      pendingCount
    };
  }, [sales, sessionFilter]);

  const toggleBuyerExpand = (nickname: string) => {
    setExpandedBuyers((prev) =>
      prev.includes(nickname) ? prev.filter((n) => n !== nickname) : [...prev, nickname]
    );
  };

  const handleExportCurrentView = () => {
    exportCsv(filteredSales, `다들려_판매내역_${sessionFilter}_${Date.now()}.csv`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 & 상단 액션 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-black text-white tracking-tight">판매 내역 목록</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold">
              회차별 묶음 지원
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            방송 회차별로 판매 내역을 확인하고, 동일 구매자의 중복 주문을 하나로 합산하여 정산합니다.
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
          <button
            onClick={handleExportCurrentView}
            className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/25 flex items-center space-x-1.5 transition"
          >
            <Download className="w-4 h-4" />
            <span>현재 목록 CSV</span>
          </button>
        </div>
      </div>

      {/* 회차 선택 탭 & 회차 요약 카드 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        {/* 1. 방송 회차 탭 바 */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800/80">
          <span className="text-xs font-bold text-slate-300 flex items-center">
            <Layers className="w-3.5 h-3.5 mr-1.5 text-brand-400" /> 방송 회차 선택:
          </span>

          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 max-w-full">
            <button
              onClick={() => setSessionFilter('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex-shrink-0 ${
                sessionFilter === 'ALL'
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              전체 회차
            </button>
            {availableSessions.map((sessionId, idx) => (
              <button
                key={sessionId}
                onClick={() => setSessionFilter(sessionId)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition flex-shrink-0 flex items-center space-x-1 ${
                  sessionFilter === sessionId
                    ? 'bg-brand-600 text-white shadow-md'
                    : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <span>{sessionId}</span>
                {idx === 0 && (
                  <span className="ml-1 text-[9px] bg-rose-500 text-white px-1 py-0.2 rounded">최신</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 2. 회차별 요약 카드 4종 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[11px] text-slate-400">선택 회차 총 매출액</span>
            <div className="text-xl font-black text-brand-400 mt-1">
              {currentSessionSummary.totalAmount.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">원</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[11px] text-slate-400">고유 구매자 수 (중복 제외)</span>
            <div className="text-xl font-black text-purple-300 mt-1">
              {currentSessionSummary.uniqueBuyerCount}{' '}
              <span className="text-xs font-normal text-slate-400">명</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[11px] text-slate-400">총 주문 건수</span>
            <div className="text-xl font-black text-white mt-1">
              {currentSessionSummary.totalCount}{' '}
              <span className="text-xs font-normal text-slate-400">건</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[11px] text-slate-400">보류 건수</span>
            <div className="text-xl font-black text-amber-300 mt-1">
              {currentSessionSummary.pendingCount}{' '}
              <span className="text-xs font-normal text-slate-400">건</span>
            </div>
          </div>
        </div>
      </div>

      {/* 필터 & 뷰 모드 전환 바 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* 뷰 모드 토글: 구매자별 묶어보기 vs 건별 개별 보기 */}
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
            <button
              onClick={() => setViewMode('BUYER_GROUPED')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition ${
                viewMode === 'BUYER_GROUPED'
                  ? 'bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>구매자별 묶어보기 ({buyerGroupedList.length}명)</span>
            </button>
            <button
              onClick={() => setViewMode('INDIVIDUAL')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition ${
                viewMode === 'INDIVIDUAL'
                  ? 'bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>건별 개별 보기 ({sortedIndividualSales.length}건)</span>
            </button>
          </div>

          {/* 검색창 */}
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="구매자 닉네임, 금액, 발화 내용..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        {/* 상태 필터 및 정렬 */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">상태:</span>
            {(['ALL', '확정', '자동저장', '수동수정', '보류'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                  statusFilter === st
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {st === 'ALL' ? '전체' : st}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-slate-400">정렬:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="py-1 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
            >
              <option value="AMOUNT_DESC">합산 금액 높은순</option>
              <option value="COUNT_DESC">구매 횟수 많은순</option>
              <option value="LATEST">최신 주문순</option>
              <option value="OLDEST">과거 주문순</option>
            </select>
          </div>
        </div>

        {/* 메인 목록 렌더링 */}
        <div className="space-y-3 pt-2">
          {viewMode === 'BUYER_GROUPED' ? (
            /* 1. 구매자별 묶어보기 뷰 */
            buyerGroupedList.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-2xl">
                조회 조건에 맞는 구매자 내역이 없습니다.
              </div>
            ) : (
              buyerGroupedList.map((buyer) => {
                const isExpanded = expandedBuyers.includes(buyer.buyerNickname);

                return (
                  <div
                    key={buyer.buyerNickname}
                    className={`rounded-2xl border transition overflow-hidden ${
                      buyer.hasPending
                        ? 'bg-amber-500/10 border-amber-500/40'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* 구매자 요약 카드 행 */}
                    <div
                      onClick={() => toggleBuyerExpand(buyer.buyerNickname)}
                      className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 cursor-pointer hover:bg-slate-900/50 transition"
                    >
                      <div className="flex items-center space-x-3.5">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-brand-600 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow">
                          {buyer.buyerNickname[0]}
                        </div>

                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-base text-white">{buyer.buyerNickname}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 font-bold border border-brand-500/30">
                              총 {buyer.orderCount}건 구매
                            </span>
                            {buyer.orderCount > 1 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-semibold">
                                ★ 다건 구매자
                              </span>
                            )}
                            {buyer.hasPending && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-bold">
                                보류 포함
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex items-center space-x-2">
                            <span>최근 주문: {new Date(buyer.latestRecognizedAt).toLocaleTimeString('ko-KR')}</span>
                            <span>•</span>
                            <span>회차: {buyer.sessionIds.join(', ')}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-4 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400">총 구매 합계</span>
                          <div className="text-lg font-black text-brand-400">
                            {buyer.totalAmount.toLocaleString()}원
                          </div>
                        </div>

                        <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>

                    {/* 구매자의 개별 주문 내역 아코디언 드롭다운 */}
                    {isExpanded && (
                      <div className="p-4 border-t border-slate-800/80 bg-slate-900/40 space-y-2">
                        <div className="text-[11px] font-bold text-slate-400 mb-2 flex items-center justify-between">
                          <span>{buyer.buyerNickname}님의 상세 구매 목록 ({buyer.records.length}건):</span>
                          <span>각 항목 클릭 시 상세 수정 가능</span>
                        </div>
                        {buyer.records.map((rec) => (
                          <Link
                            key={rec.id}
                            to={`/sales/${rec.id}`}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-brand-500/50 flex items-center justify-between text-xs transition block"
                          >
                            <div className="flex items-center space-x-3">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  rec.status === '보류'
                                    ? 'bg-amber-400 text-slate-950'
                                    : rec.status === '수동수정'
                                    ? 'bg-purple-500/20 text-purple-300'
                                    : 'bg-emerald-500/20 text-emerald-300'
                                }`}
                              >
                                {rec.status}
                              </span>
                              <span className="text-slate-300 italic truncate max-w-md">"{rec.rawTranscript}"</span>
                            </div>

                            <div className="flex items-center space-x-4 flex-shrink-0">
                              <span className="font-bold text-white text-sm">{rec.amount.toLocaleString()}원</span>
                              <span className="text-[10px] text-slate-400">{new Date(rec.recognizedAt).toLocaleTimeString('ko-KR')}</span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            /* 2. 건별 개별 보기 뷰 */
            sortedIndividualSales.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-2xl">
                조회 조건에 맞는 판매 내역이 없습니다.
              </div>
            ) : (
              sortedIndividualSales.map((sale) => (
                <Link
                  key={sale.id}
                  to={`/sales/${sale.id}`}
                  className="block p-4 rounded-2xl bg-slate-950/70 border border-slate-800 hover:border-brand-500/50 hover:bg-slate-950 transition group"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start space-x-4">
                      <div className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden flex-shrink-0">
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
            )
          )}
        </div>
      </div>
    </div>
  );
};
