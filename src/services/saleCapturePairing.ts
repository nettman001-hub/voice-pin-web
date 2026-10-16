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

// "캡처하세요", "캡처해주세요", "캡처요", "화면 캡처" 같은 캡처 지시. "캡처할까요?", "캡처하지 마세요"는 제외한다.
const CAPTURE_INSTRUCTION_PATTERN =
  /캡[처쳐]\s*(?:하세요|해\s*주세요|해\s*줘요|요|부탁(?:드려요|해요)|해\s*줘|해요|할게요|합니다)(?![가-힣]*\?)|화면\s*캡[처쳐]/u;

export function hasCaptureInstructionText(text: string): boolean {
  return CAPTURE_INSTRUCTION_PATTERN.test(text) && !/캡[처쳐]\s*하지\s*마/u.test(text);
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

/** 캡처 시: 아직 캡처 사진이 없는 판매 중 10초 안에서 가장 가까운 것. */
export function findSaleForCapture<T extends PairableSale>(
  capture: { sessionIds: string[]; capturedAt: string },
  sales: T[],
  windowMs = SALE_CAPTURE_PAIR_WINDOW_MS
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sale of sales) {
    if (!capture.sessionIds.includes(sale.sessionId)) continue;
    if (sale.status === '취소' || sale.recordState === 'CANCELLED') continue;
    if ((sale.captureImageUrls?.length || 0) > 0) continue;
    const distance = distanceMs(sale.recognizedAt, capture.capturedAt);
    if (distance <= windowMs && distance < bestDistance) {
      best = sale;
      bestDistance = distance;
    }
  }
  return best;
}
