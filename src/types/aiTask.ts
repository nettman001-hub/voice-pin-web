import type { AiTaskType, AiResolutionRequest, AiResolutionResult } from './aiResolution.ts';

export type AiTaskStatus =
  | 'QUEUED'            // 작업 대기 중
  | 'PROCESSING'        // 분석 처리 중
  | 'RESOLVED'          // 해결 완료
  | 'INSUFFICIENT_DATA' // 근거 부족 (장애 아님, 추가 자료 대기)
  | 'FAILED'            // 실행 실패 (두 슬롯 모두 실패, 재시도 대기)
  | 'CANCELLED';        // 작업 취소됨

export type AiAttemptStatus =
  | 'RUNNING'   // 시도 실행 중
  | 'COMPLETED' // 정상 응답 수신
  | 'FAILED'    // 시도 실패
  | 'EXPIRED'   // 다른 슬롯 전환 등으로 시도 권한 만료됨
  | 'CANCELLED';// 시도 취소됨

export interface AiTaskAttempt {
  id?: string;
  attemptId: string;
  taskId: string;
  slotNumber: 1 | 2;
  status: AiAttemptStatus;
  isValidAttempt: boolean;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  result?: AiResolutionResult | null;
}

export interface AiTask {
  id?: string;
  taskId: string;
  workspaceId: string;
  sessionId: string;
  saleId: string;
  saleRevision: number;
  settingVersion: number;
  evidenceSnapshotVersion: number;
  taskType: AiTaskType;
  status: AiTaskStatus;
  activeSlot: 1 | 2;
  currentAttemptId: string;
  currentUtterance: string;
  requestPayload: AiResolutionRequest;
  resolutionResult?: AiResolutionResult | null;
  switchReason?: string | null;
  failureReason?: string | null;
  attempts?: AiTaskAttempt[];
  createdAt: string;
  updatedAt: string;
}

export interface AiCircuitBreakerState {
  slotNumber: 1 | 2;
  isOpen: boolean;
  consecutiveFailures: number;
  cooldownUntil?: string | null;
  consecutiveRecoverySuccesses: number;
  lastFailureReason?: string | null;
}

export interface AiRuntimeStatus {
  activeSlot: 1 | 2;
  activePrimarySlot: 1 | 2;
  slot1CircuitBreaker: AiCircuitBreakerState;
  slot2CircuitBreaker: AiCircuitBreakerState;
  queuedTaskCount: number;
  processingTaskCount: number;
  resolvedTaskCount: number;
  insufficientDataTaskCount: number;
  failedTaskCount: number;
  lastSwitchReason?: string | null;
  lastSwitchedAt?: string | null;
  checkedAt: string;
}

export interface CreateAiTaskPayload {
  taskType: AiTaskType;
  workspaceId: string;
  sessionId: string;
  saleId: string;
  saleRevision?: number;
  settingVersion?: number;
  evidenceSnapshotVersion?: number;
  currentUtterance: string;
  request: AiResolutionRequest;
}

export interface GetAiTasksQuery {
  workspaceId?: string;
  sessionId?: string;
  status?: AiTaskStatus;
  saleId?: string;
  limit?: number;
  offset?: number;
}
