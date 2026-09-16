import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useLive } from './LiveContext';
import { storageService } from '../services/storageService';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { productSalesApi } from '../services/productSalesApi';
import { useProductSales } from './ProductSalesContext';
import {
  commentDedupeKey,
  commentStreamService,
  StreamedComment
} from '../services/commentStreamService';
import type { CommentStreamStatus } from '../services/commentStreamService';
import { CommentCaptureConfig, CommentRecord, DEFAULT_COMMENT_CAPTURE_CONFIG, DEFAULT_COMMENT_SERVER_URL } from '../types/comment';

export interface CommentAlert {
  id: string;
  nickname: string;
  word: string;
  content: string;
  firedAt: string;
}

interface QueuedCloudComment {
  sessionId: string;
  platformMessageId: string;
  platformUserId?: string;
  platformUniqueId?: string;
  nickname: string;
  content: string;
  capturedAt: string;
  ingestSequence: number;
}

interface CommentCaptureContextType {
  isActive: boolean;              // 사용자가 켰거나 라이브 청취와 함께 시작된 댓글 수집 상태
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
  const { workspaceId } = useAuth();
  const { isListening, currentSessionId, transcriptLogs } = useLive();
  const { activeSession, feed, pollFeed } = useProductSales();

  // 안전을 위해 브라우저를 새로 열거나 새로고침할 때마다 댓글 수집은 꺼진 상태로 시작한다.
  // 판매자가 현재 방송에서 직접 시작 버튼을 눌렀을 때만 활성화한다.
  const [isActive, setIsActive] = useState<boolean>(false);
  const [serverStatus, setServerStatus] = useState<CommentStreamStatus>('DISCONNECTED');
  const [serverMessage, setServerMessage] = useState<string>('VoiceCAP 댓글 도우미 미연결');
  const [newCount, setNewCount] = useState<number>(0);
  const [liveComments, setLiveComments] = useState<CommentRecord[]>([]);
  const [activeAlert, setActiveAlert] = useState<CommentAlert | null>(null);
  const [config, setConfig] = useState<CommentCaptureConfig>(() => storageService.getCommentCaptureConfig());

  const seenKeysRef = useRef<Set<string>>(new Set());
  const alertTimerRef = useRef<number | null>(null);
  const configRef = useRef<CommentCaptureConfig>(config);
  const isActiveRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>(currentSessionId);
  const pendingCommentsRef = useRef<Map<string, CommentRecord>>(new Map());
  const cloudQueueRef = useRef<QueuedCloudComment[]>([]);
  const cloudFlushTimerRef = useRef<number | null>(null);
  const cloudFlushInFlightRef = useRef(false);
  const cloudIngestSequenceRef = useRef(0);
  const flushCloudQueueRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    // 댓글 도우미와 판매 피드는 서버가 발급한 방송 회차 UUID를 사용한다.
    // currentSessionId는 음성 청취용 표시 ID이므로, 이를 우선하면 클라우드 댓글을
    // 다른 회차로 판단해 화면에서 모두 제외하게 된다.
    const nextSessionId = activeSession?.id || currentSessionId;
    const prevSessionId = sessionIdRef.current;
    sessionIdRef.current = nextSessionId;

    // 임시 세션 ID에서 정식 활성 세션 UUID로 전환된 경우 기존 메모리 댓글의 세션 ID를 자동 승격
    if (nextSessionId && prevSessionId && prevSessionId !== nextSessionId) {
      for (const [key, comment] of pendingCommentsRef.current.entries()) {
        if (comment.sessionId === prevSessionId) {
          pendingCommentsRef.current.set(key, { ...comment, sessionId: nextSessionId });
        }
      }
      for (const item of cloudQueueRef.current) {
        if (item.sessionId === prevSessionId) {
          item.sessionId = nextSessionId;
        }
      }
      setLiveComments((prev) =>
        prev.map((c) => (c.sessionId === prevSessionId ? { ...c, sessionId: nextSessionId } : c))
      );
    }
  }, [activeSession?.id, currentSessionId]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // 클라우드 댓글 수집 설정 동기화
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;

    const syncCloudConfig = async () => {
      try {
        const cloudConfig = await remoteWorkspaceService.loadCommentCaptureConfig(workspaceId);
        if (!active) return;
        if (cloudConfig) {
          const merged: CommentCaptureConfig = {
            ...DEFAULT_COMMENT_CAPTURE_CONFIG,
            ...cloudConfig,
            serverUrl: DEFAULT_COMMENT_SERVER_URL,
            alertWords: Array.isArray(cloudConfig.alertWords)
              ? cloudConfig.alertWords
              : DEFAULT_COMMENT_CAPTURE_CONFIG.alertWords
          };
          // 로컬 스토리지에 이미 유효한 틱톡 ID가 등록되어 있었는데 클라우드 값이 비어있다면, 로컬 틱톡 ID를 보존하고 클라우드에 즉시 동기화
          const localConfig = storageService.getCommentCaptureConfig();
          if (localConfig.tiktokUsername && !merged.tiktokUsername) {
            merged.tiktokUsername = localConfig.tiktokUsername;
            void remoteWorkspaceService.saveCommentCaptureConfig(workspaceId, merged);
          }
          setConfig(merged);
          storageService.saveCommentCaptureConfig(merged);
        } else {
          // 클라우드에 아직 없으면 현재 로컬 설정을 최초 시딩 저장
          const current = storageService.getCommentCaptureConfig();
          void remoteWorkspaceService.saveCommentCaptureConfig(workspaceId, current);
        }
      } catch (err) {
        console.warn('[CommentCaptureContext] 클라우드 설정 동기화 실패:', err);
      }
    };

    void syncCloudConfig();
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // 평상시 최초 상태는 OFF지만, 라이브 청취가 시작되면 댓글 수집도 함께 켠다.
  // 라이브 중 판매자가 댓글 수집만 직접 끈 경우에는 isListening이 다시 바뀔 때까지
  // 강제로 재활성화하지 않아 사용자의 수동 선택을 유지한다.
  useEffect(() => {
    if (isListening) {
      setIsActive(true);
    }
  }, [isListening]);

  const saveConfig = useCallback(
    (next: CommentCaptureConfig) => {
      const clean: CommentCaptureConfig = {
        ...next,
        tiktokUsername: (next.tiktokUsername || '').replace(/^@/, '').trim()
      };
      setConfig(clean);
      storageService.saveCommentCaptureConfig(clean);
      if (workspaceId) {
        void remoteWorkspaceService.saveCommentCaptureConfig(workspaceId, clean);
      }
    },
    [workspaceId]
  );

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

    const commands = configRef.current.alertVoiceCommand
      .split(',')
      .map((command) => command.trim())
      .filter(Boolean);
    if (activeAlert && commands.some((command) => latest.text.includes(command))) {
      dismissAlert();
    }
  }, [transcriptLogs, activeAlert, dismissAlert]);

  const scheduleCloudFlush = useCallback((delayMs = 100) => {
    if (cloudFlushTimerRef.current !== null) return;
    cloudFlushTimerRef.current = window.setTimeout(() => {
      cloudFlushTimerRef.current = null;
      void flushCloudQueueRef.current();
    }, delayMs);
  }, []);

  // 설치 버전에 상관없이 로그인한 웹 세션이 댓글을 cloud live_comments에 적재한다.
  // 화면에는 소켓 댓글을 즉시 보여주고, 클라우드 반영 뒤 판매 피드를 다시 읽는다.
  const flushCloudQueue = useCallback(async () => {
    if (cloudFlushInFlightRef.current || cloudQueueRef.current.length === 0) return;

    const sessionId = cloudQueueRef.current[0].sessionId;
    let batchSize = 0;
    while (
      batchSize < cloudQueueRef.current.length
      && batchSize < 50
      && cloudQueueRef.current[batchSize].sessionId === sessionId
    ) {
      batchSize += 1;
    }
    const batch = cloudQueueRef.current.splice(0, batchSize);
    cloudFlushInFlightRef.current = true;

    try {
      await productSalesApi.ingestComments({
        sessionId,
        comments: batch.map(({ sessionId: _sessionId, ...comment }) => comment),
      });
      await pollFeed();
    } catch (error) {
      cloudQueueRef.current.unshift(...batch);
      console.warn('[CommentCaptureContext] 클라우드 댓글 적재 재시도:', error);
    } finally {
      cloudFlushInFlightRef.current = false;
      if (cloudQueueRef.current.length > 0) {
        scheduleCloudFlush(1_000);
      }
    }
  }, [pollFeed, scheduleCloudFlush]);

  flushCloudQueueRef.current = flushCloudQueue;

  // 댓글 도우미가 중계한 실시간 댓글 유입 처리
  const ingestComment = useCallback(
    (incoming: StreamedComment) => {
      if (!isActiveRef.current) return;

      const nickname = (incoming.nickname || incoming.uniqueId || '알 수 없음').trim();
      const content = String(incoming.content || '').trim();
      if (!content || !nickname) return;

      const platformMessageId = String(incoming.id || '').trim()
        || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // 메시지 ID 기반 중복 검사 (동일 시청자가 같은 내용의 댓글을 여러 번 남겨도 모두 정상 수신됨)
      const key = commentDedupeKey(nickname, content, platformMessageId, incoming.receivedAt);
      if (seenKeysRef.current.has(key)) return;
      seenKeysRef.current.add(key);

      // 메모리 누수 방지를 위한 슬라이딩 윈도우 관리 (최대 1,500개 유지)
      if (seenKeysRef.current.size > 1500) {
        const keysArray = Array.from(seenKeysRef.current);
        seenKeysRef.current = new Set(keysArray.slice(-800));
      }

      const cfg = configRef.current;
      const matchedWord = cfg.alertWords.find((word) => word && content.includes(word));

      const currentSession = sessionIdRef.current;
      const record: CommentRecord = {
        id: `stream-${platformMessageId}`,
        platformMessageId,
        sessionId: currentSession,
        nickname,
        uniqueId: incoming.uniqueId || undefined,
        content,
        capturedAt: incoming.receivedAt || new Date().toISOString(),
        ...(matchedWord ? { matchedAlertWord: matchedWord } : {})
      };

      pendingCommentsRef.current.set(platformMessageId, record);

      setLiveComments((previous) => {
        const withoutSameMsg = previous.filter(
          (item) => (item.platformMessageId ? item.platformMessageId !== platformMessageId : item.id !== record.id)
        );
        return [...withoutSameMsg, record]
          .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
          .slice(-100);
      });

      if (record.sessionId) {
        cloudIngestSequenceRef.current += 1;
        cloudQueueRef.current.push({
          sessionId: record.sessionId,
          platformMessageId,
          platformUserId: incoming.userId || incoming.uniqueId || undefined,
          platformUniqueId: incoming.uniqueId || undefined,
          nickname,
          content,
          capturedAt: record.capturedAt,
          ingestSequence: cloudIngestSequenceRef.current,
        });
        scheduleCloudFlush();
      }

      setNewCount((prev) => prev + 1);

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
    [scheduleCloudFlush, showAlert]
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

  // 자동 수집이 중지되어도 댓글 도우미 생존 상태를 표시할 수 있도록 연결은 유지한다.
  useEffect(() => {
    // 연결 주소는 설치형 도우미의 고정 로컬 주소를 사용한다.
    // 과거 버전에서 저장된 사설 IP 주소가 있어도 판매자에게 수동 수정을 요구하지 않는다.
    commentStreamService.connect(DEFAULT_COMMENT_SERVER_URL);

    if (!isActiveRef.current) {
      commentStreamService.stopCollecting();
    }
  }, [isActive]);

  // 수집 시작 조건 충족 시 틱톡 수집 요청: 토글 ON + 라이브 청취 중 + 서버 소켓 연결됨
  useEffect(() => {
    if (!isActive) return;

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
  }, [isActive, isListening, serverStatus]);

  // cloud live_comments와 로컬 링버퍼의 무손실 병합 동기화
  useEffect(() => {
    const cloudSessionId = activeSession?.id || currentSessionId;
    const sessionComments = (feed?.comments || [])
      .filter((comment) => comment.sessionId === cloudSessionId);

    for (const comment of sessionComments) {
      if (comment.platformMessageId) {
        pendingCommentsRef.current.delete(comment.platformMessageId);
        seenKeysRef.current.add(`msg:${comment.platformMessageId}`);
      }
    }

    const sessionRecords: CommentRecord[] = sessionComments.map((comment) => ({
      id: comment.id,
      platformMessageId: comment.platformMessageId,
      sessionId: comment.sessionId,
      nickname: comment.nicknameSnapshot,
      content: comment.content,
      capturedAt: comment.capturedAt,
    }));

    setLiveComments((prevComments) => {
      const byMsgId = new Map<string, CommentRecord>();
      const byRecordId = new Map<string, CommentRecord>();

      // 1. 기존 화면에 표시 중이던 댓글 보존
      for (const item of prevComments) {
        const isCurrentOrActive = !cloudSessionId || item.sessionId === cloudSessionId || item.sessionId === currentSessionId;
        if (isCurrentOrActive) {
          const migratedItem = cloudSessionId && item.sessionId !== cloudSessionId
            ? { ...item, sessionId: cloudSessionId }
            : item;
          if (migratedItem.platformMessageId) {
            byMsgId.set(migratedItem.platformMessageId, migratedItem);
          } else {
            byRecordId.set(migratedItem.id, migratedItem);
          }
        }
      }

      // 2. 클라우드 판매 피드에서 반환된 최신 댓글 반영 (정식 레코드 ID로 갱신)
      for (const cloudRec of sessionRecords) {
        if (cloudRec.platformMessageId && byMsgId.has(cloudRec.platformMessageId)) {
          const existing = byMsgId.get(cloudRec.platformMessageId)!;
          byMsgId.set(cloudRec.platformMessageId, {
            ...existing,
            id: cloudRec.id,
            sessionId: cloudRec.sessionId,
            nickname: cloudRec.nickname || existing.nickname,
            content: cloudRec.content || existing.content,
            capturedAt: cloudRec.capturedAt || existing.capturedAt,
          });
        } else if (cloudRec.platformMessageId) {
          byMsgId.set(cloudRec.platformMessageId, cloudRec);
        } else {
          byRecordId.set(cloudRec.id, cloudRec);
        }
      }

      // 3. 아직 클라우드 피드에 반영 대기 중인 로컬 댓글 반영
      for (const pending of pendingCommentsRef.current.values()) {
        const isCurrentOrActive = !cloudSessionId || pending.sessionId === cloudSessionId || pending.sessionId === currentSessionId;
        if (isCurrentOrActive) {
          const migratedPending = cloudSessionId && pending.sessionId !== cloudSessionId
            ? { ...pending, sessionId: cloudSessionId }
            : pending;
          if (migratedPending.platformMessageId && !byMsgId.has(migratedPending.platformMessageId)) {
            byMsgId.set(migratedPending.platformMessageId, migratedPending);
          } else if (!migratedPending.platformMessageId && !byRecordId.has(migratedPending.id)) {
            byRecordId.set(migratedPending.id, migratedPending);
          }
        }
      }

      const allMerged = [...Array.from(byMsgId.values()), ...Array.from(byRecordId.values())]
        .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
        .slice(-100);

      return allMerged;
    });
  }, [activeSession?.id, feed?.comments, currentSessionId]);

  // 언마운트 시 정리
  useEffect(
    () => () => {
      if (cloudFlushTimerRef.current !== null) {
        window.clearTimeout(cloudFlushTimerRef.current);
      }
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
                {config.alertDurationSec}초 후 자동으로 닫히거나 "{config.alertVoiceCommand.split(',').map((command) => command.trim()).filter(Boolean).join(' / ')}" 중 하나를 말씀하세요.
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
      return { label: '댓글 도우미 대기중', tone: 'idle' };
    case 'ENDED':
      return { label: '방송 종료됨', tone: 'idle' };
    case 'ERROR':
      return { label: '수집 오류', tone: 'bad' };
    case 'CONNECTING':
      return { label: '댓글 도우미 연결중', tone: 'idle' };
    default:
      return { label: '댓글 도우미 미연결', tone: 'bad' };
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
