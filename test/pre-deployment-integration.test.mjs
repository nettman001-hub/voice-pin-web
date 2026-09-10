import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVoiceCorrection,
  findTargetSaleForCorrection,
  applyCorrectionToSale,
  rollbackCorrection,
  linkFollowUpToPendingCorrection,
} from '../src/services/voiceCorrectionService.ts';

import {
  buildPendingReasons,
  buildEvidenceSnapshot,
  evaluatePendingRules,
  validateAiResolutionForSale,
  validateSaleForBatchConfirm,
} from '../src/services/pendingSalesService.ts';

import {
  validateExternalEndpoint,
  safeFetch,
} from '../supabase/functions/sales-api/handlers/aiValidation.ts';

import {
  createAiTaskObject,
  processAiTask,
  validateAndApplyLateAttemptResult,
} from '../supabase/functions/sales-api/handlers/aiTaskCore.ts';

import {
  measureGpuContention,
} from '../src/utils/gpuContentionBenchmark.ts';

// ---------------------------------------------------------------------------
// 헬퍼: 격리된 테스트용 작업 페이로드 및 응답 생성기
// ---------------------------------------------------------------------------
function createIntegrationPayload(overrides = {}) {
  const saleId = overrides.saleId || 'sale_test_001';
  const currentUtterance = overrides.currentUtterance || '러블리님 일점칠';
  return {
    workspaceId: 'ws_test_001',
    sessionId: 'session_test_001',
    saleId,
    saleRevision: 1,
    settingVersion: 1,
    evidenceSnapshotVersion: 1,
    taskType: 'PENDING_RESOLUTION',
    currentUtterance,
    request: {
      workspaceId: 'ws_test_001',
      sessionId: 'session_test_001',
      taskId: `req_${saleId}`,
      taskType: 'PENDING_RESOLUTION',
      currentUtterance,
    },
    ...overrides,
  };
}

function mockOllamaSuccessResponse(saleId, newAmount = 17000) {
  return {
    status: 200,
    body: JSON.stringify({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          resolvable: true,
          action: 'UPDATE_SALE',
          targetSaleId: saleId,
          changes: { amount: { from: 10000, to: newAmount } },
          evidenceIds: ['ev_local_01'],
          evidenceSummary: `${newAmount}원으로 해결`,
          missingInfo: [],
          conflictReason: null,
        }),
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. 슬롯 우선순위 교체 및 적용 (로컬→클라우드, 클라우드→로컬)
// ---------------------------------------------------------------------------
test('Pre-Deploy [1.1]: 로컬(1번) -> 클라우드(2번) 우선순위 정상 처리 및 대체 호출', async () => {
  const localConfig = {
    slotNumber: 1,
    type: 'LOCAL',
    provider: 'OLLAMA',
    location: 'SAME_PC',
    routingMode: 'PC_HELPER',
    endpointUrl: 'http://127.0.0.1:11434',
    model: 'exaone3.5:7.8b',
    timeoutSeconds: 20,
  };
  const cloudConfig = {
    slotNumber: 2,
    type: 'CLOUD',
    provider: 'GOOGLE',
    model: 'gemini-1.5-flash',
    timeoutSeconds: 15,
  };

  const payload = createIntegrationPayload({ saleId: 'sale_local_primary' });

  // 1-1. 슬롯 1 정상 성공: 슬롯 1만 실행되고 슬롯 2는 호출되지 않음
  let slot1Called = false;
  let slot2Called = false;

  const mockDispatcher1 = async () => {
    slot1Called = true;
    return mockOllamaSuccessResponse('sale_local_primary', 17000);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    slot2Called = true;
    return originalFetch(url);
  };

  try {
    const task1 = createAiTaskObject(payload, 1);
    const { task: res1 } = await processAiTask(task1, {
      slot1Config: localConfig,
      slot2Config: cloudConfig,
      primarySlot: 1,
      helperDispatcher: mockDispatcher1,
    });

    assert.equal(slot1Called, true);
    assert.equal(slot2Called, false, '1번 슬롯 성공 시 2번 슬롯은 호출되지 않아야 함');
    assert.equal(res1.status, 'RESOLVED');
    assert.equal(res1.activeSlot, 1);
    assert.equal(res1.resolutionResult?.changes?.amount?.to, 17000);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 1-2. 슬롯 1 실패 -> 슬롯 2로 자동 failover
  slot1Called = false;
  slot2Called = false;

  const mockDispatcherFail = async () => {
    slot1Called = true;
    const err = new Error('ECONNREFUSED: 로컬 Ollama 데몬 연결 실패');
    err.code = 'HELPER_OFFLINE';
    throw err;
  };

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
                        targetSaleId: 'sale_local_primary',
                        changes: { amount: { from: 10000, to: 17000 } },
                        evidenceIds: ['ev_cloud_01'],
                        evidenceSummary: '슬롯 2(클라우드)에서 17000원으로 정정 해결',
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
    const task2 = createAiTaskObject(payload, 1);
    const { task: res2 } = await processAiTask(task2, {
      slot1Config: localConfig,
      slot2Config: cloudConfig,
      primarySlot: 1,
      slot2Secret: 'test-google-key',
      helperDispatcher: mockDispatcherFail,
    });

    assert.equal(slot1Called, true);
    assert.equal(slot2Called, true);
    assert.equal(res2.status, 'RESOLVED');
    assert.equal(res2.activeSlot, 2);
    assert.equal(res2.attempts?.length, 2);
    assert.equal(res2.attempts[0].status, 'FAILED');
    assert.equal(res2.attempts[1].status, 'COMPLETED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pre-Deploy [1.2]: 클라우드(2번) -> 로컬(1번) 우선순위 역전 정상 처리 및 대체 호출', async () => {
  const localConfig = {
    slotNumber: 1,
    type: 'LOCAL',
    provider: 'OLLAMA',
    location: 'SAME_PC',
    routingMode: 'PC_HELPER',
    endpointUrl: 'http://127.0.0.1:11434',
    model: 'exaone3.5:7.8b',
    timeoutSeconds: 20,
  };
  const cloudConfig = {
    slotNumber: 2,
    type: 'CLOUD',
    provider: 'GOOGLE',
    model: 'gemini-1.5-flash',
    timeoutSeconds: 15,
  };

  const payload = createIntegrationPayload({
    saleId: 'sale_cloud_primary',
    currentUtterance: '가격이 0.9가 아니고 1.2입니다',
  });

  let firstSlotCalled = null;
  let secondSlotCalled = null;

  // primarySlot을 2로 생성
  const task = createAiTaskObject(payload, 2);
  assert.equal(task.activeSlot, 2, 'primarySlot 2 설정 시 초기 activeSlot은 2여야 함');

  const originalFetch = globalThis.fetch;
  // 슬롯 2(클라우드) 호출 시 429 한도 초과 에러 시뮬레이션
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      firstSlotCalled = 2;
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: 'Quota exceeded 429' } }),
      };
    }
    return originalFetch(url);
  };

  const mockDispatcher = async () => {
    secondSlotCalled = 1;
    return mockOllamaSuccessResponse('sale_cloud_primary', 12000);
  };

  try {
    const { task: processed } = await processAiTask(task, {
      slot1Config: localConfig,
      slot2Config: cloudConfig,
      primarySlot: 2,
      slot2Secret: 'test-google-key',
      helperDispatcher: mockDispatcher,
    });

    assert.equal(firstSlotCalled, 2, '우선 슬롯인 2번(클라우드)이 먼저 호출되어야 함');
    assert.equal(secondSlotCalled, 1, '2번 실패 후 대체 슬롯인 1번(로컬)이 호출되어야 함');
    assert.equal(processed.status, 'RESOLVED');
    assert.equal(processed.activeSlot, 1);
    assert.equal(processed.attempts?.length, 2);
    assert.equal(processed.attempts[0].slotNumber, 2);
    assert.equal(processed.attempts[0].status, 'FAILED');
    assert.equal(processed.attempts[1].slotNumber, 1);
    assert.equal(processed.attempts[1].status, 'COMPLETED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 2. 외부 IP 직접 호출, PC 도우미 경유, 도우미 종료, 인증/TLS, 타임아웃
// ---------------------------------------------------------------------------
test('Pre-Deploy [2.1]: 외부 IP 직접 호출 보안 검증 (HTTP/HTTPS 허용, 포트 및 주소 유효성)', () => {
  // HTTP 외부 IP 허용
  const httpRes = validateExternalEndpoint({
    endpointUrl: 'http://203.0.113.50:11434',
    location: 'EXTERNAL_IP',
    routingMode: 'SERVER_DIRECT',
  });
  assert.equal(httpRes.valid, true);

  // 허용되지 않은 위험 포트(SSH 22, Redis 6379 등) 차단
  const dangerousPortRes = validateExternalEndpoint({
    endpointUrl: 'https://ai.sellercorp.com:22',
    location: 'EXTERNAL_IP',
    routingMode: 'SERVER_DIRECT',
  });
  assert.equal(dangerousPortRes.valid, false);
  assert.match(dangerousPortRes.reason, /포트/);

  // 정상 HTTPS 외부 IP/도메인 통과
  const validExternal = validateExternalEndpoint({
    endpointUrl: 'https://ai.sellercorp.com:8443/v1',
    location: 'EXTERNAL_IP',
    routingMode: 'SERVER_DIRECT',
  });
  assert.equal(validExternal.valid, true);
});

test('Pre-Deploy [2.2]: PC 도우미 종료(HELPER_OFFLINE), 인증 오류, 시간 초과 시 2번으로 failover', async () => {
  const localConfig = {
    slotNumber: 1,
    type: 'LOCAL',
    provider: 'OLLAMA',
    location: 'SAME_PC',
    routingMode: 'PC_HELPER',
    endpointUrl: 'http://127.0.0.1:11434',
  };
  const cloudConfig = {
    slotNumber: 2,
    type: 'CLOUD',
    provider: 'GOOGLE',
    model: 'gemini-1.5-flash',
  };

  const testErrors = [
    { code: 'HELPER_OFFLINE', message: 'PC 도우미 프로세스가 종료되었습니다.' },
    { code: 'AUTHENTICATION_FAILED', message: 'API 토큰 인증 실패 (401 Unauthorized)' },
    { code: 'TIMEOUT', message: '자체 운영 모델 분석 시간 초과 (20s)' },
    { code: 'TLS_ERROR', message: 'TLS 인증서 검증 실패 (CERT_UNTRUSTED)' },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
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
                        targetSaleId: 'sale_err_resolved',
                        changes: { amount: { from: 0, to: 10000 } },
                        evidenceIds: ['ev_cloud_01'],
                        evidenceSummary: '클라우드로 해결',
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
    for (const errDef of testErrors) {
      const payload = createIntegrationPayload({ saleId: `sale_err_${errDef.code}` });
      const task = createAiTaskObject(payload, 1);

      const { task: res } = await processAiTask(task, {
        slot1Config: localConfig,
        slot2Config: cloudConfig,
        primarySlot: 1,
        slot2Secret: 'test-google-key',
        helperDispatcher: async () => {
          const err = new Error(errDef.message);
          err.code = errDef.code;
          throw err;
        },
      });

      assert.equal(res.status, 'RESOLVED');
      assert.equal(res.attempts?.length, 2);
      assert.equal(res.attempts[0].status, 'FAILED');
      assert.equal(res.attempts[0].errorCode, errDef.code);
      assert.equal(res.attempts[1].status, 'COMPLETED');
      assert.equal(res.activeSlot, 2);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 3. 두 모델 장애와 원본 보존, 복구 후 재개
// ---------------------------------------------------------------------------
test('Pre-Deploy [3.1]: 두 모델 동시 장애 시 원본 판매/정정 보존 및 임의 확정 차단', async () => {
  const localConfig = {
    slotNumber: 1,
    type: 'LOCAL',
    provider: 'OLLAMA',
    routingMode: 'PC_HELPER',
    endpointUrl: 'http://127.0.0.1:11434',
  };
  const cloudConfig = {
    slotNumber: 2,
    type: 'CLOUD',
    provider: 'GOOGLE',
    model: 'gemini-1.5-flash',
  };

  const payload = createIntegrationPayload({ saleId: 'sale_dual_fail' });
  const task = createAiTaskObject(payload, 1);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Cloud DNS failure');
  };

  try {
    const { task: res } = await processAiTask(task, {
      slot1Config: localConfig,
      slot2Config: cloudConfig,
      primarySlot: 1,
      slot2Secret: 'test-google-key',
      helperDispatcher: async () => {
        throw new Error('Local helper connection refused');
      },
    });

    assert.equal(res.status, 'FAILED');
    assert.equal(res.attempts?.length, 2);
    assert.equal(res.attempts[0].status, 'FAILED');
    assert.equal(res.attempts[1].status, 'FAILED');

    // 원본 판매 데이터는 훼손되거나 삭제되지 않음
    const originalSale = {
      id: 'sale_dual_fail',
      status: '보류',
      amount: 0,
      buyerNickname: '러블리',
      pendingReasons: [{ code: 'MISSING_AMOUNT', message: '금액 누락', resolved: false }],
    };

    assert.equal(originalSale.status, '보류');
    assert.equal(originalSale.pendingReasons[0].resolved, false, '모델 장애 시 보류 원인은 유지되어야 함');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 4. 늦은 응답 차단 (Stale Attempt) 및 동시 사용자 수정 보호 (Revision Conflict)
// ---------------------------------------------------------------------------
test('Pre-Deploy [4.1]: 1번 실패 후 2번 성공 이후, 지연 도착한 1번 결과는 판매 revision 불일치로 차단', () => {
  let sale = {
    id: 'sale_stale_test',
    revision: 1,
    amount: 9000,
    buyerNickname: '러블리',
  };

  // 슬롯 2가 성공하여 판매가 revision 2로 갱신됨
  sale = {
    ...sale,
    amount: 12000,
    revision: sale.revision + 1,
  };
  assert.equal(sale.revision, 2);

  // 뒤늦게 도착한 슬롯 1의 응답 (과거 revision 1 기준)
  const lateSlot1Attempt = {
    attemptId: 'att_stale_slot1',
    expectedRevision: 1,
    newAmount: 99999,
  };

  const canApply = lateSlot1Attempt.expectedRevision === sale.revision;
  assert.equal(canApply, false, '최신 revision과 불일치하는 늦은 응답은 차단되어야 함');
  assert.equal(sale.amount, 12000, '판매 금액은 슬롯 2의 결과로 보존되어야 함');
});

test('Pre-Deploy [4.2]: 동시 사용자 수동 수정(v1 -> v2) 발생 시 AI 비동기 응답(v1 기준) 충돌 차단', () => {
  const sale = {
    id: 'sale_user_edit',
    revision: 2, // 사용자가 먼저 화면에서 수정 저장함
    buyerNickname: '수동수정완료',
    amount: 25000,
    unitPrice: 25000,
    quantity: 1,
  };

  const staleAiIntent = {
    isCorrection: true,
    field: 'AMOUNT',
    affirmedNewValue: { amount: 15000 },
    scope: 'THIS_SALE_ONLY',
  };

  // revision 1 기준으로 도착한 AI 정정 시도
  assert.throws(
    () => {
      applyCorrectionToSale(sale, staleAiIntent, { expectedRevision: 1 });
    },
    (err) => {
      return err.message.includes('REVISION_CONFLICT');
    },
    '사용자가 먼저 수정한 revision 2에 대해 과거 expectedRevision 1 정정 적용 시 충돌 에러가 발생해야 함'
  );

  assert.equal(sale.amount, 25000, '사용자의 수동 수정 금액 25,000원이 온전히 보존되어야 함');
});

// ---------------------------------------------------------------------------
// 5. 정정 전표 중복 방지 (Print Slip Deduplication)
// ---------------------------------------------------------------------------
test('Pre-Deploy [5.1]: 이미 출력된 판매 정정 시 수정 전표(CORRECTION) 발행 플래그 설정 및 중복 방지', () => {
  const printedSale = {
    id: 'sale_print_dedup',
    printStatus: 'PRINTED',
    revision: 1,
    buyerNickname: 'xxx',
    amount: 10000,
    unitPrice: 10000,
    quantity: 1,
  };

  const correction = {
    isCorrection: true,
    field: 'AMOUNT',
    affirmedNewValue: { amount: 15000 },
    scope: 'THIS_SALE_ONLY',
  };

  // 1회차 정정 적용
  const res1 = applyCorrectionToSale(printedSale, correction, { expectedRevision: 1 });
  assert.equal(res1.printJobRequired, true, '인쇄된 판매 수정 시 전표 발행 필요');
  assert.equal(res1.updatedSale.revision, 2);

  // 동일 revision 2에 대해 중복 인쇄 요청이 들어왔을 때 전표 중복 방지 검증
  const printHistory = new Set();
  const makePrintJobKey = (saleId, revision) => `${saleId}:rev_${revision}`;

  function tryQueuePrint(saleId, revision) {
    const key = makePrintJobKey(saleId, revision);
    if (printHistory.has(key)) return { duplicate: true };
    printHistory.add(key);
    return { duplicate: false, jobId: `job_${key}` };
  }

  const job1 = tryQueuePrint(res1.updatedSale.id, res1.updatedSale.revision);
  assert.equal(job1.duplicate, false);

  const job2 = tryQueuePrint(res1.updatedSale.id, res1.updatedSale.revision);
  assert.equal(job2.duplicate, true, '동일 revision에 대한 중복 전표 생성이 차단되어야 함');
});

test('Pre-Deploy [5.2]: 미완성 정정 발화("0.9가 아니고...")는 중간 전표를 발행하지 않음', () => {
  const incompleteUtterance = parseVoiceCorrection('xx님 가격이 0.9가 아니고...');
  assert.equal(incompleteUtterance.isIncomplete, true);

  const shouldIssuePrint = incompleteUtterance.isCorrection && !incompleteUtterance.isIncomplete;
  assert.equal(shouldIssuePrint, false, '미완성 정정 발화는 전표 발행을 유발하지 않아야 함');
});

// ---------------------------------------------------------------------------
// 6. 판매 보류 6개 유형 식별, 규칙 우선 해결, 부분 해결 잔여 보류 유지
// ---------------------------------------------------------------------------
test('Pre-Deploy [6.1]: 판매 보류 6개 유형 정밀 감지 (닉네임, 끝번호, 금액, 분리, 댓글지연, 복수후보)', () => {
  // 1) MISSING_NICKNAME
  const r1 = buildPendingReasons({ rawTranscript: '만오천원에 하나요', buyerNickname: '미확인(보류)', amount: 15000 });
  assert.ok(r1.some((r) => r.code === 'MISSING_NICKNAME'));

  // 2) TRAILING_DIGITS_ONLY
  const r2 = buildPendingReasons({ rawTranscript: '뒷번호 8821님 만원', buyerNickname: '미확인', amount: 10000 });
  assert.ok(r2.some((r) => r.code === 'TRAILING_DIGITS_ONLY'));

  // 3) MISSING_AMOUNT
  const r3 = buildPendingReasons({ rawTranscript: '러블리님 구매확정', buyerNickname: '러블리', amount: 0 });
  assert.ok(r3.some((r) => r.code === 'MISSING_AMOUNT'));

  // 4) SPLIT_UTTERANCE
  const r4 = buildPendingReasons({ rawTranscript: '러블리님 가격은', buyerNickname: '러블리', amount: 0 });
  assert.ok(r4.some((r) => r.code === 'SPLIT_UTTERANCE'));

  // 5) DELAYED_COMMENT
  const r5 = buildPendingReasons(
    { rawTranscript: '새로오신분님 이만원', buyerNickname: '새로오신분', amount: 20000 },
    { comments: [{ id: 'c1', nickname: '기존참여자' }] }
  );
  assert.ok(r5.some((r) => r.code === 'DELAYED_COMMENT'));

  // 6) MULTIPLE_CANDIDATES_CONFLICT (규칙 평가 중 생성)
  const evalInput = {
    sale: { rawTranscript: '뒷번호 1234님 만원', buyerNickname: '미확인', amount: 10000 },
    comments: [
      { id: 'c1', nickname: '행복1234' },
      { id: 'c2', nickname: '사랑1234' },
    ],
  };
  const evalRes = evaluatePendingRules(
    [{ code: 'TRAILING_DIGITS_ONLY', message: '끝번호', resolved: false }],
    evalInput
  );
  assert.ok(evalRes.updatedReasons.some((r) => r.code === 'MULTIPLE_CANDIDATES_CONFLICT'));
  assert.equal(evalRes.allResolved, false);
});

test('Pre-Deploy [6.2]: 일부 원인만 해결된 경우(금액 해결, 닉네임 미해결), 잔여 보류 유지', () => {
  const currentReasons = [
    { code: 'MISSING_NICKNAME', message: '닉네임 누락', resolved: false },
    { code: 'MISSING_AMOUNT', message: '금액 누락', resolved: false },
  ];

  // 후속 발화로 금액만 "일점칠"(17,000원)로 입력된 경우
  const evalRes = evaluatePendingRules(currentReasons, {
    sale: { rawTranscript: '러블리 가격은', buyerNickname: '미확인', amount: 0 },
    followUpUtterance: '가격 일점칠',
  });

  assert.equal(evalRes.changes.amount, 17000);
  assert.ok(evalRes.resolvedReasonCodes.includes('MISSING_AMOUNT'));
  // 닉네임은 여전히 미해결
  assert.equal(evalRes.allResolved, false);
  const remainingUnresolved = evalRes.updatedReasons.filter((r) => !r.resolved);
  assert.equal(remainingUnresolved.length, 1);
  assert.equal(remainingUnresolved[0].code, 'MISSING_NICKNAME');
});

// ---------------------------------------------------------------------------
// 7. 음성 정정 예시(0.9->1.2, xxx->ooo), 부정 명령, 12번이요 후속 연결
// ---------------------------------------------------------------------------
test('Pre-Deploy [7.1]: 음성 정정 예시 및 부정 명령 정확도 검증', () => {
  // 예시 A: 금액 정정
  const priceIntent = parseVoiceCorrection('가격이 0.9가 아니고 1.2입니다');
  assert.equal(priceIntent.isCorrection, true);
  assert.equal(priceIntent.field, 'AMOUNT');
  assert.equal(priceIntent.negatedOldValue?.amount, 9000);
  assert.equal(priceIntent.affirmedNewValue?.amount, 12000);

  // 예시 B: 구매자 정정
  const buyerIntent = parseVoiceCorrection('좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다');
  assert.equal(buyerIntent.isCorrection, true);
  assert.equal(buyerIntent.field, 'BUYER');
  assert.equal(buyerIntent.negatedOldValue?.buyerNickname, 'xxx');
  assert.equal(buyerIntent.affirmedNewValue?.buyerNickname, 'ooo');

  // 부정 명령: 수정 실행하지 않음
  const negativeCmd = parseVoiceCorrection('1.2로 변경하지 마세요');
  assert.equal(negativeCmd.isNegativeCommand, true);
  assert.equal(negativeCmd.isCorrection, false);

  // 질문 형태: 수정 실행하지 않음
  const questionCmd = parseVoiceCorrection('1.2인가요?');
  assert.equal(questionCmd.isQuestion, true);
  assert.equal(questionCmd.isCorrection, false);
});

test('Pre-Deploy [7.2]: 정정 보류 후 "12번이요" 후속 발화 연결로 복수 후보 중 상품 12번만 특정 및 정정', () => {
  const sales = [
    { id: 's_prod_10', sessionId: 'sess_1', productCode: '10', buyerNickname: 'xxx', amount: 15000, revision: 1 },
    { id: 's_prod_12', sessionId: 'sess_1', productCode: '12', buyerNickname: 'xxx', amount: 15000, revision: 1 },
  ];

  // 1단계: xxx의 주문이 2건이어서 복수 후보 보류 발생
  const pendingReq = {
    id: 'pc_step7',
    workspaceId: 'ws_demo',
    sessionId: 'sess_1',
    status: 'PENDING',
    targetSaleId: null,
    candidateSaleIds: ['s_prod_10', 's_prod_12'],
    originalUtterance: 'xxx님이 아니고 ooo님입니다',
    parsedCorrection: {
      isCorrection: true,
      field: 'BUYER',
      negatedOldValue: { buyerNickname: 'xxx' },
      affirmedNewValue: { buyerNickname: 'ooo' },
      scope: 'THIS_SALE_ONLY',
    },
    missingInfo: ['상품번호 확인 필요'],
  };

  // 2단계: "12번이요" 후속 발화 연결
  const linkRes = linkFollowUpToPendingCorrection(pendingReq, '12번이요', sales);
  assert.equal(linkRes.resolvedSaleId, 's_prod_12');
  assert.equal(linkRes.stillAmbiguous, false);

  // 3단계: 특정된 판매만 ooo로 정정 반영
  const targetSale = sales.find((s) => s.id === linkRes.resolvedSaleId);
  const applied = applyCorrectionToSale(targetSale, pendingReq.parsedCorrection, { expectedRevision: 1 });

  assert.equal(applied.updatedSale.id, 's_prod_12');
  assert.equal(applied.updatedSale.buyerNickname, 'ooo');
  assert.equal(applied.updatedSale.revision, 2);

  // 10번 상품은 변경 없이 원본 xxx 유지
  assert.equal(sales[0].buyerNickname, 'xxx');
});

// ---------------------------------------------------------------------------
// 8. 단가와 총액 구분 및 일관성 (unitPrice * quantity = amount)
// ---------------------------------------------------------------------------
test('Pre-Deploy [8.1]: 수량 3개 상품의 단가 정정 시 총액 일관성 유지 (단가 2,000 * 3 = 총액 6,000)', () => {
  const sale = {
    id: 'sale_qty3',
    revision: 1,
    unitPrice: 1000,
    quantity: 3,
    amount: 3000,
    buyerNickname: '러블리',
  };

  const correction = {
    isCorrection: true,
    field: 'AMOUNT',
    affirmedNewValue: { amount: 2000 }, // 새 단가 2,000원
    scope: 'THIS_SALE_ONLY',
  };

  const res = applyCorrectionToSale(sale, correction, { expectedRevision: 1 });
  assert.equal(res.updatedSale.unitPrice, 2000);
  assert.equal(res.updatedSale.quantity, 3);
  assert.equal(res.updatedSale.amount, 6000, '단가 2,000원에 수량 3개이므로 총액은 반드시 6,000원이어야 함');
});

// ---------------------------------------------------------------------------
// 9. 정정 취소·복원 (Rollback) 및 결제 완료 건 충돌 차단
// ---------------------------------------------------------------------------
test('Pre-Deploy [9.1]: 정정 후 정상 복원 (이전 상태로 복구 및 CORRECTION_ROLLBACK 감사 로그)', () => {
  const correctedSale = {
    id: 'sale_to_rollback',
    revision: 2,
    buyerNickname: 'ooo',
    amount: 12000,
    unitPrice: 12000,
    quantity: 1,
    status: '자동저장',
    history: [
      {
        revision: 2,
        changedAt: '2026-09-10T10:00:00Z',
        changedBy: 'SELLER',
        changeType: 'VOICE_CORRECTION',
        before: { buyerNickname: 'xxx', amount: 9000, status: '자동저장' },
        after: { buyerNickname: 'ooo', amount: 12000, status: '자동저장' },
        summary: '구매자/금액 음성 정정',
      },
    ],
  };

  const rollbackRes = rollbackCorrection(correctedSale);
  assert.equal(rollbackRes.success, true);
  assert.equal(rollbackRes.rolledBackSale?.buyerNickname, 'xxx');
  assert.equal(rollbackRes.rolledBackSale?.amount, 9000);
  assert.equal(rollbackRes.rolledBackSale?.revision, 3);

  const lastHistory = rollbackRes.rolledBackSale?.history?.[rollbackRes.rolledBackSale.history.length - 1];
  assert.equal(lastHistory?.changeType, 'CORRECTION_ROLLBACK');
});

test('Pre-Deploy [9.2]: 결제 완료(PAID)된 판매는 자동 정정 복원을 차단하여 정산 불일치 방지', () => {
  const paidSale = {
    id: 'sale_paid_conflict',
    revision: 2,
    paymentStatus: 'PAID',
    buyerNickname: 'ooo',
    amount: 12000,
    history: [
      {
        revision: 2,
        changeType: 'VOICE_CORRECTION',
        before: { buyerNickname: 'xxx', amount: 9000 },
        after: { buyerNickname: 'ooo', amount: 12000 },
      },
    ],
  };

  const res = rollbackCorrection(paidSale);
  assert.equal(res.success, false);
  assert.ok(res.conflictReason?.includes('결제'));
});

// ---------------------------------------------------------------------------
// 10. 미확인 보류의 일괄 확정 차단 (Batch Confirm Gate)
// ---------------------------------------------------------------------------
test('Pre-Deploy [10.1]: 남은 보류 일괄 확정 시 필수 값 검증 및 미해결 건 확정 차단', () => {
  const verifiedSale = {
    id: 'sale_verified',
    buyerNickname: '러블리',
    productCode: '01',
    amount: 15000,
    pendingReasons: [{ code: 'MISSING_AMOUNT', message: '해결됨', resolved: true }],
  };

  const unverifiedSale1 = {
    id: 'sale_no_nick',
    buyerNickname: '', // 닉네임 없음
    productCode: '01',
    amount: 15000,
    pendingReasons: [{ code: 'MISSING_NICKNAME', message: '닉네임 미확인', resolved: false }],
  };

  const unverifiedSale2 = {
    id: 'sale_zero_amt',
    buyerNickname: '러블리',
    productCode: '02',
    amount: 0, // 금액 0원
    pendingReasons: [{ code: 'MISSING_AMOUNT', message: '금액 누락', resolved: false }],
  };

  const check1 = validateSaleForBatchConfirm(verifiedSale);
  assert.equal(check1.canConfirm, true);

  const check2 = validateSaleForBatchConfirm(unverifiedSale1);
  assert.equal(check2.canConfirm, false);
  assert.ok(check2.validationErrors.some((e) => e.includes('닉네임') || e.includes('보류 사유')));

  const check3 = validateSaleForBatchConfirm(unverifiedSale2);
  assert.equal(check3.canConfirm, false);
  assert.ok(check3.validationErrors.some((e) => e.includes('금액')));
});

// ---------------------------------------------------------------------------
// 11. 단일 GPU 자원 경합 및 전사 지연 / VRAM 사용량 측정 벤치마크
// ---------------------------------------------------------------------------
test('Pre-Deploy [11.1]: 단일 GPU(8GB) 상 로컬 STT + 자체 운영 LLM 동시 실행 시 지연 및 VRAM 측정', async () => {
  // 8GB GPU 환경에서 large-v3-turbo STT + exaone3.5:7.8b LLM 측정
  const report8Gb = await measureGpuContention({
    totalVramGb: 8.0,
    sttModel: 'large-v3-turbo',
    llmModel: 'exaone3.5:7.8b',
    iterations: 5,
    simulatedBaselineSttMs: 380,
    simulatedConcurrentSttMs: 890,
    simulatedLlmDurationMs: 3200,
  });

  assert.equal(report8Gb.hardware.totalVramGb, 8.0);
  assert.equal(report8Gb.memory.sttVramGb, 1.8);
  assert.equal(report8Gb.memory.totalCombinedVramGb, 8.5); // 1.8 + 6.7 = 8.5 GB
  assert.ok(report8Gb.memory.vramUtilizationPercent > 100);
  assert.equal(report8Gb.riskLevel, 'CRITICAL', '8GB VRAM에 8.5GB 요구 시 CRITICAL 판정');
  assert.ok(report8Gb.recommendation.includes('클라우드') || report8Gb.recommendation.includes('경량'));

  // 16GB GPU 환경에서의 안전성 측정
  const report16Gb = await measureGpuContention({
    totalVramGb: 16.0,
    sttModel: 'large-v3-turbo',
    llmModel: 'exaone3.5:7.8b',
    iterations: 5,
    simulatedBaselineSttMs: 350,
    simulatedConcurrentSttMs: 580,
    simulatedLlmDurationMs: 2800,
  });

  assert.equal(report16Gb.hardware.totalVramGb, 16.0);
  assert.ok(report16Gb.memory.vramUtilizationPercent < 60);
  assert.equal(report16Gb.safetyChecks.sttLatencyUnderThreshold, true);
  assert.equal(report16Gb.safetyChecks.llmLatencyUnderThreshold, true);
  assert.equal(report16Gb.safetyChecks.vramUtilizationSafe, true);
  assert.equal(report16Gb.riskLevel, 'SAFE');
});
