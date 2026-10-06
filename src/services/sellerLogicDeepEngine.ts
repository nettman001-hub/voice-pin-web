import type { CommentRecord } from "../types/comment.ts";
import type { WorkflowTranscript } from "../types/salesWorkflow.ts";
import {
  type SellerLogicDeepContextItem,
  type SellerLogicDeepDecision,
  type SellerLogicDeepEngineState,
  type SellerLogicDeepInput,
  type SellerLogicDeepResult,
  type SellerLogicDeepSegment,
  type SellerLogicDeepSignal,
} from "../types/sellerLogicDeep.ts";
import { segmentSellerLogicDeepEvents, sellerLogicDeepSegmentSignature } from "./sellerLogicDeepSegmenter.ts";

export interface SellerLogicDeepCallResult {
  decisions: SellerLogicDeepDecision[];
  signals: SellerLogicDeepSignal[];
  context: SellerLogicDeepContextItem[];
  summary: string;
  provider: string;
  model: string;
  appliedVersion: number;
}

export interface SellerLogicDeepCall {
  (input: SellerLogicDeepInput): Promise<SellerLogicDeepCallResult>;
}

export interface SellerLogicDeepRunInput {
  sessionId: string;
  slotNumber: 1 | 2;
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
  state?: SellerLogicDeepEngineState;
}

export interface SellerLogicDeepRunResult extends SellerLogicDeepResult {
  /** Persist this between runs so unchanged buckets never pay another AI call. */
  state: SellerLogicDeepEngineState;
}

export interface SellerLogicDeepRunOptions {
  signal?: AbortSignal;
  onProgress?: (result: SellerLogicDeepRunResult) => void;
  now?: number;
}

const packetLimit = 28_000;
const packetDecisionLimit = 50;

function assemblePacket(
  sessionId: string,
  slotNumber: 1 | 2,
  segment: SellerLogicDeepSegment,
  keys: Set<string>,
  context: SellerLogicDeepContextItem[],
  previousDecisions: SellerLogicDeepDecision[],
  comments: CommentRecord[],
  transcripts: WorkflowTranscript[],
): SellerLogicDeepInput {
  return {
    sessionId, slotNumber, segment,
    comments: comments.filter((row) => keys.has(`C:${row.id}`)),
    transcripts: transcripts.filter((row) => keys.has(`S:${row.id}`)),
    context,
    previousDecisions,
  };
}

/** One deep AI call per changed time bucket; the browser owns the archive. */
export async function runSellerLogicDeep(
  input: SellerLogicDeepRunInput,
  call: SellerLogicDeepCall,
  options: SellerLogicDeepRunOptions = {},
): Promise<SellerLogicDeepRunResult> {
  const segments = segmentSellerLogicDeepEvents(input.comments, input.transcripts, { now: options.now ?? Date.now() });
  const state: SellerLogicDeepEngineState = input.state && input.state.slotNumber === input.slotNumber
    ? structuredClone(input.state)
    : { slotNumber: input.slotNumber, processedSegments: {}, context: [], unreviewedContext: [], decisions: [], stats: { segmentCalls: 0, segmentMs: 0 } };
  if (!Array.isArray(state.unreviewedContext)) state.unreviewedContext = [];
  const decisions = new Map(state.decisions.map((row) => [row.id, row]));
  const eventExists = new Set([
    ...input.comments.map((row) => `C:${row.id}`),
    ...input.transcripts.map((row) => `S:${row.id}`),
  ]);
  let signals: SellerLogicDeepSignal[] = [];
  let summary = "새로운 분석 자료가 없습니다.";
  let provider = state.provider || "";
  let model = state.model || "";
  let appliedVersion = state.appliedVersion ?? 0;

  const snapshot = (): SellerLogicDeepRunResult => {
    const ordered = [...decisions.values()].sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt) || a.id.localeCompare(b.id));
    state.decisions = ordered;
    state.provider = provider;
    state.model = model;
    state.appliedVersion = appliedVersion;
    return {
      decisions: ordered, signals, context: state.context, unreviewedContext: state.unreviewedContext,
      segments, summary, provider, model, appliedVersion,
      stats: { ...state.stats }, state: structuredClone(state),
    };
  };

  const checkAbort = () => options.signal?.throwIfAborted();

  for (const segment of segments) {
    checkAbort();
    const signature = sellerLogicDeepSegmentSignature(segment, input.comments, input.transcripts);
    if (state.processedSegments[segment.id] === signature) continue;
    const keys = new Set<string>();
    segment.commentIds.forEach((id) => keys.add(`C:${id}`));
    segment.transcriptIds.forEach((id) => keys.add(`S:${id}`));
    // Evidence-less carry is preserved for the screen but never sent back to the AI.
    const sendableContext = state.context.filter((item) => item.commentIds.length > 0 || item.transcriptIds.length > 0);
    for (const item of sendableContext) {
      for (const key of [...item.commentIds.map((id) => `C:${id}`), ...item.transcriptIds.map((id) => `S:${id}`)]) {
        if (eventExists.has(key)) keys.add(key);
      }
    }
    const candidates = [...decisions.values()].sort((a, b) => {
      const open = Number(b.status === "PENDING" || b.status === "REVIEW") - Number(a.status === "PENDING" || a.status === "REVIEW");
      return open || Date.parse(b.decidedAt) - Date.parse(a.decidedAt);
    });
    const previousDecisions: SellerLogicDeepDecision[] = [];
    for (const decision of candidates) {
      if (previousDecisions.length >= packetDecisionLimit) break;
      const refs = [...decision.commentIds.map((id) => `C:${id}`), ...decision.transcriptIds.map((id) => `S:${id}`)]
        .filter((key) => eventExists.has(key) && !keys.has(key));
      refs.forEach((key) => keys.add(key));
      const candidatePacket = assemblePacket(input.sessionId, input.slotNumber, segment, keys, sendableContext,
        [...previousDecisions, decision], input.comments, input.transcripts);
      if (JSON.stringify(candidatePacket).length > packetLimit) {
        refs.forEach((key) => keys.delete(key));
        continue;
      }
      previousDecisions.push(decision);
    }
    const packet = assemblePacket(input.sessionId, input.slotNumber, segment, keys, sendableContext, previousDecisions, input.comments, input.transcripts);
    const started = Date.now();
    state.stats.segmentCalls++;
    const result = await call(packet);
    checkAbort();
    state.stats.segmentMs += Date.now() - started;
    for (const decision of result.decisions) decisions.set(decision.id, decision);
    state.context = result.context;
    const unreviewed = new Map(state.unreviewedContext.map((item) => [item.text, item]));
    for (const item of result.context) {
      if (!item.commentIds.length && !item.transcriptIds.length) unreviewed.set(item.text, { ...item, sourcesMissing: true });
    }
    state.unreviewedContext = [...unreviewed.values()];
    signals = result.signals;
    summary = result.summary;
    provider = result.provider;
    model = result.model;
    appliedVersion = result.appliedVersion;
    state.processedSegments[segment.id] = signature;
    options.onProgress?.(snapshot());
  }
  state.decisions = [...decisions.values()];
  return snapshot();
}
