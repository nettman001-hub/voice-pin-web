import type {
  AiResolutionRequest,
  AiResolutionResult,
  AiExecutionMeta,
} from '../../../../../src/types/aiResolution.ts';
import type { AiSlotConfig } from '../../../../../src/types/aiSettings.ts';
import { validateExternalEndpoint, safeFetch } from '../aiValidation.ts';
import { buildResolutionPrompt, parseAndNormalizeAiOutput, buildOpenAiChatUrl } from './common.ts';

export type HelperDispatcherFn = (
  endpointUrl: string,
  requestPayload: any,
  headers: Record<string, string>,
  timeoutMs: number
) => Promise<{ status: number; body: string }>;

export interface SelfHostedAdapterOptions {
  slotConfig: AiSlotConfig;
  secretValue?: string;
  helperDispatcher?: HelperDispatcherFn;
  allowInsecureHttpForExternal?: boolean;
}

/**
 * 자체 운영 LLM 어댑터 (Ollama, vLLM 등)
 * - 지원 위치: 같은 PC (SAME_PC), 내부망 (LAN), 외부 IP/도메인 서버 (EXTERNAL_IP)
 * - 호출 경로: SERVER_DIRECT (외부 서버 직접 호출), PC_HELPER (PC 도우미 경유)
 */
export async function runSelfHostedResolution(
  request: AiResolutionRequest,
  options: SelfHostedAdapterOptions
): Promise<AiResolutionResult> {
  const { slotConfig, secretValue, helperDispatcher, allowInsecureHttpForExternal } = options;
  const startTime = Date.now();

  const routingMode = slotConfig.routingMode || (slotConfig.location === 'EXTERNAL_IP' ? 'SERVER_DIRECT' : 'PC_HELPER');
  const location = slotConfig.location || 'SAME_PC';
  const timeoutMs = (slotConfig.timeoutSeconds || 20) * 1000;

  // 1. 엔드포인트 및 보안 검증
  const validation = validateExternalEndpoint({
    endpointUrl: slotConfig.endpointUrl,
    location,
    routingMode,
    authType: slotConfig.authType,
    hasSecret: slotConfig.hasSecret,
    secretValue,
    allowInsecureHttpForExternal,
  });

  if (!validation.valid) {
    const latencyMs = Date.now() - startTime;
    return {
      resolvable: false,
      targetSaleId: null,
      action: 'INSUFFICIENT_DATA',
      changes: null,
      evidenceIds: [],
      evidenceSummary: `자체 운영 LLM 엔드포인트 보안 검증 실패: ${validation.reason}`,
      missingInfo: [validation.reason || '보안 검증 실패'],
      conflictReason: '보안 정책 위반',
      execution: {
        adapterType: 'SELF_HOSTED',
        routingMode,
        location,
        provider: slotConfig.provider || 'OLLAMA',
        model: slotConfig.model || 'qwen2.5:7b',
        latencyMs,
      },
    };
  }

  // 2. 프롬프트 구성
  const { systemPrompt, userPrompt } = buildResolutionPrompt(request);

  // 3. 엔진별 API 엔드포인트 및 페이로드 구성 (Ollama vs vLLM/OpenAI 호환)
  let endpoint = slotConfig.endpointUrl.trim();
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (secretValue) {
    if (slotConfig.authType === 'BEARER') {
      headers['Authorization'] = `Bearer ${secretValue}`;
    } else if (slotConfig.authType === 'API_KEY') {
      headers['x-api-key'] = secretValue;
    } else if (slotConfig.authType === 'CUSTOM_HEADER' && slotConfig.customHeaderName) {
      headers[slotConfig.customHeaderName] = secretValue;
    }
  }

  let requestBody: any;
  const isOpenAiCompatible =
    slotConfig.provider === 'LM_STUDIO' ||
    slotConfig.provider === 'VLLM' ||
    slotConfig.provider === 'CUSTOM' ||
    endpoint.includes('/v1');

  if (isOpenAiCompatible) {
    endpoint = buildOpenAiChatUrl(endpoint);
    requestBody = {
      model: slotConfig.model || 'default',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    };
  } else {
    // Ollama 기본 규격 (/api/chat)
    if (!endpoint.endsWith('/api/chat')) {
      endpoint = endpoint.replace(/\/+$/, '') + '/api/chat';
    }
    requestBody = {
      model: slotConfig.model || 'qwen2.5:7b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      format: 'json',
      stream: false,
      options: {
        temperature: 0.1,
      },
    };
  }

  let rawResponseText = '';
  let tokenStats: { prompt?: number; completion?: number; total?: number } | undefined;

  try {
    // 4. 경로별 호출 실행
    if (routingMode === 'PC_HELPER') {
      // PC 도우미 경유: 도우미 디스패처가 제공된 경우 전달, 없으면 직접 로컬 fetch (로컬 테스트 및 도우미 내부 환경)
      if (helperDispatcher) {
        const helperRes = await helperDispatcher(endpoint, requestBody, headers, timeoutMs);
        if (helperRes.status >= 400) {
          throw new Error(`PC 도우미 경유 호출 오류 (HTTP ${helperRes.status}): ${helperRes.body}`);
        }
        rawResponseText = helperRes.body;
      } else {
        // 로컬 환경 또는 단위 테스트에서 직접 호출
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`로컬 LLM 응답 오류 (HTTP ${res.status}): ${errText}`);
        }
        rawResponseText = await res.text();
      }
    } else {
      // SERVER_DIRECT: 서버에서 직접 외부 IP/도메인 LLM 호출 (safeFetch로 SSRF 및 3xx 리디렉션 차단)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await safeFetch(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
        {
          routingMode: 'SERVER_DIRECT',
          location: 'EXTERNAL_IP',
          allowInsecureHttpForExternal,
        }
      );
      clearTimeout(timer);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`외부 서버 LLM 응답 오류 (HTTP ${res.status}): ${errText}`);
      }
      rawResponseText = await res.text();
    }

    // 5. 엔진 응답에서 순수 콘텐츠 추출
    const latencyMs = Date.now() - startTime;
    let contentToParse = rawResponseText;

    try {
      const parsedContainer = JSON.parse(rawResponseText);
      if (parsedContainer.message?.content) {
        // Ollama
        contentToParse = parsedContainer.message.content;
        if (parsedContainer.prompt_eval_count || parsedContainer.eval_count) {
          tokenStats = {
            prompt: parsedContainer.prompt_eval_count,
            completion: parsedContainer.eval_count,
            total: (parsedContainer.prompt_eval_count || 0) + (parsedContainer.eval_count || 0),
          };
        }
      } else if (parsedContainer.choices?.[0]?.message?.content) {
        // vLLM / OpenAI compatible
        contentToParse = parsedContainer.choices[0].message.content;
        if (parsedContainer.usage) {
          tokenStats = {
            prompt: parsedContainer.usage.prompt_tokens,
            completion: parsedContainer.usage.completion_tokens,
            total: parsedContainer.usage.total_tokens,
          };
        }
      }
    } catch {
      // raw text 자체를 파서로 전달
    }

    const executionMeta: AiExecutionMeta = {
      adapterType: 'SELF_HOSTED',
      routingMode,
      location,
      provider: slotConfig.provider,
      model: slotConfig.model,
      latencyMs,
      tokensUsed: tokenStats,
    };

    return parseAndNormalizeAiOutput(contentToParse, request, executionMeta);
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      resolvable: false,
      targetSaleId: null,
      action: 'INSUFFICIENT_DATA',
      changes: null,
      evidenceIds: [],
      evidenceSummary: `자체 운영 LLM 호출 실패: ${err.message || '네트워크 오류'}`,
      missingInfo: [err.message || 'LLM 호출 오류'],
      conflictReason: err.code || '추론 엔진 호출 실패',
      execution: {
        adapterType: 'SELF_HOSTED',
        routingMode,
        location,
        provider: slotConfig.provider,
        model: slotConfig.model,
        latencyMs,
        rawResponse: rawResponseText || err.message,
      },
    };
  }
}
