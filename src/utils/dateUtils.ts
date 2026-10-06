/**
 * 날짜 및 시간 포맷팅 유틸리티
 * 데이터베이스(Supabase) 등에 저장된 UTC ISO 타임스탬프를 한국 표준시(KST, Asia/Seoul)로 안전하게 표시합니다.
 */

/**
 * ISO 시각 문자열 또는 Date 객체를 한국 표준시(KST, Asia/Seoul) 기준 "HH:mm:ss" 형식으로 포맷팅
 * 예: "2026-10-06T14:04:40Z" -> "23:04:40"
 */
export function formatTimeKST(dateInput?: string | Date | null): string {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '-';
  }
}

/**
 * ISO 시각 문자열 또는 Date 객체를 한국 표준시(KST, Asia/Seoul) 기준 "YYYY-MM-DD HH:mm:ss" 형식으로 포맷팅
 * 예: "2026-10-06T14:04:40Z" -> "2026-10-06 23:04:40"
 */
export function formatDateTimeKST(dateInput?: string | Date | null): string {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '-';
  try {
    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

    const timePart = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);

    return `${datePart} ${timePart}`;
  } catch {
    return '-';
  }
}
