/**
 * AI 작업 대기열, 타임아웃 및 서킷 브레이커 설정 상수 (PLAN.md 4, 8번 준수)
 * - 한 곳에서 집중 관리
 */

export const AI_TASK_CONFIG = {
  // 시작 제한 시간 (초 단위 기본값)
  TIMEOUTS: {
    CONNECT_SECONDS: 3,         // 연결 제한 시간: 3초
    SELF_HOSTED_SECONDS: 20,    // 자체 운영(로컬/외부) 분석 제한 시간: 20초
    CLOUD_SECONDS: 15,          // 클라우드 분석 제한 시간: 15초
  },

  // 서킷 브레이커 정책
  CIRCUIT_BREAKER: {
    FAIL_THRESHOLD: 2,          // 일시 장애 2회 연속 발생 시 회로 차단(우회)
    COOLDOWN_MS: 30 * 1000,     // 30초 동안 슬롯 1 우회 (슬롯 2로 바로 전달)
    RECOVERY_SUCCESS_THRESHOLD: 2, // 복구 시험 연속 2회 통과 시 다시 슬롯 1 복귀
  },

  // 작업 대기열 기본값
  QUEUE: {
    MAX_CONCURRENT_TASKS: 5,
    TASK_TIMEOUT_TOTAL_MS: 60 * 1000,
  },
} as const;
