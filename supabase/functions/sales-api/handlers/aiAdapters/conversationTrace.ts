import type { AiConversationTrace } from '../../../../../src/types/aiTask.ts';

export type ConversationTraceListener = (trace: AiConversationTrace) => void;

export function redactConversationSecrets(value: string, secrets: string[]) {
  return secrets.filter(Boolean).reduce(
    (text, secret) => text.split(secret).join('[비밀정보 숨김]'), value,
  );
}

/** Only prompt/response text is recorded: never endpoints, headers or credentials. */
export function createConversationTraceRecorder(
  prompt: Pick<AiConversationTrace, 'systemPrompt' | 'userPrompt' | 'provider' | 'model'>,
  listener?: ConversationTraceListener,
  secrets: string[] = [],
) {
  let trace: AiConversationTrace | undefined;
  const publish = () => {
    if (trace && listener) listener({ ...trace });
  };
  return {
    dispatched() {
      trace = { ...prompt, requestStartedAt: new Date().toISOString() };
      publish();
    },
    received(responseText: string, httpStatus: number, responseKind: 'MODEL_OUTPUT' | 'HTTP_ERROR') {
      if (!trace) return;
      trace = { ...trace, responseText: redactConversationSecrets(responseText, secrets), httpStatus, responseKind,
        responseReceivedAt: new Date().toISOString() };
      publish();
    },
  };
}
