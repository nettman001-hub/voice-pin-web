import type {
  AiResolutionRequest,
  AiResolutionResult,
  AiExecutionMeta,
} from '../../../../../src/types/aiResolution.ts';
import type { AiSlotConfig } from '../../../../../src/types/aiSettings.ts';
import { safeFetch } from '../aiValidation.ts';
import { buildResolutionPrompt, parseAndNormalizeAiOutput } from './common.ts';

export interface CloudAdapterOptions {
  slotConfig: AiSlotConfig;
  secretApiKey: string;
}

/**
 * 클라우드 LLM 어댑터 (OpenAI, Anthropic, Google Gemini, DeepSeek, Custom)
 * - 서버 전용 비밀정보(secretApiKey)를 사용하여 서버 사이드에서만 호출
 * - 브라우저로는 API 키를 전송하지 않음
 */
export async function runCloudResolution(
  request: AiResolutionRequest,
  options: CloudAdapterOptions
): Promise<AiResolutionResult> {
  const { slotConfig, secretApiKey } = options;
  const startTime = Date.now();
  const provider = slotConfig.provider || 'OPENAI';
  const model = slotConfig.model || (provider === 'ANTHROPIC' ? 'claude-3-5-haiku-20241022' : provider === 'DEEPSEEK' ? 'deepseek-chat' : 'gpt-4o-mini');
  const timeoutMs = (slotConfig.timeoutSeconds || 15) * 1000;

  // 1. API 키 필수 검증
  if (!secretApiKey || !secretApiKey.trim()) {
    const latencyMs = Date.now() - startTime;
    return {
      resolvable: false,
      targetSaleId: null,
      action: 'INSUFFICIENT_DATA',
      changes: null,
      evidenceIds: [],
      evidenceSummary: `${provider} 클라우드 API 키가 서버에 등록되어 있지 않습니다.`,
      missingInfo: ['클라우드 API 키 누락'],
      conflictReason: '인증 정보 누락',
      execution: {
        adapterType: 'CLOUD',
        routingMode: 'SERVER_DIRECT',
        location: 'EXTERNAL_IP',
        provider,
        model,
        latencyMs,
      },
    };
  }

  // 2. 프롬프트 구성
  const { systemPrompt, userPrompt } = buildResolutionPrompt(request);

  // 3. 공급자별 엔드포인트 및 요청 바디 구성
  let url = (slotConfig.endpointUrl || '').trim();
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  let requestBody: any;

  if (provider === 'ANTHROPIC') {
    url = url || 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = secretApiKey.trim();
    headers['anthropic-version'] = '2023-06-01';
    requestBody = {
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 1024,
      temperature: 0.1,
    };
  } else if (provider === 'GOOGLE' || (provider as string) === 'GEMINI') {
    url = url || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = secretApiKey.trim();
    requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n[입력 데이터]\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    };
  } else {
    // OPENAI, DEEPSEEK, CUSTOM (OpenAI 규격)
    if (!url) {
      if (provider === 'DEEPSEEK') {
        url = 'https://api.deepseek.com/chat/completions';
      } else {
        url = 'https://api.openai.com/v1/chat/completions';
      }
    } else if (provider === 'DEEPSEEK') {
      const cleanUrl = url.replace(/\/+$/, '');
      if (cleanUrl === 'https://api.deepseek.com' || cleanUrl === 'https://api.deepseek.com/v1') {
        url = `${cleanUrl}/chat/completions`;
      }
    }

    headers['Authorization'] = `Bearer ${secretApiKey.trim()}`;
    headers['x-api-key'] = secretApiKey.trim();

    // DeepSeek 공식 문서 (https://api-docs.deepseek.com/):
    // deepseek-reasoner(R1) 모델은 temperature, top_p, response_format 파라미터를 지원하지 않습니다 (전송 시 HTTP 400 반환).
    const isDeepSeekReasoner = provider === 'DEEPSEEK' && model.includes('reasoner');

    if (isDeepSeekReasoner) {
      requestBody = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };
    } else {
      requestBody = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      };
    }
  }

  let rawResponseText = '';
  let tokenStats: { prompt?: number; completion?: number; total?: number } | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // safeFetch: SSRF 방지 및 HTTP 3xx 리디렉션 차단
    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      },
      {
        routingMode: 'SERVER_DIRECT',
        location: 'EXTERNAL_IP',
      }
    );
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`${provider} API 응답 오류 (HTTP ${res.status}): ${errText}`);
    }

    rawResponseText = await res.text();
    const latencyMs = Date.now() - startTime;
    let contentToParse = rawResponseText;

    try {
      const json = JSON.parse(rawResponseText);
      if (provider === 'ANTHROPIC') {
        contentToParse = json.content?.[0]?.text || '';
        if (json.usage) {
          tokenStats = {
            prompt: json.usage.input_tokens,
            completion: json.usage.output_tokens,
            total: (json.usage.input_tokens || 0) + (json.usage.output_tokens || 0),
          };
        }
      } else if (provider === 'GOOGLE') {
        contentToParse = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (json.usageMetadata) {
          tokenStats = {
            prompt: json.usageMetadata.promptTokenCount,
            completion: json.usageMetadata.candidatesTokenCount,
            total: json.usageMetadata.totalTokenCount,
          };
        }
      } else {
        // OpenAI / DeepSeek / Custom
        contentToParse = json.choices?.[0]?.message?.content || '';
        if (json.usage) {
          tokenStats = {
            prompt: json.usage.prompt_tokens,
            completion: json.usage.completion_tokens,
            total: json.usage.total_tokens,
          };
        }
      }
    } catch {
      // raw text
    }

    const executionMeta: AiExecutionMeta = {
      adapterType: 'CLOUD',
      routingMode: 'SERVER_DIRECT',
      location: 'EXTERNAL_IP',
      provider,
      model,
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
      evidenceSummary: `${provider} 클라우드 API 호출 실패: ${err.message || '네트워크 오류'}`,
      missingInfo: [err.message || '클라우드 API 호출 실패'],
      conflictReason: '클라우드 공급자 통신 오류',
      execution: {
        adapterType: 'CLOUD',
        routingMode: 'SERVER_DIRECT',
        location: 'EXTERNAL_IP',
        provider,
        model,
        latencyMs,
        rawResponse: rawResponseText || err.message,
      },
    };
  }
}
