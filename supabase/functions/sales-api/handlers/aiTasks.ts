import { admin, successResponse, errorResponse, AuthContext } from '../../_shared/productSales.ts';
import type {
  AiTask,
  AiTaskAttempt,
  AiTaskStatus,
  AiCircuitBreakerState,
  AiRuntimeStatus,
  CreateAiTaskPayload,
} from '../../../../src/types/aiTask.ts';
import type { AiSlotConfig } from '../../../../src/types/aiSettings.ts';
import { createAiTaskObject, processAiTask } from './aiTaskCore.ts';
import { AI_TASK_CONFIG } from './aiTaskConfig.ts';

/**
 * 1. 신규 AI 작업 등록 (Queue Enqueue)
 */
export async function handleCreateAiTask(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any
) {
  const {
    sessionId,
    saleId,
    saleRevision = 1,
    settingVersion = 1,
    evidenceSnapshotVersion = 1,
    taskType = 'PENDING_RESOLUTION',
    currentUtterance = '',
    request,
  } = body || {};

  if (!saleId) {
    return errorResponse('VALIDATION_ERROR', 'saleId가 필요합니다.', 400);
  }
  if (!sessionId) {
    return errorResponse('VALIDATION_ERROR', 'sessionId가 필요합니다.', 400);
  }
  if (!request) {
    return errorResponse('VALIDATION_ERROR', 'request(AI 분석 요청) 본문이 필요합니다.', 400);
  }

  const payload: CreateAiTaskPayload = {
    workspaceId,
    sessionId,
    saleId,
    saleRevision,
    settingVersion,
    evidenceSnapshotVersion,
    taskType,
    currentUtterance,
    request,
  };

  const task = createAiTaskObject(payload);

  // DB ai_tasks 테이블에 적재
  const { error: insertErr } = await admin.from('ai_tasks').insert({
    task_id: task.taskId,
    workspace_id: task.workspaceId,
    session_id: task.sessionId,
    sale_id: task.saleId,
    sale_revision: task.saleRevision,
    setting_version: task.settingVersion,
    evidence_snapshot_version: task.evidenceSnapshotVersion,
    task_type: task.taskType,
    status: task.status,
    active_slot: task.activeSlot,
    current_attempt_id: task.currentAttemptId,
    current_utterance: task.currentUtterance,
    request_payload: task.requestPayload,
    resolution_result: task.resolutionResult,
    switch_reason: task.switchReason,
    failure_reason: task.failureReason,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  });

  if (insertErr) {
    return errorResponse('DATABASE_ERROR', `AI 작업 등록 실패: ${insertErr.message}`, 500);
  }

  return successResponse({ task });
}

/**
 * 2. AI 작업 실행 및 슬롯 1 -> 2 자동 전환 오케스트레이션
 * - DB에서 작업 및 서킷 브레이커 상태 조회
 * - processAiTask 실행
 * - 작업 상태, 시도(attempts) 이력, 서킷 브레이커 상태 DB 갱신
 * - 중요: 판매 데이터(sales 테이블)는 변경하지 않음 (Phase 5에 위임)
 */
export async function handleProcessAiTask(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any
) {
  const { taskId, task: inputTask, helperDispatcher, allowInsecureHttpForExternal } = body || {};

  let currentTask: AiTask;

  if (taskId) {
    const { data: dbTask, error: taskErr } = await admin
      .from('ai_tasks')
      .select('*')
      .eq('task_id', taskId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (taskErr || !dbTask) {
      return errorResponse('NOT_FOUND', `AI 작업을 찾을 수 없습니다: ${taskId}`, 404);
    }

    // 기존 시도 이력 조회
    const { data: dbAttempts } = await admin
      .from('ai_task_attempts')
      .select('*')
      .eq('task_id', taskId)
      .order('started_at', { ascending: true });

    const attempts: AiTaskAttempt[] = (dbAttempts || []).map((att) => ({
      attemptId: att.attempt_id,
      taskId: att.task_id,
      slotNumber: att.slot_number as 1 | 2,
      status: att.status,
      isValidAttempt: att.is_valid_attempt,
      startedAt: att.started_at,
      completedAt: att.completed_at,
      latencyMs: att.latency_ms,
      errorCode: att.error_code,
      errorMessage: att.error_message,
      result: att.result,
    }));

    currentTask = {
      id: dbTask.id,
      taskId: dbTask.task_id,
      workspaceId: dbTask.workspace_id,
      sessionId: dbTask.session_id,
      saleId: dbTask.sale_id,
      saleRevision: dbTask.sale_revision,
      settingVersion: dbTask.setting_version,
      evidenceSnapshotVersion: dbTask.evidence_snapshot_version,
      taskType: dbTask.task_type,
      status: dbTask.status,
      activeSlot: dbTask.active_slot as 1 | 2,
      currentAttemptId: dbTask.current_attempt_id,
      currentUtterance: dbTask.current_utterance,
      requestPayload: dbTask.request_payload,
      resolutionResult: dbTask.resolution_result,
      switchReason: dbTask.switch_reason,
      failureReason: dbTask.failure_reason,
      attempts,
      createdAt: dbTask.created_at,
      updatedAt: dbTask.updated_at,
    };
  } else if (inputTask) {
    currentTask = inputTask;
  } else {
    return errorResponse('VALIDATION_ERROR', 'taskId 또는 task 객체가 필요합니다.', 400);
  }

  // 1. AI 설정 조회
  const { data: setting } = await admin
    .from('ai_settings')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle();

  const slot1Config: AiSlotConfig = setting?.slot1 || {
    slotNumber: 1,
    type: 'LOCAL',
    provider: 'OLLAMA',
    location: 'SAME_PC',
    routingMode: 'SERVER_DIRECT',
    endpointUrl: 'http://127.0.0.1:11434',
    model: 'exaone3.5:7.8b',
    timeoutSeconds: AI_TASK_CONFIG.TIMEOUTS.SELF_HOSTED_SECONDS,
  };

  const slot2Config: AiSlotConfig = setting?.slot2 || {
    slotNumber: 2,
    type: 'CLOUD',
    provider: 'GOOGLE',
    model: 'gemini-1.5-flash',
    timeoutSeconds: AI_TASK_CONFIG.TIMEOUTS.CLOUD_SECONDS,
  };

  // 2. 비밀정보 조회
  let slot1Secret: string | undefined = undefined;
  let slot2Secret: string | undefined = undefined;

  if (setting?.id) {
    const { data: secrets } = await admin
      .from('ai_secrets')
      .select('*')
      .eq('setting_id', setting.id);

    if (secrets) {
      for (const sec of secrets) {
        if (sec.slot_number === 1) slot1Secret = sec.secret_value;
        if (sec.slot_number === 2) slot2Secret = sec.secret_value;
      }
    }
  }

  // 3. 서킷 브레이커 상태 조회
  const { data: dbBreakers } = await admin
    .from('ai_circuit_breaker')
    .select('*')
    .eq('workspace_id', workspaceId);

  const slot1BreakerRow = dbBreakers?.find((b) => b.slot_number === 1);
  const slot2BreakerRow = dbBreakers?.find((b) => b.slot_number === 2);

  const slot1CircuitBreaker: AiCircuitBreakerState = {
    slotNumber: 1,
    isOpen: slot1BreakerRow?.is_open || false,
    consecutiveFailures: slot1BreakerRow?.consecutive_failures || 0,
    cooldownUntil: slot1BreakerRow?.cooldown_until || null,
    consecutiveRecoverySuccesses: slot1BreakerRow?.consecutive_recovery_successes || 0,
    lastFailureReason: slot1BreakerRow?.last_failure_reason || null,
  };

  const slot2CircuitBreaker: AiCircuitBreakerState = {
    slotNumber: 2,
    isOpen: slot2BreakerRow?.is_open || false,
    consecutiveFailures: slot2BreakerRow?.consecutive_failures || 0,
    cooldownUntil: slot2BreakerRow?.cooldown_until || null,
    consecutiveRecoverySuccesses: slot2BreakerRow?.consecutive_recovery_successes || 0,
    lastFailureReason: slot2BreakerRow?.last_failure_reason || null,
  };

  // 4. 오케스트레이터 실행 (1번 시도 -> 실패 시 2번 전환)
  const result = await processAiTask(currentTask, {
    slot1Config,
    slot2Config,
    slot1Secret,
    slot2Secret,
    primarySlot: 1,
    slot1CircuitBreaker,
    slot2CircuitBreaker,
    helperDispatcher,
    allowInsecureHttpForExternal,
  });

  const updatedTask = result.task;

  // 5. DB 상태 갱신
  // 5-1. ai_tasks 테이블 갱신
  await admin
    .from('ai_tasks')
    .update({
      status: updatedTask.status,
      active_slot: updatedTask.activeSlot,
      current_attempt_id: updatedTask.currentAttemptId,
      resolution_result: updatedTask.resolutionResult,
      switch_reason: updatedTask.switchReason,
      failure_reason: updatedTask.failureReason,
      updated_at: updatedTask.updatedAt,
    })
    .eq('task_id', updatedTask.taskId);

  // 5-2. ai_task_attempts 테이블 갱신
  if (updatedTask.attempts && updatedTask.attempts.length > 0) {
    for (const att of updatedTask.attempts) {
      await admin.from('ai_task_attempts').upsert(
        {
          task_id: att.taskId,
          attempt_id: att.attemptId,
          slot_number: att.slotNumber,
          status: att.status,
          is_valid_attempt: att.isValidAttempt,
          started_at: att.startedAt,
          completed_at: att.completedAt,
          latency_ms: att.latencyMs,
          error_code: att.errorCode,
          error_message: att.errorMessage,
          result: att.result,
        },
        { onConflict: 'attempt_id' }
      );
    }
  }

  // 5-3. ai_circuit_breaker 갱신
  await admin.from('ai_circuit_breaker').upsert(
    [
      {
        workspace_id: workspaceId,
        slot_number: 1,
        is_open: result.slot1CircuitBreaker.isOpen,
        consecutive_failures: result.slot1CircuitBreaker.consecutiveFailures,
        cooldown_until: result.slot1CircuitBreaker.cooldownUntil,
        consecutive_recovery_successes: result.slot1CircuitBreaker.consecutiveRecoverySuccesses,
        last_failure_reason: result.slot1CircuitBreaker.lastFailureReason,
        updated_at: new Date().toISOString(),
      },
      {
        workspace_id: workspaceId,
        slot_number: 2,
        is_open: result.slot2CircuitBreaker.isOpen,
        consecutive_failures: result.slot2CircuitBreaker.consecutiveFailures,
        cooldown_until: result.slot2CircuitBreaker.cooldownUntil,
        consecutive_recovery_successes: result.slot2CircuitBreaker.consecutiveRecoverySuccesses,
        last_failure_reason: result.slot2CircuitBreaker.lastFailureReason,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'workspace_id,slot_number' }
  );

  return successResponse({
    task: updatedTask,
    slot1CircuitBreaker: result.slot1CircuitBreaker,
    slot2CircuitBreaker: result.slot2CircuitBreaker,
  });
}

/**
 * 3. AI 작업 목록 및 시도 이력 조회 (관리자 및 메인 화면용)
 */
export async function handleGetAiTasks(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any
) {
  const { sessionId, status, saleId, limit = 50, offset = 0 } = body || {};

  let query = admin
    .from('ai_tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sessionId) {
    query = query.eq('session_id', sessionId);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (saleId) {
    query = query.eq('sale_id', saleId);
  }

  const { data: dbTasks, error: taskErr } = await query;

  if (taskErr) {
    return errorResponse('DATABASE_ERROR', `AI 작업 목록 조회 실패: ${taskErr.message}`, 500);
  }

  if (!dbTasks || dbTasks.length === 0) {
    return successResponse({ tasks: [] });
  }

  const taskIds = dbTasks.map((t) => t.task_id);

  // 관련 attempts 조회
  const { data: dbAttempts } = await admin
    .from('ai_task_attempts')
    .select('*')
    .in('task_id', taskIds)
    .order('started_at', { ascending: true });

  const attemptsByTask: Record<string, AiTaskAttempt[]> = {};
  if (dbAttempts) {
    for (const att of dbAttempts) {
      if (!attemptsByTask[att.task_id]) {
        attemptsByTask[att.task_id] = [];
      }
      attemptsByTask[att.task_id].push({
        attemptId: att.attempt_id,
        taskId: att.task_id,
        slotNumber: att.slot_number as 1 | 2,
        status: att.status,
        isValidAttempt: att.is_valid_attempt,
        startedAt: att.started_at,
        completedAt: att.completed_at,
        latencyMs: att.latency_ms,
        errorCode: att.error_code,
        errorMessage: att.error_message,
        result: att.result,
      });
    }
  }

  const tasks: AiTask[] = dbTasks.map((t) => ({
    id: t.id,
    taskId: t.task_id,
    workspaceId: t.workspace_id,
    sessionId: t.session_id,
    saleId: t.sale_id,
    saleRevision: t.sale_revision,
    settingVersion: t.setting_version,
    evidenceSnapshotVersion: t.evidence_snapshot_version,
    taskType: t.task_type,
    status: t.status,
    activeSlot: t.active_slot as 1 | 2,
    currentAttemptId: t.current_attempt_id,
    currentUtterance: t.current_utterance,
    requestPayload: t.request_payload,
    resolutionResult: t.resolution_result,
    switchReason: t.switch_reason,
    failureReason: t.failure_reason,
    attempts: attemptsByTask[t.task_id] || [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));

  return successResponse({ tasks });
}

/**
 * 4. AI 런타임 상태 조회 (활성 슬롯, 서킷 브레이커, 대기열 현황)
 */
export async function handleGetAiRuntimeStatus(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  _body: any
) {
  // 서킷 브레이커 상태 조회
  const { data: dbBreakers } = await admin
    .from('ai_circuit_breaker')
    .select('*')
    .eq('workspace_id', workspaceId);

  const slot1BreakerRow = dbBreakers?.find((b) => b.slot_number === 1);
  const slot2BreakerRow = dbBreakers?.find((b) => b.slot_number === 2);

  const slot1CircuitBreaker: AiCircuitBreakerState = {
    slotNumber: 1,
    isOpen: slot1BreakerRow?.is_open || false,
    consecutiveFailures: slot1BreakerRow?.consecutive_failures || 0,
    cooldownUntil: slot1BreakerRow?.cooldown_until || null,
    consecutiveRecoverySuccesses: slot1BreakerRow?.consecutive_recovery_successes || 0,
    lastFailureReason: slot1BreakerRow?.last_failure_reason || null,
  };

  const slot2CircuitBreaker: AiCircuitBreakerState = {
    slotNumber: 2,
    isOpen: slot2BreakerRow?.is_open || false,
    consecutiveFailures: slot2BreakerRow?.consecutive_failures || 0,
    cooldownUntil: slot2BreakerRow?.cooldown_until || null,
    consecutiveRecoverySuccesses: slot2BreakerRow?.consecutive_recovery_successes || 0,
    lastFailureReason: slot2BreakerRow?.last_failure_reason || null,
  };

  // 쿨다운 상태 확인
  const nowTime = Date.now();
  const isSlot1Cooldown = Boolean(
    slot1CircuitBreaker.cooldownUntil &&
      new Date(slot1CircuitBreaker.cooldownUntil).getTime() > nowTime
  );

  const activePrimarySlot: 1 | 2 = isSlot1Cooldown ? 2 : 1;

  // 작업 상태별 카운트 조회
  const { data: tasks } = await admin
    .from('ai_tasks')
    .select('status, switch_reason, updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(100);

  let queued = 0;
  let processing = 0;
  let resolved = 0;
  let insufficientData = 0;
  let failed = 0;
  let lastSwitchReason: string | null = null;
  let lastSwitchedAt: string | null = null;

  if (tasks) {
    for (const t of tasks) {
      if (t.status === 'QUEUED') queued++;
      else if (t.status === 'PROCESSING') processing++;
      else if (t.status === 'RESOLVED') resolved++;
      else if (t.status === 'INSUFFICIENT_DATA') insufficientData++;
      else if (t.status === 'FAILED') failed++;

      if (!lastSwitchReason && t.switch_reason) {
        lastSwitchReason = t.switch_reason;
        lastSwitchedAt = t.updated_at;
      }
    }
  }

  const runtimeStatus: AiRuntimeStatus = {
    activeSlot: activePrimarySlot,
    activePrimarySlot,
    slot1CircuitBreaker,
    slot2CircuitBreaker,
    queuedTaskCount: queued,
    processingTaskCount: processing,
    resolvedTaskCount: resolved,
    insufficientDataTaskCount: insufficientData,
    failedTaskCount: failed,
    lastSwitchReason,
    lastSwitchedAt,
    checkedAt: new Date().toISOString(),
  };

  return successResponse({ runtimeStatus });
}
