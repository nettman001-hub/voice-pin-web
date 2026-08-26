import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useLive } from './LiveContext';
import { storageService } from '../services/storageService';
import {
  commentDedupeKey,
  commentStreamService,
  StreamedComment
} from '../services/commentStreamService';
import type { CommentStreamStatus } from '../services/commentStreamService';
import { CommentCaptureConfig, CommentRecord } from '../types/comment';

export interface CommentAlert {
  id: string;
  nickname: string;
  word: string;
  content: string;
  firedAt: string;
}

interface CommentCaptureContextType {
  isActive: boolean;              // 사용자가 켠 댓글 수집 토글 (함께시작)
  isRunning: boolean;             // 실제 수집 중 (토글 ON + 라이브 청취 중 + 서버 연결 + 틱톡 수집중)
  serverStatus: CommentStreamStatus; // 로컬 수집 서버/틱톡 연결 상태
  serverMessage: string;          // 상태 안내 메시지
  newCount: number;               // 토글 ON 이후 신규 누적 건수
  liveComments: CommentRecord[];  // 현재 회차에서 수집된 댓글 (아래쪽이 최신)
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

  // 기본값은 중지이며, 사용자가 바꾼 활성화 상태는 저장되어 유지된다.
  const [isActive, setIsActive] = useState<boolean>(() => storageService.getCommentCaptureActive());
  const [serverStatus, setServerStatus] = useState<CommentStreamStatus>('DISCONNECTED');
  const [serverMessage, setServerMessage] = useState<string>('로컬 댓글 수집 서버 미연결');
  const [newCount, setNewCount] = useState<number>(0);
  const [liveComments, setLiveComments] = useState<CommentRecord[]>([]);
  const [activeAlert, setActiveAlert] = useState<CommentAlert | null>(null);
  const [config, setConfig] = useState<CommentCaptureConfig>(() => storageService.getCommentCaptureConfig());

  const seenKeysRef = useRef<Set<string>>(new Set());
  const alertTimerRef = useRef<number | null>(null);
  const configRef = useRef<CommentCaptureConfig>(config);
  const isActiveRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>(currentSessionId);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    isActiveRef.current = isActive;
    storageService.saveCommentCaptureActive(isActive);
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

  // 로컬 서버가 중계한 실시간 댓글 유입 처리
  const ingestComment = useCallback(
    (incoming: StreamedComment) => {
      if (!isActiveRef.current) return;

      const nickname = (incoming.nickname || incoming.uniqueId || '알 수 없음').trim();
      const content = String(incoming.content || '').trim();
      if (!content || !nickname) return;

      const key = commentDedupeKey(nickname, content);
      if (seenKeysRef.current.has(key)) return;
      seenKeysRef.current.add(key);

      const cfg = configRef.current;
      const matchedWord = cfg.alertWords.find((word) => word && content.includes(word));

      const record: CommentRecord = {
        id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: sessionIdRef.current,
        nickname,
        uniqueId: incoming.uniqueId || undefined,
        content,
        capturedAt: incoming.receivedAt || new Date().toISOString(),
        ...(matchedWord ? { matchedAlertWord: matchedWord } : {})
      };

      storageService.addCommentRecords([record]);
      setNewCount((prev) => prev + 1);
      setLiveComments((prev) => [...prev, record].slice(-100));

      if (matchedWord) {
        showAlert(
          {
            id: record.id,
            nickname,
            word: matchedWord,
            content,
            firedAt: new Date().toLocaleTimeString('ko-KR')
          },
          cfg.alertDurationSec
        );
      }
    },
    [showAlert]
  );

  // 서버 상태/댓글 리스너 등록 (마운트 1회)
  useEffect(() => {
    const offStatus = commentStreamService.onStatus((status, message) => {
      setServerStatus(status);
      if (message !== undefined && message !== null && message !== '') {
        setServerMessage(message);
      }
    });
    const offComment = commentStreamService.onComment(ingestComment);
    return () => {
      offStatus();
      offComment();
    };
  }, [ingestComment]);

  // 토글/서버 URL 변경에 따른 로컬 서버 연결 생명주기 관리
  useEffect(() => {
    if (isActiveRef.current) {
      commentStreamService.connect(configRef.current.serverUrl);
    } else {
      commentStreamService.stopCollecting();
      commentStreamService.disconnect();
      setServerStatus('DISCONNECTED');
      setServerMessage('로컬 댓글 수집 서버 미연결');
    }
  }, [isActive, config.serverUrl]);

  // 수집 시작 조건 충족 시 틱톡 수집 요청: 토글 ON + 라이브 청취 중 + 서버 소켓 연결됨
  useEffect(() => {
    if (!isActiveRef.current) return;

    if (isListening && serverStatus === 'CONNECTED') {
      const username = configRef.current.tiktokUsername.trim();
      if (!username) {
        setServerMessage('틱톡 ID 미설정 - "캡처 영역 & 단어 규칙" 페이지에서 설정하세요');
        return;
      }
      commentStreamService.startCollecting(username);
    }

    if (!isListening) {
      commentStreamService.stopCollecting();
    }
  }, [isListening, serverStatus]);

  // 회차 시작/변경 시 중복 키 적재 및 현재 회차 피드 복원
  useEffect(() => {
    seenKeysRef.current = new Set(
      storageService.getCommentRecords().map((r) => commentDedupeKey(r.nickname, r.content))
    );

    const sessionRecords = storageService
      .getCommentRecords()
      .filter((r) => r.sessionId === currentSessionId)
      .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
      .slice(-100);
    setLiveComments(sessionRecords);

    setNewCount(0);
  }, [isActive, isListening, currentSessionId]);

  // 언마운트 시 정리
  useEffect(
    () => () => {
      commentStreamService.stopCollecting();
      commentStreamService.disconnect();
    },
    []
  );

  const startCapture = useCallback(() => setIsActive(true), []);
  const stopCapture = useCallback(() => setIsActive(false), []);

  const isRunning = isActive && isListening && serverStatus === 'COLLECTING';

  return (
    <CommentCaptureContext.Provider
      value={{
        isActive,
        isRunning,
        serverStatus,
        serverMessage,
        newCount,
        liveComments,
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
                {activeAlert.firedAt} 틱톡 댓글 감지
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

// 상태 배지 렌더링용 헬퍼 (페이지에서 재사용)
export function getCommentStatusBadge(status: CommentStreamStatus): { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } {
  switch (status) {
    case 'COLLECTING':
      return { label: '실시간 수집중', tone: 'ok' };
    case 'WAITING_LIVE':
      return { label: '방송 시작 대기중', tone: 'warn' };
    case 'CONNECTING_TIKTOK':
      return { label: '틱톡 연결중', tone: 'warn' };
    case 'CONNECTED':
      return { label: '로컬 서버 대기중', tone: 'idle' };
    case 'ENDED':
      return { label: '방송 종료됨', tone: 'idle' };
    case 'ERROR':
      return { label: '수집 오류', tone: 'bad' };
    case 'CONNECTING':
      return { label: '서버 연결중', tone: 'idle' };
    default:
      return { label: '로컬 서버 미실행', tone: 'bad' };
  }
}

export const useCommentCapture = () => {
  const context = useContext(CommentCaptureContext);
  if (!context) {
    throw new Error('useCommentCapture must be used within a CommentCaptureProvider');
  }
  return context;
};

export type { CommentRecord, CommentStreamStatus };
