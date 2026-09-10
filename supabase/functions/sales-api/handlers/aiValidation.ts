// SSRF 방지 및 외부 엔드포인트 보안 검증 (OWASP 기준)

export interface EndpointValidationOptions {
  endpointUrl: string;
  location?: 'SAME_PC' | 'LAN' | 'EXTERNAL_IP';
  routingMode?: 'SERVER_DIRECT' | 'PC_HELPER';
  authType?: 'NONE' | 'BEARER' | 'API_KEY' | 'CUSTOM_HEADER';
  hasSecret?: boolean;
  secretValue?: string;
  allowInsecureHttpForExternal?: boolean;
}

export interface EndpointValidationResult {
  valid: boolean;
  reason?: string;
  parsedUrl?: URL;
}

// 위험한 서비스 포트 (DB, SSH, 메일, 내부 캐시 등)
const FORBIDDEN_PORTS = new Set([
  21,   // FTP
  22,   // SSH
  23,   // Telnet
  25,   // SMTP
  53,   // DNS
  110,  // POP3
  143,  // IMAP
  3306, // MySQL
  5432, // PostgreSQL
  6379, // Redis
  9200, // Elasticsearch
  11211,// Memcached
  27017,// MongoDB
]);

/**
 * 기본 SSRF 방어 검증 (기존 호환성 유지)
 */
export function validateUrlForSsrf(
  urlStr: string,
  routingMode: 'SERVER_DIRECT' | 'PC_HELPER' = 'SERVER_DIRECT'
): { valid: boolean; reason?: string } {
  return validateExternalEndpoint({
    endpointUrl: urlStr,
    routingMode,
  });
}

/**
 * 외부 주소의 인증·TLS·주소·포트·기본 경로 통합 검증
 */
export function validateExternalEndpoint(
  options: EndpointValidationOptions
): EndpointValidationResult {
  const trimmed = (options.endpointUrl || '').trim();
  if (!trimmed) {
    return { valid: true }; // 빈 주소는 미설정 상태로 허용
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: '유효한 URL 형식이 아닙니다 (예: http:// 또는 https:// 필요).' };
  }

  // 1. 프로토콜 검증
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'HTTP 및 HTTPS 프로토콜만 지원합니다.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const routingMode = options.routingMode || 'SERVER_DIRECT';
  const location = options.location;

  // 2. 프로토콜 검증: 외부 공인 IP 및 도메인 서버도 HTTP 및 HTTPS 모두 지원
  // (사용자 요청에 따라 자체 구축 HTTP LLM 서버 연결 허용)

  // 3. 서버 직접 호출(SERVER_DIRECT) 시 내부 메타데이터 및 사설망 보호
  if (routingMode === 'SERVER_DIRECT') {
    // 3-1. 루프백 차단
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('127.')
    ) {
      return {
        valid: false,
        reason: '서버 직접 호출 모드에서는 로컬 루프백 주소(localhost, 127.0.0.1)를 사용할 수 없습니다. PC 도우미 경유 모드를 사용하세요.',
      };
    }

    // 3-2. 클라우드 메타데이터 엔드포인트 차단 (AWS, GCP, Azure, OpenStack 등)
    if (
      hostname === '169.254.169.254' ||
      hostname === '169.254.169.253' ||
      hostname === 'metadata.google.internal' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname === 'metadata'
    ) {
      return {
        valid: false,
        reason: '클라우드 내부 메타데이터 주소(169.254.x.x 또는 .internal)는 보안상 접근이 엄격히 금지되어 있습니다.',
      };
    }

    // 3-3. 외부 서버로 등록했는데 사설 IP(Private IP) 대역 입력 시 차단 (내부망 포트 스캐닝 방지)
    if (location === 'EXTERNAL_IP') {
      const isPrivateIp =
        hostname.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) ||
        hostname.startsWith('192.168.');
      if (isPrivateIp) {
        return {
          valid: false,
          reason: '외부 IP 서버 위치에는 사설 IP(10.x, 172.16~31.x, 192.168.x)를 지정할 수 없습니다. 공인 IP 또는 도메인을 입력하세요.',
        };
      }
    }
  }

  // 4. 포트 검증
  const portNumber = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
    return { valid: false, reason: '포트 번호가 올바르지 않습니다 (1 ~ 65535).' };
  }

  if (FORBIDDEN_PORTS.has(portNumber)) {
    return {
      valid: false,
      reason: `보안상 제한된 포트(${portNumber})로는 요청을 전송할 수 없습니다. 웹/AI 서비스 포트를 사용하세요.`,
    };
  }

  // 5. 기본 경로(Path) 검증: 상위 경로 탐색(Path traversal) 및 공백 차단
  const pathname = parsed.pathname;
  if (
    trimmed.includes('/..') ||
    trimmed.includes('../') ||
    pathname.includes('/../') ||
    pathname.endsWith('/..') ||
    trimmed.includes('\\')
  ) {
    return { valid: false, reason: '경로에 상위 디렉터리 순회(..)를 포함할 수 없습니다.' };
  }

  // 6. 인증 정보 유효성 검사
  if (options.authType && options.authType !== 'NONE') {
    const hasKey = options.hasSecret || Boolean(options.secretValue?.trim());
    if (!hasKey) {
      return {
        valid: false,
        reason: `인증 방식이 ${options.authType}로 설정되었으나 인증 비밀정보(Secret)가 제공되지 않았습니다.`,
      };
    }
  }

  return { valid: true, parsedUrl: parsed };
}

/**
 * 리디렉션(Open Redirect / SSRF 우회)을 차단하는 안전한 fetch 래퍼
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  validationOptions?: Partial<EndpointValidationOptions>
): Promise<Response> {
  const check = validateExternalEndpoint({
    endpointUrl: url,
    routingMode: validationOptions?.routingMode || 'SERVER_DIRECT',
    location: validationOptions?.location,
    authType: validationOptions?.authType,
    hasSecret: validationOptions?.hasSecret,
    secretValue: validationOptions?.secretValue,
    allowInsecureHttpForExternal: validationOptions?.allowInsecureHttpForExternal,
  });

  if (!check.valid) {
    throw new Error(`SSRF_OR_VALIDATION_ERROR: ${check.reason}`);
  }

  // OWASP 권고: SSRF 우회를 위한 HTTP 리디렉션 자동 추적 차단 ('error' 또는 'manual')
  const safeInit: RequestInit = {
    ...init,
    redirect: 'error', // 리디렉션 발생 시 즉시 Fetch 에러 발생
  };

  try {
    return await fetch(url, safeInit);
  } catch (err: any) {
    if (err.message && (err.message.includes('redirect') || err.message.includes('Redirect'))) {
      throw new Error('SECURITY_REDIRECT_BLOCKED: 보안상 외부 주소의 HTTP 리디렉션(3xx)은 차단됩니다.');
    }
    throw err;
  }
}

export function maskSecretValue(secret: string): string {
  const s = String(secret || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 3)}...${s.slice(-4)}`;
}
