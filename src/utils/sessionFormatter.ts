/**
 * 방송 회차 식별자를 사람이 알아볼 수 있는 친절하고 명확한 텍스트로 변환하는 유틸리티
 */

export interface SessionInfoLike {
  id: string;
  displayCode?: string | null;
  startedAt?: string | null;
}

export interface SessionFormatOptions {
  /** live_sessions 또는 cloudSessions 목록 또는 Map */
  sessions?: SessionInfoLike[] | Map<string, SessionInfoLike>;
  /** 해당 판매 건 등의 인식/생성 일시 (fallback 날짜 포맷팅용) */
  recognizedAt?: string | null;
  /** 짧은 표시 여부 */
  compact?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 어떤 형태의 세션 ID라도 사람이 한눈에 파악할 수 있는 일관된 방송 회차 명칭으로 변환합니다.
 * 
 * 변환 규칙:
 * 1. 제공된 세션 맵/목록에서 displayCode가 일치하는 경우 우선 반환 (예: "2026-09-29 라이브 1회차")
 * 2. 이미 "2026-09-29 라이브 1회차" 같은 정규 한글 회차 형태면 그대로 유지
 * 3. "2026-09-29 임시 회차" -> "2026-09-29 라이브 회차"
 * 4. UUID인 경우:
 *    - 인식 일시가 제공되면: "2026-09-29 14:30 방송 (#D6E8)"
 *    - 인식 일시가 없으면: "방송 회차 (#D6E8)"
 * 5. 타임스탬프 형식 (session_1727581234567 등) -> "2026-09-29 14:30 방송"
 * 6. 기타 긴 문자열 -> 축약 표기
 */
export function formatSessionDisplay(
  sessionId?: string | null,
  options?: SessionFormatOptions
): string {
  if (!sessionId || !sessionId.trim()) {
    return '진행 중 회차 없음';
  }

  const raw = sessionId.trim();

  // 1. 세션 맵이나 목록에서 매칭되는 displayCode 찾기
  if (options?.sessions) {
    let matched: SessionInfoLike | undefined;
    if (options.sessions instanceof Map) {
      matched = options.sessions.get(raw);
    } else if (Array.isArray(options.sessions)) {
      matched = options.sessions.find((s) => s.id === raw);
    }

    if (matched?.displayCode && matched.displayCode.trim()) {
      return matched.displayCode.trim();
    }
  }

  // 2. 이미 사람이 읽을 수 있는 한글 방송 회차 형식인 경우 (예: "2026-09-29 라이브 1회차")
  if (raw.includes('회차') && !raw.includes('임시')) {
    return raw;
  }

  // 3. 'YYYY-MM-DD 임시 회차' 형식인 경우
  if (/^\d{4}-\d{2}-\d{2}\s*임시\s*회차$/i.test(raw)) {
    const datePart = raw.split(/\s+/)[0];
    return `${datePart} 라이브 회차`;
  }

  // 4. 밀리초 타임스탬프 형식 (예: session_1727581234567 또는 1727581234567)
  const tsMatch = raw.match(/^(?:session_)?(\d{10,13})$/);
  if (tsMatch) {
    const num = parseInt(tsMatch[1], 10);
    const ms = num < 10000000000 ? num * 1000 : num;
    const date = new Date(ms);
    if (!isNaN(date.getTime())) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:${mm} 방송`;
    }
  }

  // 5. 날짜시간 결합 문자열 (예: 20260929-143000, 20260929_143000)
  const dtMatch = raw.match(/^(\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})/);
  if (dtMatch) {
    const [, y, m, d, hh, mm] = dtMatch;
    return `${y}-${m}-${d} ${hh}:${mm} 방송`;
  }

  // 6. UUID 형식인 경우
  if (UUID_REGEX.test(raw)) {
    const shortCode = raw.slice(0, 4).toUpperCase();
    if (options?.recognizedAt) {
      const date = new Date(options.recognizedAt);
      if (!isNaN(date.getTime())) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm} 방송 (#${shortCode})`;
      }
    }
    return `방송 회차 (#${shortCode})`;
  }

  // 7. fallback 날짜가 제공된 경우
  if (options?.recognizedAt) {
    const date = new Date(options.recognizedAt);
    if (!isNaN(date.getTime())) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:${mm} 방송`;
    }
  }

  // 8. 기타 지나치게 긴 문자열인 경우 축약
  if (raw.length > 24) {
    return `방송 회차 (${raw.slice(0, 6)}...${raw.slice(-4)})`;
  }

  return raw;
}
