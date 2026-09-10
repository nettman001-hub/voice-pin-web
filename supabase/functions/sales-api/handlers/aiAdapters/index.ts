import type {
  AiResolutionRequest,
  AiResolutionResult,
} from '../../../../../src/types/aiResolution.ts';
import type { AiSlotConfig } from '../../../../../src/types/aiSettings.ts';
import { runSelfHostedResolution, type HelperDispatcherFn } from './selfHostedAdapter.ts';
import { runCloudResolution } from './cloudAdapter.ts';

export {
  parseKoreanSpokenPrice,
  buildResolutionPrompt,
  parseAndNormalizeAiOutput,
} from './common.ts';
export {
  runSelfHostedResolution,
} from './selfHostedAdapter.ts';
export {
  runCloudResolution,
} from './cloudAdapter.ts';

export interface ExecuteResolutionOptions {
  slotConfig: AiSlotConfig;
  secretValue?: string;
  helperDispatcher?: HelperDispatcherFn;
  allowInsecureHttpForExternal?: boolean;
}

/**
 * AI 어댑터 통합 디스패처
 * - slotConfig.type에 따라 자체 운영 어댑터(runSelfHostedResolution) 또는 클라우드 어댑터(runCloudResolution) 호출
 * - 동일한 규격의 AiResolutionResult 반환
 */
export async function executeAiResolution(
  request: AiResolutionRequest,
  options: ExecuteResolutionOptions
): Promise<AiResolutionResult> {
  const { slotConfig, secretValue, helperDispatcher, allowInsecureHttpForExternal } = options;

  if (slotConfig.type === 'LOCAL') {
    return await runSelfHostedResolution(request, {
      slotConfig,
      secretValue,
      helperDispatcher,
      allowInsecureHttpForExternal,
    });
  } else {
    return await runCloudResolution(request, {
      slotConfig,
      secretApiKey: secretValue || '',
    });
  }
}
