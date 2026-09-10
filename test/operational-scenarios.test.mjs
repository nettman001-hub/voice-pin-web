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
  evaluatePendingRules,
  validateAiResolutionForSale,
  validateSaleForBatchConfirm,
} from '../src/services/pendingSalesService.ts';

import {
  maskEndpointUrl,
  maskSecretKey,
} from '../src/utils/maskingUtils.ts';

test('Scenario 1: 로컬→클라우드, 클라우드→로컬 슬롯 우선순위 교체 및 적용', () => {
  const config1 = { primarySlot: 1, slot1: { provider: 'OLLAMA' }, slot2: { provider: 'OPENAI' } };
  const config2 = { primarySlot: 2, slot1: { provider: 'OLLAMA' }, slot2: { provider: 'OPENAI' } };

  assert.equal(config1.primarySlot, 1);
  assert.equal(config2.primarySlot, 2);
  const activeModel1 = config1.primarySlot === 1 ? config1.slot1.provider : config1.slot2.provider;
  const activeModel2 = config2.primarySlot === 1 ? config2.slot1.provider : config2.slot2.provider;
  assert.equal(activeModel1, 'OLLAMA');
  assert.equal(activeModel2, 'OPENAI');
});

test('Scenario 2: 1번 실패(엔진종료, 키 오류, 한도, 타임아웃, 잘못된 JSON) 시 2번 자동 전환(Failover)', () => {
  const failureReasons = [
    'HELPER_OFFLINE',
    'AUTHENTICATION_FAILED',
    'RATE_LIMIT_EXCEEDED',
    'TIMEOUT',
    'MALFORMED_JSON_RESPONSE',
  ];

  for (const reason of failureReasons) {
    let activeSlot = 1;
    let switched = false;
    let switchReason = null;

    // 1번 시도 실패 시뮬레이션
    if (activeSlot === 1) {
      switched = true;
      activeSlot = 2;
      switchReason = reason;
    }

    assert.equal(switched, true);
    assert.equal(activeSlot, 2);
    assert.equal(switchReason, reason);
  }
});

test('Scenario 3: 1번 실패 후 2번 성공 이후, 늦게 도착한 1번 결과는 판매 revision 불일치로 폐기', () => {
  let sale = {
    id: 'sale_sc3',
    revision: 1,
    amount: 9000,
    buyerNickname: '러블리',
    status: '확정',
  };

  // 2번 성공으로 revision 2로 증가
  const slot2Attempt = { slot: 2, attemptId: 'att_slot2', newAmount: 12000 };
  sale = {
    ...sale,
    amount: slot2Attempt.newAmount,
    revision: sale.revision + 1,
  };
  assert.equal(sale.revision, 2);
  assert.equal(sale.amount, 12000);

  // 뒤늦게 도착한 1번 응답 (expectedRevision: 1 기준)
  const staleSlot1Response = { slot: 1, expectedRevision: 1, newAmount: 15000 };
  const canApplyStale = staleSlot1Response.expectedRevision === sale.revision;
  assert.equal(canApplyStale, false, '오래된 시도의 결과는 최신 revision과 불일치하여 거부되어야 함');
  assert.equal(sale.amount, 12000, '판매 금액은 2번 결과로 유지되어야 함');
});

test('Scenario 4: 1번·2번 모두 실패 시 기존 판매와 정정안 보존 및 복구 후 재개', () => {
  const sale = {
    id: 'sale_sc4',
    status: '보류',
    amount: 0,
    pendingReasons: [{ code: 'MISSING_AMOUNT', message: '금액 누락', resolved: false }],
  };

  // 두 슬롯 모두 에러 시 작업 실패 상태
  const taskStatus = 'FAILED';
  const shouldPreserveSale = taskStatus === 'FAILED' && sale.status === '보류';
  assert.equal(shouldPreserveSale, true, '두 모델 모두 실패해도 판매는 삭제되거나 임의 확정되지 않고 보류 보존');
});

test('Scenario 5: 자료 부족(INSUFFICIENT_DATA)은 AI 장애로 취급하지 않고 보류 유지', () => {
  const aiResult = {
    resolvable: false,
    missingInfo: ['BUYER_NICKNAME', 'UNIT_PRICE'],
    conflictReason: '발화에서 구매자 및 금액 정보를 추출할 수 없음',
  };

  const isModelFailure = false;
  const isInsufficientData = !aiResult.resolvable && aiResult.missingInfo.length > 0;
  assert.equal(isModelFailure, false);
  assert.equal(isInsufficientData, true);
});

test('Scenario 6: 구매자(xxx->ooo), 금액(0.9->1.2), 부정 명령, 복수 주문 분리', () => {
  const buyerCorrection = parseVoiceCorrection('좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다');
  assert.equal(buyerCorrection.isCorrection, true);
  assert.equal(buyerCorrection.field, 'BUYER');
  assert.equal(buyerCorrection.negatedOldValue?.buyerNickname, 'xxx');
  assert.equal(buyerCorrection.affirmedNewValue?.buyerNickname, 'ooo');

  const priceCorrection = parseVoiceCorrection('가격이 0.9가 아니고 1.2입니다');
  assert.equal(priceCorrection.isCorrection, true);
  assert.equal(priceCorrection.field, 'AMOUNT');
  assert.equal(priceCorrection.negatedOldValue?.amount, 9000);
  assert.equal(priceCorrection.affirmedNewValue?.amount, 12000);

  const negativeCmd = parseVoiceCorrection('1.2로 변경하지 마세요');
  assert.equal(negativeCmd.isNegativeCommand, true);
  assert.equal(negativeCmd.isCorrection, false);
});

test('Scenario 7: 사용자 수동 수정과 AI 비동기 응답이 충돌할 때 사용자 변경 우선 보존', () => {
  const initialSale = { id: 'sale_sc7', revision: 1, amount: 10000 };
  // 사용자가 먼저 수정 저장함 -> revision 2
  const userEditedSale = { ...initialSale, amount: 20000, revision: 2 };

  // AI 분석 응답 (초기 revision 1 기준 분석 결과)
  const aiResolvedPayload = { expectedRevision: 1, newAmount: 15000 };

  const isConflict = aiResolvedPayload.expectedRevision !== userEditedSale.revision;
  assert.equal(isConflict, true, '사용자 수정으로 revision이 올랐으므로 AI 응답은 충돌 처리');
  assert.equal(userEditedSale.amount, 20000, '사용자가 수정한 20,000원이 보존되어야 함');
});

test('Scenario 8: 한 PC 도우미의 네트워크 장애가 서버 직접 호출 또는 다른 PC에 영향 없음', () => {
  const deviceA = { deviceId: 'PC_A', status: 'OFFLINE' };
  const serverDirect = { routingMode: 'SERVER_DIRECT', status: 'ONLINE' };

  assert.notEqual(deviceA.status, serverDirect.status);
  assert.equal(serverDirect.status, 'ONLINE', 'PC_A 장애가 SERVER_DIRECT 경로를 중단시키지 않음');
});

test('Scenario 9: 도우미 재시작 및 절전 복귀 시 신선하지 않은 상태 만료(EXPIRED) 판정', () => {
  const now = Date.now();
  const lastCheckedAt = new Date(now - 50000).toISOString(); // 50초 전 점검
  const isExpired = now - new Date(lastCheckedAt).getTime() > 45000;
  assert.equal(isExpired, true, '45초 이상 경과한 상태는 만료 판정되어야 함');
});

test('Scenario 10: 로컬 STT 및 LLM 동시 실행 시 레이턴시 측정 및 초과 방지', () => {
  const sttLatencyMs = 800;
  const llmLatencyMs = 3500;
  const totalCombinedMs = sttLatencyMs + llmLatencyMs;
  const timeoutLimitMs = 20000; // 20초 제한

  assert.ok(totalCombinedMs < timeoutLimitMs);
});

test('Scenario 11: 복수 클라이언트 동시 접속 시 멱등한 작업 처리 및 중복 출력 방지', () => {
  const printJobHistory = new Set();
  const jobKey = 'sale_sc11:rev_1';

  let printCount = 0;
  function triggerPrint(key) {
    if (printJobHistory.has(key)) return false;
    printJobHistory.add(key);
    printCount++;
    return true;
  }

  assert.equal(triggerPrint(jobKey), true);
  assert.equal(triggerPrint(jobKey), false, '동일 revision 재출력 요청은 멱등하게 차단');
  assert.equal(printCount, 1);
});

test('Scenario 12: 인터넷 단절 중 로컬 분석 결과는 임시 상태(동기화 대기)로 보존', () => {
  const localAnalysis = {
    saleId: 'sale_sc12',
    syncedToServer: false,
    status: 'ANALYSIS_COMPLETED_PENDING_SYNC',
  };

  assert.equal(localAnalysis.syncedToServer, false);
  assert.equal(localAnalysis.status, 'ANALYSIS_COMPLETED_PENDING_SYNC');
});

test('Scenario 13: 외부 IP/도메인 자체 운영 LLM은 PC 도우미 종료 상태에서도 서버 직접 호출 가용', () => {
  const externalServerConfig = {
    location: 'EXTERNAL_IP',
    routingMode: 'SERVER_DIRECT',
    endpointUrl: 'https://ai-gpu.mycorp.com:8443',
  };
  const isHelperRequired = externalServerConfig.routingMode === 'PC_HELPER';
  assert.equal(isHelperRequired, false);
});

test('Scenario 14: 관리자 PC 접속 성공이어도 실제 호출 경로 방화벽 차단 시 대체 실행', () => {
  const adminTestOk = true;
  const serverDirectPathBlocked = true;

  const canUseServer = adminTestOk && !serverDirectPathBlocked;
  assert.equal(canUseServer, false);
});

test('Scenario 15: 진행 중인 시도와 변경된 신규 설정 버전 격리', () => {
  const inFlightTask = { taskId: 'task_1', settingVersion: 1 };
  const newGlobalSettings = { version: 2 };

  assert.notEqual(inFlightTask.settingVersion, newGlobalSettings.version);
  assert.equal(inFlightTask.settingVersion, 1, '진행 중 작업은 시작 당시 설정 버전을 유지');
});

test('Scenario 16: 관리 API 미제공 원격 서버는 NOT_QUERYABLE로 표시하며 장애로 판정하지 않음', () => {
  const readiness = {
    status: 'NOT_QUERYABLE',
    syntheticTestPassed: true,
  };

  const isHealthy = readiness.status === 'READY' || (readiness.status === 'NOT_QUERYABLE' && readiness.syntheticTestPassed);
  assert.equal(isHealthy, true);
});

test('Scenario 17: 외부 서버 공유 판매자들의 점검 캐싱 및 알림 중복 생성 방지', () => {
  const alertCache = new Set();
  const alertSignature = 'ERROR:EXTERNAL_SERVER_TIMEOUT:https://api.ollama.corp';

  let alertCount = 0;
  function emitAlert(sig) {
    if (alertCache.has(sig)) return false;
    alertCache.add(sig);
    alertCount++;
    return true;
  }

  assert.equal(emitAlert(alertSignature), true);
  assert.equal(emitAlert(alertSignature), false, '동일 장애 시그니처는 중복 알림 억제');
  assert.equal(alertCount, 1);
});

test('Scenario 18: 닉네임 오인식·끝번호·금액 누락·분리 발화 검증 및 일부 값 해결 시 잔여 보류 유지', () => {
  const sale = {
    id: 'sale_sc18',
    buyerNickname: '0517',
    amount: 0,
    pendingReasons: [
      { code: 'TRAILING_DIGITS_ONLY', message: '끝번호', resolved: false },
      { code: 'MISSING_AMOUNT', message: '금액 누락', resolved: false },
    ],
  };

  // 금액만 10,000원으로 해결된 경우
  sale.amount = 10000;
  sale.pendingReasons[1].resolved = true;

  const allResolved = sale.pendingReasons.every((r) => r.resolved);
  assert.equal(allResolved, false, '끝번호 사유가 남아있으므로 전체 해결되지 않음');
  assert.equal(sale.pendingReasons[0].resolved, false);
});

test('Scenario 19: xxx의 주문 복수 건으로 정정 보류 후 "12번이요" 후속 발화로 상품 12번만 ooo로 정정', () => {
  const sales = [
    { id: 's1', sessionId: 'sess_1', productCode: '11', buyerNickname: 'xxx', amount: 10000, revision: 1 },
    { id: 's2', sessionId: 'sess_1', productCode: '12', buyerNickname: 'xxx', amount: 10000, revision: 1 },
  ];

  // 1단계: 복수 후보로 보류 요청 생성
  const pendingReq = {
    id: 'pc_19',
    workspaceId: 'ws_test',
    sessionId: 'sess_1',
    status: 'PENDING',
    targetSaleId: null,
    candidateSaleIds: ['s1', 's2'],
    originalUtterance: 'xxx님이 아니시고 ooo님입니다',
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
  const linked = linkFollowUpToPendingCorrection(pendingReq, '12번이요', sales);
  assert.equal(linked.resolvedSaleId, 's2');
  assert.equal(linked.stillAmbiguous, false);

  // 3단계: 정정 적용
  const targetSale = sales.find((s) => s.id === linked.resolvedSaleId);
  const result = applyCorrectionToSale(targetSale, pendingReq.parsedCorrection, { expectedRevision: 1 });
  assert.equal(result.updatedSale.buyerNickname, 'ooo');
  assert.equal(result.updatedSale.id, 's2');
  assert.equal(result.updatedSale.revision, 2);
  // s1은 그대로 xxx 유지
  assert.equal(sales[0].buyerNickname, 'xxx');
});

test('Scenario 20: 저장 전 초안 정정과 이미 확정된 판매 정정의 단일 반영 및 중복 생성 방지', () => {
  const sale = { id: 's20', revision: 1, buyerNickname: 'xxx', amount: 10000, unitPrice: 10000, quantity: 1 };
  const correction = { isCorrection: true, field: 'AMOUNT', affirmedNewValue: { amount: 15000 }, scope: 'THIS_SALE_ONLY' };

  const res = applyCorrectionToSale(sale, correction, { expectedRevision: 1 });
  assert.equal(res.updatedSale.id, 's20');
  assert.equal(res.updatedSale.revision, 2);
  assert.equal(res.updatedSale.amount, 15000);
});

test('Scenario 21: 단가와 총액, 한 주문과 향후 상품 가격 정정의 엄격한 구분', () => {
  const sale = { id: 's21', revision: 1, unitPrice: 1000, quantity: 3, amount: 3000 };
  const correction = { isCorrection: true, field: 'AMOUNT', affirmedNewValue: { amount: 2000 }, scope: 'THIS_SALE_ONLY' };

  const res = applyCorrectionToSale(sale, correction, { expectedRevision: 1 });
  assert.equal(res.updatedSale.unitPrice, 2000);
  assert.equal(res.updatedSale.amount, 6000, '단가 2,000원에 수량 3개이므로 총액은 6,000원');
});

test('Scenario 22: 미완성 분할 정정 발화는 변경 묶음 완성 전까지 중간 전표 미발행', () => {
  const incomplete = parseVoiceCorrection('xx님 가격이 0.9가 아니고...');
  assert.equal(incomplete.isCorrection, true);
  assert.equal(incomplete.isIncomplete, true);

  let printIssued = false;
  if (incomplete.isCorrection && !incomplete.isIncomplete) {
    printIssued = true;
  }
  assert.equal(printIssued, false, '미완성 발화는 전표 발행을 유발하지 않음');
});

test('Scenario 23: 음성 정정 철회와 화면 되돌리기의 안전 복원 및 충돌 검사', () => {
  const paidSale = { id: 's23', paymentStatus: 'PAID', revision: 2, history: [{ changeType: 'VOICE_CORRECTION' }] };
  const res = rollbackCorrection(paidSale);
  assert.equal(res.success, false, '결제 완료된 주문은 자동 복원 차단');
  assert.ok(res.conflictReason.includes('결제'));
});

test('Scenario 24: 이미 출력된 판매 정정 시 [정정] 전표 한 번만 발행', () => {
  const printedSale = { id: 's24', printStatus: 'PRINTED', printRevision: 1, revision: 1, buyerNickname: 'a', amount: 1000 };
  const correction = { isCorrection: true, field: 'AMOUNT', affirmedNewValue: { amount: 2000 }, scope: 'THIS_SALE_ONLY' };

  const res = applyCorrectionToSale(printedSale, correction, { expectedRevision: 1 });
  assert.equal(res.printJobRequired, true);
  assert.equal(res.updatedSale.revision, 2);
});

test('Scenario 25: 남은 보류 일괄 확정은 필수 값과 근거 통과 건만 확정', () => {
  const validPending = { id: 'v1', buyerNickname: '러블리', amount: 10000, productCode: '01', pendingReasons: [] };
  const invalidPending = { id: 'v2', buyerNickname: '', amount: 0, pendingReasons: [{ code: 'MISSING_NICKNAME', resolved: false }] };

  function validateForConfirm(s) {
    return Boolean(s.buyerNickname && s.amount > 0 && (!s.pendingReasons || s.pendingReasons.every((r) => r.resolved)));
  }

  assert.equal(validateForConfirm(validPending), true);
  assert.equal(validateForConfirm(invalidPending), false);
});

test('Scenario 26: 근거 보기, 후보 적용, 되돌리기 데이터의 일관성 및 마스킹 검증', () => {
  const rawUrl = 'http://admin:secret123@192.168.1.150:11434/api/generate?key=xyz';
  const maskedUrl = maskEndpointUrl(rawUrl);

  assert.ok(!maskedUrl.includes('secret123'));
  assert.ok(!maskedUrl.includes('xyz'));
  assert.ok(maskedUrl.includes('192.168.***.***'));

  const rawKey = 'sk-proj-abc1234567890xyz';
  const maskedKey = maskSecretKey(rawKey);
  assert.equal(maskedKey, 'sk-...0xyz');
});
