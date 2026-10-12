import { successResponse, errorResponse, AuthContext } from '../../_shared/productSales.ts';
import { getOperationalAiSetting, getPrimaryAiSlot } from './aiOperationalSettings.ts';
import { readAiHealthSummary } from './aiHealth.ts';
import { readAiRuntimeStatus } from './aiTasks.ts';

function safeSlotSummary(slot: any = {}) {
  // Explicit allowlist: the badge does not need auth metadata or secret values.
  return {
    type: slot?.type,
    provider: slot?.provider,
    location: slot?.location,
    routingMode: slot?.routingMode,
    model: slot?.model,
    endpointUrl: slot?.endpointUrl,
  };
}

export async function handleGetAiStatusSummary(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any,
) {
  try {
    // Authentication/membership has already been checked once by sales-api.
    // Reuse one applied setting for every part of this read-only snapshot.
    const setting = await getOperationalAiSetting();
    const [runtimeStatus, healthSummary] = await Promise.all([
      readAiRuntimeStatus(workspaceId, setting),
      readAiHealthSummary(workspaceId, setting, body),
    ]);
    return successResponse({
      runtimeStatus,
      healthSummary,
      settings: {
        primarySlot: getPrimaryAiSlot(setting),
        appliedVersion: setting?.applied_version || 1,
        slot1: safeSlotSummary(setting?.slot1),
        slot2: safeSlotSummary(setting?.slot2),
      },
    });
  } catch (err: any) {
    return errorResponse('DATABASE_ERROR', `AI 상태 조회 실패: ${err.message}`, 500);
  }
}
