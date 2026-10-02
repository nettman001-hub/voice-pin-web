import type { AiExecutionMeta } from "../../../../../src/types/aiResolution.ts";
export interface AiPromptInput {
  systemPrompt: string;
  userPrompt: string;
}
export interface AiPromptResult {
  content: string | null;
  error?: string;
  execution?: AiExecutionMeta;
}
