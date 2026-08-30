import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useSales } from './SalesContext';
import { buildClaimFromMessage, compareClaimWithSales } from '../services/customerMessageParser';
import { smsBridgeService } from '../services/smsBridgeService';
import { storageService } from '../services/storageService';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
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

interface CommerceContextType extends CommerceState {
  bridgeConfig: SmsBridgeConfig;
  bridgeStatus: BridgeStatus;
  bridgeMessage: string;
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
  createShipmentsForSales: (saleIds: string[]) => Shipment[];
  updateShipment: (shipment: Shipment) => void;
  sendShippingNotice: (shipmentId: string) => Promise<SmsMessage | null>;
}

const CommerceContext = createContext<CommerceContextType | undefined>(undefined);

const normalize = (value: string) => value.replace(/\s+/g, '').replace(/님$/u, '').toLowerCase();
const normalizePhone = (value: string) => {
  const compact = value.replace(/[^0-9+]/g, '');
  if (compact.startsWith('+82')) return `0${compact.slice(3)}`;
  if (compact.startsWith('82') && compact.length >= 11) return `0${compact.slice(2)}`;
  return compact.replace(/\D/g, '');
};
const intersects = (left: string[], right: string[]) => left.some((id) => right.includes(id));

const mergeById = <T extends { id: string }>(local: T[], remote: T[]): T[] => {
  const map = new Map(local.map((item) => [item.id, item]));
  remote.forEach((item) => map.set(item.id, { ...map.get(item.id), ...item }));
  return Array.from(map.values());
};

export const CommerceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, workspaceId, isRemoteAuth } = useAuth();
  const { sales } = useSales();
  const [state, setState] = useState<CommerceState>(() => storageService.getCommerceState());
  const [bridgeConfig, setBridgeConfig] = useState<SmsBridgeConfig>(() =>
    smsBridgeService.getConfig(user?.id || 'u-seller-1')
  );
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('CHECKING');
  const [bridgeMessage, setBridgeMessage] = useState('연동 서버 확인 중');
  const [remoteReady, setRemoteReady] = useState(false);

  const commit = useCallback((updater: (previous: CommerceState) => CommerceState) => {
    setState((previous) => {
      const next = updater(previous);
      storageService.saveCommerceState(next);
      if (isRemoteAuth && workspaceId && remoteReady) {
        void remoteWorkspaceService.saveCommerce(workspaceId, next).catch((error) => {
          console.error('[Commerce] remote save failed', error);
          setBridgeStatus('OFFLINE');
          setBridgeMessage('클라우드 저장에 실패했습니다. 네트워크를 확인해 주세요.');
        });
      }
      return next;
    });
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
    const load = async () => {
      try {
        const remote = await remoteWorkspaceService.loadCommerce(workspaceId);
        if (!active) return;
        setState(remote);
        storageService.saveCommerceState(remote);
        setRemoteReady(true);
        setBridgeStatus('ONLINE');
        setBridgeMessage('VoiceCAP 클라우드 연동 정상');
      } catch (error) {
        if (!active) return;
        setRemoteReady(false);
        setBridgeStatus('OFFLINE');
        setBridgeMessage(error instanceof Error ? error.message : '클라우드 데이터를 불러오지 못했습니다.');
      }
    };
    void load();
    const unsubscribe = remoteWorkspaceService.subscribe(workspaceId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 350);
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [isRemoteAuth, workspaceId]);

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

  const matchPayments = useCallback((payments: PaymentReceipt[]): PaymentReceipt[] => {
    return payments.map((payment) => {
      if (payment.saleIds.length > 0 && payment.matchStatus === 'MATCHED') return payment;
      const candidates = sales.filter(
        (sale) => normalize(sale.buyerNickname) === normalize(payment.payerName) && sale.amount === payment.amount
      );
      if (candidates.length === 1) {
        return { ...payment, saleIds: [candidates[0].id], matchStatus: 'MATCHED' };
      }
      return { ...payment, matchStatus: candidates.length > 1 ? 'NEEDS_REVIEW' : 'UNMATCHED' };
    });
  }, [sales]);

  const syncBridge = useCallback(async () => {
    setBridgeStatus('CHECKING');
    setBridgeMessage(isRemoteAuth ? 'VoiceCAP 클라우드 동기화 중' : 'voicecapSMS 연동 확인 중');
    if (isRemoteAuth && workspaceId) {
      try {
        const remote = await remoteWorkspaceService.loadCommerce(workspaceId);
        setState(remote);
        storageService.saveCommerceState(remote);
        setRemoteReady(true);
        setBridgeStatus('ONLINE');
        setBridgeMessage('VoiceCAP 클라우드 연동 정상');
        return true;
      } catch (error) {
        setBridgeStatus('OFFLINE');
        setBridgeMessage(error instanceof Error ? error.message : '클라우드 서버에 연결할 수 없습니다.');
        return false;
      }
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

        const payments = matchPayments(mergeById(previous.payments, remotePayments));
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
  }, [bridgeConfig, commit, isRemoteAuth, matchPayments, sales, workspaceId]);

  useEffect(() => {
    void syncBridge();
    const timer = window.setInterval(() => void syncBridge(), 15000);
    return () => window.clearInterval(timer);
  }, [syncBridge]);

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
    const updated = { ...claim, matchStatus: comparison.status, fieldMatches: comparison.fields, updatedAt: new Date().toISOString() };
    commit((previous) => ({
      ...previous,
      claims: previous.claims.map((item) => item.id === updated.id ? updated : item)
    }));
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
    const invoice: SettlementInvoice = {
      ...input,
      id: `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'DRAFT',
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
      '입금 후 이 문자로 회신해 주세요.'
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
      if (!sale) return;
      created.push({
        id: `shipment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        saleIds: ids,
        recipientName: claim?.nickname || sale.buyerNickname,
        phoneNumber: claim?.phoneNumber || '',
        address: claim?.address || '',
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
    createShipmentsForSales,
    updateShipment,
    sendShippingNotice
  }), [state, bridgeConfig, bridgeStatus, bridgeMessage, syncBridge, getClaimForSales, getMessagesForSales, isVerified, isPaid]);

  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
};

export const useCommerce = () => {
  const context = useContext(CommerceContext);
  if (!context) throw new Error('useCommerce must be used within a CommerceProvider');
  return context;
};
