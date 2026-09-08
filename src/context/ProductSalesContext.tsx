import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  ProductSalesBootstrapData,
  ProductSalesProduct,
  ProductSalesSession,
  ProductSalesSettings,
  ProductSalesFeedData,
  CommitSaleBuyer,
  ProductSalesResult,
  ProductSalesDraft,
} from '../types/productSales';
import { productSalesApi } from '../services/productSalesApi';
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

  loadBootstrap: () => Promise<void>;
  updateSettings: (newSettings: Partial<ProductSalesSettings>) => Promise<void>;
  prepareProduct: (
    requestedProductCode?: string,
    name?: string,
    unitPrice?: number,
    imageKind?: 'PHOTO' | 'NUMBER_IMAGE'
  ) => Promise<{ draftId: string; draftRevision: number; productCode: string }>;
  commitProduct: (draftId: string, draftRevision: number) => Promise<void>;
  commitSales: (buyers: CommitSaleBuyer[]) => Promise<ProductSalesResult>;
  processVoiceUtterance: (transcript: string, isFinal: boolean) => void;
  cancelCandidate: () => void;
  pauseCandidate: () => void;
  resumeCandidate: () => void;
  pollFeed: () => Promise<void>;
}

const ProductSalesContext = createContext<ProductSalesContextType | null>(null);

export const ProductSalesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [bootstrap, setBootstrap] = useState<ProductSalesBootstrapData | null>(null);
  const [feed, setFeed] = useState<ProductSalesFeedData | null>(null);
  const [candidate, setCandidate] = useState<VoiceSaleCandidate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<VoiceCandidateController | null>(null);

  const activeProduct = bootstrap?.activeProduct || null;
  const activeSession = bootstrap?.activeSession || null;
  const settings = bootstrap?.settings || null;

  const loadBootstrap = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await productSalesApi.getBootstrap();
      setBootstrap(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || '부트스트랩 로딩 실패');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pollFeed = useCallback(async () => {
    if (!activeSession) return;
    try {
      const feedData = await productSalesApi.getSalesFeed({
        sessionId: activeSession.id,
        limit: 50,
      });
      setFeed(feedData);
    } catch {
      // Background poll failure silent
    }
  }, [activeSession]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!activeSession) return;
    pollFeed();
    const timer = setInterval(pollFeed, 2000);
    return () => clearInterval(timer);
  }, [activeSession, pollFeed]);

  // Handle automatic candidate commit
  const handleCommitCandidate = useCallback(
    async (cand: VoiceSaleCandidate) => {
      if (cand.type === 'SALE' && cand.productId) {
        const operationId = `op_cand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      const operationId = `op_set_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      if (!activeSession) throw new Error('활성 방송 회차가 없습니다.');
      const operationId = `op_prep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const resp = await productSalesApi.prepareProduct({
        operationId,
        sessionId: activeSession.id,
        expectedSessionRevision: activeSession.revision,
        requestedProductCode,
        name,
        unitPrice,
        imageKind,
      });

      return {
        draftId: resp.draftId,
        draftRevision: resp.draftRevision,
        productCode: resp.productCode,
      };
    },
    [activeSession]
  );

  const commitProduct = useCallback(
    async (draftId: string, draftRevision: number) => {
      if (!activeSession) return;
      const operationId = `op_com_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await productSalesApi.commitProduct({
        operationId,
        draftId,
        expectedDraftRevision: draftRevision,
        expectedSessionRevision: activeSession.revision,
      });
      await loadBootstrap();
    },
    [activeSession, loadBootstrap]
  );

  const commitSales = useCallback(
    async (buyers: CommitSaleBuyer[]): Promise<ProductSalesResult> => {
      if (!activeSession || !activeProduct) {
        throw new Error('활성 회차 또는 상품이 없습니다.');
      }
      const operationId = `op_sales_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
        updateSettings,
        prepareProduct,
        commitProduct,
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
