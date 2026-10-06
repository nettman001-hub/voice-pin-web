/**
 * 판매 적재 시 전역 유일 순차 상품명 자동 생성 유틸리티
 * 
 * 형식: 순번(3자리)-날짜(YYYYMMDD)-회차 (예: 001-20260929-1회차)
 * - 판매자 음성 발화에서 상품명을 추출하지 않고 시스템이 순번을 매겨 유일하게 부여합니다.
 * - 내일 1회차 상품명(001-20260930-1회차)과 중복되거나 혼동되지 않습니다.
 */
export function generateSequentialProductName(
  sessionDisplayCode?: string,
  sessionSalesCount: number = 0,
  fallbackDate?: string
): string {
  // 1. 순번 3자리 패딩 (001, 002, ... 099, 100 ...)
  const seqNumber = String(sessionSalesCount + 1).padStart(3, '0');

  // 2. 날짜 추출 (YYYYMMDD 8자리)
  const displayCode = String(sessionDisplayCode || '').trim();
  let datePart = '';
  const dateMatch = displayCode.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  if (dateMatch) {
    datePart = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}`;
  } else if (fallbackDate) {
    datePart = fallbackDate.replace(/[-.]/g, '').slice(0, 8);
  } else {
    // 한국 표준시(KST, UTC+9) 기준 오늘 날짜 생성
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    datePart = kst.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // 3. 방송 회차 추출 (예: "2026-09-29 라이브 1회차" -> "1회차")
  const sessionMatch = displayCode.match(/(\d+회차)/);
  const sessionPart = sessionMatch ? sessionMatch[1] : (displayCode || '1회차');

  // 4. 최종 전역 유일 상품명: "001-20260929-1회차"
  return `${seqNumber}-${datePart}-${sessionPart}`;
}

/**
 * 상품명 앞에 있는 순번 숫자(예: '001-20261006-1회차'의 '001')를
 * 회차 내 순번에 맞게 1씩 증가시켜 반환합니다.
 *
 * @param productName 기존 상품명 (예: '001-20261006-1회차', '01-데님자켓')
 * @param sequenceIndex 회차 내 1부터 시작하는 판매/상품 순번 (1, 2, 3...)
 * @param productCode (선택) 상품 코드
 */
export function formatSequentialProductName(
  productName: string | undefined | null,
  sequenceIndex: number,
  productCode?: string | null
): string | undefined {
  if (!productName || typeof productName !== 'string') {
    return undefined;
  }

  const trimmed = productName.trim();
  if (!trimmed) {
    return undefined;
  }

  const targetIndex = sequenceIndex > 0 ? sequenceIndex : 1;

  // 1. 만약 8자리 날짜(YYYYMMDD)로 시작하는 경우 (예: '20261006-1회차'), 앞에 '001-'을 붙여 적용
  if (/^\d{8}(-\d+회차)?/.test(trimmed)) {
    const padded = String(targetIndex).padStart(3, '0');
    return `${padded}-${trimmed}`;
  }

  // 2. 숫자로 시작하는 경우 (예: '001-20261006-1회차', '01-데님자켓', '1번 상품')
  const match = trimmed.match(/^(\d+)(.*)$/);
  if (match) {
    const origDigits = match[1];
    const rest = match[2];
    const padLength = Math.max(origDigits.length, 3);
    const padded = String(targetIndex).padStart(padLength, '0');
    return `${padded}${rest}`;
  }

  return trimmed;
}

