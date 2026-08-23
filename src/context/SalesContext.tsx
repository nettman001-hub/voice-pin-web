import React, { createContext, useContext, useState, useEffect } from 'react';
import { SaleRecord, SaleStatus } from '../types/live';
import { storageService } from '../services/storageService';
import { exportSalesToCsv } from '../services/csvExporter';

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
  const [sales, setSales] = useState<SaleRecord[]>([]);

  useEffect(() => {
    setSales(storageService.getSales());
  }, []);

  const addSale = (saleData: Omit<SaleRecord, 'id'>): SaleRecord => {
    const newSale: SaleRecord = {
      ...saleData,
      id: `s-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    };
    storageService.addSale(newSale);
    setSales(storageService.getSales());
    return newSale;
  };

  const updateSale = (updated: SaleRecord) => {
    storageService.updateSale(updated);
    setSales(storageService.getSales());
  };

  const deleteSale = (id: string) => {
    storageService.deleteSale(id);
    setSales(storageService.getSales());
  };

  const confirmBatchSales = (saleIds: string[]) => {
    const current = storageService.getSales();
    const updated = current.map((s) => (saleIds.includes(s.id) ? { ...s, status: '확정' as SaleStatus } : s));
    storageService.saveSales(updated);
    setSales(updated);
  };

  const exportCsv = (filteredRecords?: SaleRecord[], filename?: string) => {
    const targetList = filteredRecords || sales.filter((s) => s.status === '확정');
    return exportSalesToCsv(targetList, filename);
  };

  const getSalesBySession = (sessionId: string) => {
    return sales.filter((s) => s.sessionId === sessionId);
  };

  const getSettlementSummary = (period: 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM', customRange?: { start: string; end: string }) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const filtered = sales.filter((s) => {
      const recTime = new Date(s.recognizedAt).getTime();
      if (period === 'TODAY') {
        return recTime >= todayStart;
      } else if (period === 'WEEK') {
        const weekStart = todayStart - 6 * 24 * 3600000;
        return recTime >= weekStart;
      } else if (period === 'MONTH') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        return recTime >= monthStart;
      } else if (period === 'CUSTOM' && customRange) {
        const start = new Date(customRange.start).getTime();
        const end = new Date(customRange.end).setHours(23, 59, 59, 999);
        return recTime >= start && recTime <= end;
      }
      return true;
    });

    // 집계 계산 (보류 건은 금액 및 건수 합산에서 제외하고 별도 카운트)
    const validSales = filtered.filter((s) => s.status !== '보류');
    const pendingSales = filtered.filter((s) => s.status === '보류');

    const totalCount = validSales.length;
    const totalAmount = validSales.reduce((sum, item) => sum + (item.amount || 0), 0);
    const uniqueBuyers = new Set(validSales.map((s) => s.buyerNickname).filter(Boolean));
    const pendingCount = pendingSales.length;

    // 일자별 그룹화
    const groups: { [key: string]: SaleRecord[] } = {};
    validSales.forEach((s) => {
      const dateKey = new Date(s.recognizedAt).toISOString().split('T')[0];
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(s);
    });

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const groupedByDate = Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((dateStr) => {
        const list = groups[dateStr];
        const d = new Date(dateStr);
        const dayName = dayNames[d.getDay()];
        const amountSum = list.reduce((sum, item) => sum + item.amount, 0);
        return {
          date: dateStr,
          dayName,
          count: list.length,
          totalAmount: amountSum,
          records: list
        };
      });

    return {
      summary: {
        totalCount,
        totalAmount,
        uniqueBuyersCount: uniqueBuyers.size,
        pendingCount
      },
      records: filtered,
      groupedByDate
    };
  };

  return (
    <SalesContext.Provider
      value={{
        sales,
        addSale,
        updateSale,
        deleteSale,
        confirmBatchSales,
        exportCsv,
        getSalesBySession,
        getSettlementSummary
      }}
    >
      {children}
    </SalesContext.Provider>
  );
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
