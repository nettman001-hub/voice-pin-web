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
  ProductSalesDraft,
  ImageKind,
  LiveComment,
} from '../types/productSales';
import { productSalesApi } from '../services/productSalesApi';
import { storageService } from '../services/storageService';
import { resolvePrivateImageUrl } from '../services/remoteWorkspaceService';
import { createNumberProductImage, uploadProductImageDataUrl } from '../services/productImageService';
import { useAuth } from './AuthContext';
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
const SALES_FEED_RETRY_BASE_MS = 4_000;
const SALES_FEED_RETRY_MAX_MS = 30_000;
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
  const { isAuthenticated, user } = useAuth();
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

  const activeProduct = bootstrap?.activeProduct || null;
  const activeSession = bootstrap?.activeSession || null;
  const settings = bootstrap?.settings || null;
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const shouldPollSalesFeed = isAuthenticated && feedPollingEnabled && SALES_FEED_POLL_PATHS.has(normalizedPath);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    activeProductRef.current = activeProduct;
  }, [activeProduct]);

  // 로컬DB(로컬 스토리지 & 메모리)로부터 피드 데이터를 즉시(0ms) 조립하는 헬퍼
  const buildLocalFeed = useCallback((
    sessionId: string,
    sessionRevision?: number,
    overrideActiveProduct?: ProductSalesProduct | null
  ): ProductSalesFeedData => {
    // 1. 로컬DB 판매 테이블에서 현재 세션 누적 판매 통계 SUM / COUNT 집계
    const { summary, buyerStats } = storageService.getSessionSalesSummary(sessionId);

    // 2. 로컬DB 댓글 테이블에서 현재 세션 댓글 읽기
    const localRecords = storageService.getSessionCommentRecords(sessionId);
    const comments: LiveComment[] = localRecords.slice(0, 50).map((r, index) => ({
      id: r.id,
      sessionId: r.sessionId,
      collectorId: 'local-helper',
      platformMessageId: r.platformMessageId || r.id,
      buyerId: null,
      nicknameSnapshot: r.nickname,
      content: r.content,
      capturedAt: r.capturedAt,
      ingestSequence: index + 1,
    }));

    // 3. 로컬DB 활성 상품 읽기
    const currentActive = overrideActiveProduct !== undefined
      ? overrideActiveProduct
      : (activeProductRef.current || storageService.getActiveProduct());

    const currentSession = activeSessionRef.current || storageService.getActiveSession();

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

  // [안전장치 1회 동기화 (Bootstrap)]
  // 방송 시작 또는 화면 새로고침 시 1회만 Supabase에서 최신 상태를 받아와 로컬DB를 초기화/동기화
  const loadBootstrap = useCallback(async (): Promise<ProductSalesBootstrapData | null> => {
    setIsLoading(true);
    try {
      const data = await productSalesApi.getBootstrap();
      const hydratedProduct = await hydrateProduct(data.activeProduct);
      activeSessionRef.current = data.activeSession;
      activeProductRef.current = hydratedProduct;
      const hydratedData = { ...data, activeProduct: hydratedProduct };

      // 로컬DB에 동시 기록하여 초기화
      storageService.saveActiveProduct(hydratedProduct);
      storageService.saveActiveSession(data.activeSession);
      storageService.saveBootstrapCache(hydratedData);

      setBootstrap(hydratedData);
      setError(null);

      // 세션이 있다면 초기 1회 서버 피드/댓글도 동기화하여 로컬DB 채우기
      if (data.activeSession?.id) {
        try {
          const initialFeed = await productSalesApi.getSalesFeed({
            sessionId: data.activeSession.id,
            limit: 50,
          });
          if (initialFeed.comments && initialFeed.comments.length > 0) {
            const commentRecords = initialFeed.comments.map((c) => ({
              id: c.id,
              platformMessageId: c.platformMessageId,
              sessionId: c.sessionId,
              nickname: c.nicknameSnapshot,
              content: c.content,
              capturedAt: c.capturedAt,
            }));
            storageService.addCommentRecords(commentRecords);
          }
        } catch (feedErr) {
          console.warn('[ProductSalesContext] 초기 피드 서버 동기화 실패 (로컬DB로 시작):', feedErr);
        }

        // 초기 로컬 피드 즉시 설정
        const localFeed = buildLocalFeed(data.activeSession.id, data.activeSession.revision, hydratedProduct);
        setFeed(localFeed);
      }

      return hydratedData;
    } catch (err: any) {
      console.warn('[ProductSalesContext] 부트스트랩 API 실패, 로컬 캐시 복원 시도:', err);
      const cached = storageService.getBootstrapCache();
      if (cached) {
        activeSessionRef.current = cached.activeSession;
        activeProductRef.current = cached.activeProduct;
        setBootstrap(cached);
        if (cached.activeSession?.id) {
          setFeed(buildLocalFeed(cached.activeSession.id, cached.activeSession.revision, cached.activeProduct));
        }
        return cached;
      }
      setError(err.message || '부트스트랩 로딩 실패');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [buildLocalFeed]);

  const startNewSession = useCallback(async (): Promise<ProductSalesSession> => {
    await productSalesApi.startSession(crypto.randomUUID());
    const data = await loadBootstrap();
    if (!data?.activeSession) {
      throw new Error('새 방송 회차를 시작하지 못했습니다. 다시 시도해 주세요.');
    }
    return data.activeSession;
  }, [loadBootstrap]);

  const setFeedPollingEnabled = useCallback((enabled: boolean) => {
    setFeedPollingEnabledState(enabled);
  }, []);

  // [2초 주기 조회(읽기)]
  // Supabase에 2초마다 HTTP 쿼리를 날리지 않고, 이미 완벽 동기화된 로컬DB에서 0ms 즉각 읽기 수행!
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
  }, [isAuthenticated, user?.id, loadBootstrap]);

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

  // Handle automatic candidate commit
  const handleCommitCandidate = useCallback(
    async (cand: VoiceSaleCandidate) => {
      if (cand.type === 'SALE' && cand.productId) {
        const operationId = crypto.randomUUID();
        const buyers = [
          {
            buyerId: cand.buyerId || cand.buyerNickname || 'anon',
            quantity: cand.quantity,
            sourceCommentIds: cand.sourceCommentId ? [cand.sourceCommentId] : [],
          },
        ];
        await productSalesApi.commitSales({
          operationId,
          sessionId: cand.sessionId,
          productId: cand.productId,
          expectedProductRevision: cand.productRevision || 1,
          expectedSessionRevision: cand.sessionRevision,
          buyers,
        });
        if (cand.sessionId) {
          setFeed(buildLocalFeed(cand.sessionId, cand.sessionRevision));
        }
      }
    },
    [buildLocalFeed]
  );

  useEffect(() => {
    const previewMs = settings?.voicePreviewMs || 2500;
    controllerRef.current = new VoiceCandidateController(
      previewMs,
      (c) => setCandidate(c),
      handleCommitCandidate
    );
  }, [settings?.voicePreviewMs, handleCommitCandidate]);

  const updateSettings = useCallback(
    async (newSettings: Partial<ProductSalesSettings>) => {
      if (!settings) return;
      const operationId = crypto.randomUUID();
      const resp = await productSalesApi.updateSettings(operationId, settings.revision, newSettings);
      setBootstrap((prev) => {
        if (!prev) return null;
        const next = { ...prev, settings: resp.settings };
        storageService.saveBootstrapCache(next);
        return next;
      });
    },
    [settings]
  );

  const prepareProduct = useCallback(
    async (
      requestedProductCode?: string,
      name?: string,
      unitPrice?: number,
      imageKind: 'PHOTO' | 'NUMBER_IMAGE' = 'PHOTO'
    ) => {
      const session = activeSessionRef.current;
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

      return {
        draftId: resp.draftId,
        draftRevision: resp.draftRevision,
        productId: resp.productId,
        productCode: resp.productCode,
        uploadUrl: resp.imageUpload?.uploadUrl,
      };
    },
    []
  );

  const commitProduct = useCallback(
    async (draftId: string, draftRevision: number) => {
      const session = activeSessionRef.current;
      if (!session) return null;
      const operationId = crypto.randomUUID();
      const response = await productSalesApi.commitProduct({
        operationId,
        draftId,
        expectedDraftRevision: draftRevision,
        expectedSessionRevision: session.revision,
      });
      const product = await hydrateProduct(response.product);
      const nextSession = { ...session, ...response.session };
      activeSessionRef.current = nextSession;
      activeProductRef.current = product;

      // [동시 쓰기] Supabase 업데이트와 동시에 로컬DB에도 활성 상품 및 세션 저장
      storageService.saveActiveProduct(product);
      storageService.saveActiveSession(nextSession);

      setBootstrap((previous) => previous ? {
        ...previous,
        activeProduct: product,
        activeSession: nextSession,
      } : previous);

      // 로컬 피드 즉시 갱신
      setFeed(buildLocalFeed(nextSession.id, nextSession.revision, product));
      return product;
    },
    [buildLocalFeed]
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

      const imageDataUrl = params.imageDataUrl || createNumberProductImage(prepared.productCode);
      if (!prepared.imageUpload?.uploadUrl) throw new Error('상품 이미지 업로드 주소를 만들지 못했습니다.');
      await uploadProductImageDataUrl(prepared.imageUpload.uploadUrl, imageDataUrl);

      const commitResponse = await productSalesApi.commitProduct({
        operationId: crypto.randomUUID(),
        draftId: prepared.draftId,
        expectedDraftRevision: prepared.draftRevision,
        expectedSessionRevision: session.revision,
        source: params.source || 'MANUAL',
      });
      const product = await hydrateProduct(commitResponse.product);
      if (!product) throw new Error('등록된 상품을 불러오지 못했습니다.');

      const nextSession = { ...session, ...commitResponse.session };
      activeSessionRef.current = nextSession;
      activeProductRef.current = product;

      // [동시 쓰기] Supabase 업데이트와 동시에 로컬DB에도 기록
      storageService.saveActiveProduct(product);
      storageService.saveActiveSession(nextSession);

      setBootstrap((previous) => previous ? {
        ...previous,
        activeProduct: product,
        activeSession: nextSession,
      } : previous);

      // 로컬 피드 즉시 갱신
      setFeed(buildLocalFeed(nextSession.id, nextSession.revision, product));
      return product;
    },
    [buildLocalFeed]
  );

  const commitSales = useCallback(
    async (buyers: CommitSaleBuyer[]): Promise<ProductSalesResult> => {
      if (!activeSession || !activeProduct) {
        throw new Error('활성 회차 또는 상품이 없습니다.');
      }
      const operationId = crypto.randomUUID();
      const resp = await productSalesApi.commitSales({
        operationId,
        sessionId: activeSession.id,
        productId: activeProduct.id,
        expectedProductRevision: activeProduct.revision,
        expectedSessionRevision: activeSession.revision,
        buyers: buyers.map((b) => ({
          buyerId: b.buyerId,
          quantity: b.quantity,
          sourceCommentIds: b.sourceCommentIds || [],
        })),
      });

      // 판매 확정 후 로컬 피드 즉시 갱신
      setFeed(buildLocalFeed(activeSession.id, activeSession.revision));
      return resp;
    },
    [activeSession, activeProduct, buildLocalFeed]
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
