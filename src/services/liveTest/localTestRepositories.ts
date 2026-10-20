import { createAiTaskObject } from '../aiTaskFactory';
import type { SaleRecord, SttTranscriptLog } from '../../types/live';
import type { CommentRecord } from '../../types/comment';
import type { ProductSalesBootstrapData, ProductSalesSession, ProductSalesProduct, LiveComment } from '../../types/productSales';
import type { AppliedSalesWorkflow } from '../../types/salesWorkflow';
import type { AiTask } from '../../types/aiTask';
import { DEFAULT_PRODUCT_SALES_SETTINGS } from '../productSalesDefaults';
import { invalidVoiceSaleFields, voiceSaleValidationMessage } from '../voiceSaleValidation';
import { verifyVoiceSaleBuyer, verifyVoiceSalePrice, verifyWorkflowSale } from '../voiceSaleCommitEvidence';
import { prepareVoicePendingReview, evaluateVoicePendingReview, applyVoicePendingReview } from '../voicePendingReviewCore';
import { shouldReviewVoiceSale, shouldReviewVoiceSaleText, isVoiceReviewReady, isVoiceTextReviewReady } from '../voicePendingReviewService';
import { applyCorrectionToSale, rollbackCorrection } from '../voiceCorrectionService';
import { validateSaleForBatchConfirm } from '../pendingSalesService';
import { replaySalesWorkflow } from '../salesWorkflowEngine';
import { LocalTestDatabase } from './localTestDatabase';
import type { StorageService } from '../storageService';

export function localOnlyAdapter<T extends object>(methods: Record<string, unknown>): T {
  // Missing methods fail closed. They never fall through to an operating API.
  return new Proxy(methods, { get(target, key) {
    if (key in target || typeof key === 'symbol' || key === 'then') return target[key as string];
    return () => { throw new Error(`테스트 환경에서 연결되지 않은 기능입니다: ${String(key)}`); };
  } }) as T;
}
const reject = (code: string, message: string): never => { throw Object.assign(new Error(message), { code, retryable: false }); };
type StoredTestSale = SaleRecord & { testVoiceReceipt?: string };

export function createLocalTestRepositories(db: LocalTestDatabase, storage: StorageService, workspaceId: string,
  infer: (payload: unknown) => Promise<any>, workflow: () => AppliedSalesWorkflow | null) {
  const subscribers = new Set<(change: any) => void>();
  const notify = () => {
    window.dispatchEvent(new CustomEvent('voicecap_sales_updated', { detail: { workspaceId } }));
    for (const subscriber of subscribers) subscriber({ table: 'sales', eventType: 'UPDATE', new: { workspace_id: workspaceId }, old: {} });
  };
  const sessions = () => db.get<ProductSalesSession[]>('sessions', []);
  const bootstrap = (): ProductSalesBootstrapData => ({ workspaceId,
    settings: db.get('product-settings', structuredClone(DEFAULT_PRODUCT_SALES_SETTINGS)),
    activeSession: storage.getActiveSession(workspaceId), activeProduct: storage.getActiveProduct(workspaceId),
    printerStatus: { outputDeviceId: null, outputDeviceName: '테스트 전표', online: true, queuedJobsCount: 0 },
    permissions: ['SALES_READ', 'SALES_WRITE', 'PRODUCT_WRITE', 'COMMENT_INGEST'] });
  const storedSales = async () => (await db.read<StoredTestSale[]>('sales', [])).map(({ testVoiceReceipt: _receipt, ...sale }) => sale);
  const localComments = (sessionId: string) => db.get<CommentRecord[]>('comments', []).filter(c => c.sessionId === sessionId);
  const commitSale = async (sale: SaleRecord) => {
    await db.update<StoredTestSale[]>('sales', [], records => {
      const existing = records.find(s => s.id === sale.id);
      const initialVoice = sale.source === 'WEB_VOICE' && sale.status === '자동저장' && sale.purchaseRequestId
        && sale.printStatus === 'QUEUED' && (sale.printRevision || 0) === 1;
      const payload = JSON.stringify([sale.id, sale.sessionId, sale.purchaseRequestId, sale.productId,
        sale.productCode, sale.amount, sale.unitPrice, sale.quantity || 1, sale.rawTranscript, sale.recognizedAt, sale.workflowEvidence]);
      if (initialVoice && existing?.testVoiceReceipt && existing.testVoiceReceipt !== payload) {
        reject('OPERATION_PAYLOAD_MISMATCH', '재시도 요청이 기존 판매 근거와 다릅니다.');
      }
      if (initialVoice && !existing?.testVoiceReceipt) {
        if (existing && existing.status !== '보류') reject('SALE_ALREADY_FINAL', '이미 확정된 판매입니다.');
        const invalid = invalidVoiceSaleFields(sale.id.slice(2), sale);
        if (invalid.length) reject('VALIDATION_ERROR', voiceSaleValidationMessage(invalid));
        if (!sessions().some(s => s.id === sale.sessionId && s.status === 'ACTIVE')) reject('SESSION_ENDED', '활성 테스트 회차가 아닙니다.');
        const comments = localComments(sale.sessionId);
        if (sale.workflowEvidence) {
          const applied = workflow();
          if (!applied || applied.id !== sale.workflowEvidence.profileId || applied.version !== sale.workflowEvidence.profileVersion) reject('PROFILE_UNVERIFIED', '적용된 판매방식을 확인할 수 없습니다.');
          const check = verifyWorkflowSale(sale, applied!.profile, comments, storage.getSessionTranscripts(workspaceId, sale.sessionId).map(t => ({ ...t, recognizedAt: t.recognizedAt || t.timestamp })));
          if (!check.valid) reject('WORKFLOW_EVIDENCE_UNVERIFIED', '같은 판매 근거를 검증하지 못했습니다.');
          const stock = check.decision?.stock;
          if (stock !== undefined && records.filter(s => s.workflowEvidence?.offerId === sale.workflowEvidence?.offerId
            && s.recordState !== 'CANCELLED' && s.status !== '보류').reduce((n, s) => n + (s.quantity || 1), 0) + (sale.quantity || 1) > stock) {
            reject('STOCK_EXCEEDED', '상품 수량을 초과했습니다.');
          }
        } else {
          if (!verifyVoiceSalePrice(sale).valid) reject('PRICE_OR_INTENT_UNVERIFIED', '판매 확정 발화와 음성 가격 근거를 확인할 수 없습니다.');
          const check = verifyVoiceSaleBuyer(sale, comments);
          if (!check.valid) reject(check.code, '판매자 호칭과 실제 구매 댓글을 연결하지 못했습니다.');
          if (check.match?.kind === 'MATCH') {
            const request = check.match.request;
            if (records.some(s => s.id !== sale.id && s.sessionId === sale.sessionId && s.buyerId && s.buyerId === request.buyerId
              && s.source === 'WEB_VOICE' && s.status !== '보류' && s.recordState !== 'CANCELLED'
              && Date.parse(s.recognizedAt) >= Date.parse(request.capturedAt)
              && Date.parse(s.recognizedAt) - Date.parse(request.capturedAt) <= 30_000)) reject('REPEATED_INTENT_ALREADY_ALLOCATED', '이미 판매에 사용된 반복 구매 댓글입니다.');
            sale = { ...sale, buyerId: request.buyerId || undefined, sourceCommentIds: [request.commentId] };
          }
        }
        if (records.some(s => s.id !== sale.id && s.source === 'WEB_VOICE' && s.purchaseRequestId === sale.purchaseRequestId)) reject('REQUEST_ALREADY_ALLOCATED', '이미 다른 판매에 사용한 구매 댓글입니다.');
      }
      return [...records.filter(s => s.id !== sale.id), { ...structuredClone(sale),
        testVoiceReceipt: existing?.testVoiceReceipt || (initialVoice ? payload : undefined) }];
    });
    notify();
  };
  const feed = (sessionId: string) => {
    const { summary, buyerStats } = storage.getSessionSalesSummary(sessionId, workspaceId);
    return { comments: localComments(sessionId).map((c, i) => ({ id: c.id, sessionId: c.sessionId, collectorId: 'test',
      platformMessageId: c.platformMessageId || c.id, buyerId: c.buyerId, nicknameSnapshot: c.nickname,
      content: c.content, capturedAt: c.capturedAt, ingestSequence: i + 1 })), buyerStats, summary,
      activeProduct: storage.getActiveProduct(workspaceId), sessionRevision: storage.getActiveSession(workspaceId)?.revision || 1,
      nextCursor: null, hasMore: false, deletedCommentIds: [] };
  };
  const product = {
    getBootstrap: async () => bootstrap(),
    startSession: async (_operationId: string) => {
      const previous = storage.getActiveSession(workspaceId);
      if (previous) await db.update<ProductSalesSession[]>('sessions', [], all => all.map(s => s.id === previous.id ? { ...s, status: 'ENDED', endedAt: new Date().toISOString() } : s));
      const today = new Date().toLocaleDateString('sv-SE');
      const number = sessions().filter(s => s.displayCode.startsWith(today)).length + 1;
      const session: ProductSalesSession = { id: crypto.randomUUID(), workspaceId, displayCode: `${today} 테스트 ${number}회차`, status: 'ACTIVE', revision: 1, startedAt: new Date().toISOString() };
      await db.update<ProductSalesSession[]>('sessions', [], all => [...all, session]);
      storage.saveActiveSession(session, workspaceId); storage.saveActiveProduct(null, workspaceId);
      return { session };
    },
    listSessions: async () => ({ sessions: (await db.read<ProductSalesSession[]>('sessions', [])).reverse(), nextCursor: null }),
    endSession: async (_op: string, id: string) => {
      await db.update<ProductSalesSession[]>('sessions', [], all => all.map(s => s.id === id ? { ...s, status: 'ENDED', endedAt: new Date().toISOString() } : s));
      return { session: sessions().find(s => s.id === id) };
    },
    getSalesFeed: async ({ sessionId }: { sessionId: string }) => feed(sessionId),
    listLiveComments: async ({ sessionId }: { sessionId?: string } = {}) => ({ comments: (sessionId ? feed(sessionId).comments : db.get<CommentRecord[]>('comments', []).map((c, i) => ({
      id: c.id, sessionId: c.sessionId, collectorId: 'test', platformMessageId: c.platformMessageId || c.id, buyerId: c.buyerId,
      nicknameSnapshot: c.nickname, content: c.content, capturedAt: c.capturedAt, ingestSequence: i + 1 }))), nextCursor: null }),
    ingestComments: async ({ sessionId, comments }: { sessionId: string; comments: any[] }) => {
      const buyers = db.get<Record<string, string>>('buyers', {});
      const existingComments = db.get<CommentRecord[]>('comments', []);
      const records: CommentRecord[] = comments.map(c => {
        const identity = c.platformUserId || c.platformUniqueId || `unresolved:${c.platformMessageId}`;
        buyers[identity] ||= crypto.randomUUID();
        const existing = existingComments.find(record => record.sessionId === sessionId && record.platformMessageId === c.platformMessageId);
        return { id: existing?.id || crypto.randomUUID(), platformMessageId: c.platformMessageId, sessionId,
          buyerId: buyers[identity], platformUserId: c.platformUserId, uniqueId: c.platformUniqueId,
          nickname: c.nickname, content: c.content, capturedAt: c.capturedAt };
      });
      await db.put('buyers', buyers);
      await db.update<CommentRecord[]>('comments', [], all => {
        const recordsByMessage = new Map(all.map(c => [`${c.sessionId}:${c.platformMessageId || c.id}`, c]));
        for (const record of records) recordsByMessage.set(`${record.sessionId}:${record.platformMessageId}`, record);
        return [...recordsByMessage.values()].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
      });
      storage.addCommentRecords(records, workspaceId);
      await db.flush();
      return { acceptedCount: records.length, comments: feed(sessionId).comments.filter(c => comments.some(incoming => incoming.platformMessageId === c.platformMessageId)) };
    },
    deleteLiveComments: async (ids: string[]) => {
      await db.update<CommentRecord[]>('comments', [], all => all.filter(c => !ids.includes(c.id)));
      storage.deleteCommentRecords(ids, workspaceId); return { deletedCount: ids.length };
    },
    updateSettings: async (_op: string, revision: number, changes: any) => {
      const current = bootstrap().settings;
      if (current.revision !== revision) reject('REVISION_CONFLICT', '설정이 변경되었습니다.');
      const settings = { ...current, ...changes, revision: revision + 1 };
      await db.put('product-settings', settings); return { settings };
    },
    prepareProduct: async (params: any) => {
      const draftId = crypto.randomUUID(), productId = crypto.randomUUID();
      const productCode = params.requestedProductCode || String(db.get<any[]>('products', []).length + 1);
      await db.update<any[]>('drafts', [], all => [...all, { ...params, id: draftId, productId, productCode, draftRevision: 1 }]);
      return { draftId, productId, productCode, draftRevision: 1, imageUpload: { uploadUrl: `test-image:${draftId}` } };
    },
    commitProduct: async (params: any) => {
      const draft = db.get<any[]>('drafts', []).find(d => d.id === params.draftId);
      const session = storage.getActiveSession(workspaceId);
      if (!draft || !session || session.id !== draft.sessionId || session.revision !== params.expectedSessionRevision) reject('REVISION_CONFLICT', '상품 또는 회차가 변경되었습니다.');
      const product: ProductSalesProduct = { id: draft.productId, productCode: draft.productCode, name: draft.name,
        unitPrice: draft.unitPrice ?? null, imageKind: draft.imageKind, imageUrl: db.get(`image:${draft.id}`, ''),
        revision: 1, salesRevision: 1, source: params.source || 'WEB_VOICE' };
      await db.update<ProductSalesProduct[]>('products', [], all => [...all.filter(p => p.id !== product.id), product]);
      const nextSession = { ...session!, activeProductId: product.id, revision: session!.revision + 1 };
      storage.saveActiveProduct(product, workspaceId); storage.saveActiveSession(nextSession, workspaceId);
      await db.update<ProductSalesSession[]>('sessions', [], all => all.map(s => s.id === nextSession.id ? nextSession : s));
      return { product, session: nextSession };
    },
  };
  const remote = {
    loadSales: storedSales,
    saveSale: (_owner: string, sale: SaleRecord) => commitSale(sale),
    deleteSale: async (_owner: string, id: string) => { await db.update<SaleRecord[]>('sales', [], all => all.filter(s => s.id !== id)); notify(); },
    loadPromiseDefaults: async () => storage.getPromiseDefaults(workspaceId),
    savePromiseDefault: async (_owner: string, decision: any) => { storage.savePromiseDefault(decision, workspaceId); await db.flush(); },
    subscribe: (_owner: string, listener: (change: any) => void, options?: any) => {
      const receive = (change: any) => { if (!options?.tables || options.tables.includes(change.table)) listener(change); };
      subscribers.add(receive);
      queueMicrotask(() => { if (subscribers.has(receive)) options?.onStatus?.('SUBSCRIBED'); });
      return () => { subscribers.delete(receive); };
    },
    saveCloudSessionTranscripts: async (_owner: string, sessionId: string, logs: SttTranscriptLog[]) => { storage.saveSessionTranscripts(workspaceId, sessionId, logs); await db.flush(); return true; },
    fetchCloudSessionTranscripts: async (_owner: string, id: string) => storage.getSessionTranscripts(workspaceId, id),
    fetchSessionTranscriptHistory: async () => storage.getTranscriptHistory(workspaceId),
    recordSttUsage: async (usage: unknown) => db.update<unknown[]>('stt-usage', [], all => [...all, usage]),
    loadRecognitionRules: async () => storage.getRules(),
    saveRecognitionRules: async (_owner: string, rules: any) => { storage.saveRules(rules); await db.flush(); },
    loadCaptureAreaConfig: async () => storage.getCaptureAreaConfig(),
    saveCaptureAreaConfig: async (_owner: string, area: any) => { storage.saveCaptureAreaConfig(area); await db.flush(); },
    loadCommentCaptureConfig: async () => storage.getCommentCaptureConfig(),
    saveCommentCaptureConfig: async (_owner: string, config: any) => { storage.saveCommentCaptureConfig(config); await db.flush(); },
    loadSttVocabulary: async () => storage.getSttVocabulary(workspaceId),
    saveSttVocabulary: async (_owner: string, words: string[]) => { storage.saveSttVocabulary(workspaceId, words); await db.flush(); },
    fetchWorkspaceSettings: async (_owner: string, namespace: string) => db.get(`setting:${namespace}`, null),
    saveWorkspaceSettings: async (_owner: string, namespace: string, value: unknown) => db.put(`setting:${namespace}`, value),
    loadCommerceTables: async () => storage.getCommerceState(),
    saveCommerceChanges: async () => { await db.flush(); },
    notifyOutbox: async () => ({ sentCount: 0 }),
    fetchVoicecapSellers: async () => [],
  };
  const review = async (saleId: string, options: any = {}) => {
    const storedSale = (await storedSales()).find(s => s.id === saleId);
    if (!storedSale || storedSale.status !== '보류') return { skipped: true };
    let sale: SaleRecord = storedSale;
    const when = Date.parse(sale.recognizedAt);
    const databaseComments = localComments(sale.sessionId).filter(c => Math.abs(Date.parse(c.capturedAt) - when) <= 180_000);
    if (databaseComments.length > 1000) reject('COMMENT_WINDOW_TOO_LARGE', '댓글 후보가 많아 판매자 확인을 기다립니다.');
    const byMessage = new Map<string, CommentRecord>();
    for (const c of [...(options.comments || []).map((c: CommentRecord) => ({ ...c, sessionId: sale.sessionId })), ...databaseComments]) {
      byMessage.set(`${c.sessionId}:${c.platformMessageId || c.id}`, c);
    }
    const comments = [...byMessage.values()].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const logs = storage.getSessionTranscripts(workspaceId, sale.sessionId);
    if (sale.workflowEvidence) {
      const profile = workflow()?.id === sale.workflowEvidence.profileId ? workflow()!.profile : sale.workflowEvidence.profileSnapshot;
      if (!profile) reject('PROFILE_UNVERIFIED', '판매방식 설정을 확인할 수 없습니다.');
      const decision = replaySalesWorkflow({ sessionId: sale.sessionId, profile: profile!,
        comments: localComments(sale.sessionId), transcripts: logs.map(t => ({ ...t, recognizedAt: t.recognizedAt || t.timestamp }))
          .filter(t => Date.parse(t.recognizedAt) <= when + 70_000) })
        .find(d => d.id === sale!.workflowEvidence!.decisionId);
      if (!decision) reject('WORKFLOW_EVIDENCE_UNVERIFIED', '검토할 원본 발화를 확인할 수 없습니다.');
      sale = { ...sale, workflowEvidence: { ...sale.workflowEvidence, profileSnapshot: profile, orderCode: decision!.orderCode } };
    }
    if (!(sale.workflowEvidence ? shouldReviewVoiceSale(sale, comments) : shouldReviewVoiceSaleText(sale, comments))) return { skipped: true };
    if (!options.forceReanalyze && !(sale.workflowEvidence ? isVoiceReviewReady(sale, comments) : isVoiceTextReviewReady(sale))) return { skipped: true, waitingForWindow: true };
    const following = String(options.followingUtterance || options.followUpUtterance || '').slice(0, 600);
    const { request, fingerprint } = prepareVoicePendingReview(sale, comments, logs, following, workspaceId);
    const previous = sale.aiVerification;
    if (!options.forceReanalyze && previous?.reviewFingerprint === fingerprint && !previous.errorMessage && previous.aiStatus !== 'CHECKING') return { skipped: true };
    if (previous?.aiStatus === 'CHECKING' && Date.now() - Date.parse(previous.validatedAt || '') < 60_000) return { skipped: true };
    const claimAt = new Date().toISOString();
    let claimed = false;
    await db.update<SaleRecord[]>('sales', [], all => all.map(current => {
      if (current.id !== sale.id || current.revision !== sale.revision || current.status !== '보류'
        || JSON.stringify(current.aiVerification) !== JSON.stringify(sale.aiVerification)) return current;
      claimed = true;
      return { ...current, aiVerification: { aiStatus: 'CHECKING', reviewFingerprint: fingerprint, validatedAt: claimAt } };
    }));
    if (!claimed) return { skipped: true };
    notify();
    const queuedTask = createAiTaskObject({ workspaceId, sessionId: sale.sessionId, saleId: sale.id, saleRevision: sale.revision,
      taskType: 'PENDING_RESOLUTION', currentUtterance: sale.rawTranscript, request });
    await db.update<AiTask[]>('ai-tasks', [], all => [...all, queuedTask]);
    let task: AiTask | null = queuedTask, processingError: string | undefined;
    try {
      const response = await infer({ sale, request, taskId: queuedTask.taskId, circuitBreakers: db.get('ai-circuit-breakers', null) });
      if (response.skipped) {
        await db.update<SaleRecord[]>('sales', [], all => all.map(s => s.id === sale.id && s.aiVerification?.validatedAt === claimAt ? { ...s, aiVerification: previous } : s));
        await db.update<AiTask[]>('ai-tasks', [], all => all.map(t => t.taskId === queuedTask.taskId ? { ...t, status: 'CANCELLED' } : t));
        notify();
        return response;
      }
      task = response.task;
      if (response.circuitBreakers) await db.put('ai-circuit-breakers', response.circuitBreakers);
      if (task) await db.update<AiTask[]>('ai-tasks', [], all => [...all.filter(t => t.taskId !== task!.taskId && t.taskId !== queuedTask.taskId), task!]);
      if (task?.status === 'FAILED') processingError = task.failureReason || 'AI 검토에 실패했습니다.';
    } catch (error) {
      processingError = error instanceof Error ? error.message : 'AI 검토에 실패했습니다.';
      task = { ...queuedTask, status: 'FAILED', failureReason: processingError, updatedAt: new Date().toISOString() };
      await db.update<AiTask[]>('ai-tasks', [], all => all.map(t => t.taskId === queuedTask.taskId ? task! : t));
    }
    const meta = evaluateVoicePendingReview(sale, comments, logs, following, task, fingerprint, processingError);
    if (!sale.workflowEvidence && meta.candidateCommentId && !databaseComments.some(c => c.id === meta.candidateCommentId)) {
      meta.candidateCommentId = undefined;
    }
    let applied: SaleRecord | undefined;
    await db.update<SaleRecord[]>('sales', [], all => {
      if (meta.candidatePurchaseRequestId && all.some(s => s.id !== sale.id && s.purchaseRequestId === meta.candidatePurchaseRequestId)) {
        meta.nicknameVerified = false; meta.candidateBuyer = undefined; meta.candidatePurchaseRequestId = undefined; meta.candidateCommentId = undefined;
        meta.resolutionSummary = '이 구매 댓글에 연결된 다른 판매가 있습니다. 중복 여부를 확인해 주세요.';
      }
      return all.map(current => {
        if (current.id !== sale.id || current.status !== '보류' || current.revision !== sale.revision || current.aiVerification?.validatedAt !== claimAt) return current;
        applied = applyVoicePendingReview(current, comments, logs, following, meta, task);
        return applied;
      });
    });
    notify();
    return { sale: applied, task, skipped: !applied };
  };
  const ai = {
    triggerPendingAiResolution: review,
    getAiTasks: async (query: any) => ({ tasks: (await db.read<AiTask[]>('ai-tasks', [])).filter(t => (!query.saleId || t.saleId === query.saleId) && (!query.taskId || t.taskId === query.taskId)).slice(-(query.limit || 50)).reverse(), total: db.get<AiTask[]>('ai-tasks', []).length }),
    applyVoiceCorrection: async (saleId: string, intent: any, options: any = {}) => {
      let applied: ReturnType<typeof applyCorrectionToSale> | undefined;
      await db.update<SaleRecord[]>('sales', [], all => all.map(s => {
        if (s.id !== saleId || (options.expectedRevision !== undefined && (s.revision || 1) !== options.expectedRevision)) return s;
        applied = applyCorrectionToSale(s, intent, { expectedRevision: options.expectedRevision });
        return applied.updatedSale;
      }));
      notify();
      return applied ? { success: true, action: 'APPLIED', sale: applied.updatedSale, printJobCreated: applied.printJobRequired, message: '테스트 정정을 반영했습니다.' }
        : { success: false, action: 'CONFLICT', message: '정정 중 판매가 변경되어 이전 요청을 적용하지 않았습니다.' };
    },
    rollbackVoiceCorrection: async ({ saleId }: { saleId: string }) => {
      let result: ReturnType<typeof rollbackCorrection> | undefined;
      await db.update<SaleRecord[]>('sales', [], all => all.map(s => {
        if (s.id !== saleId) return s;
        result = rollbackCorrection(s); return result.rolledBackSale || s;
      }));
      notify(); return { success: result?.success || false, action: result?.success ? 'RESTORED' : 'CONFLICT',
        sale: result?.rolledBackSale, message: result?.success ? '이전 판매값으로 복원했습니다.' : result?.conflictReason || '복원할 판매가 없습니다.' };
    },
    batchConfirmPendingSales: async (saleIds: string[]) => {
      const confirmedSaleIds: string[] = [], skippedSales: any[] = [];
      await db.update<SaleRecord[]>('sales', [], all => all.map(s => {
        if (!saleIds.includes(s.id)) return s;
        const validation = validateSaleForBatchConfirm(s);
        if (!validation.canConfirm) {
          skippedSales.push({ saleId: s.id, buyerNickname: s.buyerNickname, amount: s.amount, remainingReasons: validation.validationErrors });
          return s;
        }
        confirmedSaleIds.push(s.id);
        return s.status === '확정' ? s : { ...s, status: '확정', revision: (s.revision || 1) + 1 };
      }));
      notify();
      return { result: { totalRequested: saleIds.length, confirmedCount: confirmedSaleIds.length, confirmedSaleIds,
        skippedCount: saleIds.length - confirmedSaleIds.length, skippedSales } };
    },
  };
  return { product, remote, ai, commitSale, storedSales };
}
