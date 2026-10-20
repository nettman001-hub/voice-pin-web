import type { AiTask, CreateAiTaskPayload } from '../types/aiTask.ts';

/**
 * 신규 AI 작업 객체 생성
 */
export function createAiTaskObject(payload: CreateAiTaskPayload, primarySlot: 1 | 2 = 1): AiTask {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  const taskId = `ai_task_${timestamp}_${randomSuffix}`;
  const now = new Date().toISOString();

  const chosenSlot: 1 | 2 = (payload as any).activeSlot ?? primarySlot ?? 1;

  return {
    taskId,
    workspaceId: payload.workspaceId,
    sessionId: payload.sessionId,
    saleId: payload.saleId,
    saleRevision: payload.saleRevision ?? 1,
    settingVersion: payload.settingVersion ?? 1,
    evidenceSnapshotVersion: payload.evidenceSnapshotVersion ?? 1,
    taskType: payload.taskType,
    status: 'QUEUED',
    activeSlot: chosenSlot,
    currentAttemptId: `att_${taskId}_init`,
    currentUtterance: payload.currentUtterance,
    requestPayload: payload.request,
    resolutionResult: null,
    switchReason: null,
    failureReason: null,
    attempts: [],
    createdAt: now,
    updatedAt: now,
  };
}
