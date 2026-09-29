import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ProductSalesBootstrapData,
  ProductSalesProduct,
  ProductSalesSession,
  ProductSalesSettings,
  ProductSalesFeedData,
  CommitSaleBuyer,
  ProductSalesResult,
  ImageKind,
  LiveComment,
} from '../types/productSales';
import { productSalesApi } from '../services/productSalesApi';
import { storageService } from '../services/storageService';
import { resolvePrivateImageUrl } from '../services/remoteWorkspaceService';
import { createNumberProductImage, uploadProductImageDataUrl } from '../services/productImageService';
import { useAuth } from './AuthContext';
import { useSales } from './SalesContext';
import { flushPendingComments } from '../services/commentSyncService';
import type { SaleRecord } from '../types/live';
import {
  VoiceSaleCandidate,
  VoiceCandidateController,
  parseVoiceCommand,
} from '../services/voiceSaleCandidate';

interface ProductSalesContextType {
  bootstrap: ProductSalesBootstrapData | null;
  activeProduct: ProductSalesProduct | null;
  activeSession: ProductSalesSession | null;
  settings: ProductSalesSettings | null;
  feed: ProductSalesFeedData | null;
  candidate: VoiceSaleCandidate | null;
  isLoading: boolean;
  error: string | null;

  loadBootstrap: () => Promise<ProductSalesBootstrapData | null>;
  startNewSession: () => Promise<ProductSalesSession>;
  setFeedPollingEnabled: (enabled: boolean) => void;
  updateSettings: (newSettings: Partial<ProductSalesSettings>) => Promise<void>;
  prepareProduct: (
    requestedProductCode?: string,
    name?: string,
    unitPrice?: number,
    imageKind?: 'PHOTO' | 'NUMBER_IMAGE'
  ) => Promise<{
    draftId: string;
    draftRevision: number;
    productId: string;
    productCode: string;
    uploadUrl?: string;
  }>;
  commitProduct: (draftId: string, draftRevision: number) => Promise<ProductSalesProduct | null>;
  registerProduct: (params: {
    requestedProductCode?: string;
    name?: string;
    unitPrice?: number;
    imageDataUrl?: string;
    imageKind?: ImageKind;
    source?: 'WEB_VOICE' | 'MANUAL';
  }) => Promise<ProductSalesProduct>;
  commitSales: (buyers: CommitSaleBuyer[]) => Promise<ProductSalesResult>;
  processVoiceUtterance: (transcript: string, isFinal: boolean) => void;
  cancelCandidate: () => void;
  pauseCandidate: () => void;
  resumeCandidate: () => void;
  pollFeed: () => Promise<void>;
}

const ProductSalesContext = createContext<ProductSalesContextType | null>(null);

const SALES_FEED_POLL_INTERVAL_MS = 2_000;
const SALES_FEED_POLL_PATHS = new Set(['/live']);

function isSameProduct(left: ProductSalesProduct | null, right: ProductSalesProduct | null) {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.id === right.id
    && left.productCode === right.productCode
    && left.name === right.name
    && left.unitPrice === right.unitPrice
    && left.imageKind === right.imageKind
    && left.imagePath === right.imagePath
    && left.imageUrl === right.imageUrl
    && left.source === right.source
    && left.revision === right.revision
    && left.salesRevision === right.salesRevision;
}

async function hydrateProduct(product: ProductSalesProduct | null): Promise<ProductSalesProduct | null> {
  if (!product) return null;
  const imagePath = product.imagePath || product.imageUrl || '';
  return {
    ...product,
    imagePath: imagePath || undefined,
    imageUrl: imagePath ? await resolvePrivateImageUrl(imagePath) : undefined,
  };
}

export const ProductSalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user, workspaceId } = useAuth();
  const { applyCommittedSales } = useSales();
  const location = useLocation();
  const [bootstrap, setBootstrap] = useState<ProductSalesBootstrapData | null>(null);
  const [feed, setFeed] = useState<ProductSalesFeedData | null>(null);
  const [candidate, setCandidate] = useState<VoiceSaleCandidate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedPollingEnabled, setFeedPollingEnabledState] = useState(false);

  const controllerRef = useRef<VoiceCandidateController | null>(null);
  const activeSessionRef = useRef<ProductSalesSession | null>(null);
  const activeProductRef = useRef<ProductSalesProduct | null>(null);
  const bootstrapRef = useRef<ProductSalesBootstrapData | null>(null);
  const identityRef = useRef('');
  const identityGenerationRef = useRef(0);
  const stateGenerationRef = useRef(0);
  const bootstrapRequestRef = useRef(0);

  const activeProduct = bootstrap?.workspaceId === workspaceId ? bootstrap.activeProduct : null;
  const activeSession = bootstrap?.workspaceId === workspaceId ? bootstrap.activeSession : null;
  const settings = bootstrap?.workspaceId === workspaceId ? bootstrap.settings : null;
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const shouldPollSalesFeed = isAuthenticated && feedPollingEnabled && SALES_FEED_POLL_PATHS.has(normalizedPath);

  const workspaceIdRef = useRef<string | null>(workspaceId || null);
  const identity = `${user?.id || ''}:${workspaceId || ''}`;
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    identityGenerationRef.current += 1;
    stateGenerationRef.current += 1;
    activeSessionRef.current = null;
    activeProductRef.current = null;
    bootstrapRef.current = null;
  }
  workspaceIdRef.current = workspaceId || null;
  const captureRequest = useCallback(() => ({
    workspaceId: workspaceIdRef.current,
    identityGeneration: identityGenerationRef.current,
    stateGeneration: stateGenerationRef.current,
  }), []);
  const isCurrentRequest = useCallback((request: ReturnType<typeof captureRequest>) => (
    request.workspaceId !== null && request.workspaceId === workspaceIdRef.current
    && request.identityGeneration === identityGenerationRef.current
    && request.stateGeneration === stateGenerationRef.current
  ), []);
  const isCurrentIdentity = useCallback((request: ReturnType<typeof captureRequest>) => (
    request.workspaceId !== null && request.workspaceId === workspaceIdRef.current
    && request.identityGeneration === identityGenerationRef.current
  ), []);
  // 워크스페이스 변경 시 storageService 스코프 동기화
  useEffect(() => {
    storageService.setWorkspaceId(workspaceId || null);
    activeSessionRef.current = null;
    activeProductRef.current = null;
    bootstrapRef.current = null;
    setBootstrap(null);
    setFeed(null);
    setCandidate(null);
  }, [workspaceId, user?.id]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    activeProductRef.current = activeProduct;
  }, [activeProduct]);

  // 네트워크 조회 없이 로컬 판매·댓글 캐시로 피드를 구성한다.
  const buildLocalFeed = useCallback((
    sessionId: string,
    sessionRevision?: number,
    overrideActiveProduct?: ProductSalesProduct | null
  ): ProductSalesFeedData => {
    // 1. 로컬DB 판매 테이블에서 현재 세션 누적 판매 통계 SUM / COUNT 집계
    const owner = workspaceIdRef.current;
    const { summary, buyerStats } = storageService.getSessionSalesSummary(sessionId, owner);

    // 2. 로컬DB 댓글 테이블에서 현재 세션 댓글 읽기 (정식 buyerId 보존)
    // P1-8: localRecords는 시간 오름차순(과거->최신)이므로 최신 50건은 반드시 slice(-50)이어야 함
    const localRecords = storageService.getSessionCommentRecords(sessionId, owner);
    const comments: LiveComment[] = localRecords.slice(-50).map((r, index) => ({
      id: r.id,
      sessionId: r.sessionId,
      collectorId: 'local-helper',
      platformMessageId: r.platformMessageId || r.id,
      buyerId: r.buyerId || null,
      nicknameSnapshot: r.nickname,
      content: r.content,
      capturedAt: r.capturedAt,
      ingestSequence: index + 1,
    }));

    // 3. 로컬DB 활성 상품 읽기
    const currentActive = overrideActiveProduct !== undefined
      ? overrideActiveProduct
      : activeProductRef.current;

    const currentSession = activeSessionRef.current;

    return {
      comments,
      buyerStats,
      summary,
      activeProduct: currentActive,
      sessionRevision: sessionRevision ?? currentSession?.revision ?? 1,
      nextCursor: null,
      hasMore: false,
    };
  }, []);

  const applyProductState = useCallback((owner: string, session: ProductSalesSession | null, product: ProductSalesProduct | null, persist = true) => {
    if (owner !== workspaceIdRef.current) return;
    if (session?.id !== activeSessionRef.current?.id || session?.revision !== activeSessionRef.current?.revision
      || session?.status !== activeSessionRef.current?.status || !isSameProduct(product, activeProductRef.current)) {
      stateGenerationRef.current += 1;
    }
    activeSessionRef.current = session;
    activeProductRef.current = product;
    if (persist) {
      storageService.saveActiveProduct(product, owner);
      storageService.saveActiveSession(session, owner);
    }
    const previous = bootstrapRef.current;
    if (previous?.workspaceId === owner) {
      const next = { ...previous, activeSession: session, activeProduct: product };
      bootstrapRef.current = next;
      setBootstrap(next);
      if (persist) storageService.saveBootstrapCache(next, owner);
    }
    setFeed(session ? buildLocalFeed(session.id, session.revision, product) : null);
  }, [buildLocalFeed]);

  // [안전장치 1회 동기화 (Bootstrap)]
  // 방송 시작 또는 화면 새로고침 시 1회만 Supabase에서 최신 상태를 받아와 로컬DB를 초기화/동기화
  const loadBootstrap = useCallback(async (): Promise<ProductSalesBootstrapData | null> => {
    let request = captureRequest();
    const requestId = ++bootstrapRequestRef.current;
    if (!request.workspaceId) return null;
    setIsLoading(true);
    try {
      const data = await productSalesApi.getBootstrap(request.workspaceId);
      // P1-4: 요청 시점의 워크스페이스와 현재 워크스페이스가 다르면(계정 전환 등) 이전 응답 폐기
      if (!isCurrentRequest(request) || requestId !== bootstrapRequestRef.current || data.workspaceId !== request.workspaceId) {
        return null;
      }
      const hydratedProduct = await hydrateProduct(data.activeProduct);
      if (!isCurrentRequest(request) || requestId !== bootstrapRequestRef.current) return null;
      const hydratedData = { ...data, activeProduct: hydratedProduct };
      bootstrapRef.current = hydratedData;
      applyProductState(request.workspaceId, data.activeSession, hydratedProduct);
      request = captureRequest();
      setError(null);

      // 세션이 있다면 초기 1회 서버 피드/댓글도 동기화하여 로컬DB 채우기
      if (data.activeSession?.id) {
        try {
          const initialFeed = await productSalesApi.getSalesFeed({
            workspaceId: request.workspaceId!,
            sessionId: data.activeSession.id,
            limit: 50,
          });
          if (!isCurrentRequest(request) || requestId !== bootstrapRequestRef.current) return null;
          if (initialFeed.comments && initialFeed.comments.length > 0) {
            const commentRecords = initialFeed.comments.map((c) => ({
              id: c.id,
              platformMessageId: c.platformMessageId,
              sessionId: c.sessionId,
              nickname: c.nicknameSnapshot,
              buyerId: c.buyerId || null,
              content: c.content,
              capturedAt: c.capturedAt,
            }));
            storageService.addCommentRecords(commentRecords, request.workspaceId);
          }
        } catch (feedErr) {
          console.warn('[ProductSalesContext] 초기 피드 서버 동기화 실패 (로컬DB로 시작):', feedErr);
        }

        // 초기 로컬 피드 즉시 설정
        if (!isCurrentRequest(request) || requestId !== bootstrapRequestRef.current) return null;
        const localFeed = buildLocalFeed(data.activeSession.id, data.activeSession.revision, hydratedProduct);
        setFeed(localFeed);
      }

      return hydratedData;
    } catch (err: any) {
      if (!isCurrentRequest(request) || requestId !== bootstrapRequestRef.current) {
        return null;
      }
      console.warn('[ProductSalesContext] 부트스트랩 API 실패, 로컬 캐시 복원 시도:', err);
      // Permission failures are not an offline success path.
      if (['AUTH_REQUIRED', 'CAPABILITY_DENIED', 'WORKSPACE_ACCESS_DENIED'].includes(err.code)) {
        setError(err.message || '작업공간 접근 권한을 확인해 주세요.');
        return null;
      }
      const cached = storageService.getBootstrapCache(request.workspaceId);
      // 타 계정/타 워크스페이스 캐시 오염 원천 차단
      if (cached && cached.workspaceId === request.workspaceId) {
        bootstrapRef.current = cached;
        applyProductState(request.workspaceId!, cached.activeSession, cached.activeProduct);
        return cached;
      }
      setError(err.message || '부트스트랩 로딩 실패');
      return null;
    } finally {
      if (request.workspaceId === workspaceIdRef.current && request.identityGeneration === identityGenerationRef.current && requestId === bootstrapRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyProductState, buildLocalFeed, captureRequest, isCurrentRequest]);

  const startNewSession = useCallback(async (): Promise<ProductSalesSession> => {
    const request = captureRequest();
    await productSalesApi.startSession(crypto.randomUUID());
    if (!isCurrentRequest(request)) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');
    const data = await loadBootstrap();
    if (!data?.activeSession) {
      throw new Error('새 방송 회차를 시작하지 못했습니다. 다시 시도해 주세요.');
    }
    return data.activeSession;
  }, [loadBootstrap, captureRequest, isCurrentRequest]);

  const setFeedPollingEnabled = useCallback((enabled: boolean) => {
    setFeedPollingEnabledState(enabled);
  }, []);

  // [2초 주기 조회(읽기)]
  // 화면 조회는 로컬에서 수행한다. 클라우드 반영 대기 상태는 별도로 표시한다.
  const pollFeed = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) return;

    const localFeed = buildLocalFeed(session.id, session.revision);
    setFeed(localFeed);
  }, [buildLocalFeed]);

  useEffect(() => {
    if (!isAuthenticated) {
      setBootstrap(null);
      setFeed(null);
      setError(null);
      setFeedPollingEnabledState(false);
      return;
    }
    void loadBootstrap();
  }, [isAuthenticated, user?.id, workspaceId, loadBootstrap]);

  // 2초 주기 로컬 피드 갱신 루프
  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!shouldPollSalesFeed || !sessionId) {
      return;
    }

    let disposed = false;
    let timer: number | undefined;

    const scheduleNextPoll = () => {
      if (disposed) return;
      void pollFeed();

      timer = window.setTimeout(() => {
        scheduleNextPoll();
      }, SALES_FEED_POLL_INTERVAL_MS);
    };

    scheduleNextPoll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeSession?.id, pollFeed, shouldPollSalesFeed]);

  // 멀티 탭(다른 창) 변경 실시간 감지 동기화
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key) return;
      const owner = workspaceIdRef.current;
      if (!owner || !e.key.endsWith(`:${encodeURIComponent(owner)}`)) return;
      if (
        e.key.includes('dadryeo_sales') ||
        e.key.includes('voicecap_sales_state') ||
        e.key.includes('voicecap_active_product') ||
        e.key.includes('voicecap_active_session') ||
        e.key.includes('voicecap_comment_records')
      ) {
        // P1-7: 활성 상품 및 세션도 로컬 저장소 최신값으로 동기화
        if (e.key.includes('voicecap_active_')) {
          const session = storageService.getActiveSession(owner);
          const product = storageService.getActiveProduct(owner);
          applyProductState(owner, session, product, false);
        } else void pollFeed();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    const handleComments = (event: Event) => {
      if ((event as CustomEvent).detail?.workspaceId === workspaceIdRef.current) void pollFeed();
    };
    window.addEventListener('voicecap_comments_updated', handleComments);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('voicecap_comments_updated', handleComments);
    };
  }, [applyProductState, pollFeed]);

  // 저빈도(60초) 백그라운드 헬스체크 (서버와 로컬의 정합성 자동 보정)
  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!isAuthenticated || !sessionId || !shouldPollSalesFeed) return;

    let disposed = false;
    let inFlight = false;
    const synchronize = async () => {
      if (disposed || inFlight) return;
      const request = captureRequest();
      if (!request.workspaceId || activeSessionRef.current?.id !== sessionId) return;
      inFlight = true;
      try {
        const remoteFeed = await productSalesApi.getSalesFeed({ workspaceId: request.workspaceId, sessionId, limit: 50 });
        if (disposed || !isCurrentRequest(request) || activeSessionRef.current?.id !== sessionId) return;
        if (remoteFeed.sessionRevision < (activeSessionRef.current?.revision || 0)) return;
        const hydrated = await hydrateProduct(remoteFeed.activeProduct);
        if (disposed || !isCurrentRequest(request) || activeSessionRef.current?.id !== sessionId) return;
        if (remoteFeed.comments && remoteFeed.comments.length > 0) {
          const records = remoteFeed.comments.map((c) => ({
            id: c.id,
            platformMessageId: c.platformMessageId,
            sessionId: c.sessionId,
            nickname: c.nicknameSnapshot,
            buyerId: c.buyerId || null,
            content: c.content,
            capturedAt: c.capturedAt,
          }));
          storageService.addCommentRecords(records, request.workspaceId);
        }
        // P1-7: 활성 상품 및 세션 revision도 원격 피드에서 받아서 동기화
        const currentSession = activeSessionRef.current;
        if (currentSession) applyProductState(request.workspaceId, {
          ...currentSession, revision: remoteFeed.sessionRevision,
          activeProductId: hydrated?.id || null,
        }, hydrated);
      } catch {
        // 백그라운드 헬스체크 실패는 조용히 무시
      } finally { inFlight = false; }
    };
    const interval = window.setInterval(() => void synchronize(), 60_000);
    window.addEventListener('online', synchronize);
    return () => { disposed = true; window.clearInterval(interval); window.removeEventListener('online', synchronize); };
  }, [activeSession?.id, isAuthenticated, shouldPollSalesFeed, applyProductState, captureRequest, isCurrentRequest]);

  const resolveSaleBuyers = useCallback(async (owner: string, sessionId: string, buyers: CommitSaleBuyer[]) => {
    const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (buyers.some((buyer) => !isUuid(buyer.buyerId) || buyer.sourceCommentIds?.some((id) => !isUuid(id)))) {
      await flushPendingComments(owner);
    }
    const comments = storageService.getCommentRecords(owner).filter((comment) => comment.sessionId === sessionId);
    return buyers.map((buyer) => {
      const sources = (buyer.sourceCommentIds || []).map((id) => {
        const comment = comments.find((item) => item.id === id || `stream-${item.platformMessageId}` === id);
        return { id: comment?.id || id, buyerId: comment?.buyerId };
      });
      const buyerId = isUuid(buyer.buyerId) ? buyer.buyerId : sources.find((item) => item.buyerId)?.buyerId;
      if (!buyerId || !isUuid(buyerId) || sources.some((item) => !isUuid(item.id))) {
        throw new Error('댓글 저장 확인 후 구매자를 다시 선택해 주세요.');
      }
      return { buyerId, quantity: buyer.quantity, sourceCommentIds: sources.map((item) => item.id) };
    });
  }, []);

  const acceptCommittedSales = useCallback((owner: string, sessionId: string, result: ProductSalesResult) => {
    const records: SaleRecord[] = (result.sales || []).map((sale) => ({
      id: sale.id, sessionId, buyerNickname: sale.buyerNickname, buyerId: sale.buyerId,
      amount: sale.amount, quantity: sale.quantity, unitPrice: sale.unitPrice,
      status: '확정', recordState: sale.recordState || 'ACTIVE',
      productCode: sale.productCodeSnapshot, productName: sale.productNameSnapshot,
      productId: sale.productId, productImagePath: sale.productImagePathSnapshot,
      recognizedAt: new Date().toISOString(), rawTranscript: '', revision: sale.revision || 1,
      syncStatus: 'SYNCED',
    }));
    applyCommittedSales(owner, records);
    const session = activeSessionRef.current;
    if (session) setFeed(buildLocalFeed(session.id, session.revision));
  }, [applyCommittedSales, buildLocalFeed]);

  // Handle automatic candidate commit
  const handleCommitCandidate = useCallback(
    async (cand: VoiceSaleCandidate) => {
      if (cand.type === 'SALE' && cand.productId) {
        const request = captureRequest();
        if (!request.workspaceId || activeSessionRef.current?.id !== cand.sessionId) return;
        const operationId = crypto.randomUUID();
        const buyers = await resolveSaleBuyers(request.workspaceId, cand.sessionId, [
          {
            buyerId: cand.buyerId || cand.buyerNickname || 'anon',
            quantity: cand.quantity,
            sourceCommentIds: cand.sourceCommentId ? [cand.sourceCommentId] : [],
          },
        ]);
        if (!isCurrentRequest(request)) return;
        const resp = await productSalesApi.commitSales({
          operationId,
          sessionId: cand.sessionId,
          productId: cand.productId,
          expectedProductRevision: cand.productRevision || 1,
          expectedSessionRevision: cand.sessionRevision,
          buyers,
        });
        if (isCurrentIdentity(request)) acceptCommittedSales(request.workspaceId, cand.sessionId, resp);
      }
    },
    [acceptCommittedSales, captureRequest, isCurrentIdentity, isCurrentRequest, resolveSaleBuyers]
  );

  useEffect(() => {
    const previewMs = settings?.voicePreviewMs || 2500;
    const controller = new VoiceCandidateController(
      previewMs,
      (c) => setCandidate(c),
      handleCommitCandidate
    );
    controllerRef.current = controller;
    return () => controller.cancel();
  }, [settings?.voicePreviewMs, handleCommitCandidate]);

  const updateSettings = useCallback(
    async (newSettings: Partial<ProductSalesSettings>) => {
      if (!settings) return;
      const request = captureRequest();
      const operationId = crypto.randomUUID();
      const resp = await productSalesApi.updateSettings(operationId, settings.revision, newSettings);
      if (!isCurrentRequest(request) || !request.workspaceId || !bootstrapRef.current) return;
      const next = { ...bootstrapRef.current, settings: resp.settings };
      bootstrapRef.current = next;
      setBootstrap(next);
      storageService.saveBootstrapCache(next, request.workspaceId);
    },
    [settings, captureRequest, isCurrentRequest]
  );

  const prepareProduct = useCallback(
    async (
      requestedProductCode?: string,
      name?: string,
      unitPrice?: number,
      imageKind: 'PHOTO' | 'NUMBER_IMAGE' = 'PHOTO'
    ) => {
      const session = activeSessionRef.current;
      const request = captureRequest();
      if (!session) throw new Error('활성 방송 회차가 없습니다.');
      const operationId = crypto.randomUUID();
      const resp = await productSalesApi.prepareProduct({
        operationId,
        sessionId: session.id,
        expectedSessionRevision: session.revision,
        requestedProductCode,
        name,
        unitPrice,
        imageKind,
      });
      if (!isCurrentRequest(request)) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');

      return {
        draftId: resp.draftId,
        draftRevision: resp.draftRevision,
        productId: resp.productId,
        productCode: resp.productCode,
        uploadUrl: resp.imageUpload?.uploadUrl,
      };
    },
    [captureRequest, isCurrentRequest]
  );

  const commitProduct = useCallback(
    async (draftId: string, draftRevision: number) => {
      const session = activeSessionRef.current;
      const request = captureRequest();
      if (!session) return null;
      const operationId = crypto.randomUUID();
      const response = await productSalesApi.commitProduct({
        operationId,
        draftId,
        expectedDraftRevision: draftRevision,
        expectedSessionRevision: session.revision,
      });
      if (!isCurrentRequest(request)) return null;
      const product = await hydrateProduct(response.product);
      if (!isCurrentRequest(request) || !request.workspaceId) return null;
      const nextSession = { ...session, ...response.session };
      applyProductState(request.workspaceId, nextSession, product);
      return product;
    },
    [applyProductState, captureRequest, isCurrentRequest]
  );

  const registerProduct = useCallback(
    async (params: {
      requestedProductCode?: string;
      name?: string;
      unitPrice?: number;
      imageDataUrl?: string;
      imageKind?: ImageKind;
      source?: 'WEB_VOICE' | 'MANUAL';
    }): Promise<ProductSalesProduct> => {
      const session = activeSessionRef.current;
      const request = captureRequest();
      if (!session) throw new Error('활성 방송 회차가 없습니다.');

      const imageKind = params.imageDataUrl ? (params.imageKind || 'PHOTO') : 'NUMBER_IMAGE';
      const operationId = crypto.randomUUID();
      const prepared = await productSalesApi.prepareProduct({
        operationId,
        sessionId: session.id,
        expectedSessionRevision: session.revision,
        requestedProductCode: params.requestedProductCode,
        name: params.name,
        unitPrice: params.unitPrice ?? 0,
        imageKind,
      });
      if (!isCurrentRequest(request)) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');

      const imageDataUrl = params.imageDataUrl || createNumberProductImage(prepared.productCode);
      if (!prepared.imageUpload?.uploadUrl) throw new Error('상품 이미지 업로드 주소를 만들지 못했습니다.');
      await uploadProductImageDataUrl(prepared.imageUpload.uploadUrl, imageDataUrl);
      if (!isCurrentRequest(request)) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');

      const commitResponse = await productSalesApi.commitProduct({
        operationId: crypto.randomUUID(),
        draftId: prepared.draftId,
        expectedDraftRevision: prepared.draftRevision,
        expectedSessionRevision: session.revision,
        source: params.source || 'MANUAL',
      });
      if (!isCurrentRequest(request)) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');
      const product = await hydrateProduct(commitResponse.product);
      if (!isCurrentRequest(request) || !request.workspaceId) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');
      if (!product) throw new Error('등록된 상품을 불러오지 못했습니다.');

      const nextSession = { ...session, ...commitResponse.session };
      applyProductState(request.workspaceId, nextSession, product);
      return product;
    },
    [applyProductState, captureRequest, isCurrentRequest]
  );

  const commitSales = useCallback(
    async (buyers: CommitSaleBuyer[]): Promise<ProductSalesResult> => {
      const request = captureRequest();
      if (!activeSession || !activeProduct) {
        throw new Error('활성 회차 또는 상품이 없습니다.');
      }
      if (!request.workspaceId) throw new Error('로그인이 필요합니다.');
      const resolvedBuyers = await resolveSaleBuyers(request.workspaceId, activeSession.id, buyers);
      if (!isCurrentRequest(request)) throw new Error('작업공간 또는 방송 회차가 변경되었습니다.');
      const operationId = crypto.randomUUID();
      const resp = await productSalesApi.commitSales({
        operationId,
        sessionId: activeSession.id,
        productId: activeProduct.id,
        expectedProductRevision: activeProduct.revision,
        expectedSessionRevision: activeSession.revision,
        buyers: resolvedBuyers,
      });

      if (isCurrentIdentity(request)) acceptCommittedSales(request.workspaceId, activeSession.id, resp);
      return resp;
    },
    [activeSession, activeProduct, acceptCommittedSales, captureRequest, isCurrentIdentity, isCurrentRequest, resolveSaleBuyers]
  );

  const processVoiceUtterance = useCallback(
    (transcript: string, isFinal: boolean) => {
      if (!isFinal || !transcript.trim()) return;
      if (!activeSession) return;

      const parsed = parseVoiceCommand(transcript, settings?.voiceCommands);
      if (parsed.action === 'confirmSale') {
        if (!activeProduct) return;
        controllerRef.current?.createCandidate(
          'SALE',
          activeSession.id,
          activeSession.revision,
          activeProduct.id,
          activeProduct.revision,
          activeProduct.unitPrice != null ? activeProduct.unitPrice : undefined,
          undefined,
          parsed.textParam || '구매자',
          parsed.numberParam || 1
        );
      } else if (parsed.action === 'setPrice' && parsed.numberParam) {
        // Price update command
      }
    },
    [activeSession, activeProduct, settings?.voiceCommands]
  );

  const cancelCandidate = useCallback(() => {
    controllerRef.current?.cancel();
  }, []);

  const pauseCandidate = useCallback(() => {
    controllerRef.current?.pauseEditing();
  }, []);

  const resumeCandidate = useCallback(() => {
    controllerRef.current?.resumeCountdown();
  }, []);

  return (
    <ProductSalesContext.Provider
      value={{
        bootstrap,
        activeProduct,
        activeSession,
        settings,
        feed,
        candidate,
        isLoading,
        error,
        loadBootstrap,
        startNewSession,
        setFeedPollingEnabled,
        updateSettings,
        prepareProduct,
        commitProduct,
        registerProduct,
        commitSales,
        processVoiceUtterance,
        cancelCandidate,
        pauseCandidate,
        resumeCandidate,
        pollFeed,
      }}
    >
      {children}
    </ProductSalesContext.Provider>
  );
};

export function useProductSales() {
  const context = useContext(ProductSalesContext);
  if (!context) {
    throw new Error('useProductSales must be used within a ProductSalesProvider');
  }
  return context;
}
