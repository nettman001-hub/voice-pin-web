import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { LiveSession, SttTranscriptLog, CaptureItem, SaleRecord } from '../types/live';
import { deepgramService } from '../services/deepgramService';
import { audioCaptureService } from '../services/audioCaptureService';
import { screenCaptureService } from '../services/screenCaptureService';
import { extractSaleFromTranscript, parseKoreanAmount } from '../services/salesExtractor';
import { parseVoiceCommand } from '../services/voiceCommandParser';
import { nicknameVerificationNote, verifyNicknameFromComments } from '../services/commentNicknameVerifier';
import { storageService, generateSessionId, getNextProductCodeForSession } from '../services/storageService';
import { useSales } from './SalesContext';
import { useAuth } from './AuthContext';
import { CaptureAreaConfig } from '../types/rules';
import { SttProvider } from '../types/deepgram';
import { localSttService } from '../services/localSttService';
import { LocalSttModel, LocalSttStatusPayload, SttMode } from '../types/stt';
import { User } from '../types/auth';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { useProductSales } from './ProductSalesContext';
import { ProductSalesProduct } from '../types/productSales';
import { createNumberProductImage } from '../services/productImageService';
import { InterimStreamChunker } from '../services/captionStreamService';
import { buildPendingReasons, buildEvidenceSnapshot } from '../services/pendingSalesService';
import {
  parseVoiceCorrection,
  findTargetSaleForCorrection,
  linkFollowUpToPendingCorrection,
  applyCorrectionToSale,
  rollbackCorrection,
} from '../services/voiceCorrectionService';
import type { PendingCorrectionRequest } from '../types/voiceCorrection';
import { aiSettingsApi } from '../services/aiSettingsApi';

const SONIOX_SALE_TIMEOUT_MS = 10000;
const SONIOX_BUFFER_LIMIT = 600;
const SONIOX_SCAN_TAIL_LIMIT = 64;
const SONIOX_SALE_START_PATTERNS = [
  '구매확정',
  '구매 확정',
  '구매하신 분',
  '구매하신분',
  '결제완료',
  '결제 완료',
  '주문확정',
  '낙찰',
  '판매완료',
  '닉네임'
];
const SONIOX_COMMAND_PATTERNS = [
  '방금 건 삭제',
  '방금거 삭제',
  '방금 건 수정',
  '방금거 수정',
  '수정 시작',
  '수정 완료',
  '수정 끝',
  '화면 캡처',
  '화면캡처',
  '캡처'
];
const VOICE_PRODUCT_DRAFT_TIMEOUT_MS = 30_000;
const NEARBY_CAPTURE_WINDOW_MS = 90_000;

interface VoiceProductDraft {
  id: string;
  startedAt: number;
  requestedProductCode?: string;
  unitPrice?: number;
  imageDataUrl?: string;
  captureFinished: boolean;
  saving: boolean;
}

export function extractSpokenProductCode(text: string): string | undefined {
  const match =
    text.match(/상품\s*번호(?:는|은|가)?\s*([0-9]+)\s*번?/u) ||
    text.match(/상품\s*([0-9]+)\s*번/u) ||
    text.match(/([0-9]+)\s*번\s*상품/u);
  return match?.[1];
}


export interface MatchedRuleItem {
  text: string;
  matchedKeywords: string[];
  action: string;
  timestamp: string;
}

interface LiveContextType {
  isListening: boolean;
  currentSessionId: string;
  sessionStartTime: string | null;
  audioLevel: number;
  waveform: Uint8Array;
  currentInterimTranscript: string;
  liveTranscriptFlow: Array<{ id: string; text: string; timestamp: string }>;
  lastMatchedRuleItem: MatchedRuleItem | null;
  transcriptLogs: SttTranscriptLog[];
  totalSessionTranscriptCount: number;
  downloadSessionTranscripts: (format?: 'txt' | 'csv') => void;
  recentCaptures: CaptureItem[];
  isVoiceEditing: boolean;
  editingFieldInfo: string | null;
  deepgramApiKey: string;
  setDeepgramApiKey: (key: string) => Promise<void>;
  sonioxApiKey: string;
  setSonioxApiKey: (key: string) => Promise<void>;
  sttProvider: SttProvider;
  setSttProvider: (provider: SttProvider) => Promise<void>;
  sttMode: SttMode;
  setSttMode: (mode: SttMode) => void;
  localSttModel: LocalSttModel;
  setLocalSttModel: (model: LocalSttModel) => void;
  localSttStatus: LocalSttStatusPayload;
  sttEngineStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  sttEngineMessage: string;
  isScreenShareConnected: boolean;
  hasScreenShareAudio: boolean;
  startListening: (mode?: 'TAB_AUDIO' | 'MIC') => Promise<void>;
  stopListening: () => void;
  disconnectScreenShare: () => void;
  injectTestMent: (text: string) => void;
  captureCurrentScreen: (
    area?: CaptureAreaConfig,
    triggerWord?: string,
    requiredListeningGeneration?: number,
    targetSaleId?: string | null
  ) => Promise<string>;
}

const LiveContext = createContext<LiveContextType | undefined>(undefined);

export const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addSale, updateSale, sales } = useSales();
  const { isAuthenticated, user, workspaceId, isRemoteAuth } = useAuth();
  const productSales = useProductSales();

  const [isListening, setIsListening] = useState<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>(generateSessionId());
  const [sessionStartTime, setSessionStartTime] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [waveform, setWaveform] = useState<Uint8Array>(new Uint8Array(128));
  const [currentInterimTranscript, setCurrentInterimTranscript] = useState<string>('');
  const [liveTranscriptFlow, setLiveTranscriptFlow] = useState<Array<{ id: string; text: string; timestamp: string }>>([]);
  const [lastMatchedRuleItem, setLastMatchedRuleItem] = useState<MatchedRuleItem | null>(null);
  const [transcriptLogs, setTranscriptLogs] = useState<SttTranscriptLog[]>([]);
  const [totalSessionTranscriptCount, setTotalSessionTranscriptCount] = useState<number>(0);
  const allSessionTranscriptsRef = useRef<SttTranscriptLog[]>([]);
  const [recentCaptures, setRecentCaptures] = useState<CaptureItem[]>([]);
  const [sttEngineStatus, setSttEngineStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');
  const [sttEngineMessage, setSttEngineMessage] = useState<string>('대기 중');
  const [screenConnection, setScreenConnection] = useState(() => screenCaptureService.getConnectionState());
  
  // 방송 중 음성 명령 수정 상태
  const [isVoiceEditing, setIsVoiceEditing] = useState<boolean>(false);
  const [editingFieldInfo, setEditingFieldInfo] = useState<string | null>(null);
  const editTimeoutRef = useRef<number | null>(null);
  const sonioxSaleBufferRef = useRef<string>('');
  const sonioxSaleTimeoutRef = useRef<number | null>(null);
  const sonioxCommandTailRef = useRef<string>('');
  const productSalesRef = useRef(productSales);
  const voiceProductDraftRef = useRef<VoiceProductDraft | null>(null);
  const interimStreamChunkerRef = useRef<InterimStreamChunker>(new InterimStreamChunker());

  // 관리자 공통 STT 공급자 및 API Key 설정
  const [deepgramApiKey, setDeepgramApiKeyState] = useState<string>('');
  const [sonioxApiKey, setSonioxApiKeyState] = useState<string>('');
  const [sttProvider, setSttProviderState] = useState<SttProvider>('DEEPGRAM');

  // STT 모드 (클라우드 vs 로컬) 및 로컬 모델 설정
  const [sttMode, setSttModeState] = useState<SttMode>(storageService.getSttMode());
  const [localSttModel, setLocalSttModelState] = useState<LocalSttModel>(storageService.getLocalSttModel());
  const [localSttStatus, setLocalSttStatus] = useState<LocalSttStatusPayload>(localSttService.getStatus());
  const sttModeRef = useRef<SttMode>(sttMode);

  useEffect(() => {
    sttModeRef.current = sttMode;
  }, [sttMode]);

  useEffect(() => {
    productSalesRef.current = productSales;
  }, [productSales]);

  useEffect(() => {
    return localSttService.subscribeStatus((status) => {
      setLocalSttStatus(status);
    });
  }, []);

  // 공용 STT 설정과 이 계정의 이용 권한은 서버가 단일 원본이다.
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;
    let active = true;
    void remoteWorkspaceService.fetchGlobalSttSettings().then((settings) => {
      if (!active) return;
      if (!settings.configured) {
        setDeepgramApiKeyState('');
        setSonioxApiKeyState('');
        return;
      }
      setSttProviderState(settings.provider);
      if (settings.allowed) {
        setDeepgramApiKeyState(settings.deepgramApiKey);
        setSonioxApiKeyState(settings.sonioxApiKey);
      } else {
        setDeepgramApiKeyState('');
        setSonioxApiKeyState('');
      }
    }).catch((error) => console.error('[Live] 공용 STT 설정 동기화 실패:', error));
    return () => { active = false; };
  }, [user?.id]);

  // 최신 세션/상태 ref 유지
  const isListeningRef = useRef<boolean>(false);
  const isVoiceEditingRef = useRef<boolean>(false);
  const lastSavedSaleRef = useRef<SaleRecord | null>(null);
  const activePendingCorrectionRef = useRef<PendingCorrectionRequest | null>(null);
  const activeAudioSourceModeRef = useRef<'TAB_AUDIO' | 'MIC'>('TAB_AUDIO');
  const previousAuthenticatedRef = useRef<boolean>(isAuthenticated);
  const previousShareAudioRef = useRef<boolean>(screenConnection.hasAudio);
  const shareOwnerUserIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(user?.id ?? null);
  const currentUserRef = useRef<User | null>(user ?? null);
  const isAuthenticatedRef = useRef<boolean>(isAuthenticated);
  const authBoundaryGenerationRef = useRef(0);
  const previousAuthIdentityRef = useRef(`${isAuthenticated}:${user?.id ?? ''}`);
  const listeningGenerationRef = useRef(0);
  const activeListeningUserIdRef = useRef<string | null>(null);
  const startInFlightRef = useRef(false);
  const cloudSttStartTimeRef = useRef<number | null>(null);
  const activeCloudProviderRef = useRef<'DEEPGRAM' | 'SONIOX' | null>(null);
  const currentSessionIdRef = useRef<string>(currentSessionId);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    isListeningRef.current = isListening;
    isVoiceEditingRef.current = isVoiceEditing;
  }, [isListening, isVoiceEditing]);

  useEffect(() => {
    const authIdentity = `${isAuthenticated}:${user?.id ?? ''}`;
    if (previousAuthIdentityRef.current !== authIdentity) {
      previousAuthIdentityRef.current = authIdentity;
      authBoundaryGenerationRef.current += 1;
      voiceProductDraftRef.current = null;
    }
    currentUserIdRef.current = user?.id ?? null;
    currentUserRef.current = user ?? null;
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, user]);

  useEffect(() => screenCaptureService.subscribeConnection((state) => {
    setScreenConnection(state);

    if (!state.isConnected) {
      shareOwnerUserIdRef.current = null;
    } else if (!shareOwnerUserIdRef.current && currentUserIdRef.current) {
      shareOwnerUserIdRef.current = currentUserIdRef.current;
    }
  }), []);

  const setDeepgramApiKey = async (key: string) => {
    if (isSupabaseConfigured && user) {
      await remoteWorkspaceService.saveGlobalSttSettings({ provider: sttProvider, deepgramApiKey: key, sonioxApiKey });
    }
    setDeepgramApiKeyState(key);
  };

  const setSonioxApiKey = async (key: string) => {
    if (isSupabaseConfigured && user) {
      await remoteWorkspaceService.saveGlobalSttSettings({ provider: sttProvider, deepgramApiKey, sonioxApiKey: key });
    }
    setSonioxApiKeyState(key);
  };

  const setSttProvider = async (provider: SttProvider) => {
    if (isSupabaseConfigured && user) {
      await remoteWorkspaceService.saveGlobalSttSettings({ provider, deepgramApiKey, sonioxApiKey });
    }
    setSttProviderState(provider);
  };

  const setSttMode = (mode: SttMode) => {
    setSttModeState(mode);
    sttModeRef.current = mode;
    storageService.setSttMode(mode);
  };

  const setLocalSttModel = (model: LocalSttModel) => {
    setLocalSttModelState(model);
    storageService.setLocalSttModel(model);
    const isAmdOrVulkan = localSttStatus?.device === 'vulkan' || localSttStatus?.hardwareProfile?.vendor === 'AMD';
    const targetDevice = model === 'large-v3-turbo' ? (isAmdOrVulkan ? 'vulkan' : 'cuda') : undefined;
    localSttService.loadModel(model, targetDevice);
  };

  // 비프음/신호음 재생
  const playBeep = (freq: number = 880, durationMs: number = 150) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch {}
  };

  // 음성 수정 10초 무발화 타임아웃 리셋
  const resetVoiceEditTimeout = () => {
    if (editTimeoutRef.current) {
      window.clearTimeout(editTimeoutRef.current);
    }
    editTimeoutRef.current = window.setTimeout(() => {
      if (isVoiceEditingRef.current) {
        setIsVoiceEditing(false);
        setEditingFieldInfo(null);
        console.log('[Live] 10초 무발화로 음성 수정 대기 모드 자동 해제');
      }
    }, 10000);
  };

  // 화면 캡처 실행 (스튜디오에서 설정한 윈도우 데스크톱 좌표 영역 및 비디오 스트림 적용)
  const captureCurrentScreen = async (
    areaConfig?: CaptureAreaConfig,
    triggerWord: string = '화면 캡처',
    requiredListeningGeneration?: number,
    targetSaleId?: string | null
  ): Promise<string> => {
    const requestedUserId = currentUserIdRef.current;
    const requestedAuthGeneration = authBoundaryGenerationRef.current;

    if (!isAuthenticatedRef.current || !requestedUserId) {
      console.warn('[Live] 로그인되지 않은 상태의 화면 캡처 요청을 차단했습니다.');
      return '';
    }

    if (
      requiredListeningGeneration !== undefined &&
      (
        listeningGenerationRef.current !== requiredListeningGeneration ||
        !isListeningRef.current ||
        activeListeningUserIdRef.current !== requestedUserId
      )
    ) {
      return '';
    }

    if (
      shareOwnerUserIdRef.current &&
      shareOwnerUserIdRef.current !== requestedUserId
    ) {
      console.warn('[Live] 다른 계정이 연결한 화면 캡처 요청을 차단했습니다.');
      return '';
    }

    // 1. 판매자가 캡처 영역 설정에서 지정한 윈도우 데스크톱 영역 로드
    const configuredArea = areaConfig || storageService.getCaptureAreaConfig() || {
      preset: 'COMMENTS',
      name: '틱톡 스튜디오 댓글창 (우측)',
      xRatio: 0.70,
      yRatio: 0.20,
      widthRatio: 0.28,
      heightRatio: 0.75
    };

    // 2. 화면 비디오 스트림 가져오기
    const stream = screenCaptureService.getActiveStream();
    const targetSale = targetSaleId === null
      ? undefined
      : targetSaleId
        ? (sales.find((s) => s.id === targetSaleId) || lastSavedSaleRef.current)
        : lastSavedSaleRef.current;

    const imageUrl = await screenCaptureService.captureArea(stream, configuredArea, {
      nickname: targetSale?.buyerNickname,
      amount: targetSale?.amount,
      timestamp: new Date().toLocaleTimeString('ko-KR')
    });

    const authChanged =
      !isAuthenticatedRef.current ||
      currentUserIdRef.current !== requestedUserId ||
      authBoundaryGenerationRef.current !== requestedAuthGeneration;
    const listeningChanged =
      requiredListeningGeneration !== undefined &&
      (
        listeningGenerationRef.current !== requiredListeningGeneration ||
        !isListeningRef.current ||
        activeListeningUserIdRef.current !== requestedUserId
      );

    // 공유 선택/프레임 디코딩 중 로그아웃, 계정 전환, 청취 중지가 발생하면
    // 뒤늦게 반환된 이미지를 판매 데이터에 저장하지 않는다.
    if (authChanged || listeningChanged) {
      return '';
    }

    if (!shareOwnerUserIdRef.current && screenCaptureService.getActiveStream()) {
      shareOwnerUserIdRef.current = requestedUserId;
    }

    if (shareOwnerUserIdRef.current !== requestedUserId) {
      return '';
    }

    if (!imageUrl) {
      console.warn('[Live] 캡처 이미지가 비어있습니다.');
      return '';
    }

    const newCapture: CaptureItem = {
      id: `cap-${Date.now()}`,
      saleId: targetSale?.id,
      sessionId: currentSessionId,
      imageUrl,
      capturedAt: new Date().toISOString(),
      areaName: configuredArea.name,
      triggerWord
    };

    storageService.addCapture(newCapture);
    setRecentCaptures((prev) => [newCapture, ...prev.slice(0, 9)]);

    // 지정 판매 내역 또는 가장 최근 판매 내역에 캡처 이미지 연결
    if (targetSale) {
      const updatedSale: SaleRecord = {
        ...targetSale,
        captureImageUrls: [...(targetSale.captureImageUrls || []), imageUrl],
        productImageUrl: targetSale.productImageUrl || imageUrl,
      };
      updateSale(updatedSale);
      lastSavedSaleRef.current = updatedSale;
    }

    return imageUrl;
  };

  const completeVoiceProductDraft = async (draftId: string) => {
    const draft = voiceProductDraftRef.current;
    if (
      !draft ||
      draft.id !== draftId ||
      draft.saving ||
      !draft.captureFinished ||
      draft.unitPrice === undefined
    ) {
      return;
    }

    const targetSessionId = productSalesRef.current.activeSession?.id || currentSessionIdRef.current;
    const finalProductCode = draft.requestedProductCode || getNextProductCodeForSession(
      targetSessionId,
      sales,
      productSalesRef.current.activeProduct?.productCode
    );
    draft.requestedProductCode = finalProductCode;

    draft.saving = true;
    setEditingFieldInfo(`상품 ${draft.requestedProductCode}번을 등록하는 중입니다...`);
    try {
      const product = await productSalesRef.current.registerProduct({
        requestedProductCode: draft.requestedProductCode,
        unitPrice: draft.unitPrice,
        imageDataUrl: draft.imageDataUrl,
        imageKind: draft.imageDataUrl ? 'PHOTO' : 'NUMBER_IMAGE',
        source: 'WEB_VOICE',
      });
      if (voiceProductDraftRef.current?.id === draftId) voiceProductDraftRef.current = null;
      setEditingFieldInfo(null);
      setLastMatchedRuleItem({
        text: `상품번호 ${product.productCode}번 · 가격 ${Number(product.unitPrice || 0).toLocaleString()}원`,
        matchedKeywords: ['상품등록', '상품번호', '가격'],
        action: '📦 상품등록 완료 · 음성',
        timestamp: new Date().toLocaleTimeString('ko-KR'),
      });
      playBeep(1318, 180);
    } catch (error) {
      draft.saving = false;
      setEditingFieldInfo(null);
      setLastMatchedRuleItem({
        text: `상품번호 ${draft.requestedProductCode}번`,
        matchedKeywords: ['상품등록'],
        action: `⚠️ 상품등록 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
      });
    }
  };

  const handleVoiceProductTranscript = (fullText: string, requiredListeningGeneration?: number): string | null => {
    const hasRegisterCommand = /상품\s*등록/u.test(fullText);
    let draft = voiceProductDraftRef.current;
    const now = Date.now();

    if (draft && now - draft.startedAt > VOICE_PRODUCT_DRAFT_TIMEOUT_MS) {
      voiceProductDraftRef.current = null;
      draft = null;
    }

    if (hasRegisterCommand) {
      const draftId = `voice-product-${crypto.randomUUID()}`;
      const targetSessionId = productSalesRef.current.activeSession?.id || currentSessionIdRef.current;
      const defaultAutoCode = getNextProductCodeForSession(
        targetSessionId,
        sales,
        productSalesRef.current.activeProduct?.productCode
      );
      draft = {
        id: draftId,
        startedAt: now,
        requestedProductCode: defaultAutoCode,
        captureFinished: false,
        saving: false,
      };
      voiceProductDraftRef.current = draft;
      setEditingFieldInfo(`상품 촬영 중 · "상품번호 ${defaultAutoCode}번", "가격은 35,000원"이라고 말씀하세요.`);

      void captureCurrentScreen(
        undefined,
        '상품등록 음성 촬영',
        requiredListeningGeneration,
        null
      ).then((imageDataUrl) => {
        const latest = voiceProductDraftRef.current;
        if (!latest || latest.id !== draftId) return;
        latest.imageDataUrl = imageDataUrl || undefined;
        latest.captureFinished = true;
        void completeVoiceProductDraft(draftId);
      }).catch(() => {
        const latest = voiceProductDraftRef.current;
        if (!latest || latest.id !== draftId) return;
        latest.captureFinished = true;
        void completeVoiceProductDraft(draftId);
      });
    }

    if (!draft) return null;

    const productCode = extractSpokenProductCode(fullText);
    if (productCode) draft.requestedProductCode = productCode;

    if (/(가격|단가)/u.test(fullText)) {
      const parsedPrice = parseKoreanAmount(fullText);
      if (parsedPrice !== null) draft.unitPrice = parsedPrice;
      else if (/0\s*원/u.test(fullText)) draft.unitPrice = 0;
    }

    void completeVoiceProductDraft(draft.id);

    if (hasRegisterCommand) return '📸 상품등록 촬영 · 음성 정보 대기';
    if (productCode) return `🔢 상품번호 ${productCode}번 인식`;
    if (draft.unitPrice !== undefined && /(가격|단가)/u.test(fullText)) {
      return `💰 상품가격 ${draft.unitPrice.toLocaleString()}원 인식`;
    }
    return null;
  };

  const ensureProductForVoiceSale = async (): Promise<{
    product: ProductSalesProduct | null;
    fallbackCode?: string;
    fallbackImageDataUrl?: string;
  }> => {
    const currentProduct = productSalesRef.current.activeProduct;
    if (currentProduct) return { product: currentProduct };

    const targetSessionId = productSalesRef.current.activeSession?.id || currentSessionIdRef.current;
    const autoCode = getNextProductCodeForSession(
      targetSessionId,
      sales,
      productSalesRef.current.activeProduct?.productCode
    );

    const draft = voiceProductDraftRef.current;
    const recentCapture = storageService.getCaptures().find((capture) => {
      const capturedAt = new Date(capture.capturedAt).getTime();
      return capture.sessionId === currentSessionIdRef.current
        && Number.isFinite(capturedAt)
        && Date.now() - capturedAt <= NEARBY_CAPTURE_WINDOW_MS;
    });
    const fallbackImageDataUrl = draft?.imageDataUrl || recentCapture?.imageUrl;
    const requestedCode = draft?.requestedProductCode || autoCode;
    const unitPrice = draft?.unitPrice ?? 0;
    const codeWasGenerated = !draft?.requestedProductCode;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const numericBase = parseInt(requestedCode, 10);
      const productCode = attempt === 0
        ? requestedCode
        : (!isNaN(numericBase) ? String(numericBase + attempt) : `${requestedCode}_${attempt}`);

      try {
        const product = await productSalesRef.current.registerProduct({
          requestedProductCode: productCode,
          unitPrice,
          imageDataUrl: fallbackImageDataUrl,
          imageKind: fallbackImageDataUrl ? 'PHOTO' : 'NUMBER_IMAGE',
          source: 'WEB_VOICE',
        });
        voiceProductDraftRef.current = null;
        return { product };
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (!(codeWasGenerated && code === 'PRODUCT_CODE_EXISTS' && attempt < 2)) {
          console.error('[Live] 판매용 임시 상품 생성 실패:', error);
          break;
        }
      }
    }

    return {
      product: null,
      fallbackCode: requestedCode,
      fallbackImageDataUrl: fallbackImageDataUrl || createNumberProductImage(requestedCode),
    };
  };

  const persistVoiceSale = async (
    saleResult: NonNullable<ReturnType<typeof extractSaleFromTranscript>>,
    fullText: string,
    hasCaptureInstruction: boolean,
    requiredListeningGeneration?: number
  ) => {
    const recognizedAt = new Date().toISOString();
    const nicknameVerification = verifyNicknameFromComments({
      transcript: fullText,
      spokenNickname: saleResult.buyerNickname,
      sessionId: currentSessionIdRef.current,
      recognizedAt,
      comments: storageService.getCommentRecords()
    });
    const hasVerifiedCommentNickname = Boolean(nicknameVerification.verifiedNickname);
    const isSuffixReference = Boolean(nicknameVerification.suffixDigits);
    const buyerNickname = hasVerifiedCommentNickname
      ? nicknameVerification.verifiedNickname!
      : isSuffixReference
        ? '미확인(보류)'
        : saleResult.buyerNickname;
    const status = hasVerifiedCommentNickname ? saleResult.status : '보류';

    const productLink = await ensureProductForVoiceSale();
    const product = productLink.product;
    const sessionId = productSalesRef.current.activeSession?.id || currentSessionIdRef.current;
    const fallbackAutoCode = getNextProductCodeForSession(
      sessionId,
      sales,
      productSalesRef.current.activeProduct?.productCode
    );
    const resolvedProductCode = product?.productCode || productLink.fallbackCode || fallbackAutoCode;

    // 최근 60초 내 캡처된 화면이 있으면 연결
    const recentCapture = storageService.getCaptures().find((capture) => {
      const capturedAt = new Date(capture.capturedAt).getTime();
      return capture.sessionId === currentSessionIdRef.current
        && Number.isFinite(capturedAt)
        && Date.now() - capturedAt <= 60000;
    });
    const fallbackImage = productLink.fallbackImageDataUrl || recentCapture?.imageUrl;

    const pendingReasons = status === '보류'
      ? buildPendingReasons(
          { rawTranscript: fullText, buyerNickname, amount: saleResult.amount },
          {
            comments: storageService.getCommentRecords(),
            activeProduct: product ? { unitPrice: product.unitPrice ?? undefined, productCode: resolvedProductCode } : undefined,
          }
        )
      : [];

    const evidenceSnapshot = buildEvidenceSnapshot(
      {
        rawTranscript: fullText,
        recognizedAt,
        buyerNickname,
        amount: saleResult.amount,
        productCode: resolvedProductCode,
        productName: product?.name || undefined,
        unitPrice: product?.unitPrice ?? 0,
        quantity: 1,
        captureImageUrls: fallbackImage ? [fallbackImage] : undefined,
      },
      {
        relevantCommentIds: nicknameVerification.commentId ? [nicknameVerification.commentId] : [],
        snapshotVersion: 1,
      }
    );

    const saved = addSale({
      sessionId,
      buyerNickname,
      amount: saleResult.amount,
      recognizedAt,
      rawTranscript: fullText,
      status,
      note: nicknameVerificationNote(nicknameVerification),
      productId: product?.id,
      productCode: resolvedProductCode,
      productName: product?.name || undefined,
      productImageUrl: product?.imageUrl || fallbackImage,
      productImagePath: product?.imagePath,
      quantity: 1,
      unitPrice: product?.unitPrice ?? 0,
      source: 'WEB_VOICE',
      captureImageUrls: fallbackImage ? [fallbackImage] : undefined,
      revision: 1,
      pendingReasons: pendingReasons.length > 0 ? pendingReasons : undefined,
      evidenceSnapshot,
    });
    lastSavedSaleRef.current = saved;

    // 화면 공유 스트림이 활성화되어 있거나 '캡처하세요' 발화 시 즉시 화면 캡처 실행하여 판매건에 연동
    const hasActiveStream = Boolean(screenCaptureService.getActiveStream());
    if (hasCaptureInstruction || hasActiveStream) {
      await captureCurrentScreen(
        undefined,
        hasCaptureInstruction ? '캡처하세요 (판매 자동 연동)' : '판매 자동 화면 캡처',
        requiredListeningGeneration,
        saved.id
      );
    }
  };

  interface TranscriptProcessingOptions {
    skipCommands?: boolean;
    skipSale?: boolean;
    skipCapture?: boolean;
  }

  const clearSonioxSaleTimeout = () => {
    if (sonioxSaleTimeoutRef.current !== null) {
      window.clearTimeout(sonioxSaleTimeoutRef.current);
      sonioxSaleTimeoutRef.current = null;
    }
  };

  const resetSonioxBusinessAccumulator = () => {
    clearSonioxSaleTimeout();
    sonioxSaleBufferRef.current = '';
    sonioxCommandTailRef.current = '';
  };

  function scheduleSonioxSaleTimeout(
    confidence: number,
    requiredListeningGeneration?: number,
    requiredUserId?: string
  ) {
    if (sonioxSaleTimeoutRef.current !== null) return;

    sonioxSaleTimeoutRef.current = window.setTimeout(() => {
      sonioxSaleTimeoutRef.current = null;
      const pendingText = sonioxSaleBufferRef.current.trim();
      sonioxSaleBufferRef.current = '';

      if (!pendingText) return;
      handleTranscript(
        { text: pendingText, isFinal: true, confidence },
        requiredListeningGeneration,
        requiredUserId,
        { skipCommands: true, skipCapture: true }
      );
    }, SONIOX_SALE_TIMEOUT_MS);
  }

  function scanSonioxCommands(
    confirmedTextDelta: string,
    confidence: number,
    requiredListeningGeneration?: number,
    requiredUserId?: string
  ) {
    const previousTail = sonioxCommandTailRef.current;
    const scanText = `${previousTail}${confirmedTextDelta}`;
    const matches: Array<{ start: number; end: number; text: string }> = [];

    for (const pattern of SONIOX_COMMAND_PATTERNS) {
      let searchIndex = 0;
      while (searchIndex < scanText.length) {
        const start = scanText.indexOf(pattern, searchIndex);
        if (start < 0) break;
        const end = start + pattern.length;

        // 이전 tail 안에서 이미 완성됐던 패턴은 다시 실행하지 않는다.
        if (end > previousTail.length) {
          matches.push({ start, end, text: pattern });
        }
        searchIndex = start + 1;
      }
    }

    matches.sort((a, b) => a.start - b.start || b.text.length - a.text.length);
    const accepted: typeof matches = [];
    for (const match of matches) {
      if (accepted.some((item) => match.start < item.end && match.end > item.start)) continue;
      accepted.push(match);
    }

    for (const match of accepted) {
      const isCaptureCommand = match.text.includes('캡처');
      handleTranscript(
        { text: match.text, isFinal: true, confidence },
        requiredListeningGeneration,
        requiredUserId,
        isCaptureCommand
          ? { skipCommands: true, skipSale: true }
          : { skipSale: true, skipCapture: true }
      );

      if (match.text === '수정 시작' || match.text.includes('수정')) {
        clearSonioxSaleTimeout();
        sonioxSaleBufferRef.current = '';
      }
    }

    sonioxCommandTailRef.current = scanText.slice(-SONIOX_SCAN_TAIL_LIMIT);
  }

  function consumeSonioxConfirmedText(
    confirmedTextDelta: string,
    confidence: number,
    requiredListeningGeneration?: number,
    requiredUserId?: string
  ) {
    if (!confirmedTextDelta) return;

    scanSonioxCommands(
      confirmedTextDelta,
      confidence,
      requiredListeningGeneration,
      requiredUserId
    );

    sonioxSaleBufferRef.current = `${sonioxSaleBufferRef.current}${confirmedTextDelta}`;
    if (sonioxSaleBufferRef.current.length > SONIOX_BUFFER_LIMIT) {
      sonioxSaleBufferRef.current = sonioxSaleBufferRef.current.slice(-SONIOX_BUFFER_LIMIT);
    }

    // 음성 수정 중에는 판매로 저장하지 않고 닉네임/금액 수정 문장을 완성해서 처리한다.
    if (isVoiceEditingRef.current) {
      const editCommand = parseVoiceCommand(sonioxSaleBufferRef.current, true);
      if (editCommand.type === 'FIELD_UPDATE') {
        const editText = sonioxSaleBufferRef.current.trim();
        clearSonioxSaleTimeout();
        sonioxSaleBufferRef.current = '';
        handleTranscript(
          { text: editText, isFinal: true, confidence },
          requiredListeningGeneration,
          requiredUserId,
          { skipSale: true, skipCapture: true }
        );
      }
      return;
    }

    const buffer = sonioxSaleBufferRef.current;
    const triggerPositions = SONIOX_SALE_START_PATTERNS
      .map((pattern) => buffer.indexOf(pattern))
      .filter((index) => index >= 0);

    if (triggerPositions.length === 0) {
      sonioxSaleBufferRef.current = buffer.slice(-SONIOX_SCAN_TAIL_LIMIT);
      return;
    }

    const saleStart = Math.min(...triggerPositions);
    if (saleStart > 0) {
      // "러블리님 구매확정"처럼 트리거 앞에 닉네임이 먼저 나온 경우를 보존한다.
      sonioxSaleBufferRef.current = buffer.slice(Math.max(0, saleStart - 32));
    }

    const rules = storageService.getRules().filter((rule) => rule.isEnabled);
    const saleResult = extractSaleFromTranscript(
      sonioxSaleBufferRef.current,
      rules.map((rule) => rule.word)
    );

    if (saleResult && !saleResult.isPending) {
      const completeSaleText = sonioxSaleBufferRef.current.trim();
      clearSonioxSaleTimeout();
      sonioxSaleBufferRef.current = '';
      handleTranscript(
        { text: completeSaleText, isFinal: true, confidence },
        requiredListeningGeneration,
        requiredUserId,
        { skipCommands: true, skipCapture: true }
      );
      return;
    }

    scheduleSonioxSaleTimeout(confidence, requiredListeningGeneration, requiredUserId);
  }

  function handleSonioxTranscript(
    data: {
      text: string;
      isFinal: boolean;
      confidence: number;
      confirmedTextDelta?: string;
    },
    requiredListeningGeneration?: number,
    requiredUserId?: string
  ) {
    if (data.confirmedTextDelta) {
      consumeSonioxConfirmedText(
        data.confirmedTextDelta,
        data.confidence,
        requiredListeningGeneration,
        requiredUserId
      );
    }

    if (!data.isFinal) {
      const { newFlowItems, displayInterimText } = interimStreamChunkerRef.current.processInterim(data.text);
      if (newFlowItems.length > 0) {
        setLiveTranscriptFlow((prev) => [...prev.slice(-30), ...newFlowItems]);
      }
      setCurrentInterimTranscript(displayInterimText);
      return;
    }

    setCurrentInterimTranscript('');
    // 수동 최종화 구간은 자막/로그로만 기록한다. 업무 액션은 위 확정 토큰 누적기가 처리한다.
    handleTranscript(
      { text: data.text, isFinal: true, confidence: data.confidence },
      requiredListeningGeneration,
      requiredUserId,
      { skipCommands: true, skipSale: true, skipCapture: true }
    );
  }

  // 실시간 전사 처리 핸들러
  function handleTranscript(
    data: {
      text: string;
      isFinal: boolean;
      confidence: number;
      provider?: 'DEEPGRAM' | 'SONIOX' | 'WEB_SPEECH' | 'LOCAL_WHISPER' | 'NONE';
      confirmedTextDelta?: string;
      isAbnormal?: boolean;
      abnormalReason?: string;
    },
    requiredListeningGeneration?: number,
    requiredUserId?: string,
    processingOptions: TranscriptProcessingOptions = {}
  ) {
    if (!isAuthenticatedRef.current || !currentUserIdRef.current) return;

    if (
      requiredListeningGeneration !== undefined &&
      (
        listeningGenerationRef.current !== requiredListeningGeneration ||
        !isListeningRef.current ||
        activeListeningUserIdRef.current !== requiredUserId ||
        currentUserIdRef.current !== requiredUserId
      )
    ) {
      return;
    }

    if (!data.text) return;

    // [로컬 STT 비정상 반복 생성 방어] 동일 글자/어절 반복 등 환각 시 업무 파이프라인(판매/캡처) 진입 원천 차단
    if (data.isAbnormal) {
      const abnormalTime = new Date().toLocaleTimeString('ko-KR');
      console.warn(`[LiveContext] 로컬 STT 비정상 반복 전사 차단 (${data.abnormalReason}):`, data.text);
      interimStreamChunkerRef.current.reset();
      setCurrentInterimTranscript('');
      setLiveTranscriptFlow((prev) => [
        ...prev.slice(-30),
        {
          id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          text: `⚠️ [반복 감지 차단] ${data.text.slice(0, 30)}...`,
          timestamp: abnormalTime
        }
      ]);
      return;
    }

    if (data.provider === 'SONIOX') {
      handleSonioxTranscript(data, requiredListeningGeneration, requiredUserId);
      return;
    }

    if (!data.isFinal) {
      const { newFlowItems, displayInterimText } = interimStreamChunkerRef.current.processInterim(data.text);
      if (newFlowItems.length > 0) {
        setLiveTranscriptFlow((prev) => [...prev.slice(-30), ...newFlowItems]);
      }
      setCurrentInterimTranscript(displayInterimText);
      return;
    }

    // 최종 텍스트 확정
    setCurrentInterimTranscript('');
    const fullText = data.text.trim();
    const nowTime = new Date().toLocaleTimeString('ko-KR');

    // 윗부분 자막 스트림에 추가 (최대 2줄 분할 및 순차 시간표시 적용)
    const finalizedFlowItems = interimStreamChunkerRef.current.finalize(fullText);
    if (finalizedFlowItems.length > 0) {
      setLiveTranscriptFlow((prev) => [
        ...prev.slice(-30),
        ...finalizedFlowItems
      ]);
    }

    const rules = storageService.getRules().filter((r) => r.isEnabled);
    const activeKeywords = rules.map((r) => r.word);
    const matchedKeywords = activeKeywords.filter((kw) => fullText.includes(kw));

    let actionTriggered: SttTranscriptLog['actionTriggered'] = 'NONE';
    let ruleActionName = handleVoiceProductTranscript(fullText, requiredListeningGeneration) || '';

    // 1. 방송 중 음성 명령 파싱 ("수정 시작" / "닉네임은 xxx" / "수정 완료")
    const command = processingOptions.skipCommands
      ? { type: 'NONE' as const, rawText: fullText }
      : parseVoiceCommand(fullText, isVoiceEditingRef.current);

    if (command.type === 'START_EDIT') {
      isVoiceEditingRef.current = true;
      setIsVoiceEditing(true);
      setEditingFieldInfo('수정 대기 중: "닉네임은 홍길동, 금액은 3만원"처럼 말씀해주세요.');
      actionTriggered = 'VOICE_EDIT_START';
      ruleActionName = '🎙️ 음성 수정 시작';
      playBeep(880, 200);
      resetVoiceEditTimeout();
    } else if (command.type === 'FINISH_EDIT') {
      isVoiceEditingRef.current = false;
      setIsVoiceEditing(false);
      setEditingFieldInfo(null);
      actionTriggered = 'VOICE_EDIT_DONE';
      ruleActionName = '✅ 음성 수정 완료';
      playBeep(1200, 250);
      if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
    } else if (command.type === 'FIELD_UPDATE' && isVoiceEditingRef.current) {
      resetVoiceEditTimeout();
      if (lastSavedSaleRef.current) {
        const target = lastSavedSaleRef.current;
        const updated: SaleRecord = {
          ...target,
          buyerNickname: command.updatedNickname || target.buyerNickname,
          amount: command.updatedAmount !== undefined ? command.updatedAmount : target.amount,
          status: '수동수정'
        };
        updateSale(updated);
        lastSavedSaleRef.current = updated;
        ruleActionName = '✏️ 항목 수정';
        setEditingFieldInfo(`수정됨 -> 닉네임: ${updated.buyerNickname}, 금액: ${updated.amount.toLocaleString()}원 ("수정 완료"를 말씀하세요)`);
      }
    } else if (command.type === 'DELETE_LAST' && lastSavedSaleRef.current) {
      playBeep(440, 300);
      lastSavedSaleRef.current = null;
      ruleActionName = '🗑️ 최근 항목 삭제';
    } else {
      // 1-A. 음성 정정 의도 우선 판별 (PLAN.md 1-B: 일반 판매 추출보다 음성 정정 의도를 먼저 판단)
      const correctionIntent = parseVoiceCorrection(fullText);

      // 1-B. 활성 정정 보류 요청이 있을 때 후속 발화("12번이요") 연결 검사
      if (activePendingCorrectionRef.current && !correctionIntent.isNegativeCommand && !correctionIntent.isQuestion) {
        const linkRes = linkFollowUpToPendingCorrection(
          activePendingCorrectionRef.current,
          fullText,
          sales
        );

        if (linkRes.resolvedSaleId) {
          const target = sales.find((s) => s.id === linkRes.resolvedSaleId);
          if (target) {
            const applyRes = applyCorrectionToSale(
              target,
              activePendingCorrectionRef.current.parsedCorrection,
              { expectedRevision: target.revision }
            );
            updateSale(applyRes.updatedSale);
            if (isRemoteAuth && workspaceId) {
              void aiSettingsApi.applyVoiceCorrection(
                target.id,
                activePendingCorrectionRef.current.parsedCorrection,
                { expectedRevision: target.revision, pendingCorrectionId: activePendingCorrectionRef.current.id, workspaceId }
              );
            }
            activePendingCorrectionRef.current = null;
            actionTriggered = 'CORRECTION_APPLIED';
            ruleActionName = `✅ 후속 연결 정정 완료 (${applyRes.updatedSale.productCode}번)`;
            playBeep(1200, 250);
            return;
          }
        }
      }

      if (correctionIntent.isNegativeCommand || correctionIntent.isQuestion) {
        // "1.2로 변경하지 마세요" 및 질문은 수정 명령으로 실행하지 않음
        actionTriggered = 'CORRECTION_IGNORED';
        ruleActionName = correctionIntent.isNegativeCommand
          ? '⚠️ 정정 미실행 (부정 명령)'
          : '⚠️ 정정 미실행 (질문 형태)';
        playBeep(440, 150);
      } else if (correctionIntent.isCancellation) {
        // "방금 수정한 거 취소" (판매 삭제와 구분)
        if (activePendingCorrectionRef.current) {
          activePendingCorrectionRef.current = null;
          actionTriggered = 'CORRECTION_CANCELLED';
          ruleActionName = '↩️ 미적용 정정 대기 취소';
          playBeep(880, 200);
        } else {
          const target = [...sales].reverse().find((s) =>
            s.history?.some((h) => h.changeType === 'VOICE_CORRECTION')
          );
          if (target) {
            const rollbackRes = rollbackCorrection(target);
            if (rollbackRes.success && rollbackRes.rolledBackSale) {
              updateSale(rollbackRes.rolledBackSale);
              if (isRemoteAuth && workspaceId) {
                void aiSettingsApi.rollbackVoiceCorrection({
                  saleId: target.id,
                  workspaceId,
                });
              }
              actionTriggered = 'CORRECTION_RESTORED';
              ruleActionName = '↩️ 이전 판매값으로 복원';
              playBeep(880, 200);
            } else {
              actionTriggered = 'CORRECTION_CONFLICT';
              ruleActionName = `⚠️ 복원 충돌: ${rollbackRes.conflictReason || '확인 필요'}`;
              playBeep(440, 300);
            }
          } else {
            ruleActionName = '⚠️ 복원할 이전 정정 이력이 없습니다';
            playBeep(440, 200);
          }
        }
      } else if (correctionIntent.isIncomplete) {
        // "0.9가 아니고..." 새 값이 완성될 때까지 초안 대기
        actionTriggered = 'CORRECTION_INCOMPLETE';
        ruleActionName = '⏳ 정정 값 대기 중...';
        playBeep(660, 150);
      } else if (correctionIntent.isCorrection) {
        // 정정 대상 탐색 (상품번호, 기존 구매자, 기존 금액 등)
        const targetResult = findTargetSaleForCorrection(correctionIntent, sales);

        if (targetResult.targetSaleId) {
          const target = sales.find((s) => s.id === targetResult.targetSaleId);
          if (target) {
            const applyRes = applyCorrectionToSale(target, correctionIntent, {
              expectedRevision: target.revision,
            });
            updateSale(applyRes.updatedSale);
            if (isRemoteAuth && workspaceId) {
              void aiSettingsApi.applyVoiceCorrection(target.id, correctionIntent, {
                expectedRevision: target.revision,
                workspaceId,
              });
            }
            actionTriggered = 'CORRECTION_APPLIED';
            ruleActionName = '✏️ 음성 정정 완료';
            playBeep(1200, 250);
          }
        } else if (targetResult.candidates.length > 1) {
          // 복수 후보 존재 시 별도 정정 보류 요청 생성 (마지막 판매 임의 선택 금지)
          const pendingReq: PendingCorrectionRequest = {
            id: `pc-${crypto.randomUUID()}`,
            workspaceId: workspaceId || 'local',
            sessionId: currentSessionIdRef.current || 'default',
            status: 'PENDING',
            targetSaleId: null,
            candidateSaleIds: targetResult.candidates.map((c) => c.id),
            originalUtterance: fullText,
            followUpUtterances: [],
            parsedCorrection: correctionIntent,
            missingInfo: targetResult.missingInfo,
            conflictReason: '동일 조건 복수 판매 후보 존재 (상품번호 확인 필요)',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          activePendingCorrectionRef.current = pendingReq;
          actionTriggered = 'CORRECTION_PENDING';
          ruleActionName = '⚠️ 정정 보류 (상품번호를 말씀하세요)';
          playBeep(660, 250);
        } else {
          actionTriggered = 'CORRECTION_UNMATCHED';
          ruleActionName = '⚠️ 정정 대상 판매 미확인';
          playBeep(440, 200);
        }
      } else {
        // 2. 판매 멘트 감지 ("구매확정 됐습니다...")
        const saleResult = processingOptions.skipSale
          ? null
          : extractSaleFromTranscript(fullText, activeKeywords);

      // 캡처 조건: '캡처하세요' 멘트가 반드시 포함되어 있어야 함
      // (띄어쓰기 유연성 및 단어 규칙 관리 등록 반영)
      const hasCaptureInstruction =
        !processingOptions.skipCapture &&
        (/(캡처\s*하세요|캡쳐\s*하세요)/u.test(fullText) ||
          rules.some(
            (r) =>
              r.isEnabled &&
              (r.word.includes('캡처하세요') || r.word.includes('캡쳐하세요')) &&
              fullText.includes(r.word)
          ));

      if (saleResult) {
        actionTriggered = 'SALE_SAVED';
        const hasActiveStream = Boolean(screenCaptureService.getActiveStream());
        if (hasCaptureInstruction) {
          ruleActionName = '🛍️ 판매 DB 저장 + 📸 캡처하세요 연동';
        } else if (hasActiveStream) {
          ruleActionName = '🛍️ 판매 DB 저장 + 📸 화면 자동 캡처';
        } else {
          ruleActionName = '🛍️ 판매 DB 자동 저장';
        }
        playBeep(1046, 120);
        void persistVoiceSale(
          saleResult,
          fullText,
          hasCaptureInstruction,
          requiredListeningGeneration
        );
      } else if (
        hasCaptureInstruction ||
        (!processingOptions.skipCapture &&
          (fullText.includes('화면캡처') || fullText.includes('화면 캡처')))
      ) {
        // 3. 단독 캡처 트리거 감지 (판매 멘트가 없을 때 '캡처하세요' 또는 '화면 캡처')
        actionTriggered = 'SCREEN_CAPTURED';
        ruleActionName = '📸 화면 자동 캡처';
        void captureCurrentScreen(
          undefined,
          '음성인식 자동캡처',
          requiredListeningGeneration
        );
      }
    }
  }

    // 규칙 지정된 문장이 감지된 경우 아랫부분에 출력할 항목 업데이트
    if (matchedKeywords.length > 0 || ruleActionName) {
      setLastMatchedRuleItem({
        text: fullText,
        matchedKeywords: matchedKeywords.length > 0 ? matchedKeywords : ['규칙 감지'],
        action: ruleActionName || '단어 규칙 일치',
        timestamp: nowTime
      });
    }

    // 전사 로그 적재
    const newLog: SttTranscriptLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: nowTime,
      text: fullText,
      isFinal: true,
      confidence: data.confidence,
      matchedKeywords: matchedKeywords,
      actionTriggered
    };

    // 전사 로그 적재: 화면 UI에는 최근 300건을 유지하여 렉을 원천 방지하고,
    // 전체 회차 전사 로그는 allSessionTranscriptsRef에 8시간 이상 무제한으로 누적 보관
    allSessionTranscriptsRef.current.push(newLog);
    setTotalSessionTranscriptCount(allSessionTranscriptsRef.current.length);
    setTranscriptLogs((prev) => [newLog, ...prev.slice(0, 299)]);
  }

  // 오늘 방송 전체 전사 로그 파일 다운로드 (.txt / .csv)
  const downloadSessionTranscripts = (format: 'txt' | 'csv' = 'txt') => {
    const logs = allSessionTranscriptsRef.current.length > 0
      ? allSessionTranscriptsRef.current
      : [...transcriptLogs].reverse();

    if (logs.length === 0) {
      alert('다운로드할 전사 로그가 없습니다.');
      return;
    }

    const sessionCode = currentSessionId || new Date().toISOString().slice(0, 10);
    const fileName = `VoiceCAP_전사로그_${sessionCode}.${format}`;

    if (format === 'txt') {
      const header = [
        '================================================================',
        `  VoiceCAP 실시간 음성인식 전체 전사 로그`,
        `  방송 회차: ${sessionCode}`,
        `  저장 일시: ${new Date().toLocaleString('ko-KR')}`,
        `  총 전사 건수: ${logs.length.toLocaleString()}건`,
        '================================================================\n',
      ].join('\n');

      const lines = logs.map((log, index) => {
        const actionLabel = log.actionTriggered === 'SALE_SAVED' ? ' [판매저장]'
          : log.actionTriggered === 'SCREEN_CAPTURED' ? ' [댓글캡처]'
          : log.actionTriggered === 'VOICE_EDIT_START' ? ' [수정모드]'
          : '';
        return `[${log.timestamp || index + 1}]${actionLabel} ${log.text}`;
      }).join('\n');

      const blob = new Blob([header + lines], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      const csvHeader = '번호,시간,전사 내용,정확도,감지 키워드,실행 액션\r\n';
      const csvRows = logs.map((log, index) => {
        const escapedText = `"${(log.text || '').replace(/"/g, '""')}"`;
        const keywords = `"${(log.matchedKeywords || []).join('; ').replace(/"/g, '""')}"`;
        const action = `"${log.actionTriggered || ''}"`;
        const confidence = log.confidence ? (log.confidence * 100).toFixed(1) + '%' : '';
        return `${index + 1},"${log.timestamp || ''}",${escapedText},"${confidence}",${keywords},${action}`;
      }).join('\r\n');

      const blob = new Blob(['\uFEFF' + csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // 라이브 청취 시작 (크롬 탭 방송 소리 또는 마이크)
  const startListening = async (mode: 'TAB_AUDIO' | 'MIC' = 'TAB_AUDIO') => {
    if (!isAuthenticatedRef.current || !currentUserIdRef.current) {
      setSttEngineStatus('ERROR');
      setSttEngineMessage('로그인 후 라이브 청취를 시작해 주세요.');
      return;
    }

    // 빠른 이중 클릭이나 아직 닫히지 않은 공유 선택창으로 중복 시작하지 않는다.
    if (startInFlightRef.current || isListeningRef.current) return;

    const requestedUserId = currentUserIdRef.current;
    const requestedAuthGeneration = authBoundaryGenerationRef.current;
    const listeningGeneration = ++listeningGenerationRef.current;
    startInFlightRef.current = true;
    activeListeningUserIdRef.current = requestedUserId;
    resetSonioxBusinessAccumulator();

    try {
      if (
        mode === 'TAB_AUDIO' &&
        screenCaptureService.getActiveStream() &&
        shareOwnerUserIdRef.current &&
        shareOwnerUserIdRef.current !== requestedUserId
      ) {
        // 같은 브라우저에서 다른 계정으로 전환된 경우 이전 계정의 공유를 넘기지 않는다.
        screenCaptureService.stopStream();
        audioCaptureService.stopCapture(false);
      }

      const previousMode = activeAudioSourceModeRef.current;
      activeAudioSourceModeRef.current = mode;
      isListeningRef.current = true;
      const newSessionId = generateSessionId();
      setCurrentSessionId(newSessionId);
      setSessionStartTime(new Date().toISOString());
      setCurrentInterimTranscript('');
      interimStreamChunkerRef.current.reset();
      setIsListening(true);
      setSttEngineStatus('CONNECTING');
      setSttEngineMessage(mode === 'TAB_AUDIO' ? '방송 탭 오디오 연결 확인 중' : '마이크 연결 확인 중');

      const rules = storageService.getRules().filter((r) => r.isEnabled);
      const keyterms = rules.map((r) => r.word.trim()).filter(Boolean);

      const chunkCallback = (chunk: ArrayBuffer) => {
        if (
          listeningGenerationRef.current === listeningGeneration &&
          isListeningRef.current &&
          currentUserIdRef.current === requestedUserId
        ) {
          if (sttModeRef.current === 'LOCAL') {
            localSttService.sendAudioChunk(chunk);
          } else {
            deepgramService.sendAudioChunk(chunk);
          }
        }
      };

      const waveformCallback = (wave: Uint8Array, vol: number) => {
        if (
          listeningGenerationRef.current === listeningGeneration &&
          isListeningRef.current &&
          currentUserIdRef.current === requestedUserId
        ) {
          setWaveform(wave);
          setAudioLevel(vol);
        }
      };

      // 1. 오디오 캡처 시작. TAB_AUDIO 실패 시 마이크로 몰래 전환하지 않는다.
      //    같은 모드의 일시정지된 파이프라인이 살아있으면 재개만 한다.
      //    (트랙을 stop하면 Chrome이 원본 탭 오디오까지 종료시켜 공유 창이 다시 뜬다)
      let captureResumed = false;
      if (mode === 'TAB_AUDIO' && previousMode === 'TAB_AUDIO') {
        captureResumed = await audioCaptureService
          .resumeCapture(chunkCallback, waveformCallback)
          .catch(() => false);
      }

      if (!captureResumed) {
        await audioCaptureService.startCapture(mode, chunkCallback, waveformCallback);
      }

      // 공유 선택창/AudioContext 준비 사이 중지, 로그아웃 또는 계정 전환이 발생했다.
      if (
        listeningGenerationRef.current !== listeningGeneration ||
        !isListeningRef.current ||
        !isAuthenticatedRef.current ||
        currentUserIdRef.current !== requestedUserId ||
        authBoundaryGenerationRef.current !== requestedAuthGeneration
      ) {
        if (mode === 'TAB_AUDIO') {
          audioCaptureService.pauseCapture();
        } else {
          audioCaptureService.stopCapture();
        }
        return;
      }

      if (mode === 'TAB_AUDIO' && screenCaptureService.getActiveStream()) {
        shareOwnerUserIdRef.current = requestedUserId;
      }

      // 2. 실시간 STT 엔진 시작
      if (sttModeRef.current === 'LOCAL') {
        // [내 PC 무료 STT] faster-whisper 로컬 브리지 시작
        const activeLocalModel = localSttModel || storageService.getLocalSttModel();
        localSttService.startListening(
          newSessionId,
          listeningGeneration,
          keyterms.join(', '),
          (data) => {
            handleTranscript(data, listeningGeneration, requestedUserId);
          },
          (err) => {
            if (listeningGenerationRef.current === listeningGeneration) {
              console.error('[Live] 로컬 STT 에러 알림:', err);
            }
          },
          (status, message) => {
            if (
              listeningGenerationRef.current !== listeningGeneration ||
              currentUserIdRef.current !== requestedUserId
            ) return;

            setSttEngineStatus(status);
            if (message) setSttEngineMessage(message);
            if (status === 'ERROR' && mode === 'TAB_AUDIO') {
              listeningGenerationRef.current += 1;
              activeListeningUserIdRef.current = null;
              isListeningRef.current = false;
              setIsListening(false);
              audioCaptureService.pauseCapture();
              setAudioLevel(0);
              setWaveform(new Uint8Array(128));
              resetSonioxBusinessAccumulator();
            }
          },
          activeLocalModel
        );
      } else {
        // [클라우드 STT] 관리자가 선택한 STT 공급자와 최신 API Key 확인
        const activeSttProvider = sttProvider;
        const activeApiKey = activeSttProvider === 'SONIOX'
          ? sonioxApiKey
          : deepgramApiKey;

        const currentUser = currentUserRef.current;
        const canUseAdminKey = currentUser?.role === '관리자' || Boolean(currentUser?.allowAdminSttKey);

        if (!canUseAdminKey) {
          setSttEngineStatus('ERROR');
          setSttEngineMessage('관리자의 STT API 키 이용 승인이 필요합니다. [내 PC 무료 STT]를 이용해 주세요.');
          audioCaptureService.stopCapture();
          isListeningRef.current = false;
          setIsListening(false);
          return;
        }

        if (!activeApiKey) {
          setSttEngineStatus('ERROR');
          setSttEngineMessage('관리자가 등록한 기본 STT API Key가 없습니다. 관리자에게 키 등록을 요청하거나 [내 PC 무료 STT]를 이용해 주세요.');
          audioCaptureService.stopCapture();
          isListeningRef.current = false;
          setIsListening(false);
          return;
        }

        cloudSttStartTimeRef.current = Date.now();
        activeCloudProviderRef.current = activeSttProvider;

        deepgramService.startLiveStream(
          {
            provider: activeSttProvider,
            apiKey: activeApiKey,
            model: 'nova-3',
            language: 'ko',
            keyterms,
            punctuate: true,
            interimResults: true,
            endpointing: 300,
            allowBrowserSpeechFallback: mode === 'MIC'
          },
          (data) => {
            handleTranscript(data, listeningGeneration, requestedUserId);
          },
          (err) => {
            if (listeningGenerationRef.current === listeningGeneration) {
              console.error('[Live] STT 스트림 에러 알림:', err);
            }
          },
          (status, message) => {
            if (
              listeningGenerationRef.current !== listeningGeneration ||
              currentUserIdRef.current !== requestedUserId
            ) return;

            setSttEngineStatus(status);
            if (message) setSttEngineMessage(message);
            if (status === 'ERROR' && mode === 'TAB_AUDIO') {
              listeningGenerationRef.current += 1;
              activeListeningUserIdRef.current = null;
              isListeningRef.current = false;
              setIsListening(false);
              audioCaptureService.pauseCapture();
              setAudioLevel(0);
              setWaveform(new Uint8Array(128));
              resetSonioxBusinessAccumulator();
            }
          }
        );
      }
    } catch (err) {
      // 이미 stop/logout으로 무효화된 시작의 늦은 실패는 현재 UI를 덮지 않는다.
      if (listeningGenerationRef.current === listeningGeneration) {
        console.error('[Live] 라이브 청취 시작 실패:', err);
        listeningGenerationRef.current += 1;
        activeListeningUserIdRef.current = null;
        isListeningRef.current = false;
        setIsListening(false);
        if (mode === 'TAB_AUDIO') {
          audioCaptureService.pauseCapture();
        } else {
          audioCaptureService.stopCapture();
        }
        localSttService.stopListening();
        deepgramService.stopLiveStream();
        setSttEngineStatus('ERROR');
        setSttEngineMessage(err instanceof Error ? err.message : '라이브 청취 시작 실패');
      }
    } finally {
      startInFlightRef.current = false;
    }
  };

  // 라이브 청취 중지 (TAB_AUDIO는 파이프라인을 일시정지해 공유 연결을 유지한다)
  const stopListening = useCallback(() => {
    listeningGenerationRef.current += 1;
    activeListeningUserIdRef.current = null;
    isListeningRef.current = false;
    setIsListening(false);
    if (activeAudioSourceModeRef.current === 'TAB_AUDIO') {
      audioCaptureService.pauseCapture();
    } else {
      audioCaptureService.stopCapture();
    }
    resetSonioxBusinessAccumulator();
    localSttService.stopListening();
    deepgramService.stopLiveStream();

    if (cloudSttStartTimeRef.current && activeCloudProviderRef.current) {
      const durationSeconds = Math.max(1, Math.round((Date.now() - cloudSttStartTimeRef.current) / 1000));
      const provider = activeCloudProviderRef.current;
      const startedAt = new Date(cloudSttStartTimeRef.current).toISOString();
      const endedAt = new Date().toISOString();
      const sessionId = currentSessionIdRef.current;
      cloudSttStartTimeRef.current = null;
      activeCloudProviderRef.current = null;
      void remoteWorkspaceService.recordSttUsage({
        sessionId,
        provider,
        durationSeconds,
        startedAt,
        endedAt,
      });
    }

    setSttEngineStatus('DISCONNECTED');
    setSttEngineMessage(
      screenCaptureService.getActiveAudioTrack()
        ? '청취 중지됨 · 방송 탭 공유 연결 유지 중'
        : '청취 중지됨'
    );
    setAudioLevel(0);
    setWaveform(new Uint8Array(128));
    setCurrentInterimTranscript('');
    interimStreamChunkerRef.current.reset();
    isVoiceEditingRef.current = false;
    setIsVoiceEditing(false);
    setEditingFieldInfo(null);
    if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
  }, []);

  const disconnectScreenShare = useCallback(() => {
    stopListening();
    audioCaptureService.stopCapture(false);
    screenCaptureService.stopStream();
    setSttEngineStatus('DISCONNECTED');
    setSttEngineMessage('방송 탭 공유 연결 해제됨');
  }, [stopListening]);

  // 로그아웃 시 AI 처리와 전송은 즉시 중지하되, 같은 SPA 탭의 공유 원본은 유지한다.
  useEffect(() => {
    const didLogout = previousAuthenticatedRef.current && !isAuthenticated;
    previousAuthenticatedRef.current = isAuthenticated;

    if (didLogout) {
      // 기존 공유 원본은 유지하되, 아직 완료되지 않은 새 공유 선택은 받아들이지 않는다.
      screenCaptureService.cancelPendingRequest();
      stopListening();
      if (screenCaptureService.getActiveStream()) {
        setSttEngineMessage('로그아웃됨 · AI 청취 중지 · 방송 탭 공유 연결 유지 중');
      }
    }
  }, [isAuthenticated, stopListening]);

  // 다른 계정으로 로그인하면 이전 계정이 연결한 공유 원본을 자동으로 넘기지 않는다.
  useEffect(() => {
    if (
      isAuthenticated &&
      user?.id &&
      screenConnection.isConnected &&
      shareOwnerUserIdRef.current &&
      shareOwnerUserIdRef.current !== user.id
    ) {
      disconnectScreenShare();
      setSttEngineMessage('계정 변경으로 이전 방송 탭 공유 연결을 해제했습니다.');
    }
  }, [disconnectScreenShare, isAuthenticated, screenConnection.isConnected, user?.id]);

  // Chrome의 [공유 중지] 또는 공유 오디오 종료를 Live/STT 상태에 반영한다.
  useEffect(() => {
    const audioWasConnected = previousShareAudioRef.current;
    previousShareAudioRef.current = screenConnection.hasAudio;

    if (
      audioWasConnected &&
      !screenConnection.hasAudio &&
      isListeningRef.current &&
      activeAudioSourceModeRef.current === 'TAB_AUDIO'
    ) {
      stopListening();
      setSttEngineStatus('ERROR');
      setSttEngineMessage(
        screenConnection.isConnected
          ? '방송 탭 오디오 공유가 종료되어 청취를 중지했습니다.'
          : '방송 탭 공유가 종료되어 청취를 중지했습니다.'
      );
    }
  }, [screenConnection.hasAudio, screenConnection.isConnected, stopListening]);

  // 수동 텍스트 주입 테스트
  const injectTestMent = (text: string) => {
    handleTranscript({
      text,
      isFinal: true,
      confidence: 0.99
    });
  };

  return (
    <LiveContext.Provider
      value={{
        isListening,
        currentSessionId,
        sessionStartTime,
        audioLevel,
        waveform,
        currentInterimTranscript,
        liveTranscriptFlow,
        lastMatchedRuleItem,
        transcriptLogs,
        totalSessionTranscriptCount,
        downloadSessionTranscripts,
        recentCaptures,
        isVoiceEditing,
        editingFieldInfo,
        deepgramApiKey,
        setDeepgramApiKey,
        sonioxApiKey,
        setSonioxApiKey,
        sttProvider,
        setSttProvider,
        sttMode,
        setSttMode,
        localSttModel,
        setLocalSttModel,
        localSttStatus,
        sttEngineStatus,
        sttEngineMessage,
        isScreenShareConnected: screenConnection.isConnected,
        hasScreenShareAudio: screenConnection.hasAudio,
        startListening,
        stopListening,
        disconnectScreenShare,
        injectTestMent,
        captureCurrentScreen
      }}
    >
      {children}
    </LiveContext.Provider>
  );
};

export const useLive = () => {
  const context = useContext(LiveContext);
  if (!context) {
    throw new Error('useLive must be used within a LiveProvider');
  }
  return context;
};
