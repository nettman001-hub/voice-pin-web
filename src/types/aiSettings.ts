export type AiType = 'LOCAL' | 'CLOUD';
export type AiProvider = 'OLLAMA' | 'VLLM' | 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'DEEPSEEK' | 'CUSTOM';
export type AiLocation = 'SAME_PC' | 'LAN' | 'EXTERNAL_IP';
export type RoutingMode = 'SERVER_DIRECT' | 'PC_HELPER';
export type AiAuthType = 'NONE' | 'BEARER' | 'API_KEY' | 'CUSTOM_HEADER';

export interface AiSlotConfig {
  type: AiType;
  provider: AiProvider;
  model: string;
  location: AiLocation;
  endpointUrl: string;
  routingMode: RoutingMode;
  authType: AiAuthType;
  timeoutSeconds: number;
  connectTimeoutSeconds: number;
  customHeaderName?: string;
  hasSecret?: boolean;
  maskedSecret?: string;
}

export interface AiSettings {
  id?: string;
  scope: 'GLOBAL' | 'WORKSPACE';
  workspaceId?: string;
  version: number;
  appliedVersion: number;
  isDraft: boolean;
  enabledPendingResolution: boolean;
  enabledVoiceCorrection: boolean;
  primarySlot: 1 | 2;
  autoFallbackEnabled: boolean;
  recoveryIntervalSeconds: number;
  autoReturnToPrimary: boolean;
  cloudMonthlyBudgetKrw?: number | null;
  slot1: AiSlotConfig;
  slot2: AiSlotConfig;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SaveAiSettingsPayload {
  expectedVersion?: number;
  applyImmediately?: boolean;
  changeSummary?: string;
  settings: {
    enabledPendingResolution?: boolean;
    enabledVoiceCorrection?: boolean;
    primarySlot?: 1 | 2;
    autoFallbackEnabled?: boolean;
    recoveryIntervalSeconds?: number;
    autoReturnToPrimary?: boolean;
    cloudMonthlyBudgetKrw?: number | null;
    slot1?: Partial<AiSlotConfig> & { newSecret?: string; clearSecret?: boolean };
    slot2?: Partial<AiSlotConfig> & { newSecret?: string; clearSecret?: boolean };
  };
}

export interface AiConnectionTestResult {
  ok: boolean;
  slotNumber: 1 | 2;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'SSRF_BLOCKED';
  latencyMs?: number;
  message: string;
  testedAt: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  scope: 'GLOBAL',
  version: 1,
  appliedVersion: 1,
  isDraft: false,
  enabledPendingResolution: true,
  enabledVoiceCorrection: true,
  primarySlot: 1,
  autoFallbackEnabled: true,
  recoveryIntervalSeconds: 30,
  autoReturnToPrimary: true,
  cloudMonthlyBudgetKrw: null,
  slot1: {
    type: 'LOCAL',
    provider: 'OLLAMA',
    model: 'qwen2.5:7b',
    location: 'SAME_PC',
    endpointUrl: 'http://127.0.0.1:11434',
    routingMode: 'PC_HELPER',
    authType: 'NONE',
    timeoutSeconds: 20,
    connectTimeoutSeconds: 3,
    hasSecret: false,
  },
  slot2: {
    type: 'CLOUD',
    provider: 'OPENAI',
    model: 'gpt-4o-mini',
    location: 'EXTERNAL_IP',
    endpointUrl: '',
    routingMode: 'SERVER_DIRECT',
    authType: 'API_KEY',
    timeoutSeconds: 15,
    connectTimeoutSeconds: 3,
    hasSecret: false,
  },
};
