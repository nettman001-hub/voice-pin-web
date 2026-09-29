import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SaleRecord, SaleStatus } from '../types/live';
import { storageService, getNextProductCodeForSession } from '../services/storageService';
import { exportSalesToCsv } from '../services/csvExporter';
import { useAuth } from './AuthContext';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { commentStreamService } from '../services/commentStreamService';
import type { BatchConfirmResult, SaleHistoryRecord } from '../types/pendingSale';
import { aiSettingsApi } from '../services/aiSettingsApi';

interface SettlementSummary {
  totalCount: number;
  totalAmount: number;
  uniqueBuyersCount: number;
  pendingCount: number;
}

interface SalesContextType {
  sales: SaleRecord[];
  addSale: (sale: Omit<SaleRecord, 'id'>) => SaleRecord;
  updateSale: (sale: SaleRecord) => void;
  retrySalePrint: (id: string) => void;
  deleteSale: (id: string) => void;
  confirmBatchSales: (saleIds: string[]) => BatchConfirmResult;
  exportCsv: (filteredRecords?: SaleRecord[], filename?: string) => boolean;
  refreshSales: () => Promise<SaleRecord[]>;
  getSalesBySession: (sessionId: string) => SaleRecord[];
  getSettlementSummary: (period: 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM', customRange?: { start: string; end: string }) => {
    summary: SettlementSummary;
    records: SaleRecord[];
    groupedByDate: { date: string; dayName: string; count: number; totalAmount: number; records: SaleRecord[] }[];
  };
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

export const SalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspaceId, isRemoteAuth } = useAuth();
  // 쓰기는 Supabase와 로컬DB에 동시 기록하며, 조회 및 초기 화면 렌더링은 로컬DB에서 0ms 즉시 읽기
  const [sales, setSales] = useState<SaleRecord[]>(() => storageService.getSales());
  const salesRef = useRef<SaleRecord[]>(sales);
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    storageService.setWorkspaceId(workspaceId || null);
  }, [workspaceId]);

  useEffect(() => {
    salesRef.current = sales;
  }, [sales]);

  const refreshSales = useCallback(async (): Promise<SaleRecord[]> => {
    if (!isRemoteAuth || !workspaceId) {
      const local = storageService.getSales();
      salesRef.current = local;
      setSales(local);
      return local;
    }

    const reqId = ++refreshRequestIdRef.current;
    const rows = await remoteWorkspaceService.loadSales(workspaceId);
    if (reqId !== refreshRequestIdRef.current) {
      return salesRef.current;
    }

    const localMap = new Map<string, SaleRecord>(salesRef.current.map((s) => [s.id, s]));
    const serverIds = new Set(rows.map((r) => r.id));

    // P1-6: 서버 row와 로컬 항목 병합 시 revision 비교하여 조회 경쟁 조건 해결
    const mergedServerRows: SaleRecord[] = rows.map((serverRow) => {
      const local = localMap.get(serverRow.id);
      if (local && (local.revision || 1) > (serverRow.revision || 1)) {
        // 로컬에서 사용자가 더 높은 revision으로 수정한 내용이 아직 서버에 전송 중인 경우 로컬 버전 유지
        return local;
      }
      return { ...serverRow, syncStatus: 'SYNCED' as const };
    });

    // P1-5: 서버 목록에 없고 로컬에만 있는 항목 중, 오직 아직 서버 미전송/전송중인 PENDING 항목만 보존!
    // 이미 SYNCED 상태였던 항목은 서버에서 삭제(DELETE/CANCELLED)된 것이므로 로컬에서도 정상 제거
    const pendingLocalSales = salesRef.current.filter(
      (s) => !serverIds.has(s.id) && s.syncStatus === 'PENDING'
    );
    const merged = [...pendingLocalSales, ...mergedServerRows];

    // [1회 동기화]
    storageService.saveSales(merged);
    salesRef.current = merged;
    setSales(merged);
    return merged;
  }, [isRemoteAuth, workspaceId]);

  // 동일 창의 다른 컨텍스트(예: ProductSalesContext 후보 확정)에서 판매가 추가/수정된 경우 즉시 동기화
  useEffect(() => {
    const handleSalesUpdated = () => {
      const local = storageService.getSales();
      salesRef.current = local;
      setSales(local);
    };
    window.addEventListener('voicecap_sales_updated', handleSalesUpdated);
    return () => window.removeEventListener('voicecap_sales_updated', handleSalesUpdated);
  }, []);

  useEffect(() => {
    if (!isRemoteAuth || !workspaceId) {
      salesRef.current = [];
      setSales([]);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const load = () => {
      void refreshSales().catch((error) => {
        if (active) console.error('[Sales] remote load failed', error);
      });
    };
    load();
    const unsubscribe = remoteWorkspaceService.subscribe(workspaceId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 350);
    });
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [isRemoteAuth, workspaceId, refreshSales]);

  const persist = (sale: SaleRecord) => {
    // [동시 쓰기: 로컬DB]
    storageService.updateSale(sale);
    // [동시 쓰기: Supabase]
    if (isRemoteAuth && workspaceId) {
      void remoteWorkspaceService.saveSale(workspaceId, sale)
        .then(() => {
          const syncedSale: SaleRecord = { ...sale, syncStatus: 'SYNCED' };
          storageService.updateSale(syncedSale);
          setSales((prev) => prev.map((s) => s.id === sale.id ? syncedSale : s));
        })
        .catch((error) => console.error('[Sales] remote save failed', error));
    }
  };

  const replaceSale = (sale: SaleRecord) => {
    const nextSales = salesRef.current.map((item) => item.id === sale.id ? sale : item);
    salesRef.current = nextSales;
    setSales(nextSales);
    persist(sale);
  };

  const isPrintableSale = (sale: SaleRecord) => (
    sale.status !== '보류'
    && sale.amount > 0
    && Boolean(sale.buyerNickname.trim())
    && sale.buyerNickname !== '미확인(보류)'
  );

  // 판매 상세에서 판매자가 바꾼 정보는 전표에도 다시 확인할 수 있도록 재출력한다.
  // 단, 자동 캡처 이미지 추가는 판매 수정으로 보지 않아 불필요한 재출력을 막는다.
  const hasSellerEditChanged = (before: SaleRecord, after: SaleRecord) => (
    before.buyerNickname.trim() !== after.buyerNickname.trim()
    || before.amount !== after.amount
    || before.recognizedAt !== after.recognizedAt
    || before.productName !== after.productName
    || before.status !== after.status
    || before.note !== after.note
  );

  const sendToPrinter = (sale: SaleRecord) => {
    void commentStreamService.printSale({
      saleId: sale.id,
      printRevision: sale.printRevision || 1,
      buyerNickname: sale.buyerNickname,
      amount: sale.amount,
      recognizedAt: sale.recognizedAt,
      sessionId: sale.sessionId,
    }).then((result) => {
      // 그 사이에 같은 판매가 다시 수정되었다면 오래된 인쇄 응답으로 상태를 덮어쓰지 않는다.
      const latest = salesRef.current.find((item) => item.id === sale.id);
      if (!latest || latest.printRevision !== sale.printRevision) return;
      replaceSale({
        ...latest,
        printStatus: result.ok ? 'PRINTED' : 'FAILED',
        printedAt: result.ok ? (result.printedAt || new Date().toISOString()) : undefined,
        printError: result.ok ? undefined : (result.error || '인쇄에 실패했습니다.'),
      });
    }).catch((error) => {
      const latest = salesRef.current.find((item) => item.id === sale.id);
      if (!latest || latest.printRevision !== sale.printRevision) return;
      replaceSale({
        ...latest,
        printStatus: 'FAILED',
        printError: error instanceof Error ? error.message : '인쇄에 실패했습니다.',
      });
    });
  };

  const queueSalePrint = (sale: SaleRecord, nextRevision: number) => {
    const queued: SaleRecord = {
      ...sale,
      printStatus: 'QUEUED',
      printRevision: nextRevision,
      printedAt: undefined,
      printError: undefined,
    };
    replaceSale(queued);
    sendToPrinter(queued);
    return queued;
  };

  const addSale = (saleData: Omit<SaleRecord, 'id'>): SaleRecord => {
    const productCode = saleData.productCode
      || getNextProductCodeForSession(saleData.sessionId, sales);
    const baseSale: SaleRecord = {
      ...saleData,
      productCode,
      id: `s-${crypto.randomUUID()}`,
      printStatus: saleData.printStatus || 'NOT_REQUESTED',
      printRevision: saleData.printRevision || 0,
      syncStatus: 'PENDING',
      revision: saleData.revision || 1,
    };
    const newSale = isPrintableSale(baseSale)
      ? { ...baseSale, printStatus: 'QUEUED' as const, printRevision: Math.max(1, baseSale.printRevision || 0) }
      : baseSale;
    const nextSales = [newSale, ...salesRef.current];
    salesRef.current = nextSales;
    setSales(nextSales);

    // [동시 쓰기 1: 로컬DB]
    storageService.addSale(newSale);

    // [동시 쓰기 2: Supabase]
    if (isRemoteAuth && workspaceId) {
      void remoteWorkspaceService.saveSale(workspaceId, newSale)
        .then(() => {
          const syncedSale: SaleRecord = { ...newSale, syncStatus: 'SYNCED' };
          storageService.updateSale(syncedSale);
          setSales((prev) => prev.map((s) => s.id === newSale.id ? syncedSale : s));
        })
        .catch((error) => console.error('[Sales] remote add failed', error));
    }
    if (newSale.printStatus === 'QUEUED') sendToPrinter(newSale);
    return newSale;
  };

  const updateSale = (updated: SaleRecord) => {
    const previous = salesRef.current.find((sale) => sale.id === updated.id);
    const shouldPrint = previous
      ? isPrintableSale(updated) && (!isPrintableSale(previous) || hasSellerEditChanged(previous, updated))
      : false;
    if (shouldPrint) {
      queueSalePrint(updated, Math.max(previous?.printRevision || 0, updated.printRevision || 0) + 1);
      return;
    }
    replaceSale(updated);
  };

  const retrySalePrint = (id: string) => {
    const sale = salesRef.current.find((item) => item.id === id);
    if (!sale || !isPrintableSale(sale)) return;
    queueSalePrint(sale, Math.max(1, sale.printRevision || 0) + 1);
  };

  const deleteSale = (id: string) => {
    const nextSales = salesRef.current.filter((sale) => sale.id !== id);
    salesRef.current = nextSales;
    setSales(nextSales);

    // [동시 쓰기 1: 로컬DB]
    storageService.deleteSale(id);

    // [동시 쓰기 2: Supabase]
    if (isRemoteAuth && workspaceId) {
      void remoteWorkspaceService.deleteSale(workspaceId, id).catch((error) => console.error('[Sales] remote delete failed', error));
    }
  };

  const confirmBatchSales = (saleIds: string[]): BatchConfirmResult => {
    const allSales = salesRef.current;
    const targetSales = allSales.filter((sale) => saleIds.includes(sale.id));
    const confirmedSaleIds: string[] = [];
    const skippedSales: BatchConfirmResult['skippedSales'] = [];

    targetSales.forEach((sale) => {
      const reasons = sale.pendingReasons || [];
      const unresolved = reasons.filter((r) => !r.resolved);

      const nickname = (sale.buyerNickname || '').trim();
      const hasValidNickname = Boolean(nickname) && nickname !== '미확인(보류)' && nickname !== '미확인';
      const hasValidAmount = Number(sale.amount || 0) > 0;
      const hasProduct = Boolean(sale.productCode || sale.productId || sale.productName);

      const validationErrors: string[] = [];
      if (!hasValidNickname) validationErrors.push('구매자 닉네임 미확인');
      if (!hasValidAmount) validationErrors.push('판매 금액 0원 또는 미입력');
      if (!hasProduct) validationErrors.push('연결 상품 정보 누락');
      if (unresolved.length > 0) {
        validationErrors.push(...unresolved.map((r) => r.message));
      }

      if (validationErrors.length > 0) {
        // 미확인 값이 남아 있으므로 보류 상태 유지 (PLAN.md 1-A)
        skippedSales.push({
          saleId: sale.id,
          buyerNickname: sale.buyerNickname,
          amount: sale.amount,
          remainingReasons: validationErrors,
        });
        return;
      }

      const nextRevision = (sale.revision || 1) + 1;
      const historyItem: SaleHistoryRecord = {
        revision: nextRevision,
        changedAt: new Date().toISOString(),
        changedBy: 'SELLER',
        changeType: 'BATCH_CONFIRM',
        before: {
          buyerNickname: sale.buyerNickname,
          amount: sale.amount,
          status: sale.status,
          pendingReasons: sale.pendingReasons,
        },
        after: {
          buyerNickname: sale.buyerNickname,
          amount: sale.amount,
          status: '확정',
          pendingReasons: sale.pendingReasons,
        },
        summary: '방송 후 보류 건 일괄 검증 통과 확정',
      };

      updateSale({
        ...sale,
        status: '확정',
        revision: nextRevision,
        history: [...(sale.history || []), historyItem],
      });
      confirmedSaleIds.push(sale.id);
    });

    const result: BatchConfirmResult = {
      totalRequested: saleIds.length,
      confirmedCount: confirmedSaleIds.length,
      confirmedSaleIds,
      skippedCount: skippedSales.length,
      skippedSales,
    };

    if (isRemoteAuth && workspaceId && confirmedSaleIds.length > 0) {
      void aiSettingsApi.batchConfirmPendingSales(confirmedSaleIds, workspaceId).catch((err) => {
        console.error('[SalesContext] remote batch confirm failed', err);
      });
    }

    return result;
  };

  const exportCsv = (filteredRecords?: SaleRecord[], filename?: string) => exportSalesToCsv(filteredRecords || sales.filter((sale) => sale.status === '확정'), filename);
  const getSalesBySession = (sessionId: string) => sales.filter((sale) => sale.sessionId === sessionId);

  const getSettlementSummary = (period: 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM', customRange?: { start: string; end: string }) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const filtered = sales.filter((sale) => {
      const recordedAt = new Date(sale.recognizedAt).getTime();
      if (period === 'TODAY') return recordedAt >= todayStart;
      if (period === 'WEEK') return recordedAt >= todayStart - 6 * 24 * 3600000;
      if (period === 'MONTH') return recordedAt >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      if (period === 'CUSTOM' && customRange) return recordedAt >= new Date(customRange.start).getTime() && recordedAt <= new Date(customRange.end).setHours(23, 59, 59, 999);
      return true;
    });
    const validSales = filtered.filter((sale) => sale.status !== '보류');
    const pendingSales = filtered.filter((sale) => sale.status === '보류');
    const groups: Record<string, SaleRecord[]> = {};
    validSales.forEach((sale) => {
      const date = new Date(sale.recognizedAt).toISOString().split('T')[0];
      (groups[date] ||= []).push(sale);
    });
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return {
      summary: {
        totalCount: validSales.length,
        totalAmount: validSales.reduce((sum, sale) => sum + (sale.amount || 0), 0),
        uniqueBuyersCount: new Set(validSales.map((sale) => sale.buyerNickname).filter(Boolean)).size,
        pendingCount: pendingSales.length,
      },
      records: filtered,
      groupedByDate: Object.keys(groups).sort((left, right) => right.localeCompare(left)).map((date) => ({
        date,
        dayName: dayNames[new Date(date).getDay()],
        count: groups[date].length,
        totalAmount: groups[date].reduce((sum, sale) => sum + sale.amount, 0),
        records: groups[date],
      })),
    };
  };

  return <SalesContext.Provider value={{ sales, addSale, updateSale, retrySalePrint, deleteSale, confirmBatchSales, exportCsv, refreshSales, getSalesBySession, getSettlementSummary }}>
    {children}
  </SalesContext.Provider>;
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
