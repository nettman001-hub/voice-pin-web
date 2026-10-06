import {
  SELLER_LOGIC_LIMITS,
  type SellerLogicAnalysisInput,
  type SellerLogicAnalysisResult,
  type SellerLogicAnalysisState,
  type SellerLogicMemoryItem,
} from '../types/sellerLogicAnalysis.ts';

const FRESH_CHARACTERS = 10_000;
type Source = { key: string; kind: 'C' | 'S'; id: string; time: number; characters: number };
type References = Pick<SellerLogicMemoryItem, 'commentIds' | 'transcriptIds'>;

function fail(message: string): never {
  throw new Error(`${message} 원문과 이전 결과는 보존되며 이 구간을 완료한 것으로 처리하지 않습니다.`);
}

function ids(value: unknown, known: Set<string>, label: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !known.has(id)) || new Set(value).size !== value.length) {
    return fail(`${label}의 원문 ID가 올바르지 않습니다.`);
  }
  return value;
}

/** Transport-only paging of one local linking window. No sale semantics or text truncation. */
export async function analyzeSellerLogicLinkWindow(
  input: SellerLogicAnalysisInput,
  invoke: (packet: SellerLogicAnalysisInput) => Promise<SellerLogicAnalysisResult>,
  options: { signal?: AbortSignal } = {},
): Promise<SellerLogicAnalysisResult> {
  options.signal?.throwIfAborted();
  const knownC = new Set(input.comments.map((row) => row.id));
  const knownS = new Set(input.transcripts.map((row) => row.id));
  if (knownC.size !== input.comments.length || knownS.size !== input.transcripts.length) fail('2차 분석 원문 ID가 중복되었습니다.');
  const events: Source[] = [
    ...input.comments.map((row): Source => ({ key: `C\0${row.id}`, kind: 'C', id: row.id, time: Date.parse(row.capturedAt), characters: JSON.stringify(row).length })),
    ...input.transcripts.map((row): Source => ({ key: `S\0${row.id}`, kind: 'S', id: row.id, time: Date.parse(row.recognizedAt), characters: JSON.stringify(row).length })),
  ].sort((a, b) => a.time - b.time);
  if (!events.length || events.some((row) => !Number.isFinite(row.time))) fail('2차 분석 원문 또는 시각을 확인해 주세요.');
  const processed = new Set<string>();
  let decisions = input.previousDecisions || [];
  let memory = input.analysisState?.memory || [];
  let appliedVersion = input.analysisState?.appliedVersion || 0;
  const intents = new Set(ids(input.analysisState?.purchaseIntentCommentIds || [], knownC, '기존 구매 의사'));
  const retracted = new Set<string>();

  const referenceKeys = (item: References, label: string): string[] => {
    if (!item || typeof item !== 'object') return fail(`${label} 근거가 올바르지 않습니다.`);
    return [...ids(item.commentIds, knownC, label).map((id) => `C\0${id}`),
      ...ids(item.transcriptIds, knownS, label).map((id) => `S\0${id}`)];
  };
  const mandatoryKeys = () => {
    const keys = new Set<string>();
    for (const item of input.linkSignals || []) referenceKeys(item, '감지 발화').forEach((key) => keys.add(key));
    for (const item of decisions) referenceKeys(item, '이전 거래').forEach((key) => keys.add(key));
    for (const item of memory) referenceKeys(item, 'AI 문맥').forEach((key) => keys.add(key));
    return keys;
  };

  const packetFor = (fresh: Source[], mandatory: Set<string>, page: number): SellerLogicAnalysisInput => {
    const freshKeys = new Set(fresh.map((row) => row.key));
    const selected = new Set([...mandatory, ...freshKeys]);
    const comments = input.comments.filter((row) => selected.has(`C\0${row.id}`));
    const transcripts = input.transcripts.filter((row) => selected.has(`S\0${row.id}`));
    return {
      sessionId: input.sessionId, slotNumber: input.slotNumber, comments, transcripts,
      previousDecisions: decisions, linkSignals: input.linkSignals,
      analysisState: {
        processedCommentIds: comments.filter((row) => !freshKeys.has(`C\0${row.id}`)).map((row) => row.id),
        processedTranscriptIds: transcripts.filter((row) => !freshKeys.has(`S\0${row.id}`)).map((row) => row.id),
        memory, purchaseIntentCommentIds: [...intents].filter((id) => selected.has(`C\0${id}`)),
        slotNumber: input.slotNumber, appliedVersion,
      },
      incremental: {
        newCommentIds: fresh.filter((row) => row.kind === 'C').map((row) => row.id),
        newTranscriptIds: fresh.filter((row) => row.kind === 'S').map((row) => row.id),
        historyQueries: input.incremental?.historyQueries || [],
        historyExhausted: input.incremental?.historyExhausted || false,
        omittedEvents: (input.incremental?.omittedEvents || 0) + events.length - selected.size,
        omittedDecisions: input.incremental?.omittedDecisions || 0,
      },
      linkWindow: { page, hasMore: processed.size + fresh.length < events.length,
        totalEvents: events.length, analyzedEvents: processed.size + fresh.length },
    };
  };
  const fits = (packet: SellerLogicAnalysisInput) => JSON.stringify(packet).length <= SELLER_LOGIC_LIMITS.packetCharacters;

  for (let page = 1; page <= events.length + 1; page++) {
    options.signal?.throwIfAborted();
    const mandatory = mandatoryKeys();
    const pending = events.filter((row) => !processed.has(row.key));
    if (!pending.length) return fail('2차 원문 분석의 진행 정보를 확인할 수 없습니다.');
    let fresh = pending;
    let packet = packetFor(fresh, mandatory, page);
    // Preserve the single-call path when the whole initial window fits.
    if (page > 1 || !fits(packet)) {
      if (!fits(packetFor([], mandatory, page))) fail('감지 발화·이전 거래·AI 문맥의 필수 근거가 32,000자 전송 한도를 초과했습니다.');
      fresh = [];
      let characters = 0;
      for (const row of pending) {
        if (fresh.length >= SELLER_LOGIC_LIMITS.windowEvents || characters + row.characters > FRESH_CHARACTERS) break;
        fresh.push(row);
        characters += row.characters;
      }
      if (!fresh.length) fail('분석 원문 한 행이 10,000자 전송 한도를 초과했습니다. 원문을 자동으로 자르지 않습니다.');
      packet = packetFor(fresh, mandatory, page);
      while (!fits(packet) && fresh.length > 1) {
        fresh = fresh.slice(0, -1);
        packet = packetFor(fresh, mandatory, page);
      }
      if (!fits(packet)) fail('필수 근거와 새 원문 한 행을 함께 보내면 32,000자 전송 한도를 초과합니다.');
    }

    const result = await invoke(packet);
    options.signal?.throwIfAborted();
    if (!result || typeof result !== 'object') fail('2차 AI 응답이 올바르지 않습니다.');
    if (result.historyRequests !== undefined) {
      if (!Array.isArray(result.historyRequests) || result.historyRequests.length > 3 || result.historyRequests.some((query) =>
        typeof query !== 'string' || !query.trim() || query.length > 80)) fail('AI 과거 근거 조회 형식이 올바르지 않습니다.');
      if (result.historyRequests.length) return result;
    }

    const sentC = new Set(packet.comments.map((row) => row.id)), sentS = new Set(packet.transcripts.map((row) => row.id));
    const state = result.analysisState;
    if (!state || state.slotNumber !== input.slotNumber || !Number.isSafeInteger(state.appliedVersion) || state.appliedVersion < 0 ||
        !Array.isArray(state.memory) || !Array.isArray(result.decisions)) fail('2차 AI의 처리 상태가 올바르지 않습니다.');
    const ackC = ids(state.processedCommentIds, sentC, '처리 댓글'), ackS = ids(state.processedTranscriptIds, sentS, '처리 발화');
    if (ackC.length !== sentC.size || ackS.length !== sentS.size) fail('2차 AI가 전송한 원문을 모두 처리하지 않았습니다.');
    const checkReferences = (item: References, label: string) => {
      if (!item || typeof item !== 'object') return fail(`${label}의 근거가 올바르지 않습니다.`);
      ids(item.commentIds, sentC, label); ids(item.transcriptIds, sentS, label);
    };
    state.memory.forEach((item) => checkReferences(item, 'AI 문맥'));
    result.decisions.forEach((item) => checkReferences(item, '거래'));
    const decisionIds = new Set(result.decisions.map((item) => item.id));
    if (result.decisions.some((item) => typeof item.id !== 'string' || !item.id) || decisionIds.size !== result.decisions.length ||
        decisions.some((item) => !decisionIds.has(item.id))) fail('2차 AI의 이전 거래가 누락되거나 ID가 중복되었습니다.');
    if (input.linkSignals?.length) {
      const signalIds = new Set(input.linkSignals.map((item) => item.id));
      if (!Array.isArray(result.signalLinks) || result.signalLinks.length !== signalIds.size ||
          new Set(result.signalLinks.map((item) => item.signalId)).size !== signalIds.size) fail('2차 AI의 발화 연결 결과가 누락되었습니다.');
      for (const link of result.signalLinks) {
        if (!signalIds.has(link.signalId) || !['MATCHED', 'UNMATCHED', 'NOT_SALE'].includes(link.outcome)) fail('2차 AI의 발화 연결 ID가 올바르지 않습니다.');
        ids(link.decisionIds, decisionIds, '발화 연결 거래');
        if ((link.outcome === 'MATCHED') !== Boolean(link.decisionIds.length)) fail('2차 AI의 발화 연결 상태가 올바르지 않습니다.');
      }
    }
    const added = ids(result.purchaseIntentCommentIds, sentC, '구매 의사');
    const removed = ids(result.retractedPurchaseIntentCommentIds || [], sentC, '철회 구매 의사');
    ids(state.purchaseIntentCommentIds, sentC, '처리 상태 구매 의사');
    if (added.some((id) => removed.includes(id))) fail('같은 구매 의사를 추가와 철회에 동시에 반환했습니다.');
    removed.forEach((id) => { intents.delete(id); retracted.add(id); });
    added.forEach((id) => { intents.add(id); retracted.delete(id); });
    fresh.forEach((row) => processed.add(row.key));
    decisions = result.decisions;
    memory = state.memory;
    appliedVersion = state.appliedVersion;
    if (processed.size === events.length) {
      const analysisState: SellerLogicAnalysisState = { ...state, memory, purchaseIntentCommentIds: [...intents],
        processedCommentIds: events.filter((row) => row.kind === 'C').map((row) => row.id),
        processedTranscriptIds: events.filter((row) => row.kind === 'S').map((row) => row.id) };
      return { ...result, decisions, analysisState, purchaseIntentCommentIds: [...intents],
        retractedPurchaseIntentCommentIds: [...retracted], hasMore: false };
    }
  }
  return fail('2차 원문 분석이 진행되지 않아 중지했습니다.');
}
