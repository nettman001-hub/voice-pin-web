import { RoutingMode, AiLocation } from './aiSettings';

export type AiHealthOverallStatus =
  | 'UNCONFIGURED' // 미설정
  | 'CHECKING'     // 점검 중
  | 'PREPARING'    // 준비 중 (설치됨/로딩 중)
  | 'AVAILABLE'    // 사용 가능
  | 'DEGRADED'     // 지연
  | 'UNAVAILABLE'  // 사용 불가
  | 'RECOVERING'   // 복구 시험 중
  | 'EXPIRED';     // 상태 만료 (점검 결과 45초 이상 경과)

export interface AiTier1ConnectionResult {
  ok: boolean;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'SSRF_BLOCKED' | 'UNCONFIGURED';
  latencyMs?: number;
  message: string;
  testedAt: string;
}

export type Tier2ReadinessStatus =
  | 'READY'          // 모델 로딩 완료 및 준비됨
  | 'LOADING'        // 메모리 로딩 중
  | 'PREPARING'      // 설치되어 있으나 미로딩
  | 'NOT_INSTALLED'  // 모델 미설치
  | 'NOT_QUERYABLE'  // 원격 서버가 관리 API를 미제공 (장애로 간주하지 않음)
  | 'FAILED';        // 접근 실패

export interface AiTier2ModelReadinessResult {
  ok: boolean;
  status: Tier2ReadinessStatus;
  message: string;
  installedModels?: string[];
  runningModels?: Array<{
    name: string;
    size?: number;
    sizeVram?: number;
    expiresAt?: string;
  }>;
  testedAt: string;
}

export interface AiTier3ScenarioResult {
  scenarioId: 'PRICE_CORRECTION' | 'BUYER_CORRECTION' | 'AMBIGUOUS_CANDIDATES' | 'NEGATIVE_COMMAND' | 'INCOMPLETE_UTTERANCE';
  title: string;
  utterance: string;
  passed: boolean;
  expectedSummary: string;
  actualSummary: string;
  latencyMs: number;
  error?: string;
  details?: any;
}

export interface AiTier3SyntheticResult {
  ok: boolean;
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  totalLatencyMs: number;
  scenarios: AiTier3ScenarioResult[];
  message: string;
  testedAt: string;
}

export interface AiSlotHealth {
  slotNumber: 1 | 2;
  routeKey: string;
  routingMode: RoutingMode;
  location: AiLocation;
  executorId: string;
  endpointUrl: string;
  model: string;
  settingVersion: number;
  overallStatus: AiHealthOverallStatus;
  tier1: AiTier1ConnectionResult;
  tier2: AiTier2ModelReadinessResult;
  tier3: AiTier3SyntheticResult;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastLatencyMs?: number;
  lastCheckedAt: string;
  lastHealthyAt?: string;
  isExpired: boolean;
}

export interface CheckAiHealthPayload {
  slotNumber?: 1 | 2;
  tier?: 'TIER1' | 'TIER2' | 'TIER3' | 'ALL';
  workspaceId?: string;
  executorId?: string;
  deviceId?: string;
  tempSlotConfig?: any;
  newSecret?: string;
}

export interface AiHealthSummaryResponse {
  slot1: AiSlotHealth;
  slot2: AiSlotHealth;
  activePrimarySlot: 1 | 2;
  checkedAt: string;
}
