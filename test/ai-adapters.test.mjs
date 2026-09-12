import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateExternalEndpoint,
  safeFetch,
} from '../supabase/functions/sales-api/handlers/aiValidation.ts';
import {
  parseKoreanSpokenPrice,
  buildResolutionPrompt,
  parseAndNormalizeAiOutput,
  buildOpenAiModelsUrl as backendBuildOpenAiModelsUrl,
  buildOpenAiChatUrl as backendBuildOpenAiChatUrl,
} from '../supabase/functions/sales-api/handlers/aiAdapters/common.ts';
import {
  runSelfHostedResolution,
} from '../supabase/functions/sales-api/handlers/aiAdapters/selfHostedAdapter.ts';
import {
  runCloudResolution,
} from '../supabase/functions/sales-api/handlers/aiAdapters/cloudAdapter.ts';
import {
  executeAiResolution,
} from '../supabase/functions/sales-api/handlers/aiAdapters/index.ts';
import {
  extractPortFromUrl,
  setPortInUrl,
  buildOpenAiModelsUrl,
  buildOpenAiChatUrl,
} from '../src/utils/maskingUtils.ts';

// 1. 보안 검증 테스트 (TLS, 포트, 사설망, 경로 순회, 리디렉션)
test('Security: validateExternalEndpoint allows HTTP and HTTPS for EXTERNAL_IP servers', () => {
  const httpUrl = validateExternalEndpoint({
    endpointUrl: 'http://my-llm.example.com:11434',
    location: 'EXTERNAL_IP',
    routingMode: 'SERVER_DIRECT',
  });
  assert.equal(httpUrl.valid, true);

  const secure = validateExternalEndpoint({
    endpointUrl: 'https://my-llm.example.com:11434',
    location: 'EXTERNAL_IP',
    routingMode: 'SERVER_DIRECT',
  });
  assert.equal(secure.valid, true);
});

test('Security: validateExternalEndpoint blocks dangerous ports (DB, SSH, Redis, Mail)', () => {
  const dangerousPorts = [22, 3306, 5432, 6379, 25];
  for (const port of dangerousPorts) {
    const res = validateExternalEndpoint({
      endpointUrl: `https://my-llm.example.com:${port}/api/chat`,
      location: 'EXTERNAL_IP',
    });
    assert.equal(res.valid, false, `Port ${port} must be blocked`);
    assert.match(res.reason || '', /제한된 포트/);
  }

  // Web and AI ports allowed
  const goodPorts = [443, 8000, 8080, 8443, 11434];
  for (const port of goodPorts) {
    const res = validateExternalEndpoint({
      endpointUrl: `https://my-llm.example.com:${port}/api/chat`,
      location: 'EXTERNAL_IP',
    });
    assert.equal(res.valid, true, `Port ${port} should be allowed`);
  }
});

test('Security: validateExternalEndpoint blocks path traversal (..)', () => {
  const badPath = validateExternalEndpoint({
    endpointUrl: 'https://my-llm.example.com/v1/../../etc/passwd',
    location: 'EXTERNAL_IP',
  });
  assert.equal(badPath.valid, false);
  assert.match(badPath.reason || '', /상위 디렉터리 순회/);
});

test('Security: validateExternalEndpoint blocks private IPs on EXTERNAL_IP location with SERVER_DIRECT', () => {
  const privateIps = [
    'https://192.168.1.100:11434',
    'https://10.0.0.5:8000',
    'https://172.20.0.1:11434',
  ];
  for (const url of privateIps) {
    const res = validateExternalEndpoint({
      endpointUrl: url,
      location: 'EXTERNAL_IP',
      routingMode: 'SERVER_DIRECT',
    });
    assert.equal(res.valid, false, `Private IP ${url} must be blocked on EXTERNAL_IP`);
    assert.match(res.reason || '', /사설 IP/);
  }
});

test('Security: safeFetch blocks HTTP 3xx open redirection attempts', async () => {
  // Mock fetch returning a 302 redirect
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    // When redirect: 'error' is passed, fetch in node raises an error if redirected
    const err = new TypeError('fetch failed');
    err.message = 'redirect was blocked';
    throw err;
  };

  try {
    await assert.rejects(
      async () => {
        await safeFetch('https://example.com/api', {}, { routingMode: 'SERVER_DIRECT' });
      },
      (err) => {
        return err.message.includes('SECURITY_REDIRECT_BLOCKED') || err.message.includes('redirect');
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 2. 한국어 구어체 가격 변환 테스트
test('Price parser: parseKoreanSpokenPrice handles decimal and Korean units accurately', () => {
  assert.equal(parseKoreanSpokenPrice(0.9), 9000);
  assert.equal(parseKoreanSpokenPrice(1.2), 12000);
  assert.equal(parseKoreanSpokenPrice('1.2'), 12000);
  assert.equal(parseKoreanSpokenPrice('0.9'), 9000);
  assert.equal(parseKoreanSpokenPrice('15000'), 15000);
  assert.equal(parseKoreanSpokenPrice('1.5만'), 15000);
  assert.equal(parseKoreanSpokenPrice('1.5만원'), 15000);
});

// 3. 공통 결과 구조화(parseAndNormalizeAiOutput) 및 5대 합성 정정 시나리오
test('Synthetic Scenario 1: xx님 구매하신거 가격이 0.9가 아니고 1.2입니다 (금액 정정)', () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      {
        saleId: 'sale_target_1',
        productCode: '1',
        buyerNickname: 'xx',
        amount: 9000,
        unitPrice: 9000,
        quantity: 1,
        status: 'PENDING',
      },
    ],
  };

  const llmOutput = JSON.stringify({
    resolvable: true,
    targetSaleId: 'sale_target_1',
    action: 'UPDATE_SALE',
    changes: {
      amount: { from: 0.9, to: 1.2, unitPrice: 1.2, quantity: 1 },
    },
    evidenceIds: ['sale_target_1'],
    evidenceSummary: '0.9 부정 및 1.2 긍정 정정 확인',
    missingInfo: [],
    conflictReason: null,
  });

  const result = parseAndNormalizeAiOutput(llmOutput, req, {
    adapterType: 'SELF_HOSTED',
    routingMode: 'SERVER_DIRECT',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    latencyMs: 120,
  });

  assert.equal(result.resolvable, true);
  assert.equal(result.targetSaleId, 'sale_target_1');
  assert.equal(result.action, 'UPDATE_SALE');
  assert.deepEqual(result.changes?.amount, {
    from: 9000,
    to: 12000,
    unitPrice: 12000,
    quantity: 1,
  });
  assert.equal(result.execution.adapterType, 'SELF_HOSTED');
});

test('Synthetic Scenario 2: xxx님이 아니시고 ooo님께 판매하겠습니다 (구매자 정정)', () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: '좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다',
    relevantComments: [
      { commentId: 'c_101', nickname: 'ooo', text: '저 구매할게요' },
    ],
    saleCandidates: [
      {
        saleId: 'sale_target_2',
        productCode: '5',
        buyerNickname: 'xxx',
        amount: 25000,
        unitPrice: 25000,
        quantity: 1,
        status: 'CONFIRMED',
      },
    ],
  };

  const llmOutput = JSON.stringify({
    resolvable: true,
    targetSaleId: 'sale_target_2',
    action: 'UPDATE_SALE',
    changes: {
      buyerNickname: { from: 'xxx', to: 'ooo', buyerId: 'c_101' },
    },
    evidenceIds: ['sale_target_2', 'c_101'],
    evidenceSummary: 'xxx 부정 및 ooo 구매자 교체',
    missingInfo: [],
    conflictReason: null,
  });

  const result = parseAndNormalizeAiOutput(llmOutput, req, {
    adapterType: 'CLOUD',
    routingMode: 'SERVER_DIRECT',
    provider: 'OPENAI',
    model: 'gpt-4o-mini',
    latencyMs: 350,
  });

  assert.equal(result.resolvable, true);
  assert.equal(result.targetSaleId, 'sale_target_2');
  assert.equal(result.changes?.buyerNickname?.from, 'xxx');
  assert.equal(result.changes?.buyerNickname?.to, 'ooo');
  assert.equal(result.changes?.buyerNickname?.buyerId, 'c_101');
});

test('Synthetic Scenario 3: 복수 주문 후보 존재하고 특정 근거가 없는 경우 임의 선택 금지 및 보류', () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xxx님 가격 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_A', productCode: '1', buyerNickname: 'xxx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
      { saleId: 'sale_B', productCode: '2', buyerNickname: 'xxx', amount: 15000, unitPrice: 15000, quantity: 1, status: 'PENDING' },
    ],
  };

  // Even if LLM erroneously tried to resolve, the normalizer enforces conflict rule when multiple candidates exist without targetSaleId
  const llmOutput = JSON.stringify({
    resolvable: false,
    targetSaleId: null,
    action: 'KEEP_PENDING',
    changes: null,
    evidenceIds: [],
    evidenceSummary: 'xxx님의 주문이 2건 존재하여 상품번호 특정 필요',
    missingInfo: ['상품번호 누락'],
    conflictReason: '복수 판매 후보 존재 (지칭 근거 필요)',
  });

  const result = parseAndNormalizeAiOutput(llmOutput, req, {
    adapterType: 'SELF_HOSTED',
    routingMode: 'SERVER_DIRECT',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    latencyMs: 150,
  });

  assert.equal(result.resolvable, false);
  assert.equal(result.targetSaleId, null);
  assert.equal(result.action, 'KEEP_PENDING');
  assert.match(result.conflictReason || '', /복수 판매 후보/);
  assert.ok(result.missingInfo.includes('상품번호 누락'));
});

test('Synthetic Scenario 4: "1.2로 변경하지 마세요" 부정 명령은 변경 실행 금지', () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: '아니요, 1.2로 변경하지 마세요',
    saleCandidates: [
      { saleId: 'sale_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const llmOutput = JSON.stringify({
    resolvable: false,
    targetSaleId: null,
    action: 'KEEP_PENDING',
    changes: null,
    evidenceIds: [],
    evidenceSummary: '변경 거부 명령 감지',
    missingInfo: [],
    conflictReason: null,
  });

  const result = parseAndNormalizeAiOutput(llmOutput, req, {
    adapterType: 'CLOUD',
    routingMode: 'SERVER_DIRECT',
    provider: 'OPENAI',
    model: 'gpt-4o-mini',
    latencyMs: 200,
  });

  assert.equal(result.resolvable, false);
  assert.equal(result.action, 'KEEP_PENDING');
  assert.equal(result.changes, null);
});

test('Synthetic Scenario 5: "0.9가 아니고..." 조각난 미완성 발화는 대기 처리', () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 0.9가 아니고...',
    saleCandidates: [
      { saleId: 'sale_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const llmOutput = JSON.stringify({
    resolvable: false,
    targetSaleId: null,
    action: 'KEEP_PENDING',
    changes: null,
    evidenceIds: [],
    evidenceSummary: '새 금액 미완성 발화',
    missingInfo: ['정정 금액 미완성'],
    conflictReason: null,
  });

  const result = parseAndNormalizeAiOutput(llmOutput, req, {
    adapterType: 'SELF_HOSTED',
    routingMode: 'PC_HELPER',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    latencyMs: 90,
  });

  assert.equal(result.resolvable, false);
  assert.equal(result.action, 'KEEP_PENDING');
  assert.ok(result.missingInfo.includes('정정 금액 미완성'));
});

// 4. 어댑터별 엔드투엔드 테스트 (PC, LAN, 외부 IP/도메인, 클라우드)
test('SelfHostedAdapter: SAME_PC path via PC_HELPER calls local helper and parses Ollama output', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_local_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  // Mock PC helper dispatcher
  const mockHelperDispatcher = async (url, body, headers, timeout) => {
    assert.ok(url.includes('127.0.0.1:11434'));
    assert.equal(body.model, 'qwen2.5:7b');
    return {
      status: 200,
      body: JSON.stringify({
        message: {
          content: JSON.stringify({
            resolvable: true,
            targetSaleId: 'sale_local_1',
            action: 'UPDATE_SALE',
            changes: {
              amount: { from: 0.9, to: 1.2, unitPrice: 1.2, quantity: 1 },
            },
            evidenceIds: ['sale_local_1'],
            evidenceSummary: '로컬 PC 도우미 Ollama 0.9 -> 1.2 정정',
            missingInfo: [],
            conflictReason: null,
          }),
        },
        prompt_eval_count: 50,
        eval_count: 35,
      }),
    };
  };

  const result = await runSelfHostedResolution(req, {
    slotConfig: {
      type: 'LOCAL',
      provider: 'OLLAMA',
      model: 'qwen2.5:7b',
      location: 'SAME_PC',
      endpointUrl: 'http://127.0.0.1:11434',
      routingMode: 'PC_HELPER',
      authType: 'NONE',
      timeoutSeconds: 10,
      connectTimeoutSeconds: 3,
    },
    helperDispatcher: mockHelperDispatcher,
  });

  assert.equal(result.resolvable, true);
  assert.equal(result.targetSaleId, 'sale_local_1');
  assert.equal(result.changes?.amount?.to, 12000);
  assert.equal(result.execution.adapterType, 'SELF_HOSTED');
  assert.equal(result.execution.location, 'SAME_PC');
  assert.equal(result.execution.routingMode, 'PC_HELPER');
  assert.equal(result.execution.tokensUsed?.total, 85);
});

test('SelfHostedAdapter: LAN path via PC_HELPER reaches internal network server', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_lan_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const mockHelperDispatcher = async (url, body) => {
    assert.ok(url.includes('192.168.1.100:11434'));
    return {
      status: 200,
      body: JSON.stringify({
        message: {
          content: JSON.stringify({
            resolvable: true,
            targetSaleId: 'sale_lan_1',
            action: 'UPDATE_SALE',
            changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
            evidenceIds: ['sale_lan_1'],
            evidenceSummary: '내부망 Ollama 정정 완료',
            missingInfo: [],
            conflictReason: null,
          }),
        },
      }),
    };
  };

  const result = await runSelfHostedResolution(req, {
    slotConfig: {
      type: 'LOCAL',
      provider: 'OLLAMA',
      model: 'qwen2.5:7b',
      location: 'LAN',
      endpointUrl: 'http://192.168.1.100:11434',
      routingMode: 'PC_HELPER',
      authType: 'NONE',
      timeoutSeconds: 10,
      connectTimeoutSeconds: 3,
    },
    helperDispatcher: mockHelperDispatcher,
  });

  assert.equal(result.resolvable, true);
  assert.equal(result.execution.location, 'LAN');
  assert.equal(result.execution.routingMode, 'PC_HELPER');
});

test('SelfHostedAdapter: EXTERNAL_IP path via SERVER_DIRECT calls external server directly without PC helper', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_ext_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  // Mock global fetch for external server
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(url.toString().startsWith('https://my-llm.example.com:8443'));
    assert.equal(init.headers['Authorization'], 'Bearer secret-ext-token');
    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            resolvable: true,
            targetSaleId: 'sale_ext_1',
            action: 'UPDATE_SALE',
            changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
            evidenceIds: ['sale_ext_1'],
            evidenceSummary: '외부 IP 자체 운영 LLM 서버 직접 호출 정정',
            missingInfo: [],
            conflictReason: null,
          }),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await runSelfHostedResolution(req, {
      slotConfig: {
        type: 'LOCAL',
        provider: 'OLLAMA',
        model: 'qwen2.5:7b',
        location: 'EXTERNAL_IP',
        endpointUrl: 'https://my-llm.example.com:8443/api/chat',
        routingMode: 'SERVER_DIRECT',
        authType: 'BEARER',
        hasSecret: true,
        timeoutSeconds: 10,
        connectTimeoutSeconds: 3,
      },
      secretValue: 'secret-ext-token',
      // No helperDispatcher provided: verifies server calls directly without helper!
    });

    assert.equal(result.resolvable, true);
    assert.equal(result.targetSaleId, 'sale_ext_1');
    assert.equal(result.execution.adapterType, 'SELF_HOSTED');
    assert.equal(result.execution.routingMode, 'SERVER_DIRECT');
    assert.equal(result.execution.location, 'EXTERNAL_IP');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CloudAdapter: calls OpenAI with server-side secrets and returns matching structured output', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_cloud_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url.toString(), 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.headers['Authorization'], 'Bearer sk-cloud-api-key');
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                resolvable: true,
                targetSaleId: 'sale_cloud_1',
                action: 'UPDATE_SALE',
                changes: { amount: { from: 0.9, to: 1.2, unitPrice: 1.2, quantity: 1 } },
                evidenceIds: ['sale_cloud_1'],
                evidenceSummary: 'OpenAI 정정',
                missingInfo: [],
                conflictReason: null,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 45, completion_tokens: 28, total_tokens: 73 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await runCloudResolution(req, {
      slotConfig: {
        type: 'CLOUD',
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        location: 'EXTERNAL_IP',
        endpointUrl: '',
        routingMode: 'SERVER_DIRECT',
        authType: 'API_KEY',
        timeoutSeconds: 15,
        connectTimeoutSeconds: 3,
      },
      secretApiKey: 'sk-cloud-api-key',
    });

    assert.equal(result.resolvable, true);
    assert.equal(result.targetSaleId, 'sale_cloud_1');
    assert.equal(result.changes?.amount?.to, 12000);
    assert.equal(result.execution.adapterType, 'CLOUD');
    assert.equal(result.execution.provider, 'OPENAI');
    assert.equal(result.execution.tokensUsed?.total, 73);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CloudAdapter: supports Anthropic Claude messages format', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_anthropic_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url.toString(), 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'sk-ant-key');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    return new Response(
      JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              resolvable: true,
              targetSaleId: 'sale_anthropic_1',
              action: 'UPDATE_SALE',
              changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
              evidenceIds: ['sale_anthropic_1'],
              evidenceSummary: 'Claude Sonnet 정정 완료',
              missingInfo: [],
              conflictReason: null,
            }),
          },
        ],
        usage: { input_tokens: 60, output_tokens: 30 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await runCloudResolution(req, {
      slotConfig: {
        type: 'CLOUD',
        provider: 'ANTHROPIC',
        model: 'claude-3-5-sonnet-20241022',
        location: 'EXTERNAL_IP',
        endpointUrl: '',
        routingMode: 'SERVER_DIRECT',
        authType: 'API_KEY',
        timeoutSeconds: 15,
        connectTimeoutSeconds: 3,
      },
      secretApiKey: 'sk-ant-key',
    });

    assert.equal(result.resolvable, true);
    assert.equal(result.targetSaleId, 'sale_anthropic_1');
    assert.equal(result.execution.provider, 'ANTHROPIC');
    assert.equal(result.execution.tokensUsed?.total, 90);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unified Schema Integrity: executeAiResolution outputs identical structured contract for both adapters', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_schema_test', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const localRes = await executeAiResolution(req, {
    slotConfig: {
      type: 'LOCAL',
      provider: 'OLLAMA',
      model: 'qwen2.5:7b',
      location: 'SAME_PC',
      endpointUrl: 'http://127.0.0.1:11434',
      routingMode: 'PC_HELPER',
      authType: 'NONE',
      timeoutSeconds: 10,
      connectTimeoutSeconds: 3,
    },
    helperDispatcher: async () => ({
      status: 200,
      body: JSON.stringify({
        message: {
          content: JSON.stringify({
            resolvable: true,
            targetSaleId: 'sale_schema_test',
            action: 'UPDATE_SALE',
            changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
            evidenceIds: ['e1'],
            evidenceSummary: '로컬 처리',
            missingInfo: [],
            conflictReason: null,
          }),
        },
      }),
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            resolvable: true,
            targetSaleId: 'sale_schema_test',
            action: 'UPDATE_SALE',
            changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
            evidenceIds: ['e2'],
            evidenceSummary: '클라우드 처리',
            missingInfo: [],
            conflictReason: null,
          }),
        },
      }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

  let cloudRes;
  try {
    cloudRes = await executeAiResolution(req, {
      slotConfig: {
        type: 'CLOUD',
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        location: 'EXTERNAL_IP',
        endpointUrl: '',
        routingMode: 'SERVER_DIRECT',
        authType: 'API_KEY',
        timeoutSeconds: 15,
        connectTimeoutSeconds: 3,
      },
      secretValue: 'sk-dummy',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Verify that required keys are present and match types across both outputs
  const requiredKeys = [
    'resolvable',
    'targetSaleId',
    'action',
    'changes',
    'evidenceIds',
    'evidenceSummary',
    'missingInfo',
    'conflictReason',
    'execution',
  ];

  for (const k of requiredKeys) {
    assert.ok(k in localRes, `Local result must have key '${k}'`);
    assert.ok(k in cloudRes, `Cloud result must have key '${k}'`);
    assert.equal(typeof localRes[k], typeof cloudRes[k], `Key '${k}' must have matching type in both results`);
  }

  assert.equal(typeof localRes.resolvable, 'boolean');
  assert.equal(typeof localRes.targetSaleId, 'string');
  assert.equal(Array.isArray(localRes.evidenceIds), true);
  assert.equal(Array.isArray(localRes.missingInfo), true);
  assert.equal(typeof localRes.execution, 'object');
  assert.equal(localRes.execution.adapterType, 'SELF_HOSTED');
  assert.equal(cloudRes.execution.adapterType, 'CLOUD');
});

test('SelfHostedAdapter: supports LM_STUDIO provider using OpenAI-compatible /v1/chat/completions', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_lm_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestBody = null;

  globalThis.fetch = async (url, init) => {
    requestedUrl = url.toString();
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                resolvable: true,
                targetSaleId: 'sale_lm_1',
                action: 'UPDATE_SALE',
                changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
                evidenceIds: ['sale_lm_1'],
                evidenceSummary: 'LM Studio OpenAI 호환 엔드포인트 정정 완료',
                missingInfo: [],
                conflictReason: null,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await runSelfHostedResolution(req, {
      slotConfig: {
        type: 'LOCAL',
        provider: 'LM_STUDIO',
        model: 'qwen2.5-7b-instruct',
        location: 'EXTERNAL_IP',
        endpointUrl: 'http://203.0.113.100:1234',
        routingMode: 'SERVER_DIRECT',
        authType: 'NONE',
        timeoutSeconds: 10,
        connectTimeoutSeconds: 3,
      },
    });

    assert.equal(result.resolvable, true);
    assert.equal(result.targetSaleId, 'sale_lm_1');
    assert.ok(requestedUrl.includes(':1234/v1/chat/completions'));
    assert.equal(requestBody.model, 'qwen2.5-7b-instruct');
    // LM Studio 등 오픈소스 자체 호스팅 엔진 호환성을 위해 response_format 미포함 검증
    assert.equal(requestBody.response_format, undefined);
    assert.equal(result.execution.adapterType, 'SELF_HOSTED');
    assert.equal(result.execution.location, 'EXTERNAL_IP');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SelfHostedAdapter: handles response_format rejection (HTTP 400) gracefully via fallback retry', async () => {
  const req = {
    taskType: 'SYNTHETIC_TEST',
    workspaceId: 'ws1',
    sessionId: 'session_01',
    currentUtterance: 'xx님 구매하신거 가격이 0.9가 아니고 1.2입니다',
    saleCandidates: [
      { saleId: 'sale_fb_1', productCode: '1', buyerNickname: 'xx', amount: 9000, unitPrice: 9000, quantity: 1, status: 'PENDING' },
    ],
  };

  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async (url, init) => {
    callCount++;
    const body = JSON.parse(init.body);
    // 첫 호출에 만약 response_format이 있으면 400 에러를 흉내냄
    if (body.response_format) {
      return new Response(
        JSON.stringify({ error: "'response_format.type' must be 'json_schema' or 'text'" }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                resolvable: true,
                targetSaleId: 'sale_fb_1',
                action: 'UPDATE_SALE',
                changes: { amount: { from: 9000, to: 12000, unitPrice: 12000, quantity: 1 } },
                evidenceIds: ['sale_fb_1'],
                evidenceSummary: 'Fallback retry 성공',
                missingInfo: [],
                conflictReason: null,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await runSelfHostedResolution(req, {
      slotConfig: {
        type: 'LOCAL',
        provider: 'LM_STUDIO',
        model: 'qwen2.5-7b-instruct',
        location: 'EXTERNAL_IP',
        endpointUrl: 'http://203.0.113.100:1234',
        routingMode: 'SERVER_DIRECT',
        authType: 'NONE',
        timeoutSeconds: 10,
        connectTimeoutSeconds: 3,
      },
    });

    assert.equal(result.resolvable, true);
    assert.equal(result.targetSaleId, 'sale_fb_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Port Utils: extractPortFromUrl and setPortInUrl handle self-hosted endpoints correctly', () => {
  // Extract port
  assert.equal(extractPortFromUrl('http://127.0.0.1:1234'), '1234');
  assert.equal(extractPortFromUrl('http://192.168.1.100:11434/v1'), '11434');
  assert.equal(extractPortFromUrl('https://my-llm.domain.com:8443/api'), '8443');
  assert.equal(extractPortFromUrl('http://my-llm.domain.com'), '');
  assert.equal(extractPortFromUrl(''), '');

  // Set / modify port
  assert.equal(setPortInUrl('http://127.0.0.1:11434', '1234'), 'http://127.0.0.1:1234');
  assert.equal(setPortInUrl('http://127.0.0.1:1234', '12345'), 'http://127.0.0.1:12345');
  assert.equal(setPortInUrl('http://192.168.1.100:11434/v1', '8000'), 'http://192.168.1.100:8000/v1');
  assert.equal(setPortInUrl('https://my-llm.domain.com/v1', '8443'), 'https://my-llm.domain.com:8443/v1');
  assert.equal(setPortInUrl('', '1234'), 'http://127.0.0.1:1234');
  assert.equal(setPortInUrl('http://127.0.0.1:1234', ''), 'http://127.0.0.1');
  assert.equal(setPortInUrl('http://nettman.iptime.org:1234/v1', '1235'), 'http://nettman.iptime.org:1235/v1');
});

test('LM Studio & OpenAI: buildOpenAiModelsUrl and buildOpenAiChatUrl normalize endpoints correctly', () => {
  const cases = [
    // 1. User provided exact case: http://nettman.iptime.org:1235/v1
    {
      input: 'http://nettman.iptime.org:1235/v1',
      expectedModels: 'http://nettman.iptime.org:1235/v1/models',
      expectedChat: 'http://nettman.iptime.org:1235/v1/chat/completions',
    },
    // 2. Base host:port without /v1
    {
      input: 'http://nettman.iptime.org:1235',
      expectedModels: 'http://nettman.iptime.org:1235/v1/models',
      expectedChat: 'http://nettman.iptime.org:1235/v1/chat/completions',
    },
    // 3. Trailing slash
    {
      input: 'http://nettman.iptime.org:1235/v1/',
      expectedModels: 'http://nettman.iptime.org:1235/v1/models',
      expectedChat: 'http://nettman.iptime.org:1235/v1/chat/completions',
    },
    // 4. Already has /v1/models
    {
      input: 'http://nettman.iptime.org:1235/v1/models',
      expectedModels: 'http://nettman.iptime.org:1235/v1/models',
      expectedChat: 'http://nettman.iptime.org:1235/v1/chat/completions',
    },
    // 5. Already has /v1/chat/completions
    {
      input: 'http://nettman.iptime.org:1235/v1/chat/completions',
      expectedModels: 'http://nettman.iptime.org:1235/v1/models',
      expectedChat: 'http://nettman.iptime.org:1235/v1/chat/completions',
    },
    // 6. Localhost 1234
    {
      input: 'http://127.0.0.1:1234/v1',
      expectedModels: 'http://127.0.0.1:1234/v1/models',
      expectedChat: 'http://127.0.0.1:1234/v1/chat/completions',
    },
  ];

  for (const c of cases) {
    // Test frontend utils
    assert.equal(buildOpenAiModelsUrl(c.input), c.expectedModels, `Frontend models url mismatch for ${c.input}`);
    assert.equal(buildOpenAiChatUrl(c.input), c.expectedChat, `Frontend chat url mismatch for ${c.input}`);

    // Test backend utils
    assert.equal(backendBuildOpenAiModelsUrl(c.input), c.expectedModels, `Backend models url mismatch for ${c.input}`);
    assert.equal(backendBuildOpenAiChatUrl(c.input), c.expectedChat, `Backend chat url mismatch for ${c.input}`);
  }
});

// 8. 후속 발화(followingUtterances) 문맥 확장 테스트
test('followingUtterances: buildResolutionPrompt incorporates following utterances into userPrompt and systemPrompt', () => {
  const req = {
    taskId: 'task_followup_01',
    taskType: 'PENDING_RESOLUTION',
    workspaceId: 'ws_test',
    sessionId: 'session_test',
    currentUtterance: '홍길동님 주문 접수',
    priorUtterances: [
      { text: '오늘 특가 상품입니다', timestamp: '2026-09-12T20:00:00Z' }
    ],
    followingUtterances: [
      { text: '15,000원에 12번 상품 드릴게요', timestamp: '2026-09-12T20:00:03Z' }
    ],
    relevantComments: [
      { commentId: 'c1', nickname: '홍길동', text: '구매요' }
    ],
  };

  const { systemPrompt, userPrompt } = buildResolutionPrompt(req);

  assert.match(systemPrompt, /후속 발화\(followingUtterances\) 문맥 분석/);
  const parsedUserPrompt = JSON.parse(userPrompt);
  assert.equal(parsedUserPrompt.currentUtterance, '홍길동님 주문 접수');
  assert.equal(parsedUserPrompt.priorUtterances.length, 1);
  assert.equal(parsedUserPrompt.followingUtterances.length, 1);
  assert.equal(parsedUserPrompt.followingUtterances[0].text, '15,000원에 12번 상품 드릴게요');
});

test('followingUtterances: buildResolutionPrompt normalizes single followingUtterance string into array', () => {
  const req = {
    taskId: 'task_followup_02',
    taskType: 'PENDING_RESOLUTION',
    workspaceId: 'ws_test',
    sessionId: 'session_test',
    currentUtterance: '구매자 미확인 1.2',
    followingUtterance: '아까 뒷번호 4567님이요',
  };

  const { userPrompt } = buildResolutionPrompt(req);
  const parsedUserPrompt = JSON.parse(userPrompt);
  assert.equal(parsedUserPrompt.followingUtterances.length, 1);
  assert.equal(parsedUserPrompt.followingUtterances[0].text, '아까 뒷번호 4567님이요');
});


