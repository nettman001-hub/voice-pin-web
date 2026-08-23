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

interface LiveContextType {
  isListening: boolean;
  currentSessionId: string;
  sessionStartTime: string | null;
  audioLevel: number;
  waveform: Uint8Array;
  currentInterimTranscript: string;
  transcriptLogs: SttTranscriptLog[];
  recentCaptures: CaptureItem[];
  isVoiceEditing: boolean;
  editingFieldInfo: string | null;
  deepgramApiKey: string;
  setDeepgramApiKey: (key: string) => void;
  startListening: (mode?: 'MIC' | 'SYSTEM_LOOPBACK') => Promise<void>;
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
  const [transcriptLogs, setTranscriptLogs] = useState<SttTranscriptLog[]>([]);
  const [recentCaptures, setRecentCaptures] = useState<CaptureItem[]>([]);
  
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

  // 화면 캡처 실행
  const captureCurrentScreen = async (
    areaConfig: CaptureAreaConfig = {
      preset: 'COMMENTS',
      name: '댓글 목록',
      xRatio: 0.05,
      yRatio: 0.45,
      widthRatio: 0.9,
      heightRatio: 0.5
    },
    triggerWord: string = '캡처'
  ): Promise<string> => {
    const stream = audioCaptureService.getActiveStream();
    const lastSale = lastSavedSaleRef.current;

    const imageUrl = await screenCaptureService.captureArea(stream, areaConfig, {
      nickname: lastSale?.buyerNickname,
      amount: lastSale?.amount,
      timestamp: new Date().toLocaleTimeString('ko-KR')
    });

    const newCapture: CaptureItem = {
      id: `cap-${Date.now()}`,
      saleId: lastSale?.id,
      sessionId: currentSessionId,
      imageUrl,
      capturedAt: new Date().toISOString(),
      areaName: areaConfig.name,
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
    const rules = storageService.getRules().filter((r) => r.isEnabled);
    const activeKeywords = rules.map((r) => r.word);

    let actionTriggered: SttTranscriptLog['actionTriggered'] = 'NONE';

    // 1. 방송 중 음성 명령 파싱 ("수정 시작" / "닉네임은 xxx" / "수정 완료")
    const command = parseVoiceCommand(fullText, isVoiceEditingRef.current);

    if (command.type === 'START_EDIT') {
      setIsVoiceEditing(true);
      setEditingFieldInfo('수정 대기 중: "닉네임은 홍길동, 금액은 3만원"처럼 말씀해주세요.');
      actionTriggered = 'VOICE_EDIT_START';
      playBeep(880, 200); // 삐- 신호음
      resetVoiceEditTimeout();
    } else if (command.type === 'FINISH_EDIT') {
      setIsVoiceEditing(false);
      setEditingFieldInfo(null);
      actionTriggered = 'VOICE_EDIT_DONE';
      playBeep(1200, 250); // 띵- 확인음
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
        setEditingFieldInfo(`수정됨 -> 닉네임: ${updated.buyerNickname}, 금액: ${updated.amount.toLocaleString()}원 ("수정 완료"를 말씀하세요)`);
      }
    } else if (command.type === 'DELETE_LAST' && lastSavedSaleRef.current) {
      // 방금 건 삭제
      playBeep(440, 300);
      lastSavedSaleRef.current = null;
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
        playBeep(1046, 120); // 경쾌한 등록음
      }

      // 3. 캡처 트리거 감지 ("캡처", "화면 캡처" 등)
      if (fullText.includes('캡처') || fullText.includes('화면캡처')) {
        actionTriggered = 'SCREEN_CAPTURED';
        captureCurrentScreen();
      }
    }

    // 전사 로그 적재
    const newLog: SttTranscriptLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toLocaleTimeString('ko-KR'),
      text: fullText,
      isFinal: true,
      confidence: data.confidence,
      matchedKeywords: activeKeywords.filter((kw) => fullText.includes(kw)),
      actionTriggered
    };

    setTranscriptLogs((prev) => [newLog, ...prev.slice(0, 49)]);
  };

  // 라이브 청취 시작
  const startListening = async (mode: 'MIC' | 'SYSTEM_LOOPBACK' = 'MIC') => {
    try {
      const newSessionId = generateSessionId();
      setCurrentSessionId(newSessionId);
      setSessionStartTime(new Date().toISOString());
      setIsListening(true);

      const rules = storageService.getRules().filter((r) => r.isEnabled);
      const keywords = rules.map((r) => `${r.word}:2`);

      // 1. 오디오 캡처 시작
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

      // 2. Deepgram Nova-3 STT 스트림 시작
      deepgramService.startLiveStream(
        {
          apiKey: deepgramApiKey,
          model: 'nova-3',
          language: 'ko',
          keywords,
          punctuate: true,
          interimResults: true,
          endpointing: 300
        },
        handleTranscript,
        (err) => {
          console.error('[Live] STT 스트림 에러:', err);
        }
      );
    } catch (err) {
      console.error('[Live] 라이브 청취 시작 실패:', err);
      setIsListening(false);
    }
  };

  // 라이브 청취 중지
  const stopListening = () => {
    setIsListening(false);
    audioCaptureService.stopCapture();
    deepgramService.stopLiveStream();
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
        transcriptLogs,
        recentCaptures,
        isVoiceEditing,
        editingFieldInfo,
        deepgramApiKey,
        setDeepgramApiKey,
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
  if (!context) throw new Error('useLive must be used within a LiveProvider');
  return context;
};
