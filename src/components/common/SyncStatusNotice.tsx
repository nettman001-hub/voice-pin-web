import React, { useEffect, useState } from 'react';
import { useSales } from '../../context/SalesContext';
import { storageService } from '../../services/storageService';
import { flushPendingComments } from '../../services/commentSyncService';
import { useAuth } from '../../context/AuthContext';

export const SyncStatusNotice: React.FC = () => {
  const { syncError, retrySync } = useSales();
  const { workspaceId } = useAuth();
  const [commentError, setCommentError] = useState(false);
  const [storageError, setStorageError] = useState(storageService.getPersistenceError());
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
  if (!syncError && !storageError && !commentError) return null;
  return (
    <div role="status" className="m-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
      <span>{storageError
        ? '이 기기에 데이터를 안전하게 보관하지 못했습니다. 클라우드 저장 완료 전에는 창을 닫지 말고 저장공간을 확보해 주세요.'
        : syncError || '댓글 클라우드 저장 대기 중입니다. 연결되면 자동으로 재전송합니다.'}</span>
      <button type="button" onClick={() => {
        storageService.retryPersistence(); retrySync();
        if (workspaceId) void flushPendingComments(workspaceId).catch(() => {});
      }} className="font-bold underline">저장 재시도</button>
    </div>
  );
};
