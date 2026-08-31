import React, { createContext, useContext, useEffect, useState } from 'react';
import { SaleRecord, SaleStatus } from '../types/live';
import { storageService } from '../services/storageService';
import { exportSalesToCsv } from '../services/csvExporter';
import { useAuth } from './AuthContext';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { commentStreamService } from '../services/commentStreamService';

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
  confirmBatchSales: (saleIds: string[]) => void;
  exportCsv: (filteredRecords?: SaleRecord[], filename?: string) => boolean;
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
  const [sales, setSales] = useState<SaleRecord[]>(() => storageService.getSales());
  const [remoteReady, setRemoteReady] = useState(false);

  useEffect(() => {
    if (!isRemoteAuth || !workspaceId) {
      setRemoteReady(false);
      setSales(storageService.getSales());
      return;
    }
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const rows = await remoteWorkspaceService.loadSales(workspaceId);
        if (!active) return;
        setSales(rows);
        storageService.saveSales(rows);
        setRemoteReady(true);
      } catch (error) {
        console.error('[Sales] remote load failed', error);
        if (active) setRemoteReady(false);
      }
    };
    void load();
    const unsubscribe = remoteWorkspaceService.subscribe(workspaceId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 350);
    });
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [isRemoteAuth, workspaceId]);

  const persist = (sale: SaleRecord) => {
    storageService.updateSale(sale);
    if (isRemoteAuth && workspaceId && remoteReady) {
      void remoteWorkspaceService.saveSale(workspaceId, sale).catch((error) => console.error('[Sales] remote save failed', error));
    }
  };

  const replaceSale = (sale: SaleRecord) => {
    setSales((previous) => previous.map((item) => item.id === sale.id ? sale : item));
    persist(sale);
  };

  const isPrintableSale = (sale: SaleRecord) => (
    sale.status !== '보류'
    && sale.amount > 0
    && Boolean(sale.buyerNickname.trim())
    && sale.buyerNickname !== '미확인(보류)'
  );

  const hasPrintedContentChanged = (before: SaleRecord, after: SaleRecord) => (
    before.buyerNickname.trim() !== after.buyerNickname.trim()
    || before.amount !== after.amount
    || before.recognizedAt !== after.recognizedAt
  );

  const sendToPrinter = (sale: SaleRecord) => {
    void commentStreamService.printSale({
      saleId: sale.id,
      printRevision: sale.printRevision || 1,
      buyerNickname: sale.buyerNickname,
      amount: sale.amount,
      recognizedAt: sale.recognizedAt,
    }).then((result) => {
      // 그 사이에 같은 판매가 다시 수정되었다면 오래된 인쇄 응답으로 상태를 덮어쓰지 않는다.
      const latest = storageService.getSales().find((item) => item.id === sale.id);
      if (!latest || latest.printRevision !== sale.printRevision) return;
      replaceSale({
        ...latest,
        printStatus: result.ok ? 'PRINTED' : 'FAILED',
        printedAt: result.ok ? (result.printedAt || new Date().toISOString()) : undefined,
        printError: result.ok ? undefined : (result.error || '인쇄에 실패했습니다.'),
      });
    }).catch((error) => {
      const latest = storageService.getSales().find((item) => item.id === sale.id);
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
    const baseSale: SaleRecord = {
      ...saleData,
      id: `s-${crypto.randomUUID()}`,
      printStatus: saleData.printStatus || 'NOT_REQUESTED',
      printRevision: saleData.printRevision || 0,
    };
    const newSale = isPrintableSale(baseSale)
      ? { ...baseSale, printStatus: 'QUEUED' as const, printRevision: Math.max(1, baseSale.printRevision || 0) }
      : baseSale;
    setSales((previous) => [newSale, ...previous]);
    storageService.addSale(newSale);
    if (isRemoteAuth && workspaceId && remoteReady) {
      void remoteWorkspaceService.saveSale(workspaceId, newSale).catch((error) => console.error('[Sales] remote add failed', error));
    }
    if (newSale.printStatus === 'QUEUED') sendToPrinter(newSale);
    return newSale;
  };

  const updateSale = (updated: SaleRecord) => {
    const previous = storageService.getSales().find((sale) => sale.id === updated.id);
    const shouldPrint = previous
      ? isPrintableSale(updated) && (!isPrintableSale(previous) || hasPrintedContentChanged(previous, updated))
      : false;
    if (shouldPrint) {
      queueSalePrint(updated, Math.max(previous?.printRevision || 0, updated.printRevision || 0) + 1);
      return;
    }
    replaceSale(updated);
  };

  const retrySalePrint = (id: string) => {
    const sale = storageService.getSales().find((item) => item.id === id);
    if (!sale || !isPrintableSale(sale)) return;
    queueSalePrint(sale, Math.max(1, sale.printRevision || 0) + 1);
  };

  const deleteSale = (id: string) => {
    setSales((previous) => previous.filter((sale) => sale.id !== id));
    storageService.deleteSale(id);
    if (isRemoteAuth && workspaceId && remoteReady) {
      void remoteWorkspaceService.deleteSale(workspaceId, id).catch((error) => console.error('[Sales] remote delete failed', error));
    }
  };

  const confirmBatchSales = (saleIds: string[]) => {
    storageService.getSales()
      .filter((sale) => saleIds.includes(sale.id))
      .forEach((sale) => updateSale({ ...sale, status: '확정' as SaleStatus }));
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

  return <SalesContext.Provider value={{ sales, addSale, updateSale, retrySalePrint, deleteSale, confirmBatchSales, exportCsv, getSalesBySession, getSettlementSummary }}>
    {children}
  </SalesContext.Provider>;
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
