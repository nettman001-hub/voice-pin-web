import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SaleRecord, SaleStatus } from '../types/live';
import { storageService, getNextProductCodeForSession } from '../services/storageService';
import { exportSalesToCsv } from '../services/csvExporter';
import { useAuth } from './AuthContext';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { commentStreamService } from '../services/commentStreamService';
import type { BatchConfirmResult, SaleHistoryRecord } from '../types/pendingSale';
import { aiSettingsApi } from '../services/aiSettingsApi';
import { SalesSyncController } from '../services/salesSyncController';

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
  applyCommittedSales: (workspaceId: string, records: SaleRecord[]) => void;
  syncError: string | null;
  retrySync: () => void;
  getSalesBySession: (sessionId: string) => SaleRecord[];
  getSettlementSummary: (period: 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM', customRange?: { start: string; end: string }) => {
    summary: SettlementSummary;
    records: SaleRecord[];
    groupedByDate: { date: string; dayName: string; count: number; totalAmount: number; records: SaleRecord[] }[];
  };
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

export const SalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspaceId, isRemoteAuth, user } = useAuth();
  const [sales, setSales] = useState<SaleRecord[]>(() => workspaceId ? storageService.getSales(workspaceId) : []);
  const [syncError, setSyncError] = useState<string | null>(null);
  const salesRef = useRef<SaleRecord[]>(sales);
  const identityRef = useRef(workspaceId);
  identityRef.current = workspaceId;
  const identityKey = `${user?.id || ''}:${workspaceId || ''}:${isRemoteAuth}`;
  const identityKeyRef = useRef(identityKey);
  const identityGenerationRef = useRef(0);
  if (identityKeyRef.current !== identityKey) {
    identityKeyRef.current = identityKey;
    identityGenerationRef.current += 1;
    salesRef.current = [];
  }
  const controllerRef = useRef<{ workspaceId: string; generation: number; controller: SalesSyncController } | null>(null);

  const getController = useCallback(() => {
    if (!workspaceId || identityRef.current !== workspaceId || identityKeyRef.current !== identityKey) return null;
    const generation = identityGenerationRef.current;
    if (controllerRef.current?.workspaceId === workspaceId && controllerRef.current.generation === generation) return controllerRef.current.controller;
    const controller: SalesSyncController = new SalesSyncController({
      scope: workspaceId,
      read: () => storageService.getSalesLocalState(workspaceId),
      persist: (state) => storageService.saveSalesLocalState(workspaceId, state),
      update: (change) => storageService.updateSalesLocalState(workspaceId, change),
      save: (sale) => isRemoteAuth ? remoteWorkspaceService.saveSale(workspaceId, sale) : Promise.resolve(),
      remove: (id) => isRemoteAuth ? remoteWorkspaceService.deleteSale(workspaceId, id) : Promise.resolve(),
      load: () => isRemoteAuth ? remoteWorkspaceService.loadSales(workspaceId) : Promise.resolve(storageService.getSales(workspaceId)),
      changed: (records) => { salesRef.current = records; setSales(records); },
      error: (message) => setSyncError(message ? '클라우드 저장 대기 중입니다. 연결을 확인해 주세요.' : null),
      active: () => identityGenerationRef.current === generation && identityRef.current === workspaceId && controllerRef.current?.controller === controller,
    });
    controllerRef.current = { workspaceId, generation, controller };
    salesRef.current = controller.records;
    return controller;
  }, [identityKey, isRemoteAuth, workspaceId]);

  const refreshSales = useCallback(async (): Promise<SaleRecord[]> => {
    if (!workspaceId) {
      const local = workspaceId ? storageService.getSales(workspaceId) : [];
      salesRef.current = local;
      setSales(local);
      return local;
    }

    return await getController()?.refresh() || [];
  }, [getController, isRemoteAuth, workspaceId]);

  const applyCommittedSales = useCallback((owner: string, records: SaleRecord[]) => {
    if (owner !== identityRef.current) return;
    getController()?.applyConfirmed(records);
  }, [getController]);

  const retrySync = useCallback(() => { void getController()?.flush(); }, [getController]);

  useEffect(() => {
    if (!workspaceId) {
      salesRef.current = [];
      setSales([]);
      controllerRef.current = null;
      setSyncError(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const load = () => {
      void refreshSales().catch((error) => {
        if (active) console.error('[Sales] remote load failed', error);
      });
    };
    void storageService.restoreWorkspace(workspaceId).then(() => {
      if (!active || identityRef.current !== workspaceId) return;
      // Initialize after recovering the durable outbox; never replace a live controller.
      const controller = getController();
      if (controller) { salesRef.current = controller.records; setSales(controller.records); }
      retrySync();
      load();
    });
    const unsubscribe = isRemoteAuth ? remoteWorkspaceService.subscribe(workspaceId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 350);
    }) : () => {};
    const retryTimer = window.setInterval(retrySync, 10_000);
    window.addEventListener('online', retrySync);
    const reloadLocal = () => {
      void storageService.restoreWorkspace(workspaceId).then(async () => {
        if (!active) return;
        await getController()?.reloadState();
        retrySync();
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === `voicecap_sales_state:${encodeURIComponent(workspaceId)}`) reloadLocal();
    };
    const handleLocal = (event: Event) => {
      if ((event as CustomEvent).detail?.workspaceId === workspaceId) reloadLocal();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('voicecap_sales_updated', handleLocal);
    return () => {
      active = false; window.clearTimeout(timer); window.clearInterval(retryTimer);
      window.removeEventListener('online', retrySync); unsubscribe();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('voicecap_sales_updated', handleLocal);
    };
  }, [getController, isRemoteAuth, workspaceId, refreshSales, retrySync]);

  const replaceSale = (sale: SaleRecord) => {
    const controller = getController();
    if (!controller) return;
    return controller.upsert(sale);
  };

  const isPrintableSale = (sale: SaleRecord) => (
    sale.status !== '보류' && sale.status !== '취소' && sale.recordState !== 'CANCELLED'
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
    const owner = workspaceId;
    const generation = identityGenerationRef.current;
    void commentStreamService.printSale({
      saleId: sale.id,
      printRevision: sale.printRevision || 1,
      buyerNickname: sale.buyerNickname,
      amount: sale.amount,
      recognizedAt: sale.recognizedAt,
      sessionId: sale.sessionId,
    }).then((result) => {
      // 그 사이에 같은 판매가 다시 수정되었다면 오래된 인쇄 응답으로 상태를 덮어쓰지 않는다.
      if (identityRef.current !== owner || identityGenerationRef.current !== generation) return;
      const latest = salesRef.current.find((item) => item.id === sale.id);
      if (!latest || latest.printRevision !== sale.printRevision) return;
      replaceSale({
        ...latest,
        printStatus: result.ok ? 'PRINTED' : 'FAILED',
        printedAt: result.ok ? (result.printedAt || new Date().toISOString()) : undefined,
        printError: result.ok ? undefined : (result.error || '인쇄에 실패했습니다.'),
      });
    }).catch((error) => {
      if (identityRef.current !== owner || identityGenerationRef.current !== generation) return;
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
    const persisted = replaceSale(queued) || queued;
    sendToPrinter(persisted);
    return persisted;
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
    const controller = getController();
    if (!controller) throw new Error('로그인한 작업공간이 준비되지 않았습니다.');
    const persisted = controller.upsert(newSale);
    if (persisted.printStatus === 'QUEUED') sendToPrinter(persisted);
    return persisted;
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
    getController()?.delete(id);
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

  const visibleSales = controllerRef.current?.workspaceId === workspaceId && controllerRef.current.generation === identityGenerationRef.current ? sales : [];
  return <SalesContext.Provider value={{ sales: visibleSales, addSale, updateSale, retrySalePrint, deleteSale, confirmBatchSales, exportCsv, refreshSales, applyCommittedSales, syncError, retrySync, getSalesBySession, getSettlementSummary }}>
    {children}
  </SalesContext.Provider>;
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
