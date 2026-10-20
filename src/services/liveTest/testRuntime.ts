import type { SaleRecord } from '../../types/live';
import { productionRuntime, type WorkspaceRuntime } from '../workspaceRuntime';
import { StorageService } from '../storageService';
import { createCommentSyncService } from '../commentSyncService';
import { createConfirmedBuyerAliases } from '../confirmedBuyerAliases';
import { createCustomerKeepingService } from '../customerKeepingService';
import { createShippingService } from '../shippingService';
import { requireSupabase } from '../supabaseClient';
import { DEFAULT_AI_SETTINGS } from '../../types/aiSettings';
import { readOperationalAiSetting } from '../aiAppliedSettings';
import { normalizeAiSettings } from '../aiSettingsApi';
import { DEFAULT_PRODUCT_SALES_SETTINGS } from '../productSalesDefaults';
import { DEFAULT_COMMENT_CAPTURE_CONFIG } from '../../types/comment';
import type { AppliedSalesWorkflow } from '../../types/salesWorkflow';
import { LocalTestDatabase } from './localTestDatabase';
import { SimulatedCommentSource } from './simulatedCommentSource';
import { createLocalTestRepositories, localOnlyAdapter } from './localTestRepositories';

const runtimes = new Map<string, Promise<WorkspaceRuntime>>();

export function getTestRuntime(sourceWorkspaceId: string, userId: string): Promise<WorkspaceRuntime> {
  const identity = `${userId}:${sourceWorkspaceId}`;
  let existing = runtimes.get(identity);
  if (!existing) {
    existing = createTestRuntime(sourceWorkspaceId, userId).catch(error => { runtimes.delete(identity); throw error; });
    runtimes.set(identity, existing);
  }
  return existing;
}

async function createTestRuntime(sourceWorkspaceId: string, userId: string): Promise<WorkspaceRuntime> {
  const workspaceId = `local-test:${userId}:${sourceWorkspaceId}`;
  const db = new LocalTestDatabase(`${userId}:${sourceWorkspaceId}`);
  await db.restore();
  const storage = new StorageService({ durable: db.durable, webStorage: db.web, channelName: 'voicecap-live-test-sync' });
  storage.setWorkspaceId(workspaceId);
  await storage.restoreWorkspace(workspaceId);
  if (!db.get('initialized', false)) {
    // Copy configuration, never operating sessions, comments, sales or products.
    storage.saveRules(productionRuntime.storageService.getRules());
    const captureArea = productionRuntime.storageService.getCaptureAreaConfig();
    if (captureArea) storage.saveCaptureAreaConfig(captureArea);
    storage.setSttMode(productionRuntime.storageService.getSttMode());
    storage.setLocalSttModel(productionRuntime.storageService.getLocalSttModel());
    storage.setAudioSourceMode('MIC');
    storage.saveSttVocabulary(workspaceId, productionRuntime.storageService.getSttVocabulary(sourceWorkspaceId));
    const settings = productionRuntime.storageService.getBootstrapCache(sourceWorkspaceId)?.settings;
    if (settings) await db.put('product-settings', settings);
    storage.saveCommerceState({ messages: [], claims: [], invoices: [], payments: [], shipments: [], verifiedSaleIds: [] });
    await db.put('initialized', true);
  }
  storage.saveCommentCaptureConfig({ ...DEFAULT_COMMENT_CAPTURE_CONFIG, ...storage.getCommentCaptureConfig(), tiktokUsername: 'test-comments' });
  // Use the current operating configuration without creating a setup step or
  // importing real broadcast records. Every operation in this list is a read.
  const [rules, vocabulary, productSettings] = await Promise.allSettled([
    productionRuntime.remoteWorkspaceService.loadRecognitionRules(sourceWorkspaceId),
    productionRuntime.remoteWorkspaceService.loadSttVocabulary(sourceWorkspaceId),
    productionRuntime.remoteWorkspaceService.fetchWorkspaceSettings(sourceWorkspaceId, 'product_sales'),
  ]);
  if (rules.status === 'fulfilled' && rules.value) storage.saveRules(rules.value);
  if (vocabulary.status === 'fulfilled' && vocabulary.value) storage.saveSttVocabulary(workspaceId, vocabulary.value);
  if (productSettings.status === 'fulfilled' && productSettings.value) {
    await db.put('product-settings', { ...DEFAULT_PRODUCT_SALES_SETTINGS, ...productSettings.value });
  }
  try {
    const setting = await readOperationalAiSetting(requireSupabase());
    if (setting) await db.put('ai-settings', normalizeAiSettings(setting));
  } catch { /* A local test can resume its last settings while disconnected. */ }

  const infer = async (payload: any) => {
    const { data } = await requireSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('로그인 상태를 확인해 주세요.');
    const response = await fetch('/api/live-test-inference', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, sourceWorkspaceId }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.error || '테스트 AI 검토 API에 연결하지 못했습니다.');
    return body.data;
  };
  const repos = createLocalTestRepositories(db, storage, workspaceId, infer,
    () => db.get<AppliedSalesWorkflow | null>('workflow', null));
  // The test DB is authoritative, while the shared UI cache may have been
  // interrupted between an acknowledgement and its last local snapshot.
  const savedSales = await repos.storedSales();
  await storage.updateSalesLocalState(workspaceId, current => {
    const pendingById = new Map(current.pending.map(operation => [operation.id, operation]));
    const rows = new Map<string, SaleRecord>(savedSales.filter(sale => pendingById.get(sale.id)?.kind !== 'DELETE')
      .map(sale => [sale.id, { ...sale, syncStatus: 'SYNCED' as const }]));
    for (const sale of current.records) if (pendingById.get(sale.id)?.kind === 'UPSERT') rows.set(sale.id, sale);
    return { ...current, records: [...rows.values()] };
  });
  const remote = localOnlyAdapter<WorkspaceRuntime['remoteWorkspaceService']>({ ...repos.remote,
    // Credentials/configuration reads use the real authenticated account. Test
    // records never enter this allowlist or a Supabase function request.
    fetchGlobalSttSettings: () => productionRuntime.remoteWorkspaceService.fetchGlobalSttSettings(),
    saveGlobalSttSettings: async (settings: unknown) => db.put('stt-config', settings),
  });
  const product = localOnlyAdapter<WorkspaceRuntime['productSalesApi']>(repos.product);
  const commentSync = createCommentSyncService(storage, product);
  const comments = new SimulatedCommentSource(async request => {
    await db.update<unknown[]>('print-jobs', [], all => [...all, { ...request, simulated: true, printedAt: new Date().toISOString() }]);
  });
  const runtimeStatus = () => {
    const tasks = db.get<any[]>('ai-tasks', []);
    const breaker = (slotNumber: 1 | 2) => ({ slotNumber, isOpen: false, consecutiveFailures: 0, cooldownUntil: null, consecutiveRecoverySuccesses: 0 });
    const breakers = db.get<any>('ai-circuit-breakers', {});
    return { activeSlot: tasks[tasks.length - 1]?.activeSlot || 1, activePrimarySlot: 1,
      slot1CircuitBreaker: breakers.slot1 || breaker(1), slot2CircuitBreaker: breakers.slot2 || breaker(2),
      queuedTaskCount: tasks.filter(t => t.status === 'QUEUED').length, processingTaskCount: tasks.filter(t => t.status === 'PROCESSING').length,
      resolvedTaskCount: tasks.filter(t => t.status === 'RESOLVED').length, insufficientDataTaskCount: tasks.filter(t => t.status === 'INSUFFICIENT_DATA').length,
      failedTaskCount: tasks.filter(t => t.status === 'FAILED').length, checkedAt: new Date().toISOString() };
  };
  const ai = localOnlyAdapter<WorkspaceRuntime['aiSettingsApi']>({ ...repos.ai,
    getAiRuntimeStatus: async () => ({ runtimeStatus: runtimeStatus() }),
    getAiStatusSummary: async () => ({ runtimeStatus: runtimeStatus(), healthSummary: { slot1: null, slot2: null }, settings: db.get('ai-settings', DEFAULT_AI_SETTINGS) }),
    getAiSettings: async () => db.get('ai-settings', DEFAULT_AI_SETTINGS),
  });
  return {
    id: workspaceId, isTest: true, workspaceId, webStorage: db.web, acquireListeningInput: productionRuntime.acquireListeningInput,
    storageService: storage, remoteWorkspaceService: remote,
    productSalesApi: product, aiSettingsApi: ai,
    sellerAnalysisApi: localOnlyAdapter({
      currentWorkflow: async (sessionId?: string) => {
        const pins = db.get<Record<string, AppliedSalesWorkflow>>('session-workflows', {});
        // Active profiles stay pinned to the same version for this session.
        const applied = sessionId && pins[sessionId] ? pins[sessionId]
          : await productionRuntime.sellerAnalysisApi.currentWorkflow();
        if (sessionId && applied?.mode === 'ACTIVE' && !pins[sessionId]) {
          await db.put('session-workflows', { ...pins, [sessionId]: applied });
        }
        await db.put('workflow', applied);
        return applied;
      },
      observe: async (sessionId: string) => db.update<unknown[]>('workflow-observations', [], all => [...all, { sessionId, at: new Date().toISOString() }]),
    }),
    commentStreamService: comments as unknown as WorkspaceRuntime['commentStreamService'],
    ...commentSync,
    resolvePrivateImageUrl: async path => path,
    uploadProductImageDataUrl: async (url, dataUrl) => {
      if (!url.startsWith('test-image:')) throw new Error('테스트 이미지 저장 경로가 아닙니다.');
      await db.put(`image:${url.slice('test-image:'.length)}`, dataUrl);
    },
    confirmedBuyerAliases: createConfirmedBuyerAliases(remote, db.web),
    customerKeepingService: createCustomerKeepingService(remote, db.web),
    shippingService: createShippingService(remote, db.web),
    smsBridgeService: localOnlyAdapter({
      getConfig: (sellerId = '') => ({ baseUrl: 'local-test:', apiKey: '', sellerId }),
      saveConfig: async (config: unknown) => db.put('sms-config', config),
      getStatus: async () => ({ ok: true, service: 'local-test', queuedMessages: 0 }),
      getMessages: async () => [], getPayments: async () => [],
      queueMessage: async (_config: unknown, payload: any) => {
        const message = { ...payload, id: crypto.randomUUID(), sellerId: workspaceId, direction: 'OUTGOING', status: 'QUEUED', createdAt: new Date().toISOString() };
        await db.update<unknown[]>('message-previews', [], all => [...all, message]);
        return message;
      },
    }),
    path: path => path === '/live' ? '/live-test' : `/live-test${path}`,
  };
}
