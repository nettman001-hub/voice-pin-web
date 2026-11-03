import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { shippingService } from '../shippingService';
import { remoteWorkspaceService } from '../remoteWorkspaceService';
import { isSupabaseConfigured, requireSupabase } from '../supabaseClient';
import type { ContactLinkRecord } from './contactLink';
import {
  DEFAULT_KEEPING_ALERT_DAYS, KEEPING_ALERT_DAYS_SETTING, normalizeKeepingAlertDays,
  type FulfillmentItemRecord, type KeepingAlertDays,
} from './fulfillment';
import { buildManageDashboard, type ManageDashboard } from './dashboard';
import { CONTACT_COLUMNS, FULFILLMENT_COLUMNS, contactLinksFromRows, fulfillmentItemsFromRows, type ManageSummary } from './manageSummary';
import { ManageApi } from './manageApi';

/**
 * 관리 화면이 읽는 값. 쓰기는 manageApi(서버)로만 한다.
 * 연락처·보관은 서버 표(buyer_contacts, fulfillment_items)만 읽는다. 옛 기록은 쓰지 않는다 (2026-11-03 사용자 규칙).
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
  const alertDays = normalizeKeepingAlertDays(
    await remoteWorkspaceService.fetchWorkspaceSettings(workspaceId, KEEPING_ALERT_DAYS_SETTING).catch(() => null),
  );
  if (!isSupabaseConfigured) return { ...EMPTY, alertDays, loadedAt: Date.now() };
  const client = requireSupabase();
  const [contacts, items] = await Promise.all([
    client.from('buyer_contacts').select(CONTACT_COLUMNS).eq('workspace_id', workspaceId),
    client.from('fulfillment_items').select(FULFILLMENT_COLUMNS)
      .eq('workspace_id', workspaceId),
  ]);
  if (contacts.error || items.error) {
    return { ...EMPTY, alertDays, loadedAt: Date.now(), error: (contacts.error || items.error)?.message || null };
  }
  const contactLinks = contactLinksFromRows(contacts.data || []);
  const fulfillmentItems = fulfillmentItemsFromRows(items.data || []);
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

const SUMMARY_REFRESH_DELAY_MS = 3000;

/**
 * 관리 홈 서버 요약. 폰이 판매를 다 받기 전에도 숫자를 바로 보여 준다.
 * 판매·정산서·입금·문자가 바뀌면 3초 뒤 다시 받는다. 못 받으면 summary 는 null (폰 계산을 쓴다).
 */
export function useManageHomeSummary(periodDays: number, reloadKey = 0): { summary: ManageSummary | null; error: string | null } {
  const { workspaceId } = useAuth();
  const { sales } = useSales();
  const commerce = useCommerce();
  const api = useMemo(() => (workspaceId && isSupabaseConfigured ? new ManageApi(workspaceId) : null), [workspaceId]);
  const [state, setState] = useState<{ key: string; summary: ManageSummary | null; error: string | null }>({ key: '', summary: null, error: null });
  const [changeTick, setChangeTick] = useState(0);
  const key = `${workspaceId}:${periodDays}`;

  const changes = useRef(0);
  useEffect(() => {
    // 첫 그리기는 아래 요청이 맡는다. 이후 바뀐 것만 모아서 한 번 다시 받는다.
    if (changes.current++ === 0) return undefined;
    const timer = setTimeout(() => setChangeTick((value) => value + 1), SUMMARY_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sales, commerce.invoices, commerce.payments, commerce.messages]);

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    api.summary(periodDays)
      .then((summary) => { if (!cancelled) setState({ key, summary, error: null }); })
      .catch((error) => {
        if (!cancelled) setState((prev) => ({ key, summary: prev.key === key ? prev.summary : null, error: String(error?.message || error) }));
      });
    return () => { cancelled = true; };
  }, [api, key, periodDays, reloadKey, changeTick]);

  return state.key === key ? { summary: state.summary, error: state.error } : { summary: null, error: null };
}
