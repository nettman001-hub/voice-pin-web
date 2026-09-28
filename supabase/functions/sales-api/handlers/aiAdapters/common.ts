import type {
  AiResolutionRequest,
  AiResolutionResult,
  AiStructuredChanges,
  AiExecutionMeta,
  AiResolutionAction,
  BuyerCorrectionChange,
  AmountCorrectionChange,
} from '../../../../../src/types/aiResolution.ts';

/**
 * 한국어 구어체 금액(소숫점 만원 단위 및 한글 숫자) 변환 헬퍼
 * 예: 0.9 -> 9000, 1.2 -> 12000, "1만 2천" -> 12000
 */
export function parseKoreanSpokenPrice(val: any): number | null {
  if (typeof val === 'number') {
    // 만약 0.1 ~ 99.9 사이의 소숫점 숫자라면 만원 단위일 가능성 (예: 1.2 -> 12000, 0.9 -> 9000)
    if (val > 0 && val < 100 && !Number.isInteger(val)) {
      return Math.round(val * 10000);
    }
    return val;
  }
  const s = String(val || '').trim();
  if (!s) return null;

  // 순수 숫자 (예: "12000", "9000")
  const numOnly = Number(s.replace(/,/g, ''));
  if (!isNaN(numOnly)) {
    if (numOnly > 0 && numOnly < 100 && s.includes('.')) {
      return Math.round(numOnly * 10000);
    }
    return numOnly;
  }

  // "1.2만", "1.2만원"
  const manMatch = s.match(/([\d.]+)\s*만\s*원?/);
  if (manMatch) {
    const n = parseFloat(manMatch[1]);
    if (!isNaN(n)) return Math.round(n * 10000);
  }

  // "일만 이천원", "구천원" 등은 기본 숫자 매칭 시도
  return null;
}

/**
 * 라이브 방송 구매 의사 표현 정규식 패턴 (src/services/commentNicknameVerifier.ts 기준)
 * "저요", "ㅈㅇ", "살게요", "주세요", "구매" 등
 */
export const PURCHASE_INTENT_PATTERN = /(저요|ㅈ\s*ㅇ|구매|살게요|살께요|주세요|주문|결제|입금|확정)/u;

/**
 * 프롬프트 생성 전 시청자 댓글 전처리:
 * - "보여주세요", "입어주세요", "알려주세요", "해주세요" 등 단순 문의/요청은 건드리지 않고 원문 보존
 * - "1번 주세요", "이거 주세요", "제가 살게요", "구매할게요", "ㅈㅇ" 등 순수 구매 의사 표현만 표준 형태인 "저요"로 통일 변환합니다.
 */
export function normalizeCommentIntentForPrompt(text?: string): string {
  if (!text) return '';
  let str = String(text).trim();

  // 1. 단순 요청형 어간(보여/입어/비춰/알려/해/답변/설명/확인 등) 체크
  const NON_PURCHASE_VERB_PREFIX = /(?:보여|입어|비춰|알려|해|답변|설명|확인|바꿔|틀어)\s*(?:주세요|주세용|주세여)/u;

  // 비구매 요청어가 아닐 때만 "주세요"를 안전하게 "저요"로 치환
  if (!NON_PURCHASE_VERB_PREFIX.test(str)) {
    // 1-1. 단독 "주세요" -> "저요"
    str = str.replace(/^(?:제가\s*)?(?:주세요|주세용|주세여)[!?.~]*$/u, '저요');

    // 1-2. 구매 목적어 결합형: "1번 주세요", "이거 주세요", "하나 주세요", "0517 주세요" -> "1번 저요", "이거 저요"
    str = str.replace(/(\b\d+번|\b이거|\b요거|\b그거|\b하나|\b1개|\b저|\b제게|\b\d{4})\s*(?:주세요|주세용|주세여)/gu, '$1 저요');
  }

  // 2. "제가 살게요/살께요", "살게요/살께요", "구매할게요/구매요" 등 -> "저요"
  str = str.replace(/(?:제가\s*)?(?:구매할게요|구매할께요|구매할게|구매할께|구매요|구매합니다)/gu, ' 저요 ');
  str = str.replace(/(?:제가\s*)?(?:살게요|살께요|살게|살께|살게요요)/gu, ' 저요 ');
  str = str.replace(/(?:제가\s*)?(?:할게요|할께요|할게|할께)/gu, ' 저요 ');

  // 3. 단독 또는 문장 내 초성 "ㅈㅇ", "ㅈ ㅇ", "ㅈ요" -> "저요"
  str = str.replace(/(?:^|\b|\s)ㅈ\s*ㅇ(?:\b|\s|$|[!?.~])/gu, ' 저요 ');
  str = str.replace(/^ㅈ\s*ㅇ$/u, '저요');
  str = str.replace(/^ㅈ요$/u, '저요');

  // 4. 중복된 "저요 저요" -> "저요" 하나로 정리 및 공백 정리
  str = str.replace(/(?:저요\s*)+/gu, '저요 ');

  return str.replace(/\s+/g, ' ').trim();
}

/**
 * AI에 전달할 시스템 프롬프트 및 사용자 프롬프트 생성
 */
export function buildResolutionPrompt(req: AiResolutionRequest): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `당신은 라이브 커머스 실시간 판매 방송의 "판매 보류 해결 및 음성 정정" 전문 분석 AI입니다.
판매자의 발화 문맥과 방송 댓글, 직전 판매 후보 목록을 면밀히 분석하여 정정 의도와 변경 대상 판매를 특정하고 JSON 규격으로 반환하십시오.

[엄격한 업무 규칙]
1. 음성 인식(STT) 오차 및 발음 차이 허용 (Fuzzy Nickname Matching):
   - 판매자의 헛발음이나 음성 인식(STT) 오인식으로 인해 1~2글자 받침/모음 차이가 발생할 수 있습니다. (예: 댓글 "마인드셋" ↔ 발화 "마일드셋", "마인셋", "마인드생")
   - 직전에 구매 의사("저요", "살게요", "ㅈㅇ" 등)를 밝힌 댓글 작성자가 존재하고 발음이나 철자가 매우 유사하다면 동일인으로 적극 매칭하여 UPDATE_SALE로 확정하십시오.
2. 구매자 정정 및 선행 의사표시 우선순위:
   - 시청자 댓글의 "저요", "ㅈㅇ", "주세요" 등은 라이브 커머스 구매 의사 표현입니다.
   - 판매자가 닉네임 뒷번호(예: "0517님")나 줄임말을 부른 경우, 직전에 구매 의사("저요" 등)를 남긴 댓글 작성자 중에서 해당 뒷번호나 닉네임이 일치하는 시청자를 최우선으로 매칭하십시오.
   - "xxx님이 아니시고 ooo님께 판매하겠습니다"의 경우, 기존 구매자(from: xxx)와 새 구매자(to: ooo)를 분리하고, 주어진 댓글/후보 목록에서 실제 ooo님의 고유 ID를 찾아 연결하십시오.
3. 상품명 특성:
   - 판매자는 방송 중 상품명을 직접 말하지 않습니다. 상품명은 시스템이 회차와 순번(001-YYYYMMDD-1회차)으로 자동 부여하므로 발화에서 상품명을 찾으려 하지 마십시오.
4. 금액 정정:
   - "0.9가 아니고 1.2입니다"는 기존 9,000원(from: 9000), 새 금액 12,000원(to: 12000)으로 해석하십시오. (소숫점 만원 단위 1.2 = 12000, 1.5 = 15000, 2.5 = 25000)
5. 부정 명령/질문 식별:
   - "변경하지 마세요", "~인가요?", "취소할게요" 등은 변경을 실행하지 말고 resolvable: false, action: "KEEP_PENDING" 또는 "CANCEL_CORRECTION"으로 처리하십시오.
6. 불완전한 발화(조각난 발화):
   - "0.9가 아니고..." 처럼 새 값이 완성되지 않고 끊긴 발화는 값을 임의로 추정하지 말고 resolvable: false, action: "KEEP_PENDING", missingInfo: ["정정 금액 미완성"]으로 처리하십시오.
7. 복수 후보 충돌:
   - 대상 구매자의 판매 후보가 2건 이상이고 발화에서 특정 상품번호나 시간 근거가 없으면, 임의로 선택하지 말고 targetSaleId: null, resolvable: false, conflictReason: "복수 판매 후보 존재 (지칭 근거 필요)", missingInfo: ["상품번호 누락"]으로 처리하십시오.
8. 없는 정보 생성 금지 (환각 금지):
   - 발화나 댓글에 전혀 근거가 없는 제3자의 닉네임이나 가격을 지어내지 마십시오. 근거가 부족하면 resolvable: false로 응답하십시오.
9. 후속 발화(followingUtterances) 문맥 분석:
   - 후속 발화가 함께 제공된 경우, 이전/현재 발화에서 끊기거나 미완성된 내용(금액 누락, 상품번호 추가, 닉네임 추가 등)을 보완하는 결정적 단서로 결합하여 분석하십시오.

반드시 다음 JSON 형식으로만 응답하십시오:
{
  "resolvable": boolean,
  "targetSaleId": string | null,
  "action": "UPDATE_SALE" | "CANCEL_CORRECTION" | "KEEP_PENDING" | "INSUFFICIENT_DATA",
  "changes": {
    "buyerNickname": { "from": "기존", "to": "새이름", "buyerId": "식별자" } | null,
    "amount": { "from": 9000, "to": 12000, "unitPrice": 12000, "quantity": 1 } | null,
    "productCode": { "from": "기존코드", "to": "새코드" } | null
  } | null,
  "evidenceIds": ["근거ID1", "근거ID2"],
  "evidenceSummary": "근거 설명 요약",
  "missingInfo": ["부족한 정보 항목"],
  "conflictReason": "충돌 사유(있을 경우만)" | null
}`;

  const normalizedFollowing = req.followingUtterances || (req.followingUtterance ? [{ text: req.followingUtterance }] : []);

  // ⭐️ 댓글 전처리: 초성 "ㅈㅇ" 등을 표준 "저요"로 정규화하여 프롬프트에 주입
  const processedComments = (req.relevantComments || []).slice(0, 10).map((c) => ({
    ...c,
    text: normalizeCommentIntentForPrompt(c.text),
  }));

  const userPrompt = JSON.stringify({
    currentUtterance: req.currentUtterance,
    priorUtterances: req.priorUtterances || [],
    followingUtterances: normalizedFollowing,
    relevantComments: processedComments,
    saleCandidates: req.saleCandidates || [],
    activeProduct: req.activeProduct || null,
    taskType: req.taskType,
  }, null, 2);

  return { systemPrompt, userPrompt };
}

/**
 * AI의 원시 텍스트 응답(JSON 문자열 또는 마크다운 코드블록)을 파싱하여 공통 AiResolutionResult 규격으로 정규화
 */
export function parseAndNormalizeAiOutput(
  rawText: string,
  req: AiResolutionRequest,
  meta: AiExecutionMeta
): AiResolutionResult {
  let cleaned = (rawText || '').trim();
  // 마크다운 ```json ... ``` 블록 제거
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // JSON 파싱 실패 시 휴리스틱 구문 파싱 또는 안전한 보류 결과 반환
    return {
      resolvable: false,
      targetSaleId: null,
      action: 'INSUFFICIENT_DATA',
      changes: null,
      evidenceIds: [],
      evidenceSummary: 'AI 응답 형식이 유효한 JSON이 아닙니다.',
      missingInfo: ['구조화된 JSON 응답 파싱 실패'],
      conflictReason: '응답 형식 불일치',
      execution: { ...meta, rawResponse: rawText },
    };
  }

  // 1. resolvable 판별
  let resolvable = Boolean(parsed.resolvable);

  // 2. targetSaleId
  let targetSaleId = parsed.targetSaleId || null;

  // 후보가 1건만 있을 때 LLM이 targetSaleId를 생략했더라도 특정 가능한 경우 자동 보정
  if (!targetSaleId && req.saleCandidates && req.saleCandidates.length === 1 && resolvable) {
    targetSaleId = req.saleCandidates[0].saleId;
  }

  // 3. action 정규화
  let action: AiResolutionAction = 'KEEP_PENDING';
  if (['UPDATE_SALE', 'CANCEL_CORRECTION', 'KEEP_PENDING', 'INSUFFICIENT_DATA'].includes(parsed.action)) {
    action = parsed.action;
  } else if (resolvable) {
    action = 'UPDATE_SALE';
  }

  // 4. changes 정규화
  let changes: AiStructuredChanges | null = null;
  if (parsed.changes && typeof parsed.changes === 'object') {
    changes = {};
    if (parsed.changes.buyerNickname) {
      changes.buyerNickname = {
        from: parsed.changes.buyerNickname.from ? String(parsed.changes.buyerNickname.from).trim() : undefined,
        to: parsed.changes.buyerNickname.to ? String(parsed.changes.buyerNickname.to).trim() : undefined,
        buyerId: parsed.changes.buyerNickname.buyerId ? String(parsed.changes.buyerNickname.buyerId).trim() : undefined,
      };
    }
    if (parsed.changes.amount) {
      const fromVal = parseKoreanSpokenPrice(parsed.changes.amount.from);
      const toVal = parseKoreanSpokenPrice(parsed.changes.amount.to);
      changes.amount = {
        from: fromVal !== null ? fromVal : undefined,
        to: toVal !== null ? toVal : undefined,
        unitPrice: parseKoreanSpokenPrice(parsed.changes.amount.unitPrice) || toVal || undefined,
        quantity: typeof parsed.changes.amount.quantity === 'number' ? parsed.changes.amount.quantity : 1,
      };
    }
    if (parsed.changes.productCode) {
      changes.productCode = {
        from: parsed.changes.productCode.from ? String(parsed.changes.productCode.from).trim() : undefined,
        to: parsed.changes.productCode.to ? String(parsed.changes.productCode.to).trim() : undefined,
      };
    }
  }

  // 5. 발화 검증 (부정 명령, 미완성 발화 룰 재확인)
  const utterance = (req.currentUtterance || '').trim();
  if (utterance.includes('변경하지 마세요') || utterance.includes('바꾸지 마세요')) {
    resolvable = false;
    action = 'KEEP_PENDING';
    changes = null;
  } else if (utterance.endsWith('아니고') || utterance.endsWith('아니고...') || utterance.endsWith('아니시고')) {
    // 새 값이 없는 끊긴 발화
    resolvable = false;
    action = 'KEEP_PENDING';
    changes = null;
    parsed.missingInfo = Array.from(new Set([...(parsed.missingInfo || []), '정정 금액 미완성']));
  }

  // 6. 후보 다수 존재 시 명확한 근거 없으면 보류 강제
  if (req.saleCandidates && req.saleCandidates.length > 1 && !targetSaleId) {
    resolvable = false;
    action = 'KEEP_PENDING';
    changes = null;
    if (!parsed.conflictReason) {
      parsed.conflictReason = '복수 판매 후보 존재 (지칭 근거 필요)';
    }
    parsed.missingInfo = Array.from(new Set([...(parsed.missingInfo || []), '상품번호 누락']));
  }

  return {
    resolvable,
    targetSaleId,
    action,
    changes,
    evidenceIds: Array.isArray(parsed.evidenceIds) ? parsed.evidenceIds.map(String) : [],
    evidenceSummary: String(parsed.evidenceSummary || ''),
    missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo.map(String) : [],
    conflictReason: parsed.conflictReason ? String(parsed.conflictReason) : null,
    execution: {
      ...meta,
      rawResponse: rawText,
    },
  };
}

/**
 * LM Studio / OpenAI 호환 모델 목록 조회 URL 생성
 * 예: http://nettman.iptime.org:1235/v1 -> http://nettman.iptime.org:1235/v1/models
 *     http://nettman.iptime.org:1235    -> http://nettman.iptime.org:1235/v1/models
 */
export function buildOpenAiModelsUrl(endpointUrl: string): string {
  const clean = (endpointUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/v1/models') || clean.endsWith('/models')) {
    return clean;
  }
  if (clean.endsWith('/chat/completions')) {
    return clean.replace(/\/chat\/completions$/, '/models');
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/models`;
  }
  return `${clean}/v1/models`;
}

/**
 * LM Studio / OpenAI 호환 채팅 추론 URL 생성
 * 예: http://nettman.iptime.org:1235/v1 -> http://nettman.iptime.org:1235/v1/chat/completions
 *     http://nettman.iptime.org:1235    -> http://nettman.iptime.org:1235/v1/chat/completions
 */
export function buildOpenAiChatUrl(endpointUrl: string): string {
  const clean = (endpointUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/v1/chat/completions') || clean.endsWith('/chat/completions')) {
    return clean;
  }
  if (clean.endsWith('/models')) {
    return clean.replace(/\/models$/, '/chat/completions');
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

