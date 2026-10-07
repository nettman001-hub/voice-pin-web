import { isSupabaseConfigured, requireSupabase } from "./supabaseClient";
import type { SellerLogicDeepInput } from "../types/sellerLogicDeep.ts";
import type { SellerLogicDeepCallResult } from "./sellerLogicDeepEngine.ts";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function invoke<T>(action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!isSupabaseConfigured) throw new Error("서버 연결 설정이 필요합니다.");
  const { data, error } = await requireSupabase().functions.invoke<Envelope<T>>("sales-api", {
    body: { action, ...payload }, signal,
  });
  signal?.throwIfAborted();
  if (error) {
    let message = error.message;
    try {
      const context = (error as { context?: Response }).context;
      if (context?.json) message = ((await context.json()) as Envelope<T>).error?.message || message;
    } catch { /* Preserve the original transport error. */ }
    throw new Error(message || "AI 심층 판매 분석 요청에 실패했습니다.");
  }
  if (!data?.ok || !data.data) throw new Error(data?.error?.message || "AI 심층 판매 분석 결과가 없습니다.");
  return data.data;
}

/** One time-bucket deep analysis on the selected AI slot. */
export function analyzeSellerLogicDeep(input: SellerLogicDeepInput, options: { signal?: AbortSignal } = {}): Promise<SellerLogicDeepCallResult> {
  return invoke<SellerLogicDeepCallResult>("seller-logic-deep", { input }, options.signal);
}

export interface SellerLogicDeepHintsResult {
  email: string;
  presetWords: string[];
  ruleWords: string[];
}

/** 1순위 판매자 등록 고정 발음 힌트 및 3순위 규칙 단어를 특정 계정(기본: nettman006@gmail.com)에서 조회 */
export function getSellerLogicDeepHints(email = 'nettman006@gmail.com', options: { signal?: AbortSignal } = {}): Promise<SellerLogicDeepHintsResult> {
  return invoke<SellerLogicDeepHintsResult>('seller-logic-deep-hints', { email }, options.signal);
}

export { getSellerLogicSlots } from "./sellerLogicApi.ts";
