import { CommerceState, CustomerPurchaseClaim, PaymentReceipt, SettlementInvoice, Shipment, SmsMessage } from '../types/commerce';
import { SaleRecord } from '../types/live';
import { User } from '../types/auth';
import { AdminSaleItem, SellerSttUsageSummary, SttUsageLogItem, SttUsageRecordPayload } from '../types/admin';
import { isSupabaseConfigured, requireSupabase } from './supabaseClient';

type Row = Record<string, any>;

const imageUrl = async (value: string) => {
  if (!value || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value;
  const { data, error } = await requireSupabase().storage.from('voicecap-private').createSignedUrl(value, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
};

const imageUrls = async (values: unknown) => Promise.all((Array.isArray(values) ? values : []).map((value) => imageUrl(String(value))));

const mapSale = async (row: Row): Promise<SaleRecord> => {
  const storagePaths = Array.isArray(row.capture_image_paths) ? row.capture_image_paths.map(String) : [];
  return {
    id: row.id,
    sessionId: row.session_id,
    buyerNickname: row.buyer_nickname,
    amount: row.amount,
    recognizedAt: row.recognized_at,
    rawTranscript: row.raw_transcript,
    status: row.status,
    productName: row.product_name || undefined,
    captureImageUrls: await imageUrls(storagePaths),
    note: row.note || undefined,
    printStatus: row.print_status || 'NOT_REQUESTED',
    printRevision: Number(row.print_revision || 0),
    printedAt: row.printed_at || undefined,
    printError: row.print_error || undefined,
    __voicecapStoragePaths: storagePaths,
  } as SaleRecord;
};

const persistImages = async (workspaceId: string, entity: string, references: string[]) => {
  const client = requireSupabase();
  return Promise.all(references.map(async (reference, index) => {
    if (!reference.startsWith('data:')) return reference;
    const response = await fetch(reference);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 4 * 1024 * 1024) throw new Error('캡처 이미지는 4MB 이하의 이미지 파일이어야 합니다.');
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png';
    const path = `${workspaceId}/${entity}/${crypto.randomUUID()}-${index}.${extension}`;
    const { error } = await client.storage.from('voicecap-private').upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw error;
    return path;
  }));
};

const toSaleRow = async (workspaceId: string, sale: SaleRecord) => ({
  id: sale.id,
  workspace_id: workspaceId,
  session_id: sale.sessionId,
  buyer_nickname: sale.buyerNickname,
  amount: sale.amount,
  recognized_at: sale.recognizedAt,
  raw_transcript: sale.rawTranscript,
  status: sale.status,
  product_name: sale.productName || null,
  capture_image_paths: await persistImages(
    workspaceId,
    `sales/${sale.id}`,
    (sale.captureImageUrls || []).map((value, index) =>
      value.startsWith('data:') ? value : ((sale as SaleRecord & { __voicecapStoragePaths?: string[] }).__voicecapStoragePaths?.[index] || value)
    ),
  ),
  note: sale.note || null,
  print_status: sale.printStatus || 'NOT_REQUESTED',
  print_revision: sale.printRevision || 0,
  printed_at: sale.printedAt || null,
  print_error: sale.printError || null,
});

const withoutPrintMetadata = (row: Row) => {
  const { print_status, print_revision, printed_at, print_error, ...legacyRow } = row;
  return legacyRow;
};

const isMissingPrintColumnError = (error: { code?: string; message?: string } | null) => (
  error?.code === 'PGRST204'
  && /print_(status|revision|error)|printed_at/i.test(String(error.message || ''))
);

const mapMessage = async (row: Row, workspaceId: string): Promise<SmsMessage> => ({
  id: row.id,
  sellerId: workspaceId,
  externalId: row.external_id || undefined,
  phoneNumber: row.phone_number,
  body: row.body,
  direction: row.direction,
  category: row.category,
  status: row.status,
  saleIds: Array.isArray(row.sale_ids) ? row.sale_ids.map(String) : [],
  attachments: await Promise.all((Array.isArray(row.attachments) ? row.attachments : []).map(async (attachment: Row) => ({
    id: attachment.id,
    mimeType: attachment.mimeType,
    fileName: attachment.fileName,
    dataUrl: attachment.path ? await imageUrl(attachment.path) : attachment.dataUrl,
    path: attachment.path,
  }))),
  createdAt: row.created_at,
  receivedAt: row.received_at || undefined,
  sentAt: row.sent_at || undefined,
  error: row.error || undefined,
});

const mapClaim = async (row: Row): Promise<CustomerPurchaseClaim> => {
  const storagePaths = Array.isArray(row.capture_image_paths) ? row.capture_image_paths.map(String) : [];
  return {
    id: row.id,
    messageId: row.message_id,
    phoneNumber: row.phone_number,
    nickname: row.nickname,
    address: row.address,
    productName: row.product_name,
    amount: row.amount,
    captureImageUrls: await imageUrls(storagePaths),
    saleIds: Array.isArray(row.sale_ids) ? row.sale_ids.map(String) : [],
    matchStatus: row.match_status,
    fieldMatches: row.field_matches || {},
    sellerNote: row.seller_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    __voicecapStoragePaths: storagePaths,
  } as CustomerPurchaseClaim;
};

const mapInvoice = (row: Row): SettlementInvoice => ({
  id: row.id,
  saleIds: Array.isArray(row.sale_ids) ? row.sale_ids.map(String) : [],
  customerNickname: row.customer_nickname,
  phoneNumber: row.phone_number,
  address: row.address,
  amount: row.amount,
  bankAccount: row.bank_account,
  dueDate: row.due_date,
  status: row.status,
  createdAt: row.created_at,
  sentAt: row.sent_at || undefined,
  smsMessageId: row.sms_message_id || undefined,
});

const mapPayment = (row: Row, workspaceId: string): PaymentReceipt => ({
  id: row.id,
  sellerId: workspaceId,
  externalId: row.external_id || undefined,
  payerName: row.payer_name,
  amount: row.amount,
  paidAt: row.paid_at,
  memo: row.memo || undefined,
  saleIds: Array.isArray(row.sale_ids) ? row.sale_ids.map(String) : [],
  invoiceId: row.invoice_id || undefined,
  matchStatus: row.match_status,
  createdAt: row.created_at,
});

const mapShipment = (row: Row): Shipment => ({
  id: row.id,
  saleIds: Array.isArray(row.sale_ids) ? row.sale_ids.map(String) : [],
  recipientName: row.recipient_name,
  phoneNumber: row.phone_number,
  address: row.address,
  carrier: row.carrier,
  trackingNumber: row.tracking_number,
  status: row.status,
  memo: row.memo,
  createdAt: row.created_at,
  shippedAt: row.shipped_at || undefined,
  deliveredAt: row.delivered_at || undefined,
  smsMessageId: row.sms_message_id || undefined,
});

const ensureEnabled = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase가 설정되지 않았습니다.');
  return requireSupabase();
};

export const remoteWorkspaceService = {
  enabled: isSupabaseConfigured,

  /**
   * VoiceCAP 클라우드 서버에 등록된 실제 판매자 목록을 조회합니다.
   * 타 서비스(sermon-guide-db)와의 데이터 섞임을 원천 차단하기 위해
   * VoiceCAP 전용 workspace_members 및 auth_app: 'voicecap' 메타데이터만 엄격히 선별합니다.
   */
  async fetchVoicecapSellers(): Promise<User[]> {
    if (!isSupabaseConfigured) return [];
    const client = requireSupabase();

    const { data, error } = await client.functions.invoke('voicecap-onboard', {
      body: { action: 'list-voicecap-sellers' },
    });
    if (error) throw new Error(`클라우드 회원 조회 실패: ${error.message}`);
    if (!data?.ok) throw new Error(data?.error || '클라우드 회원 조회 응답이 올바르지 않습니다.');
    if (!Array.isArray(data.sellers)) throw new Error('클라우드 회원 목록 형식이 올바르지 않습니다.');

    return data.sellers.map((s: any) => ({
      id: s.id,
      email: s.email,
      nickname: s.nickname || s.email?.split('@')[0] || '판매자',
      role: s.role || '판매자',
      status: s.status || '활성',
      suspendedReason: s.suspendedReason || undefined,
      createdAt: s.createdAt || new Date().toISOString().slice(0, 10),
      subscriptionPlan: s.subscriptionPlan || '프로',
      subscriptionExpiresAt: s.subscriptionExpiresAt || undefined,
      isTrial: s.isTrial !== false,
      phone: s.phone || undefined,
      isCloudUser: true,
      workspaceName: s.workspaceName || undefined,
      allowAdminSttKey: Boolean(s.allowAdminSttKey),
    }));
  },

  async setVoicecapSellerSttAccess(userId: string, allow: boolean): Promise<void> {
    const { data, error } = await ensureEnabled().functions.invoke('voicecap-onboard', {
      body: { action: 'set-stt-access', userId, allow },
    });
    if (error) throw new Error(`STT 지원 권한 저장 실패: ${error.message}`);
    if (!data?.ok) throw new Error(data?.error || 'STT 지원 권한을 저장하지 못했습니다.');
  },

  async setVoicecapMemberStatus(userId: string, status: '활성' | '정지', reason?: string): Promise<void> {
    const { data, error } = await ensureEnabled().functions.invoke('voicecap-onboard', {
      body: { action: 'set-member-status', userId, status, reason },
    });
    if (error) throw new Error(`회원 상태 저장 실패: ${error.message}`);
    if (!data?.ok) throw new Error(data?.error || '회원 상태를 저장하지 못했습니다.');
  },

  async fetchGlobalSttSettings(): Promise<{
    configured: boolean;
    provider: 'DEEPGRAM' | 'SONIOX';
    allowed: boolean;
    hasDeepgramApiKey: boolean;
    hasSonioxApiKey: boolean;
    deepgramApiKey: string;
    sonioxApiKey: string;
  }> {
    const { data, error } = await ensureEnabled().functions.invoke('voicecap-onboard', {
      body: { action: 'get-stt-settings' },
    });
    if (error) throw new Error(`공용 STT 설정 조회 실패: ${error.message}`);
    if (!data?.ok || !data.settings) throw new Error(data?.error || '공용 STT 설정을 조회하지 못했습니다.');
    return data.settings;
  },

  async saveGlobalSttSettings(settings: {
    provider: 'DEEPGRAM' | 'SONIOX';
    deepgramApiKey: string;
    sonioxApiKey: string;
  }): Promise<void> {
    const { data, error } = await ensureEnabled().functions.invoke('voicecap-onboard', {
      body: { action: 'set-stt-settings', ...settings },
    });
    if (error) throw new Error(`공용 STT 설정 저장 실패: ${error.message}`);
    if (!data?.ok) throw new Error(data?.error || '공용 STT 설정을 저장하지 못했습니다.');
  },

  /**
   * 관리자 전용: VoiceCAP 전체 판매자의 판매 내역을 조회합니다.
   * 타 서비스(sermon-guide-db)와 완벽히 격리된 데이터만 반환합니다.
   */
  async fetchAllSalesForAdmin(): Promise<AdminSaleItem[]> {
    if (!isSupabaseConfigured) return [];
    const client = requireSupabase();

    // 1차 시도: Edge Function voicecap-onboard (list-all-sales)
    try {
      const { data, error } = await client.functions.invoke('voicecap-onboard', {
        body: { action: 'list-all-sales' },
      });
      if (!error && data?.ok && Array.isArray(data.sales)) {
        return data.sales.map((s: any) => ({
          id: s.id,
          workspaceId: s.workspace_id || s.workspaceId,
          workspaceName: s.workspaceName || 'VoiceCAP 작업공간',
          sellerUserId: s.sellerUserId || s.seller_user_id || '',
          sellerEmail: s.sellerEmail || s.seller_email || '',
          sellerNickname: s.sellerNickname || s.seller_nickname || '판매자',
          sessionId: s.session_id || s.sessionId,
          buyerNickname: s.buyer_nickname || s.buyerNickname,
          amount: Number(s.amount || 0),
          recognizedAt: s.recognized_at || s.recognizedAt,
          rawTranscript: s.raw_transcript || s.rawTranscript || '',
          status: s.status || '확정',
          productName: s.product_name || s.productName || undefined,
          note: s.note || undefined,
          printStatus: s.print_status || s.printStatus || 'NOT_REQUESTED',
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
        }));
      }
    } catch (efErr) {
      console.warn('[RemoteWorkspace] Edge function list-all-sales failed, trying RPC fallback:', efErr);
    }

    // 2차 시도: Postgres RPC get_admin_all_sales
    try {
      const { data, error } = await client.rpc('get_admin_all_sales');
      if (!error && Array.isArray(data)) {
        return data.map((s: any) => ({
          id: s.id,
          workspaceId: s.workspace_id,
          workspaceName: s.workspace_name,
          sellerUserId: s.seller_user_id,
          sellerEmail: s.seller_email,
          sellerNickname: s.seller_nickname,
          sessionId: s.session_id,
          buyerNickname: s.buyer_nickname,
          amount: Number(s.amount || 0),
          recognizedAt: s.recognized_at,
          rawTranscript: s.raw_transcript || '',
          status: s.status || '확정',
          productName: s.product_name || undefined,
          note: s.note || undefined,
          printStatus: s.print_status || 'NOT_REQUESTED',
          createdAt: s.created_at,
        }));
      }
    } catch (rpcErr) {
      console.warn('[RemoteWorkspace] RPC get_admin_all_sales failed:', rpcErr);
    }

    return [];
  },

  /**
   * 판매자 라이브 청취 종료 시 클라우드 STT(Deepgram, Soniox) 사용 시간을 Supabase에 기록합니다.
   */
  async recordSttUsage(payload: SttUsageRecordPayload): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      await requireSupabase().functions.invoke('voicecap-onboard', {
        body: { action: 'record-stt-usage', ...payload },
      });
    } catch (err) {
      console.warn('[RemoteWorkspace] STT 사용량 기록 전송 실패 (무시):', err);
    }
  },

  /**
   * 관리자 전용: 판매자별 클라우드 STT(Deepgram, Soniox) 누적 사용 시간 통계를 조회합니다.
   */
  async fetchSttUsageSummary(): Promise<SellerSttUsageSummary[]> {
    if (!isSupabaseConfigured) return [];
    const client = requireSupabase();

    // 1차 시도: Edge Function
    try {
      const { data, error } = await client.functions.invoke('voicecap-onboard', {
        body: { action: 'list-stt-usage-summary' },
      });
      if (!error && data?.ok && Array.isArray(data.summary)) {
        return data.summary;
      }
    } catch (efErr) {
      console.warn('[RemoteWorkspace] list-stt-usage-summary edge function failed:', efErr);
    }

    // 2차 시도: RPC
    try {
      const { data, error } = await client.rpc('get_admin_stt_usage_summary');
      if (!error && Array.isArray(data)) {
        return data.map((d: any) => ({
          userId: d.user_id,
          email: d.email,
          nickname: d.nickname,
          workspaceId: d.workspace_id,
          workspaceName: d.workspace_name,
          deepgramSeconds: Number(d.deepgram_seconds || 0),
          sonioxSeconds: Number(d.soniox_seconds || 0),
          totalSeconds: Number(d.total_seconds || 0),
          sessionCount: Number(d.session_count || 0),
          lastUsedAt: d.last_used_at || null,
        }));
      }
    } catch (rpcErr) {
      console.warn('[RemoteWorkspace] get_admin_stt_usage_summary RPC failed:', rpcErr);
    }

    return [];
  },

  /**
   * 관리자 전용: 특정 회원의 세부 클라우드 STT 사용 로그를 조회합니다.
   */
  async fetchSttUsageLogs(userId: string): Promise<SttUsageLogItem[]> {
    if (!isSupabaseConfigured || !userId) return [];
    const client = requireSupabase();

    // 1차 시도: Edge Function
    try {
      const { data, error } = await client.functions.invoke('voicecap-onboard', {
        body: { action: 'list-stt-usage-logs', userId },
      });
      if (!error && data?.ok && Array.isArray(data.logs)) {
        return data.logs.map((l: any) => ({
          id: l.id,
          sessionId: l.session_id || l.sessionId,
          provider: l.provider,
          durationSeconds: Number(l.duration_seconds || l.durationSeconds || 0),
          startedAt: l.started_at || l.startedAt,
          endedAt: l.ended_at || l.endedAt,
          createdAt: l.created_at || l.createdAt,
        }));
      }
    } catch (efErr) {
      console.warn('[RemoteWorkspace] list-stt-usage-logs edge function failed:', efErr);
    }

    // 2차 시도: RPC
    try {
      const { data, error } = await client.rpc('get_admin_stt_usage_logs', { target_user_id: userId });
      if (!error && Array.isArray(data)) {
        return data.map((l: any) => ({
          id: l.id,
          sessionId: l.session_id,
          provider: l.provider,
          durationSeconds: Number(l.duration_seconds || 0),
          startedAt: l.started_at,
          endedAt: l.ended_at,
          createdAt: l.created_at,
        }));
      }
    } catch (rpcErr) {
      console.warn('[RemoteWorkspace] get_admin_stt_usage_logs RPC failed:', rpcErr);
    }

    return [];
  },

  async loadSales(workspaceId: string) {
    const { data, error } = await ensureEnabled().from('sales').select('*').eq('workspace_id', workspaceId).order('recognized_at', { ascending: false });
    if (error) throw error;
    return Promise.all((data || []).map(mapSale));
  },

  async saveSale(workspaceId: string, sale: SaleRecord) {
    const row = await toSaleRow(workspaceId, sale);
    const { error } = await ensureEnabled().from('sales').upsert(row);
    if (!error) return;
    // 운영 DB에 SQL 마이그레이션을 적용하기 전에도 기존 판매 저장 자체는 멈추지 않게 한다.
    // 출력 상태만 현재 컴퓨터의 로컬 저장소에 남고, 마이그레이션 적용 뒤에는 자동으로 공유된다.
    if (isMissingPrintColumnError(error)) {
      const { error: legacyError } = await ensureEnabled().from('sales').upsert(withoutPrintMetadata(row));
      if (!legacyError) return;
      throw legacyError;
    }
    throw error;
  },

  async deleteSale(workspaceId: string, id: string) {
    const { error } = await ensureEnabled().from('sales').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) throw error;
  },

  async loadCommerce(workspaceId: string): Promise<CommerceState> {
    const client = ensureEnabled();
    const [messagesResult, claimsResult, invoicesResult, paymentsResult, shipmentsResult, verifiedResult] = await Promise.all([
      client.from('customer_messages').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      client.from('purchase_claims').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      client.from('invoices').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      client.from('payment_receipts').select('*').eq('workspace_id', workspaceId).order('paid_at', { ascending: false }),
      client.from('shipments').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      client.from('verified_sales').select('sale_id').eq('workspace_id', workspaceId),
    ]);
    const error = [messagesResult, claimsResult, invoicesResult, paymentsResult, shipmentsResult, verifiedResult].find((result) => result.error)?.error;
    if (error) throw error;
    return {
      messages: await Promise.all((messagesResult.data || []).map((row) => mapMessage(row, workspaceId))),
      claims: await Promise.all((claimsResult.data || []).map(mapClaim)),
      invoices: (invoicesResult.data || []).map(mapInvoice),
      payments: (paymentsResult.data || []).map((row) => mapPayment(row, workspaceId)),
      shipments: (shipmentsResult.data || []).map(mapShipment),
      verifiedSaleIds: (verifiedResult.data || []).map((row) => row.sale_id),
    };
  },

  async saveCommerce(workspaceId: string, state: CommerceState) {
    const client = ensureEnabled();
    const messages = state.messages.map((message) => ({
      id: message.id, workspace_id: workspaceId, external_id: message.externalId || null,
      phone_number: message.phoneNumber, body: message.body, direction: message.direction, category: message.category,
      status: message.status, sale_ids: message.saleIds, attachments: message.attachments.map((attachment) => ({
        id: attachment.id, mimeType: attachment.mimeType, fileName: attachment.fileName, path: attachment.path,
      })), received_at: message.receivedAt || null, sent_at: message.sentAt || null,
      error: message.error || null, created_at: message.createdAt,
    }));
    const claims = await Promise.all(state.claims.map(async (claim) => ({
      id: claim.id, workspace_id: workspaceId, message_id: claim.messageId, phone_number: claim.phoneNumber,
      nickname: claim.nickname, address: claim.address, product_name: claim.productName, amount: claim.amount,
      capture_image_paths: await persistImages(
        workspaceId,
        `claims/${claim.id}`,
        (claim.captureImageUrls || []).map((value, index) =>
          value.startsWith('data:') ? value : ((claim as CustomerPurchaseClaim & { __voicecapStoragePaths?: string[] }).__voicecapStoragePaths?.[index] || value)
        )
      ), sale_ids: claim.saleIds,
      match_status: claim.matchStatus, field_matches: claim.fieldMatches, seller_note: claim.sellerNote,
      created_at: claim.createdAt, updated_at: claim.updatedAt,
    })));
    const invoices = state.invoices.map((invoice) => ({
      id: invoice.id, workspace_id: workspaceId, sale_ids: invoice.saleIds, customer_nickname: invoice.customerNickname,
      phone_number: invoice.phoneNumber, address: invoice.address, amount: invoice.amount, bank_account: invoice.bankAccount,
      due_date: invoice.dueDate, status: invoice.status, sent_at: invoice.sentAt || null, sms_message_id: invoice.smsMessageId || null,
      created_at: invoice.createdAt,
    }));
    const payments = state.payments.map((payment) => ({
      id: payment.id, workspace_id: workspaceId, external_id: payment.externalId || null, payer_name: payment.payerName,
      amount: payment.amount, paid_at: payment.paidAt, memo: payment.memo || null, sale_ids: payment.saleIds,
      invoice_id: payment.invoiceId || null, match_status: payment.matchStatus, created_at: payment.createdAt,
    }));
    const shipments = state.shipments.map((shipment) => ({
      id: shipment.id, workspace_id: workspaceId, sale_ids: shipment.saleIds, recipient_name: shipment.recipientName,
      phone_number: shipment.phoneNumber, address: shipment.address, carrier: shipment.carrier,
      tracking_number: shipment.trackingNumber, status: shipment.status, memo: shipment.memo,
      shipped_at: shipment.shippedAt || null, delivered_at: shipment.deliveredAt || null,
      sms_message_id: shipment.smsMessageId || null, created_at: shipment.createdAt,
    }));
    const writes: PromiseLike<unknown>[] = [];
    if (messages.length) writes.push(client.from('customer_messages').upsert(messages));
    if (claims.length) writes.push(client.from('purchase_claims').upsert(claims));
    if (invoices.length) writes.push(client.from('invoices').upsert(invoices));
    if (payments.length) writes.push(client.from('payment_receipts').upsert(payments));
    if (shipments.length) writes.push(client.from('shipments').upsert(shipments));
    if (state.verifiedSaleIds.length) writes.push(client.from('verified_sales').upsert(state.verifiedSaleIds.map((saleId) => ({ workspace_id: workspaceId, sale_id: saleId }))));
    const { data: existingVerified, error: existingVerifiedError } = await client
      .from('verified_sales')
      .select('sale_id')
      .eq('workspace_id', workspaceId);
    if (existingVerifiedError) throw existingVerifiedError;
    const desiredVerified = new Set(state.verifiedSaleIds);
    const staleVerified = (existingVerified || []).map((row) => row.sale_id).filter((saleId) => !desiredVerified.has(saleId));
    if (staleVerified.length) writes.push(client.from('verified_sales').delete().eq('workspace_id', workspaceId).in('sale_id', staleVerified));
    const results: any[] = await Promise.all(writes);
    const error = results.find((result) => result?.error)?.error;
    if (error) throw error;
  },

  subscribe(workspaceId: string, callback: () => void) {
    const channel = ensureEnabled().channel(`workspace:${workspaceId}:commerce:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `workspace_id=eq.${workspaceId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_messages', filter: `workspace_id=eq.${workspaceId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_claims', filter: `workspace_id=eq.${workspaceId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `workspace_id=eq.${workspaceId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_receipts', filter: `workspace_id=eq.${workspaceId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments', filter: `workspace_id=eq.${workspaceId}` }, callback)
      .subscribe();
    return () => { void ensureEnabled().removeChannel(channel); };
  },
};
