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
} from '../types/productSales';
import { productSalesApi } from '../services/productSalesApi';
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
  const feedPollInFlightRef = useRef(false);
  const feedPollRequestIdRef = useRef(0);
  const feedPollFailureCountRef = useRef(0);

  const activeProduct = bootstrap?.activeProduct || null;
  const activeSession = bootstrap?.activeSession || null;
  const settings = bootstrap?.settings || null;
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const shouldPollSalesFeed = isAuthenticated && feedPollingEnabled && SALES_FEED_POLL_PATHS.has(normalizedPath);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const loadBootstrap = useCallback(async (): Promise<ProductSalesBootstrapData | null> => {
    setIsLoading(true);
    try {
      const data = await productSalesApi.getBootstrap();
      const hydratedProduct = await hydrateProduct(data.activeProduct);
      activeSessionRef.current = data.activeSession;
      const hydratedData = { ...data, activeProduct: hydratedProduct };
      setBootstrap(hydratedData);
      setError(null);
      return hydratedData;
    } catch (err: any) {
      setError(err.message || '부트스트랩 로딩 실패');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const pollFeed = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session || feedPollInFlightRef.current) return;

    const requestId = ++feedPollRequestIdRef.current;
    const sessionId = session.id;
    try {
      feedPollInFlightRef.current = true;
      const feedData = await productSalesApi.getSalesFeed({
        sessionId,
        limit: 50,
      });
      const hydratedProduct = await hydrateProduct(feedData.activeProduct);

      // A newer request, session switch, or local write has made this response obsolete.
      if (
        requestId !== feedPollRequestIdRef.current
        || activeSessionRef.current?.id !== sessionId
        || (activeSessionRef.current?.revision ?? 0) > feedData.sessionRevision
      ) {
        return;
      }

      feedPollFailureCountRef.current = 0;
      setFeed({ ...feedData, activeProduct: hydratedProduct });

      setBootstrap((previous) => {
        if (!previous?.activeSession || previous.activeSession.id !== sessionId) return previous;
        if (previous.activeSession.revision > feedData.sessionRevision) return previous;

        const sessionChanged = previous.activeSession.activeProductId !== (hydratedProduct?.id || null)
          || previous.activeSession.revision !== feedData.sessionRevision;
        const productChanged = !isSameProduct(previous.activeProduct, hydratedProduct);

        if (!sessionChanged && !productChanged) return previous;

        return {
          ...previous,
          activeProduct: productChanged ? hydratedProduct : previous.activeProduct,
          activeSession: sessionChanged
            ? {
              ...previous.activeSession,
              activeProductId: hydratedProduct?.id || null,
              revision: feedData.sessionRevision,
            }
            : previous.activeSession,
        };
      });
    } catch {
      if (requestId === feedPollRequestIdRef.current && activeSessionRef.current?.id === sessionId) {
        feedPollFailureCountRef.current = Math.min(feedPollFailureCountRef.current + 1, 10);
      }
    } finally {
      feedPollInFlightRef.current = false;
    }
  }, []);

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

  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!shouldPollSalesFeed || !sessionId) {
      feedPollRequestIdRef.current += 1;
      feedPollFailureCountRef.current = 0;
      return;
    }

    let disposed = false;
    let timer: number | undefined;

    const scheduleNextPoll = async () => {
      const startedAt = Date.now();
      await pollFeed();
      if (disposed || activeSessionRef.current?.id !== sessionId) return;

      const failures = feedPollFailureCountRef.current;
      const delay = failures > 0
        ? Math.min(SALES_FEED_RETRY_BASE_MS * (2 ** (failures - 1)), SALES_FEED_RETRY_MAX_MS)
        : Math.max(0, SALES_FEED_POLL_INTERVAL_MS - (Date.now() - startedAt));

      timer = window.setTimeout(() => {
        void scheduleNextPoll();
      }, delay);
    };

    void scheduleNextPoll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      feedPollRequestIdRef.current += 1;
      feedPollFailureCountRef.current = 0;
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
        await loadBootstrap();
      }
    },
    [loadBootstrap]
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
      setBootstrap((prev) => (prev ? { ...prev, settings: resp.settings } : null));
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
      setBootstrap((previous) => previous ? {
        ...previous,
        activeProduct: product,
        activeSession: nextSession,
      } : previous);
      return product;
    },
    []
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
      setBootstrap((previous) => previous ? {
        ...previous,
        activeProduct: product,
        activeSession: nextSession,
      } : previous);
      return product;
    },
    []
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
      await loadBootstrap();
      return resp;
    },
    [activeSession, activeProduct, loadBootstrap]
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
