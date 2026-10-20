import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from './WorkspaceRuntimeContext';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useSales } from './SalesContext';
import { buildClaimFromMessage, compareClaimWithSales } from '../services/customerMessageParser';

import { COMMERCE_TABLES, type CommerceTable } from '../services/remoteWorkspaceService';
import { areCommerceValuesEqual, getCommerceChanges, hasCommerceChanges, mergeRemoteCommerce } from '../services/commerceChanges';
import { createWorkspaceReadSync, workspaceReadsAvailable } from '../services/workspaceReadSync';
import { confirmPaymentInvoices, generateDepositCode, matchPayment } from '../services/paymentMatching';
import {
  CommerceState,
  CustomerPurchaseClaim,
  PaymentReceipt,
  SettlementInvoice,
  Shipment,
  SmsBridgeConfig,
  SmsCategory,
  SmsMessage
} from '../types/commerce';

type BridgeStatus = 'CHECKING' | 'ONLINE' | 'OFFLINE';
/** 마지막 웹 발송 때 휴대폰을 즉시 깨웠는지. DELAYED면 휴대폰 주기 확인(최대 15분)을 기다린다. */
type PhonePushStatus = 'UNKNOWN' | 'INSTANT' | 'DELAYED';

interface CommerceContextType extends CommerceState {
  bridgeConfig: SmsBridgeConfig;
  bridgeStatus: BridgeStatus;
  bridgeMessage: string;
  phonePush: PhonePushStatus;
  saveBridgeConfig: (config: SmsBridgeConfig) => void;
  syncBridge: () => Promise<boolean>;
  getClaimForSales: (saleIds: string[]) => CustomerPurchaseClaim | undefined;
  getMessagesForSales: (saleIds: string[]) => SmsMessage[];
  isVerified: (saleIds: string[]) => boolean;
  isPaid: (saleIds: string[]) => boolean;
  setVerified: (saleIds: string[], verified: boolean) => void;
  updateClaim: (claim: CustomerPurchaseClaim) => void;
  sendSms: (phoneNumber: string, body: string, category: SmsCategory, saleIds: string[]) => Promise<SmsMessage>;
  createInvoice: (invoice: Omit<SettlementInvoice, 'id' | 'createdAt' | 'status'>) => SettlementInvoice;
  sendInvoice: (invoiceId: string) => Promise<SmsMessage | null>;
  cancelInvoice: (invoiceId: string) => void;
  /** 확인 필요·미확인 입금을 판매자가 정산서(합산이면 여러 건)에 연결한다. */
  confirmPayment: (paymentId: string, invoiceIds: string[]) => Promise<void>;
  /** 판매와 관계없는 입금으로 표시한다(후보 해제). */
  dismissPayment: (paymentId: string) => void;
  createShipmentsForSales: (saleIds: string[]) => Shipment[];
  updateShipment: (shipment: Shipment) => void;
  sendShippingNotice: (shipmentId: string) => Promise<SmsMessage | null>;
}

const CommerceContext = createContext<CommerceContextType | undefined>(undefined);

const normalizePhone = (value: string) => {
  const compact = value.replace(/[^0-9+]/g, '');
  if (compact.startsWith('+82')) return `0${compact.slice(3)}`;
  if (compact.startsWith('82') && compact.length >= 11) return `0${compact.slice(2)}`;
  return compact.replace(/\D/g, '');
};
const intersects = (left: string[], right: string[]) => left.some((id) => right.includes(id));

// 옛 브리지 모드 전용. 클라우드 모드에서는 sms-bridge 서버가 입금 저장 즉시 같은 규칙으로 대조한다.
const matchPayments = (payments: PaymentReceipt[], invoices: SettlementInvoice[]): PaymentReceipt[] =>
  payments.map((payment) => {
    if (payment.matchStatus === 'MATCHED') return payment;
    const result = matchPayment(payment, invoices);
    return {
      ...payment,
      matchStatus: result.status,
      invoiceId: result.invoiceId,
      saleIds: result.saleIds,
      candidateIds: result.candidateIds,
    };
  });

const mergeById = <T extends { id: string }>(local: T[], remote: T[]): T[] => {
  const map = new Map(local.map((item) => [item.id, { ...item }]));
  remote.forEach((item) => map.set(item.id, { ...map.get(item.id), ...item }));
  return Array.from(map.values());
};

export const CommerceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const runtime = useWorkspaceRuntime();
  const { storageService, remoteWorkspaceService, smsBridgeService } = runtime;
  const { user, workspaceId, isRemoteAuth } = useAuth();
  const { sales } = useSales();
  const [state, setState] = useState<CommerceState>(() => storageService.getCommerceState());
  const [bridgeConfig, setBridgeConfig] = useState<SmsBridgeConfig>(() =>
    smsBridgeService.getConfig(user?.id || 'u-seller-1')
  );
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('CHECKING');
  const [bridgeMessage, setBridgeMessage] = useState('연동 서버 확인 중');
  const [remoteReady, setRemoteReady] = useState(false);
  const [phonePush, setPhonePush] = useState<PhonePushStatus>('UNKNOWN');
  const stateRef = useRef(state);
  const remoteSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentWorkspaceRef = useRef<string | null>(null);
  const remoteRefreshRef = useRef<(() => Promise<boolean>) | null>(null);
  currentWorkspaceRef.current = isRemoteAuth ? workspaceId : null;

  const applyRemoteState = useCallback((remote: CommerceState) => {
    if (remote === stateRef.current) return;
    stateRef.current = remote;
    setState(remote);
    storageService.saveCommerceState(remote);
  }, []);

  const commit = useCallback((updater: (previous: CommerceState) => CommerceState) => {
    const previous = stateRef.current;
    const next = updater(previous);
    if (next === previous) return;
    const changes = getCommerceChanges(previous, next);
    if (!hasCommerceChanges(changes)) return;

    // Keep consecutive actions current even before React renders. Persistence
    // stays outside a React state updater, which can run more than once.
    stateRef.current = next;
    setState(next);
    storageService.saveCommerceState(next);
    if (isRemoteAuth && workspaceId && remoteReady) {
      remoteSaveQueueRef.current = remoteSaveQueueRef.current
        .then(async () => {
          if (currentWorkspaceRef.current !== workspaceId) return;
          await remoteWorkspaceService.saveCommerceChanges(workspaceId, changes);
          if (changes.messages.some((message) => message.direction === 'OUTGOING' && message.status === 'QUEUED')) {
            void remoteWorkspaceService.notifyOutbox(workspaceId)
              .then((result) => {
                if (currentWorkspaceRef.current === workspaceId) setPhonePush(result.pushed > 0 ? 'INSTANT' : 'DELAYED');
              })
              .catch((error) => console.warn('[Commerce] phone push failed', error));
          }
        })
        .catch((error) => {
          console.error('[Commerce] remote save failed', error);
          if (currentWorkspaceRef.current !== workspaceId) return;
          setBridgeStatus('OFFLINE');
          setBridgeMessage('클라우드 저장에 실패했습니다. 네트워크를 확인해 주세요.');
        });
    }
  }, [isRemoteAuth, remoteReady, workspaceId]);

  useEffect(() => {
    const identity = workspaceId || user?.id;
    if (!identity || bridgeConfig.sellerId === identity) return;
    const next = { ...bridgeConfig, sellerId: identity };
    setBridgeConfig(next);
    smsBridgeService.saveConfig(next);
  }, [user?.id, workspaceId, bridgeConfig]);

  useEffect(() => {
    if (!isRemoteAuth || !workspaceId) {
      setRemoteReady(false);
      return;
    }
    let active = true;
    let timer: number | undefined;
    let status: string | undefined;
    let readFailed = false;
    const dirtyTables = new Set<CommerceTable>();
    const sync = createWorkspaceReadSync({
      tables: COMMERCE_TABLES,
      available: workspaceReadsAvailable,
      load: async (tables) => {
        // Finish writes already queued before taking an authoritative snapshot.
        let savedQueue: Promise<void>;
        do {
          savedQueue = remoteSaveQueueRef.current;
          await savedQueue;
        } while (active && savedQueue !== remoteSaveQueueRef.current);
        const before = stateRef.current;
        if (!active) return { before, remote: {} };
        const remote = await remoteWorkspaceService.loadCommerceTables(workspaceId, tables as CommerceTable[]);
        return { before, remote };
      },
      apply: ({ before, remote }) => {
        if (active) applyRemoteState(mergeRemoteCommerce(stateRef.current, before, remote));
      },
      success: () => {
        if (!active) return;
        readFailed = false;
        setRemoteReady(true);
        setBridgeStatus('ONLINE');
        setBridgeMessage('VoiceCAP 클라우드 연동 정상');
      },
      failure: (error) => {
        if (!active) return;
        readFailed = true;
        setBridgeStatus('OFFLINE');
        setBridgeMessage(error instanceof Error ? error.message : '클라우드 데이터를 불러오지 못했습니다.');
      },
    });
    const refresh = () => sync.request();
    remoteRefreshRef.current = refresh;
    const keys = {
      customer_messages: 'messages', payment_receipts: 'payments', purchase_claims: 'claims',
      invoices: 'invoices', shipments: 'shipments', verified_sales: 'verifiedSaleIds',
    } as const;
    const unsubscribe = remoteWorkspaceService.subscribe(workspaceId, (change) => {
      const table = change.table as CommerceTable;
      if (change.eventType === 'DELETE' && !change.old.workspace_id) {
        const key = keys[table];
        const exists = key === 'verifiedSaleIds'
          ? stateRef.current.verifiedSaleIds.includes(change.old.sale_id)
          : stateRef.current[key].some((row) => row.id === change.old.id);
        if (!exists && !sync.isReading(table)) return;
      }
      dirtyTables.add(table);
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        const tables = [...dirtyTables];
        dirtyTables.clear();
        void sync.request(tables, true);
      }, 350);
    }, {
      tables: COMMERCE_TABLES,
      onStatus: (next) => {
        status = next;
        if (next === 'SUBSCRIBED') {
          // REST may finish before Realtime starts delivering events. Repair
          // that first connection gap as well as subsequent reconnect gaps.
          void sync.request(undefined, true);
        }
      },
    });
    const recover = () => {
      if (workspaceReadsAvailable()) void refresh();
    };
    void refresh();
    window.addEventListener('online', recover);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', recover);
    // A disconnected/unsupported Realtime connection gets a slow repair read.
    // A healthy subscription never causes periodic REST table reads.
    const fallback = window.setInterval(() => {
      if (status !== 'SUBSCRIBED' || readFailed) recover();
    }, 5 * 60_000);
    return () => {
      active = false;
      sync.dispose();
      if (remoteRefreshRef.current === refresh) remoteRefreshRef.current = null;
      window.clearTimeout(timer);
      window.clearInterval(fallback);
      window.removeEventListener('online', recover);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', recover);
      unsubscribe();
    };
  }, [applyRemoteState, isRemoteAuth, workspaceId]);

  useEffect(() => {
    if (sales.length === 0) return;
    commit((previous) => {
      let changed = false;
      const claims = previous.claims.map((claim) => {
        const linkedSales = sales.filter((sale) => claim.saleIds.includes(sale.id));
        if (linkedSales.length === 0) return claim;
        const comparison = compareClaimWithSales(claim, linkedSales);
        if (comparison.status === claim.matchStatus && JSON.stringify(comparison.fields) === JSON.stringify(claim.fieldMatches)) {
          return claim;
        }
        changed = true;
        return { ...claim, matchStatus: comparison.status, fieldMatches: comparison.fields, updatedAt: new Date().toISOString() };
      });
      return changed ? { ...previous, claims } : previous;
    });
  }, [sales, commit]);

  const syncBridge = useCallback(async () => {
    setBridgeStatus('CHECKING');
    setBridgeMessage(isRemoteAuth ? 'VoiceCAP 클라우드 동기화 중' : 'voicecapSMS 연동 확인 중');
    if (isRemoteAuth && workspaceId) {
      return await remoteRefreshRef.current?.() || false;
    }
    try {
      await smsBridgeService.getStatus(bridgeConfig);
      const [remoteMessages, remotePayments] = await Promise.all([
        smsBridgeService.getMessages(bridgeConfig),
        smsBridgeService.getPayments(bridgeConfig)
      ]);

      commit((previous) => {
        const messages = mergeById(previous.messages, remoteMessages)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const claims = [...previous.claims];
        messages
          .filter((message) => message.direction === 'INCOMING' && message.category === 'PURCHASE_INFO' && !claims.some((claim) => claim.messageId === message.id))
          .forEach((message) => {
            const claim = buildClaimFromMessage(message, sales);
            claims.unshift(claim);
            message.saleIds = claim.saleIds;
          });

        const saleIdsByPhone = new Map<string, string[]>();
        claims.forEach((claim) => {
          if (claim.saleIds.length > 0) saleIdsByPhone.set(normalizePhone(claim.phoneNumber), claim.saleIds);
        });
        messages.forEach((message) => {
          if (message.saleIds.length > 0) saleIdsByPhone.set(normalizePhone(message.phoneNumber), message.saleIds);
        });
        messages.forEach((message) => {
          if (message.saleIds.length > 0) return;
          const linkedSaleIds = saleIdsByPhone.get(normalizePhone(message.phoneNumber));
          if (linkedSaleIds) message.saleIds = linkedSaleIds;
        });

        const payments = matchPayments(mergeById(previous.payments, remotePayments), previous.invoices);
        const paidInvoiceIds = new Set(payments.filter((payment) => payment.matchStatus === 'MATCHED').map((p) => p.invoiceId).filter(Boolean));
        const invoices = previous.invoices.map((invoice) =>
          paidInvoiceIds.has(invoice.id) ? { ...invoice, status: 'PAID' as const } : invoice
        );
        return { ...previous, messages, claims, payments, invoices };
      });
      setBridgeStatus('ONLINE');
      setBridgeMessage('voicecapSMS 연동 정상');
      return true;
    } catch (error) {
      setBridgeStatus('OFFLINE');
      setBridgeMessage(error instanceof Error ? error.message : '연동 서버에 연결할 수 없습니다.');
      return false;
    }
  }, [applyRemoteState, bridgeConfig, commit, isRemoteAuth, sales, workspaceId]);

  useEffect(() => {
    if (isRemoteAuth) return;
    void syncBridge();
    const timer = window.setInterval(() => void syncBridge(), 15000);
    return () => window.clearInterval(timer);
  }, [isRemoteAuth, syncBridge]);

  const saveBridgeConfig = (config: SmsBridgeConfig) => {
    const normalized = { ...config, baseUrl: config.baseUrl.trim().replace(/\/$/, '') };
    setBridgeConfig(normalized);
    smsBridgeService.saveConfig(normalized);
  };

  const getClaimForSales = useCallback(
    (saleIds: string[]) => state.claims.find((claim) => intersects(claim.saleIds, saleIds)),
    [state.claims]
  );

  const getMessagesForSales = useCallback(
    (saleIds: string[]) => state.messages
      .filter((message) => intersects(message.saleIds, saleIds))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [state.messages]
  );

  const isVerified = useCallback(
    (saleIds: string[]) => saleIds.length > 0 && saleIds.every((id) => state.verifiedSaleIds.includes(id)),
    [state.verifiedSaleIds]
  );

  const isPaid = useCallback(
    (saleIds: string[]) => state.payments.some(
      (payment) => payment.matchStatus === 'MATCHED' && intersects(payment.saleIds, saleIds)
    ),
    [state.payments]
  );

  const setVerified = (saleIds: string[], verified: boolean) => {
    commit((previous) => {
      const idSet = new Set(previous.verifiedSaleIds);
      saleIds.forEach((id) => verified ? idSet.add(id) : idSet.delete(id));
      return { ...previous, verifiedSaleIds: Array.from(idSet) };
    });
  };

  const updateClaim = (claim: CustomerPurchaseClaim) => {
    const linkedSales = sales.filter((sale) => claim.saleIds.includes(sale.id));
    const comparison = compareClaimWithSales(claim, linkedSales);
    commit((previous) => {
      const existing = previous.claims.find((item) => item.id === claim.id);
      if (!existing) return previous;
      const updated = { ...claim, matchStatus: comparison.status, fieldMatches: comparison.fields, updatedAt: existing.updatedAt };
      if (areCommerceValuesEqual(existing, updated)) return previous;
      return {
        ...previous,
        claims: previous.claims.map((item) => item.id === updated.id
          ? { ...updated, updatedAt: new Date().toISOString() }
          : item)
      };
    });
  };

  const sendSms = async (phoneNumber: string, body: string, category: SmsCategory, saleIds: string[]) => {
    if (isRemoteAuth && workspaceId) {
      const message: SmsMessage = {
        id: `sms-${crypto.randomUUID()}`,
        sellerId: workspaceId,
        phoneNumber,
        body,
        direction: 'OUTGOING',
        category,
        status: 'QUEUED',
        saleIds,
        attachments: [],
        createdAt: new Date().toISOString()
      };
      commit((previous) => ({ ...previous, messages: mergeById(previous.messages, [message]) }));
      return message;
    }
    try {
      const message = await smsBridgeService.queueMessage(bridgeConfig, { phoneNumber, body, category, saleIds });
      commit((previous) => ({ ...previous, messages: mergeById(previous.messages, [message]) }));
      return message;
    } catch (error) {
      const message: SmsMessage = {
        id: `sms-local-failed-${Date.now()}`,
        sellerId: bridgeConfig.sellerId,
        phoneNumber,
        body,
        direction: 'OUTGOING',
        category,
        status: 'FAILED',
        saleIds,
        attachments: [],
        createdAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : '발송 요청 실패'
      };
      commit((previous) => ({ ...previous, messages: [message, ...previous.messages] }));
      return message;
    }
  };

  const createInvoice = (input: Omit<SettlementInvoice, 'id' | 'createdAt' | 'status'>) => {
    const openCodes = stateRef.current.invoices
      .filter((invoice) => invoice.depositCode && !['PAID', 'CANCELLED'].includes(invoice.status))
      .map((invoice) => invoice.depositCode as string);
    const invoice: SettlementInvoice = {
      ...input,
      id: `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'DRAFT',
      depositCode: input.depositCode || generateDepositCode(openCodes),
      createdAt: new Date().toISOString()
    };
    commit((previous) => ({ ...previous, invoices: [invoice, ...previous.invoices] }));
    return invoice;
  };

  const sendInvoice = async (invoiceId: string) => {
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return null;
    const body = [
      '[VoiceCAP 정산서]',
      `고객: ${invoice.customerNickname}`,
      `청구금액: ${invoice.amount.toLocaleString()}원`,
      `입금계좌: ${invoice.bankAccount}`,
      `입금기한: ${invoice.dueDate}`,
      invoice.depositCode
        ? `입금자명을 "${invoice.customerNickname}" 또는 "${invoice.depositCode}"로 적어 주세요.`
        : `입금자명을 "${invoice.customerNickname}"로 적어 주세요.`
    ].join('\n');
    const message = await sendSms(invoice.phoneNumber, body, 'INVOICE', invoice.saleIds);
    commit((previous) => ({
      ...previous,
      invoices: previous.invoices.map((item) => item.id === invoiceId
        ? {
            ...item,
            status: message.status === 'FAILED' ? 'DRAFT' : 'QUEUED',
            sentAt: message.status === 'FAILED' ? undefined : new Date().toISOString(),
            smsMessageId: message.id
          }
        : item)
    }));
    return message;
  };

  const cancelInvoice = (invoiceId: string) => {
    commit((previous) => ({
      ...previous,
      invoices: previous.invoices.map((invoice) => invoice.id === invoiceId ? { ...invoice, status: 'CANCELLED' } : invoice)
    }));
  };

  const confirmPayment = async (paymentId: string, invoiceIds: string[]) => {
    const current = stateRef.current;
    const payment = current.payments.find((item) => item.id === paymentId);
    const invoices = invoiceIds
      .map((id) => current.invoices.find((invoice) => invoice.id === id))
      .filter((invoice): invoice is SettlementInvoice => Boolean(invoice));
    if (!payment || invoices.length === 0) return;
    const confirmed = confirmPaymentInvoices(invoices);
    const paidIds = new Set(invoices.map((invoice) => invoice.id));
    commit((previous) => ({
      ...previous,
      payments: previous.payments.map((item) => item.id === paymentId
        ? { ...item, matchStatus: 'MATCHED', invoiceId: confirmed.invoiceId, saleIds: confirmed.saleIds, candidateIds: [] }
        : item),
      invoices: previous.invoices.map((invoice) => paidIds.has(invoice.id) ? { ...invoice, status: 'PAID' } : invoice)
    }));
    const nicknames = new Set(invoices.map((invoice) => invoice.customerNickname));
    if (isRemoteAuth && workspaceId && nicknames.size === 1) {
      try {
        await remoteWorkspaceService.saveDepositorAlias(workspaceId, payment.payerName, invoices[0].customerNickname);
      } catch (error) {
        console.warn('[Commerce] 입금자명 별칭 저장 실패:', error);
      }
    }
  };

  const dismissPayment = (paymentId: string) => {
    commit((previous) => ({
      ...previous,
      payments: previous.payments.map((item) => item.id === paymentId && item.matchStatus !== 'MATCHED'
        ? { ...item, matchStatus: 'UNMATCHED', candidateIds: [] }
        : item)
    }));
  };

  const createShipmentsForSales = (saleIds: string[]) => {
    const created: Shipment[] = [];
    const grouped = new Map<string, string[]>();
    saleIds.forEach((saleId) => {
      const sale = sales.find((item) => item.id === saleId);
      if (!sale) return;
      const key = `${sale.sessionId}:${sale.buyerNickname}`;
      grouped.set(key, [...(grouped.get(key) || []), saleId]);
    });
    grouped.forEach((ids) => {
      if (state.shipments.some((shipment) => intersects(shipment.saleIds, ids))) return;
      const sale = sales.find((item) => item.id === ids[0]);
      const claim = getClaimForSales(ids);
      const invoice = state.invoices.find((inv) => intersects(inv.saleIds, ids));
      if (!sale) return;

      const phoneNumber = (claim?.phoneNumber || invoice?.phoneNumber || '').trim();
      const address = (claim?.address || invoice?.address || '').trim();

      // 주소 또는 연락처가 없으면 발송 업무(발송대기)로 생성하지 않음!
      if (!phoneNumber || !address) return;

      created.push({
        id: `shipment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        saleIds: ids,
        recipientName: claim?.nickname || invoice?.customerNickname || sale.buyerNickname,
        phoneNumber,
        address,
        carrier: 'CJ대한통운',
        trackingNumber: '',
        status: 'READY',
        memo: '',
        createdAt: new Date().toISOString()
      });
    });
    if (created.length > 0) {
      commit((previous) => ({ ...previous, shipments: [...created, ...previous.shipments] }));
    }
    return created;
  };

  const updateShipment = (shipment: Shipment) => {
    commit((previous) => ({
      ...previous,
      shipments: previous.shipments.map((item) => item.id === shipment.id ? shipment : item)
    }));
  };

  const sendShippingNotice = async (shipmentId: string) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId);
    if (!shipment || !shipment.phoneNumber || !shipment.trackingNumber) return null;
    const body = `[VoiceCAP 배송안내]\n${shipment.recipientName}님 상품이 발송되었습니다.\n${shipment.carrier} ${shipment.trackingNumber}`;
    const message = await sendSms(shipment.phoneNumber, body, 'SHIPPING', shipment.saleIds);
    if (message.status !== 'FAILED') {
      updateShipment({ ...shipment, status: 'SHIPPED', shippedAt: new Date().toISOString(), smsMessageId: message.id });
    }
    return message;
  };

  const value = useMemo<CommerceContextType>(() => ({
    ...state,
    bridgeConfig,
    bridgeStatus,
    bridgeMessage,
    phonePush,
    saveBridgeConfig,
    syncBridge,
    getClaimForSales,
    getMessagesForSales,
    isVerified,
    isPaid,
    setVerified,
    updateClaim,
    sendSms,
    createInvoice,
    sendInvoice,
    cancelInvoice,
    confirmPayment,
    dismissPayment,
    createShipmentsForSales,
    updateShipment,
    sendShippingNotice
  }), [state, bridgeConfig, bridgeStatus, bridgeMessage, phonePush, syncBridge, getClaimForSales, getMessagesForSales, isVerified, isPaid]);

  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
};

export const useCommerce = () => {
  const context = useContext(CommerceContext);
  if (!context) throw new Error('useCommerce must be used within a CommerceProvider');
  return context;
};
