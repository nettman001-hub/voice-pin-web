import { CAPTURE_REQUEST_SOURCE, isQuestionUtterance, splitTranscriptClauses } from './voiceUtteranceService.ts';

// 라이브 청취 홈: 판매 저장과 "캡처하세요" 화면 캡처를 시각으로 짝짓는다.
// 판매 저장 시각과 캡처 시각이 앞뒤 10초 안이면 그 캡처가 판매의 상품 이미지1이 된다.
// 10초 안에 짝이 없으면 판매는 이미지 없이 저장된다.

export const SALE_CAPTURE_PAIR_WINDOW_MS = 10_000;

// 판매 사진으로 쓰는 캡처. 상품등록 촬영 등 다른 용도의 캡처는 짝짓기에서 제외한다.
export type CapturePurpose = 'SALE' | 'PRODUCT_REGISTER';

export interface PairableCapture {
  id: string;
  sessionId: string;
  capturedAt: string;
  saleId?: string;
  purpose?: CapturePurpose;
}

export interface PairableSale {
  id: string;
  sessionId: string;
  recognizedAt: string;
  status?: string;
  recordState?: string;
  captureImageUrls?: string[];
}

// "캡처하세요", "캡처해주세요", "캡처해 주시고요", "캡처요", "화면 캡처" 같은 캡처 지시. "캡처할까요?", "캡처하지 마세요"는 제외한다.
export const CAPTURE_INSTRUCTION_PATTERN = new RegExp(`${CAPTURE_REQUEST_SOURCE}(?![가-힣])`, 'u');

export function hasCaptureCancellationText(text: string): boolean {
  return /(?:안|못)\s*캡[처쳐]|캡[처쳐](?:는|를|은|을)?\s*(?:하지\s*(?:마|않)|안\s*(?:해|하|할)|못\s*(?:해|하|할)|취소|말고)/u.test(text);
}

export function hasCaptureInstructionText(text: string, options: { saleContext?: boolean } = {}): boolean {
  if (hasCaptureCancellationText(text)) return false;
  return splitTranscriptClauses(text).some((clause) => {
    if (isQuestionUtterance(clause) || hasCaptureCancellationText(clause)) return false;
    // A quoted instruction or an explanation of the feature is not a command.
    if (/캡[처쳐].*(?:라는|라고|하는\s*(?:말|거|것)|방법|기능|버튼|설명)/u.test(clause)) return false;
    if (CAPTURE_INSTRUCTION_PATTERN.test(clause)) return true;
    if (/(?:^|[\s,，])화면\s*캡[처쳐][.!。\s]*$/u.test(clause)) return true;
    // Bare "캡처" is meaningful only while assembling a seller allocation.
    return Boolean(options.saleContext && /(?:^|[\s,，])캡[처쳐][.!。\s]*$/u.test(clause));
  });
}

const distanceMs = (a: string, b: string): number => {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
  return Math.abs(left - right);
};

/** 판매 저장 시: 아직 어느 판매에도 쓰이지 않은 판매용 캡처 중 10초 안에서 가장 가까운 것. */
export function findCaptureForSale<T extends PairableCapture>(
  sale: { sessionId: string; recognizedAt: string },
  captures: T[],
  windowMs = SALE_CAPTURE_PAIR_WINDOW_MS
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const capture of captures) {
    if (capture.purpose !== 'SALE' || capture.saleId) continue;
    if (capture.sessionId !== sale.sessionId) continue;
    const distance = distanceMs(capture.capturedAt, sale.recognizedAt);
    if (distance <= windowMs && distance < bestDistance) {
      best = capture;
      bestDistance = distance;
    }
  }
  return best;
}

/** 판매 저장 시: 10초 안의 아직 쓰이지 않은 판매용 캡처 전부(가까운 순). 한 판매에 여러 장 찍은 캡처를 모두 붙인다. */
export function findCapturesForSale<T extends PairableCapture>(
  sale: { sessionId: string; recognizedAt: string },
  captures: T[],
  windowMs = SALE_CAPTURE_PAIR_WINDOW_MS
): T[] {
  const seen = new Set<string>();
  return captures
    .filter((capture) => {
      if (capture.purpose !== 'SALE' || capture.saleId || capture.sessionId !== sale.sessionId) return false;
      if (seen.has(capture.id)) return false;
      seen.add(capture.id);
      return distanceMs(capture.capturedAt, sale.recognizedAt) <= windowMs;
    })
    .sort((a, b) => distanceMs(a.capturedAt, sale.recognizedAt) - distanceMs(b.capturedAt, sale.recognizedAt));
}

/**
 * 캡처 시: 아직 캡처 사진이 없는 판매 중 10초 안에서 가장 가까운 것.
 * allowCaptured면 이미 사진이 있는 판매도 대상이다(같은 판매에 여러 장 찍은 경우의 추가 사진).
 */
export function findSaleForCapture<T extends PairableSale>(
  capture: { sessionIds: string[]; capturedAt: string },
  sales: T[],
  windowMs = SALE_CAPTURE_PAIR_WINDOW_MS,
  options: { allowCaptured?: boolean } = {}
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sale of sales) {
    if (!capture.sessionIds.includes(sale.sessionId)) continue;
    if (sale.status === '취소' || sale.recordState === 'CANCELLED') continue;
    if (!options.allowCaptured && (sale.captureImageUrls?.length || 0) > 0) continue;
    const distance = distanceMs(sale.recognizedAt, capture.capturedAt);
    if (distance <= windowMs && distance < bestDistance) {
      best = sale;
      bestDistance = distance;
    }
  }
  return best;
}
