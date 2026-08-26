import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, MessageSquareText, X } from 'lucide-react';
import { useLive } from './LiveContext';
import { storageService } from '../services/storageService';
import { screenCaptureService } from '../services/screenCaptureService';
import { buildNewCommentRecords, commentDedupeKey, recognizeCanvas, terminateOcr, warmUpOcr } from '../services/ocrService';
import { CommentCaptureConfig, CommentRecord } from '../types/comment';

export interface CommentAlert {
  id: string;
  nickname: string;
  word: string;
  content: string;
  firedAt: string;
}

interface CommentCaptureContextType {
  isActive: boolean;          // 사용자가 시작한 자동 댓글 캡처 토글
  isRunning: boolean;         // 실제 동작 중 (토글 ON + 라이브 청취 중)
  isProcessing: boolean;      // 현재 캡처/OCR 처리 중
  lastRunAt: string | null;   // 마지막 캡처 시각
  newCount: number;           // 토글 ON 이후 신규 누적 건수
  activeAlert: CommentAlert | null;
  dismissAlert: () => void;
  startCapture: () => void;
  stopCapture: () => void;
  config: CommentCaptureConfig;
  saveConfig: (config: CommentCaptureConfig) => void;
}

const CommentCaptureContext = createContext<CommentCaptureContextType | undefined>(undefined);

export const CommentCaptureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isListening, currentSessionId, transcriptLogs } = useLive();

  const [isActive, setIsActive] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [newCount, setNewCount] = useState<number>(0);
  const [activeAlert, setActiveAlert] = useState<CommentAlert | null>(null);
  const [config, setConfig] = useState<CommentCaptureConfig>(() => storageService.getCommentCaptureConfig());

  const seenKeysRef = useRef<Set<string>>(new Set());
  const processingRef = useRef<boolean>(false);
  const alertTimerRef = useRef<number | null>(null);
  const configRef = useRef<CommentCaptureConfig>(config);
  const isActiveRef = useRef<boolean>(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const saveConfig = useCallback((next: CommentCaptureConfig) => {
    setConfig(next);
    storageService.saveCommentCaptureConfig(next);
  }, []);

  const dismissAlert = useCallback(() => {
    if (alertTimerRef.current) {
      window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
    setActiveAlert(null);
  }, []);

  const showAlert = useCallback((alert: CommentAlert, durationSec: number) => {
    if (alertTimerRef.current) {
      window.clearTimeout(alertTimerRef.current);
    }
    setActiveAlert(alert);
    alertTimerRef.current = window.setTimeout(() => {
      setActiveAlert(null);
      alertTimerRef.current = null;
    }, Math.max(3, durationSec) * 1000);
  }, []);

  // 지정된 음성 명령으로 알림창을 닫는다 (라이브 청취 전사 스트림 감시).
  const lastTranscriptIdRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = transcriptLogs[0];
    if (!latest || latest.id === lastTranscriptIdRef.current) return;
    lastTranscriptIdRef.current = latest.id;

    const command = configRef.current.alertVoiceCommand.trim();
    if (command && activeAlert && latest.text.includes(command)) {
      dismissAlert();
    }
  }, [transcriptLogs, activeAlert, dismissAlert]);

  const runTick = useCallback(async () => {
    if (processingRef.current || !isActiveRef.current || !isListening) return;

    const stream = screenCaptureService.getActiveStream();
    if (!stream) return;

    processingRef.current = true;
    setIsProcessing(true);

    try {
      const canvas = await screenCaptureService.captureAreaCanvas(stream, configRef.current.area);
      if (!canvas) return;

      const rawText = await recognizeCanvas(canvas);
      if (!rawText.trim()) return;

      const { records, alertHits } = buildNewCommentRecords(
        rawText,
        currentSessionId,
        seenKeysRef.current,
        configRef.current.alertWords
      );

      if (records.length > 0) {
        storageService.addCommentRecords(records);
        setNewCount((prev) => prev + records.length);

        const firstHit = alertHits[0];
        if (firstHit) {
          showAlert(
            {
              id: firstHit.id,
              nickname: firstHit.nickname,
              word: firstHit.matchedAlertWord || '',
              content: firstHit.content,
              firedAt: new Date().toLocaleTimeString('ko-KR')
            },
            configRef.current.alertDurationSec
          );
        }
      }

      setLastRunAt(new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      console.warn('[CommentCapture] 댓글 캡처 처리 실패:', e);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [currentSessionId, isListening, showAlert]);

  // 토글 ON + 라이브 청취 중일 때만 주기 캡처 루프가 돈다. 알림창이 떠 있어도 루프는 계속된다.
  useEffect(() => {
    if (!isActive || !isListening) return;

    // 기존 기록의 중복 키를 미리 적재해 같은 댓글 재기록을 막는다.
    seenKeysRef.current = new Set(
      storageService.getCommentRecords().map((r) => commentDedupeKey(r.nickname, r.content))
    );
    setNewCount(0);
    void warmUpOcr();

    void runTick();
    const timer = window.setInterval(() => {
      void runTick();
    }, Math.max(3, config.intervalSec) * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isActive, isListening, config.intervalSec, runTick]);

  // 언마운트 시 OCR 워커 정리
  useEffect(() => () => {
    void terminateOcr();
  }, []);

  const startCapture = useCallback(() => setIsActive(true), []);
  const stopCapture = useCallback(() => setIsActive(false), []);

  const isRunning = isActive && isListening;

  return (
    <CommentCaptureContext.Provider
      value={{
        isActive,
        isRunning,
        isProcessing,
        lastRunAt,
        newCount,
        activeAlert,
        dismissAlert,
        startCapture,
        stopCapture,
        config,
        saveConfig
      }}
    >
      {children}

      {/* 키워드 알림창 (큰 알림이 떠 있어도 앱 동작은 백그라운드에서 계속된다) */}
      {activeAlert && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] pointer-events-none w-[92vw] max-w-xl animate-in slide-in-from-top-4 fade-in">
          <div className="pointer-events-auto rounded-3xl border-4 border-rose-500 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-rose-500 text-white">
              <div className="flex items-center space-x-2 font-black text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>🔑 설정 단어 감지!</span>
              </div>
              <button
                onClick={dismissAlert}
                className="p-1 rounded-full hover:bg-white/20 transition"
                aria-label="알림 닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-1.5 text-center">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {activeAlert.firedAt} 댓글 캡처 감지
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 break-words">
                {activeAlert.nickname}
              </div>
              <div className="inline-block px-4 py-1.5 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-600 text-xl sm:text-2xl font-black break-all">
                "{activeAlert.word}"
              </div>
              <p className="text-xs text-slate-500 pt-1 break-words">"{activeAlert.content}"</p>
              <p className="text-[10px] text-slate-400 pt-1">
                {config.alertDurationSec}초 후 자동으로 닫히거나 "{config.alertVoiceCommand}"라고 말씀하세요.
              </p>
            </div>

            <div className="h-1.5 bg-rose-100">
              <div
                className="h-full bg-rose-500"
                style={{
                  animation: `shrink-width ${Math.max(3, config.alertDurationSec)}s linear forwards`
                }}
              />
            </div>
          </div>
        </div>
      )}
    </CommentCaptureContext.Provider>
  );
};

export const useCommentCapture = () => {
  const context = useContext(CommentCaptureContext);
  if (!context) {
    throw new Error('useCommentCapture must be used within a CommentCaptureProvider');
  }
  return context;
};

export type { CommentRecord };
