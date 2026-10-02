import type {
  AiResolutionRequest,
  AiResolutionResult,
} from '../../../../../src/types/aiResolution.ts';
import type { AiSlotConfig } from '../../../../../src/types/aiSettings.ts';
import { runSelfHostedResolution, type HelperDispatcherFn } from './selfHostedAdapter.ts';
import { runCloudResolution } from './cloudAdapter.ts';
import type { ConversationTraceListener } from './conversationTrace.ts';
export type { HelperDispatcherFn } from './selfHostedAdapter.ts';
import { runCloudPrompt } from './cloudAdapter.ts';
import { runSelfHostedPrompt } from './selfHostedAdapter.ts';
import type { AiPromptInput, AiPromptResult } from './promptTypes.ts';

export async function executeAiPrompt(prompt: AiPromptInput, options: ExecuteResolutionOptions): Promise<AiPromptResult> {
  const controller=new AbortController();
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline=new Promise<AiPromptResult>(resolve=>{
    timer=setTimeout(()=>{controller.abort();resolve({content:null,error:'AI 응답 대기시간 초과',errorCode:'TIMEOUT'});},options.slotConfig.timeoutSeconds*1000);
  });
  try {
    return await Promise.race([deadline,options.slotConfig.type === 'LOCAL'
      ? runSelfHostedPrompt(prompt, {...options,signal})
      : runCloudPrompt(prompt, { ...options,signal,secretApiKey: options.secretValue || '' })]);
  } finally {clearTimeout(timer);}
}

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
  signal?: AbortSignal;
  onConversationTrace?: ConversationTraceListener;
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
  const { slotConfig, secretValue, helperDispatcher, allowInsecureHttpForExternal, signal, onConversationTrace } = options;

  if (slotConfig.type === 'LOCAL') {
    return await runSelfHostedResolution(request, {
      slotConfig,
      secretValue,
      helperDispatcher,
      allowInsecureHttpForExternal,
      signal,
      onConversationTrace,
    });
  } else {
    return await runCloudResolution(request, {
      slotConfig,
      secretApiKey: secretValue || '',
      signal,
      onConversationTrace,
    });
  }
}
