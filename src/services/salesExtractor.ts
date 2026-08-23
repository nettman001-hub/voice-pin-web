import { SaleRecord, SaleStatus } from '../types/live';

/**
 * 한국어 금액 표현(예: "35,000원", "3만 5천원", "3만원", "42000원", "5천원")을 숫자(number)로 변환
 */
export function parseKoreanAmount(text: string): number | null {
  if (!text) return null;

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
