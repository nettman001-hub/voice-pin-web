import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from './WorkspaceRuntimeContext';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SaleRecord, SaleStatus } from '../types/live';
import { getNextProductCodeForSession } from '../services/storageService';
import { exportSalesToCsv } from '../services/csvExporter';

import type { BatchConfirmResult, SaleHistoryRecord } from '../types/pendingSale';

import { heldAfterServerRejection, markServerReviewCompleted } from '../services/serverRejectedSale';
import { SalesSyncController } from '../services/salesSyncController';
import { checkFourPointSaleCriteria } from '../services/salesExtractor';
import type { PromiseDefaultRecord } from '../services/promiseDefaultService';
import { createWorkspaceReadSync, workspaceReadsAvailable, type WorkspaceReadSync } from '../services/workspaceReadSync';

interface SettlementSummary {
  totalCount: number;
  totalAmount: number;
  uniqueBuyersCount: number;
  pendingCount: number;
}

interface SaleUpdateOptions {
  voiceAllocationContinuation?: boolean;
  voiceTransactionContinuation?: boolean;
  voiceCommentIdentity?: boolean;
}

interface SalesContextType {
  sales: SaleRecord[];
  promiseDefaults: PromiseDefaultRecord[];
  setPromiseDefault: (buyerKey: string, buyerNickname: string, sessionId: string,
    status: PromiseDefaultRecord['status']) => Promise<void>;
  addSale: (sale: Omit<SaleRecord, 'id'>) => SaleRecord;
  updateSale: (sale: SaleRecord, options?: SaleUpdateOptions) => SaleRecord | undefined;
  updateSaleCapture: (saleId: string, imageUrl: string) => SaleRecord | undefined;
  completeServerReview: (saleId: string) => SaleRecord | undefined;
  retrySalePrint: (id: string) => void;
  deleteSale: (id: string) => void;
  restoreSales: (records: SaleRecord[]) => void;
  confirmBatchSales: (saleIds: string[]) => BatchConfirmResult;
  exportCsv: (filteredRecords?: SaleRecord[], filename?: string) => boolean;
  refreshSales: () => Promise<SaleRecord[]>;
  applyCommittedSales: (workspaceId: string, records: SaleRecord[]) => void;
  syncError: string | null;
  retrySync: () => Promise<void>;
  getSalesBySession: (sessionId: string) => SaleRecord[];
  getSettlementSummary: (period: 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM', customRange?: { start: string; end: string }) => {
    summary: SettlementSummary;
    records: SaleRecord[];
    groupedByDate: { date: string; dayName: string; count: number; totalAmount: number; records: SaleRecord[] }[];
  };
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

export const SalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const runtime = useWorkspaceRuntime();
  const { storageService, remoteWorkspaceService, commentStreamService, aiSettingsApi } = runtime;
  const { workspaceId, isRemoteAuth, user } = useAuth();
  const [sales, setSales] = useState<SaleRecord[]>(() => workspaceId ? storageService.getSales(workspaceId) : []);
  const [promiseDefaultsState, setPromiseDefaultsState] = useState<{ workspaceId: string; records: PromiseDefaultRecord[] }>(
    () => ({ workspaceId: workspaceId || '', records: workspaceId ? storageService.getPromiseDefaults(workspaceId) : [] }),
  );
  const promiseDefaultChangeRef = useRef(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const salesRef = useRef<SaleRecord[]>(sales);
  const dispatchedPrintsRef = useRef<Set<string>>(new Set());
  const identityRef = useRef(workspaceId);
  identityRef.current = workspaceId;
  const identityKey = `${user?.id || ''}:${workspaceId || ''}:${isRemoteAuth}`;
  const identityKeyRef = useRef(identityKey);
  const identityGenerationRef = useRef(0);
  if (identityKeyRef.current !== identityKey) {
    identityKeyRef.current = identityKey;
    identityGenerationRef.current += 1;
    salesRef.current = [];
    dispatchedPrintsRef.current.clear();
  }
  const controllerRef = useRef<{ workspaceId: string; generation: number; controller: SalesSyncController } | null>(null);
  const readSyncRef = useRef<{ workspaceId: string; sync: WorkspaceReadSync<unknown> } | null>(null);

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
      changed: (records) => {
        const before = salesRef.current;
        salesRef.current = records;
        setSales(records);
        // A queued receipt is dispatched only after the cloud acknowledges the
        // allocation. A local optimistic row is never an invoice/print order.
        for (const sale of records) {
          const old = before.find((item) => item.id === sale.id);
          if (sale.printStatus === 'QUEUED' && sale.syncStatus === 'SYNCED'
            && old?.syncStatus === 'PENDING' && old.printRevision === sale.printRevision) {
            sendToPrinter(sale);
          }
        }
      },
      error: (message) => setSyncError(message),
      // A voice sale the server will not accept is still saved (marked for review) instead of staying in this browser only.
      fallback: (sale, error) => isRemoteAuth ? heldAfterServerRejection(sale, error) : null,
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
      setPromiseDefaultsState({ workspaceId: '', records: [] });
      return local;
    }

    if (readSyncRef.current?.workspaceId === workspaceId) {
      await readSyncRef.current.sync.request();
      return getController()?.records || [];
    }

    const mutationVersion = promiseDefaultChangeRef.current;
    const [records, decisions] = await Promise.all([
      getController()?.refresh() || Promise.resolve([]),
      isRemoteAuth ? remoteWorkspaceService.loadPromiseDefaults(workspaceId)
        : Promise.resolve(storageService.getPromiseDefaults(workspaceId)),
    ]);
    if (identityRef.current === workspaceId && promiseDefaultChangeRef.current === mutationVersion) {
      setPromiseDefaultsState({ workspaceId, records: decisions });
      storageService.savePromiseDefaults(decisions, workspaceId);
    }
    return records;
  }, [getController, isRemoteAuth, workspaceId]);

  const setPromiseDefault = async (buyerKey: string, buyerNickname: string, sessionId: string,
    status: PromiseDefaultRecord['status']): Promise<void> => {
    if (!workspaceId || !buyerKey || !buyerNickname.trim() || !sessionId) throw new Error('구매자와 방송 회차가 필요합니다.');
    const decision: PromiseDefaultRecord = {
      buyerKey, buyerNickname: buyerNickname.trim(), sessionId, status, updatedAt: new Date().toISOString(),
    };
    if (isRemoteAuth) await remoteWorkspaceService.savePromiseDefault(workspaceId, decision);
    if (identityRef.current !== workspaceId) return;
    promiseDefaultChangeRef.current += 1;
    storageService.savePromiseDefault(decision, workspaceId);
    setPromiseDefaultsState((current) => ({
      workspaceId,
      records: [decision, ...current.records.filter((record) =>
        record.buyerKey !== buyerKey || record.sessionId !== sessionId)],
    }));
  };

  const applyCommittedSales = useCallback((owner: string, records: SaleRecord[]) => {
    if (owner !== identityRef.current) return;
    getController()?.applyConfirmed(records);
  }, [getController]);

  const retrySync = useCallback(() => getController()?.flush({ retryBlocked: true }) || Promise.resolve(), [getController]);
  const retryAutomaticSync = useCallback(() => { void getController()?.flush(); }, [getController]);

  useEffect(() => {
    if (!workspaceId) {
      salesRef.current = [];
      setSales([]);
      setPromiseDefaultsState({ workspaceId: '', records: [] });
      controllerRef.current = null;
      setSyncError(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    let status: string | undefined;
    let readFailed = false;
    const dirtyTables = new Set<string>();
    const restored = storageService.restoreWorkspace(workspaceId);
    const sync = createWorkspaceReadSync({
      tables: ['sales', 'buyer_promise_defaults'],
      available: () => !isRemoteAuth || workspaceReadsAvailable(),
      load: async (tables) => {
        // The first subscription ACK may arrive before durable restoration.
        // Do not initialize a controller until its pending outbox is recovered.
        await restored;
        if (!active) return { decisions: undefined, mutationVersion: promiseDefaultChangeRef.current };
        const mutationVersion = promiseDefaultChangeRef.current;
        const [, decisions] = await Promise.all([
          tables.includes('sales') ? getController()?.refresh() : Promise.resolve(),
          tables.includes('buyer_promise_defaults')
            ? isRemoteAuth ? remoteWorkspaceService.loadPromiseDefaults(workspaceId)
              : Promise.resolve(storageService.getPromiseDefaults(workspaceId))
            : Promise.resolve(undefined),
        ]);
        return { decisions, mutationVersion };
      },
      apply: ({ decisions, mutationVersion }) => {
        if (!active || identityRef.current !== workspaceId || promiseDefaultChangeRef.current !== mutationVersion || !decisions) return;
        setPromiseDefaultsState({ workspaceId, records: decisions });
        storageService.savePromiseDefaults(decisions, workspaceId);
      },
      success: () => { readFailed = false; },
      failure: (error) => {
        readFailed = true;
        if (active) console.error('[Sales] remote load failed', error);
      },
    });
    readSyncRef.current = { workspaceId, sync };
    const load = () => { void sync.request(); };
    void restored.then(() => {
      if (!active || identityRef.current !== workspaceId) return;
      // Initialize after recovering the durable outbox; never replace a live controller.
      const controller = getController();
      if (controller) { salesRef.current = controller.records; setSales(controller.records); }
      retryAutomaticSync();
      load();
    });
    const unsubscribe = isRemoteAuth ? remoteWorkspaceService.subscribe(workspaceId, (change) => {
      if (change.eventType === 'DELETE' && !change.old.workspace_id) {
        if (change.table === 'sales' && !salesRef.current.some((sale) => sale.id === change.old.id) && !sync.isReading('sales')) return;
        // Composite PK contains the buyer/session even when RLS strips old values.
        if (change.table === 'buyer_promise_defaults' && !storageService.getPromiseDefaults(workspaceId)
          .some((decision) => decision.buyerKey === change.old.buyer_key && decision.sessionId === change.old.session_id)
          && !sync.isReading('buyer_promise_defaults')) return;
      }
      dirtyTables.add(change.table);
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        const tables = [...dirtyTables]; dirtyTables.clear();
        void sync.request(tables, true);
      }, 350);
    }, {
      tables: ['sales', 'buyer_promise_defaults'],
      onStatus: (next) => {
        status = next;
        if (next === 'SUBSCRIBED') {
          void sync.request(undefined, true);
        }
      },
    }) : () => {};
    const retryTimer = window.setInterval(retryAutomaticSync, 10_000);
    const recover = () => {
      retryAutomaticSync();
      if (isRemoteAuth && workspaceReadsAvailable()) load();
    };
    window.addEventListener('online', recover);
    if (isRemoteAuth && typeof document !== 'undefined') document.addEventListener('visibilitychange', recover);
    const fallbackTimer = isRemoteAuth ? window.setInterval(() => {
      if ((status !== 'SUBSCRIBED' || readFailed) && workspaceReadsAvailable()) load();
    }, 5 * 60_000) : undefined;
    const reloadLocal = () => {
      void storageService.restoreWorkspace(workspaceId).then(async () => {
        if (!active) return;
        await getController()?.reloadState();
        retryAutomaticSync();
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
      sync.dispose();
      if (readSyncRef.current?.sync === sync) readSyncRef.current = null;
      window.clearInterval(fallbackTimer);
      window.removeEventListener('online', recover);
      if (isRemoteAuth && typeof document !== 'undefined') document.removeEventListener('visibilitychange', recover);
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('voicecap_sales_updated', handleLocal);
    };
  }, [getController, isRemoteAuth, workspaceId, refreshSales, retryAutomaticSync]);

  const replaceSale = (sale: SaleRecord) => {
    const controller = getController();
    if (!controller) return;
    return controller.upsert(sale);
  };

  // A review acknowledgement changes only the note, including while its fallback
  // sale is still pending. It must not queue a new receipt like a seller edit.
  const completeServerReview = (saleId: string): SaleRecord | undefined => {
    const latest = salesRef.current.find((sale) => sale.id === saleId);
    if (!latest) return;
    const completed = markServerReviewCompleted(latest);
    return completed === latest ? latest : replaceSale(completed);
  };

  // A capture finishes asynchronously. Merge only its image into the latest
  // sale so server reconciliation and print acknowledgements remain intact.
  const updateSaleCapture = (saleId: string, imageUrl: string): SaleRecord | undefined => {
    const latest = salesRef.current.find((sale) => sale.id === saleId);
    if (!latest || !imageUrl) return;
    const images = latest.captureImageUrls || [];
    if (images.includes(imageUrl)) return latest;
    return replaceSale({
      ...latest,
      captureImageUrls: [...images, imageUrl],
      productImageUrl: images.length === 0 ? imageUrl : latest.productImageUrl || imageUrl,
    });
  };

  const isPrintableSale = (sale: SaleRecord) => (
    sale.status !== '보류' && sale.status !== '취소' && sale.recordState !== 'CANCELLED'
    && sale.amount > 0
    && Boolean(sale.buyerNickname.trim())
    && sale.buyerNickname !== '미확인(보류)'
    && (!sale.evidenceSnapshot?.buyerResolution || sale.evidenceSnapshot.buyerResolution.status === 'MATCHED')
  );

  // 판매 상세에서 판매자가 바꾼 정보는 전표에도 다시 확인할 수 있도록 재출력한다.
  // 단, 자동 캡처 이미지 추가는 판매 수정으로 보지 않아 불필요한 재출력을 막는다.
  const hasSellerEditChanged = (before: SaleRecord, after: SaleRecord) => (
    before.buyerNickname.trim() !== after.buyerNickname.trim()
    || before.amount !== after.amount
    || (before.recognizedAt !== after.recognizedAt
      && Date.parse(before.recognizedAt) !== Date.parse(after.recognizedAt))
    || before.productName !== after.productName
    || before.status !== after.status
    || before.note !== after.note
  );

  const sendToPrinter = (sale: SaleRecord) => {
    const owner = workspaceId;
    const generation = identityGenerationRef.current;
    const printKey = `${generation}:${sale.id}:${sale.printRevision || 1}`;
    // Image/metadata saves can acknowledge the same queued revision again
    // while printing. Only an explicit new revision creates another job.
    if (dispatchedPrintsRef.current.has(printKey)) return;
    dispatchedPrintsRef.current.add(printKey);
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
    return persisted;
  };

  const updateSale = (updated: SaleRecord, options?: SaleUpdateOptions) => {
    const previous = salesRef.current.find((sale) => sale.id === updated.id);
    // LiveContext supplies these flags only after linking the original STT
    // transaction or a comment author. Keep that continuation on the same row.
    const sameVoiceTransaction = previous?.source === 'WEB_VOICE' && updated.source === 'WEB_VOICE'
      && previous.sessionId === updated.sessionId && previous.recognizedAt === updated.recognizedAt
      && previous.productId === updated.productId && previous.productCode === updated.productCode
      && previous.productName === updated.productName
      && previous.status !== '취소' && updated.status !== '취소'
      && previous.recordState !== 'CANCELLED' && updated.recordState !== 'CANCELLED';
    const voiceTransactionContinuation = options?.voiceTransactionContinuation === true && sameVoiceTransaction
      && (previous.status === '보류'
        ? updated.status === '보류' || updated.status === '자동저장' || updated.status === '확정'
        : (previous.status === '자동저장' || previous.status === '확정') && updated.status === '확정');
    const voiceCommentIdentity = options?.voiceCommentIdentity === true && sameVoiceTransaction
      && previous.rawTranscript === updated.rawTranscript && previous.amount === updated.amount
      && previous.quantity === updated.quantity && previous.unitPrice === updated.unitPrice
      && Boolean(updated.sourceCommentIds?.some((id) => id.trim()))
      && (!previous.buyerId || previous.buyerId === updated.buyerId)
      && (previous.status === updated.status
        || (previous.status === '보류' && (updated.status === '자동저장' || updated.status === '확정')));
    if (previous?.source === 'WEB_VOICE' && previous.syncStatus === 'PENDING') {
      const sameEvidence = previous.sessionId === updated.sessionId
        && previous.amount === updated.amount && previous.rawTranscript === updated.rawTranscript
        && previous.recognizedAt === updated.recognizedAt
        && previous.productId === updated.productId && previous.productCode === updated.productCode
        && previous.productName === updated.productName;
      const metadataOnly = sameEvidence && previous.buyerNickname === updated.buyerNickname
        && previous.purchaseRequestId === updated.purchaseRequestId && previous.status === updated.status;
      const confirmedBuyerLinked = sameEvidence && previous.status === '확정' && updated.status === '확정'
        && previous.evidenceSnapshot?.buyerResolution?.saleConfirmed === true
        && previous.evidenceSnapshot.buyerResolution.status !== 'MATCHED'
        && updated.evidenceSnapshot?.buyerResolution?.status === 'MATCHED'
        && updated.evidenceSnapshot.buyerResolution.candidates[0]?.nickname === updated.buyerNickname
        && updated.sourceCommentIds?.includes(updated.evidenceSnapshot.buyerResolution.candidates[0]?.commentId);
      const lateCommentLinked = sameEvidence && previous.status === '보류'
        && updated.status === '자동저장' && Boolean(updated.purchaseRequestId);
      const workflowContinuation = previous.status === '보류' && Boolean(previous.workflowEvidence)
        && previous.sessionId === updated.sessionId && previous.recognizedAt === updated.recognizedAt
        && previous.workflowEvidence?.decisionId === updated.workflowEvidence?.decisionId
        && previous.workflowEvidence?.profileId === updated.workflowEvidence?.profileId
        && previous.workflowEvidence?.profileVersion === updated.workflowEvidence?.profileVersion
        && (updated.status === '보류' || (updated.status === '자동저장' && Boolean(updated.purchaseRequestId)));
      // A subsequent seller allocation may complete the same purchase while
      // its pending row is still uploading. The sync controller serializes
      // those writes; ordinary edits must retain the pending-write guard.
      const voiceAllocationContinuation = options?.voiceAllocationContinuation === true
        && previous.status === '보류' && updated.source === 'WEB_VOICE'
        && previous.sessionId === updated.sessionId
        && previous.productId === updated.productId && previous.productCode === updated.productCode
        && previous.productName === updated.productName
        && (Boolean(updated.purchaseRequestId) || (updated.evidenceSnapshot?.buyerResolution?.saleConfirmed === true
          && checkFourPointSaleCriteria(updated.rawTranscript).isFourPointSale))
        && (!previous.purchaseRequestId || previous.purchaseRequestId === updated.purchaseRequestId)
        && (Boolean(previous.sourceCommentIds?.some((id) => updated.sourceCommentIds?.includes(id)))
          || Boolean(previous.workflowEvidence?.transcripts.length && previous.workflowEvidence.transcripts.every((row) => updated.rawTranscript.includes(row.text))))
        && (updated.status === '자동저장' || updated.status === '확정') && updated.amount > 0;
      if (!metadataOnly && !confirmedBuyerLinked && !lateCommentLinked && !workflowContinuation && !voiceAllocationContinuation
        && !voiceTransactionContinuation && !voiceCommentIdentity) {
        setSyncError('음성 판매의 서버 저장 확인 전에는 구매자·가격을 수정할 수 없습니다.');
        return;
      }
      if (metadataOnly && !voiceTransactionContinuation && !voiceCommentIdentity) {
        return replaceSale(updated);
      }
    }
    // Completing an already printable voice transaction or reconciling its
    // comment identity is not a seller edit. Preserve the original print job;
    // an actual price/name change in a transaction still creates a new one.
    const sameReceiptContent = previous && previous.buyerNickname.trim() === updated.buyerNickname.trim()
      && previous.amount === updated.amount && previous.quantity === updated.quantity
      && previous.unitPrice === updated.unitPrice;
    const automaticMetadataUpdate = previous && isPrintableSale(previous)
      && (voiceCommentIdentity || (voiceTransactionContinuation && sameReceiptContent));
    const shouldPrint = previous
      ? !automaticMetadataUpdate && isPrintableSale(updated)
        && (!isPrintableSale(previous) || hasSellerEditChanged(previous, updated))
      : false;
    if (shouldPrint) {
      return queueSalePrint(updated, Math.max(previous?.printRevision || 0, updated.printRevision || 0) + 1);
    }
    if (automaticMetadataUpdate) {
      return replaceSale({ ...updated, printRevision: previous.printRevision, printStatus: previous.printStatus,
        printedAt: previous.printedAt, printError: previous.printError });
    }
    return replaceSale(updated);
  };

  const retrySalePrint = (id: string) => {
    const sale = salesRef.current.find((item) => item.id === id);
    if (!sale || sale.syncStatus === 'PENDING' || !isPrintableSale(sale)) return;
    queueSalePrint(sale, Math.max(1, sale.printRevision || 0) + 1);
  };

  const deleteSale = (id: string) => {
    getController()?.delete(id);
  };

  const restoreSales = (records: SaleRecord[]) => {
    const controller = getController();
    if (!controller) return;
    records.forEach((sale) => {
      controller.upsert({ ...sale, syncStatus: 'PENDING' });
    });
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
      if (sale.evidenceSnapshot?.buyerResolution && sale.evidenceSnapshot.buyerResolution.status !== 'MATCHED') {
        validationErrors.push('판매 확정 · 댓글 구매자 연결 필요');
      }
      if (!hasValidAmount) validationErrors.push('판매 금액 0원 또는 미입력');
      if (!hasProduct) validationErrors.push('연결 상품 정보 누락');
      if (sale.syncStatus === 'PENDING') validationErrors.push('서버 저장 확인 대기');
      if (sale.source === 'WEB_VOICE' && !sale.purchaseRequestId) validationErrors.push('실제 구매 댓글·계정 연결 필요');
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
    const validSales = filtered.filter((sale) => sale.status !== '보류' && sale.status !== '취소'
      && sale.recordState !== 'CANCELLED');
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
  const visiblePromiseDefaults = promiseDefaultsState.workspaceId === workspaceId ? promiseDefaultsState.records : [];
  return <SalesContext.Provider value={{ sales: visibleSales, promiseDefaults: visiblePromiseDefaults, setPromiseDefault,
    addSale, updateSale, updateSaleCapture, completeServerReview, retrySalePrint, deleteSale, restoreSales, confirmBatchSales, exportCsv, refreshSales, applyCommittedSales,
    syncError, retrySync, getSalesBySession, getSettlementSummary }}>
    {children}
  </SalesContext.Provider>;
};

export const useSales = () => {
  const context = useContext(SalesContext);
  if (!context) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
