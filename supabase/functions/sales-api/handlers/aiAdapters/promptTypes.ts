import type { AiExecutionMeta } from "../../../../../src/types/aiResolution.ts";
export interface AiPromptInput {
  systemPrompt: string;
  userPrompt: string;
  /** Optional structured-analysis budget; existing report requests retain 4096. */
  maxOutputTokens?: number;
  /** Opt-in JSON Schema for engines that support constrained response output. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
}
export interface AiPromptResult {
  content: string | null;
  error?: string;
  errorCode?: "TIMEOUT" | "PROVIDER_ERROR" | "OUTPUT_LIMIT";
  execution?: AiExecutionMeta;
}
