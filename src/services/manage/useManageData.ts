import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { shippingService } from '../shippingService';
import { buyerPhoneLinkService } from '../buyerPhoneLinkService';
import { remoteWorkspaceService } from '../remoteWorkspaceService';
import { isSupabaseConfigured, requireSupabase } from '../supabaseClient';
import type { ContactLinkRecord } from './contactLink';
import {
  DEFAULT_KEEPING_ALERT_DAYS, KEEPING_ALERT_DAYS_SETTING, normalizeKeepingAlertDays,
  type FulfillmentItemRecord, type KeepingAlertDays,
} from './fulfillment';
import { buildManageDashboard, type ManageDashboard } from './dashboard';

/**
 * 관리 화면이 읽는 값. 쓰기는 manageApi(서버)로만 한다.
 * 새 표(buyer_contacts, fulfillment_items)가 아직 운영에 없으면 옛 번호 연결 기록을 쓰고 보관은 비어 있다고 알린다.
 */

export interface ManageServerState {
  contactLinks: ContactLinkRecord[];
  fulfillmentItems: FulfillmentItemRecord[];
  alertDays: KeepingAlertDays;
  /** 새 표를 읽었는지. false 면 운영 DB 적용 전이다. */
  serverReady: boolean;
  loadedAt: number | null;
  error: string | null;
}

const EMPTY: ManageServerState = {
  contactLinks: [], fulfillmentItems: [], alertDays: DEFAULT_KEEPING_ALERT_DAYS, serverReady: false, loadedAt: null, error: null,
};

async function loadServerState(workspaceId: string): Promise<ManageServerState> {
  const legacy = await buyerPhoneLinkService.sync(workspaceId);
  const legacyLinks: ContactLinkRecord[] = Object.entries(legacy).map(([phone, link]) => ({
    phone, nickname: link.nickname, linkedAt: link.linkedAt, blocked: link.blocked,
  }));
  const alertDays = normalizeKeepingAlertDays(
    await remoteWorkspaceService.fetchWorkspaceSettings(workspaceId, KEEPING_ALERT_DAYS_SETTING).catch(() => null),
  );
  if (!isSupabaseConfigured) return { ...EMPTY, contactLinks: legacyLinks, alertDays, loadedAt: Date.now() };
  const client = requireSupabase();
  const [contacts, items] = await Promise.all([
    client.from('buyer_contacts').select('phone,buyer_key,nickname,state,linked_at').eq('workspace_id', workspaceId),
    client.from('fulfillment_items')
      .select('sale_id,buyer_key,state,kept_at,shipment_id,cancelled_by,refunded_at')
      .eq('workspace_id', workspaceId),
  ]);
  if (contacts.error || items.error) {
    return { ...EMPTY, contactLinks: legacyLinks, alertDays, loadedAt: Date.now(), error: (contacts.error || items.error)?.message || null };
  }
  const serverLinks: ContactLinkRecord[] = (contacts.data || []).map((row: any) => ({
    phone: row.phone, buyerKey: row.buyer_key, nickname: row.nickname, linkedAt: row.linked_at, blocked: row.state === 'BLOCKED',
  }));
  // 서버 연결이 우선. 옛 기록은 서버에 없는 번호만 보탠다 (옮기기 뒤 새로 생긴 옛 기록).
  const serverPhones = new Set(serverLinks.map((link) => link.phone));
  const contactLinks = [...serverLinks, ...legacyLinks.filter((link) => !serverPhones.has(link.phone.replace(/\D/g, '')))];
  const fulfillmentItems: FulfillmentItemRecord[] = (items.data || []).map((row: any) => ({
    saleId: row.sale_id, buyerKey: row.buyer_key, state: row.state, keptAt: row.kept_at, shipmentId: row.shipment_id,
    cancelledBy: row.cancelled_by, refunded: !!row.refunded_at,
  }));
  return { contactLinks, fulfillmentItems, alertDays, serverReady: true, loadedAt: Date.now(), error: null };
}

export function useManageServerState(reloadKey = 0): ManageServerState {
  const { workspaceId } = useAuth();
  const [state, setState] = useState<ManageServerState & { workspaceId?: string | null }>(EMPTY);
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    loadServerState(workspaceId)
      .then((next) => { if (!cancelled) setState({ ...next, workspaceId }); })
      .catch((error) => { if (!cancelled) setState({ ...EMPTY, workspaceId, error: String(error?.message || error) }); });
    return () => { cancelled = true; };
  }, [workspaceId, reloadKey]);
  // 계정이 바뀌면 이전 계정 값을 보이지 않는다
  return state.workspaceId === workspaceId ? state : EMPTY;
}

export function useManageDashboard(periodDays: number, reloadKey = 0): { dashboard: ManageDashboard; server: ManageServerState } {
  const { workspaceId } = useAuth();
  const { sales } = useSales();
  const commerce = useCommerce();
  const server = useManageServerState(reloadKey);
  const dashboard = useMemo(() => buildManageDashboard({
    sales,
    invoices: commerce.invoices.map((invoice) => ({
      id: invoice.id, status: invoice.status, saleIds: invoice.saleIds, buyerNickname: invoice.customerNickname,
      createdAt: invoice.createdAt,
    })),
    payments: commerce.payments,
    messages: commerce.messages.map((message) => ({
      phone: message.phoneNumber, direction: message.direction, body: message.body, receivedAt: message.receivedAt,
    })),
    contactLinks: server.contactLinks,
    fulfillmentItems: server.fulfillmentItems,
    shippingConfig: shippingService.getConfig(workspaceId),
    getOverride: (nickname, sessionId) => shippingService.getOverride(nickname, sessionId, workspaceId),
    alertDays: server.alertDays,
    now: new Date(),
    periodDays,
  }), [sales, commerce.invoices, commerce.payments, commerce.messages, server, workspaceId, periodDays]);
  return { dashboard, server };
}
