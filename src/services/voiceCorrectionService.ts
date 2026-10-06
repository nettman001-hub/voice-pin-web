import type { SaleRecord } from '../types/live.ts';
import type { SaleHistoryRecord } from '../types/pendingSale.ts';
import type {
  VoiceCorrectionIntent,
  PendingCorrectionRequest,
  CorrectionFieldType,
  CorrectionScope,
} from '../types/voiceCorrection.ts';
import { parseKoreanAmount } from './salesExtractor.ts';
import { normalizeNickname } from './nicknameMatcher.ts';
import { isNegatedVoiceAction, isQuestionUtterance, isStandaloneBuyerAddress, splitTranscriptClauses } from './voiceUtteranceService.ts';

/**
 * 1. 음성 발화에서 정정 의도 및 전후 값, 대상 지칭, 적용 범위 추출
 * - 일반 판매 추출보다 먼저 실행하여 정정 문장이 신규 판매로 오인되는 것을 방지
 */
function parseVoiceCorrectionClause(text: string): VoiceCorrectionIntent {
  if (!text) {
    return {
      isCorrection: false,
      field: 'COMPLEX',
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: false,
      isQuestion: false,
      isCancellation: false,
      isIncomplete: false,
      rawUtterance: '',
    };
  }

  const clean = text.trim();
  const hasExplicitCorrection = /(?:정정|수정|변경|바꾸|바꾼|바꿔|잘못\s*말씀)/u.test(clean);
  const hasPriceSubject = /(?:가격|금액)/u.test(clean);
  const hasMeasurementSubject = /(?:가단|가슴\s*단면|기장|길이|높이|폭|사이즈|센티|미터|\bcm\b)/iu.test(clean);
  const hasMoney = Boolean(parseKoreanAmount(clean)) && (hasPriceSubject || !hasMeasurementSubject);
  const hasBuyerContrast = /(?:님|언니|씨)(?:이|가)?\s*(?:아니고|아니시고|아니라|말고)/u.test(clean);
  const hasSaleSubject = /(?:가격|금액|구매자|닉네임|판매한|판매하신|구매하신|주문|\d+\s*번\s*상품)/u.test(clean)
    || /[가-힣a-zA-Z0-9_]+\s*(?:님|언니|씨)/u.test(clean)
    || hasMoney;

  // 1-1. 부정 명령 감지 ("1.2로 변경하지 마세요", "수정하지 마세요", "바꾸지 마세요")
  const isNegative = isNegatedVoiceAction(clean) && /(?:변경|수정|바꾸|정정)/u.test(clean)
    && (hasSaleSubject || /^(?:변경|수정|바꾸|정정)/u.test(clean));
  if (isNegative) {
    return {
      isCorrection: false,
      field: 'COMPLEX',
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: true,
      isQuestion: false,
      isCancellation: false,
      isIncomplete: false,
      rawUtterance: clean,
    };
  }

  // 1-2. 질문 감지 ("1.2인가요?", "바꾼건가요?", "맞나요?")
  const isQuestion = isQuestionUtterance(clean);
  if (isQuestion) {
    return {
      isCorrection: false,
      field: 'COMPLEX',
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: false,
      isQuestion: true,
      isCorrectionQuestion: (hasExplicitCorrection && (hasSaleSubject || /^(?:정정|수정|변경|바꾸|바꾼)/u.test(clean)))
        || ((hasPriceSubject || hasMoney || hasBuyerContrast) && /(?:아니고|아니시고|아니라|말고)/u.test(clean)),
      isCancellation: false,
      isIncomplete: false,
      rawUtterance: clean,
    };
  }

  // 1-3. 정정 취소/철회 감지 ("방금 수정한 거 취소", "방금 수정 취소", "수정한거 취소할게요")
  const isCancellation = /(?:방금\s*수정한\s*거|방금\s*수정한거|방금\s*수정|방금\s*건\s*수정|수정한\s*거|수정한거)\s*(?:취소|철회|되돌려)/u.test(clean) ||
    /(?:수정\s*취소|정정\s*취소)/u.test(clean);
  if (isCancellation) {
    return {
      isCorrection: true,
      field: 'CANCEL_CORRECTION',
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: false,
      isQuestion: false,
      isCancellation: true,
      isIncomplete: false,
      rawUtterance: clean,
    };
  }

  // 1-4. 미완성/조각난 발화 감지 ("xx님 0.9가 아니고...", "0.9가 아니고...")
  const isIncomplete = /(?:아니고|아니시고|아니라|말고)\s*(?:\.{2,}|…|\s*)$/u.test(clean);
  if (isIncomplete && (hasPriceSubject || hasMoney || hasBuyerContrast)) {
    // 이전 값은 있을 수 있으나 새 값이 아직 오지 않음
    return {
      isCorrection: true,
      field: 'COMPLEX',
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: false,
      isQuestion: false,
      isCancellation: false,
      isIncomplete: true,
      rawUtterance: clean,
    };
  }

  // 1-5. 정정 키워드 존재 여부 확인
  const hasCorrectionTrigger = /(?:아니고|아니시고|아니라|말고|정정|잘못\s*말씀|변경하겠|바꾸겠|변경|앞으로\s*판매할|다음부터)/u.test(clean);
  if (!hasCorrectionTrigger) {
    return {
      isCorrection: false,
      field: 'COMPLEX',
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: false,
      isQuestion: false,
      isCancellation: false,
      isIncomplete: false,
      rawUtterance: clean,
    };
  }

  // 1-6. 적용 범위 판별 (향후 상품 가격 vs 특정 판매 한 건)
  let scope: CorrectionScope = 'THIS_SALE_ONLY';
  if (/(?:앞으로\s*판매할|앞으로\s*이\s*상품|다음부터\s*이\s*상품|앞으로의\s*가격)/u.test(clean)) {
    scope = 'FUTURE_PRODUCT_SALES';
  } else if (/^\d+\s*번\s*[\d.]+\s*(?:로\s*변경|으로\s*변경)/u.test(clean) && !/(?:님|구매|좀전에|방금)/u.test(clean)) {
    // 예: "12번 1.2로 변경"처럼 구매자나 판매 시점 언급 없이 상품번호와 가격만 있는 경우 범위 불명확
    scope = 'UNCERTAIN';
  }

  // 1-7. 대상 지칭 추출 (상품번호, 구매자, 상대 시각)
  const productMatch = clean.match(/(\d{1,3})\s*(?:번\s*상품|번)/u);
  const targetProductCode = productMatch ? productMatch[1] : undefined;

  const relativeTime = /(?:좀전에|좀\s*전에|방금\s*전|방금|아까)/u.test(clean) ? 'JUST_BEFORE' : undefined;

  // 1-7-1. 향후 상품 가격 변경 패턴
  if (scope === 'FUTURE_PRODUCT_SALES' && (hasPriceSubject || hasMoney)) {
    const parsedAmount = parseKoreanAmount(clean);
    if (parsedAmount && parsedAmount > 0) {
      return {
        isCorrection: true,
        field: 'AMOUNT',
        affirmedNewValue: { amount: parsedAmount },
        targetReference: { productCode: targetProductCode },
        scope: 'FUTURE_PRODUCT_SALES',
        isNegativeCommand: false,
        isQuestion: false,
        isCancellation: false,
        isIncomplete: false,
        rawUtterance: clean,
      };
    }
  }

  // 1-8. 금액 정정 패턴 분석
  // 예: "가격이 0.9가 아니고 1.2입니다", "xx님 구매하신거 가격이 0.9가 아니고 1.2입니다", "0.9 말고 1.2"
  const priceCorrectionMatch = clean.match(
    /(?:가격이?|금액이?)?\s*([가-힣\d.]+)\s*(?:가|이|원|만원)?\s*(?:아니고|아니라|말고)\s*([가-힣\d.]+)\s*(?:로|으로|입|원|만원|입니다|할게요|변경|정정|$)/u
  );

  if (priceCorrectionMatch && (hasPriceSubject || hasMoney)) {
    const rawOldPrice = priceCorrectionMatch[1].replace(/[.。]+$/u, '');
    const rawNewPrice = priceCorrectionMatch[2].replace(/[.。]+$/u, '');

    const oldAmount = parseKoreanAmount(rawOldPrice);
    const newAmount = parseKoreanAmount(rawNewPrice);

    if (newAmount && newAmount > 0) {
      // 구매자 지칭 감지 (예: "xx님 구매하신거...")
      const buyerMatch = clean.match(/([가-힣a-zA-Z0-9_]{1,12})\s*님(?:\s*구매하신|\s*이\s*구매하신|\s*구매)?/u);
      const targetBuyer = buyerMatch ? buyerMatch[1].trim() : undefined;

      return {
        isCorrection: true,
        field: 'AMOUNT',
        negatedOldValue: oldAmount ? { amount: oldAmount } : undefined,
        affirmedNewValue: { amount: newAmount },
        targetReference: {
          buyerNickname: targetBuyer,
          productCode: targetProductCode,
          relativeTime,
        },
        scope,
        isNegativeCommand: false,
        isQuestion: false,
        isCancellation: false,
        isIncomplete: false,
        rawUtterance: clean,
      };
    }
  }

  // 1-9. 구매자 정정 패턴 분석
  // 예: "좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다", "xxx님이 아니고 ooo님입니다"
  const buyerCorrectionMatch = clean.match(
    /([가-힣a-zA-Z0-9_]{1,20})\s*(?:님|언니|씨)(?:이|가)?\s*(?:아니시고|아니고|아니라|말고)\s*([가-힣a-zA-Z0-9_]{1,20})\s*(?:님|언니|씨)(?:께|에게|한테|이|가)?/u
  );

  if (buyerCorrectionMatch) {
    const oldBuyer = buyerCorrectionMatch[1].trim();
    const newBuyer = buyerCorrectionMatch[2].trim();

    // 일상 단어 및 불용어 제외
    const stopWords = ['가격', '금액', '상품', '판매', '취소', '정정', '방금', '좀전에', '내가'];
    if (oldBuyer && newBuyer && !stopWords.includes(oldBuyer) && !stopWords.includes(newBuyer)) {
      return {
        isCorrection: true,
        field: 'BUYER',
        negatedOldValue: { buyerNickname: oldBuyer },
        affirmedNewValue: { buyerNickname: newBuyer },
        targetReference: {
          buyerNickname: oldBuyer,
          productCode: targetProductCode,
          relativeTime,
        },
        scope,
        isNegativeCommand: false,
        isQuestion: false,
        isCancellation: false,
        isIncomplete: false,
        rawUtterance: clean,
      };
    }
  }

  // 1-10. 단일 필드 명시 정정 (예: "12번 상품, 러블리님 금액 1.2로 정정합니다")
  const explicitCorrectionMatch = clean.match(/(?:금액|가격)(?:은|는|이|가|을|를)?\s*([가-힣\d.]+)\s*(?:로|으로)\s*(?:정정|변경)/u);
  if (explicitCorrectionMatch) {
    const newAmount = parseKoreanAmount(explicitCorrectionMatch[1]);
    const buyerMatch = clean.match(/([가-힣a-zA-Z0-9_]{1,12})\s*님/u);
    const targetBuyer = buyerMatch ? buyerMatch[1].trim() : undefined;

    if (newAmount && newAmount > 0) {
      return {
        isCorrection: true,
        field: 'AMOUNT',
        affirmedNewValue: { amount: newAmount },
        targetReference: {
          buyerNickname: targetBuyer,
          productCode: targetProductCode,
          relativeTime,
        },
        scope,
        isNegativeCommand: false,
        isQuestion: false,
        isCancellation: false,
        isIncomplete: false,
        rawUtterance: clean,
      };
    }
  }

  return {
    isCorrection: hasExplicitCorrection && hasSaleSubject,
    field: 'COMPLEX',
    scope,
    isNegativeCommand: false,
    isQuestion: false,
    isCancellation: false,
    isIncomplete: false,
    rawUtterance: clean,
  };
}

/** Keep ordinary statements together for split buyer/price evidence, but route questions
 * and corrections separately so one question cannot suppress an unrelated sale. */
export function getVoiceProcessingSegments(text: string): string[] {
  const segments: string[] = [];
  let statement = '';
  for (const clause of splitTranscriptClauses(text)) {
    const intent = parseVoiceCorrectionClause(clause);
    if (intent.isQuestion || intent.isNegativeCommand || intent.isCorrection) {
      if (statement && isStandaloneBuyerAddress(statement) && (intent.isCorrection || intent.isCorrectionQuestion)) {
        segments.push(`${statement} ${clause}`);
      } else {
        if (statement) segments.push(statement);
        segments.push(clause);
      }
      statement = '';
    } else {
      statement = statement ? `${statement} ${clause}` : clause;
    }
  }
  if (statement) segments.push(statement);
  return segments;
}

export function parseVoiceCorrection(text: string): VoiceCorrectionIntent {
  const intents = getVoiceProcessingSegments(text).map(parseVoiceCorrectionClause);
  const correction = intents.find((intent) => intent.isCorrection || intent.isCorrectionQuestion || intent.isNegativeCommand);
  if (correction) return correction;
  if (intents.length === 1) return intents[0];
  const empty = parseVoiceCorrectionClause('');
  return { ...empty, isQuestion: intents.length > 0 && intents.every((intent) => intent.isQuestion), rawUtterance: text.trim() };
}

export function isActionableVoiceCorrection(intent: VoiceCorrectionIntent): boolean {
  return intent.isCorrection && !intent.isQuestion && !intent.isNegativeCommand && !intent.isIncomplete
    && intent.scope === 'THIS_SALE_ONLY'
    && ((intent.field === 'AMOUNT' && Number.isFinite(intent.affirmedNewValue?.amount) && (intent.affirmedNewValue?.amount || 0) > 0)
      || (intent.field === 'BUYER' && Boolean(intent.affirmedNewValue?.buyerNickname?.trim())));
}

/**
 * 2. 정정 대상 판매 탐색
 * - 같은 판매자·회차 내에서 상품번호, 기존 구매자, 기존 금액, 판매 시각으로 특정
 * - 단지 마지막 판매 한 건이라는 이유만으로 선택하지 않음
 */
export function findTargetSaleForCorrection(
  intent: VoiceCorrectionIntent,
  existingSales: SaleRecord[]
): {
  targetSaleId: string | null;
  candidates: SaleRecord[];
  missingInfo: string[];
} {
  const missingInfo: string[] = [];
  if (!existingSales || existingSales.length === 0) {
    return { targetSaleId: null, candidates: [], missingInfo: ['등록된 판매 내역 없음'] };
  }

  let candidates = [...existingSales];

  if (!isActionableVoiceCorrection(intent)) {
    return { targetSaleId: null, candidates: [], missingInfo: ['정정할 값과 적용 범위 확인 필요'] };
  }
  if (!intent.targetReference?.productCode && !intent.negatedOldValue?.buyerNickname
    && !intent.targetReference?.buyerNickname && !intent.negatedOldValue?.amount) {
    return { targetSaleId: null, candidates, missingInfo: ['상품번호 또는 구매자 등 정정 대상 근거 필요'] };
  }

  // 2-1. 상품번호 필터링
  if (intent.targetReference?.productCode) {
    const pCode = String(parseInt(intent.targetReference.productCode, 10));
    candidates = candidates.filter((s) => {
      const salePCode = String(parseInt(s.productCode || '', 10));
      return salePCode === pCode || s.productCode === intent.targetReference?.productCode;
    });
  }

  // 2-2. 기존 구매자 닉네임 필터링
  const buyerRef = intent.negatedOldValue?.buyerNickname || intent.targetReference?.buyerNickname;
  if (buyerRef) {
    const normRef = normalizeNickname(buyerRef);
    candidates = candidates.filter((s) => normalizeNickname(s.buyerNickname) === normRef);
  }

  // 2-3. 기존 금액 필터링
  if (intent.negatedOldValue?.amount) {
    const expectedOldAmount = intent.negatedOldValue.amount;
    candidates = candidates.filter((s) => Math.abs(s.amount - expectedOldAmount) < 10);
  }

  // 2-4. 결과 판정
  if (candidates.length === 1) {
    return {
      targetSaleId: candidates[0].id,
      candidates,
      missingInfo: [],
    };
  }

  if (candidates.length > 1) {
    // 복수 후보 존재: 마지막 1건을 임의 선택하지 않고 보류
    return {
      targetSaleId: null,
      candidates,
      missingInfo: ['상품번호 또는 특정 근거 필요 (동일 조건 복수 후보 존재)'],
    };
  }

  return {
    targetSaleId: null,
    candidates: [],
    missingInfo: ['일치하는 기존 판매 내역을 찾을 수 없음'],
  };
}

/**
 * 3. 후속 발화("12번이요", "아까 12번 상품")를 기존 정정 보류 요청에 안전하게 연결하여 대상 특정
 */
export function linkFollowUpToPendingCorrection(
  pending: PendingCorrectionRequest,
  followUpText: string,
  sessionSales: SaleRecord[]
): {
  resolvedSaleId: string | null;
  stillAmbiguous: boolean;
  matchedProductCode?: string;
} {
  const clean = followUpText.trim();
  if (isQuestionUtterance(clean) || isNegatedVoiceAction(clean) || !isActionableVoiceCorrection(pending.parsedCorrection)) {
    return { resolvedSaleId: null, stillAmbiguous: true };
  }
  const productMatch = clean.match(/^(?:네[,，]?\s*)?(?:아까\s*|방금\s*)?(?:상품(?:\s*번호)?(?:는|은)?\s*)?(\d{1,3})\s*번(?:\s*상품)?(?:이요|요|입니다|이에요|이었어요)?[.!。\s]*$/u);
  if (!productMatch) {
    return {
      resolvedSaleId: null,
      stillAmbiguous: true,
    };
  }

  const rawCode = productMatch[1];
  const numCode = String(parseInt(rawCode, 10));

  const candidateSales = sessionSales.filter((s) => pending.candidateSaleIds.includes(s.id));

  const matched = candidateSales.filter((s) => {
    const saleNum = String(parseInt(s.productCode || '', 10));
    return saleNum === numCode || s.productCode === rawCode;
  });

  if (matched.length === 1) {
    return {
      resolvedSaleId: matched[0].id,
      stillAmbiguous: false,
      matchedProductCode: rawCode,
    };
  }

  return {
    resolvedSaleId: null,
    stillAmbiguous: true,
    matchedProductCode: rawCode,
  };
}

/**
 * 4. 검증 완료된 음성 정정의 실제 판매 반영
 * - 판매 revision 검증 및 조건부 갱신
 * - 단가·수량·총액 일관성 유지
 * - 동일 판매 ID 보존 및 SaleHistoryRecord 감사 로그 생성
 * - 이미 출력된 판매는 수정 전표(kind: 'CORRECTION') 발행 플래그 설정
 */
export function applyCorrectionToSale(
  sale: SaleRecord,
  intent: VoiceCorrectionIntent,
  options: {
    expectedRevision?: number;
    registeredBuyers?: Array<{ id: string; display_nickname: string }>;
    sessionComments?: Array<{ id: string; nickname: string }>;
    printJobs?: Array<{ sale_id: string }>;
  } = {}
): {
  updatedSale: SaleRecord;
  historyRecord: SaleHistoryRecord;
  printJobRequired: boolean;
} {
  if (!isActionableVoiceCorrection(intent)) {
    throw new Error('INVALID_CORRECTION: 확정된 변경 값과 판매 한 건의 적용 범위가 필요합니다.');
  }
  const currentRevision = sale.revision || 1;
  if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
    throw new Error(
      `REVISION_CONFLICT: 판매 revision 불일치 (현재 v${currentRevision}, 기대 v${options.expectedRevision})`
    );
  }
  const nextRevision = currentRevision + 1;

  let nextNickname = sale.buyerNickname;
  let nextBuyerId = sale.buyerId;
  let nextAmount = sale.amount;
  let nextUnitPrice = sale.unitPrice || sale.amount;
  let nextQuantity = sale.quantity || 1;

  // 4-1. 구매자 정정 반영
  if (intent.field === 'BUYER' && intent.affirmedNewValue?.buyerNickname) {
    nextNickname = intent.affirmedNewValue.buyerNickname;
    // 실제 등록 구매자 또는 댓글 작성자 고유 ID 연결
    const matchedBuyer = options.registeredBuyers?.find(
      (b) => normalizeNickname(b.display_nickname) === normalizeNickname(nextNickname)
    );
    if (matchedBuyer) {
      nextBuyerId = matchedBuyer.id;
    }
  }

  // 4-2. 금액 정정 반영 (단가·수량·총액 일관성)
  if (intent.field === 'AMOUNT' && intent.affirmedNewValue?.amount) {
    const newPrice = intent.affirmedNewValue.amount;
    // 발화 금액은 총액 또는 단가로 지정될 수 있으며 수량과 곱을 맞춰 유지
    nextUnitPrice = newPrice;
    nextAmount = nextUnitPrice * nextQuantity;
  }

  const now = new Date().toISOString();
  const summary =
    intent.field === 'BUYER'
      ? `구매자 음성 정정: ${sale.buyerNickname} -> ${nextNickname}`
      : intent.field === 'AMOUNT'
        ? `금액 음성 정정: ${sale.amount.toLocaleString()}원 -> ${nextAmount.toLocaleString()}원`
        : '음성 정정 반영';

  const historyRecord: SaleHistoryRecord = {
    revision: nextRevision,
    changedAt: now,
    changedBy: 'SELLER',
    changeType: 'VOICE_CORRECTION',
    before: {
      buyerNickname: sale.buyerNickname,
      amount: sale.amount,
      status: sale.status,
      productCode: sale.productCode,
      pendingReasons: sale.pendingReasons,
    },
    after: {
      buyerNickname: nextNickname,
      amount: nextAmount,
      status: sale.status === '보류' ? '자동저장' : sale.status,
      productCode: sale.productCode,
      pendingReasons: (sale.pendingReasons || []).filter((r) => r.code !== 'MISSING_AMOUNT' && r.code !== 'MISSING_NICKNAME'),
    },
    summary,
  };

  const updatedSale: SaleRecord = {
    ...sale,
    buyerNickname: nextNickname,
    buyerId: nextBuyerId,
    amount: nextAmount,
    unitPrice: nextUnitPrice,
    quantity: nextQuantity,
    revision: nextRevision,
    history: [...(sale.history || []), historyRecord],
  };

  // 4-3. 이미 전표가 인쇄된 판매 건인 경우 수정 전표(CORRECTION) 발행 필요
  const wasPrinted =
    sale.printStatus === 'PRINTED' ||
    Boolean(options.printJobs?.some((p) => p.sale_id === sale.id));

  return {
    updatedSale,
    historyRecord,
    printJobRequired: wasPrinted,
  };
}

/**
 * 5. 음성 정정 취소 및 되돌리기 (Rollback)
 * - 판매 삭제와 엄격히 구분
 * - 결제 완료 / 출고 진행 중인 건은 자동 복원하지 않고 충돌 반환
 * - 정상 복원 시 이전 상태로 복원하고 SaleHistoryRecord에 CORRECTION_ROLLBACK 기록
 */
export function rollbackCorrection(
  sale: SaleRecord
): {
  success: boolean;
  rolledBackSale?: SaleRecord;
  conflictReason?: string;
} {
  // 5-1. 결제/출고 충돌 검사
  const paymentStatus = (sale as any).paymentStatus || (sale as any).payment_status;
  const shippingStatus = (sale as any).shippingStatus || (sale as any).shipping_status;

  if (paymentStatus === 'PAID' || paymentStatus === '결제완료') {
    return {
      success: false,
      conflictReason: '이미 결제가 완료된 판매 건입니다. 자동 복원할 수 없으며 주문 관리 화면에서 확인이 필요합니다.',
    };
  }

  if (shippingStatus === 'SHIPPED' || shippingStatus === '출고완료' || shippingStatus === '배송중') {
    return {
      success: false,
      conflictReason: '이미 상품이 출고/배송 처리된 판매 건입니다. 자동 복원할 수 없습니다.',
    };
  }

  // 5-2. 직전 정정 이력 탐색
  const history = sale.history || [];
  const lastCorrectionIndex = [...history].reverse().findIndex((h) => h.changeType === 'VOICE_CORRECTION');
  if (lastCorrectionIndex === -1) {
    return {
      success: false,
      conflictReason: '복원할 수 있는 음성 정정 이력이 존재하지 않습니다.',
    };
  }

  const actualIndex = history.length - 1 - lastCorrectionIndex;
  const targetHistory = history[actualIndex];
  const beforeState = targetHistory.before;

  const nextRevision = (sale.revision || 1) + 1;
  const now = new Date().toISOString();

  const rollbackHistoryItem: SaleHistoryRecord = {
    revision: nextRevision,
    changedAt: now,
    changedBy: 'SELLER',
    changeType: 'CORRECTION_ROLLBACK',
    before: {
      buyerNickname: sale.buyerNickname,
      amount: sale.amount,
      status: sale.status,
      productCode: sale.productCode,
      pendingReasons: sale.pendingReasons,
    },
    after: {
      buyerNickname: beforeState.buyerNickname || sale.buyerNickname,
      amount: beforeState.amount !== undefined ? beforeState.amount : sale.amount,
      status: beforeState.status || sale.status,
      productCode: beforeState.productCode || sale.productCode,
      pendingReasons: beforeState.pendingReasons || sale.pendingReasons,
    },
    summary: `음성 정정 취소 및 복원: revision v${targetHistory.revision} 이전 상태로 복구`,
  };

  const rolledBackSale: SaleRecord = {
    ...sale,
    buyerNickname: beforeState.buyerNickname || sale.buyerNickname,
    amount: beforeState.amount !== undefined ? beforeState.amount : sale.amount,
    unitPrice: beforeState.amount !== undefined ? beforeState.amount : (sale.unitPrice || sale.amount),
    revision: nextRevision,
    history: [...history, rollbackHistoryItem],
  };

  return {
    success: true,
    rolledBackSale,
  };
}
