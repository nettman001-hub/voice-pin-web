import type { SaleRecord, SaleStatus } from '../types/live.ts';

/**
 * 한국어 금액 표현(예: "35,000원", "3만 5천원", "3만원", "42000원", "5천원")을 숫자(number)로 변환
 *
 * 라이브 판매에서 자주 쓰는 축약 발화도 지원한다.
 * "가격 0.8"은 0.8만 원, 즉 8,000원으로 해석한다.
 * 따라서 1.5 → 15,000원, 2.9 → 29,000원이다.
 */
const KOREAN_DIGIT_WORDS: Record<string, number> = {
  영: 0, 공: 0,
  일: 1, 하나: 1, 한: 1,
  이: 2, 둘: 2, 두: 2,
  삼: 3, 셋: 3, 세: 3,
  사: 4, 넷: 4, 네: 4,
  오: 5, 다섯: 5,
  육: 6, 여섯: 6,
  칠: 7, 일곱: 7,
  팔: 8, 여덟: 8,
  구: 9, 아홉: 9,
  십: 10
};

export function parseKoreanAmount(text: string): number | null {
  if (!text) return null;

  // 0. 사용자 명시 규칙: "소숫점 숫자가 나오면 무조건 가격을 말하는 것으로 확정한다. 예를 들어 '1.7' 이면 17,000원 이다."
  // 0-1) 한글 발음 소수 표현 (예: "일점칠", "이점오", "삼점오", "영점팔" 등)
  const koWordMatch = text.match(/([영공일이삼사오육칠팔구십]+)\s*(?:[.]|점)\s*([영공일이삼사오육칠팔구]+)/u);
  if (koWordMatch) {
    const wholeVal = KOREAN_DIGIT_WORDS[koWordMatch[1]];
    const fracVal = KOREAN_DIGIT_WORDS[koWordMatch[2]];
    if (wholeVal !== undefined && fracVal !== undefined) {
      const compactValue = wholeVal + fracVal / 10;
      return Math.round(compactValue * 10000);
    }
  }

  // 0-2) 숫자 소수 표현 (예: "1.7", "0.8", "2.5", "15.5", "1점7", "1.7만", "1.7원" 등)
  // 단, 날짜(2026.09.10)나 버전(1.2.3), 시/분/초 등은 제외
  const decimalMatch = text.match(/(?<!\d\.)(?<!\d)(\d{1,3})\s*(?:[.]|점)\s*(\d{1,2})(?!\.\d)(?!\s*(?:월|일|시|분|초|버전|ver))\b/u);
  if (decimalMatch) {
    const compactValue = Number(`${decimalMatch[1]}.${decimalMatch[2]}`);
    if (Number.isFinite(compactValue) && compactValue > 0) {
      const decimalStart = decimalMatch.index ?? 0;
      const decimalEnd = decimalStart + decimalMatch[0].length;
      const followingUnit = text.slice(decimalEnd).match(/^\s*(만|천|백)/u);
      const multiplier = followingUnit?.[1] === '천'
        ? 1000
        : followingUnit?.[1] === '백'
          ? 100
          : 10000;
      return Math.round(compactValue * multiplier);
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

  // 3. 숫자만 추출 (날짜나 버전 표시는 제외)
  const isDateOrVersion = /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/.test(text) || /\bv?\d+\.\d+\.\d+\b/i.test(text);
  if (!isDateOrVersion) {
    const fallbackNum = text.match(/\b\d{3,7}\b/);
    if (fallbackNum) {
      return parseInt(fallbackNum[0], 10);
    }
  }

  return null;
}

/**
 * 전사 문장에서 구매자 닉네임 추출
 */
export function parseBuyerNickname(text: string): string | null {
  if (!text) return null;

  // 패턴 0: 뒷번호/끝번호 4자리 호칭 ("뒷번호 0517님", "끝번호 1234님", "전화번호 뒤 0517님")
  const p0 = text.match(/(?:뒷\s*번호|끝\s*번호|뒤\s*번호|전화\s*번호\s*뒤|전화\s*뒤|뒷\s*자리|끝\s*자리|핸드폰\s*뒤|폰\s*뒤|번호)\s*[:：#]?\s*(\d{4})(?:\s*번)?(?:\s*님|\s*이|\s*씨|\s*고객)?/u);
  if (p0 && p0[1]) {
    return `뒷번호 ${p0[1]}`;
  }

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
  const hasDecimal = /(?<!\d\.)(?<!\d)\d{1,3}\s*(?:[.]|점)\s*\d{1,2}(?!\.\d)(?!\s*(?:월|일|시|분|초|버전|ver))\b/u.test(text) ||
    /([영공일이삼사오육칠팔구십]+)\s*(?:[.]|점)\s*([영공일이삼사오육칠팔구]+)/u.test(text);

  const hasTrigger = saleTriggers.some(trigger => text.includes(trigger)) ||
    (text.includes('닉네임') && (hasDecimal || text.includes('원') || text.includes('금액') || text.includes('가격'))) ||
    (hasDecimal && /(?:[가-힣a-zA-Z0-9_]{2,12}\s*님|뒷번호|끝번호|구매자)/u.test(text));

  if (!hasTrigger) {
    return null;
  }

  const matchedKeywords: string[] = [];
  [...saleTriggers, '닉네임', '금액', '가격', '원', '캡처', ...activeKeywords].forEach(kw => {
    if (text.includes(kw) && !matchedKeywords.includes(kw)) {
      matchedKeywords.push(kw);
    }
  });
  if (hasDecimal && !matchedKeywords.includes('소수점가격')) {
    matchedKeywords.push('소수점가격');
  }

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

/**
 * 단건 금액을 만 원 단위 소수점으로 변환 (예: 9,000원 -> "0.9", 17,000원 -> "1.7", 20,000원 -> "2.0")
 */
export function formatAmountAsDecimal(amount: number): string {
  if (!amount || amount <= 0) return '0.0';
  const val = amount / 10000;
  return val % 1 === 0 ? val.toFixed(1) : parseFloat(val.toFixed(2)).toString();
}

export interface MultiSaleAmountFormat {
  isMulti: boolean;
  itemDecimals: string[];
  decimalExpression: string;
  totalAmount: number;
  totalFormatted: string;
  displayFull: string;
}

/**
 * 다건/단건 구매자의 건당 소수점 금액 및 합계 금액 포맷팅
 * - 다건: 건당 금액은 소숫점으로 (예: 0.9) 표시하고 "+"를 붙이고 맨 뒤에 합계금액은 정상적인 금액표시로 쓴다. (예: "0.9 + 1.5 = 24,000원")
 * - 단건: "17,000원"
 */
export function formatMultiSaleAmount(amounts: number[]): MultiSaleAmountFormat {
  const validAmounts = (amounts || []).filter((a) => typeof a === 'number' && a > 0);
  const totalAmount = validAmounts.reduce((sum, a) => sum + a, 0);
  const totalFormatted = totalAmount > 0 ? `${totalAmount.toLocaleString()}원` : '금액 미확인';

  if (validAmounts.length <= 1) {
    return {
      isMulti: false,
      itemDecimals: validAmounts.map(formatAmountAsDecimal),
      decimalExpression: validAmounts.map(formatAmountAsDecimal).join(' + '),
      totalAmount,
      totalFormatted,
      displayFull: totalFormatted
    };
  }

  const itemDecimals = validAmounts.map(formatAmountAsDecimal);
  const decimalExpression = itemDecimals.join(' + ');
  const displayFull = `${decimalExpression} = ${totalFormatted}`;

  return {
    isMulti: true,
    itemDecimals,
    decimalExpression,
    totalAmount,
    totalFormatted,
    displayFull
  };
}
