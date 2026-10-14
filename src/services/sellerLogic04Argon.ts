import type { CommentRecord } from "../types/comment";
import type { WorkflowTranscript } from "../types/salesWorkflow";
import type {
  SellerLogicDeepDecision,
  SellerLogicDeepInput,
} from "../types/sellerLogicDeep";
import { sellerLogicDeepPrompt } from "./sellerLogicDeepContract";

export interface ActiveProductSlot {
  orderCode?: string;
  productName?: string;
  unitPrice?: number;
  rawPrice?: string;
  stock: number;
  announcedAt: string;
  captureDirected: boolean;
  captureDirectedAt?: string;
  candidateComments: Array<{
    id: string;
    nickname: string;
    content: string;
    capturedAt: string;
  }>;
}

export interface ArgonExtendedDecision extends SellerLogicDeepDecision {
  rawPrice?: string;
  captureDirected?: boolean;
  captureDirectedAt?: string;
}

export interface ArgonDebugEntry {
  id: string;
  at: string;
  segmentId: string;
  status: "REQUEST" | "RESPONSE" | "ERROR";
  durationMs?: number;
  slotNumber: 1 | 2;
  provider?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  inputPayload: unknown;
  rawResponse?: unknown;
  parsedResponse?: unknown;
  error?: string;
  callSequence?: number;
  responseSequence?: number;
}

const KOREAN_NUM_MAP: Record<string, number> = {
  영: 0,
  공: 0,
  일: 1,
  하나: 1,
  이: 2,
  둘: 2,
  삼: 3,
  셋: 3,
  사: 4,
  넷: 4,
  오: 5,
  다섯: 5,
  육: 6,
  여섯: 6,
  칠: 7,
  일곱: 7,
  팔: 8,
  여덟: 8,
  구: 9,
  아홉: 9,
};

/**
 * 1.4, 0.8, 2.5 또는 한글 발음 "일점사", "일쩜사", "1점 4" 등을 감지해
 * 10,000을 곱한 원화(14,000원)와 원본 표기("1.4")를 반환합니다.
 */
export function parseDecimalPrice(
  text: string,
): { unitPrice: number; rawPrice: string } | null {
  if (!text) return null;

  // 1) 숫자 소수점 패턴: 1.4, 0.8, 2.5, 1점 4, 0쩜8 등
  const numDotMatch = text.match(
    /\b(\d+)\s*(?:\.|\s*점\s*|\s*쩜\s*)(\d+)\b/u,
  );
  if (numDotMatch) {
    const intPart = parseInt(numDotMatch[1], 10);
    const decPart = parseInt(numDotMatch[2], 10);
    if (intPart < 100 && decPart < 100) {
      const decValue = parseFloat(`${intPart}.${decPart}`);
      const unitPrice = Math.round(decValue * 10000);
      if (unitPrice > 0) {
        return {
          unitPrice,
          rawPrice: `${intPart}.${decPart}`,
        };
      }
    }
  }

  // 2) 한글 소수점 패턴: "일점사", "영쩜팔", "이점오", "공점팔"
  const koreanDotMatch = text.match(
    /([영공일이삼사오육칠팔구])\s*(?:점|쩜)\s*([영공일이삼사오육칠팔구])/u,
  );
  if (koreanDotMatch) {
    const intVal = KOREAN_NUM_MAP[koreanDotMatch[1]];
    const decVal = KOREAN_NUM_MAP[koreanDotMatch[2]];
    if (intVal !== undefined && decVal !== undefined) {
      const decValue = parseFloat(`${intVal}.${decVal}`);
      const unitPrice = Math.round(decValue * 10000);
      if (unitPrice > 0) {
        return {
          unitPrice,
          rawPrice: `${intVal}.${decVal}`,
        };
      }
    }
  }

  // 3) 일반 만원/원 단위 패턴: "14000원", "1만 4천원", "2만원"
  const tenThousandMatch = text.match(/(\d+)\s*만\s*(\d+)?(?:\s*천)?\s*원?/u);
  if (tenThousandMatch) {
    const man = parseInt(tenThousandMatch[1], 10) * 10000;
    const chun = tenThousandMatch[2] ? parseInt(tenThousandMatch[2], 10) * 1000 : 0;
    const total = man + chun;
    if (total > 0) {
      const rawPrice = (total / 10000).toString();
      return { unitPrice: total, rawPrice };
    }
  }

  const rawWonMatch = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원\b/u);
  if (rawWonMatch) {
    const total = parseInt(rawWonMatch[1].replace(/,/g, ""), 10);
    if (total >= 1000) {
      const rawPrice = (total / 10000).toString();
      return { unitPrice: total, rawPrice };
    }
  }

  return null;
}

/**
 * 멘트에서 상품 번호, 상품명, 재고 수량을 파싱합니다.
 */
export function parseProductAndStock(
  text: string,
): { orderCode?: string; stock?: number; productName?: string } {
  if (!text) return {};
  const result: { orderCode?: string; stock?: number; productName?: string } = {};

  // 상품 번호: "상품번호 1번", "1번 상품", "1번 입력", "0번", "0번.", "10,000원, 0번" 등
  const orderCodeMatch =
    text.match(/(?:상품\s*번호\s*|번호\s*|이번\s*상품\s*|선착순\s*)(\d+)\s*번/u) ||
    text.match(/\b(\d+)\s*번\s*(?:상품|올려|입력|드릴|갈게|가요|입니다|이에요|으로|로)/u) ||
    text.match(/(?:^|[,\s])(\d+)\s*번(?:[.\s!?,]|$)/u);

  if (orderCodeMatch) {
    result.orderCode = orderCodeMatch[1];
  } else {
    const koreanOrderMatch = text.match(
      /(?:^|[,\s])(영|공|일|이|삼|사|오|육|칠|팔|구)\s*번(?:[.\s!?,]|$)/u,
    );
    if (koreanOrderMatch) {
      result.orderCode = String(KOREAN_NUM_MAP[koreanOrderMatch[1]]);
    }
  }

  // 재고 수량: "2개 있습니다", "2개 남았", "수량 2개", "단 2분", "선착순 2명", "1장밖에"
  const stockMatch = text.match(/(\d+)\s*(?:개|장|벌|벌씩|분|명)\s*(?:남았|있습|가능|준비|선착)/u) ||
    text.match(/(?:수량|재고)\s*(\d+)\s*(?:개|장|벌|분|명)?/u);

  if (stockMatch) {
    result.stock = parseInt(stockMatch[1], 10);
  } else if (/단\s*하나|하나밖에|한\s*장밖에|단\s*1개/u.test(text)) {
    result.stock = 1;
  }

  return result;
}

/**
 * 판매자의 캡처 지시 멘트를 감지합니다.
 * "캡처하세요", "캡처해 주세요", "캡처 부탁드려요", "화면 캡처", "캡쳐하세요"
 */
export function detectCaptureInstruction(text: string): boolean {
  if (!text) return false;
  return /(?:캡처|캡쳐)\s*(?:하세요|해\s*주세요|부탁|뜨세요|뜰게요|타임|할게요|해줘)/u.test(
    text,
  );
}

/**
 * 판매자 발화에서 호명된 닉네임들을 분리 추출합니다.
 * 예: "샤넬님, 루비님께 드릴게요" -> ['샤넬', '루비']
 * 예: "샤넬 언니 루비 언니 확정" -> ['샤넬', '루비']
 * 예: "아, 보석 언니 줄게" -> ['보석']
 */
export function extractSpokenNicknames(text: string): string[] {
  if (!text) return [];
  const matches: string[] = [];

  // 호칭 접미사 패턴: 님, 언니, 분, 고객님
  const namePattern = /([가-힣a-zA-Z0-9_\-\.]{2,15})\s*(?:님|언니|고객님|분)(?:[,\s]+([가-힣a-zA-Z0-9_\-\.]{2,15})\s*(?:님|언니|고객님|분))*/gu;
  let match: RegExpExecArray | null;

  while ((match = namePattern.exec(text)) !== null) {
    const rawChunk = match[0];
    const subNames = rawChunk.split(/[,/&\s와과랑]+/u);
    for (const sub of subNames) {
      const cleaned = sub.replace(/(?:님|언니|고객님|분)$/u, "").trim();
      if (cleaned.length >= 2 && !["우리", "이번", "다음", "어떤", "구매", "선착"].includes(cleaned)) {
        if (!matches.includes(cleaned)) matches.push(cleaned);
      }
    }
  }

  return matches;
}

/**
 * 판매자 발화에서 특정 닉네임에 대한 배정/확정 발화가 있는지 판별합니다.
 * 격식체("드릴게요", "확정")뿐만 아니라 구어체/반말("~줄게", "~준다", "~꺼", "~갈게", "~가요", "~드려", "~가져가", "~빼놔", "~낙찰")을 모두 감지합니다.
 */
export function detectAllocationSpeech(
  text: string,
  nickname: string,
): { allocated: boolean; matchedPhrase?: string } {
  if (!text || !nickname) return { allocated: false };

  const escapedName = nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 1) [닉네임] (언니|님|분|고객님)? (아무말 0~8글자) (줄게|줄게요|준다|꺼|것|갈게|갈게요|가요|드려|드림|가져가|빼놔|빼드|낙찰|확정|드릴)
  const pattern = new RegExp(
    `${escapedName}(?:\\s*(?:님|언니|분|고객님))?[^.!?\\n]{0,8}(?:줄게|줄게요|준다|꺼|것|갈게|갈게요|가요|드려|드림|가져가|빼놔|빼드|낙찰|확정|드릴)`,
    "u",
  );

  const m = text.match(pattern);
  if (m) {
    return { allocated: true, matchedPhrase: m[0] };
  }

  // 2) 반대 순서: "줄게 보석 언니", "드릴게요 보석님"
  const reversePattern = new RegExp(
    `(?:줄게|줄게요|준다|드릴게요|드려요)\\s*${escapedName}(?:\\s*(?:님|언니|분|고객님))?`,
    "u",
  );
  const revM = text.match(reversePattern);
  if (revM) {
    return { allocated: true, matchedPhrase: revM[0] };
  }

  return { allocated: false };
}

/**
 * 현재 대화 흐름을 바탕으로 활성 상품 슬롯과 후보 대기열 상태를 갱신합니다.
 */
export function updateActiveProductContext(
  currentSlot: ActiveProductSlot | null,
  transcripts: WorkflowTranscript[],
  comments: CommentRecord[],
): ActiveProductSlot | null {
  let slot: ActiveProductSlot | null = currentSlot ? { ...currentSlot } : null;

  // 판매자 멘트 분석 (최근 멘트 순회)
  for (const t of transcripts) {
    const priceInfo = parseDecimalPrice(t.text);
    const prodInfo = parseProductAndStock(t.text);
    const isCapture = detectCaptureInstruction(t.text);

    if (prodInfo.orderCode || priceInfo) {
      // 새로운 상품이 시작되었거나 정보가 갱신된 경우
      if (!slot || (prodInfo.orderCode && prodInfo.orderCode !== slot.orderCode)) {
        slot = {
          orderCode: prodInfo.orderCode || slot?.orderCode,
          productName: prodInfo.productName || slot?.productName,
          unitPrice: priceInfo?.unitPrice ?? slot?.unitPrice,
          rawPrice: priceInfo?.rawPrice ?? slot?.rawPrice,
          stock: prodInfo.stock ?? 1,
          announcedAt: t.recognizedAt,
          captureDirected: isCapture,
          captureDirectedAt: isCapture ? t.recognizedAt : undefined,
          candidateComments: [],
        };
      } else {
        if (priceInfo) {
          slot.unitPrice = priceInfo.unitPrice;
          slot.rawPrice = priceInfo.rawPrice;
        }
        if (prodInfo.stock) slot.stock = prodInfo.stock;
        if (prodInfo.productName) slot.productName = prodInfo.productName;
        if (isCapture) {
          slot.captureDirected = true;
          slot.captureDirectedAt = t.recognizedAt;
        }
      }
    } else if (isCapture && slot) {
      slot.captureDirected = true;
      slot.captureDirectedAt = t.recognizedAt;
    }
  }

  if (!slot) return null;

  // 댓글 후보자 풀(선착순 대기열) 적재: 상품번호 일치 또는 구매의사 댓글
  const targetCode = slot.orderCode;
  const candidates: ActiveProductSlot["candidateComments"] = [];

  for (const c of comments) {
    const content = c.content.trim();
    let isMatch = false;

    if (targetCode !== undefined && targetCode !== null && targetCode !== "") {
      // "0", "0번", "0번 저요", "0 저요", "공", "영"
      const escapedCode = targetCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const codeRegex = new RegExp(`^${escapedCode}(?:번)?(?:\\s*(?:저요|구매|찜|주세요))?$`, "u");
      if (codeRegex.test(content) || content === targetCode || content === `${targetCode}번`) {
        isMatch = true;
      }
      if (targetCode === "0" && /^(?:영|공)(?:번)?$/u.test(content)) {
        isMatch = true;
      }
    }

    // 단일 재고이거나 특정 상품일 때 '저요', '구매' 댓글
    if (!isMatch && /(?:저요|구매|찜|ㅈㅇ|저여|주세요)/u.test(content)) {
      isMatch = true;
    }

    if (isMatch && !candidates.some((existing) => existing.nickname === c.nickname)) {
      candidates.push({
        id: c.id,
        nickname: c.nickname,
        content: c.content,
        capturedAt: c.capturedAt,
      });
    }
  }

  slot.candidateComments = candidates;
  return slot;
}

/**
 * AI가 PENDING으로 판정했거나 아직 미확정 상태인 건 중,
 * 판매자의 구어체 배정 멘트("보석 언니 줄게", "~꺼", "~준다" 등)가 존재하고
 * 구매자의 신청 댓글과 가격이 확인된 경우 CONFIRMED로 자동 승격 보정합니다.
 */
export function promoteArgonDecisions(
  decisions: SellerLogicDeepDecision[],
  transcripts: WorkflowTranscript[],
  comments: CommentRecord[],
  activeProduct: ActiveProductSlot | null,
): SellerLogicDeepDecision[] {
  const resultDecisions: SellerLogicDeepDecision[] = decisions.map((d) => {
    // 이미 확정된 건이거나 취소 건은 그대로 유지
    if (d.status === "CONFIRMED" || d.status === "CANCELLED") {
      return d;
    }

    const nickname = d.nickname;
    if (!nickname) return d;

    // 해당 닉네임에 대한 판매자 배정 발화 검색
    let matchedAllocation: string | undefined;
    let matchedTranscriptId: string | undefined;
    for (const t of transcripts) {
      const check = detectAllocationSpeech(t.text, nickname);
      if (check.allocated) {
        matchedAllocation = check.matchedPhrase || t.text;
        matchedTranscriptId = t.id;
        break;
      }
    }

    if (!matchedAllocation) return d;

    // 가격 및 상품번호 보강
    let unitPrice = d.unitPrice;
    if (!unitPrice && activeProduct?.unitPrice) {
      unitPrice = activeProduct.unitPrice;
    }

    let orderCode = d.orderCode;
    if (!orderCode && activeProduct?.orderCode) {
      orderCode = activeProduct.orderCode;
    }

    const transcriptIds = [...d.transcriptIds];
    if (matchedTranscriptId && !transcriptIds.includes(matchedTranscriptId)) {
      transcriptIds.push(matchedTranscriptId);
    }

    return {
      ...d,
      status: "CONFIRMED" as const,
      unitPrice: unitPrice ?? 10000,
      orderCode: orderCode || d.orderCode || "0",
      transcriptIds,
      reason: `${d.reason ? `${d.reason} -> ` : ""}판매자 구어체 배정 발화("${matchedAllocation}") 감지로 확정(CONFIRMED) 승격`,
    };
  });

  // AI가 decisions 배열에서 완전히 누락시킨 경우 대비:
  // 판매자 발화에서 호명된 닉네임 중 신청 댓글이 있고 미등록된 구매자가 있다면 추가
  for (const t of transcripts) {
    const spokenNames = extractSpokenNicknames(t.text);
    for (const spokenName of spokenNames) {
      const check = detectAllocationSpeech(t.text, spokenName);
      if (!check.allocated) continue;

      // 이미 decisions에 있는 닉네임인지 확인
      const alreadyIn = resultDecisions.some(
        (rd) => rd.nickname === spokenName && rd.status === "CONFIRMED",
      );
      if (alreadyIn) continue;

      // 신청 댓글이 있는지 확인
      const userComment = comments.find((c) => c.nickname === spokenName);
      if (!userComment) continue;

      // 신규 확정 등록
      resultDecisions.push({
        id: `auto-alloc-${Date.now()}-${spokenName}`,
        status: "CONFIRMED",
        nickname: spokenName,
        spokenNickname: spokenName,
        orderCode: activeProduct?.orderCode || "0",
        productName: activeProduct?.productName,
        unitPrice: activeProduct?.unitPrice ?? 10000,
        quantity: 1,
        reason: `판매자 구어체 배정 발화("${check.matchedPhrase || t.text}") 및 신청 댓글("${userComment.content}") 기반 자동 확정`,
        commentIds: [userComment.id],
        transcriptIds: [t.id],
        decidedAt: t.recognizedAt || new Date().toISOString(),
      });
    }
  }

  return resultDecisions;
}

/**
 * 04argon 전용 프롬프트와 인풋을 생성합니다.
 * 기존 sellerLogicDeepPrompt 위에 판매자별 다중 판매방식 규칙(소수점 1.4->14000원, 다중 호명, 캡처 지시, 활성 상품 문맥)을 주입합니다.
 */
export function buildArgonPromptWithContext(
  input: SellerLogicDeepInput,
  activeProduct: ActiveProductSlot | null,
) {
  const basePrompt = sellerLogicDeepPrompt(input);

  // 시스템 프롬프트에 04argon 특화 지침 추가 주입
  const argonRules = `
[판매자 로직분석 04argon 다중 판매방식 특화 지침]:
1. [소수점 가격 1.4 -> 14,000원 자동 환산 규칙]:
   - 판매자가 "1.4", "0.8", "2.5" 또는 "일점사", "일쩜사", "1점 4"처럼 소수점으로 말한 가격은 만원 단위 소수점이므로 반드시 10,000을 곱해 원화 정수(예: 1.4 -> 14000, 0.8 -> 8000, 2.5 -> 25000)로 기록하세요.
   - 직전 발화에서 이미 가격(예: "1.4", "10,000원")이나 상품번호(예: "0번", "1번")를 안내한 경우, 시간차를 두고 닉네임만 호명하더라도 직전 상품 슬롯의 가격과 번호를 자동 연결하세요.

2. [복수 재고 & 상품번호 댓글 후 다중 호명 확정 방식]:
   - 판매자가 "상품번호 1번 댓글 달아주세요", "재고 2개 있습니다"라고 한 뒤 구매자들이 "1", "1번" 댓글을 달고, 판매자가 "XXX님, OOO님 드릴게요"처럼 한 문장에 복수 닉네임을 호명하면, 호명된 닉네임들을 각각 분리하여 각각 별도의 CONFIRMED 거래(2건)로 분리해 확정하세요.

3. [단일 재고 & '저요' 댓글 후 단일 호명 확정 방식]:
   - 상품이 1개일 때 고객이 "저요", "구매", "찜"을 달고 판매자가 해당 닉네임을 호명하며 배정하면 CONFIRMED로 확정하세요.

4. [제품 캡처 지시("캡처하세요") 식별]:
   - 판매자가 "캡처하세요", "캡처해 주세요", "캡처 뜨세요"라고 말하면 캡처 요청 상태를 인식하고 reason에 [캡처 지시 감지]를 명시하세요.

5. [구어체/반말 배정 표현 "~줄게", "~준다", "~꺼", "~갈게" 100% 확정 규칙]:
   - 판매자가 "아, 보석 언니 줄게", "보석 언니 줄게요", "보석 언니 꺼", "보석 언니 준다", "보석 언니 갈게요", "보석 언니 드려", "보석 언니 하나 가져가"처럼 친근한 구어체나 반말로 배정한 것은 정형화된 "드릴게요", "확정입니다"와 동일한 100% 명확한 판매자 배정 확정(SELLER_ALLOCATE)입니다!
   - 고객이 해당 상품 주문 댓글("0", "0번", "1", "저요" 등)을 작성했고 판매자가 해당 닉네임과 함께 "~줄게", "~꺼", "~준다" 등의 배정 발화를 한 경우, 절대로 PENDING으로 보류하지 말고 반드시 CONFIRMED(판매 확정)로 판정하세요.
   - 판매자가 "0번", "0번입니다", "10,000원, 0번"이라고 안내했을 때 고객의 댓글 "0", "0번", "공", "영"은 0번 상품에 대한 정당한 구매 신청(BUYER_INTENT)입니다.

현재 실시간 감지된 활성 상품 슬롯 정보:
${
  activeProduct
    ? `- 상품번호: ${activeProduct.orderCode || "미지정"}
- 가격: ${activeProduct.unitPrice ? `${activeProduct.unitPrice.toLocaleString()}원 (${activeProduct.rawPrice || ""})` : "미지정"}
- 수량: ${activeProduct.stock}개
- 캡처 지시 여부: ${activeProduct.captureDirected ? "예 (캡처 요청됨)" : "아니오"}
- 선착순 신청 댓글 후보 (${activeProduct.candidateComments.length}명): ${
        activeProduct.candidateComments
          .slice(0, 10)
          .map((c, i) => `${i + 1}위 ${c.nickname} ("${c.content}")`)
          .join(", ") || "없음"
      }`
    : "현재 활성화된 특정 상품 슬롯 없음 (대화 문맥에서 판단)"
}
`;

  return {
    ...basePrompt,
    systemPrompt: `${basePrompt.systemPrompt}\n${argonRules}`,
  };
}
