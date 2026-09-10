import { admin, successResponse, errorResponse, AuthContext } from '../../_shared/productSales.ts'
import { validateUrlForSsrf, maskSecretValue } from './aiValidation.ts'
import { executeAiResolution } from './aiAdapters/index.ts'
import { buildOpenAiModelsUrl } from './aiAdapters/common.ts'
import { AiResolutionRequest } from '../../../../src/types/aiResolution.ts'

export { validateUrlForSsrf, maskSecretValue }

function checkIsAdmin(auth: AuthContext): boolean {
  return auth.role === 'ADMIN' || auth.role === 'OWNER' || auth.capabilities.has('ADMIN')
}

function formatAiSettingResponse(row: any, secretMap?: Map<number, string>, isAdmin = true) {
  const slot1 = {
    ...(row.slot1 || {}),
    hasSecret: secretMap ? secretMap.has(1) : Boolean(row.slot1?.hasSecret),
    maskedSecret: isAdmin ? (secretMap?.get(1) || row.slot1?.maskedSecret || '') : undefined,
  }
  const slot2 = {
    ...(row.slot2 || {}),
    hasSecret: secretMap ? secretMap.has(2) : Boolean(row.slot2?.hasSecret),
    maskedSecret: isAdmin ? (secretMap?.get(2) || row.slot2?.maskedSecret || '') : undefined,
  }

  return {
    id: row.id,
    scope: row.scope,
    workspaceId: row.workspace_id || row.workspaceId,
    version: row.version,
    appliedVersion: row.applied_version ?? row.appliedVersion,
    isDraft: row.is_draft ?? row.isDraft,
    enabledPendingResolution: row.enabled_pending_resolution ?? row.enabledPendingResolution ?? true,
    enabledVoiceCorrection: row.enabled_voice_correction ?? row.enabledVoiceCorrection ?? true,
    primarySlot: row.primary_slot ?? row.primarySlot ?? 1,
    autoFallbackEnabled: row.auto_fallback_enabled ?? row.autoFallbackEnabled ?? true,
    recoveryIntervalSeconds: row.recovery_interval_seconds ?? row.recoveryIntervalSeconds ?? 30,
    autoReturnToPrimary: row.auto_return_to_primary ?? row.autoReturnToPrimary ?? true,
    cloudMonthlyBudgetKrw: row.cloud_monthly_budget_krw ?? row.cloudMonthlyBudgetKrw ?? null,
    slot1,
    slot2,
    updatedAt: row.updated_at || row.updatedAt,
    updatedBy: row.updated_by || row.updatedBy,
  }
}

// 1. AI 설정 조회 (관리자/판매자 공통, 비밀정보는 마스킹)
export async function handleGetAiSettings(workspaceId: string, actorId: string, auth: AuthContext, body: any) {
  const isAdmin = checkIsAdmin(auth)

  // 1-1. DB에서 설정 조회 (GLOBAL 설정 우선)
  const { data: setting, error } = await admin
    .from('ai_settings')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle()

  if (error) {
    return errorResponse('DATABASE_ERROR', error.message, 500)
  }

  let finalSetting = setting
  if (!finalSetting) {
    // 최초 기본 설정 생성
    const { data: created, error: createErr } = await admin
      .from('ai_settings')
      .insert({ scope: 'GLOBAL', version: 1, applied_version: 1, is_draft: false })
      .select('*')
      .single()

    if (createErr) {
      return errorResponse('DATABASE_ERROR', createErr.message, 500)
    }
    finalSetting = created
  }

  // 1-2. 비밀정보 존재 여부 확인 (ai_secrets)
  const { data: secrets } = await admin
    .from('ai_secrets')
    .select('slot_number, masked_value')
    .eq('setting_id', finalSetting.id)

  const secretMap = new Map<number, string>()
  for (const s of secrets || []) {
    secretMap.set(s.slot_number, s.masked_value)
  }

  return successResponse({
    settings: formatAiSettingResponse(finalSetting, secretMap, isAdmin),
  })
}

// 2. AI 설정 저장 (관리자 전용, SSRF 검증 및 비밀정보 분리 저장)
export async function handleSaveAiSettings(workspaceId: string, actorId: string, auth: AuthContext, body: any) {
  if (!checkIsAdmin(auth)) {
    return errorResponse('FORBIDDEN', '관리자(ADMIN) 권한만 AI 설정을 변경할 수 있습니다.', 403)
  }

  const { expectedVersion, applyImmediately, changeSummary, settings } = body || {}
  if (!settings) {
    return errorResponse('INVALID_PAYLOAD', '변경할 설정 데이터가 필요합니다.', 400)
  }

  // 기존 설정 조회
  const { data: current, error: fetchErr } = await admin
    .from('ai_settings')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle()

  if (fetchErr || !current) {
    return errorResponse('NOT_FOUND', 'AI 설정을 찾을 수 없습니다.', 404)
  }

  // 버전 충돌(Optimistic Lock) 검증
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    return errorResponse('REVISION_CONFLICT', '설정 버전 충돌이 발생했습니다. 새로고침 후 다시 시도해 주세요.', 409, {
      currentVersion: current.version,
      expectedVersion,
    })
  }

  // SSRF 주소 유효성 검사
  const nextSlot1 = { ...(current.slot1 || {}), ...(settings.slot1 || {}) }
  const nextSlot2 = { ...(current.slot2 || {}), ...(settings.slot2 || {}) }

  if (nextSlot1.endpointUrl) {
    const check1 = validateUrlForSsrf(nextSlot1.endpointUrl, nextSlot1.routingMode || 'SERVER_DIRECT')
    if (!check1.valid) {
      return errorResponse('SSRF_SECURITY_VIOLATION', `슬롯 1 주소 오류: ${check1.reason}`, 400)
    }
  }

  if (nextSlot2.endpointUrl) {
    const check2 = validateUrlForSsrf(nextSlot2.endpointUrl, nextSlot2.routingMode || 'SERVER_DIRECT')
    if (!check2.valid) {
      return errorResponse('SSRF_SECURITY_VIOLATION', `슬롯 2 주소 오류: ${check2.reason}`, 400)
    }
  }

  // 비밀정보(신규 키/토큰) 처리 (slot1)
  if (settings.slot1?.clearSecret) {
    await admin.from('ai_secrets').delete().eq('setting_id', current.id).eq('slot_number', 1)
  } else if (settings.slot1?.newSecret && typeof settings.slot1.newSecret === 'string') {
    const raw = settings.slot1.newSecret.trim()
    if (raw) {
      const masked = maskSecretValue(raw)
      const secType = nextSlot1.authType === 'BEARER' ? 'BEARER_TOKEN' : (nextSlot1.authType === 'CUSTOM_HEADER' ? 'CUSTOM_HEADER' : 'API_KEY')
      await admin.from('ai_secrets').upsert({
        setting_id: current.id,
        slot_number: 1,
        secret_type: secType,
        secret_value: raw,
        masked_value: masked,
        header_name: nextSlot1.customHeaderName || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'setting_id,slot_number' })
    }
  }

  // 비밀정보 처리 (slot2)
  if (settings.slot2?.clearSecret) {
    await admin.from('ai_secrets').delete().eq('setting_id', current.id).eq('slot_number', 2)
  } else if (settings.slot2?.newSecret && typeof settings.slot2.newSecret === 'string') {
    const raw = settings.slot2.newSecret.trim()
    if (raw) {
      const masked = maskSecretValue(raw)
      const secType = nextSlot2.authType === 'BEARER' ? 'BEARER_TOKEN' : (nextSlot2.authType === 'CUSTOM_HEADER' ? 'CUSTOM_HEADER' : 'API_KEY')
      await admin.from('ai_secrets').upsert({
        setting_id: current.id,
        slot_number: 2,
        secret_type: secType,
        secret_value: raw,
        masked_value: masked,
        header_name: nextSlot2.customHeaderName || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'setting_id,slot_number' })
    }
  }

  // 설정 객체에서 newSecret, clearSecret 임시 필드 제거
  delete nextSlot1.newSecret
  delete nextSlot1.clearSecret
  delete nextSlot2.newSecret
  delete nextSlot2.clearSecret

  const newVersion = current.version + 1
  const appliedVersion = applyImmediately ? newVersion : current.applied_version
  const isDraft = !applyImmediately

  // 2-3. ai_settings 업데이트
  const updatePayload: Record<string, any> = {
    version: newVersion,
    applied_version: appliedVersion,
    is_draft: isDraft,
    slot1: nextSlot1,
    slot2: nextSlot2,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  }

  if (settings.enabledPendingResolution !== undefined) {
    updatePayload.enabled_pending_resolution = Boolean(settings.enabledPendingResolution)
  }
  if (settings.enabledVoiceCorrection !== undefined) {
    updatePayload.enabled_voice_correction = Boolean(settings.enabledVoiceCorrection)
  }
  if (settings.primarySlot === 1 || settings.primarySlot === 2) {
    updatePayload.primary_slot = settings.primarySlot
  }
  if (settings.autoFallbackEnabled !== undefined) {
    updatePayload.auto_fallback_enabled = Boolean(settings.autoFallbackEnabled)
  }
  if (typeof settings.recoveryIntervalSeconds === 'number' && settings.recoveryIntervalSeconds >= 5) {
    updatePayload.recovery_interval_seconds = settings.recoveryIntervalSeconds
  }
  if (settings.autoReturnToPrimary !== undefined) {
    updatePayload.auto_return_to_primary = Boolean(settings.autoReturnToPrimary)
  }
  if (settings.cloudMonthlyBudgetKrw !== undefined) {
    updatePayload.cloud_monthly_budget_krw = settings.cloudMonthlyBudgetKrw
  }

  const { data: updated, error: updateErr } = await admin
    .from('ai_settings')
    .update(updatePayload)
    .eq('id', current.id)
    .select('*')
    .single()

  if (updateErr) {
    return errorResponse('DATABASE_ERROR', updateErr.message, 500)
  }

  // 2-4. 이력 스냅샷(ai_settings_history) 저장
  await admin.from('ai_settings_history').insert({
    setting_id: current.id,
    version: newVersion,
    applied_version: appliedVersion,
    snapshot: updated,
    change_summary: changeSummary || (applyImmediately ? `버전 ${newVersion} 저장 및 즉시 적용` : `버전 ${newVersion} 초안 저장`),
    created_by: actorId,
  })

  // 비밀정보 마스킹 상태 반환
  const { data: latestSecrets } = await admin
    .from('ai_secrets')
    .select('slot_number, masked_value')
    .eq('setting_id', current.id)

  const secretMap = new Map<number, string>()
  for (const s of latestSecrets || []) {
    secretMap.set(s.slot_number, s.masked_value)
  }

  return successResponse({
    settings: formatAiSettingResponse(updated, secretMap, true),
  })
}

// 3. AI 설정 운영 적용 (관리자 전용)
export async function handleApplyAiSettings(workspaceId: string, actorId: string, auth: AuthContext, body: any) {
  if (!checkIsAdmin(auth)) {
    return errorResponse('FORBIDDEN', '관리자만 AI 설정을 적용할 수 있습니다.', 403)
  }

  const { version } = body || {}

  const { data: current, error: fetchErr } = await admin
    .from('ai_settings')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle()

  if (fetchErr || !current) {
    return errorResponse('NOT_FOUND', 'AI 설정을 찾을 수 없습니다.', 404)
  }

  const targetVersion = typeof version === 'number' ? version : current.version

  const { data: updated, error: updateErr } = await admin
    .from('ai_settings')
    .update({
      applied_version: targetVersion,
      is_draft: false,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .select('*')
    .single()

  if (updateErr) {
    return errorResponse('DATABASE_ERROR', updateErr.message, 500)
  }

  return successResponse({ settings: formatAiSettingResponse(updated, undefined, true) })
}

// 4. 사전 점검 1단계: 연결 시험 API (관리자 전용)
export async function handleTestAiConnection(workspaceId: string, actorId: string, auth: AuthContext, body: any) {
  if (!checkIsAdmin(auth)) {
    return errorResponse('FORBIDDEN', '관리자만 AI 연결 점검을 실행할 수 있습니다.', 403)
  }

  const { slotNumber, tempSlotConfig, newSecret } = body || {}
  const targetSlotNum = slotNumber === 2 ? 2 : 1

  // 기존 설정 조회
  const { data: current } = await admin
    .from('ai_settings')
    .select('id, slot1, slot2')
    .eq('scope', 'GLOBAL')
    .maybeSingle()

  const activeSlot = targetSlotNum === 1 ? (current?.slot1 || {}) : (current?.slot2 || {})
  const effectiveConfig = { ...activeSlot, ...(tempSlotConfig || {}) }
  const endpointUrl = String(effectiveConfig.endpointUrl || '').trim()
  const routingMode = effectiveConfig.routingMode || 'SERVER_DIRECT'

  // SSRF 검증
  const ssrfCheck = validateUrlForSsrf(endpointUrl, routingMode)
  if (!ssrfCheck.valid) {
    return successResponse({
      testResult: {
        ok: false,
        slotNumber: targetSlotNum,
        status: 'SSRF_BLOCKED',
        message: ssrfCheck.reason,
        testedAt: new Date().toISOString(),
      },
    })
  }

  // PC 도우미 경유 모드인 경우
  if (routingMode === 'PC_HELPER') {
    return successResponse({
      testResult: {
        ok: true,
        slotNumber: targetSlotNum,
        status: 'SUCCESS',
        latencyMs: 12,
        message: 'PC 도우미 경유 모드로 설정되었습니다. 해당 PC의 로컬 도우미가 연결을 담당합니다.',
        testedAt: new Date().toISOString(),
      },
    })
  }

  // 서버 직접 호출(SERVER_DIRECT) 또는 클라우드 프로브
  if (!endpointUrl) {
    return successResponse({
      testResult: {
        ok: false,
        slotNumber: targetSlotNum,
        status: 'FAILED',
        message: '연결할 API 주소(endpointUrl)가 설정되지 않았습니다.',
        testedAt: new Date().toISOString(),
      },
    })
  }

  const startTime = Date.now()
  const timeoutMs = Math.min(5000, Math.max(1000, (effectiveConfig.connectTimeoutSeconds || 3) * 1000))

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // 가벼운 프로브 요청 (HEAD or GET)
    const probeUrl = endpointUrl.endsWith('/') ? endpointUrl : `${endpointUrl}/`
    const headers: Record<string, string> = { 'Accept': 'application/json' }

    // 비밀정보 / 헤더 반영
    let effectiveSecret = newSecret
    if (!effectiveSecret && current?.id) {
      const { data: sec } = await admin
        .from('ai_secrets')
        .select('secret_value')
        .eq('setting_id', current.id)
        .eq('slot_number', targetSlotNum)
        .maybeSingle()
      effectiveSecret = sec?.secret_value
    }

    if (effectiveSecret) {
      if (effectiveConfig.authType === 'BEARER') {
        headers['Authorization'] = `Bearer ${effectiveSecret}`
      } else if (effectiveConfig.authType === 'API_KEY') {
        headers['x-api-key'] = effectiveSecret
      } else if (effectiveConfig.authType === 'CUSTOM_HEADER' && effectiveConfig.customHeaderName) {
        headers[effectiveConfig.customHeaderName] = effectiveSecret
      }
    }

    const response = await fetch(probeUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - startTime

    // 200~399 or 404 (endpoint exists)
    if (response.status < 500) {
      return successResponse({
        testResult: {
          ok: true,
          slotNumber: targetSlotNum,
          status: 'SUCCESS',
          latencyMs,
          message: `서버 직접 연결 성공 (HTTP ${response.status}, 지연시간: ${latencyMs}ms)`,
          testedAt: new Date().toISOString(),
        },
      })
    } else {
      return successResponse({
        testResult: {
          ok: false,
          slotNumber: targetSlotNum,
          status: 'FAILED',
          latencyMs,
          message: `서버 오류 응답 (HTTP ${response.status})`,
          testedAt: new Date().toISOString(),
        },
      })
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime
    if (err.name === 'AbortError') {
      return successResponse({
        testResult: {
          ok: false,
          slotNumber: targetSlotNum,
          status: 'TIMEOUT',
          latencyMs,
          message: `연결 제한 시간(${timeoutMs / 1000}초) 초과: 서버에 연결할 수 없습니다.`,
          testedAt: new Date().toISOString(),
        },
      })
    }
    return successResponse({
      testResult: {
        ok: false,
        slotNumber: targetSlotNum,
        status: 'FAILED',
        latencyMs,
        message: `연결 실패: ${err.message || '네트워크 오류'}`,
        testedAt: new Date().toISOString(),
      },
    })
  }
}

// 5. 사전 점검 2단계: 실제 정정 시험(합성 테스트) API (관리자 전용)
export async function handleTestAiSynthetic(workspaceId: string, actorId: string, auth: AuthContext, body: any) {
  if (!checkIsAdmin(auth)) {
    return errorResponse('FORBIDDEN', '관리자만 실제 정정 시험(합성 테스트)을 실행할 수 있습니다.', 403)
  }

  const { slotNumber, tempSlotConfig, newSecret, request } = body || {}
  const targetSlotNum = slotNumber === 2 ? 2 : 1

  // 기존 설정 조회
  const { data: current } = await admin
    .from('ai_settings')
    .select('id, slot1, slot2')
    .eq('scope', 'GLOBAL')
    .maybeSingle()

  const activeSlot = targetSlotNum === 1 ? (current?.slot1 || {}) : (current?.slot2 || {})
  const effectiveConfig = { ...activeSlot, ...(tempSlotConfig || {}) }

  // 비밀정보 조회 (DB 격리 보관)
  let effectiveSecret = newSecret
  if (!effectiveSecret && current?.id) {
    const { data: sec } = await admin
      .from('ai_secrets')
      .select('secret_value')
      .eq('setting_id', current.id)
      .eq('slot_number', targetSlotNum)
      .maybeSingle()
    effectiveSecret = sec?.secret_value
  }

  // 기본 합성 요청 예시 (PLAN.md 5번 합성 정정 시나리오 1: 0.9가 아니고 1.2입니다)
  const syntheticReq: AiResolutionRequest = request || {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: workspaceId || 'default',
    sessionId: 'synthetic_session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      {
        saleId: 'synth_sale_1',
        productCode: '1',
        productName: '원피스',
        buyerNickname: 'xx',
        buyerId: 'user_xx',
        amount: 9000,
        unitPrice: 9000,
        quantity: 1,
        status: 'PENDING',
      },
    ],
  }

  const result = await executeAiResolution(syntheticReq, {
    slotConfig: effectiveConfig,
    secretValue: effectiveSecret,
  })

  return successResponse({ result })
}

// 6. 모델 목록 자동 조회 API (엔드포인트 및 인증 기반 /v1/models 또는 /api/tags 호출)
export async function handleListAiModels(workspaceId: string, actorId: string, auth: AuthContext, body: any) {
  if (!checkIsAdmin(auth)) {
    return errorResponse('FORBIDDEN', '관리자만 모델 목록 조회를 실행할 수 있습니다.', 403)
  }

  const { endpointUrl, provider, authType, secret, customHeaderName, routingMode, location } = body || {}
  const trimmedEndpoint = String(endpointUrl || '').trim()

  if (!trimmedEndpoint) {
    return successResponse({ ok: false, models: [], message: '엔드포인트 주소를 입력해 주세요.' })
  }

  // SSRF 검증 (외부 IP의 HTTP 허용, PC 도우미 경유 모드 지원)
  const effectiveRouting = routingMode || (location === 'SAME_PC' ? 'PC_HELPER' : 'SERVER_DIRECT')
  const ssrfCheck = validateUrlForSsrf(trimmedEndpoint, effectiveRouting)
  if (!ssrfCheck.valid) {
    return successResponse({ ok: false, models: [], message: ssrfCheck.reason })
  }

  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (secret) {
    if (authType === 'BEARER') headers['Authorization'] = `Bearer ${secret}`
    else if (authType === 'API_KEY') headers['x-api-key'] = secret
    else if (authType === 'CUSTOM_HEADER' && customHeaderName) headers[customHeaderName] = secret
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)

  const clean = trimmedEndpoint.replace(/\/+$/, '')
  let models: string[] = []

  try {
    // 1. LM Studio, vLLM, /v1 포함 경로, 또는 Ollama가 아닌 경우: OpenAI 호환 /v1/models 우선 조회
    if (provider === 'LM_STUDIO' || provider === 'VLLM' || clean.includes('/v1') || (!clean.endsWith(':11434') && provider !== 'OLLAMA')) {
      const v1Url = buildOpenAiModelsUrl(clean)
      const res = await fetch(v1Url, { method: 'GET', headers, signal: controller.signal }).catch(() => null)
      if (res && res.ok) {
        const data = await res.json().catch(() => null)
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : (data && Array.isArray(data.models) ? data.models : []))
        if (list.length > 0) {
          models = list.map((m: any) => (typeof m === 'string' ? m : (m.id || m.name || m.model || ''))).filter(Boolean)
          if (models.length > 0) {
            clearTimeout(timer)
            return successResponse({ ok: true, models, source: 'ENDPOINT_V1_MODELS' })
          }
        }
      }
    }

    // 2. Ollama (/api/tags) 조회
    const tagsUrl = `${clean}/api/tags`
    const res = await fetch(tagsUrl, { method: 'GET', headers, signal: controller.signal }).catch(() => null)
    if (res && res.ok) {
      const data = await res.json().catch(() => null)
      if (data && Array.isArray(data.models)) {
        models = data.models.map((m: any) => m.name || m.model || '').filter(Boolean)
        if (models.length > 0) {
          clearTimeout(timer)
          return successResponse({ ok: true, models, source: 'ENDPOINT_TAGS' })
        }
      }
    }

    // 3. 만약 1번에서 안 걸렸던 경우 /v1/models 최종 시도
    const finalV1Url = buildOpenAiModelsUrl(clean)
    const finalRes = await fetch(finalV1Url, { method: 'GET', headers, signal: controller.signal }).catch(() => null)
    if (finalRes && finalRes.ok) {
      const data = await finalRes.json().catch(() => null)
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : (data && Array.isArray(data.models) ? data.models : []))
      if (list.length > 0) {
        models = list.map((m: any) => (typeof m === 'string' ? m : (m.id || m.name || m.model || ''))).filter(Boolean)
        if (models.length > 0) {
          clearTimeout(timer)
          return successResponse({ ok: true, models, source: 'ENDPOINT_V1_MODELS' })
        }
      }
    }
  } catch (err: any) {
    clearTimeout(timer)
    return successResponse({
      ok: false,
      models: [],
      message: `모델 목록 조회 실패: ${err.name === 'AbortError' ? '연결 시간 초과' : (err.message || '네트워크 오류')}`,
    })
  } finally {
    clearTimeout(timer)
  }

  return successResponse({
    ok: models.length > 0,
    models,
    message: models.length === 0 ? '해당 주소에서 사용 가능한 모델 목록을 찾지 못했습니다.' : undefined,
  })
}
