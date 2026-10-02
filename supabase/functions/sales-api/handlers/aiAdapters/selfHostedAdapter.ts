import type {
  AiResolutionRequest,
  AiResolutionResult,
  AiExecutionMeta,
} from '../../../../../src/types/aiResolution.ts';
import type { AiSlotConfig } from '../../../../../src/types/aiSettings.ts';
import type { AiPromptInput, AiPromptResult } from './promptTypes.ts';
import { validateExternalEndpoint, safeFetch } from '../aiValidation.ts';
import { buildResolutionPrompt, parseAndNormalizeAiOutput, buildOpenAiChatUrl } from './common.ts';
import { createConversationTraceRecorder, redactConversationSecrets, type ConversationTraceListener } from './conversationTrace.ts';

export type HelperDispatcherFn = (
  endpointUrl: string,
  requestPayload: any,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal
) => Promise<{ status: number; body: string }>;

export interface SelfHostedAdapterOptions {
  slotConfig: AiSlotConfig;
  secretValue?: string;
  helperDispatcher?: HelperDispatcherFn;
  allowInsecureHttpForExternal?: boolean;
  signal?: AbortSignal;
  onConversationTrace?: ConversationTraceListener;
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
  return await runSelfHostedCompletion(request, options) as AiResolutionResult;
}

export async function runSelfHostedPrompt(request: AiPromptInput, options: SelfHostedAdapterOptions): Promise<AiPromptResult> {
  if (options.slotConfig.routingMode === 'PC_HELPER' && !options.helperDispatcher) {
    return { content: null, error: '서버 분석에서 PC 도우미 연결을 사용할 수 없습니다. 대체 AI로 전환합니다.' };
  }
  const result = await runSelfHostedCompletion(request, options);
  return 'content' in result ? result : { content: null, error: result.evidenceSummary, execution: result.execution };
}

async function runSelfHostedCompletion(request: AiResolutionRequest | AiPromptInput, options: SelfHostedAdapterOptions): Promise<AiResolutionResult | AiPromptResult> {
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
  const { systemPrompt, userPrompt } = 'systemPrompt' in request ? request : buildResolutionPrompt(request);

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
      // LM Studio, vLLM 등 로컬/자체 호스팅 엔진은 'response_format.type' must be 'json_schema' or 'text' 오류를 내거나
      // response_format: { type: 'json_object' }를 지원하지 않으므로 제외합니다.
      // systemPrompt의 명확한 JSON 지시와 common.ts의 파서가 완벽히 파싱 및 정규화합니다.
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const trace = createConversationTraceRecorder({
    systemPrompt, userPrompt, provider: slotConfig.provider || 'OLLAMA', model: requestBody.model,
  }, options.onConversationTrace, [secretValue || '']);
  let responseStatus = 200;

  try {
    // 4. 경로별 호출 실행
    trace.dispatched();
    if (routingMode === 'PC_HELPER') {
      // PC 도우미 경유: 도우미 디스패처가 제공된 경우 전달, 없으면 직접 로컬 fetch (로컬 테스트 및 도우미 내부 환경)
      if (helperDispatcher) {
        const helperRes = await helperDispatcher(endpoint, requestBody, headers, timeoutMs, signal);
        responseStatus = helperRes.status;
        if (helperRes.status >= 400) {
          trace.received(helperRes.body, helperRes.status, 'HTTP_ERROR');
          throw new Error(`PC 도우미 경유 호출 오류 (HTTP ${helperRes.status}): ${helperRes.body}`);
        }
        rawResponseText = helperRes.body;
      } else {
        // 로컬 환경 또는 단위 테스트에서 직접 호출
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal,
        });
        responseStatus = res.status;
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          trace.received(errText, res.status, 'HTTP_ERROR');
          // 만약 response_format 관련 거부(400)일 경우, response_format 제거 후 1회 재시도
          if (res.status === 400 && requestBody?.response_format && errText.includes('response_format')) {
            delete requestBody.response_format;
            trace.dispatched();
            const retryRes = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              signal,
            });
            responseStatus = retryRes.status;
            if (retryRes.ok) {
              rawResponseText = await retryRes.text();
            } else {
              const retryErrText = await retryRes.text().catch(() => '');
              trace.received(retryErrText, retryRes.status, 'HTTP_ERROR');
              throw new Error(`로컬 LLM 응답 오류 (HTTP ${retryRes.status}): ${retryErrText}`);
            }
          } else {
            throw new Error(`로컬 LLM 응답 오류 (HTTP ${res.status}): ${errText}`);
          }
        } else {
          rawResponseText = await res.text();
        }
      }
    } else {
      // SERVER_DIRECT: 서버에서 직접 외부 IP/도메인 LLM 호출 (safeFetch로 SSRF 및 3xx 리디렉션 차단)
      let res = await safeFetch(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal,
        },
        {
          routingMode: 'SERVER_DIRECT',
          location: 'EXTERNAL_IP',
          allowInsecureHttpForExternal,
        }
      );
      responseStatus = res.status;
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        trace.received(errText, res.status, 'HTTP_ERROR');
        // 만약 response_format 관련 거부(400)일 경우, response_format 제거 후 1회 재시도
        if (res.status === 400 && requestBody?.response_format && errText.includes('response_format')) {
          delete requestBody.response_format;
          trace.dispatched();
          const retryRes = await safeFetch(
            endpoint,
            {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              signal,
            },
            {
              routingMode: 'SERVER_DIRECT',
              location: 'EXTERNAL_IP',
              allowInsecureHttpForExternal,
            }
          );
          responseStatus = retryRes.status;
          if (!retryRes.ok) {
            const retryErrText = await retryRes.text().catch(() => '');
            trace.received(retryErrText, retryRes.status, 'HTTP_ERROR');
            throw new Error(`외부 서버 LLM 응답 오류 (HTTP ${retryRes.status}): ${retryErrText}`);
          }
          rawResponseText = await retryRes.text();
        } else {
          throw new Error(`외부 서버 LLM 응답 오류 (HTTP ${res.status}): ${errText}`);
        }
      } else {
        rawResponseText = await res.text();
      }
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
    trace.received(typeof contentToParse === 'string' ? contentToParse : JSON.stringify(contentToParse), responseStatus, 'MODEL_OUTPUT');

    const executionMeta: AiExecutionMeta = {
      adapterType: 'SELF_HOSTED',
      routingMode,
      location,
      provider: slotConfig.provider,
      model: slotConfig.model,
      latencyMs,
      tokensUsed: tokenStats,
    };

    if ('systemPrompt' in request) return { content: redactConversationSecrets(String(contentToParse), [secretValue || '']), execution: executionMeta };
    return parseAndNormalizeAiOutput(contentToParse, request, executionMeta);
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const safeError = redactConversationSecrets(err.message || 'LLM 호출 오류', [secretValue || '']);
    return {
      resolvable: false,
      targetSaleId: null,
      action: 'INSUFFICIENT_DATA',
      changes: null,
      evidenceIds: [],
      evidenceSummary: `자체 운영 LLM 호출 실패: ${safeError}`,
      missingInfo: [safeError],
      conflictReason: signal.aborted ? 'TIMEOUT' : err.code || '추론 엔진 호출 실패',
      execution: {
        adapterType: 'SELF_HOSTED',
        routingMode,
        location,
        provider: slotConfig.provider,
        model: slotConfig.model,
        latencyMs,
        rawResponse: redactConversationSecrets(rawResponseText || safeError, [secretValue || '']),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
