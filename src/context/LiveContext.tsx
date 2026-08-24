import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { LiveSession, SttTranscriptLog, CaptureItem, SaleRecord } from '../types/live';
import { deepgramService } from '../services/deepgramService';
import { audioCaptureService } from '../services/audioCaptureService';
import { screenCaptureService } from '../services/screenCaptureService';
import { extractSaleFromTranscript } from '../services/salesExtractor';
import { parseVoiceCommand } from '../services/voiceCommandParser';
import { storageService, generateSessionId } from '../services/storageService';
import { useSales } from './SalesContext';
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
  startListening: (mode?: 'TAB_AUDIO' | 'MIC') => Promise<void>;
  stopListening: () => void;
  injectTestMent: (text: string) => void;
  captureCurrentScreen: (area?: CaptureAreaConfig, triggerWord?: string) => Promise<string>;
}

const LiveContext = createContext<LiveContextType | undefined>(undefined);

export const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addSale, updateSale, sales } = useSales();

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

  useEffect(() => {
    isListeningRef.current = isListening;
    isVoiceEditingRef.current = isVoiceEditing;
  }, [isListening, isVoiceEditing]);

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
    triggerWord: string = '화면 캡처'
  ): Promise<string> => {
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
  const handleTranscript = (data: { text: string; isFinal: boolean; confidence: number }) => {
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
        const saved = addSale({
          sessionId: currentSessionId,
          buyerNickname: saleResult.buyerNickname,
          amount: saleResult.amount,
          recognizedAt: new Date().toISOString(),
          rawTranscript: fullText,
          status: saleResult.status
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
        captureCurrentScreen(undefined, '음성인식 자동캡처');
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
    try {
      const newSessionId = generateSessionId();
      setCurrentSessionId(newSessionId);
      setSessionStartTime(new Date().toISOString());
      setIsListening(true);

      const rules = storageService.getRules().filter((r) => r.isEnabled);
      const keywords = rules.map((r) => `${r.word}:2`);

      // 1. 오디오 파형 시각화 캡처 시작 (실패해도 STT는 정상 작동하도록 격리)
      try {
        await audioCaptureService.startCapture(
          mode,
          (chunk) => {
            deepgramService.sendAudioChunk(chunk);
          },
          (wave, vol) => {
            setWaveform(wave);
            setAudioLevel(vol);
          }
        );
      } catch (audioErr) {
        console.warn('[Live] 오디오 시각화 캡처 경고 (STT는 계속 진행):', audioErr);
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
          endpointing: 300
        },
        handleTranscript,
        (err) => {
          console.error('[Live] STT 스트림 에러 알림:', err);
        },
        (status, message) => {
          setSttEngineStatus(status);
          if (message) setSttEngineMessage(message);
        }
      );
    } catch (err) {
      console.error('[Live] 라이브 청취 시작 실패:', err);
      setIsListening(false);
      setSttEngineStatus('ERROR');
      setSttEngineMessage('라이브 청취 시작 실패');
    }
  };

  // 라이브 청취 중지
  const stopListening = () => {
    setIsListening(false);
    audioCaptureService.stopCapture();
    deepgramService.stopLiveStream();
    setSttEngineStatus('DISCONNECTED');
    setSttEngineMessage('청취 중지됨');
    setIsVoiceEditing(false);
    setEditingFieldInfo(null);
    if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
  };

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
        startListening,
        stopListening,
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
