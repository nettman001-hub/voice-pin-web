/**
 * 보안 및 프라이버시 보호를 위한 마스킹 유틸리티
 * PLAN.md 2, 6번 및 OWASP SSRF/보안 권고사항 준수
 */

/**
 * 접속 URL에서 인증정보(username:password), 쿼리스트링, 해시를 완전히 제거하고,
 * IP 주소의 민감 대역 또는 서브도메인을 안전하게 마스킹합니다.
 */
export function maskEndpointUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol; // e.g. "http:" or "https:"
    let host = parsed.hostname; // e.g. "192.168.0.5" or "api.openai.com"
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname !== '/' ? parsed.pathname : '';

    // IPv4 마스킹 (예: 192.168.1.55 -> 192.168.***.*** 또는 127.0.0.1 -> 127.0.0.1)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    if (ipv4Regex.test(host)) {
      const match = host.match(ipv4Regex)!;
      if (match[1] === '127' && match[2] === '0' && match[3] === '0' && match[4] === '1') {
        host = '127.0.0.1'; // 로컬 루프백은 명확히 표기
      } else {
        host = `${match[1]}.${match[2]}.***.***`;
      }
    } else if (host.length > 8 && host.includes('.')) {
      // 도메인 마스킹: 긴 내부 서브도메인 보호 (예: internal-ai-prod.corp.local -> in***.corp.local)
      const parts = host.split('.');
      if (parts.length >= 3 && parts[0].length > 4) {
        parts[0] = `${parts[0].slice(0, 2)}***`;
        host = parts.join('.');
      }
    }

    return `${protocol}//${host}${port}${pathname}`;
  } catch {
    // URL 파싱 실패 시 기본 안전 마스킹
    return trimmed.replace(/\/\/([^@]+@)/, '//***@').slice(0, 25) + '...';
  }
}

/**
 * API Key / Bearer 토큰 등 민감 비밀정보 마스킹 (예: sk-proj-123456789 -> sk-...6789)
 */
export function maskSecretKey(secret?: string): string {
  if (!secret || typeof secret !== 'string') return '';
  const trimmed = secret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '********';

  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}
