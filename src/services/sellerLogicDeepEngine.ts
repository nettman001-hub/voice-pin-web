import type { CommentRecord } from "../types/comment.ts";
import type { WorkflowTranscript } from "../types/salesWorkflow.ts";
import {
  SELLER_LOGIC_DEEP_LIMITS,
  type SellerLogicDeepContextItem,
  type SellerLogicDeepDecision,
  type SellerLogicDeepEngineState,
  type SellerLogicDeepInput,
  type SellerLogicDeepResult,
  type SellerLogicDeepSegment,
  type SellerLogicDeepSignal,
  type SellerLogicDeepWarning,
} from "../types/sellerLogicDeep.ts";
import { segmentSellerLogicDeepEvents, sellerLogicDeepSegmentSignature } from "./sellerLogicDeepSegmenter.ts";
import { sellerLogicDeepPrompt } from "./sellerLogicDeepContract.ts";

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

const promptBudget = SELLER_LOGIC_DEEP_LIMITS.promptCharacters - 200;
const packetDecisionLimit = 30;

/** The server limit counts the built system+user prompt, not the raw packet JSON. */
function promptCost(packet: SellerLogicDeepInput): number {
  const prompt = sellerLogicDeepPrompt(packet);
  return prompt.systemPrompt.length + prompt.userPrompt.length;
}

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

function assembleSafeDeepPacket(
  sessionId: string,
  slotNumber: 1 | 2,
  segment: SellerLogicDeepSegment,
  stateContext: SellerLogicDeepContextItem[],
  candidateDecisions: SellerLogicDeepDecision[],
  allComments: CommentRecord[],
  allTranscripts: WorkflowTranscript[],
  eventExists: Set<string>,
  budget: number,
): SellerLogicDeepInput {
  let currentSegment = { ...segment };
  let currentCommentIds = [...segment.commentIds];
  let currentTranscriptIds = [...segment.transcriptIds];

  const getEventTime = (key: string): number => {
    if (key.startsWith("C:")) {
      const c = allComments.find((row) => row.id === key.slice(2));
      return c ? Date.parse(c.capturedAt) : 0;
    } else {
      const t = allTranscripts.find((row) => row.id === key.slice(2));
      return t ? Date.parse(t.recognizedAt || t.startedAt || "") : 0;
    }
  };

  let segKeys = new Set<string>([
    ...currentCommentIds.map((id) => `C:${id}`),
    ...currentTranscriptIds.map((id) => `S:${id}`),
  ]);
  let basePacket = assemblePacket(sessionId, slotNumber, currentSegment, segKeys, [], [], allComments, allTranscripts);

  // 1. 세그먼트 단독으로도 예산을 초과하는 경우: 세그먼트 내 이벤트를 최신순으로 슬라이스
  if (promptCost(basePacket) > budget) {
    const allSegEvents = [
      ...currentCommentIds.map((id) => ({ key: `C:${id}`, id, kind: "C" as const, time: getEventTime(`C:${id}`) })),
      ...currentTranscriptIds.map((id) => ({ key: `S:${id}`, id, kind: "S" as const, time: getEventTime(`S:${id}`) })),
    ].sort((a, b) => a.time - b.time);

    let safeEvents = allSegEvents.slice(-1);
    for (let i = allSegEvents.length - 2; i >= 0; i--) {
      const nextCandidate = [allSegEvents[i], ...safeEvents];
      const testKeys = new Set(nextCandidate.map((e) => e.key));
      const testSeg: SellerLogicDeepSegment = {
        ...currentSegment,
        startedAt: new Date(nextCandidate[0].time).toISOString(),
        endedAt: new Date(nextCandidate[nextCandidate.length - 1].time).toISOString(),
        commentIds: nextCandidate.filter((e) => e.kind === "C").map((e) => e.id),
        transcriptIds: nextCandidate.filter((e) => e.kind === "S").map((e) => e.id),
      };
      const testPacket = assemblePacket(sessionId, slotNumber, testSeg, testKeys, [], [], allComments, allTranscripts);
      if (promptCost(testPacket) > budget) {
        break;
      }
      safeEvents = nextCandidate;
    }

    currentCommentIds = safeEvents.filter((e) => e.kind === "C").map((e) => e.id);
    currentTranscriptIds = safeEvents.filter((e) => e.kind === "S").map((e) => e.id);
    currentSegment = {
      ...currentSegment,
      startedAt: new Date(safeEvents[0].time).toISOString(),
      endedAt: new Date(safeEvents[safeEvents.length - 1].time).toISOString(),
      commentIds: currentCommentIds,
      transcriptIds: currentTranscriptIds,
    };
    segKeys = new Set(safeEvents.map((e) => e.key));

    basePacket = assemblePacket(sessionId, slotNumber, currentSegment, segKeys, [], [], allComments, allTranscripts);
    if (promptCost(basePacket) > budget) {
      const trimmedComments = basePacket.comments.map((c) => ({
        ...c,
        content: c.content.length > 500 ? `${c.content.slice(0, 500)}...` : c.content,
      }));
      const trimmedTranscripts = basePacket.transcripts.map((t) => ({
        ...t,
        text: t.text.length > 500 ? `${t.text.slice(0, 500)}...` : t.text,
      }));
      return {
        sessionId, slotNumber, segment: currentSegment,
        comments: trimmedComments,
        transcripts: trimmedTranscripts,
        context: [],
        previousDecisions: [],
      };
    }
    return basePacket;
  }

  // 2. 세그먼트 자체는 예산 내입니다. sendableContext를 가능한 만큼 추가합니다.
  const sendableContext = stateContext.filter((item) => item.commentIds.length > 0 || item.transcriptIds.length > 0);
  const activeKeys = new Set(segKeys);
  const activeContext: SellerLogicDeepContextItem[] = [];

  for (const item of sendableContext) {
    const itemRefs = [...item.commentIds.map((id) => `C:${id}`), ...item.transcriptIds.map((id) => `S:${id}`)]
      .filter((k) => eventExists.has(k) && !activeKeys.has(k));
    itemRefs.forEach((k) => activeKeys.add(k));
    const testPacket = assemblePacket(sessionId, slotNumber, currentSegment, activeKeys, [...activeContext, item], [], allComments, allTranscripts);
    if (promptCost(testPacket) > budget) {
      itemRefs.forEach((k) => activeKeys.delete(k));
      continue;
    }
    activeContext.push(item);
  }

  // 3. candidateDecisions를 예산이 허용하는 만큼 추가합니다.
  const activeDecisions: SellerLogicDeepDecision[] = [];
  for (const decision of candidateDecisions) {
    if (activeDecisions.length >= packetDecisionLimit) break;
    const refs = [...decision.commentIds.map((id) => `C:${id}`), ...decision.transcriptIds.map((id) => `S:${id}`)]
      .filter((key) => eventExists.has(key) && !activeKeys.has(key));
    refs.forEach((key) => activeKeys.add(key));
    const testPacket = assemblePacket(sessionId, slotNumber, currentSegment, activeKeys, activeContext, [...activeDecisions, decision], allComments, allTranscripts);
    if (promptCost(testPacket) > budget) {
      refs.forEach((key) => activeKeys.delete(key));
      continue;
    }
    activeDecisions.push(decision);
  }

  return assemblePacket(sessionId, slotNumber, currentSegment, activeKeys, activeContext, activeDecisions, allComments, allTranscripts);
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
    : { slotNumber: input.slotNumber, processedSegments: {}, context: [], unreviewedContext: [], decisions: [], stats: { segmentCalls: 0, segmentMs: 0 }, warnings: [] };
  if (!Array.isArray(state.unreviewedContext)) state.unreviewedContext = [];
  if (!Array.isArray(state.warnings)) state.warnings = [];
  const decisions = new Map(state.decisions.map((row) => [row.id, row]));
  const warnings = [...state.warnings];
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
    state.warnings = warnings.slice(-50);
    return {
      decisions: ordered, signals, context: state.context, unreviewedContext: state.unreviewedContext,
      segments, summary, provider, model, appliedVersion,
      stats: { ...state.stats }, state: structuredClone(state),
      warnings: state.warnings,
    };
  };

  const checkAbort = () => options.signal?.throwIfAborted();

  for (const segment of segments) {
    checkAbort();
    const signature = sellerLogicDeepSegmentSignature(segment, input.comments, input.transcripts);
    if (state.processedSegments[segment.id] === signature) continue;

    const candidates = [...decisions.values()].sort((a, b) => {
      const open = Number(b.status === "PENDING" || b.status === "REVIEW") - Number(a.status === "PENDING" || a.status === "REVIEW");
      return open || Date.parse(b.decidedAt) - Date.parse(a.decidedAt);
    });

    const packet = assembleSafeDeepPacket(
      input.sessionId,
      input.slotNumber,
      segment,
      state.context,
      candidates,
      input.comments,
      input.transcripts,
      eventExists,
      promptBudget,
    );

    const started = Date.now();
    state.stats.segmentCalls++;
    let result: SellerLogicDeepCallResult;
    try {
      result = await call(packet);
    } catch (error) {
      checkAbort();
      // AI 호출 실패 또는 계약 검증 에러 발생 시 전체 분석을 멈추지 않고 경고 목록에 남긴 뒤
      // 해당 시간대를 건너뛰고 다음 시간대 심층 분석을 계속 진행합니다.
      const errorMsg = error instanceof Error ? error.message : String(error);
      const startStr = new Date(segment.startedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const endStr = new Date(segment.endedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      warnings.push({
        id: `warn-${Date.now()}-${segment.id}`,
        at: new Date().toISOString(),
        segmentId: segment.id,
        message: `[시간대 ${segment.index + 1} (${startStr} ~ ${endStr})] ${errorMsg}`,
      });
      state.processedSegments[segment.id] = signature;
      options.onProgress?.(snapshot());
      continue;
    }
    checkAbort();
    state.stats.segmentMs += Date.now() - started;
    for (const decision of result.decisions) {
      // 동일 구매자의 동일 주문 건(중복 거래) 탐색 및 병합
      let existingKey: string | undefined;
      for (const [key, existing] of decisions.entries()) {
        if (key === decision.id) {
          existingKey = key;
          break;
        }
        const sameBuyer = existing.nickname && decision.nickname &&
          existing.nickname.trim().toLowerCase() === decision.nickname.trim().toLowerCase();
        if (!sameBuyer) continue;

        const sharesComment = decision.commentIds.some((cid) => existing.commentIds.includes(cid));
        const sameProduct = (existing.lineKey && decision.lineKey && existing.lineKey === decision.lineKey) ||
          (existing.orderCode && decision.orderCode && existing.orderCode === decision.orderCode) ||
          (!existing.lineKey && !decision.lineKey && !existing.orderCode && !decision.orderCode);
        const sameAmount = existing.unitPrice === decision.unitPrice && existing.quantity === decision.quantity;

        if (sharesComment || (sameProduct && sameAmount)) {
          existingKey = key;
          break;
        }
      }

      if (existingKey && existingKey !== decision.id) {
        const old = decisions.get(existingKey)!;
        decisions.delete(existingKey);
        const merged: SellerLogicDeepDecision = {
          ...decision,
          id: existingKey,
          commentIds: [...new Set([...old.commentIds, ...decision.commentIds])],
          transcriptIds: [...new Set([...old.transcriptIds, ...decision.transcriptIds])],
        };
        decisions.set(existingKey, merged);
      } else {
        decisions.set(decision.id, decision);
      }
    }
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
