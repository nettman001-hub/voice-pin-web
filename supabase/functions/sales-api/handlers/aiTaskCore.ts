import type {
  AiTask,
  AiTaskAttempt,
  AiTaskStatus,
  AiCircuitBreakerState,
  AiRuntimeStatus,
  CreateAiTaskPayload,
} from '../../../../src/types/aiTask.ts';
import type { AiSlotConfig } from '../../../../src/types/aiSettings.ts';
import type { AiResolutionRequest, AiResolutionResult } from '../../../../src/types/aiResolution.ts';
import { executeAiResolution, type HelperDispatcherFn } from './aiAdapters/index.ts';
import { AI_TASK_CONFIG } from './aiTaskConfig.ts';

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

export interface ProcessAiTaskOptions {
  slot1Config: AiSlotConfig;
  slot2Config: AiSlotConfig;
  slot1Secret?: string;
  slot2Secret?: string;
  primarySlot?: 1 | 2;
  slot1CircuitBreaker?: AiCircuitBreakerState;
  slot2CircuitBreaker?: AiCircuitBreakerState;
  helperDispatcher?: HelperDispatcherFn;
  allowInsecureHttpForExternal?: boolean;
}

/**
 * AI 작업 실행 및 1번 ↔ 2번 자동 전환 (Failover) 오케스트레이터
 * - primarySlot 설정(1번 또는 2번)에 따라 우선 슬롯 시도 -> 장애 시 즉시 대체 슬롯 전환
 * - 전환 시 이전 시도 권한 만료 (Late Result 차단)
 * - 근거 부족(자료 부족)은 장애가 아니므로 대체 전환 없이 보류 유지
 * - 두 슬롯 모두 실패 시 작업 보존 및 재시도 대기 (FAILED)
 */
export async function processAiTask(
  task: AiTask,
  options: ProcessAiTaskOptions
): Promise<{
  task: AiTask;
  slot1CircuitBreaker: AiCircuitBreakerState;
  slot2CircuitBreaker: AiCircuitBreakerState;
}> {
  const {
    slot1Config,
    slot2Config,
    slot1Secret,
    slot2Secret,
    primarySlot = 1,
    slot1CircuitBreaker = {
      slotNumber: 1,
      isOpen: false,
      consecutiveFailures: 0,
      cooldownUntil: null,
      consecutiveRecoverySuccesses: 0,
    },
    slot2CircuitBreaker = {
      slotNumber: 2,
      isOpen: false,
      consecutiveFailures: 0,
      cooldownUntil: null,
      consecutiveRecoverySuccesses: 0,
    },
    helperDispatcher,
    allowInsecureHttpForExternal,
  } = options;

  const cbMap: Record<1 | 2, AiCircuitBreakerState> = {
    1: { ...slot1CircuitBreaker },
    2: { ...slot2CircuitBreaker },
  };

  const slotConfigs: Record<1 | 2, AiSlotConfig> = {
    1: slot1Config,
    2: slot2Config,
  };

  const slotSecrets: Record<1 | 2, string | undefined> = {
    1: slot1Secret,
    2: slot2Secret,
  };

  const nowTime = Date.now();
  if (!task.attempts) task.attempts = [];

  const secondarySlot: 1 | 2 = primarySlot === 1 ? 2 : 1;
  const isPrimaryCooldown = Boolean(
    cbMap[primarySlot].cooldownUntil && new Date(cbMap[primarySlot].cooldownUntil!).getTime() > nowTime
  );

  let sequence: (1 | 2)[] = [primarySlot, secondarySlot];
  if (isPrimaryCooldown) {
    sequence = [secondarySlot];
    task.switchReason = `슬롯 ${primarySlot} 서킷 브레이커 작동 중 (${AI_TASK_CONFIG.CIRCUIT_BREAKER.COOLDOWN_MS / 1000}초 쿨다운) -> 슬롯 ${secondarySlot}로 우회 실행`;
  }

  let lastError: string | null = null;

  for (let idx = 0; idx < sequence.length; idx++) {
    const slotNum = sequence[idx];
    const attemptId = `att_${task.taskId}_slot${slotNum}_${Date.now()}`;
    task.currentAttemptId = attemptId;
    task.activeSlot = slotNum;
    task.status = 'PROCESSING';

    // 이전 슬롯 시도들 권한 만료 처리
    for (const att of task.attempts) {
      if (att.status === 'RUNNING') {
        att.status = 'EXPIRED';
        att.isValidAttempt = false;
      }
    }

    const attempt: AiTaskAttempt = {
      attemptId,
      taskId: task.taskId,
      slotNumber: slotNum,
      status: 'RUNNING',
      isValidAttempt: true,
      startedAt: new Date().toISOString(),
    };
    task.attempts.push(attempt);

    const startTime = Date.now();
    let slotResult: AiResolutionResult | null = null;
    let slotError: string | null = null;

    try {
      slotResult = await executeAiResolution(task.requestPayload, {
        slotConfig: slotConfigs[slotNum],
        secretValue: slotSecrets[slotNum],
        helperDispatcher,
        allowInsecureHttpForExternal,
      });

      const isEngineError =
        slotResult.conflictReason === '추론 엔진 호출 실패' ||
        slotResult.conflictReason === '보안 정책 위반' ||
        slotResult.conflictReason === '클라우드 공급자 통신 오류' ||
        slotResult.conflictReason === '응답 형식 불일치' ||
        slotResult.conflictReason === 'HELPER_OFFLINE' ||
        slotResult.conflictReason === 'AUTHENTICATION_FAILED' ||
        slotResult.conflictReason === 'TIMEOUT' ||
        slotResult.conflictReason === 'TLS_ERROR' ||
        (slotResult.conflictReason && !slotResult.resolvable && slotResult.evidenceSummary?.includes('호출 실패'));

      if (isEngineError) {
        slotError = slotResult.evidenceSummary || `슬롯 ${slotNum} 응답 실패`;
        attempt.errorCode = slotResult.conflictReason || 'ENGINE_FAILURE';
      }
    } catch (err: any) {
      slotError = err.message || `슬롯 ${slotNum} 실행 중 예외 발생`;
      if (err.code) {
        attempt.errorCode = err.code;
      }
    }

    attempt.completedAt = new Date().toISOString();
    attempt.latencyMs = Date.now() - startTime;

    // 늦은 결과 검증 가드
    if (task.currentAttemptId !== attemptId) {
      attempt.status = 'EXPIRED';
      attempt.isValidAttempt = false;
      return { task, slot1CircuitBreaker: cbMap[1], slot2CircuitBreaker: cbMap[2] };
    }

    if (!slotError && slotResult) {
      attempt.result = slotResult;
      attempt.status = 'COMPLETED';

      if (slotResult.resolvable === true) {
        task.status = 'RESOLVED';
        task.resolutionResult = slotResult;
        task.updatedAt = new Date().toISOString();

        // 서킷 브레이커 성공 반영
        cbMap[slotNum].consecutiveFailures = 0;
        cbMap[slotNum].consecutiveRecoverySuccesses += 1;
        if (cbMap[slotNum].consecutiveRecoverySuccesses >= AI_TASK_CONFIG.CIRCUIT_BREAKER.RECOVERY_SUCCESS_THRESHOLD) {
          cbMap[slotNum].isOpen = false;
          cbMap[slotNum].cooldownUntil = null;
        }

        return { task, slot1CircuitBreaker: cbMap[1], slot2CircuitBreaker: cbMap[2] };
      } else {
        // 정상 응답이나 근거 부족(자료 부족)인 경우 - 장애가 아니므로 대체 전환 없이 보류 유지
        task.status = 'INSUFFICIENT_DATA';
        task.resolutionResult = slotResult;
        task.updatedAt = new Date().toISOString();
        cbMap[slotNum].consecutiveFailures = 0;
        return { task, slot1CircuitBreaker: cbMap[1], slot2CircuitBreaker: cbMap[2] };
      }
    } else {
      // 슬롯 실패
      attempt.status = 'FAILED';
      attempt.isValidAttempt = false;
      attempt.errorMessage = slotError || `슬롯 ${slotNum} 장애`;
      lastError = slotError;

      // 서킷 브레이커 실패 카운트 증가
      cbMap[slotNum].consecutiveFailures += 1;
      cbMap[slotNum].consecutiveRecoverySuccesses = 0;
      if (cbMap[slotNum].consecutiveFailures >= AI_TASK_CONFIG.CIRCUIT_BREAKER.FAIL_THRESHOLD) {
        cbMap[slotNum].isOpen = true;
        cbMap[slotNum].cooldownUntil = new Date(Date.now() + AI_TASK_CONFIG.CIRCUIT_BREAKER.COOLDOWN_MS).toISOString();
        cbMap[slotNum].lastFailureReason = slotError;
      }

      if (idx < sequence.length - 1) {
        const nextSlot = sequence[idx + 1];
        task.switchReason = `슬롯 ${slotNum} 오류 (${slotError}) -> 슬롯 ${nextSlot}로 자동 전환`;
      }
    }
  }

  // 모든 슬롯 시도 실패
  task.status = 'FAILED';
  task.failureReason = `두 슬롯 모두 실패 (${lastError || '알 수 없는 오류'}) - 재시도 대기`;
  task.updatedAt = new Date().toISOString();

  return { task, slot1CircuitBreaker: cbMap[1], slot2CircuitBreaker: cbMap[2] };
}

/**
 * 늦게 도착한 과거 시도 결과의 반영 거절 함수
 */
export function validateAndApplyLateAttemptResult(
  task: AiTask,
  incomingAttemptId: string,
  _incomingResult: AiResolutionResult
): { accepted: boolean; reason: string } {
  if (task.currentAttemptId !== incomingAttemptId) {
    return {
      accepted: false,
      reason: `만료된 시도 결과 폐기: 현재 유효 시도는 '${task.currentAttemptId}'이며 수신된 시도는 '${incomingAttemptId}'입니다.`,
    };
  }

  if (task.status === 'RESOLVED' || task.status === 'CANCELLED') {
    return {
      accepted: false,
      reason: `작업이 이미 '${task.status}' 상태이므로 결과를 덮어쓰지 않습니다.`,
    };
  }

  return { accepted: true, reason: '유효한 시도 결과입니다.' };
}
