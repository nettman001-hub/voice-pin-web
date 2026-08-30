import React, { createContext, useContext, useEffect, useState } from 'react';
import { SaleRecord, SaleStatus } from '../types/live';
import { storageService } from '../services/storageService';
import { exportSalesToCsv } from '../services/csvExporter';
import { useAuth } from './AuthContext';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';

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

  const addSale = (saleData: Omit<SaleRecord, 'id'>): SaleRecord => {
    const newSale: SaleRecord = { ...saleData, id: `s-${crypto.randomUUID()}` };
    setSales((previous) => [newSale, ...previous]);
    storageService.addSale(newSale);
    if (isRemoteAuth && workspaceId && remoteReady) {
      void remoteWorkspaceService.saveSale(workspaceId, newSale).catch((error) => console.error('[Sales] remote add failed', error));
    }
    return newSale;
  };

  const updateSale = (updated: SaleRecord) => {
    setSales((previous) => previous.map((sale) => sale.id === updated.id ? updated : sale));
    persist(updated);
  };

  const deleteSale = (id: string) => {
    setSales((previous) => previous.filter((sale) => sale.id !== id));
    storageService.deleteSale(id);
    if (isRemoteAuth && workspaceId && remoteReady) {
      void remoteWorkspaceService.deleteSale(workspaceId, id).catch((error) => console.error('[Sales] remote delete failed', error));
    }
  };

  const confirmBatchSales = (saleIds: string[]) => {
    setSales((previous) => previous.map((sale) => saleIds.includes(sale.id) ? { ...sale, status: '확정' as SaleStatus } : sale));
    const current = storageService.getSales().map((sale) => saleIds.includes(sale.id) ? { ...sale, status: '확정' as SaleStatus } : sale);
    storageService.saveSales(current);
    if (isRemoteAuth && workspaceId && remoteReady) {
      void Promise.all(current.filter((sale) => saleIds.includes(sale.id)).map((sale) => remoteWorkspaceService.saveSale(workspaceId, sale)))
        .catch((error) => console.error('[Sales] remote batch save failed', error));
    }
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

  return <SalesContext.Provider value={{ sales, addSale, updateSale, deleteSale, confirmBatchSales, exportCsv, getSalesBySession, getSettlementSummary }}>
    {children}
  </SalesContext.Provider>;
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
