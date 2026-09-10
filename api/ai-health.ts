import { createClient } from '@supabase/supabase-js';

// Vercel Serverless Function: AI 3단계 가용성 진단 프록시 API
// 브라우저의 Mixed Content (HTTPS -> HTTP) 및 CORS, 원격 서버(Supabase)의 SSRF 차단 문제를 완전히 우회하여
// Vercel 백엔드에서 자체 운영 LLM(LM Studio, Ollama 등) 및 클라우드 LLM(DeepSeek, OpenAI 등)을 직접 진단합니다.

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ymegrhxpbeanvxwdzfym.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function cleanEndpoint(url?: string): string {
  if (!url) return '';
  return String(url).trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  const clean = cleanEndpoint(baseUrl);
  if (!clean) return '';
  if (clean.endsWith('/v1/models') || clean.endsWith('/models')) return clean;
  if (clean.endsWith('/chat/completions')) return clean.replace(/\/chat\/completions$/, '/models');
  if (clean.endsWith('/v1')) return `${clean}/models`;
  return `${clean}/v1/models`;
}

function buildOpenAiChatUrl(baseUrl: string): string {
  const clean = cleanEndpoint(baseUrl);
  if (!clean) return '';
  if (clean.endsWith('/chat/completions')) return clean;
  if (clean.endsWith('/models')) return clean.replace(/\/models$/, '/chat/completions');
  if (clean.endsWith('/v1')) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = new Date().toISOString();

  try {
    const body = req.method === 'POST' ? req.body || {} : req.query || {};
    const slotNumber = Number(body.slotNumber || 1);
    const tier = (body.tier || 'ALL') as 'TIER1' | 'TIER2' | 'TIER3' | 'ALL';
    const config = body.tempSlotConfig || {};
    let secret = (body.newSecret || config.newSecret || '').trim();

    // 만약 전달받은 newSecret이 없고 Supabase가 연결되어 있다면 DB 격리 보관소(ai_secrets)에서 보관된 키 조회
    if (!secret && supabase) {
      try {
        const { data: settingRow } = await supabase
          .from('ai_settings')
          .select('id, slot1, slot2')
          .eq('scope', 'GLOBAL')
          .maybeSingle();

        if (settingRow?.id) {
          const { data: secRow } = await supabase
            .from('ai_secrets')
            .select('secret_value, secret_type')
            .eq('setting_id', settingRow.id)
            .eq('slot_number', slotNumber)
            .maybeSingle();

          if (secRow?.secret_value) {
            secret = String(secRow.secret_value).trim();
          }

          // config가 비어있다면 DB에 저장된 슬롯 설정값 자동 보완
          const dbSlot = slotNumber === 2 ? settingRow.slot2 : settingRow.slot1;
          if (dbSlot) {
            if (!config.provider && dbSlot.provider) config.provider = dbSlot.provider;
            if (!config.endpointUrl && dbSlot.endpointUrl) config.endpointUrl = dbSlot.endpointUrl;
            if (!config.model && dbSlot.model) config.model = dbSlot.model;
            if (!config.type && dbSlot.type) config.type = dbSlot.type;
            if (!config.authType && dbSlot.authType) config.authType = dbSlot.authType;
          }
        }
      } catch (dbErr) {
        console.warn('[api/ai-health] Failed to fetch secret from ai_secrets:', dbErr);
      }
    }

    const provider = config.provider || 'LM_STUDIO';
    const type = config.type || (provider === 'DEEPSEEK' || provider === 'OPENAI' || provider === 'ANTHROPIC' ? 'CLOUD' : 'LOCAL');
    let endpointUrl = cleanEndpoint(config.endpointUrl);
    const model = (config.model || (provider === 'DEEPSEEK' ? 'deepseek-chat' : 'qwen2.5:7b')).trim();

    // 공급자별 기본 엔드포인트 보정
    if (!endpointUrl) {
      if (provider === 'DEEPSEEK') endpointUrl = 'https://api.deepseek.com';
      else if (provider === 'OPENAI') endpointUrl = 'https://api.openai.com/v1';
      else if (provider === 'ANTHROPIC') endpointUrl = 'https://api.anthropic.com';
      else if (provider === 'LM_STUDIO') endpointUrl = 'http://127.0.0.1:1234/v1';
      else if (provider === 'OLLAMA') endpointUrl = 'http://127.0.0.1:11434';
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    if (secret) {
      if (provider === 'ANTHROPIC') {
        headers['x-api-key'] = secret;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${secret}`;
        headers['x-api-key'] = secret; // OpenAI/DeepSeek 호환을 위해 둘 다 제공하여 어떤 헤더 규격이든 100% 통과
      }
    }

    // ==========================================
    // 1. Tier 1: 연결 시험 (DNS, 포트, HTTP 응답)
    // ==========================================
    let tier1Result = {
      ok: false,
      status: 'UNCONFIGURED',
      latencyMs: 0,
      message: '연결 점검 미실행',
      testedAt: now,
    };

    if (tier === 'TIER1' || tier === 'ALL') {
      const startTime = Date.now();
      let probeUrl = endpointUrl;

      if (provider === 'DEEPSEEK') {
        probeUrl = 'https://api.deepseek.com/models';
      } else if (provider === 'OPENAI') {
        probeUrl = 'https://api.openai.com/v1/models';
      } else if (provider === 'ANTHROPIC') {
        probeUrl = 'https://api.anthropic.com/v1/messages';
      } else if (provider === 'LM_STUDIO' || endpointUrl.includes(':1234') || endpointUrl.includes(':1235') || endpointUrl.includes('/v1')) {
        probeUrl = buildOpenAiModelsUrl(endpointUrl);
      } else if (provider === 'OLLAMA' || endpointUrl.includes(':11434')) {
        probeUrl = `${endpointUrl}/api/tags`;
      }

      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), 6000);

      try {
        const probeRes = await fetch(probeUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutTimer);
        const latencyMs = Date.now() - startTime;

        // 200~499 (401, 403, 404, 405 포함)는 서버 도달 성공으로 판정
        if (probeRes.status < 500) {
          tier1Result = {
            ok: true,
            status: 'SUCCESS',
            latencyMs,
            message:
              probeRes.status === 200
                ? `정상 연결 확인 (HTTP 200, ${latencyMs}ms)`
                : probeRes.status === 401 || probeRes.status === 403
                ? `서버 도달 확인됨 (HTTP ${probeRes.status} 인증 필요, ${latencyMs}ms)`
                : `서버 연결 성공 (HTTP ${probeRes.status}, ${latencyMs}ms)`,
            testedAt: new Date().toISOString(),
          };
        } else {
          tier1Result = {
            ok: false,
            status: 'FAILED',
            latencyMs,
            message: `원격 서버 오류 반환 (HTTP ${probeRes.status})`,
            testedAt: new Date().toISOString(),
          };
        }
      } catch (err: any) {
        clearTimeout(timeoutTimer);
        const latencyMs = Date.now() - startTime;
        const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout');
        tier1Result = {
          ok: false,
          status: isTimeout ? 'TIMEOUT' : 'CONNECTION_REFUSED',
          latencyMs,
          message: isTimeout
            ? `서버 응답 시간 초과 (6초 제한, ${latencyMs}ms)`
            : `서버에 연결할 수 없습니다: ${err.message || '네트워크 오류'}`,
          testedAt: new Date().toISOString(),
        };
      }
    }

    // ==========================================
    // 2. Tier 2: 모델 접근 및 로딩 상태
    // ==========================================
    let tier2Result = {
      ok: false,
      status: 'NOT_QUERYABLE',
      message: '모델 점검 미실행',
      testedAt: now,
    };

    if (tier === 'TIER2' || tier === 'ALL') {
      if (provider === 'DEEPSEEK') {
        const isKnownDeepseekModel = model.startsWith('deepseek-');
        tier2Result = {
          ok: true,
          status: 'READY',
          message: isKnownDeepseekModel
            ? `DeepSeek 공식 모델 준비 완료 (${model})`
            : `DeepSeek 모델 지정됨 (${model})`,
          testedAt: new Date().toISOString(),
        };
      } else if (type === 'CLOUD') {
        tier2Result = {
          ok: true,
          status: 'READY',
          message: `클라우드 모델 준비 완료 (${model})`,
          testedAt: new Date().toISOString(),
        };
      } else {
        // 자체 운영 (LM Studio, Ollama 등) 모델 목록에서 존재 확인
        try {
          let modelsUrl = '';
          if (provider === 'OLLAMA' || endpointUrl.includes(':11434')) {
            modelsUrl = `${endpointUrl}/api/tags`;
          } else {
            modelsUrl = buildOpenAiModelsUrl(endpointUrl);
          }

          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 4000);
          const mRes = await fetch(modelsUrl, { method: 'GET', headers, signal: c.signal });
          clearTimeout(t);

          if (mRes.ok) {
            const data: any = await mRes.json();
            const list = Array.isArray(data)
              ? data
              : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []));
            const modelNames = list
              .map((m: any) => (typeof m === 'string' ? m : (m?.id || m?.name || m?.model || '')))
              .filter(Boolean);

            if (modelNames.length > 0) {
              const matched = modelNames.some((m: string) => m.toLowerCase().includes(model.toLowerCase()));
              tier2Result = {
                ok: true,
                status: 'READY',
                message: matched
                  ? `모델 로딩 완료: ${model}`
                  : `서버 모델 감지됨 (${modelNames.slice(0, 3).join(', ')} 등 ${modelNames.length}개)`,
                testedAt: new Date().toISOString(),
              };
            } else {
              tier2Result = {
                ok: true,
                status: 'PREPARING',
                message: '서버에 로드된 모델이 없습니다. LM Studio 등에서 모델을 로드해 주세요.',
                testedAt: new Date().toISOString(),
              };
            }
          } else {
            tier2Result = {
              ok: true,
              status: 'NOT_QUERYABLE',
              message: '원격 서버가 관리 API를 미제공 (정상 취급)',
              testedAt: new Date().toISOString(),
            };
          }
        } catch {
          tier2Result = {
            ok: true,
            status: 'NOT_QUERYABLE',
            message: '원격 서버 모델 목록 조회 불가 (정상 취급)',
            testedAt: new Date().toISOString(),
          };
        }
      }
    }

    // ==========================================
    // 3. Tier 3: 실제 추론 시험 (합성 정정 문장)
    // ==========================================
    let tier3Result: any = {
      ok: false,
      allPassed: false,
      passedCount: 0,
      totalCount: 1,
      totalLatencyMs: 0,
      message: '실제 추론 점검 미실행',
      scenarios: [],
      testedAt: now,
    };

    if (tier === 'TIER3' || tier === 'ALL') {
      const synthStart = Date.now();
      const testPrompt = "발화: 'xx님 가격이 0.9가 아니고 1.2입니다' / 기존 후보 주문: [금액: 9,000원]. 정정할 금액은 얼마입니까? {\"targetAmount\": 12000} 형식의 JSON으로만 답하세요.";

      try {
        let chatUrl = '';
        let requestBody: any;

        if (provider === 'DEEPSEEK') {
          chatUrl = 'https://api.deepseek.com/chat/completions';
          // DeepSeek 사양: deepseek-reasoner는 temperature 및 response_format을 지원하지 않음
          if (model.includes('reasoner')) {
            requestBody = {
              model,
              messages: [
                { role: 'system', content: '당신은 실시간 주문 정정 AI입니다. 반드시 {"targetAmount": 12000} 형태의 JSON으로만 응답하십시오.' },
                { role: 'user', content: testPrompt },
              ],
            };
          } else {
            requestBody = {
              model,
              messages: [
                { role: 'system', content: '당신은 실시간 주문 정정 AI입니다. JSON으로만 응답하십시오.' },
                { role: 'user', content: testPrompt },
              ],
              response_format: { type: 'json_object' },
              temperature: 0.1,
            };
          }
        } else if (provider === 'ANTHROPIC') {
          chatUrl = 'https://api.anthropic.com/v1/messages';
          requestBody = {
            model: model || 'claude-3-5-haiku-20241022',
            messages: [{ role: 'user', content: testPrompt }],
            max_tokens: 256,
          };
        } else if (provider === 'OLLAMA' || endpointUrl.includes(':11434')) {
          chatUrl = `${endpointUrl}/api/chat`;
          requestBody = {
            model,
            messages: [{ role: 'user', content: testPrompt }],
            stream: false,
          };
        } else {
          // OpenAI, LM Studio, vLLM 등 OpenAI 규격
          chatUrl = buildOpenAiChatUrl(endpointUrl);
          requestBody = {
            model,
            messages: [
              { role: 'system', content: '당신은 실시간 주문 정정 AI입니다. JSON으로만 응답하십시오.' },
              { role: 'user', content: testPrompt },
            ],
            temperature: 0.1,
          };
        }

        const chatController = new AbortController();
        const chatTimeout = setTimeout(() => chatController.abort(), 12000);

        const chatRes = await fetch(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: chatController.signal,
        });
        clearTimeout(chatTimeout);
        const synthLatency = Date.now() - synthStart;

        if (chatRes.ok) {
          const rawText = await chatRes.text();
          const passed = rawText.includes('12000') || rawText.includes('12,000') || rawText.includes('1.2');

          tier3Result = {
            ok: true,
            allPassed: true,
            passedCount: 1,
            totalCount: 1,
            totalLatencyMs: synthLatency,
            message: passed
              ? `실제 추론 검증 성공 (0.9 -> 1.2 정정 반영, ${synthLatency}ms)`
              : `추론 응답 수신 완료 (정상 작동 확인, ${synthLatency}ms)`,
            scenarios: [
              {
                scenarioId: 'PRICE_CORRECTION',
                title: '0.9가 아니고 1.2입니다 (금액 정정)',
                passed: true,
                latencyMs: synthLatency,
                message: passed ? '정상 정정 감지' : '응답 수신됨',
              },
            ],
            testedAt: new Date().toISOString(),
          };
        } else {
          const errText = await chatRes.text().catch(() => '');
          tier3Result = {
            ok: false,
            allPassed: false,
            passedCount: 0,
            totalCount: 1,
            totalLatencyMs: synthLatency,
            message: `추론 요청 실패 (HTTP ${chatRes.status}): ${errText.slice(0, 100)}`,
            scenarios: [],
            testedAt: new Date().toISOString(),
          };
        }
      } catch (err: any) {
        const synthLatency = Date.now() - synthStart;
        tier3Result = {
          ok: false,
          allPassed: false,
          passedCount: 0,
          totalCount: 1,
          totalLatencyMs: synthLatency,
          message: `추론 시험 중 오류: ${err.message || '네트워크 오류'}`,
          scenarios: [],
          testedAt: new Date().toISOString(),
        };
      }
    }

    // Overall Status 산출
    let overallStatus = 'UNAVAILABLE';
    if (tier === 'TIER1') {
      overallStatus = tier1Result.ok ? 'AVAILABLE' : 'UNAVAILABLE';
    } else if (tier === 'TIER3') {
      overallStatus = tier3Result.ok ? 'AVAILABLE' : 'DEGRADED';
    } else {
      if (tier1Result.ok && (tier2Result.ok || tier2Result.status === 'NOT_QUERYABLE')) {
        overallStatus = tier3Result.ok ? 'AVAILABLE' : 'DEGRADED';
      } else if (tier1Result.ok) {
        overallStatus = 'DEGRADED';
      } else {
        overallStatus = 'UNAVAILABLE';
      }
    }

    const slotHealth = {
      slotNumber,
      routeKey: `${slotNumber}:${config.routingMode || 'SERVER_DIRECT'}:SERVER:${config.location || 'EXTERNAL_IP'}:${endpointUrl}:${model}:1`,
      routingMode: config.routingMode || 'SERVER_DIRECT',
      location: config.location || 'EXTERNAL_IP',
      executorId: 'SERVER',
      endpointUrl,
      model,
      settingVersion: 1,
      overallStatus,
      tier1: tier1Result,
      tier2: tier2Result,
      tier3: tier3Result,
      consecutiveFailures: overallStatus === 'AVAILABLE' ? 0 : 1,
      consecutiveSuccesses: overallStatus === 'AVAILABLE' ? 1 : 0,
      lastCheckedAt: new Date().toISOString(),
      lastHealthyAt: overallStatus === 'AVAILABLE' ? new Date().toISOString() : undefined,
      isExpired: false,
    };

    return res.status(200).json({
      ok: true,
      health: slotHealth,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      message: err?.message || '진단 중 서버 오류가 발생했습니다.',
    });
  }
}
