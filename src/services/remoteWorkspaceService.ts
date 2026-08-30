import { CommerceState, CustomerPurchaseClaim, PaymentReceipt, SettlementInvoice, Shipment, SmsMessage } from '../types/commerce';
import { SaleRecord } from '../types/live';
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
});

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

  async loadSales(workspaceId: string) {
    const { data, error } = await ensureEnabled().from('sales').select('*').eq('workspace_id', workspaceId).order('recognized_at', { ascending: false });
    if (error) throw error;
    return Promise.all((data || []).map(mapSale));
  },

  async saveSale(workspaceId: string, sale: SaleRecord) {
    const { error } = await ensureEnabled().from('sales').upsert(await toSaleRow(workspaceId, sale));
    if (error) throw error;
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
