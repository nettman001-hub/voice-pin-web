import { isSupabaseConfigured, requireSupabase } from './supabaseClient';
import { buildOpenAiModelsUrl } from '../utils/maskingUtils';
import {
  AiSettings,
  SaveAiSettingsPayload,
  AiConnectionTestResult,
  AiSlotConfig,
  DEFAULT_AI_SETTINGS,
  ListAiModelsPayload,
  ListAiModelsResponse,
} from '../types/aiSettings';
import { AiResolutionResult, AiResolutionRequest } from '../types/aiResolution';
import { AiSlotHealth, CheckAiHealthPayload, AiHealthSummaryResponse } from '../types/aiHealth';
import type {
  AiTask,
  AiCircuitBreakerState,
  AiRuntimeStatus,
  CreateAiTaskPayload,
  GetAiTasksQuery,
} from '../types/aiTask';
import type {
  ResolvePendingSalePayload,
  BatchConfirmResult,
} from '../types/pendingSale';
import type {
  VoiceCorrectionIntent,
  PendingCorrectionRequest,
  VoiceCorrectionApplyResult,
} from '../types/voiceCorrection';

interface CommonApiResponse<T> {
  ok: boolean;
  apiVersion?: number;
  serverTime?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

const LOCAL_STORAGE_KEY = 'voicecap_ai_settings';

export function normalizeAiSettings(raw: any): AiSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_AI_SETTINGS;
  const intervalSec = raw.recoveryIntervalSeconds ?? raw.recovery_interval_seconds;
  const numInterval = typeof intervalSec === 'number' ? intervalSec : parseInt(intervalSec, 10);

  return {
    id: raw.id,
    scope: raw.scope || 'GLOBAL',
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    version: typeof raw.version === 'number' ? raw.version : 1,
    appliedVersion: raw.appliedVersion ?? raw.applied_version ?? 1,
    isDraft: raw.isDraft ?? raw.is_draft ?? false,
    enabledPendingResolution: raw.enabledPendingResolution ?? raw.enabled_pending_resolution ?? true,
    enabledVoiceCorrection: raw.enabledVoiceCorrection ?? raw.enabled_voice_correction ?? true,
    primarySlot: (raw.primarySlot ?? raw.primary_slot) === 2 ? 2 : 1,
    autoFallbackEnabled: raw.autoFallbackEnabled ?? raw.auto_fallback_enabled ?? true,
    recoveryIntervalSeconds: !isNaN(numInterval) && numInterval >= 5 ? numInterval : 30,
    autoReturnToPrimary: raw.autoReturnToPrimary ?? raw.auto_return_to_primary ?? true,
    cloudMonthlyBudgetKrw: raw.cloudMonthlyBudgetKrw ?? raw.cloud_monthly_budget_krw ?? null,
    slot1: {
      ...DEFAULT_AI_SETTINGS.slot1,
      ...(raw.slot1 || {}),
      authType: raw.slot1?.authType || DEFAULT_AI_SETTINGS.slot1.authType,
    },
    slot2: {
      ...DEFAULT_AI_SETTINGS.slot2,
      ...(raw.slot2 || {}),
      authType: raw.slot2?.authType || DEFAULT_AI_SETTINGS.slot2.authType,
    },
    updatedAt: raw.updatedAt ?? raw.updated_at,
    updatedBy: raw.updatedBy ?? raw.updated_by,
  };
}

function getLocalAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) return normalizeAiSettings(JSON.parse(raw));
  } catch (err) {
    console.warn('[AiSettingsApi] localStorage parse error:', err);
  }
  return DEFAULT_AI_SETTINGS;
}

function saveLocalAiSettings(settings: AiSettings): void {
  try {
    const normalized = normalizeAiSettings(settings);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
  } catch (err) {
    console.warn('[AiSettingsApi] localStorage save error:', err);
  }
}

async function invokeSalesApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase client is not configured.');
  }

  const { data, error } = await requireSupabase().functions.invoke<CommonApiResponse<T>>('sales-api', {
    body: { action, ...payload },
  });

  if (error) {
    let serverMessage = error.message;
    // FunctionsHttpError 인 경우 error.context (Response)에서 서버 반환 JSON 에러 메시지 추출
    if (error && typeof error === 'object' && 'context' in error) {
      try {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          const errJson = await ctx.json();
          if (errJson?.error?.message) {
            serverMessage = errJson.error.message;
          }
        }
      } catch {
        // json 파싱 실패 시 fallback
      }
    }
    throw new Error(serverMessage || 'sales-api 호출 중 오류가 발생했습니다.');
  }

  if (!data?.ok) {
    const err = data?.error;
    const errorObj = new Error(err?.message || '요청 처리에 실패했습니다.');
    (errorObj as unknown as { code?: string; details?: unknown }).code = err?.code;
    (errorObj as unknown as { details?: unknown }).details = err?.details;
    throw errorObj;
  }

  return data.data as T;
}

export const aiSettingsApi = {
  async getAiSettings(workspaceId?: string): Promise<AiSettings> {
    if (!isSupabaseConfigured) {
      return getLocalAiSettings();
    }
    try {
      const resp = await invokeSalesApi<{ settings: AiSettings }>('get-ai-settings', { workspaceId });
      const normalized = normalizeAiSettings(resp.settings);
      saveLocalAiSettings(normalized);
      return normalized;
    } catch (err) {
      // Vercel Serverless Function 백업 시도
      try {
        const vRes = await fetch('/api/ai-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-ai-settings', workspaceId }),
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData?.data?.settings) {
            const normalized = normalizeAiSettings(vData.data.settings);
            saveLocalAiSettings(normalized);
            return normalized;
          }
        }
      } catch {}
      console.warn('[AiSettingsApi] get-ai-settings API 호출 실패, 로컬 캐시 폴백:', err);
      return getLocalAiSettings();
    }
  },

  async saveAiSettings(payload: SaveAiSettingsPayload, workspaceId?: string): Promise<AiSettings> {
    // 1. 입력된 설정값을 브라우저 로컬 저장소에 즉시 선반영하여 페이지 이동 시에도 초기화되지 않도록 보호
    const current = getLocalAiSettings();
    const localUpdated: AiSettings = normalizeAiSettings({
      ...current,
      ...payload.settings,
      slot1: {
        ...current.slot1,
        ...payload.settings.slot1,
        hasSecret: Boolean(payload.settings.slot1?.newSecret || current.slot1.hasSecret),
        maskedSecret: payload.settings.slot1?.newSecret ? 'sk-...saved' : current.slot1.maskedSecret,
      },
      slot2: {
        ...current.slot2,
        ...payload.settings.slot2,
        hasSecret: Boolean(payload.settings.slot2?.newSecret || current.slot2.hasSecret),
        maskedSecret: payload.settings.slot2?.newSecret ? 'sk-...saved' : current.slot2.maskedSecret,
      },
      version: current.version + 1,
      appliedVersion: payload.applyImmediately ? current.version + 1 : current.appliedVersion,
      isDraft: !payload.applyImmediately,
      updatedAt: new Date().toISOString(),
    });
    saveLocalAiSettings(localUpdated);

    if (!isSupabaseConfigured) {
      return localUpdated;
    }

    try {
      const resp = await invokeSalesApi<{ settings: AiSettings }>('save-ai-settings', {
        workspaceId,
        ...payload,
      });
      const normalized = normalizeAiSettings(resp.settings);
      saveLocalAiSettings(normalized);
      return normalized;
    } catch (err: any) {
      // 2. Vercel Serverless Function 백업 시도
      try {
        const vRes = await fetch('/api/ai-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save-ai-settings', workspaceId, ...payload }),
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData?.data?.settings) {
            const normalized = normalizeAiSettings(vData.data.settings);
            saveLocalAiSettings(normalized);
            return normalized;
          }
        }
      } catch {}
      // 만약 둘 다 실패하더라도 로컬에는 이미 localUpdated로 안전 저장되어 있음
      throw err;
    }
  },

  async applyAiSettings(version: number, workspaceId?: string): Promise<AiSettings> {
    const current = getLocalAiSettings();
    const localUpdated: AiSettings = normalizeAiSettings({
      ...current,
      appliedVersion: version,
      isDraft: false,
      updatedAt: new Date().toISOString(),
    });
    saveLocalAiSettings(localUpdated);

    if (!isSupabaseConfigured) {
      return localUpdated;
    }

    try {
      const resp = await invokeSalesApi<{ settings: AiSettings }>('apply-ai-settings', {
        workspaceId,
        version,
      });
      const normalized = normalizeAiSettings(resp.settings);
      saveLocalAiSettings(normalized);
      return normalized;
    } catch (err: any) {
      try {
        const vRes = await fetch('/api/ai-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply-ai-settings', workspaceId, version }),
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData?.data?.settings) {
            const normalized = normalizeAiSettings(vData.data.settings);
            saveLocalAiSettings(normalized);
            return normalized;
          }
        }
      } catch {}
      throw err;
    }
  },

  async testAiConnection(
    slotNumber: 1 | 2,
    tempSlotConfig?: Partial<AiSlotConfig>,
    newSecret?: string,
    workspaceId?: string
  ): Promise<AiConnectionTestResult> {
    // 1. Vercel Serverless Function (/api/ai-health TIER1) 우선 호출
    try {
      const vController = new AbortController();
      const vTimer = setTimeout(() => vController.abort(), 8000);
      const vRes = await fetch('/api/ai-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          slotNumber,
          tier: 'TIER1',
          tempSlotConfig,
          newSecret,
          workspaceId,
        }),
        signal: vController.signal,
      }).catch(() => null);
      clearTimeout(vTimer);

      if (vRes && vRes.ok) {
        const d = await vRes.json().catch(() => null);
        if (d && d.ok && d.health?.tier1) {
          const t1 = d.health.tier1;
          return {
            ok: t1.ok,
            slotNumber,
            status: t1.status,
            latencyMs: t1.latencyMs,
            message: t1.message,
            testedAt: t1.testedAt || new Date().toISOString(),
          };
        }
      }
    } catch {
      // fallback
    }

    if (!isSupabaseConfigured) {
      // 로컬 개발 모드 시뮬레이션
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 350));
      return {
        ok: true,
        slotNumber,
        status: 'SUCCESS',
        latencyMs: Date.now() - start,
        message: '로컬 개발 모드: 연결 점검이 성공했습니다 (모의 응답).',
        testedAt: new Date().toISOString(),
      };
    }

    const resp = await invokeSalesApi<{ testResult: AiConnectionTestResult }>('test-ai-connection', {
      workspaceId,
      slotNumber,
      tempSlotConfig,
      newSecret,
    });
    return resp.testResult;
  },

  async listAiModels(payload: ListAiModelsPayload): Promise<ListAiModelsResponse> {
    const trimmed = (payload.endpointUrl || '').trim();
    if (!trimmed) {
      return { ok: false, models: [], message: '엔드포인트 주소를 입력해 주세요.' };
    }

    const clean = trimmed.replace(/\/+$/, '');

    // 1. Vercel Serverless Proxy / Vite Dev Proxy (/api/ai-models) 우선 호출
    // 브라우저의 Mixed Content (HTTPS -> HTTP) 및 CORS 차단을 완벽히 우회하여
    // 외부 공인 IP/도메인 LLM 서버에 안전하게 도달합니다.
    try {
      const vercelController = new AbortController();
      const vercelTimer = setTimeout(() => vercelController.abort(), 6000);
      const queryParams = new URLSearchParams({
        endpointUrl: clean,
        provider: payload.provider || '',
      });
      if (payload.authType) queryParams.set('authType', payload.authType);
      if (payload.secret) queryParams.set('secret', payload.secret);
      if (payload.customHeaderName) queryParams.set('customHeaderName', payload.customHeaderName);

      const vRes = await fetch(`/api/ai-models?${queryParams.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: vercelController.signal,
      }).catch(() => null);
      clearTimeout(vercelTimer);

      if (vRes && vRes.ok) {
        const d = await vRes.json().catch(() => null);
        if (d && Array.isArray(d.models) && d.models.length > 0) {
          return { ok: true, models: d.models, source: 'VERCEL_PROXY' };
        }
      }
    } catch {
      // Proxy failed or offline, proceed to fallback
    }

    // 2. 브라우저 직접 fetch 시도 (로컬 개발 환경 또는 직접 도달 가능한 경우)
    try {
      const isOllama = payload.provider === 'OLLAMA' || clean.endsWith(':11434');
      const isLmStudio = payload.provider === 'LM_STUDIO' || clean.includes(':1234') || clean.includes(':1235');

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (payload.secret) {
        if (payload.authType === 'BEARER') headers['Authorization'] = `Bearer ${payload.secret}`;
        else if (payload.authType === 'API_KEY') headers['x-api-key'] = payload.secret;
        else if (payload.authType === 'CUSTOM_HEADER' && payload.customHeaderName) headers[payload.customHeaderName] = payload.secret;
      }

      // LM Studio / OpenAI 규격 우선 조회
      if (isLmStudio || !isOllama) {
        const v1Url = buildOpenAiModelsUrl(clean);
        const directController = new AbortController();
        const t = setTimeout(() => directController.abort(), 2000);
        const r = await fetch(v1Url, { method: 'GET', headers, signal: directController.signal }).catch(() => null);
        clearTimeout(t);
        if (r && r.ok) {
          const d = await r.json().catch(() => null);
          const rawList = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : (Array.isArray(d) ? d : []));
          const models = rawList.map((m: any) => (typeof m === 'string' ? m : (m?.id || m?.name || m?.model || ''))).filter(Boolean);
          if (models.length > 0) {
            return { ok: true, models, source: 'DIRECT_FETCH' };
          }
        }
      }

      if (isOllama) {
        const directController = new AbortController();
        const t = setTimeout(() => directController.abort(), 2000);
        const r = await fetch(`${clean}/api/tags`, { method: 'GET', headers, signal: directController.signal }).catch(() => null);
        clearTimeout(t);
        if (r && r.ok) {
          const d = await r.json().catch(() => null);
          if (d && Array.isArray(d.models)) {
            const models = d.models.map((m: any) => m.name || m.model || '').filter(Boolean);
            if (models.length > 0) {
              return { ok: true, models, source: 'DIRECT_FETCH' };
            }
          }
        }
      }
    } catch {
      // Direct fetch failed, fallback to backend proxy
    }

    // 3. 백엔드 Supabase Edge Function 프록시 호출
    if (isSupabaseConfigured) {
      try {
        const resp = await invokeSalesApi<{ ok: boolean; models: string[]; message?: string; source?: any }>('list-ai-models', payload);
        if (resp && resp.ok && resp.models && resp.models.length > 0) {
          return {
            ok: resp.ok,
            models: resp.models,
            message: resp.message,
            source: resp.source,
          };
        }
      } catch (err: any) {
        // Continue to fallback message
      }
    }

    return {
      ok: false,
      models: [],
      message: '해당 엔드포인트에서 모델 목록을 가져오지 못했습니다. 엔드포인트 주소와 서버 실행 상태를 확인해 주세요.',
    };
  },

  async testAiSynthetic(
    slotNumber: 1 | 2,
    tempSlotConfig?: Partial<AiSlotConfig>,
    newSecret?: string,
    request?: Partial<AiResolutionRequest>,
    workspaceId?: string
  ): Promise<AiResolutionResult> {
    if (!isSupabaseConfigured) {
      // 로컬 개발 모드 시뮬레이션
      await new Promise((resolve) => setTimeout(resolve, 400));
      return {
        resolvable: true,
        targetSaleId: 'mock_sale_1',
        action: 'UPDATE_SALE',
        changes: {
          amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 },
        },
        evidenceIds: ['mock_utterance_1'],
        evidenceSummary: '로컬 시뮬레이션: 0.9에서 1.2로 금액 정정 확인',
        missingInfo: [],
        conflictReason: null,
        execution: {
          adapterType: 'SELF_HOSTED',
          routingMode: tempSlotConfig?.routingMode || 'SERVER_DIRECT',
          location: tempSlotConfig?.location || 'SAME_PC',
          provider: tempSlotConfig?.provider || 'OLLAMA',
          model: tempSlotConfig?.model || 'qwen2.5:7b',
          latencyMs: 420,
        },
      };
    }

    const resp = await invokeSalesApi<{ result: AiResolutionResult }>('test-ai-synthetic', {
      workspaceId,
      slotNumber,
      tempSlotConfig,
      newSecret,
      request,
    });
    return resp.result;
  },

  async checkAiHealth(
    payload: CheckAiHealthPayload = {}
  ): Promise<{ health: AiSlotHealth | { slot1: AiSlotHealth; slot2: AiSlotHealth }; checkedAt: string }> {
    // 1. Supabase가 설정되어 있다면, DB 비밀정보(ai_secrets) 격리 보관소에 안전하게 접근 가능한 Supabase Edge Function 최우선 호출!
    if (isSupabaseConfigured) {
      try {
        const resp = await invokeSalesApi<{
          health: AiSlotHealth | { slot1: AiSlotHealth; slot2: AiSlotHealth };
          checkedAt: string;
        }>('check-ai-health', payload as Record<string, unknown>);
        if (resp && resp.health) {
          return resp;
        }
      } catch (edgeErr) {
        console.warn('[AiSettingsApi] Edge Function check-ai-health 실패, Vercel 프록시로 폴백 시도:', edgeErr);
      }
    }

    // 2. Vercel Serverless Function (/api/ai-health) 폴백 호출
    try {
      const vController = new AbortController();
      const vTimer = setTimeout(() => vController.abort(), 12000);
      const vRes = await fetch('/api/ai-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: vController.signal,
      }).catch(() => null);
      clearTimeout(vTimer);

      if (vRes && vRes.ok) {
        const d = await vRes.json().catch(() => null);
        if (d && d.ok && d.health) {
          return { health: d.health, checkedAt: d.checkedAt || new Date().toISOString() };
        }
      }
    } catch {
      // Vercel proxy failed or offline, fallback
    }

    // 2. PC 도우미 로컬 포트 (127.0.0.1:2137/api/ai-health) 시도
    try {
      const hController = new AbortController();
      const hTimer = setTimeout(() => hController.abort(), 3000);
      const hRes = await fetch('http://127.0.0.1:2137/api/ai-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: hController.signal,
      }).catch(() => null);
      clearTimeout(hTimer);

      if (hRes && hRes.ok) {
        const d = await hRes.json().catch(() => null);
        if (d && d.ok && d.health) {
          return { health: d.health, checkedAt: d.checkedAt || new Date().toISOString() };
        }
      }
    } catch {
      // Local helper offline
    }

    // 3. Supabase 미설정 시 로컬 모의 응답
    if (!isSupabaseConfigured) {
      const now = new Date().toISOString();
      const mockSlot = (num: 1 | 2): AiSlotHealth => ({
        slotNumber: num,
        routeKey: `${num}:PC_HELPER:SERVER:SAME_PC:http://127.0.0.1:11434:qwen:1`,
        routingMode: 'PC_HELPER',
        location: 'SAME_PC',
        executorId: 'SERVER',
        endpointUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5:7b',
        settingVersion: 1,
        overallStatus: 'AVAILABLE',
        tier1: { ok: true, status: 'SUCCESS', latencyMs: 12, message: '연결 성공 (로컬 모의)', testedAt: now },
        tier2: { ok: true, status: 'READY', message: '모델 준비 완료 (로컬 모의)', testedAt: now },
        tier3: { ok: true, allPassed: true, passedCount: 5, totalCount: 5, totalLatencyMs: 250, scenarios: [], message: '합성 시험 5/5 통과', testedAt: now },
        consecutiveFailures: 0,
        consecutiveSuccesses: 1,
        lastCheckedAt: now,
        isExpired: false,
      });

      if (payload.slotNumber) {
        return { health: mockSlot(payload.slotNumber), checkedAt: now };
      }
      return { health: { slot1: mockSlot(1), slot2: mockSlot(2) }, checkedAt: now };
    }

    // 4. Supabase Edge Function 폴백
    return await invokeSalesApi<{
      health: AiSlotHealth | { slot1: AiSlotHealth; slot2: AiSlotHealth };
      checkedAt: string;
    }>('check-ai-health', payload as Record<string, unknown>);
  },

  async getAiHealth(workspaceId?: string, deviceId?: string): Promise<AiHealthSummaryResponse> {
    if (!isSupabaseConfigured) {
      const now = new Date().toISOString();
      const mockSlot = (num: 1 | 2): AiSlotHealth => ({
        slotNumber: num,
        routeKey: `${num}:SERVER_DIRECT:SERVER:EXTERNAL_IP:https://api.openai.com:gpt-4o:1`,
        routingMode: num === 1 ? 'PC_HELPER' : 'SERVER_DIRECT',
        location: num === 1 ? 'SAME_PC' : 'EXTERNAL_IP',
        executorId: 'SERVER',
        endpointUrl: num === 1 ? 'http://127.0.0.1:11434' : 'https://api.openai.com',
        model: num === 1 ? 'qwen2.5:7b' : 'gpt-4o-mini',
        settingVersion: 1,
        overallStatus: 'AVAILABLE',
        tier1: { ok: true, status: 'SUCCESS', latencyMs: 15, message: '정상', testedAt: now },
        tier2: { ok: true, status: num === 1 ? 'READY' : 'NOT_QUERYABLE', message: '정상', testedAt: now },
        tier3: { ok: true, allPassed: true, passedCount: 5, totalCount: 5, totalLatencyMs: 310, scenarios: [], message: '정상', testedAt: now },
        consecutiveFailures: 0,
        consecutiveSuccesses: 1,
        lastCheckedAt: now,
        isExpired: false,
      });

      return {
        slot1: mockSlot(1),
        slot2: mockSlot(2),
        activePrimarySlot: 1,
        checkedAt: now,
      };
    }

    return await invokeSalesApi<AiHealthSummaryResponse>('get-ai-health', {
      workspaceId,
      deviceId,
    });
  },

  async createAiTask(payload: CreateAiTaskPayload): Promise<{ task: AiTask }> {
    if (!isSupabaseConfigured) {
      const timestamp = Date.now();
      const taskId = `ai_task_mock_${timestamp}`;
      const now = new Date().toISOString();
      const task: AiTask = {
        taskId,
        workspaceId: payload.workspaceId,
        sessionId: payload.sessionId,
        saleId: payload.saleId,
        saleRevision: payload.saleRevision ?? 1,
        settingVersion: payload.settingVersion ?? 1,
        evidenceSnapshotVersion: payload.evidenceSnapshotVersion ?? 1,
        taskType: payload.taskType,
        status: 'QUEUED',
        activeSlot: 1,
        currentAttemptId: `att_${taskId}_init`,
        currentUtterance: payload.currentUtterance,
        requestPayload: payload.request,
        attempts: [],
        createdAt: now,
        updatedAt: now,
      };
      return { task };
    }

    return await invokeSalesApi<{ task: AiTask }>('create-ai-task', payload as unknown as Record<string, unknown>);
  },

  async processAiTask(params: {
    taskId?: string;
    task?: AiTask;
  }): Promise<{
    task: AiTask;
    slot1CircuitBreaker: AiCircuitBreakerState;
    slot2CircuitBreaker: AiCircuitBreakerState;
  }> {
    if (!isSupabaseConfigured) {
      const now = new Date().toISOString();
      const task: AiTask = params.task || {
        taskId: params.taskId || `mock_task_${Date.now()}`,
        workspaceId: 'mock_ws',
        sessionId: 'mock_session',
        saleId: 'mock_sale',
        saleRevision: 1,
        settingVersion: 1,
        evidenceSnapshotVersion: 1,
        taskType: 'PENDING_RESOLUTION',
        status: 'RESOLVED',
        activeSlot: 1,
        currentAttemptId: `att_mock_1`,
        currentUtterance: '모의 테스트 발화',
        requestPayload: {
          workspaceId: 'mock_ws',
          sessionId: 'mock_session',
          taskType: 'PENDING_RESOLUTION',
          currentUtterance: '모의 테스트 발화',
        },
        resolutionResult: {
          resolvable: true,
          action: 'UPDATE_SALE',
          targetSaleId: 'mock_sale',
          changes: {
            amount: { from: 10000, to: 12000 },
          },
          evidenceIds: ['ev_mock'],
          evidenceSummary: '모의 정상 해결',
          missingInfo: [],
          conflictReason: null,
          execution: {
            adapterType: 'SELF_HOSTED',
            routingMode: 'SERVER_DIRECT',
            provider: 'MOCK',
            model: 'mock-model',
            latencyMs: 120,
          },
        },
        attempts: [
          {
            attemptId: 'att_mock_1',
            taskId: params.taskId || 'mock_task',
            slotNumber: 1,
            status: 'COMPLETED',
            isValidAttempt: true,
            startedAt: now,
            completedAt: now,
            latencyMs: 120,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      return {
        task,
        slot1CircuitBreaker: {
          slotNumber: 1,
          isOpen: false,
          consecutiveFailures: 0,
          cooldownUntil: null,
          consecutiveRecoverySuccesses: 1,
        },
        slot2CircuitBreaker: {
          slotNumber: 2,
          isOpen: false,
          consecutiveFailures: 0,
          cooldownUntil: null,
          consecutiveRecoverySuccesses: 0,
        },
      };
    }

    return await invokeSalesApi<{
      task: AiTask;
      slot1CircuitBreaker: AiCircuitBreakerState;
      slot2CircuitBreaker: AiCircuitBreakerState;
    }>('process-ai-task', params as Record<string, unknown>);
  },

  async getAiTasks(query: GetAiTasksQuery = {}): Promise<{ tasks: AiTask[] }> {
    if (!isSupabaseConfigured) {
      return { tasks: [] };
    }

    return await invokeSalesApi<{ tasks: AiTask[] }>('get-ai-tasks', query as Record<string, unknown>);
  },

  async getAiRuntimeStatus(workspaceId?: string): Promise<{ runtimeStatus: AiRuntimeStatus }> {
    if (!isSupabaseConfigured) {
      const now = new Date().toISOString();
      return {
        runtimeStatus: {
          activeSlot: 1,
          activePrimarySlot: 1,
          slot1CircuitBreaker: {
            slotNumber: 1,
            isOpen: false,
            consecutiveFailures: 0,
            cooldownUntil: null,
            consecutiveRecoverySuccesses: 0,
          },
          slot2CircuitBreaker: {
            slotNumber: 2,
            isOpen: false,
            consecutiveFailures: 0,
            cooldownUntil: null,
            consecutiveRecoverySuccesses: 0,
          },
          queuedTaskCount: 0,
          processingTaskCount: 0,
          resolvedTaskCount: 0,
          insufficientDataTaskCount: 0,
          failedTaskCount: 0,
          lastSwitchReason: null,
          lastSwitchedAt: null,
          checkedAt: now,
        },
      };
    }

    return await invokeSalesApi<{ runtimeStatus: AiRuntimeStatus }>('get-ai-runtime-status', {
      workspaceId,
    });
  },

  async resolvePendingSale(payload: ResolvePendingSalePayload): Promise<{
    sale: any;
    allResolved: boolean;
    remainingReasons: any[];
  }> {
    if (!isSupabaseConfigured) {
      return {
        sale: {
          id: payload.saleId,
          revision: payload.expectedRevision + 1,
          status: '자동저장',
          buyerNickname: payload.changes.buyerNickname,
          amount: payload.changes.amount,
        },
        allResolved: true,
        remainingReasons: [],
      };
    }

    return await invokeSalesApi<{
      sale: any;
      allResolved: boolean;
      remainingReasons: any[];
    }>('resolve-pending-sale', payload as unknown as Record<string, unknown>);
  },

  async batchConfirmPendingSales(
    saleIds: string[],
    workspaceId?: string
  ): Promise<{ result: BatchConfirmResult }> {
    if (!isSupabaseConfigured) {
      return {
        result: {
          totalRequested: saleIds.length,
          confirmedCount: saleIds.length,
          confirmedSaleIds: saleIds,
          skippedCount: 0,
          skippedSales: [],
        },
      };
    }

    return await invokeSalesApi<{ result: BatchConfirmResult }>('batch-confirm-pending-sales', {
      saleIds,
      workspaceId,
    });
  },

  async triggerPendingAiResolution(
    saleId: string,
    options: {
      followUpUtterance?: string;
      followingUtterance?: string;
      followingUtterances?: Array<{ text: string; timestamp?: string }>;
      forceReanalyze?: boolean;
      workspaceId?: string;
    } = {}
  ): Promise<any> {
    if (!isSupabaseConfigured) {
      return {
        message: '오프라인 모의 보류 해결 완료',
        sale: { id: saleId, status: '자동저장' },
      };
    }

    return await invokeSalesApi('trigger-pending-ai', {
      saleId,
      ...options,
    });
  },

  async processVoiceCorrection(
    sessionId: string,
    utterance: string,
    workspaceId?: string
  ): Promise<any> {
    if (!isSupabaseConfigured) {
      return {
        isCorrection: true,
        action: 'APPLIED',
        message: '로컬 오프라인 모의 정정 처리',
      };
    }
    return await invokeSalesApi('process-voice-correction', {
      sessionId,
      utterance,
      workspaceId,
    });
  },

  async applyVoiceCorrection(
    saleId: string,
    intent: VoiceCorrectionIntent,
    options: {
      expectedRevision?: number;
      pendingCorrectionId?: string;
      workspaceId?: string;
    } = {}
  ): Promise<VoiceCorrectionApplyResult> {
    if (!isSupabaseConfigured) {
      return {
        success: true,
        action: 'APPLIED',
        message: '로컬 오프라인 모의 정정 적용',
      };
    }
    return await invokeSalesApi<VoiceCorrectionApplyResult>('apply-voice-correction', {
      saleId,
      intent,
      ...options,
    });
  },

  async linkFollowUpCorrection(
    pendingCorrectionId: string,
    followUpUtterance: string,
    workspaceId?: string
  ): Promise<any> {
    if (!isSupabaseConfigured) {
      return {
        message: '로컬 오프라인 모의 후속 발화 연결 완료',
      };
    }
    return await invokeSalesApi('link-follow-up-correction', {
      pendingCorrectionId,
      followUpUtterance,
      workspaceId,
    });
  },

  async rollbackVoiceCorrection(
    params: {
      sessionId?: string;
      saleId?: string;
      pendingCorrectionId?: string;
      workspaceId?: string;
    } = {}
  ): Promise<any> {
    if (!isSupabaseConfigured) {
      return {
        action: 'RESTORED',
        message: '로컬 오프라인 모의 정정 취소/복원',
      };
    }
    return await invokeSalesApi('rollback-voice-correction', params);
  },
};
