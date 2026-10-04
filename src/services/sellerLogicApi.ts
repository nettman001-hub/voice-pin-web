import { isSupabaseConfigured, requireSupabase } from "./supabaseClient";
import type { SellerLogicAnalysisInput, SellerLogicAnalysisResult, SellerLogicSlots } from "../types/sellerLogicAnalysis";
import { prepareSellerLogicPacket } from "./sellerLogicPacket";
import { runSellerLogicPipeline } from './sellerLogicPipeline';
import type { SellerLogicDetectionResult } from '../types/sellerLogicPipeline';

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
    throw new Error(message || "AI 판매 분석 요청에 실패했습니다.");
  }
  if (!data?.ok || !data.data) throw new Error(data?.error?.message || "AI 판매 분석 결과가 없습니다.");
  return data.data;
}

export function getSellerLogicSlots(): Promise<SellerLogicSlots> {
  return invoke<SellerLogicSlots>('seller-logic-slots');
}

export interface SellerLogicAnalysisOptions {
  signal?: AbortSignal;
  live?: boolean;
  now?: number;
  /** Every validated batch is available immediately, including on later failure. */
  onProgress?: (result: SellerLogicAnalysisResult) => void;
}

export function analyzeSellerLogic(input: SellerLogicAnalysisInput, options: SellerLogicAnalysisOptions = {}): Promise<SellerLogicAnalysisResult> {
  return runSellerLogicPipeline(input, {
    detect: (packet) => invoke<SellerLogicDetectionResult>('seller-logic-detect', { input: packet }, options.signal),
    link: (packet) => invoke<SellerLogicAnalysisResult>('seller-logic-analysis', { input: packet }, options.signal),
  }, options);
}

/** Bounded archival evidence processing; live entry point is the two-stage pipeline above. */
export async function analyzeSellerLogicEvidence(input: SellerLogicAnalysisInput, options: SellerLogicAnalysisOptions = {}): Promise<SellerLogicAnalysisResult> {
  let current = { ...input, analysisState: input.analysisState?.slotNumber === input.slotNumber ? input.analysisState : undefined };
  const knownC = new Set(input.comments.map((row) => row.id)), knownS = new Set(input.transcripts.map((row) => row.id));
  const validIds = (ids: unknown, known: Set<string>): ids is string[] => Array.isArray(ids) &&
    ids.every((id) => typeof id === 'string' && known.has(id)) && new Set(ids).size === ids.length;
  if (current.analysisState && (!validIds(current.analysisState.processedCommentIds, knownC) ||
      !validIds(current.analysisState.processedTranscriptIds, knownS))) throw new Error('기존 분석 진행 정보가 원문과 일치하지 않습니다.');
  const memoryKey = (item: SellerLogicAnalysisResult['analysisState']['memory'][number]) => JSON.stringify(item);
  let last: SellerLogicAnalysisResult | undefined;
  for (let batch = 0; batch <= knownC.size + knownS.size; batch++) {
    options.signal?.throwIfAborted();
    let packet = prepareSellerLogicPacket(current);
    if (!packet) return last || {
      decisions: current.previousDecisions || [], purchaseIntentCommentIds: current.analysisState?.purchaseIntentCommentIds || [],
      summary: '새로운 분석 자료가 없습니다.', provider: '', model: '', hasMore: false,
      analysisState: current.analysisState || { processedCommentIds: [], processedTranscriptIds: [], memory: [], purchaseIntentCommentIds: [], slotNumber: input.slotNumber, appliedVersion: 0 },
    };
    let result = await invoke<SellerLogicAnalysisResult>('seller-logic-analysis', { input: packet }, options.signal);
    options.signal?.throwIfAborted();
    if (result.historyRequests?.length) {
      if (result.historyRequests.length > 3 || result.historyRequests.some((query) => typeof query !== 'string' || !query.trim() || query.length > 80)) {
        throw new Error('AI 과거 근거 조회 형식이 올바르지 않습니다.');
      }
      const expanded = prepareSellerLogicPacket(current, result.historyRequests);
      if (!expanded || JSON.stringify(expanded.incremental?.newCommentIds) !== JSON.stringify(packet.incremental?.newCommentIds) ||
          JSON.stringify(expanded.incremental?.newTranscriptIds) !== JSON.stringify(packet.incremental?.newTranscriptIds)) {
        throw new Error('과거 조회 중 새 분석 구간이 변경되었습니다. 원문은 유지됩니다.');
      }
      packet = expanded;
      result = await invoke<SellerLogicAnalysisResult>('seller-logic-analysis', { input: packet }, options.signal);
      options.signal?.throwIfAborted();
      if (result.historyRequests?.length) throw new Error('AI가 과거 근거 조회를 완료하지 못했습니다. 원문과 완료된 결과는 유지됩니다.');
    }
    const state = result.analysisState, fresh = packet.incremental!;
    const sentC = new Set(packet.comments.map((row) => row.id)), sentS = new Set(packet.transcripts.map((row) => row.id));
    if (!state || state.slotNumber !== input.slotNumber || !Number.isSafeInteger(state.appliedVersion) || state.appliedVersion < 0 ||
        !validIds(state.processedCommentIds, sentC) || !validIds(state.processedTranscriptIds, sentS) ||
        fresh.newCommentIds.some((id) => !state.processedCommentIds.includes(id)) ||
        fresh.newTranscriptIds.some((id) => !state.processedTranscriptIds.includes(id)) ||
        !validIds(result.purchaseIntentCommentIds, sentC) || !Array.isArray(state.memory) || !Array.isArray(result.decisions)) {
      throw new Error('AI 분석 진행 정보가 이번 전송 구간과 일치하지 않습니다. 원문과 완료된 결과는 유지됩니다.');
    }
    const retracted = result.retractedPurchaseIntentCommentIds || [];
    if (!validIds(retracted, sentC) || state.memory.some((item) => !item || typeof item.text !== 'string' ||
        !validIds(item.commentIds, sentC) || !validIds(item.transcriptIds, sentS)) ||
        result.decisions.some((decision) => !decision || typeof decision.id !== 'string' ||
          !validIds(decision.commentIds, sentC) || !validIds(decision.transcriptIds, sentS)) ||
        new Set(result.decisions.map((decision) => decision.id)).size !== result.decisions.length ||
        packet.previousDecisions?.some((decision) => !result.decisions.some((next) => next.id === decision.id))) {
      throw new Error('AI 분석 결과의 근거 또는 이전 거래가 누락되었습니다.');
    }
    const decisions = new Map((current.previousDecisions || []).map((decision) => [decision.id, decision]));
    result.decisions.forEach((decision) => decisions.set(decision.id, decision));
    const replacedMemory = new Set((packet.analysisState?.memory || []).map(memoryKey));
    const memories = new Map([
      ...(current.analysisState?.memory || []).filter((item) => !replacedMemory.has(memoryKey(item))), ...state.memory,
    ].map((item) => [memoryKey(item), item]));
    const intents = [...new Set([...(current.analysisState?.purchaseIntentCommentIds || []).filter((id) => !retracted.includes(id)), ...result.purchaseIntentCommentIds])];
    const nextState = { ...state, memory: [...memories.values()], purchaseIntentCommentIds: intents,
      processedCommentIds: [...new Set([...(current.analysisState?.processedCommentIds || []), ...fresh.newCommentIds])],
      processedTranscriptIds: [...new Set([...(current.analysisState?.processedTranscriptIds || []), ...fresh.newTranscriptIds])],
    };
    last = { ...result, decisions: [...decisions.values()], purchaseIntentCommentIds: intents, analysisState: nextState,
      hasMore: nextState.processedCommentIds.length + nextState.processedTranscriptIds.length < knownC.size + knownS.size };
    current = { ...input, previousDecisions: last.decisions, analysisState: nextState };
    options.onProgress?.(last);
    options.signal?.throwIfAborted();
    if (!last.hasMore) return last;
  }
  throw new Error('AI 분석 구간을 완료하지 못했습니다. 완료된 결과와 원문은 유지됩니다.');
}
