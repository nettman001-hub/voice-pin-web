import type { AiHealthSummaryResponse } from './aiHealth';
import type { AiRuntimeStatus } from './aiTask';
import type { AiSettings, AiSlotConfig } from './aiSettings';

export interface AiStatusSummaryResponse {
  runtimeStatus: AiRuntimeStatus;
  healthSummary: AiHealthSummaryResponse;
  settings: Pick<AiSettings, 'primarySlot' | 'appliedVersion'> & {
    slot1: Partial<AiSlotConfig>;
    slot2: Partial<AiSlotConfig>;
  };
}
