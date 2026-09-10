import { admin, successResponse, errorResponse, AuthContext } from '../../_shared/productSales.ts';
import {
  runFullSlotHealthCheck,
  computeOverallStatus,
  HEALTH_CHECK_EXPIRY_MS,
  generateRouteKey,
} from './aiHealthCore.ts';
import type { AiSlotConfig } from '../../../../src/types/aiSettings.ts';
import type { AiSlotHealth } from '../../../../src/types/aiHealth.ts';

function checkIsAdmin(auth: AuthContext): boolean {
  return auth.role === 'ADMIN' || auth.capabilities.has('ADMIN');
}

/**
 * AI 건강 점검 실행 핸들러 (수동 연결 시험 / 실제 처리 시험 / 전체 점검)
 */
export async function handleCheckAiHealth(
  workspaceId: string,
  actorId: string,
  auth: AuthContext,
  body: any
) {
  if (!checkIsAdmin(auth)) {
    return errorResponse('FORBIDDEN', '관리자(ADMIN)만 AI 건강 점검을 실행할 수 있습니다.', 403);
  }

  const { slotNumber, tier = 'ALL', tempSlotConfig, newSecret, executorId = 'SERVER', deviceId } = body || {};

  // 1. 설정 조회
  const { data: setting, error: setErr } = await admin
    .from('ai_settings')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle();

  if (setErr) {
    return errorResponse('DATABASE_ERROR', setErr.message, 500);
  }

  const currentSetting = setting || {
    version: 1,
    applied_version: 1,
    slot1: {},
    slot2: {},
  };

  // 2. 점검할 슬롯 목록 결정
  const slotsToTest: Array<1 | 2> = slotNumber ? [slotNumber === 2 ? 2 : 1] : [1, 2];
  const results: Record<string, AiSlotHealth> = {};

  for (const sNum of slotsToTest) {
    const rawSlotConfig: AiSlotConfig = sNum === 1 ? currentSetting.slot1 : currentSetting.slot2;
    const effectiveSlotConfig: AiSlotConfig = {
      ...rawSlotConfig,
      ...(slotNumber === sNum ? tempSlotConfig || {} : {}),
    };

    // 비밀정보 조회 (DB 격리 보관소에서 조회)
    let secret = sNum === slotNumber ? newSecret : undefined;
    if (!secret && setting?.id) {
      const { data: secRow } = await admin
        .from('ai_secrets')
        .select('secret_value')
        .eq('setting_id', setting.id)
        .eq('slot_number', sNum)
        .maybeSingle();
      secret = secRow?.secret_value;
    }

    // 기존 건강 상태 조회
    const actualExecutor = effectiveSlotConfig.routingMode === 'PC_HELPER' && deviceId
      ? `DEVICE:${deviceId}`
      : executorId;

    const routeKey = generateRouteKey(
      sNum,
      effectiveSlotConfig.routingMode || 'SERVER_DIRECT',
      effectiveSlotConfig.location || 'SAME_PC',
      actualExecutor,
      effectiveSlotConfig.endpointUrl || '',
      effectiveSlotConfig.model || '',
      currentSetting.applied_version || 1
    );

    const { data: currentDbHealth } = await admin
      .from('ai_health_status')
      .select('*')
      .eq('slot_number', sNum)
      .eq('route_key', routeKey)
      .maybeSingle();

    const currentHealthObj: Partial<AiSlotHealth> | undefined = currentDbHealth ? {
      consecutiveFailures: currentDbHealth.consecutive_failures,
      consecutiveSuccesses: currentDbHealth.consecutive_successes,
      lastHealthyAt: currentDbHealth.last_healthy_at,
      tier1: currentDbHealth.tier1_connection,
      tier2: currentDbHealth.tier2_model_readiness,
      tier3: currentDbHealth.tier3_synthetic_inference,
    } : undefined;

    // 점검 실행
    const healthResult = await runFullSlotHealthCheck({
      slotNumber: sNum,
      slotConfig: effectiveSlotConfig,
      settingVersion: currentSetting.applied_version || 1,
      executorId: actualExecutor,
      secretValue: secret,
      tierToRun: tier,
      currentHealth: currentHealthObj,
    });

    // DB에 건강 상태 업서트 (upsert)
    await admin
      .from('ai_health_status')
      .upsert({
        workspace_id: workspaceId && workspaceId !== 'default' ? workspaceId : null,
        slot_number: sNum,
        route_key: routeKey,
        routing_mode: healthResult.routingMode,
        location: healthResult.location,
        executor_id: healthResult.executorId,
        endpoint_url: healthResult.endpointUrl,
        model: healthResult.model,
        setting_version: healthResult.settingVersion,
        overall_status: healthResult.overallStatus,
        tier1_connection: healthResult.tier1,
        tier2_model_readiness: healthResult.tier2,
        tier3_synthetic_inference: healthResult.tier3,
        consecutive_failures: healthResult.consecutiveFailures,
        consecutive_successes: healthResult.consecutiveSuccesses,
        last_latency_ms: healthResult.lastLatencyMs,
        last_checked_at: healthResult.lastCheckedAt,
        last_healthy_at: healthResult.lastHealthyAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,slot_number,route_key' });

    results[`slot${sNum}`] = healthResult;
  }

  return successResponse({
    health: slotNumber ? results[`slot${slotNumber}`] : results,
    checkedAt: new Date().toISOString(),
  });
}

/**
 * AI 슬롯 건강 상태 조회 핸들러
 * - 45초 이상 경과 시 'EXPIRED'(상태 만료) 자동 계산
 */
export async function handleGetAiHealth(
  workspaceId: string,
  actorId: string,
  auth: AuthContext,
  body: any
) {
  const { executorId = 'SERVER', deviceId } = body || {};

  // 최신 ai_settings 조회
  const { data: setting } = await admin
    .from('ai_settings')
    .select('slot1, slot2, primary_slot, applied_version')
    .eq('scope', 'GLOBAL')
    .maybeSingle();

  const slot1Config = setting?.slot1 || {};
  const slot2Config = setting?.slot2 || {};
  const appliedVersion = setting?.applied_version || 1;

  // DB에서 최근 건강 상태 조회
  const { data: healthRows } = await admin
    .from('ai_health_status')
    .select('*')
    .order('last_checked_at', { ascending: false });

  function formatSlotHealth(sNum: 1 | 2, cfg: any): AiSlotHealth {
    const routingMode = cfg.routingMode || (sNum === 1 ? 'PC_HELPER' : 'SERVER_DIRECT');
    const location = cfg.location || (sNum === 1 ? 'SAME_PC' : 'EXTERNAL_IP');
    const actualExecutor = routingMode === 'PC_HELPER' && deviceId ? `DEVICE:${deviceId}` : executorId;
    const routeKey = generateRouteKey(
      sNum,
      routingMode,
      location,
      actualExecutor,
      cfg.endpointUrl || '',
      cfg.model || '',
      appliedVersion
    );

    // 해당 routeKey 또는 슬롯 번호에 매칭되는 가장 최근 행 탐색
    const matched = (healthRows || []).find((r: any) =>
      r.slot_number === sNum && (r.route_key === routeKey || r.routing_mode === routingMode)
    );

    if (!matched) {
      return {
        slotNumber: sNum,
        routeKey,
        routingMode,
        location,
        executorId: actualExecutor,
        endpointUrl: cfg.endpointUrl || '',
        model: cfg.model || '',
        settingVersion: appliedVersion,
        overallStatus: cfg.endpointUrl || cfg.type === 'CLOUD' ? 'CHECKING' : 'UNCONFIGURED',
        tier1: { ok: false, status: 'UNCONFIGURED', message: '점검 이력 없음', testedAt: '' },
        tier2: { ok: false, status: 'NOT_QUERYABLE', message: '점검 이력 없음', testedAt: '' },
        tier3: { ok: false, allPassed: false, passedCount: 0, totalCount: 5, totalLatencyMs: 0, scenarios: [], message: '점검 이력 없음', testedAt: '' },
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastCheckedAt: '',
        isExpired: false,
      };
    }

    // 만료 여부 판정 (PLAN.md line 200: 45초 이상 경과 시 상태 만료)
    const lastCheckedTime = new Date(matched.last_checked_at).getTime();
    const isExpired = Date.now() - lastCheckedTime > HEALTH_CHECK_EXPIRY_MS;
    const overallStatus = isExpired ? 'EXPIRED' : matched.overall_status;

    return {
      slotNumber: sNum,
      routeKey: matched.route_key,
      routingMode: matched.routing_mode,
      location: matched.location,
      executorId: matched.executor_id,
      endpointUrl: matched.endpoint_url,
      model: matched.model,
      settingVersion: matched.setting_version,
      overallStatus,
      tier1: matched.tier1_connection,
      tier2: matched.tier2_model_readiness,
      tier3: matched.tier3_synthetic_inference,
      consecutiveFailures: matched.consecutive_failures,
      consecutiveSuccesses: matched.consecutive_successes,
      lastLatencyMs: matched.last_latency_ms,
      lastCheckedAt: matched.last_checked_at,
      lastHealthyAt: matched.last_healthy_at,
      isExpired,
    };
  }

  const slot1 = formatSlotHealth(1, slot1Config);
  const slot2 = formatSlotHealth(2, slot2Config);

  return successResponse({
    slot1,
    slot2,
    activePrimarySlot: setting?.primary_slot || 1,
    checkedAt: new Date().toISOString(),
  });
}
