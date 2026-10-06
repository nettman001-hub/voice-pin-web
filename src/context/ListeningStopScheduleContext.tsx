import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useLive } from './LiveContext';
import { useCommentCapture } from './CommentCaptureContext';
import {
  isListeningStopBroadcast, isListeningStopOwner, remainingListeningStopSeconds, validateListeningStopAt,
  type ListeningStopOwner, type ListeningStopSchedule,
} from '../services/listeningStopScheduleService';

interface ListeningStopScheduleContextValue {
  scheduledStop: ListeningStopSchedule | null;
  remainingSeconds: number;
  completedAt: number | null;
  scheduleStop: (endsAt: number) => void;
  cancelScheduledStop: () => void;
  dismissCompletion: () => void;
}

const ListeningStopScheduleContext = createContext<ListeningStopScheduleContextValue | null>(null);

// This provider stays mounted across menu navigation. A reservation belongs to
// this browser's current listening run, never another user/session or a reload.
export const ListeningStopScheduleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, workspaceId } = useAuth();
  const { isListening, currentSessionId, listeningRunId, stopListening } = useLive();
  const { stopCapture } = useCommentCapture();
  const owner: ListeningStopOwner = { userId: user?.id || '', workspaceId: workspaceId || '', sessionId: currentSessionId, listeningRunId };
  const [scheduledStop, setScheduledStop] = useState<ListeningStopSchedule | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [completion, setCompletion] = useState<(ListeningStopOwner & { completedAt: number }) | null>(null);
  const scheduledStopRef = useRef<ListeningStopSchedule | null>(null);
  const runtimeRef = useRef({ owner, isListening, stopListening, stopCapture });
  runtimeRef.current = { owner, isListening, stopListening, stopCapture };

  const cancelScheduledStop = useCallback(() => {
    scheduledStopRef.current = null;
    setScheduledStop(null);
    setRemainingSeconds(0);
  }, []);
  const dismissCompletion = useCallback(() => setCompletion(null), []);

  const scheduleStop = useCallback((endsAt: number) => {
    const runtime = runtimeRef.current;
    if (!runtime.isListening || !runtime.owner.userId || !runtime.owner.workspaceId) {
      throw new Error('라이브 청취를 시작한 후 종료 예약을 설정해 주세요.');
    }
    const now = Date.now();
    validateListeningStopAt(endsAt, now);
    const next = { ...runtime.owner, endsAt };
    scheduledStopRef.current = next;
    setScheduledStop(next);
    setRemainingSeconds(remainingListeningStopSeconds(endsAt, now));
    setCompletion(null);
  }, []);

  useEffect(() => {
    const current = scheduledStopRef.current;
    if (current && (!isListening || !isListeningStopOwner(current, owner))) cancelScheduledStop();
    if (isListening || (completion && !isListeningStopBroadcast(completion, owner))) setCompletion(null);
  }, [isListening, user?.id, workspaceId, currentSessionId, listeningRunId, cancelScheduledStop]);

  useEffect(() => {
    if (!scheduledStop) return;
    const checkDeadline = () => {
      const current = scheduledStopRef.current;
      const runtime = runtimeRef.current;
      if (!current) return;
      if (!runtime.isListening || !isListeningStopOwner(current, runtime.owner)) {
        cancelScheduledStop();
        return;
      }
      const now = Date.now();
      setRemainingSeconds(remainingListeningStopSeconds(current.endsAt, now));
      if (now < current.endsAt) return;
      // Claim before invoking either stop: delayed/duplicate browser events
      // cannot end a subsequent listening run or execute the same stop twice.
      cancelScheduledStop();
      setCompletion({ ...runtime.owner, completedAt: now });
      try {
        runtime.stopListening();
      } finally {
        runtime.stopCapture();
      }
    };
    checkDeadline();
    const timer = window.setInterval(checkDeadline, 1000);
    window.addEventListener('focus', checkDeadline);
    document.addEventListener('visibilitychange', checkDeadline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkDeadline);
      document.removeEventListener('visibilitychange', checkDeadline);
    };
  }, [scheduledStop, cancelScheduledStop]);

  const visibleSchedule = scheduledStop && isListening && isListeningStopOwner(scheduledStop, owner) ? scheduledStop : null;
  return (
    <ListeningStopScheduleContext.Provider value={{
      scheduledStop: visibleSchedule, remainingSeconds: visibleSchedule ? remainingSeconds : 0,
      completedAt: completion && !isListening && isListeningStopBroadcast(completion, owner) ? completion.completedAt : null,
      scheduleStop, cancelScheduledStop, dismissCompletion,
    }}>
      {children}
    </ListeningStopScheduleContext.Provider>
  );
};

export function useListeningStopSchedule() {
  const context = useContext(ListeningStopScheduleContext);
  if (!context) throw new Error('useListeningStopSchedule must be used within a ListeningStopScheduleProvider');
  return context;
}
