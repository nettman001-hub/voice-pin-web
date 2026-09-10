import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRouteKey,
  computeOverallStatus,
  getSyntheticTestScenarios,
  checkTier1Connection,
  checkTier2ModelReadiness,
  checkTier3SyntheticInference,
  runFullSlotHealthCheck,
  HEALTH_CHECK_EXPIRY_MS,
} from '../supabase/functions/sales-api/handlers/aiHealthCore.ts';

// 1. 라우트 키 및 경로별 / 기기별 분리 검증
test('Route Key & Isolation: PC 도우미와 서버 직접 호출 경로는 기기 및 실행기별로 엄격히 분리됨', () => {
  const pcHelperKey1 = generateRouteKey(
    1,
    'PC_HELPER',
    'SAME_PC',
    'DEVICE:seller-laptop-01',
    'http://127.0.0.1:11434',
    'qwen2.5:7b',
    1
  );

  const pcHelperKey2 = generateRouteKey(
    1,
    'PC_HELPER',
    'SAME_PC',
    'DEVICE:seller-laptop-02',
    'http://127.0.0.1:11434',
    'qwen2.5:7b',
    1
  );

  const serverDirectKey = generateRouteKey(
    1,
    'SERVER_DIRECT',
    'EXTERNAL_IP',
    'SERVER',
    'https://my-llm.example.com:8443',
    'qwen2.5:7b',
    1
  );

  // Different devices using PC helper must have distinct route keys
  assert.notEqual(pcHelperKey1, pcHelperKey2);

  // Server direct path must be distinct from any PC helper path
  assert.notEqual(pcHelperKey1, serverDirectKey);
  assert.notEqual(pcHelperKey2, serverDirectKey);
  assert.ok(serverDirectKey.includes('SERVER:EXTERNAL_IP'));
});

// 2. 8대 건강 상태 판정 (computeOverallStatus) 검증
test('Health Status: computeOverallStatus correctly maps to the 8 required states', () => {
  const dummySlot = {
    type: 'LOCAL',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    location: 'SAME_PC',
    endpointUrl: 'http://127.0.0.1:11434',
    routingMode: 'PC_HELPER',
    authType: 'NONE',
    timeoutSeconds: 20,
    connectTimeoutSeconds: 3,
  };

  const goodTier1 = { ok: true, status: 'SUCCESS', latencyMs: 50, message: '정상', testedAt: new Date().toISOString() };
  const goodTier2 = { ok: true, status: 'READY', message: '로딩 완료', testedAt: new Date().toISOString() };
  const goodTier3 = { ok: true, allPassed: true, passedCount: 5, totalCount: 5, totalLatencyMs: 300, scenarios: [], message: '정상', testedAt: new Date().toISOString() };

  // 1. 미설정 (UNCONFIGURED)
  const unconfigured = computeOverallStatus(
    { ...dummySlot, endpointUrl: '' },
    { ok: false, status: 'UNCONFIGURED', message: '', testedAt: '' },
    { ok: false, status: 'NOT_QUERYABLE', message: '', testedAt: '' },
    { ok: false, allPassed: false, passedCount: 0, totalCount: 5, totalLatencyMs: 0, scenarios: [], message: '', testedAt: '' },
    0,
    0
  );
  assert.equal(unconfigured.overallStatus, 'UNCONFIGURED');

  // 2. 사용 가능 (AVAILABLE)
  const available = computeOverallStatus(dummySlot, goodTier1, goodTier2, goodTier3, 0, 1, new Date().toISOString());
  assert.equal(available.overallStatus, 'AVAILABLE');
  assert.equal(available.isExpired, false);

  // 3. 지연 (DEGRADED) - 추론 시간이 10초를 초과한 경우
  const slowTier3 = { ...goodTier3, totalLatencyMs: 12000 };
  const degraded = computeOverallStatus(dummySlot, goodTier1, goodTier2, slowTier3, 0, 1, new Date().toISOString());
  assert.equal(degraded.overallStatus, 'DEGRADED');

  // 4. 준비 중 (PREPARING) - 모델이 설치되어 있으나 메모리 미로딩 상태이고 합성 시험 미실행
  const preparingTier2 = { ok: true, status: 'PREPARING', message: '메모리 대기', testedAt: new Date().toISOString() };
  const unrunTier3 = { ...goodTier3, ok: false, allPassed: false };
  const preparing = computeOverallStatus(dummySlot, goodTier1, preparingTier2, unrunTier3, 0, 0, new Date().toISOString());
  assert.equal(preparing.overallStatus, 'PREPARING');

  // 5. 사용 불가 (UNAVAILABLE) - Tier 1 연결 실패
  const badTier1 = { ok: false, status: 'FAILED', message: '연결 거부', testedAt: new Date().toISOString() };
  const unavailable1 = computeOverallStatus(dummySlot, badTier1, goodTier2, goodTier3, 1, 0, new Date().toISOString());
  assert.equal(unavailable1.overallStatus, 'UNAVAILABLE');

  // 6. 사용 불가 (UNAVAILABLE) - Tier 2 모델 미설치
  const notInstalledTier2 = { ok: false, status: 'NOT_INSTALLED', message: '모델 미설치', testedAt: new Date().toISOString() };
  const unavailable2 = computeOverallStatus(dummySlot, goodTier1, notInstalledTier2, goodTier3, 1, 0, new Date().toISOString());
  assert.equal(unavailable2.overallStatus, 'UNAVAILABLE');

  // 7. 복구 시험 중 (RECOVERING) - 이전에 연속 실패가 있었고 이번에 성공을 1회 달성한 경우
  const recovering = computeOverallStatus(dummySlot, goodTier1, goodTier2, goodTier3, 2, 1, new Date().toISOString());
  assert.equal(recovering.overallStatus, 'RECOVERING');

  // 8. 상태 만료 (EXPIRED) - 점검 시각이 45초 이상 경과한 경우
  const staleTime = new Date(Date.now() - 50000).toISOString();
  const expired = computeOverallStatus(dummySlot, goodTier1, goodTier2, goodTier3, 0, 1, staleTime);
  assert.equal(expired.overallStatus, 'EXPIRED');
  assert.equal(expired.isExpired, true);
});

// 3. Tier 2 점검: 원격 서버 관리 API 미제공 시 `NOT_QUERYABLE`로 표시하고 장애로 간주하지 않음 (PLAN.md line 184)
test('Tier 2 Readiness: Remote server without management API returns NOT_QUERYABLE without treating as failure', async () => {
  const remoteSlot = {
    type: 'LOCAL',
    provider: 'VLLM',
    model: 'my-model',
    location: 'EXTERNAL_IP',
    endpointUrl: 'https://vllm.example.com/v1',
    routingMode: 'SERVER_DIRECT',
    authType: 'BEARER',
    timeoutSeconds: 20,
    connectTimeoutSeconds: 3,
  };

  // Mock global fetch returning 404 for /api/tags
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes('/api/tags')) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response('ok', { status: 200 });
  };

  try {
    const res = await checkTier2ModelReadiness(remoteSlot, 'token');
    assert.equal(res.ok, true, 'NOT_QUERYABLE must be ok: true');
    assert.equal(res.status, 'NOT_QUERYABLE');
    assert.match(res.message, /관리 API 미제공/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 4. Tier 2 점검: Ollama 설치 및 실행 모델 확인
test('Tier 2 Readiness: Ollama detects READY when loaded in VRAM and PREPARING when not loaded', async () => {
  const ollamaSlot = {
    type: 'LOCAL',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    location: 'SAME_PC',
    endpointUrl: 'http://127.0.0.1:11434',
    routingMode: 'PC_HELPER',
    authType: 'NONE',
    timeoutSeconds: 20,
    connectTimeoutSeconds: 3,
  };

  // Mock helper returning model in tags and in ps
  const helperRunning = async (url) => {
    if (url.includes('/api/tags')) {
      return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }) };
    }
    if (url.includes('/api/ps')) {
      return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen2.5:7b', sizeVram: 4000000 }] }) };
    }
    return { status: 404, body: '' };
  };

  const readyRes = await checkTier2ModelReadiness(ollamaSlot, undefined, helperRunning);
  assert.equal(readyRes.ok, true);
  assert.equal(readyRes.status, 'READY');
  assert.match(readyRes.message, /로딩 완료/);

  // Mock helper returning model in tags but NOT in ps
  const helperNotRunning = async (url) => {
    if (url.includes('/api/tags')) {
      return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }) };
    }
    if (url.includes('/api/ps')) {
      return { status: 200, body: JSON.stringify({ models: [] }) };
    }
    return { status: 404, body: '' };
  };

  const preparingRes = await checkTier2ModelReadiness(ollamaSlot, undefined, helperNotRunning);
  assert.equal(preparingRes.ok, true);
  assert.equal(preparingRes.status, 'PREPARING');
  assert.match(preparingRes.message, /메모리 미로딩/);
});

// 5. Tier 3 합성 정정 5대 시나리오 실행 및 검증
test('Tier 3 Synthetic Inference: All 5 scenarios validate proper correction logic', async () => {
  const slot = {
    type: 'LOCAL',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    location: 'SAME_PC',
    endpointUrl: 'http://127.0.0.1:11434',
    routingMode: 'PC_HELPER',
    authType: 'NONE',
    timeoutSeconds: 20,
    connectTimeoutSeconds: 3,
  };

  // Mock helper that properly simulates the 5 synthetic scenario responses
  const mockHelper = async (url, body) => {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const userPrompt = parsed.messages?.find((m) => m.role === 'user')?.content || '';
    const reqObj = JSON.parse(userPrompt);

    let contentObj;
    if (reqObj.currentUtterance.includes('0.9가 아니고 1.2입니다')) {
      contentObj = {
        resolvable: true,
        targetSaleId: 'synth_sale_p1',
        action: 'UPDATE_SALE',
        changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
        evidenceIds: ['synth_sale_p1'],
        evidenceSummary: '0.9 -> 1.2 정정',
        missingInfo: [],
        conflictReason: null,
      };
    } else if (reqObj.currentUtterance.includes('xxx님이 아니시고 ooo님')) {
      contentObj = {
        resolvable: true,
        targetSaleId: 'synth_sale_b1',
        action: 'UPDATE_SALE',
        changes: { buyerNickname: { from: 'xxx', to: 'ooo', buyerId: 'c_ooo' } },
        evidenceIds: ['synth_sale_b1', 'c_ooo'],
        evidenceSummary: 'xxx -> ooo 교체',
        missingInfo: [],
        conflictReason: null,
      };
    } else if (reqObj.currentUtterance.includes('xxx님 가격 1.2입니다')) {
      contentObj = {
        resolvable: false,
        targetSaleId: null,
        action: 'KEEP_PENDING',
        changes: null,
        evidenceIds: [],
        evidenceSummary: '복수 후보 존재',
        missingInfo: ['상품번호 누락'],
        conflictReason: '복수 판매 후보 존재 (지칭 근거 필요)',
      };
    } else if (reqObj.currentUtterance.includes('변경하지 마세요')) {
      contentObj = {
        resolvable: false,
        targetSaleId: null,
        action: 'KEEP_PENDING',
        changes: null,
        evidenceIds: [],
        evidenceSummary: '부정 명령 감지',
        missingInfo: [],
        conflictReason: null,
      };
    } else if (reqObj.currentUtterance.includes('0.9가 아니고...')) {
      contentObj = {
        resolvable: false,
        targetSaleId: null,
        action: 'KEEP_PENDING',
        changes: null,
        evidenceIds: [],
        evidenceSummary: '미완성 발화',
        missingInfo: ['정정 금액 미완성'],
        conflictReason: null,
      };
    }

    return {
      status: 200,
      body: JSON.stringify({
        message: { content: JSON.stringify(contentObj) },
      }),
    };
  };

  const tier3Res = await checkTier3SyntheticInference(slot, undefined, mockHelper);
  assert.equal(tier3Res.ok, true);
  assert.equal(tier3Res.allPassed, true);
  assert.equal(tier3Res.passedCount, 5);
  assert.equal(tier3Res.totalCount, 5);
  assert.equal(tier3Res.scenarios.length, 5);

  // Check individual scenario pass flags
  for (const sc of tier3Res.scenarios) {
    assert.equal(sc.passed, true, `Scenario ${sc.scenarioId} must pass`);
  }
});

// 6. 전체 점검 (Full Health Check) 엔드투엔드 오케스트레이션
test('Full Slot Health Check: Combines Tier 1, 2, 3 and updates overall status to AVAILABLE', async () => {
  const slot = {
    type: 'LOCAL',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    location: 'SAME_PC',
    endpointUrl: 'http://127.0.0.1:11434',
    routingMode: 'PC_HELPER',
    authType: 'NONE',
    timeoutSeconds: 20,
    connectTimeoutSeconds: 3,
  };

  const mockHelper = async (url, body) => {
    if (url.includes('/api/tags')) {
      return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }) };
    }
    if (url.includes('/api/ps')) {
      return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }) };
    }

    // Tier 3 synthetic
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const userPrompt = parsed.messages?.find((m) => m.role === 'user')?.content || '';
    const reqObj = JSON.parse(userPrompt || '{}');

    let contentObj = {
      resolvable: true,
      targetSaleId: 'synth_sale_p1',
      action: 'UPDATE_SALE',
      changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
      evidenceIds: ['e1'],
      evidenceSummary: '정상',
      missingInfo: [],
      conflictReason: null,
    };

    if (reqObj.currentUtterance?.includes('xxx님이 아니시고 ooo님')) {
      contentObj = {
        resolvable: true,
        targetSaleId: 'synth_sale_b1',
        action: 'UPDATE_SALE',
        changes: { buyerNickname: { from: 'xxx', to: 'ooo', buyerId: 'c_ooo' } },
        evidenceIds: ['e1'],
        evidenceSummary: '구매자 교체',
        missingInfo: [],
        conflictReason: null,
      };
    } else if (reqObj.currentUtterance?.includes('xxx님 가격 1.2입니다')) {
      contentObj = {
        resolvable: false,
        targetSaleId: null,
        action: 'KEEP_PENDING',
        changes: null,
        evidenceIds: [],
        evidenceSummary: '복수 후보',
        missingInfo: ['상품번호 누락'],
        conflictReason: '복수 판매 후보 존재 (지칭 근거 필요)',
      };
    } else if (reqObj.currentUtterance?.includes('변경하지 마세요')) {
      contentObj = {
        resolvable: false,
        targetSaleId: null,
        action: 'KEEP_PENDING',
        changes: null,
        evidenceIds: [],
        evidenceSummary: '부정 명령',
        missingInfo: [],
        conflictReason: null,
      };
    } else if (reqObj.currentUtterance?.includes('0.9가 아니고...')) {
      contentObj = {
        resolvable: false,
        targetSaleId: null,
        action: 'KEEP_PENDING',
        changes: null,
        evidenceIds: [],
        evidenceSummary: '미완성',
        missingInfo: ['정정 금액 미완성'],
        conflictReason: null,
      };
    }

    return {
      status: 200,
      body: JSON.stringify({
        message: { content: JSON.stringify(contentObj) },
      }),
    };
  };

  const health = await runFullSlotHealthCheck({
    slotNumber: 1,
    slotConfig: slot,
    settingVersion: 2,
    executorId: 'DEVICE:pc-01',
    helperDispatcher: mockHelper,
    tierToRun: 'ALL',
  });

  assert.equal(health.slotNumber, 1);
  assert.equal(health.routingMode, 'PC_HELPER');
  assert.equal(health.executorId, 'DEVICE:pc-01');
  assert.equal(health.tier1.ok, true);
  assert.equal(health.tier2.status, 'READY');
  assert.ok(health.overallStatus === 'AVAILABLE' || health.overallStatus === 'RECOVERING');
});
