import { SaleRecord, SaleStatus } from '../types/live';

/**
 * 한국어 금액 표현(예: "35,000원", "3만 5천원", "3만원", "42000원", "5천원")을 숫자(number)로 변환
 *
 * 라이브 판매에서 자주 쓰는 축약 발화도 지원한다.
 * "가격 0.8"은 0.8만 원, 즉 8,000원으로 해석한다.
 * 따라서 1.5 → 15,000원, 2.9 → 29,000원이다.
 */
export function parseKoreanAmount(text: string): number | null {
  if (!text) return null;

  // 0.8, 1.5, 2.9처럼 가격/금액 뒤에 붙는 '만 원 단위 축약 소수'
  // (숫자에 10을 곱한 뒤 1,000원을 곱하는 것과 같은 의미 = 숫자 * 10,000원)
  // 일반 소수(수량, 시간 등)를 가격으로 오인하지 않도록 가격 문맥 안에서만 적용한다.
  const decimalMatch = text.match(/(\d{1,3})\s*(?:[.]|점)\s*(\d{1,2})/u);
  if (decimalMatch) {
    const decimalStart = decimalMatch.index ?? 0;
    const decimalEnd = decimalStart + decimalMatch[0].length;
    const contextStart = Math.max(0, decimalStart - 24);
    const contextEnd = Math.min(text.length, decimalEnd + 24);
    const nearbyContext = text.slice(contextStart, contextEnd);
    const hasPriceContext = /(가격|금액|입금액|구매금액)/u.test(nearbyContext);
    const followingUnit = text.slice(decimalEnd).match(/^\s*(만|천|백)/u);

    if (hasPriceContext) {
      const compactValue = Number(`${decimalMatch[1]}.${decimalMatch[2]}`);
      if (Number.isFinite(compactValue) && compactValue > 0) {
        // 단위가 생략된 0.8/1.5/2.9는 '만 원' 단위로 본다.
        // 명시적으로 천/백 단위를 붙인 경우에는 그 단위를 우선한다.
        const multiplier = followingUnit?.[1] === '천'
          ? 1000
          : followingUnit?.[1] === '백'
            ? 100
            : 10000;
        return Math.round(compactValue * multiplier);
      }
    }
  }

  // 1. 순수 숫자 + 쉼표 형식 (예: 35,000원, 35000원)
  const directNumMatch = text.match(/([0-9,]+)\s*원/);
  if (directNumMatch) {
    const cleanNum = parseInt(directNumMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(cleanNum) && cleanNum > 0) {
      return cleanNum;
    }
  }

  // 2. 만원, 천원 복합 형식 (예: 3만 5천원, 3만원, 5천원, 2만500원)
  let total = 0;
  let hasUnit = false;

  const manMatch = text.match(/(\d+)\s*만/);
  if (manMatch) {
    total += parseInt(manMatch[1], 10) * 10000;
    hasUnit = true;
  }

  const cheonMatch = text.match(/(\d+)\s*천/);
  if (cheonMatch) {
    total += parseInt(cheonMatch[1], 10) * 1000;
    hasUnit = true;
  }

  const baekMatch = text.match(/(\d+)\s*백/);
  if (baekMatch) {
    total += parseInt(baekMatch[1], 10) * 100;
    hasUnit = true;
  }

  const wonRemainMatch = text.match(/(\d+)\s*원/);
  if (wonRemainMatch && !manMatch && !cheonMatch && !baekMatch) {
    total += parseInt(wonRemainMatch[1], 10);
    hasUnit = true;
  }

  if (hasUnit && total > 0) {
    return total;
  }

  // 3. 숫자만 추출
  const fallbackNum = text.match(/\b\d{3,7}\b/);
  if (fallbackNum) {
    return parseInt(fallbackNum[0], 10);
  }

  return null;
}

/**
 * 전사 문장에서 구매자 닉네임 추출
 */
export function parseBuyerNickname(text: string): string | null {
  if (!text) return null;

  // 패턴 1: "닉네임은 [xxx]님", "닉네임 [xxx]님", "[xxx]님 이시구요", "[xxx]님이"
  const p1 = text.match(/(?:닉네임은?|구매하신\s*분은?|구매자(?:는)?)\s*([가-힣a-zA-Z0-9_]{1,15})(?:\s*님|\s*이|\s*씨|\s*고객)/);
  if (p1 && p1[1]) {
    return p1[1].trim();
  }

  // 패턴 2: "[xxx]님 구매확정", "[xxx]님 결제"
  const p2 = text.match(/([가-힣a-zA-Z0-9_]{2,12})\s*님/);
  if (p2 && p2[1]) {
    const candidate = p2[1].trim();
    // 흔한 조사나 불용어 제외
    if (!['구매하신', '구매자', '고객', '손', '다음', '이번'].includes(candidate)) {
      return candidate;
    }
  }

  // 패턴 3: "닉네임 [xxx]"
  const p3 = text.match(/닉네임\s*([가-힣a-zA-Z0-9_]{2,12})/);
  if (p3 && p3[1]) {
    return p3[1].trim();
  }

  return null;
}

export interface ExtractedSaleResult {
  isSaleMent: boolean;
  buyerNickname: string;
  amount: number;
  status: SaleStatus;
  rawTranscript: string;
  isPending: boolean;
  matchedKeywords: string[];
}

/**
 * 실시간 전사 문장을 분석하여 판매 내역 정보 추출
 */
export function extractSaleFromTranscript(transcript: string, activeKeywords: string[] = []): ExtractedSaleResult | null {
  if (!transcript || transcript.trim().length < 3) return null;

  const text = transcript.trim();
  
  // 판매 멘트 감지 키워드 목록
  const saleTriggers = ['구매확정', '구매 확정', '구매하신 분', '구매하신분', '결제완료', '결제 완료', '주문확정', '낙찰', '판매완료'];
  const hasTrigger = saleTriggers.some(trigger => text.includes(trigger)) ||
    (text.includes('닉네임') && (text.includes('원') || text.includes('금액') || text.includes('가격')));

  if (!hasTrigger) {
    return null;
  }

  const matchedKeywords: string[] = [];
  [...saleTriggers, '닉네임', '금액', '가격', '원', '캡처', ...activeKeywords].forEach(kw => {
    if (text.includes(kw) && !matchedKeywords.includes(kw)) {
      matchedKeywords.push(kw);
    }
  });

  const nickname = parseBuyerNickname(text);
  const amount = parseKoreanAmount(text);

  // 닉네임이나 금액 중 하나라도 없으면 '보류' 상태로 지정
  const isPending = !nickname || !amount || amount <= 0;
  const status: SaleStatus = isPending ? '보류' : '자동저장';

  return {
    isSaleMent: true,
    buyerNickname: nickname || '미확인(보류)',
    amount: amount || 0,
    status,
    rawTranscript: text,
    isPending,
    matchedKeywords
  };
}
