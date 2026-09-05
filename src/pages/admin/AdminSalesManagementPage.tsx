import React, { useState, useEffect, useMemo } from 'react';
import {
  ShoppingBag,
  TrendingUp,
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Database,
  Radio,
  Mic,
  X
} from 'lucide-react';
import { remoteWorkspaceService } from '../../services/remoteWorkspaceService';
import { AdminSaleItem, SellerSalesGroup, SellerSttUsageSummary, SttUsageLogItem } from '../../types/admin';

export const AdminSalesManagementPage: React.FC = () => {
  const [sales, setSales] = useState<AdminSaleItem[]>([]);
  const [sttSummaries, setSttSummaries] = useState<SellerSttUsageSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'HIERARCHY' | 'FLAT' | 'STT'>('HIERARCHY');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | '확정' | '자동저장' | '수동수정' | '보류'>('ALL');

  const [expandedSellers, setExpandedSellers] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const [selectedSttUser, setSelectedSttUser] = useState<SellerSttUsageSummary | null>(null);
  const [sttLogs, setSttLogs] = useState<SttUsageLogItem[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [salesData, sttData] = await Promise.all([
        remoteWorkspaceService.fetchAllSalesForAdmin(),
        remoteWorkspaceService.fetchSttUsageSummary(),
      ]);
      setSales(salesData);
      setSttSummaries(sttData);
    } catch (err) {
      console.error('[AdminSales] 데이터 로드 실패:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const sellerGroups: SellerSalesGroup[] = useMemo(() => {
    const map = new Map<string, {
      sellerUserId: string;
      sellerEmail: string;
      sellerNickname: string;
      workspaceName: string;
      totalAmount: number;
      totalCount: number;
      lastSaleAt: string;
      sessionsMap: Map<string, {
        sessionId: string;
        sessionTime: string;
        totalAmount: number;
        totalCount: number;
        sales: AdminSaleItem[];
      }>;
    }>();

    for (const sale of sales) {
      const key = sale.sellerUserId || sale.workspaceId || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          sellerUserId: sale.sellerUserId || key,
          sellerEmail: sale.sellerEmail || '',
          sellerNickname: sale.sellerNickname || '판매자',
          workspaceName: sale.workspaceName || '작업공간',
          totalAmount: 0,
          totalCount: 0,
          lastSaleAt: sale.recognizedAt || sale.createdAt,
          sessionsMap: new Map(),
        });
      }

      const group = map.get(key)!;
      group.totalAmount += sale.amount;
      group.totalCount += 1;
      if (new Date(sale.recognizedAt || sale.createdAt) > new Date(group.lastSaleAt)) {
        group.lastSaleAt = sale.recognizedAt || sale.createdAt;
      }

      const sessId = sale.sessionId || 'default_session';
      if (!group.sessionsMap.has(sessId)) {
        group.sessionsMap.set(sessId, {
          sessionId: sessId,
          sessionTime: sale.recognizedAt || sale.createdAt,
          totalAmount: 0,
          totalCount: 0,
          sales: [],
        });
      }

      const sess = group.sessionsMap.get(sessId)!;
      sess.totalAmount += sale.amount;
      sess.totalCount += 1;
      sess.sales.push(sale);
    }

    return Array.from(map.values()).map((g) => ({
      sellerUserId: g.sellerUserId,
      sellerEmail: g.sellerEmail,
      sellerNickname: g.sellerNickname,
      workspaceName: g.workspaceName,
      totalAmount: g.totalAmount,
      totalCount: g.totalCount,
      sessionCount: g.sessionsMap.size,
      lastSaleAt: g.lastSaleAt,
      sessions: Array.from(g.sessionsMap.values()).map((s) => ({
        ...s,
        sales: s.sales.sort((a, b) => new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime()),
      })).sort((a, b) => new Date(b.sessionTime).getTime() - new Date(a.sessionTime).getTime()),
    })).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [sales]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      const matchSearch =
        s.sellerNickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.sellerEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.buyerNickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.productName && s.productName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        s.sessionId.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      return true;
    });
  }, [sales, searchTerm, statusFilter]);

  const totalAmount = useMemo(() => sales.reduce((sum, s) => sum + s.amount, 0), [sales]);
  const totalOrders = sales.length;
  const activeSellersCount = sellerGroups.length;
  const totalSessionsCount = useMemo(() => new Set(sales.map((s) => s.sessionId)).size, [sales]);

  const toggleSellerExpand = (sellerId: string) => {
    setExpandedSellers((prev) => {
      const next = new Set(prev);
      if (next.has(sellerId)) next.delete(sellerId);
      else next.add(sellerId);
      return next;
    });
  };

  const toggleSessionExpand = (key: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleOpenSttLogs = async (summary: SellerSttUsageSummary) => {
    setSelectedSttUser(summary);
    setIsLoadingLogs(true);
    try {
      const logs = await remoteWorkspaceService.fetchSttUsageLogs(summary.userId);
      setSttLogs(logs);
    } catch (err) {
      console.error('[AdminSales] STT 세부 로그 로드 실패:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`;
    if (minutes > 0) return `${minutes}분 ${seconds}초`;
    return `${seconds}초`;
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-2 bg-brand-50 rounded-2xl text-brand-600 border border-brand-200">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              전체 판매 내역 & 회차 관제
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200">
              판매자 {activeSellersCount}명 관제 중
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            모든 판매자의 총 판매액, 회차별 실시간 매출 및 클라우드 STT(Deepgram, Soniox) 사용량을 통합 관제합니다.
          </p>
          <div className="mt-2 text-[11px] text-emerald-700 bg-emerald-50/80 px-2.5 py-1 rounded-xl border border-emerald-100 inline-flex items-center space-x-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
            <span>타 서비스(설교 가이드 등)와 DB를 공유 중이므로, VoiceCAP 판매자 데이터만 100% 안전하게 격리·조회됩니다.</span>
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl text-xs font-bold bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 transition shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-500' : 'text-brand-600'}`} />
          <span>{isLoading ? '동기화 중...' : '새로고침'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">전체 누적 매출</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {totalAmount.toLocaleString()}원
          </div>
          <p className="text-[11px] text-slate-400 mt-1">모든 판매자 실시간 합산</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">총 주문 건수</span>
            <ShoppingBag className="w-4 h-4 text-brand-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {totalOrders.toLocaleString()}건
          </div>
          <p className="text-[11px] text-slate-400 mt-1">자동/수동 저장 포함</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">활동 판매자</span>
            <Users className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {activeSellersCount}명
          </div>
          <p className="text-[11px] text-slate-400 mt-1">실제 판매 이력 보유</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold">총 방송 회차</span>
            <Radio className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {totalSessionsCount}회차
          </div>
          <p className="text-[11px] text-slate-400 mt-1">고유 방송 세션 수</p>
        </div>
      </div>

      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('HIERARCHY')}
          className={`px-4 py-2 rounded-2xl text-xs font-black transition flex items-center space-x-1.5 ${
            activeTab === 'HIERARCHY'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>판매자별 / 회차별 관제</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-200">
            {sellerGroups.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('FLAT')}
          className={`px-4 py-2 rounded-2xl text-xs font-black transition flex items-center space-x-1.5 ${
            activeTab === 'FLAT'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>전체 실시간 판매 목록</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-200">
            {sales.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('STT')}
          className={`px-4 py-2 rounded-2xl text-xs font-black transition flex items-center space-x-1.5 ${
            activeTab === 'STT'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>클라우드 STT 사용량 현황</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-200">
            {sttSummaries.length}
          </span>
        </button>
      </div>

      {activeTab === 'HIERARCHY' && (
        <div className="space-y-4">
          {sellerGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
              <ShoppingBag className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-bold">등록된 판매 내역이 없습니다.</p>
            </div>
          ) : (
            sellerGroups.map((seller) => {
              const isSellerExpanded = expandedSellers.has(seller.sellerUserId);
              return (
                <div
                  key={seller.sellerUserId}
                  className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden transition"
                >
                  <div
                    onClick={() => toggleSellerExpand(seller.sellerUserId)}
                    className="p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/80 transition select-none"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-700 font-bold">
                        {isSellerExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-black text-slate-900 text-sm sm:text-base">
                            {seller.sellerNickname}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {seller.workspaceName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {seller.sellerEmail}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 sm:space-x-6 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-2 md:pt-0 border-slate-100">
                      <div className="text-left md:text-right">
                        <span className="text-[10px] text-slate-400 block">총 방송 회차</span>
                        <span className="text-xs font-bold text-slate-700">{seller.sessionCount}회차</span>
                      </div>
                      <div className="text-left md:text-right">
                        <span className="text-[10px] text-slate-400 block">총 주문 건수</span>
                        <span className="text-xs font-bold text-slate-700">{seller.totalCount.toLocaleString()}건</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block">총 매출</span>
                        <span className="text-sm font-black text-emerald-600">
                          {seller.totalAmount.toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  </div>

                  {isSellerExpanded && (
                    <div className="bg-slate-50/60 border-t border-slate-100 p-3 sm:p-5 space-y-3">
                      <div className="text-xs font-bold text-slate-500 mb-1 flex items-center space-x-1.5">
                        <Radio className="w-3.5 h-3.5 text-brand-600" />
                        <span>'{seller.sellerNickname}' 판매자의 방송 회차별 내역 ({seller.sessions.length}개 회차)</span>
                      </div>

                      {seller.sessions.map((sess) => {
                        const sessKey = `${seller.sellerUserId}:${sess.sessionId}`;
                        const isSessionExpanded = expandedSessions.has(sessKey);

                        return (
                          <div
                            key={sess.sessionId}
                            className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden"
                          >
                            <div
                              onClick={() => toggleSessionExpand(sessKey)}
                              className="p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 transition select-none"
                            >
                              <div className="flex items-center space-x-2">
                                <div className="text-slate-400">
                                  {isSessionExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </div>
                                <span className="font-mono text-xs font-extrabold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg">
                                  회차: {sess.sessionId}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {new Date(sess.sessionTime).toLocaleString('ko-KR', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>

                              <div className="flex items-center space-x-3 text-xs self-end sm:self-auto">
                                <span className="text-slate-500 font-bold">
                                  {sess.totalCount}건 판매
                                </span>
                                <span className="font-black text-emerald-600">
                                  {sess.totalAmount.toLocaleString()}원
                                </span>
                              </div>
                            </div>

                            {isSessionExpanded && (
                              <div className="border-t border-slate-100 p-3 overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-100 text-slate-400 text-[11px]">
                                      <th className="py-2 px-3">인식 시각</th>
                                      <th className="py-2 px-3">구매자</th>
                                      <th className="py-2 px-3">상품명</th>
                                      <th className="py-2 px-3 text-right">금액</th>
                                      <th className="py-2 px-3">상태</th>
                                      <th className="py-2 px-3">음성 멘트</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 text-[11px]">
                                    {sess.sales.map((item) => (
                                      <tr key={item.id} className="hover:bg-slate-50/80 transition">
                                        <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">
                                          {item.recognizedAt ? item.recognizedAt.slice(11, 19) : '-'}
                                        </td>
                                        <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                                          {item.buyerNickname}
                                        </td>
                                        <td className="py-2.5 px-3 text-slate-600">
                                          {item.productName || '라이브 상품'}
                                        </td>
                                        <td className="py-2.5 px-3 font-black text-emerald-600 text-right whitespace-nowrap">
                                          {item.amount.toLocaleString()}원
                                        </td>
                                        <td className="py-2.5 px-3 whitespace-nowrap">
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            item.status === '확정' ? 'bg-emerald-50 text-emerald-700' :
                                            item.status === '자동저장' ? 'bg-blue-50 text-blue-700' :
                                            item.status === '수동수정' ? 'bg-amber-50 text-amber-700' :
                                            'bg-rose-50 text-rose-700'
                                          }`}>
                                            {item.status}
                                          </span>
                                        </td>
                                        <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate" title={item.rawTranscript}>
                                          {item.rawTranscript || '-'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'FLAT' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-full sm:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="판매자, 구매자, 상품명, 회차 검색..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar text-xs">
              <span className="text-slate-500 flex-shrink-0">상태:</span>
              {(['ALL', '확정', '자동저장', '수동수정', '보류'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl font-bold transition flex-shrink-0 ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {st === 'ALL' ? '전체' : st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="py-3 px-4">판매자</th>
                  <th className="py-3 px-4">회차 (Session)</th>
                  <th className="py-3 px-4">구매자</th>
                  <th className="py-3 px-4">상품명</th>
                  <th className="py-3 px-4 text-right">금액</th>
                  <th className="py-3 px-4">상태</th>
                  <th className="py-3 px-4">인식 일시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                      검색 조건에 맞는 판매 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{item.sellerNickname}</div>
                        <div className="text-[10px] text-slate-400">{item.sellerEmail}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 font-bold">
                        {item.sessionId}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {item.buyerNickname}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {item.productName || '라이브 상품'}
                      </td>
                      <td className="py-3 px-4 font-black text-emerald-600 text-right">
                        {item.amount.toLocaleString()}원
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.status === '확정' ? 'bg-emerald-50 text-emerald-700' :
                          item.status === '자동저장' ? 'bg-blue-50 text-blue-700' :
                          item.status === '수동수정' ? 'bg-amber-50 text-amber-700' :
                          'bg-rose-50 text-rose-700'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {item.recognizedAt ? item.recognizedAt.replace('T', ' ').slice(0, 19) : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'STT' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900">회원별 클라우드 STT 사용 시간</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Deepgram Nova-3 및 Soniox v5의 실제 음성 처리 누적 시간을 조회합니다.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="py-3 px-4">회원 (판매자)</th>
                  <th className="py-3 px-4">작업공간</th>
                  <th className="py-3 px-4 text-right">Deepgram 사용 시간</th>
                  <th className="py-3 px-4 text-right">Soniox 사용 시간</th>
                  <th className="py-3 px-4 text-right">총 사용 시간</th>
                  <th className="py-3 px-4 text-center">세션 수</th>
                  <th className="py-3 px-4 text-center">세부 내역</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sttSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                      기록된 STT 사용량이 없습니다.
                    </td>
                  </tr>
                ) : (
                  sttSummaries.map((s) => (
                    <tr key={s.userId} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{s.nickname}</div>
                        <div className="text-[10px] text-slate-400">{s.email}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {s.workspaceName || '-'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-brand-600">
                        {formatSeconds(s.deepgramSeconds)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-sky-600">
                        {formatSeconds(s.sonioxSeconds)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-slate-900">
                        {formatSeconds(s.totalSeconds)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-500">
                        {s.sessionCount}회
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleOpenSttLogs(s)}
                          className="px-3 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded-xl text-xs font-bold transition shadow-xs"
                        >
                          세부 내역
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedSttUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  '{selectedSttUser.nickname}' 판매자의 클라우드 STT 사용 세부 로그
                </h3>
                <p className="text-xs text-slate-500">{selectedSttUser.email}</p>
              </div>
              <button
                onClick={() => setSelectedSttUser(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {isLoadingLogs ? (
                <div className="py-12 text-center text-slate-400 text-xs font-bold">
                  로그 조회 중...
                </div>
              ) : sttLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs font-bold">
                  상세 기록된 세션 로그가 없습니다.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-[11px]">
                      <th className="py-2 px-3">일시</th>
                      <th className="py-2 px-3">공급자</th>
                      <th className="py-2 px-3">방송 회차</th>
                      <th className="py-2 px-3 text-right">사용 시간</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sttLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-2 px-3 font-mono text-slate-500 text-[11px]">
                          {log.startedAt ? log.startedAt.replace('T', ' ').slice(0, 19) : log.createdAt.slice(0, 19)}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            log.provider === 'DEEPGRAM' ? 'bg-brand-50 text-brand-700' : 'bg-sky-50 text-sky-700'
                          }`}>
                            {log.provider}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-600 text-[11px]">
                          {log.sessionId || '-'}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900 text-right">
                          {formatSeconds(log.durationSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 flex justify-end">
              <button
                onClick={() => setSelectedSttUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
