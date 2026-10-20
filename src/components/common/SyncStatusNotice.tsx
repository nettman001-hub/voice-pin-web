import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import React, { useEffect, useRef, useState } from 'react';
import { useSales } from '../../context/SalesContext';


export const SyncStatusNotice: React.FC = () => {
  const runtime = useWorkspaceRuntime();
  const { storageService, flushPendingComments } = runtime;
  const { syncError, retrySync } = useSales();
  const { workspaceId } = useAuth();
  const [commentError, setCommentError] = useState(false);
  const [storageError, setStorageError] = useState(storageService.getPersistenceError());
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const retryInProgress = useRef(false);
  useEffect(() => {
    if (!retryNotice) return;
    const timer = window.setTimeout(() => setRetryNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [retryNotice]);
  useEffect(() => {
    const update = () => setStorageError(storageService.getPersistenceError());
    window.addEventListener('voicecap_persistence_changed', update);
    return () => window.removeEventListener('voicecap_persistence_changed', update);
  }, []);
  useEffect(() => {
    setCommentError(false);
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.workspaceId === workspaceId) setCommentError(detail.failed);
    };
    window.addEventListener('voicecap_comment_sync_error', update);
    return () => window.removeEventListener('voicecap_comment_sync_error', update);
  }, [workspaceId]);
  const retry = async () => {
    if (retryInProgress.current) return;
    retryInProgress.current = true;
    setIsRetrying(true);
    setRetryNotice(null);
    try {
      storageService.retryPersistence();
      const attempts = await Promise.allSettled([
        retrySync(),
        workspaceId ? flushPendingComments(workspaceId) : Promise.resolve(),
      ]);
      setRetryNotice(attempts.some((attempt) => attempt.status === 'rejected')
        ? '일부 저장 재시도에 실패했습니다. 현재 오류 안내를 확인해 주세요.'
        : '재시도를 마쳤습니다. 현재 저장 상태와 오류 안내를 확인해 주세요.');
    } catch {
      setRetryNotice('저장 재시도를 진행하지 못했습니다. 현재 오류 안내를 확인해 주세요.');
    } finally {
      retryInProgress.current = false;
      setIsRetrying(false);
    }
  };
  if (!syncError && !storageError && !commentError && !isRetrying && !retryNotice) return null;
  return (
    <div role="status" className="m-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
      {(storageError || syncError || commentError) && <span>{storageError
        ? (runtime.isTest ? '테스트 DB에 기록을 보관하지 못했습니다. 저장 공간을 확인해 주세요.' : '이 기기에 데이터를 안전하게 보관하지 못했습니다. 클라우드 저장 완료 전에는 창을 닫지 말고 저장공간을 확보해 주세요.')
        : syncError || (runtime.isTest ? '댓글 테스트 DB 저장을 기다리고 있습니다.' : '댓글 클라우드 저장 대기 중입니다. 연결되면 자동으로 재전송합니다.')}</span>}
      <button type="button" disabled={isRetrying} onClick={() => { void retry(); }}
        className="font-bold underline disabled:cursor-wait disabled:opacity-60">
        {isRetrying ? '저장 재시도 중…' : '저장 재시도'}
      </button>
      {retryNotice && <span className="text-xs">{retryNotice}</span>}
    </div>
  );
};
