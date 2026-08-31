import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { LiveSession, SttTranscriptLog, CaptureItem, SaleRecord } from '../types/live';
import { deepgramService } from '../services/deepgramService';
import { audioCaptureService } from '../services/audioCaptureService';
import { screenCaptureService } from '../services/screenCaptureService';
import { extractSaleFromTranscript } from '../services/salesExtractor';
import { parseVoiceCommand } from '../services/voiceCommandParser';
import { nicknameVerificationNote, verifyNicknameFromComments } from '../services/commentNicknameVerifier';
import { storageService, generateSessionId } from '../services/storageService';
import { useSales } from './SalesContext';
import { useAuth } from './AuthContext';
import { CaptureAreaConfig } from '../types/rules';

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
  recentCaptures: CaptureItem[];
  isVoiceEditing: boolean;
  editingFieldInfo: string | null;
  deepgramApiKey: string;
  setDeepgramApiKey: (key: string) => void;
  sttEngineStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  sttEngineMessage: string;
  isScreenShareConnected: boolean;
  hasScreenShareAudio: boolean;
  startListening: (mode?: 'TAB_AUDIO' | 'MIC') => Promise<void>;
  stopListening: () => void;
  disconnectScreenShare: () => void;
  injectTestMent: (text: string) => void;
  captureCurrentScreen: (area?: CaptureAreaConfig, triggerWord?: string) => Promise<string>;
}

const LiveContext = createContext<LiveContextType | undefined>(undefined);

export const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addSale, updateSale, sales } = useSales();
  const { isAuthenticated, user } = useAuth();

  const [isListening, setIsListening] = useState<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>(generateSessionId());
  const [sessionStartTime, setSessionStartTime] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [waveform, setWaveform] = useState<Uint8Array>(new Uint8Array(128));
  const [currentInterimTranscript, setCurrentInterimTranscript] = useState<string>('');
  const [liveTranscriptFlow, setLiveTranscriptFlow] = useState<Array<{ id: string; text: string; timestamp: string }>>([]);
  const [lastMatchedRuleItem, setLastMatchedRuleItem] = useState<MatchedRuleItem | null>(null);
  const [transcriptLogs, setTranscriptLogs] = useState<SttTranscriptLog[]>([]);
  const [recentCaptures, setRecentCaptures] = useState<CaptureItem[]>([]);
  const [sttEngineStatus, setSttEngineStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');
  const [sttEngineMessage, setSttEngineMessage] = useState<string>('대기 중');
  const [screenConnection, setScreenConnection] = useState(() => screenCaptureService.getConnectionState());
  
  // 방송 중 음성 명령 수정 상태
  const [isVoiceEditing, setIsVoiceEditing] = useState<boolean>(false);
  const [editingFieldInfo, setEditingFieldInfo] = useState<string | null>(null);
  const editTimeoutRef = useRef<number | null>(null);

  // Deepgram 설정
  const [deepgramApiKey, setDeepgramApiKeyState] = useState<string>(storageService.getDeepgramApiKey());

  // 최신 세션/상태 ref 유지
  const isListeningRef = useRef<boolean>(false);
  const isVoiceEditingRef = useRef<boolean>(false);
  const lastSavedSaleRef = useRef<SaleRecord | null>(null);
  const activeAudioSourceModeRef = useRef<'TAB_AUDIO' | 'MIC'>('TAB_AUDIO');
  const previousAuthenticatedRef = useRef<boolean>(isAuthenticated);
  const previousShareAudioRef = useRef<boolean>(screenConnection.hasAudio);
  const shareOwnerUserIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(user?.id ?? null);
  const isAuthenticatedRef = useRef<boolean>(isAuthenticated);
  const authBoundaryGenerationRef = useRef(0);
  const previousAuthIdentityRef = useRef(`${isAuthenticated}:${user?.id ?? ''}`);
  const listeningGenerationRef = useRef(0);
  const activeListeningUserIdRef = useRef<string | null>(null);
  const startInFlightRef = useRef(false);

  useEffect(() => {
    isListeningRef.current = isListening;
    isVoiceEditingRef.current = isVoiceEditing;
  }, [isListening, isVoiceEditing]);

  useEffect(() => {
    const authIdentity = `${isAuthenticated}:${user?.id ?? ''}`;
    if (previousAuthIdentityRef.current !== authIdentity) {
      previousAuthIdentityRef.current = authIdentity;
      authBoundaryGenerationRef.current += 1;
    }
    currentUserIdRef.current = user?.id ?? null;
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, user?.id]);

  useEffect(() => screenCaptureService.subscribeConnection((state) => {
    setScreenConnection(state);

    if (!state.isConnected) {
      shareOwnerUserIdRef.current = null;
    } else if (!shareOwnerUserIdRef.current && currentUserIdRef.current) {
      shareOwnerUserIdRef.current = currentUserIdRef.current;
    }
  }), []);

  const setDeepgramApiKey = (key: string) => {
    setDeepgramApiKeyState(key);
    storageService.setDeepgramApiKey(key);
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
    requiredListeningGeneration?: number
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
    const lastSale = lastSavedSaleRef.current;

    const imageUrl = await screenCaptureService.captureArea(stream, configuredArea, {
      nickname: lastSale?.buyerNickname,
      amount: lastSale?.amount,
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
      saleId: lastSale?.id,
      sessionId: currentSessionId,
      imageUrl,
      capturedAt: new Date().toISOString(),
      areaName: configuredArea.name,
      triggerWord
    };

    storageService.addCapture(newCapture);
    setRecentCaptures((prev) => [newCapture, ...prev.slice(0, 9)]);

    // 가장 최근 판매 내역에 캡처 이미지 연결
    if (lastSale) {
      const updatedSale: SaleRecord = {
        ...lastSale,
        captureImageUrls: [...(lastSale.captureImageUrls || []), imageUrl]
      };
      updateSale(updatedSale);
      lastSavedSaleRef.current = updatedSale;
    }

    return imageUrl;
  };

  // 실시간 전사 처리 핸들러
  const handleTranscript = (
    data: { text: string; isFinal: boolean; confidence: number },
    requiredListeningGeneration?: number,
    requiredUserId?: string
  ) => {
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

    if (!data.isFinal) {
      setCurrentInterimTranscript(data.text);
      return;
    }

    // 최종 텍스트 확정
    setCurrentInterimTranscript('');
    const fullText = data.text.trim();
    const nowTime = new Date().toLocaleTimeString('ko-KR');

    // 윗부분 자막 스트림에 추가
    setLiveTranscriptFlow((prev) => [
      ...prev.slice(-30),
      { id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, text: fullText, timestamp: nowTime }
    ]);

    const rules = storageService.getRules().filter((r) => r.isEnabled);
    const activeKeywords = rules.map((r) => r.word);
    const matchedKeywords = activeKeywords.filter((kw) => fullText.includes(kw));

    let actionTriggered: SttTranscriptLog['actionTriggered'] = 'NONE';
    let ruleActionName = '';

    // 1. 방송 중 음성 명령 파싱 ("수정 시작" / "닉네임은 xxx" / "수정 완료")
    const command = parseVoiceCommand(fullText, isVoiceEditingRef.current);

    if (command.type === 'START_EDIT') {
      setIsVoiceEditing(true);
      setEditingFieldInfo('수정 대기 중: "닉네임은 홍길동, 금액은 3만원"처럼 말씀해주세요.');
      actionTriggered = 'VOICE_EDIT_START';
      ruleActionName = '🎙️ 음성 수정 시작';
      playBeep(880, 200);
      resetVoiceEditTimeout();
    } else if (command.type === 'FINISH_EDIT') {
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
      // 2. 판매 멘트 감지 ("구매확정 됐습니다...")
      const saleResult = extractSaleFromTranscript(fullText, activeKeywords);

      if (saleResult) {
        const recognizedAt = new Date().toISOString();
        const nicknameVerification = verifyNicknameFromComments({
          transcript: fullText,
          spokenNickname: saleResult.buyerNickname,
          sessionId: currentSessionId,
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
        const status = hasVerifiedCommentNickname
          ? saleResult.status
          : '보류';

        const saved = addSale({
          sessionId: currentSessionId,
          buyerNickname,
          amount: saleResult.amount,
          recognizedAt,
          rawTranscript: fullText,
          status,
          note: nicknameVerificationNote(nicknameVerification)
        });
        lastSavedSaleRef.current = saved;
        actionTriggered = 'SALE_SAVED';
        ruleActionName = '🛍️ 판매 DB 자동 저장';
        playBeep(1046, 120);
      }

      // 3. 캡처 트리거 감지 ("캡처", "화면 캡처" 등)
      if (fullText.includes('캡처') || fullText.includes('화면캡처')) {
        actionTriggered = 'SCREEN_CAPTURED';
        ruleActionName = ruleActionName ? `${ruleActionName} + 📸 캡처` : '📸 화면 자동 캡처';
        void captureCurrentScreen(
          undefined,
          '음성인식 자동캡처',
          requiredListeningGeneration
        );
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

    setTranscriptLogs((prev) => [newLog, ...prev.slice(0, 49)]);
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

    try {
      if (
        mode === 'TAB_AUDIO' &&
        screenCaptureService.getActiveStream() &&
        shareOwnerUserIdRef.current &&
        shareOwnerUserIdRef.current !== requestedUserId
      ) {
        // 같은 브라우저에서 다른 계정으로 전환된 경우 이전 계정의 공유를 넘기지 않는다.
        screenCaptureService.stopStream();
        audioCaptureService.stopCapture();
      }

      const previousMode = activeAudioSourceModeRef.current;
      activeAudioSourceModeRef.current = mode;
      isListeningRef.current = true;
      const newSessionId = generateSessionId();
      setCurrentSessionId(newSessionId);
      setSessionStartTime(new Date().toISOString());
      setIsListening(true);
      setSttEngineStatus('CONNECTING');
      setSttEngineMessage(mode === 'TAB_AUDIO' ? '방송 탭 오디오 연결 확인 중' : '마이크 연결 확인 중');

      const rules = storageService.getRules().filter((r) => r.isEnabled);
      const keywords = rules.map((r) => `${r.word}:2`);

      const chunkCallback = (chunk: ArrayBuffer) => {
        if (
          listeningGenerationRef.current === listeningGeneration &&
          isListeningRef.current &&
          currentUserIdRef.current === requestedUserId
        ) {
          deepgramService.sendAudioChunk(chunk);
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

      // 최신 API Key 확인
      const activeApiKey = deepgramApiKey || storageService.getDeepgramApiKey();

      // 2. 실시간 STT 엔진 시작 (Deepgram Nova-2/Nova-3 또는 브라우저 Web Speech API)
      deepgramService.startLiveStream(
        {
          apiKey: activeApiKey,
          model: 'nova-2',
          language: 'ko',
          keywords,
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
          }
        }
      );
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
    deepgramService.stopLiveStream();
    setSttEngineStatus('DISCONNECTED');
    setSttEngineMessage(
      screenCaptureService.getActiveAudioTrack()
        ? '청취 중지됨 · 방송 탭 공유 연결 유지 중'
        : '청취 중지됨'
    );
    setAudioLevel(0);
    setWaveform(new Uint8Array(128));
    setCurrentInterimTranscript('');
    setIsVoiceEditing(false);
    setEditingFieldInfo(null);
    if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
  }, []);

  const disconnectScreenShare = useCallback(() => {
    stopListening();
    audioCaptureService.stopCapture();
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
        recentCaptures,
        isVoiceEditing,
        editingFieldInfo,
        deepgramApiKey,
        setDeepgramApiKey,
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
