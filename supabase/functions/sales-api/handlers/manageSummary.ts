import {
  admin,
  successResponse,
  errorResponse,
  type AuthContext,
} from '../../_shared/productSales.ts';
import {
  buildManageSummary, contactLinksFromRows, fulfillmentItemsFromRows, normalizeSummaryPeriod, overrideLookup,
  summaryInvoiceFromRow, summaryMessageFromRow, summaryPaymentFromRow, summarySaleFromRow,
  CONTACT_COLUMNS, FULFILLMENT_COLUMNS, SUMMARY_INVOICE_COLUMNS, SUMMARY_MESSAGE_COLUMNS, SUMMARY_PAYMENT_COLUMNS,
  SUMMARY_SALE_COLUMNS,
} from '../../../../src/services/manage/manageSummary.ts';
import { KEEPING_ALERT_DAYS_SETTING, normalizeKeepingAlertDays } from '../../../../src/services/manage/fulfillment.ts';
import { DEFAULT_SHIPPING_CONFIG } from '../../../../src/services/shippingDefaults.ts';
import { cleanMessageBody } from '../../../../src/utils/textCleaner.ts';

const PAGE = 1000;

/** 한 표를 끝까지 읽는다 (PostgREST 1,000행 제한 때문에 나눠 읽음). */
async function readAll(table: string, columns: string, workspaceId: string, orderBy: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.from(table).select(columns).eq('workspace_id', workspaceId)
      .order(orderBy, { ascending: false }).range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data || []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function readSetting(workspaceId: string, namespace: string) {
  const { data, error } = await admin.from('workspace_settings').select('value')
    .eq('workspace_id', workspaceId).eq('namespace', namespace).maybeSingle();
  if (error) throw error;
  return (data?.value ?? null) as any;
}

/** 관리 홈 숫자 (읽기만). 폰 계산과 같은 buildManageDashboard 를 서버에서 돌려 결과만 보낸다. */
export async function handleManageSummary(auth: AuthContext, body: Record<string, unknown>) {
  if (auth.actorType !== 'USER') {
    return errorResponse('CAPABILITY_DENIED', '판매자 로그인으로만 볼 수 있습니다.', 403);
  }
  const periodDays = normalizeSummaryPeriod(body.periodDays);
  if (periodDays === null) return errorResponse('VALIDATION_ERROR', '기간을 다시 골라 주세요.', 400, { field: 'periodDays' });
  const workspaceId = auth.workspaceId;
  try {
    const [sales, invoices, payments, messages, contacts, items, shipping, overrides, alertRaw] = await Promise.all([
      readAll('sales', SUMMARY_SALE_COLUMNS, workspaceId, 'recognized_at'),
      readAll('invoices', SUMMARY_INVOICE_COLUMNS, workspaceId, 'created_at'),
      readAll('payment_receipts', SUMMARY_PAYMENT_COLUMNS, workspaceId, 'paid_at'),
      readAll('customer_messages', SUMMARY_MESSAGE_COLUMNS, workspaceId, 'created_at'),
      readAll('buyer_contacts', CONTACT_COLUMNS, workspaceId, 'linked_at'),
      readAll('fulfillment_items', FULFILLMENT_COLUMNS, workspaceId, 'sale_id'),
      readSetting(workspaceId, 'shipping_config'),
      readSetting(workspaceId, 'buyer_shipping_overrides'),
      readSetting(workspaceId, KEEPING_ALERT_DAYS_SETTING),
    ]);
    const now = new Date();
    const summary = buildManageSummary({
      sales: sales.map(summarySaleFromRow),
      invoices: invoices.map(summaryInvoiceFromRow),
      payments: payments.map(summaryPaymentFromRow),
      messages: messages.map((row) => summaryMessageFromRow(row, cleanMessageBody)),
      contactLinks: contactLinksFromRows(contacts),
      fulfillmentItems: fulfillmentItemsFromRows(items),
      shippingConfig: { ...DEFAULT_SHIPPING_CONFIG, ...(shipping || {}) },
      getOverride: overrideLookup(overrides),
      alertDays: normalizeKeepingAlertDays(alertRaw),
      now,
      periodDays,
    });
    return successResponse(summary);
  } catch (_error) {
    return errorResponse('DATABASE_ERROR', '관리 홈 숫자를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.', 500, {}, true);
  }
}
