import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, ChevronDown, ChevronRight, Download, Layers } from 'lucide-react';
import { useSales } from '../../context/SalesContext';
import { productSalesApi } from '../../services/productSalesApi';
import { LiveSession } from '../../types/productSales';
import { formatSessionDisplay } from '../../utils/sessionFormatter';

type GroupMode = 'DATE' | 'SESSION';

interface SettlementGroup {
  key: string;
  label: string;
  sales: ReturnType<typeof useSales>['sales'];
  total: number;
}

export const SettlementPage: React.FC = () => {
  const { sales, exportCsv } = useSales();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groupMode, setGroupMode] = useState<GroupMode>('DATE');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [cloudSessions, setCloudSessions] = useState<LiveSession[]>([]);

  useEffect(() => {
    productSalesApi.listSessions()
      .then((data) => setCloudSessions(data.sessions))
      .catch((err) => console.warn('[Settlement] 세션 목록 로드 실패 (무시):', err));
  }, []);

  // 고유 방송 회차 세션 목록 추출
  const availableSessions = useMemo(() => {
    const sessionsById = new Map(cloudSessions.map((session) => [session.id, session]));
    sales.forEach((sale) => {
      if (sale.sessionId && !sessionsById.has(sale.sessionId)) {
        sessionsById.set(sale.sessionId, {
          id: sale.sessionId,
          displayCode: formatSessionDisplay(sale.sessionId, { recognizedAt: sale.recognizedAt }),
          status: 'ENDED',
          revision: 1,
          startedAt: sale.recognizedAt,
        });
      }
    });
    return Array.from(sessionsById.values()).sort((left, right) => (
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
    ));
  }, [cloudSessions, sales]);

  // 가장 최근 회차 세션 (진행 중인 세션 우선, 없으면 시작시각 기준 가장 최근 회차)
  const latestSessionId = useMemo(() => {
    if (availableSessions.length === 0) return null;
    const active = availableSessions.find((s) => s.status === 'ACTIVE');
    return active ? active.id : availableSessions[0].id;
  }, [availableSessions]);

  // URL 파라미터가 없으면 최근 회차를 기본값으로 지정
  const sessionFilter = useMemo(() => {
    const raw = searchParams.get('session');
    if (raw !== null) {
      return raw;
    }
    return latestSessionId || 'ALL';
  }, [searchParams, latestSessionId]);

  // 초기 진입 시 URL에 session 파라미터가 없으면 최근 회차로 URL 동기화 (기본값 최근회차)
  useEffect(() => {
    if (searchParams.get('session') === null && latestSessionId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('session', latestSessionId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, latestSessionId, setSearchParams]);

  const handleSessionFilterChange = (nextSessionId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('session', nextSessionId);
    setSearchParams(nextParams);
  };

  const filteredSalesBySession = useMemo(() => {
    if (sessionFilter === 'ALL') return sales;
    return sales.filter((s) => s.sessionId === sessionFilter);
  }, [sales, sessionFilter]);

  const validSales = useMemo(() => filteredSalesBySession.filter((sale) => sale.status !== '보류'), [filteredSalesBySession]);
  const groups = useMemo<SettlementGroup[]>(() => {
    const grouped = new Map<string, SettlementGroup>();
    validSales.forEach((sale) => {
      const date = sale.recognizedAt.slice(0, 10);
      const key = groupMode === 'DATE' ? date : sale.sessionId;
      const label = groupMode === 'DATE'
        ? date
        : formatSessionDisplay(sale.sessionId, {
            sessions: cloudSessions,
            recognizedAt: sale.recognizedAt
          });
      const current = grouped.get(key) || { key, label, sales: [], total: 0 };
      current.sales.push(sale);
      current.total += sale.amount;
      grouped.set(key, current);
    });
    return Array.from(grouped.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [cloudSessions, groupMode, validSales]);

  const totalRevenue = validSales.reduce((sum, sale) => sum + sale.amount, 0);
  const avgOrderPrice = validSales.length ? Math.round(totalRevenue / validSales.length) : 0;
  const pendingCount = filteredSalesBySession.filter((sale) => sale.status === '보류').length;
  const groupLabel = groupMode === 'DATE' ? '일자' : '회차';

  const toggleGroup = (key: string) => {
    setExpandedKeys((previous) => previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]);
  };

  const exportGroup = (group: SettlementGroup) => {
    exportCsv(group.sales, `VoiceCAP_정산_${groupMode === 'DATE' ? '일자' : '회차'}_${group.key}.csv`);
  };

  return (
    <div className="p-2.5 sm:p-4 max-w-7xl mx-auto space-y-2.5 sm:space-y-3">
      <div className="bg-white border border-slate-200 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">판매 정산 & CSV 내보내기</h1>
            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold border border-brand-200">UTF-8 BOM</span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">일자별 또는 방송 회차별로 판매를 집계하고 엑셀용 CSV를 다운로드합니다.</p>
        </div>
        <button
          onClick={() => exportCsv(validSales, `VoiceCAP_정산_${sessionFilter}_${Date.now()}.csv`)}
          className="w-full sm:w-auto h-8 px-3 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 transition active:scale-95"
        >
          <Download className="w-3.5 h-3.5" /> {sessionFilter === 'ALL' ? '전체 판매 CSV 다운로드' : '선택 회차 CSV 다운로드'}
        </button>
      </div>

      {/* 방송 회차 선택 바 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <label htmlFor="settlement-session-filter" className="text-xs font-bold text-slate-700 flex items-center flex-shrink-0">
            <Layers className="w-3.5 h-3.5 mr-1.5 text-brand-600" /> 회차 선택:
          </label>
          <select
            id="settlement-session-filter"
            value={sessionFilter}
            onChange={(e) => handleSessionFilterChange(e.target.value)}
            className="min-w-0 flex-1 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-brand-500"
          >
            {availableSessions.map((session) => {
              const isLatest = session.id === latestSessionId;
              return (
                <option key={session.id} value={session.id}>
                  {session.displayCode}
                  {session.status === 'ACTIVE' ? ' · 진행 중 (실시간)' : isLatest ? ' (최근 회차)' : ''}
                </option>
              );
            })}
            <option value="ALL">전체 회차 (모든 방송 합산)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          ['총 판매 확정액', `${totalRevenue.toLocaleString()}원`, 'text-brand-600'],
          ['총 확정 주문 건수', `${validSales.length}건`, 'text-slate-900'],
          ['건당 평균 단가', `${avgOrderPrice.toLocaleString()}원`, 'text-purple-700'],
          ['미확인 보류 건수', `${pendingCount}건`, 'text-amber-600']
        ].map(([title, value, color]) => (
          <div key={title} className="p-2 sm:p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs">
            <span className="text-[10px] text-slate-500 font-medium">{title}</span>
            <div className={`text-base sm:text-lg font-black mt-0.5 truncate ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl p-2.5 sm:p-3 shadow-sm space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
            {groupMode === 'DATE' ? <Calendar className="w-3.5 h-3.5 text-brand-600" /> : <Layers className="w-3.5 h-3.5 text-brand-600" />}
            {groupLabel}별 판매 정산 목록
          </h2>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {([['DATE', '일자별'], ['SESSION', '회차별']] as const).map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => { setGroupMode(mode); setExpandedKeys([]); }} className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${groupMode === mode ? 'bg-white text-brand-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {groups.length === 0 ? <div className="py-8 text-center text-xs text-slate-400">정산할 확정 판매 내역이 없습니다.</div> : groups.map((group) => {
            const expanded = expandedKeys.includes(group.key);
            return (
              <div key={group.key} className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
                <div className="p-2.5 sm:p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <button type="button" aria-expanded={expanded} onClick={() => toggleGroup(group.key)} className="flex items-center gap-2 text-left w-full sm:w-auto">
                    <div className="p-1.5 rounded-lg bg-brand-50 text-brand-700">{groupMode === 'DATE' ? <Calendar className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}</div>
                    <div><div className="font-bold text-slate-900 text-xs sm:text-sm">{group.label}</div><div className="text-[10px] text-slate-500">총 {group.sales.length}건 주문</div></div>
                    {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto border-t sm:border-0 border-slate-200/60 pt-1.5 sm:pt-0">
                    <div className="text-left sm:text-right"><span className="text-[9px] text-slate-400 block">판매 합계</span><strong className="text-xs sm:text-sm text-brand-600">{group.total.toLocaleString()}원</strong></div>
                    <button type="button" onClick={() => exportGroup(group)} className="h-7 px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 flex items-center gap-1 shadow-xs"><Download className="w-3 h-3" /> CSV</button>
                  </div>
                </div>
                {expanded && <div className="p-3 sm:p-4 border-t border-slate-100 bg-white space-y-2">
                  {group.sales.map((sale) => <div key={sale.id} className="p-2.5 sm:p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap"><strong className="text-slate-900">{sale.buyerNickname}</strong><span className="text-slate-500">{sale.productName || '상품명 미입력'}</span><span className="text-[10px] bg-slate-200 text-slate-800 font-semibold px-2 py-0.5 rounded-full" title={`회차 ID: ${sale.sessionId}`}>회차: {formatSessionDisplay(sale.sessionId, { sessions: cloudSessions, recognizedAt: sale.recognizedAt })}</span></div>
                    <strong className="text-slate-900 self-end sm:self-auto">{sale.amount.toLocaleString()}원</strong>
                  </div>)}
                </div>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
