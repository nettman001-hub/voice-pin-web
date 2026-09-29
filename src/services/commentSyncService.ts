import { productSalesApi } from './productSalesApi';
import { storageService } from './storageService';
import { isTemporarySessionId } from './storageService';
import type { CommentRecord } from '../types/comment';

export interface QueuedCloudComment {
  sessionId: string;
  platformMessageId: string;
  platformUserId?: string;
  platformUniqueId?: string;
  nickname: string;
  content: string;
  capturedAt: string;
  ingestSequence: number;
}

const flights = new Map<string, Promise<void>>();
const key = (comment: QueuedCloudComment) => `${comment.sessionId}:${comment.platformMessageId}`;

export function enqueueCloudComment(workspaceId: string, comment: QueuedCloudComment) {
  const queue = storageService.getCommentOutbox<QueuedCloudComment>(workspaceId);
  if (!queue.some((item) => key(item) === key(comment))) {
    storageService.saveCommentOutbox(workspaceId, [...queue, comment]);
  }
}

export function promoteCommentOutbox(workspaceId: string, from: string, to: string) {
  if (!isTemporarySessionId(from) || isTemporarySessionId(to)) return;
  const queue = storageService.getCommentOutbox<QueuedCloudComment>(workspaceId);
  storageService.saveCommentOutbox(workspaceId, queue.map((item) => item.sessionId === from ? { ...item, sessionId: to } : item));
}

export function flushPendingComments(workspaceId: string): Promise<void> {
  const existing = flights.get(workspaceId);
  if (existing) return existing;
  const report = (failed: boolean) => {
    if (storageService.getWorkspaceId() === workspaceId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('voicecap_comment_sync_error', { detail: { workspaceId, failed } }));
    }
  };
  const flight = drain(workspaceId).then(() => report(false), (error) => { report(true); throw error; })
    .finally(() => flights.delete(workspaceId));
  flights.set(workspaceId, flight);
  return flight;
}

async function drain(workspaceId: string) {
  while (storageService.getWorkspaceId() === workspaceId) {
    const queue = storageService.getCommentOutbox<QueuedCloudComment>(workspaceId);
    const first = queue.find((item) => !isTemporarySessionId(item.sessionId));
    if (!first) return; // Provisional comments remain queued until the server session is ready.
    const batch = queue.filter((item) => item.sessionId === first.sessionId).slice(0, 50);
    const response = await productSalesApi.ingestComments({
      workspaceId,
      sessionId: first.sessionId,
      comments: batch.map(({ sessionId: _sessionId, ...comment }) => comment),
    });
    // The old API did not return canonical records. During a rolling deployment,
    // reconcile once after a write instead of discarding acknowledgement data.
    if (!Array.isArray(response.comments) && storageService.getWorkspaceId() !== workspaceId) return;
    const canonical = Array.isArray(response.comments) ? response.comments
      : (await productSalesApi.listLiveComments({ workspaceId, sessionId: first.sessionId, limit: 5000 })).comments;
    const acknowledged = new Set(canonical.map((comment) => `${comment.sessionId}:${comment.platformMessageId}`));
    const records: CommentRecord[] = canonical.filter((comment) => batch.some((item) => key(item) === `${comment.sessionId}:${comment.platformMessageId}`))
      .map((comment) => ({
        id: comment.id, platformMessageId: comment.platformMessageId, sessionId: comment.sessionId,
        nickname: comment.nicknameSnapshot, buyerId: comment.buyerId ?? null,
        content: comment.content, capturedAt: comment.capturedAt,
      }));
    // Explicit scope prevents an old request from touching a newly signed-in account.
    storageService.addCommentRecords(records, workspaceId);
    const sent = new Set(batch.filter((item) => acknowledged.has(key(item))).map(key));
    const currentQueue = storageService.getCommentOutbox<QueuedCloudComment>(workspaceId);
    storageService.saveCommentOutbox(workspaceId, currentQueue.filter((item) => !sent.has(key(item))));
    if (storageService.getWorkspaceId() === workspaceId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('voicecap_comments_updated', { detail: { workspaceId } }));
    }
    if (sent.size !== batch.length) throw new Error('댓글 저장 확인을 기다리고 있습니다. 연결 후 다시 전송합니다.');
  }
}
