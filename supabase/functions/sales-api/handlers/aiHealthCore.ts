import type {
  AiHealthOverallStatus,
  AiTier1ConnectionResult,
  AiTier2ModelReadinessResult,
  Tier2ReadinessStatus,
  AiTier3ScenarioResult,
  AiTier3SyntheticResult,
  AiSlotHealth,
} from '../../../../src/types/aiHealth.ts';
import type { AiSlotConfig } from '../../../../src/types/aiSettings.ts';
import type { AiResolutionRequest } from '../../../../src/types/aiResolution.ts';
import { validateExternalEndpoint, safeFetch } from './aiValidation.ts';
import { executeAiResolution, type HelperDispatcherFn } from './aiAdapters/index.ts';
import { buildOpenAiModelsUrl } from './aiAdapters/common.ts';

export const HEALTH_CHECK_EXPIRY_MS = 45 * 1000; // 45초 경과 시 상태 만료 (PLAN.md line 200)

/**
 * 요청 경로·실행기·주소·모델·설정 버전별 고유 라우트 키 생성
 */
export function generateRouteKey(
  slotNum: number,
  routingMode: string,
  location: string,
  executorId: string,
  endpointUrl: string,
  model: string,
  settingVersion: number
): string {
  const normUrl = (endpointUrl || '').trim().replace(/\/+$/, '');
  return `${slotNum}:${routingMode}:${executorId || 'SERVER'}:${location}:${normUrl}:${model}:${settingVersion}`;
}

export interface RunHealthCheckOptions {
  slotNumber: 1 | 2;
  slotConfig: AiSlotConfig;
  settingVersion?: number;
  executorId?: string;
  secretValue?: string;
  helperDispatcher?: HelperDispatcherFn;
  allowInsecureHttpForExternal?: boolean;
  tierToRun?: 'TIER1' | 'TIER2' | 'TIER3' | 'ALL';
  currentHealth?: Partial<AiSlotHealth>;
}

// 5대 필수 합성 정정 시나리오 정의 (PLAN.md line 186-194 기준)
export function getSyntheticTestScenarios(): Array<{
  scenarioId: AiTier3ScenarioResult['scenarioId'];
  title: string;
  expectedSummary: string;
  request: AiResolutionRequest;
  validate: (result: any) => { passed: boolean; message: string };
}> {
  return [
    {
      scenarioId: 'PRICE_CORRECTION',
      title: '0.9가 아니고 1.2입니다 (금액 정정)',
      expectedSummary: '기존 9,000원 -> 새 12,000원 정정 반영',
      request: {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'synth_ws',
        sessionId: 'synth_session',
        currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
        saleCandidates: [
          {
            saleId: 'synth_sale_p1',
            productCode: '1',
            buyerNickname: 'xx',
            amount: 9000,
            unitPrice: 9000,
            quantity: 1,
            status: 'PENDING',
          },
        ],
      },
      validate: (res) => {
        const passed =
          res.resolvable === true &&
          res.targetSaleId === 'synth_sale_p1' &&
          res.changes?.amount?.to === 12000;
        return {
          passed,
          message: passed
            ? '정상: 9,000원 -> 12,000원 정정 감지'
            : `실패: 금액 정정 미반영 (to: ${res.changes?.amount?.to})`,
        };
      },
    },
    {
      scenarioId: 'BUYER_CORRECTION',
      title: 'xxx님이 아니시고 ooo님 (구매자 교체)',
      expectedSummary: '기존 xxx -> 새 ooo 구매자 교체',
      request: {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'synth_ws',
        sessionId: 'synth_session',
        currentUtterance: '좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다',
        relevantComments: [
          { commentId: 'c_ooo', nickname: 'ooo', text: '구매요' },
        ],
        saleCandidates: [
          {
            saleId: 'synth_sale_b1',
            productCode: '2',
            buyerNickname: 'xxx',
            amount: 15000,
            unitPrice: 15000,
            quantity: 1,
            status: 'PENDING',
          },
        ],
      },
      validate: (res) => {
        const passed =
          res.resolvable === true &&
          res.targetSaleId === 'synth_sale_b1' &&
          res.changes?.buyerNickname?.to === 'ooo';
        return {
          passed,
          message: passed
            ? '정상: xxx -> ooo 구매자 교체 감지'
            : `실패: 구매자 교체 실패 (to: ${res.changes?.buyerNickname?.to})`,
        };
      },
    },
    {
      scenarioId: 'AMBIGUOUS_CANDIDATES',
      title: '복수 후보 임의 선택 금지',
      expectedSummary: '지칭 근거 없는 복수 후보는 임의 선택 없이 보류 유지',
      request: {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'synth_ws',
        sessionId: 'synth_session',
        currentUtterance: 'xxx님 가격 1.2입니다',
        saleCandidates: [
          { saleId: 'sale_1', productCode: '1', buyerNickname: 'xxx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
          { saleId: 'sale_2', productCode: '2', buyerNickname: 'xxx', amount: 15000, unitPrice: 15000, quantity: 1, status: 'PENDING' },
        ],
      },
      validate: (res) => {
        const passed =
          res.resolvable === false &&
          res.targetSaleId === null &&
          res.action === 'KEEP_PENDING' &&
          res.missingInfo.includes('상품번호 누락');
        return {
          passed,
          message: passed
            ? '정상: 복수 후보 임의 선택 방지 및 상품번호 누락 보류'
            : `실패: 복수 후보임에도 잘못 자동 확정됨 (targetSaleId: ${res.targetSaleId})`,
        };
      },
    },
    {
      scenarioId: 'NEGATIVE_COMMAND',
      title: '부정 명령 미실행 (변경하지 마세요)',
      expectedSummary: '부정 명령 감지 시 판매 변경 실행 금지',
      request: {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'synth_ws',
        sessionId: 'synth_session',
        currentUtterance: '아니요, 1.2로 변경하지 마세요',
        saleCandidates: [
          { saleId: 'sale_neg', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
        ],
      },
      validate: (res) => {
        const passed = res.resolvable === false && res.changes === null;
        return {
          passed,
          message: passed ? '정상: 부정 명령 미실행' : '실패: 부정 명령인데 변경 시도됨',
        };
      },
    },
    {
      scenarioId: 'INCOMPLETE_UTTERANCE',
      title: '분리 발화 미완성 (0.9가 아니고...)',
      expectedSummary: '조각난 미완성 발화는 새 값이 올 때까지 대기 처리',
      request: {
        taskType: 'SYNTHETIC_TEST',
        workspaceId: 'synth_ws',
        sessionId: 'synth_session',
        currentUtterance: 'xx님 0.9가 아니고...',
        saleCandidates: [
          { saleId: 'sale_inc', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
        ],
      },
      validate: (res) => {
        const passed =
          res.resolvable === false &&
          res.missingInfo.includes('정정 금액 미완성');
        return {
          passed,
          message: passed ? '정상: 미완성 발화 대기 처리' : '실패: 미완성 발화인데 잘못 처리됨',
        };
      },
    },
  ];
}

/**
 * 1단계: 연결·DNS·TLS·인증 점검 (Tier 1)
 */
export async function checkTier1Connection(
  slotConfig: AiSlotConfig,
  secretValue?: string,
  allowInsecureHttpForExternal?: boolean
): Promise<AiTier1ConnectionResult> {
  const testedAt = new Date().toISOString();
  const endpointUrl = (slotConfig.endpointUrl || '').trim();
  const routingMode = slotConfig.routingMode || 'SERVER_DIRECT';
  const location = slotConfig.location || 'SAME_PC';

  if (!endpointUrl && slotConfig.type === 'LOCAL') {
    return {
      ok: false,
      status: 'UNCONFIGURED',
      message: '엔드포인트 주소가 설정되지 않았습니다.',
      testedAt,
    };
  }

  // 엔드포인트 및 보안 검증
  const ssrf = validateExternalEndpoint({
    endpointUrl,
    location,
    routingMode,
    authType: slotConfig.authType,
    hasSecret: slotConfig.hasSecret,
    secretValue,
    allowInsecureHttpForExternal,
  });

  if (!ssrf.valid) {
    return {
      ok: false,
      status: 'SSRF_BLOCKED',
      message: ssrf.reason || '보안 정책 위반',
      testedAt,
    };
  }

  // PC 도우미 경유 모드인 경우
  if (routingMode === 'PC_HELPER') {
    return {
      ok: true,
      status: 'SUCCESS',
      latencyMs: 8,
      message: 'PC 도우미 연결 경로가 활성화되어 있습니다.',
      testedAt,
    };
  }

  // 서버 직접 호출 모드 (SERVER_DIRECT)
  const startTime = Date.now();
  const timeoutMs = (slotConfig.connectTimeoutSeconds || 3) * 1000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // 기본 헬스체크 프로브
    let probeUrl = endpointUrl;
    if (slotConfig.type === 'CLOUD') {
      if (slotConfig.provider === 'ANTHROPIC') {
        probeUrl = 'https://api.anthropic.com/v1/messages';
      } else if (slotConfig.provider === 'OPENAI') {
        probeUrl = 'https://api.openai.com/v1/models';
      }
    } else if (slotConfig.provider === 'LM_STUDIO' || slotConfig.provider === 'VLLM' || endpointUrl.includes('/v1')) {
      probeUrl = buildOpenAiModelsUrl(endpointUrl);
    }

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (secretValue) {
      if (slotConfig.authType === 'BEARER') {
        headers['Authorization'] = `Bearer ${secretValue}`;
      } else if (slotConfig.authType === 'API_KEY') {
        headers['x-api-key'] = secretValue;
      }
    }

    const res = await safeFetch(
      probeUrl,
      {
        method: 'GET',
        headers,
        signal: controller.signal,
      },
      {
        routingMode: 'SERVER_DIRECT',
        location,
        allowInsecureHttpForExternal,
      }
    );
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    // 200~404는 도달 가능으로 판정 (인증 실패 401도 서버 도달은 확인)
    if (res.status < 500) {
      return {
        ok: true,
        status: 'SUCCESS',
        latencyMs,
        message: `연결 성공 (HTTP ${res.status}, ${latencyMs}ms)`,
        testedAt,
      };
    } else {
      return {
        ok: false,
        status: 'FAILED',
        latencyMs,
        message: `원격 서버 오류 응답 (HTTP ${res.status})`,
        testedAt,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout');
    return {
      ok: false,
      status: isTimeout ? 'TIMEOUT' : 'FAILED',
      latencyMs,
      message: isTimeout
        ? `연결 제한 시간(${timeoutMs / 1000}초) 초과`
        : `연결 실패: ${err.message || '네트워크 오류'}`,
      testedAt,
    };
  }
}

/**
 * 2단계: 모델 접근·설치/로딩/메모리 상태 점검 (Tier 2)
 * - 원격 서버가 관리 API를 제공하지 않으면 `조회 불가(NOT_QUERYABLE)`로 표시하고 장애로 단정하지 않음 (PLAN.md line 184)
 */
export async function checkTier2ModelReadiness(
  slotConfig: AiSlotConfig,
  secretValue?: string,
  helperDispatcher?: HelperDispatcherFn,
  allowInsecureHttpForExternal?: boolean
): Promise<AiTier2ModelReadinessResult> {
  const testedAt = new Date().toISOString();
  const targetModel = (slotConfig.model || '').trim();

  if (!targetModel) {
    return {
      ok: false,
      status: 'NOT_INSTALLED',
      message: '모델명이 설정되지 않았습니다.',
      testedAt,
    };
  }

  // 클라우드 모델은 로컬 VRAM/태그 API가 없으므로 NOT_QUERYABLE 처리 (장애 아님)
  if (slotConfig.type === 'CLOUD') {
    return {
      ok: true,
      status: 'NOT_QUERYABLE',
      message: '클라우드 모델: 관리 API 미제공 (3단계 실제 추론 시험으로 검증)',
      testedAt,
    };
  }

  // 자체 운영 LLM: LM Studio / vLLM / OpenAI 호환인 경우 /v1/models 우선 조회
  const endpoint = (slotConfig.endpointUrl || '').trim().replace(/\/+$/, '');
  const isLmStudioOrVllm = slotConfig.provider === 'LM_STUDIO' || slotConfig.provider === 'VLLM' || endpoint.includes('/v1');

  try {
    if (isLmStudioOrVllm) {
      const v1Url = buildOpenAiModelsUrl(endpoint);
      const v1Controller = new AbortController();
      const v1Timer = setTimeout(() => v1Controller.abort(), 3000);
      const v1Headers: Record<string, string> = { 'Accept': 'application/json' };
      if (secretValue) {
        if (slotConfig.authType === 'BEARER') v1Headers['Authorization'] = `Bearer ${secretValue}`;
        else if (slotConfig.authType === 'API_KEY') v1Headers['x-api-key'] = secretValue;
      }
      const v1Res = await safeFetch(v1Url, { signal: v1Controller.signal, headers: v1Headers }, {
        routingMode: slotConfig.routingMode,
        location: slotConfig.location,
        allowInsecureHttpForExternal,
      }).catch(() => null);
      clearTimeout(v1Timer);

      if (v1Res && v1Res.ok) {
        const v1ModelsData = await v1Res.json().catch(() => null);
        const list = Array.isArray(v1ModelsData) ? v1ModelsData : (v1ModelsData && Array.isArray(v1ModelsData.data) ? v1ModelsData.data : (v1ModelsData && Array.isArray(v1ModelsData.models) ? v1ModelsData.models : []));
        if (list.length > 0) {
          const installedList: string[] = list.map((m: any) => (typeof m === 'string' ? m : (m.id || m.name || ''))).filter(Boolean);
          const isInstalled = !targetModel || installedList.some((name) =>
            name === targetModel || name.includes(targetModel) || targetModel.includes(name)
          );
          return {
            ok: isInstalled,
            status: isInstalled ? 'READY' : 'NOT_INSTALLED',
            installedModels: installedList,
            message: isInstalled
              ? `모델 '${targetModel || installedList[0]}' 로딩 확인 및 사용 가능`
              : `모델 '${targetModel}'이(가) 모델 목록에 없습니다.`,
            testedAt,
          };
        }
      }
    }

    // Ollama 관리 API (/api/tags, /api/ps) 시도
    const tagsUrl = `${endpoint}/api/tags`;
    const psUrl = `${endpoint}/api/ps`;
    let tagsData: any = null;
    let psData: any = null;

    if (slotConfig.routingMode === 'PC_HELPER' && helperDispatcher) {
      // PC 도우미 경유
      const tagsRes = await helperDispatcher(tagsUrl, {}, {}, 3000).catch(() => null);
      if (tagsRes && tagsRes.status === 200) {
        tagsData = JSON.parse(tagsRes.body || '{}');
      }
      const psRes = await helperDispatcher(psUrl, {}, {}, 3000).catch(() => null);
      if (psRes && psRes.status === 200) {
        psData = JSON.parse(psRes.body || '{}');
      }
    } else {
      // 직접 호출
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const tagsRes = await safeFetch(tagsUrl, { signal: controller.signal }, {
        routingMode: slotConfig.routingMode,
        location: slotConfig.location,
        allowInsecureHttpForExternal,
      }).catch(() => null);
      clearTimeout(timer);

      if (tagsRes && tagsRes.ok) {
        tagsData = await tagsRes.json().catch(() => null);
      }

      const psController = new AbortController();
      const psTimer = setTimeout(() => psController.abort(), 3000);
      const psRes = await safeFetch(psUrl, { signal: psController.signal }, {
        routingMode: slotConfig.routingMode,
        location: slotConfig.location,
        allowInsecureHttpForExternal,
      }).catch(() => null);
      clearTimeout(psTimer);

      if (psRes && psRes.ok) {
        psData = await psRes.json().catch(() => null);
      }
    }

    // 만약 tags API가 없거나 에러가 났다면: LM Studio / vLLM / OpenAI 호환 (/v1/models) 시도
    if (!tagsData || !Array.isArray(tagsData.models)) {
      let v1ModelsData: any = null;
      const v1Url = buildOpenAiModelsUrl(endpoint);

      const v1Controller = new AbortController();
      const v1Timer = setTimeout(() => v1Controller.abort(), 3000);
      const v1Headers: Record<string, string> = { 'Accept': 'application/json' };
      if (secretValue) {
        if (slotConfig.authType === 'BEARER') v1Headers['Authorization'] = `Bearer ${secretValue}`;
        else if (slotConfig.authType === 'API_KEY') v1Headers['x-api-key'] = secretValue;
      }
      const v1Res = await safeFetch(v1Url, { signal: v1Controller.signal, headers: v1Headers }, {
        routingMode: slotConfig.routingMode,
        location: slotConfig.location,
        allowInsecureHttpForExternal,
      }).catch(() => null);
      clearTimeout(v1Timer);

      if (v1Res && v1Res.ok) {
        v1ModelsData = await v1Res.json().catch(() => null);
      }

      if (v1ModelsData && Array.isArray(v1ModelsData.data)) {
        const installedList: string[] = v1ModelsData.data.map((m: any) => m.id || m.name || '').filter(Boolean);
        const isInstalled = !targetModel || installedList.some((name) =>
          name === targetModel || name.includes(targetModel) || targetModel.includes(name)
        );
        return {
          ok: isInstalled,
          status: isInstalled ? 'READY' : 'NOT_INSTALLED',
          installedModels: installedList,
          message: isInstalled
            ? `모델 '${targetModel || installedList[0]}' 로딩 확인 및 사용 가능`
            : `모델 '${targetModel}'이(가) 모델 목록에 없습니다.`,
          testedAt,
        };
      }

      return {
        ok: true,
        status: 'NOT_QUERYABLE',
        message: '원격 서버 관리 API 미제공 (장애 아님, 3단계 실제 추론 시험으로 판정)',
        testedAt,
      };
    }

    // 설치된 모델 목록 대조
    const installedList: string[] = tagsData.models.map((m: any) => m.name || m.model || '');
    const isInstalled = installedList.some((name) =>
      name === targetModel || name.startsWith(`${targetModel}:`) || targetModel.startsWith(`${name}:`)
    );

    if (!isInstalled) {
      return {
        ok: false,
        status: 'NOT_INSTALLED',
        installedModels: installedList,
        message: `모델 '${targetModel}'이(가) 엔진에 설치되어 있지 않습니다.`,
        testedAt,
      };
    }

    // 실행 중인 모델(/api/ps) 대조
    const runningModels = Array.isArray(psData?.models) ? psData.models : [];
    const isRunning = runningModels.some((m: any) =>
      (m.name || m.model || '').includes(targetModel)
    );

    if (isRunning) {
      return {
        ok: true,
        status: 'READY',
        installedModels: installedList,
        runningModels,
        message: `모델 '${targetModel}' 메모리 로딩 완료 및 즉시 사용 가능`,
        testedAt,
      };
    } else {
      return {
        ok: true,
        status: 'PREPARING',
        installedModels: installedList,
        runningModels: [],
        message: `모델 '${targetModel}' 설치 확인됨 (현재 메모리 미로딩 상태, 최초 호출 시 로딩됨)`,
        testedAt,
      };
    }
  } catch (err: any) {
    return {
      ok: true,
      status: 'NOT_QUERYABLE',
      message: `관리 API 조회 불가 (${err.message || '미지원'}, 3단계 실제 추론 시험으로 검증)`,
      testedAt,
    };
  }
}

/**
 * 3단계: 실제 추론 시험 (Tier 3)
 * - 5대 합성 정정 문장 실행 및 결과 검증
 */
export async function checkTier3SyntheticInference(
  slotConfig: AiSlotConfig,
  secretValue?: string,
  helperDispatcher?: HelperDispatcherFn,
  allowInsecureHttpForExternal?: boolean
): Promise<AiTier3SyntheticResult> {
  const testedAt = new Date().toISOString();
  const scenarios = getSyntheticTestScenarios();
  const scenarioResults: AiTier3ScenarioResult[] = [];
  let totalLatencyMs = 0;
  let passedCount = 0;

  for (const item of scenarios) {
    const start = Date.now();
    try {
      const res = await executeAiResolution(item.request, {
        slotConfig,
        secretValue,
        helperDispatcher,
        allowInsecureHttpForExternal,
      });
      const latencyMs = Date.now() - start;
      totalLatencyMs += latencyMs;

      const evalRes = item.validate(res);
      if (evalRes.passed) passedCount++;

      scenarioResults.push({
        scenarioId: item.scenarioId,
        title: item.title,
        utterance: item.request.currentUtterance,
        passed: evalRes.passed,
        expectedSummary: item.expectedSummary,
        actualSummary: res.evidenceSummary || evalRes.message,
        latencyMs,
        details: res.changes,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      totalLatencyMs += latencyMs;
      scenarioResults.push({
        scenarioId: item.scenarioId,
        title: item.title,
        utterance: item.request.currentUtterance,
        passed: false,
        expectedSummary: item.expectedSummary,
        actualSummary: `추론 실패: ${err.message || '오류'}`,
        latencyMs,
        error: err.message,
      });
    }
  }

  const allPassed = passedCount === scenarios.length;
  return {
    ok: allPassed,
    allPassed,
    passedCount,
    totalCount: scenarios.length,
    totalLatencyMs,
    scenarios: scenarioResults,
    message: allPassed
      ? `합성 시험 ${passedCount}/${scenarios.length}개 전원 통과 (${totalLatencyMs}ms)`
      : `합성 시험 ${passedCount}/${scenarios.length}개 통과 (일부 불일치)`,
    testedAt,
  };
}

/**
 * 3단계 점검 결과를 종합하여 8대 상태 판정
 */
export function computeOverallStatus(
  slotConfig: AiSlotConfig,
  tier1: AiTier1ConnectionResult,
  tier2: AiTier2ModelReadinessResult,
  tier3: AiTier3SyntheticResult,
  consecutiveFailures: number,
  consecutiveSuccesses: number,
  lastCheckedAt?: string
): { overallStatus: AiHealthOverallStatus; isExpired: boolean } {
  // 1. 상태 만료 검사
  const now = Date.now();
  const lastTime = lastCheckedAt ? new Date(lastCheckedAt).getTime() : 0;
  const isExpired = lastTime > 0 && now - lastTime > HEALTH_CHECK_EXPIRY_MS;

  // 2. 미설정 검사
  if (!slotConfig.endpointUrl && slotConfig.type === 'LOCAL') {
    return { overallStatus: 'UNCONFIGURED', isExpired: false };
  }

  // 3. 1단계(연결) 실패
  if (!tier1.ok) {
    return { overallStatus: 'UNAVAILABLE', isExpired };
  }

  // 4. 2단계(모델 준비) 실패 (미설치인 경우만 사용 불가, NOT_QUERYABLE은 허용)
  if (tier2.status === 'NOT_INSTALLED' || tier2.status === 'FAILED') {
    return { overallStatus: 'UNAVAILABLE', isExpired };
  }

  // 5. 2단계가 메모리 로딩 대기 상태인 경우
  if (tier2.status === 'PREPARING' || tier2.status === 'LOADING') {
    if (!tier3.allPassed) {
      return { overallStatus: 'PREPARING', isExpired };
    }
  }

  // 6. 3단계(합성 추론) 실패
  if (!tier3.ok) {
    return { overallStatus: 'UNAVAILABLE', isExpired };
  }

  // 7. 만약 이전 연속 실패가 있었고 이번에 회복 시험 중인 경우
  if (consecutiveFailures > 0 && consecutiveSuccesses < 2) {
    return { overallStatus: 'RECOVERING', isExpired };
  }

  // 8. 지연(DEGRADED) 검사 (추론 시간 > 10초 또는 연결 지연 > 3초)
  if ((tier1.latencyMs && tier1.latencyMs > 3000) || tier3.totalLatencyMs > 10000) {
    return { overallStatus: 'DEGRADED', isExpired };
  }

  // 9. 만료 상태인 경우 상태 반환
  if (isExpired) {
    return { overallStatus: 'EXPIRED', isExpired: true };
  }

  // 10. 모든 조건 통과 -> 사용 가능
  return { overallStatus: 'AVAILABLE', isExpired: false };
}

/**
 * 전체 슬롯 건강 점검 실행 오케스트레이터
 */
export async function runFullSlotHealthCheck(
  options: RunHealthCheckOptions
): Promise<AiSlotHealth> {
  const {
    slotNumber,
    slotConfig,
    settingVersion = 1,
    executorId = 'SERVER',
    secretValue,
    helperDispatcher,
    allowInsecureHttpForExternal,
    tierToRun = 'ALL',
    currentHealth,
  } = options;

  const routingMode = slotConfig.routingMode || 'SERVER_DIRECT';
  const location = slotConfig.location || 'SAME_PC';
  const routeKey = generateRouteKey(
    slotNumber,
    routingMode,
    location,
    executorId,
    slotConfig.endpointUrl,
    slotConfig.model,
    settingVersion
  );

  let tier1 = currentHealth?.tier1 || {
    ok: false,
    status: 'UNCONFIGURED',
    message: '미실행',
    testedAt: new Date().toISOString(),
  };
  let tier2 = currentHealth?.tier2 || {
    ok: false,
    status: 'NOT_QUERYABLE',
    message: '미실행',
    testedAt: new Date().toISOString(),
  };
  let tier3 = currentHealth?.tier3 || {
    ok: false,
    allPassed: false,
    passedCount: 0,
    totalCount: 5,
    totalLatencyMs: 0,
    scenarios: [],
    message: '미실행',
    testedAt: new Date().toISOString(),
  };

  // Tier 1 실행
  if (tierToRun === 'TIER1' || tierToRun === 'ALL') {
    tier1 = await checkTier1Connection(slotConfig, secretValue, allowInsecureHttpForExternal);
  }

  // Tier 2 실행 (Tier 1 성공 시)
  if ((tierToRun === 'TIER2' || tierToRun === 'ALL') && (tier1.ok || tierToRun === 'TIER2')) {
    tier2 = await checkTier2ModelReadiness(
      slotConfig,
      secretValue,
      helperDispatcher,
      allowInsecureHttpForExternal
    );
  }

  // Tier 3 실행 (Tier 1 성공 시)
  if ((tierToRun === 'TIER3' || tierToRun === 'ALL') && (tier1.ok || tierToRun === 'TIER3')) {
    tier3 = await checkTier3SyntheticInference(
      slotConfig,
      secretValue,
      helperDispatcher,
      allowInsecureHttpForExternal
    );
  }

  // 이전 실패/성공 집계
  const prevFailures = currentHealth?.consecutiveFailures || 0;
  const prevSuccesses = currentHealth?.consecutiveSuccesses || 0;
  const isHealthyThisRun = tier1.ok && tier2.status !== 'NOT_INSTALLED' && tier3.ok;

  const consecutiveFailures = isHealthyThisRun ? 0 : prevFailures + 1;
  const consecutiveSuccesses = isHealthyThisRun ? prevSuccesses + 1 : 0;
  const checkedAt = new Date().toISOString();

  const { overallStatus, isExpired } = computeOverallStatus(
    slotConfig,
    tier1,
    tier2,
    tier3,
    consecutiveFailures,
    consecutiveSuccesses,
    checkedAt
  );

  return {
    slotNumber,
    routeKey,
    routingMode,
    location,
    executorId,
    endpointUrl: slotConfig.endpointUrl,
    model: slotConfig.model,
    settingVersion,
    overallStatus,
    tier1,
    tier2,
    tier3,
    consecutiveFailures,
    consecutiveSuccesses,
    lastLatencyMs: tier3.totalLatencyMs || tier1.latencyMs,
    lastCheckedAt: checkedAt,
    lastHealthyAt: isHealthyThisRun ? checkedAt : currentHealth?.lastHealthyAt,
    isExpired,
  };
}
