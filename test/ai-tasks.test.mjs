import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiTaskObject,
  processAiTask,
  validateAndApplyLateAttemptResult,
} from '../supabase/functions/sales-api/handlers/aiTaskCore.ts';
import { AI_TASK_CONFIG } from '../supabase/functions/sales-api/handlers/aiTaskConfig.ts';

// 모의 슬롯 설정
const mockSlot1Config = {
  slotNumber: 1,
  type: 'LOCAL',
  provider: 'OLLAMA',
  location: 'SAME_PC',
  routingMode: 'SERVER_DIRECT',
  endpointUrl: 'http://127.0.0.1:11434',
  model: 'exaone3.5:7.8b',
  timeoutSeconds: AI_TASK_CONFIG.TIMEOUTS.SELF_HOSTED_SECONDS,
};

const mockSlot2Config = {
  slotNumber: 2,
  type: 'CLOUD',
  provider: 'GOOGLE',
  model: 'gemini-1.5-flash',
  timeoutSeconds: AI_TASK_CONFIG.TIMEOUTS.CLOUD_SECONDS,
};

function createSamplePayload(overrides = {}) {
  return {
    workspaceId: 'ws_test_001',
    sessionId: 'session_20260910_01',
    saleId: 'sale_999',
    saleRevision: 3,
    settingVersion: 2,
    evidenceSnapshotVersion: 4,
    taskType: 'PENDING_RESOLUTION',
    currentUtterance: '3번 상품 1.2만원으로 수정해주세요',
    request: {
      workspaceId: 'ws_test_001',
      sessionId: 'session_20260910_01',
      taskId: 'req_001',
      taskType: 'PENDING_RESOLUTION',
      currentUtterance: '3번 상품 1.2만원으로 수정해주세요',
      activeProduct: {
        productCode: '03',
        productName: '제주 감귤',
        unitPrice: 10000,
      },
    },
    ...overrides,
  };
}

// 1. 작업 객체 초기화 및 필수 필드 검증
test('Task Init: 작업 객체는 필수 6대 식별자 및 메타데이터를 올바르게 초기화함', () => {
  const payload = createSamplePayload();
  const task = createAiTaskObject(payload);

  assert.ok(task.taskId.startsWith('ai_task_'), 'taskId는 고유 식별자로 생성되어야 함');
  assert.equal(task.saleId, 'sale_999');
  assert.equal(task.saleRevision, 3);
  assert.equal(task.settingVersion, 2);
  assert.equal(task.evidenceSnapshotVersion, 4);
  assert.ok(task.currentAttemptId.startsWith('att_'), '유효 시도 ID가 생성되어야 함');
  assert.equal(task.status, 'QUEUED');
  assert.equal(task.activeSlot, 1);
  assert.equal(task.attempts?.length, 0);
});

// 2. 타임아웃 및 서킷 브레이커 기본값 한곳에서 집중 관리 검증
test('Config Constants: 타임아웃 3초/20초/15초, 서킷 브레이커 2회/30초/2회 설정 확인', () => {
  assert.equal(AI_TASK_CONFIG.TIMEOUTS.CONNECT_SECONDS, 3);
  assert.equal(AI_TASK_CONFIG.TIMEOUTS.SELF_HOSTED_SECONDS, 20);
  assert.equal(AI_TASK_CONFIG.TIMEOUTS.CLOUD_SECONDS, 15);

  assert.equal(AI_TASK_CONFIG.CIRCUIT_BREAKER.FAIL_THRESHOLD, 2);
  assert.equal(AI_TASK_CONFIG.CIRCUIT_BREAKER.COOLDOWN_MS, 30000);
  assert.equal(AI_TASK_CONFIG.CIRCUIT_BREAKER.RECOVERY_SUCCESS_THRESHOLD, 2);
});

// 3. 슬롯 1 정상 성공 케이스: 1번에서 바로 해결되고 서킷 브레이커 통과 카운트 증가
test('Slot 1 Success: 슬롯 1이 정상 응답(해결 완료)하면 2번 호출 없이 즉시 RESOLVED 처리', async () => {
  const task = createAiTaskObject(createSamplePayload());

  const mockDispatcher = async () => ({
    status: 200,
    body: JSON.stringify({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          resolvable: true,
          action: 'UPDATE_SALE',
          targetSaleId: 'sale_999',
          changes: { amount: { from: 10000, to: 12000 } },
          evidenceIds: ['ev_voice_01'],
          evidenceSummary: '1.2만원으로 금액 정정',
          missingInfo: [],
          conflictReason: null,
        }),
      },
    }),
  });

  const { task: processedTask, slot1CircuitBreaker } = await processAiTask(task, {
    slot1Config: { ...mockSlot1Config, routingMode: 'PC_HELPER' },
    slot2Config: mockSlot2Config,
    helperDispatcher: mockDispatcher,
  });

  assert.equal(processedTask.status, 'RESOLVED');
  assert.equal(processedTask.activeSlot, 1);
  assert.equal(processedTask.attempts?.length, 1);
  assert.equal(processedTask.attempts[0].slotNumber, 1);
  assert.equal(processedTask.attempts[0].status, 'COMPLETED');
  assert.equal(processedTask.attempts[0].isValidAttempt, true);
  assert.equal(processedTask.resolutionResult?.resolvable, true);
  assert.equal(processedTask.resolutionResult?.changes?.amount?.to, 12000);

  // 서킷 브레이커 상태 확인
  assert.equal(slot1CircuitBreaker.consecutiveFailures, 0);
  assert.equal(slot1CircuitBreaker.consecutiveRecoverySuccesses, 1);
  assert.equal(slot1CircuitBreaker.isOpen, false);
});

// 4. 슬롯 1 근거 부족(자료 부족) 케이스: 장애가 아니므로 보류 유지, 슬롯 2로 전환하지 않음!
test('Slot 1 Insufficient Data: 정상 응답이지만 근거 부족인 경우 장애가 아니며 슬롯 2로 전환하지 않음', async () => {
  const task = createAiTaskObject(createSamplePayload());

  const mockDispatcher = async () => ({
    status: 200,
    body: JSON.stringify({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          resolvable: false,
          action: 'INSUFFICIENT_DATA',
          targetSaleId: null,
          changes: null,
          evidenceIds: [],
          evidenceSummary: '수정하려는 상품 번호가 발화에서 특정되지 않음',
          missingInfo: ['상품 번호 미기재'],
          conflictReason: null,
        }),
      },
    }),
  });

  const { task: processedTask, slot1CircuitBreaker } = await processAiTask(task, {
    slot1Config: { ...mockSlot1Config, routingMode: 'PC_HELPER' },
    slot2Config: mockSlot2Config,
    helperDispatcher: mockDispatcher,
  });

  // 장애가 아닌 근거 부족으로 처리
  assert.equal(processedTask.status, 'INSUFFICIENT_DATA');
  assert.equal(processedTask.activeSlot, 1);
  // 슬롯 2로 전환되지 않았으므로 시도는 1회만 발생
  assert.equal(processedTask.attempts?.length, 1);
  assert.equal(processedTask.attempts[0].slotNumber, 1);
  assert.equal(processedTask.attempts[0].status, 'COMPLETED');
  // 서킷 브레이커 실패 카운트 증가하지 않음
  assert.equal(slot1CircuitBreaker.consecutiveFailures, 0);
});

// 5. 슬롯 1 장애 시 슬롯 2로 자동 전환 (Failover) 및 슬롯 1 권한 즉시 만료
test('Failover 1->2: 슬롯 1 장애 시 슬롯 1 권한 만료 처리 후 슬롯 2로 자동 전환 성공', async () => {
  const task = createAiTaskObject(createSamplePayload());

  // 슬롯 1은 연결 장애(도우미 종료/네트워크 에러), 슬롯 2는 클라우드 Gemini 모의
  let slot1AttemptCount = 0;
  let slot2AttemptCount = 0;

  const mockDispatcher = async (url) => {
    if (url.includes('11434')) {
      slot1AttemptCount++;
      throw new Error('ECONNREFUSED: 도우미 프로세스가 종료되었거나 응답하지 않습니다.');
    }
    slot2AttemptCount++;
    return { status: 200, body: '{}' };
  };

  // 슬롯 2의 fetch를 전역 모의
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      slot2AttemptCount++;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        resolvable: true,
                        action: 'UPDATE_SALE',
                        targetSaleId: 'sale_999',
                        changes: { amount: { from: 10000, to: 12000 } },
                        evidenceIds: ['ev_cloud_01'],
                        evidenceSummary: '슬롯 2(클라우드)에서 1.2만원으로 정정 해결',
                        missingInfo: [],
                        conflictReason: null,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
      };
    }
    return originalFetch(url);
  };

  try {
    const { task: processedTask, slot1CircuitBreaker } = await processAiTask(task, {
      slot1Config: { ...mockSlot1Config, routingMode: 'PC_HELPER' },
      slot2Config: { ...mockSlot2Config, secretApiKey: 'test_key' },
      slot2Secret: 'test_key',
      helperDispatcher: mockDispatcher,
    });

    assert.equal(slot1AttemptCount, 1);
    assert.equal(slot2AttemptCount, 1);

    // 슬롯 2로 전환되어 해결 완료
    assert.equal(processedTask.status, 'RESOLVED');
    assert.equal(processedTask.activeSlot, 2);
    assert.ok(processedTask.switchReason?.includes('슬롯 1 오류'));

    // 시도 목록 검증: 시도 2개 존재
    assert.equal(processedTask.attempts?.length, 2);

    const att1 = processedTask.attempts[0];
    assert.equal(att1.slotNumber, 1);
    assert.equal(att1.status, 'FAILED');
    assert.equal(att1.isValidAttempt, false); // 슬롯 1 결과 권한 만료!

    const att2 = processedTask.attempts[1];
    assert.equal(att2.slotNumber, 2);
    assert.equal(att2.status, 'COMPLETED');
    assert.equal(att2.isValidAttempt, true);
    assert.equal(processedTask.currentAttemptId, att2.attemptId);

    // 서킷 브레이커 1회 실패 기록
    assert.equal(slot1CircuitBreaker.consecutiveFailures, 1);
    assert.equal(slot1CircuitBreaker.isOpen, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 6. 늦게 도착한 슬롯 1 결과 적용 권한 차단 검증
test('Late Result Guard: 슬롯 2로 전환된 후 뒤늦게 도착한 슬롯 1 결과는 유효 시도 불일치로 폐기됨', () => {
  const task = createAiTaskObject(createSamplePayload());
  const staleAttemptId = 'att_task_slot1_old';
  task.currentAttemptId = 'att_task_slot2_new'; // 이미 슬롯 2로 전환됨

  const lateResult = {
    resolvable: true,
    action: 'UPDATE_SALE',
    targetSaleId: 'sale_999',
    changes: { amount: { from: 10000, to: 9000 } },
    evidenceIds: ['ev_late'],
    evidenceSummary: '뒤늦게 도착한 슬롯 1 분석',
    missingInfo: [],
    conflictReason: null,
    execution: {
      adapterType: 'SELF_HOSTED',
      routingMode: 'SERVER_DIRECT',
      provider: 'OLLAMA',
      model: 'exaone3.5',
      latencyMs: 25000,
    },
  };

  const validation = validateAndApplyLateAttemptResult(task, staleAttemptId, lateResult);
  assert.equal(validation.accepted, false);
  assert.ok(validation.reason.includes('만료된 시도 결과 폐기'));
  assert.ok(validation.reason.includes(staleAttemptId));
});

// 7. 서킷 브레이커 2회 연속 장애 시 30초 쿨다운 동안 슬롯 1 우회(Bypass)
test('Circuit Breaker: 슬롯 1이 2회 연속 실패하면 30초 동안 슬롯 2로 즉시 우회(Bypass)', async () => {
  const cbState = {
    slotNumber: 1,
    isOpen: true,
    consecutiveFailures: 2,
    cooldownUntil: new Date(Date.now() + 30000).toISOString(), // 30초 쿨다운 중
    consecutiveRecoverySuccesses: 0,
    lastFailureReason: '메모리 부족(OOM)',
  };

  const task = createAiTaskObject(createSamplePayload());

  let slot1Called = false;
  let slot2Called = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      slot2Called = true;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        resolvable: true,
                        action: 'UPDATE_SALE',
                        targetSaleId: 'sale_999',
                        changes: { amount: { from: 10000, to: 12000 } },
                        evidenceIds: ['ev_cloud_cb'],
                        evidenceSummary: '우회되어 슬롯 2에서 바로 해결',
                        missingInfo: [],
                        conflictReason: null,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
      };
    }
    return originalFetch(url);
  };

  const mockDispatcher = async () => {
    slot1Called = true;
    return { status: 200, body: '{}' };
  };

  try {
    const { task: processedTask } = await processAiTask(task, {
      slot1Config: { ...mockSlot1Config, routingMode: 'PC_HELPER' },
      slot2Config: { ...mockSlot2Config, secretApiKey: 'test_key' },
      slot2Secret: 'test_key',
      slot1CircuitBreaker: cbState,
      helperDispatcher: mockDispatcher,
    });

    // 슬롯 1은 아예 호출되지 않아야 함 (Bypass)
    assert.equal(slot1Called, false, '쿨다운 중에는 슬롯 1을 시도하지 않고 바로 슬롯 2로 가야 함');
    assert.equal(slot2Called, true, '슬롯 2가 직접 호출되어야 함');
    assert.equal(processedTask.status, 'RESOLVED');
    assert.equal(processedTask.activeSlot, 2);
    assert.ok(processedTask.switchReason?.includes('서킷 브레이커 작동 중'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 8. 서킷 브레이커 복구 시험 연속 2회 통과 시 정상 복귀
test('Circuit Breaker Recovery: 복구 성공 연속 2회 달성 시 회로 차단 해제(isOpen: false)', async () => {
  const cbState = {
    slotNumber: 1,
    isOpen: true,
    consecutiveFailures: 2,
    cooldownUntil: null, // 쿨다운 만료되어 시험 가능
    consecutiveRecoverySuccesses: 1, // 1회 이미 성공한 상태
  };

  const task = createAiTaskObject(createSamplePayload());

  const mockDispatcher = async () => ({
    status: 200,
    body: JSON.stringify({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          resolvable: true,
          action: 'UPDATE_SALE',
          targetSaleId: 'sale_999',
          changes: null,
          evidenceIds: [],
          evidenceSummary: '슬롯 1 정상 복구 확인',
          missingInfo: [],
          conflictReason: null,
        }),
      },
    }),
  });

  const { slot1CircuitBreaker } = await processAiTask(task, {
    slot1Config: { ...mockSlot1Config, routingMode: 'PC_HELPER' },
    slot2Config: mockSlot2Config,
    slot1CircuitBreaker: cbState,
    helperDispatcher: mockDispatcher,
  });

  assert.equal(slot1CircuitBreaker.consecutiveRecoverySuccesses, 2);
  assert.equal(slot1CircuitBreaker.isOpen, false);
  assert.equal(slot1CircuitBreaker.cooldownUntil, null);
});

// 9. 두 슬롯 모두 실패 시 작업 및 기존 판매값 보존하고 FAILED(재시도 대기)
test('Both Slots Fail: 1번과 2번 슬롯 모두 장애 시 작업 보존 및 FAILED 상태로 재시도 대기', async () => {
  const task = createAiTaskObject(createSamplePayload());

  const mockDispatcher = async () => {
    throw new Error('슬롯 1 도우미 통신 끊김');
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Gemini API Overloaded',
      };
    }
    return originalFetch(url);
  };

  try {
    const { task: processedTask } = await processAiTask(task, {
      slot1Config: { ...mockSlot1Config, routingMode: 'PC_HELPER' },
      slot2Config: { ...mockSlot2Config, secretApiKey: 'test_key' },
      slot2Secret: 'test_key',
      helperDispatcher: mockDispatcher,
    });

    assert.equal(processedTask.status, 'FAILED');
    assert.ok(processedTask.failureReason?.includes('두 슬롯 모두 실패'));
    assert.equal(processedTask.attempts?.length, 2);
    assert.equal(processedTask.attempts[0].status, 'FAILED');
    assert.equal(processedTask.attempts[1].status, 'FAILED');

    // 기존 판매 정보(saleId, revision 등)는 그대로 보존됨
    assert.equal(processedTask.saleId, 'sale_999');
    assert.equal(processedTask.saleRevision, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
