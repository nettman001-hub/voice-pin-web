// Vercel Serverless Function: AI 모델 목록 프록시 API
// 브라우저의 Mixed Content (HTTPS -> HTTP) 및 CORS 차단을 우회하여
// 외부 공인 IP/도메인의 자체 운영 LLM(LM Studio, Ollama, vLLM 등) 모델 목록을 안전하게 조회합니다.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const rawUrl = req.method === 'POST' ? req.body?.endpointUrl : req.query?.endpointUrl;
    const provider = (req.method === 'POST' ? req.body?.provider : req.query?.provider) || '';

    if (!rawUrl) {
      return res.status(400).json({ ok: false, models: [], message: 'endpointUrl 매개변수가 필요합니다.' });
    }

    const clean = String(rawUrl).trim().replace(/\/+$/, '');

    // LM Studio / OpenAI 규격 모델 목록 URL 생성
    let modelsUrl = '';
    if (clean.endsWith('/v1/models') || clean.endsWith('/models')) {
      modelsUrl = clean;
    } else if (clean.endsWith('/chat/completions')) {
      modelsUrl = clean.replace(/\/chat\/completions$/, '/models');
    } else if (clean.endsWith('/v1')) {
      modelsUrl = `${clean}/models`;
    } else {
      modelsUrl = `${clean}/v1/models`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const headers: Record<string, string> = { Accept: 'application/json' };
    const authType = req.method === 'POST' ? req.body?.authType : req.query?.authType;
    const secret = req.method === 'POST' ? req.body?.secret : req.query?.secret;
    const customHeader = req.method === 'POST' ? req.body?.customHeaderName : req.query?.customHeaderName;

    if (secret) {
      if (authType === 'BEARER') headers['Authorization'] = `Bearer ${secret}`;
      else if (authType === 'API_KEY') headers['x-api-key'] = secret;
      else if (authType === 'CUSTOM_HEADER' && customHeader) headers[customHeader] = secret;
    }

    let models: string[] = [];

    // 1. LM Studio / OpenAI 호환 (/v1/models) 최우선 조회
    try {
      const response = await fetch(modelsUrl, { method: 'GET', headers, signal: controller.signal });
      if (response.ok) {
        const data: any = await response.json();
        const list = Array.isArray(data)
          ? data
          : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []));
        models = list
          .map((m: any) => (typeof m === 'string' ? m : (m?.id || m?.name || m?.model || '')))
          .filter(Boolean);
      }
    } catch {
      // ignore and fallback
    }

    // 2. Ollama (/api/tags) 폴백
    if (models.length === 0) {
      try {
        const tagsUrl = `${clean}/api/tags`;
        const response = await fetch(tagsUrl, { method: 'GET', headers, signal: controller.signal });
        if (response.ok) {
          const data: any = await response.json();
          if (Array.isArray(data?.models)) {
            models = data.models
              .map((m: any) => (typeof m === 'string' ? m : (m?.name || m?.model || '')))
              .filter(Boolean);
          }
        }
      } catch {
        // ignore
      }
    }

    clearTimeout(timeout);

    return res.status(200).json({
      ok: models.length > 0,
      models,
      source: 'VERCEL_PROXY',
      message: models.length > 0 ? undefined : '지정된 엔드포인트에서 모델 목록을 찾지 못했습니다.',
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      models: [],
      message: err?.message || '모델 목록 프록시 요청 중 오류가 발생했습니다.',
    });
  }
}
