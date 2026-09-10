import type {
  PendingReasonCode,
  StructuredPendingReason,
  PendingEvidenceSnapshot,
  AiVerificationMeta,
  SaleHistoryRecord,
} from '../types/pendingSale.ts';
import type { SaleRecord } from '../types/live.ts';
import type { AiResolutionResult } from '../types/aiResolution.ts';
import { findMatchingNickname, extractPhoneSuffix4Digits, normalizeNickname } from './nicknameMatcher.ts';
import { parseKoreanAmount } from './salesExtractor.ts';

export interface RuleEvaluationInput {
  sale: Partial<SaleRecord>;
  comments?: Array<{ id: string; nickname: string; text?: string; createdAt?: string }>;
  buyers?: Array<{ id: string; display_nickname: string }>;
  activeProduct?: { id?: string; productCode: string; name?: string; unitPrice?: number };
  sessionProducts?: Array<{ id: string; product_code: string; name?: string; unit_price?: number }>;
  followUpUtterance?: string;
}

/**
 * 1. 자동 적재 판매의 보류 사유 자동 식별 및 구조화
 */
export function buildPendingReasons(
  sale: Partial<SaleRecord>,
  options: {
    comments?: Array<{ id: string; nickname: string; text?: string }>;
    activeProduct?: { unitPrice?: number; productCode?: string };
  } = {}
): StructuredPendingReason[] {
  const reasons: StructuredPendingReason[] = [];
  const rawTranscript = (sale.rawTranscript || '').trim();
  const nickname = (sale.buyerNickname || '').trim();
  const amount = Number(sale.amount || 0);

  // 1-1. 닉네임 미추출 / 미확인
  const isNicknameMissing = !nickname || nickname === '미확인(보류)' || nickname === '미확인' || nickname === '구매자';
  if (isNicknameMissing) {
    reasons.push({
      code: 'MISSING_NICKNAME',
      message: '발화에서 구매자 닉네임이 추출되지 않았거나 확인되지 않았습니다.',
      resolved: false,
    });
  }

  // 1-2. 끝번호만 인식
  const suffixDigits = extractPhoneSuffix4Digits(nickname) || extractPhoneSuffix4Digits(rawTranscript);
  if (suffixDigits && isNicknameMissing) {
    reasons.push({
      code: 'TRAILING_DIGITS_ONLY',
      message: `구매자 4자리 식별자(${suffixDigits})만 감지되어 실제 댓글 작성자와의 유일 대조가 필요합니다.`,
      resolved: false,
    });
  }

  // 1-3. 금액 누락 또는 0원
  if (amount <= 0) {
    reasons.push({
      code: 'MISSING_AMOUNT',
      message: '판매 금액이 0원이거나 발화에서 금액이 명시되지 않았습니다.',
      resolved: false,
    });
  }

  // 1-4. 분리 발화 (문장 끊김 등)
  const isSplitUtterance =
    rawTranscript.endsWith('아니고') ||
    rawTranscript.endsWith('가격은') ||
    rawTranscript.endsWith('금액은') ||
    rawTranscript.endsWith('상품번호는') ||
    rawTranscript.endsWith('번은');
  if (isSplitUtterance) {
    reasons.push({
      code: 'SPLIT_UTTERANCE',
      message: '발화가 완성되지 않고 다음 문장으로 분리되어 후속 발화 연결이 필요합니다.',
      resolved: false,
    });
  }

  // 1-5. 댓글 지연 (닉네임은 발화되었으나 댓글 목록에 아직 없는 경우)
  if (!isNicknameMissing && options.comments && options.comments.length > 0) {
    const norm = normalizeNickname(nickname);
    const hasComment = options.comments.some((c) => normalizeNickname(c.nickname) === norm);
    if (!hasComment) {
      reasons.push({
        code: 'DELAYED_COMMENT',
        message: `'${nickname}' 님의 댓글이 아직 수신되지 않아 지연 댓글 대기 중입니다.`,
        resolved: false,
      });
    }
  }

  return reasons;
}

/**
 * 2. 원본 불변 근거 스냅샷 생성
 */
export function buildEvidenceSnapshot(
  sale: Partial<SaleRecord>,
  options: {
    relevantCommentIds?: string[];
    snapshotVersion?: number;
  } = {}
): PendingEvidenceSnapshot {
  const originalUtterance = sale.rawTranscript || '';
  const recognizedAt = sale.recognizedAt || new Date().toISOString();
  const relevantCommentIds = options.relevantCommentIds || [];
  const productCode = sale.productCode;
  const productName = sale.productName;
  const unitPrice = sale.unitPrice;
  const quantity = sale.quantity || 1;
  const amount = sale.amount || 0;
  const captureImageUrls = sale.captureImageUrls || [];
  const snapshotVersion = options.snapshotVersion || 1;

  // 근거 변경 감지를 위한 간이 해시
  const rawString = `${originalUtterance}|${relevantCommentIds.sort().join(',')}|${productCode}|${unitPrice}|${quantity}|${amount}|${snapshotVersion}`;
  let hashVal = 0;
  for (let i = 0; i < rawString.length; i++) {
    hashVal = (hashVal << 5) - hashVal + rawString.charCodeAt(i);
    hashVal |= 0;
  }
  const snapshotHash = `snap_${Math.abs(hashVal).toString(36)}`;

  return {
    originalUtterance,
    recognizedAt,
    relevantCommentIds,
    productCode,
    productName,
    unitPrice,
    quantity,
    amount,
    captureImageUrls,
    snapshotVersion,
    snapshotHash,
  };
}

/**
 * 한국어 구두 금액 파서 (단위: 만 원 / 원 / 소숫점)
 */
function parseSpokenPriceHelper(text: string): number | null {
  if (!text) return null;

  const parsedKorean = parseKoreanAmount(text);
  if (parsedKorean && parsedKorean > 0) {
    return parsedKorean;
  }

  const clean = text.replace(/,/g, '').trim();

  // 소숫점 만원 패턴 (예: "1.2", "0.9", "1.7만원")
  const decimalMatch = clean.match(/(\d+\.\d+)\s*(?:만\s*원|만원|만)?/);
  if (decimalMatch) {
    const num = parseFloat(decimalMatch[1]);
    if (!isNaN(num) && num > 0) {
      return Math.round(num * 10000);
    }
  }

  // 정수 만원 패턴 (예: "1만원", "2만 원")
  const tenThousandMatch = clean.match(/(\d+)\s*(?:만\s*원|만원|만)/);
  if (tenThousandMatch) {
    const num = parseInt(tenThousandMatch[1], 10);
    if (!isNaN(num) && num > 0) {
      return num * 10000;
    }
  }

  // 일반 원 단위 패턴 (예: "12000원", "15000")
  const regularWonMatch = clean.match(/(\d{3,8})\s*(?:원)?/);
  if (regularWonMatch) {
    const num = parseInt(regularWonMatch[1], 10);
    if (!isNaN(num) && num > 0) {
      return num;
    }
  }

  return null;
}

/**
 * 3. 기존 규칙 우선 파이프라인 (Rule-First Pipeline)
 */
export function evaluatePendingRules(
  currentReasons: StructuredPendingReason[],
  input: RuleEvaluationInput
): {
  changes: {
    buyerNickname?: string;
    buyerId?: string;
    amount?: number;
    unitPrice?: number;
    quantity?: number;
    productCode?: string;
  };
  resolvedReasonCodes: PendingReasonCode[];
  updatedReasons: StructuredPendingReason[];
  allResolved: boolean;
} {
  const changes: {
    buyerNickname?: string;
    buyerId?: string;
    amount?: number;
    unitPrice?: number;
    quantity?: number;
    productCode?: string;
  } = {};

  const resolvedCodes: PendingReasonCode[] = [];
  const transcript = input.sale.rawTranscript || '';
  const candidateNicknames = [
    ...(input.comments?.map((c) => c.nickname) || []),
    ...(input.buyers?.map((b) => b.display_nickname) || []),
  ].filter(Boolean);

  // [규칙 1] 닉네임 오인식 및 끝번호 4자리 유일 일치 대조
  const hasNicknameReason = currentReasons.some(
    (r) => !r.resolved && (r.code === 'MISSING_NICKNAME' || r.code === 'TRAILING_DIGITS_ONLY' || r.code === 'DELAYED_COMMENT')
  );

  if (hasNicknameReason && candidateNicknames.length > 0) {
    const suffix = extractPhoneSuffix4Digits(input.sale.buyerNickname || '') || extractPhoneSuffix4Digits(transcript);
    const spoken = suffix ? `뒷번호 ${suffix}님` : (input.sale.buyerNickname || transcript);

    const matchResult = findMatchingNickname(spoken, candidateNicknames);

    if (matchResult.matched && matchResult.matchedNickname) {
      changes.buyerNickname = matchResult.matchedNickname;

      const matchedBuyer = input.buyers?.find((b) => b.display_nickname === matchResult.matchedNickname);
      if (matchedBuyer) {
        changes.buyerId = matchedBuyer.id;
      }

      resolvedCodes.push('MISSING_NICKNAME', 'TRAILING_DIGITS_ONLY', 'DELAYED_COMMENT');
    } else if (matchResult.ambiguous) {
      if (!currentReasons.some((r) => r.code === 'MULTIPLE_CANDIDATES_CONFLICT')) {
        currentReasons.push({
          code: 'MULTIPLE_CANDIDATES_CONFLICT',
          message: `동일 조건을 만족하는 복수 후보가 존재합니다: ${matchResult.candidates?.join(', ')}`,
          resolved: false,
        });
      }
    }
  }

  // [규칙 2] 금액 누락 해결 (활성 상품 단가 연결 또는 소숫점 금액 파싱)
  const hasAmountReason = currentReasons.some((r) => !r.resolved && r.code === 'MISSING_AMOUNT');
  if (hasAmountReason) {
    let resolvedAmount: number | null = null;
    let resolvedUnitPrice: number | null = null;

    const parsedSpoken =
      parseSpokenPriceHelper(transcript) ||
      (input.followUpUtterance ? parseSpokenPriceHelper(input.followUpUtterance) : null);
    if (parsedSpoken && parsedSpoken > 0) {
      resolvedAmount = parsedSpoken;
      resolvedUnitPrice = parsedSpoken;
    } else if (input.activeProduct?.unitPrice && input.activeProduct.unitPrice > 0) {
      resolvedUnitPrice = input.activeProduct.unitPrice;
      const qty = input.sale.quantity || 1;
      resolvedAmount = resolvedUnitPrice * qty;
      if (input.activeProduct.productCode) {
        changes.productCode = input.activeProduct.productCode;
      }
    }

    if (resolvedAmount && resolvedAmount > 0) {
      changes.amount = resolvedAmount;
      if (resolvedUnitPrice) changes.unitPrice = resolvedUnitPrice;
      changes.quantity = input.sale.quantity || 1;
      resolvedCodes.push('MISSING_AMOUNT');
    }
  }

  // [규칙 3] 분리 발화 해결 (후속 발화 연결)
  const hasSplitReason = currentReasons.some((r) => !r.resolved && r.code === 'SPLIT_UTTERANCE');
  if (hasSplitReason && input.followUpUtterance) {
    const followUpPrice = parseSpokenPriceHelper(input.followUpUtterance);
    if (followUpPrice && followUpPrice > 0) {
      changes.amount = followUpPrice;
      changes.unitPrice = followUpPrice;
      resolvedCodes.push('SPLIT_UTTERANCE', 'MISSING_AMOUNT');
    }
  }

  // 보류 사유 상태 갱신
  const { updatedReasons, allResolved } = applyResolutionToPendingReasons(
    currentReasons,
    resolvedCodes,
    'RULE',
    '기존 비즈니스 규칙(닉네임/끝번호 매칭, 상품 단가, 분리 발화 연결)으로 해결'
  );

  return {
    changes,
    resolvedReasonCodes: resolvedCodes,
    updatedReasons,
    allResolved,
  };
}

/**
 * 4. 서버 중심의 AI 결과 엄격 검증
 */
export function validateAiResolutionForSale(
  aiResult: AiResolutionResult,
  sale: Partial<SaleRecord>,
  options: {
    sessionComments: Array<{ id: string; nickname: string }>;
    sessionBuyers?: Array<{ id: string; display_nickname: string }>;
    sessionProducts?: Array<{ id: string; product_code: string; unit_price?: number }>;
  }
): {
  valid: boolean;
  reason?: string;
  changes?: {
    buyerNickname?: string;
    buyerId?: string;
    amount?: number;
    unitPrice?: number;
    quantity?: number;
    productCode?: string;
  };
  resolvedReasonCodes: PendingReasonCode[];
} {
  if (!aiResult.resolvable) {
    return {
      valid: false,
      reason: aiResult.evidenceSummary || 'AI 분석 결과 처리 불가 (자료 부족 또는 충돌)',
      resolvedReasonCodes: [],
    };
  }

  const changes: {
    buyerNickname?: string;
    buyerId?: string;
    amount?: number;
    unitPrice?: number;
    quantity?: number;
    productCode?: string;
  } = {};

  const resolvedCodes: PendingReasonCode[] = [];

  // 4-1. 구매자 닉네임 실존 검증 (AI 환각 닉네임 방어)
  const aiBuyerNick = aiResult.changes?.buyerNickname?.to;
  if (aiBuyerNick) {
    const normAiNick = normalizeNickname(aiBuyerNick);
    const matchingComment = options.sessionComments.find(
      (c) => normalizeNickname(c.nickname) === normAiNick
    );
    const matchingBuyer = options.sessionBuyers?.find(
      (b) => normalizeNickname(b.display_nickname) === normAiNick
    );

    if (!matchingComment && !matchingBuyer) {
      return {
        valid: false,
        reason: `AI가 제안한 닉네임('${aiBuyerNick}')이 해당 방송 회차의 실제 댓글 또는 등록 구매자 목록에 존재하지 않습니다 (AI 환각 닉네임 차단).`,
        resolvedReasonCodes: [],
      };
    }

    changes.buyerNickname = matchingComment ? matchingComment.nickname : matchingBuyer!.display_nickname;
    if (matchingBuyer) {
      changes.buyerId = matchingBuyer.id;
    }
    resolvedCodes.push('MISSING_NICKNAME', 'TRAILING_DIGITS_ONLY', 'DELAYED_COMMENT');
  }

  // 4-2. 상품 연결 검증
  const aiProductCode = aiResult.changes?.productCode?.to;
  if (aiProductCode && options.sessionProducts && options.sessionProducts.length > 0) {
    const productExists = options.sessionProducts.some((p) => p.product_code === aiProductCode);
    if (!productExists) {
      return {
        valid: false,
        reason: `AI가 제안한 상품코드('${aiProductCode}')가 해당 회차의 등록 상품 목록에 존재하지 않습니다.`,
        resolvedReasonCodes: [],
      };
    }
    changes.productCode = aiProductCode;
  }

  // 4-3. 금액 및 수량 근거 검증
  const aiAmount = aiResult.changes?.amount?.to;
  if (typeof aiAmount === 'number' && aiAmount > 0) {
    changes.amount = aiAmount;
    changes.unitPrice = aiResult.changes?.amount?.unitPrice || aiAmount;
    changes.quantity = aiResult.changes?.amount?.quantity || 1;
    resolvedCodes.push('MISSING_AMOUNT', 'SPLIT_UTTERANCE');
  }

  return {
    valid: true,
    changes,
    resolvedReasonCodes: resolvedCodes,
  };
}

/**
 * 5. 보류 사유 부분 해결 및 잔여 사유 보존
 */
export function applyResolutionToPendingReasons(
  currentReasons: StructuredPendingReason[],
  resolvedCodes: PendingReasonCode[],
  resolvedBy: 'RULE' | 'AI' | 'MANUAL',
  details?: string
): {
  updatedReasons: StructuredPendingReason[];
  allResolved: boolean;
} {
  const now = new Date().toISOString();
  const updatedReasons: StructuredPendingReason[] = currentReasons.map((r) => {
    if (resolvedCodes.includes(r.code) && !r.resolved) {
      return {
        ...r,
        resolved: true,
        resolvedAt: now,
        resolvedBy,
        resolutionDetails: details || `${resolvedBy} 처리에 의해 해결됨`,
      };
    }
    return { ...r };
  });

  const allResolved = updatedReasons.length > 0 && updatedReasons.every((r) => r.resolved);

  return {
    updatedReasons,
    allResolved,
  };
}

/**
 * 6. 남은 보류 건 일괄 확정을 위한 사전 검증
 * - 필수 값(유효 닉네임, 금액 > 0, 상품 연결) 및 미해결 보류 사유 0건 여부 검증
 */
export function validateSaleForBatchConfirm(sale: Partial<SaleRecord>): {
  canConfirm: boolean;
  validationErrors: string[];
} {
  const errors: string[] = [];

  const nickname = (sale.buyerNickname || '').trim();
  const hasValidNickname = Boolean(nickname) && nickname !== '미확인(보류)' && nickname !== '미확인' && nickname !== '구매자';
  if (!hasValidNickname) {
    errors.push('구매자 닉네임 미확인');
  }

  const amount = Number(sale.amount || 0);
  if (amount <= 0) {
    errors.push('판매 금액 0원 또는 미입력');
  }

  const hasProduct = Boolean(sale.productCode || sale.productName || (sale as any).product_code_snapshot || sale.productId || (sale as any).product_id);
  if (!hasProduct) {
    errors.push('연결 상품 정보 누락');
  }

  const unresolvedReasons = (sale.pendingReasons || (sale as any).pending_reasons || []).filter((r: any) => !r.resolved);
  if (unresolvedReasons.length > 0) {
    errors.push(...unresolvedReasons.map((r: any) => r.message));
  }

  return {
    canConfirm: errors.length === 0,
    validationErrors: errors,
  };
}

