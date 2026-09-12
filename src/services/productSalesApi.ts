import { isSupabaseConfigured, requireSupabase } from './supabaseClient';
import type {
  ProductSalesSettings,
  LiveSession,
  Product,
  ProductDraft,
  Device,
  Buyer,
  BuyerStats,
  LiveComment,
  Sale,
  PrintJob,
  SessionSummary,
  CommonApiResponse,
  DeviceCapability,
  ImageKind
} from '../types/productSales';

async function invokeSalesApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase client is not configured.');
  }

  const { data, error } = await requireSupabase().functions.invoke<CommonApiResponse<T>>('sales-api', {
    body: { action, ...payload },
  });

  if (error) {
    throw new Error(error.message || 'sales-api invocation error');
  }

  if (!data?.ok) {
    const err = data?.error;
    const errorObj = new Error(err?.message || 'sales-api request failed');
    (errorObj as unknown as { code?: string; details?: unknown }).code = err?.code;
    (errorObj as unknown as { details?: unknown }).details = err?.details;
    throw errorObj;
  }

  return data.data as T;
}

export const productSalesApi = {
  async getBootstrap(workspaceId?: string) {
    return invokeSalesApi<{
      workspaceId: string;
      settings: ProductSalesSettings;
      activeSession: LiveSession | null;
      activeProduct: Product | null;
      printerStatus: { outputDeviceId: string | null; outputDeviceName: string | null; online: boolean; queuedJobsCount: number };
      permissions: string[];
    }>('get-bootstrap', { workspaceId });
  },

  async updateSettings(operationId: string, expectedRevision: number, settings: Partial<ProductSalesSettings>) {
    return invokeSalesApi<{ settings: ProductSalesSettings }>('update-settings', {
      operationId,
      expectedRevision,
      settings,
    });
  },

  async listDevices(cursor?: string, limit = 50) {
    return invokeSalesApi<{ devices: Device[]; nextCursor: string | null }>('list-devices', { cursor, limit });
  },

  async updateDeviceCapabilities(operationId: string, deviceId: string, expectedDeviceRevision: number, capabilities: DeviceCapability[]) {
    return invokeSalesApi<{ device: Device; auditLogId: string }>('update-device-capabilities', {
      operationId,
      deviceId,
      expectedDeviceRevision,
      capabilities,
    });
  },

  async setOutputDevice(operationId: string, deviceId: string, expectedSettingsRevision: number) {
    return invokeSalesApi<{ outputDevice: Device; settingsRevision: number }>('set-output-device', {
      operationId,
      deviceId,
      expectedSettingsRevision,
    });
  },

  async startSession(operationId: string, displayName?: string) {
    return invokeSalesApi<{ session: LiveSession }>('start-session', { operationId, displayName });
  },

  async endSession(operationId: string, sessionId: string, expectedSessionRevision: number) {
    return invokeSalesApi<{ session: LiveSession }>('end-session', {
      operationId,
      sessionId,
      expectedSessionRevision,
    });
  },

  async prepareProduct(params: {
    operationId: string;
    sessionId: string;
    expectedSessionRevision: number;
    requestedProductCode?: string;
    name?: string;
    unitPrice?: number;
    imageKind: ImageKind;
  }) {
    return invokeSalesApi<{
      draftId: string;
      draftRevision: number;
      productId: string;
      productCode: string;
      imageUpload?: { uploadUrl: string; method: string; headers: Record<string, string>; maxSizeBytes: number };
      expiresAt: string;
    }>('prepare-product', params);
  },

  async updateProductDraft(params: {
    operationId: string;
    draftId: string;
    expectedDraftRevision: number;
    imageKind: ImageKind;
    imageFallbackConfirmed: boolean;
  }) {
    return invokeSalesApi<{ draft: ProductDraft }>('update-product-draft', params);
  },

  async commitProduct(params: {
    operationId: string;
    draftId: string;
    expectedDraftRevision: number;
    expectedSessionRevision: number;
    source?: 'WEB_VOICE' | 'MANUAL';
  }) {
    return invokeSalesApi<{ product: Product; session: LiveSession }>('commit-product', params);
  },

  async activateProduct(operationId: string, sessionId: string, productId: string, expectedSessionRevision: number) {
    return invokeSalesApi<{ session: LiveSession; activeProduct: Product }>('activate-product', {
      operationId,
      sessionId,
      productId,
      expectedSessionRevision,
    });
  },

  async getSalesFeed(params: {
    sessionId: string;
    cursor?: string;
    limit?: number;
    watchedBuyerIds?: string[];
  }) {
    return invokeSalesApi<{
      comments: LiveComment[];
      buyerStats: Record<string, BuyerStats>;
      summary: SessionSummary;
      activeProduct: Product | null;
      sessionRevision: number;
      nextCursor: string | null;
      hasMore: boolean;
    }>('get-sales-feed', params);
  },

  async listLiveComments(params: { sessionId?: string; limit?: number } = {}) {
    return invokeSalesApi<{ comments: LiveComment[] }>('list-live-comments', params);
  },

  async deleteLiveComments(ids: string[]) {
    return invokeSalesApi<{ deletedIds: string[] }>('delete-live-comments', { ids });
  },

  async searchBuyers(query: string, sessionId?: string, limit = 20) {
    return invokeSalesApi<{ buyers: Buyer[]; nextCursor: string | null }>('search-buyers', { query, sessionId, limit });
  },

  async confirmBuyer(params: {
    operationId: string;
    displayNickname: string;
    selectedBuyerId?: string;
    confirmationReason: string;
  }) {
    return invokeSalesApi<{ buyer: Buyer }>('confirm-buyer', params);
  },

  async commitSales(params: {
    operationId: string;
    sessionId: string;
    productId: string;
    expectedProductRevision: number;
    expectedSessionRevision: number;
    buyers: { buyerId: string; quantity: number; sourceCommentIds: string[] }[];
  }) {
    return invokeSalesApi<{
      operationId: string;
      status: 'SUCCEEDED' | 'PROCESSING' | 'FAILED';
      sales: Sale[];
      summary: SessionSummary;
      buyerStats: Record<string, BuyerStats>;
      printJobs: PrintJob[];
    }>('commit-sales', params);
  },

  async getOperation(operationId: string) {
    return invokeSalesApi<{
      operationId: string;
      status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
      result?: unknown;
      error?: unknown;
    }>('get-operation', { operationId });
  },

  async listSessionProducts(sessionId: string, cursor?: string) {
    return invokeSalesApi<{ products: Product[]; nextCursor: string | null }>('list-session-products', { sessionId, cursor });
  },

  async getProductSales(sessionId: string, productId: string) {
    return invokeSalesApi<{
      product: Product;
      sales: Sale[];
      buyers: Record<string, Buyer>;
      salesRevision: number;
    }>('get-product-sales', { sessionId, productId });
  },

  async prepareProductImage(params: {
    operationId: string;
    productId: string;
    expectedProductRevision: number;
    fileName: string;
    mimeType: string;
    size: number;
  }) {
    return invokeSalesApi<{
      imageId: string;
      imageUpload: { uploadUrl: string; method: string; headers: Record<string, string>; maxSizeBytes: number };
      expiresAt: string;
    }>('prepare-product-image', params);
  },

  async previewProductChange(params: {
    productId: string;
    expectedProductRevision: number;
    expectedSalesRevision: number;
    proposedProduct?: { unitPrice?: number; name?: string; imageId?: string };
    proposedSales: {
      saleId?: string;
      expectedRevision?: number;
      buyerId?: string;
      quantity?: number;
      cancelled?: boolean;
      sourceCommentIds?: string[];
    }[];
  }) {
    return invokeSalesApi<{
      previewToken: string;
      expiresAt: string;
      before: { unitPrice: number; salesQuantity: number; salesAmount: number; sessionQuantity: number; sessionAmount: number };
      after: { unitPrice: number; salesQuantity: number; salesAmount: number; sessionQuantity: number; sessionAmount: number };
      diffAmount: number;
      affectedBuyers: {
        buyerId: string;
        displayNickname: string;
        quantity: number;
        oldUnitPrice: number;
        newUnitPrice: number;
        oldAmount: number;
        newAmount: number;
        diffAmount: number;
        newTotalPurchaseCount: number;
        newTotalPurchaseAmount: number;
      }[];
      settlements: { affectedSettlementsCount: number; requiresManualReview: boolean };
    }>('preview-product-change', params);
  },

  async commitProductChange(operationId: string, previewToken: string) {
    return invokeSalesApi<{
      product: Product;
      sales: Sale[];
      summary: SessionSummary;
      buyerStats: Record<string, BuyerStats>;
      printJobs: PrintJob[];
    }>('commit-product-change', { operationId, previewToken });
  },

  async requestReprint(operationId: string, saleId: string, expectedSaleRevision: number, reason: string) {
    return invokeSalesApi<{ printJob: PrintJob }>('request-reprint', {
      operationId,
      saleId,
      expectedSaleRevision,
      reason,
    });
  },

  async getPrintStatus(params: { saleIds?: string[]; jobIds?: string[] }) {
    return invokeSalesApi<{ jobs: PrintJob[] }>('get-print-status', params);
  },
};
