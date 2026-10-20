import { readOperationalAiSetting } from '../../../../src/services/aiAppliedSettings.ts';
import { admin } from '../../_shared/productSales.ts';

// The editor keeps draft values in ai_settings. Runtime requests must use the
// snapshot of the last applied version until that draft is applied.
export async function getOperationalAiSetting(): Promise<any | null> {
  return readOperationalAiSetting(admin);
}

export function getPrimaryAiSlot(setting: any): 1 | 2 {
  return setting?.primary_slot === 2 ? 2 : 1;
}
