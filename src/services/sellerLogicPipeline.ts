import type { SellerLogicAnalysisInput, SellerLogicAnalysisResult, SellerLogicDecision } from '../types/sellerLogicAnalysis.ts';
import { SELLER_LOGIC_LIMITS } from '../types/sellerLogicAnalysis.ts';
import { analyzeSellerLogicLinkWindow } from './sellerLogicLinkWindow.ts';
import type { SellerLogicCarry, SellerLogicDetectionInput, SellerLogicDetectionResult, SellerLogicPipelineState, SellerLogicSignal } from '../types/sellerLogicPipeline.ts';

type Event = { key: string; id: string; kind: 'C' | 'S'; start: number; end: number; signature: string };
type Calls = {
  detect: (input: SellerLogicDetectionInput) => Promise<SellerLogicDetectionResult>;
  link: (input: SellerLogicAnalysisInput) => Promise<SellerLogicAnalysisResult>;
};
export interface SellerLogicPipelineOptions {
  live?: boolean;
  now?: number;
  signal?: AbortSignal;
  onProgress?: (result: SellerLogicAnalysisResult) => void;
}
const unique = (ids: string[]) => [...new Set(ids)];
const references = (item: { commentIds: string[]; transcriptIds: string[] }) => [
  ...item.commentIds.map((id) => `C:${id}`), ...item.transcriptIds.map((id) => `S:${id}`),
];
const carryKey = (item: SellerLogicCarry) => JSON.stringify(item);

/** The browser owns the archive and clocks; both semantic stages belong to AI. */
export async function runSellerLogicPipeline(input: SellerLogicAnalysisInput, calls: Calls, options: SellerLogicPipelineOptions = {}): Promise<SellerLogicAnalysisResult> {
  const events: Event[] = [
    ...input.comments.map((row) => ({ key: `C:${row.id}`, id: row.id, kind: 'C' as const,
      start: Date.parse(row.capturedAt), end: Date.parse(row.capturedAt), signature: JSON.stringify([row.content, row.nickname, row.capturedAt]) })),
    ...input.transcripts.map((row) => ({ key: `S:${row.id}`, id: row.id, kind: 'S' as const,
      start: Date.parse(row.startedAt || row.recognizedAt), end: Date.parse(row.endedAt || row.recognizedAt),
      signature: JSON.stringify([row.text, row.recognizedAt, row.startedAt, row.endedAt, row.isFinal, row.utteranceId, row.utteranceEnded, row.revision, row.endReason]) })),
  ].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
  const byKey = new Map(events.map((row) => [row.key, row]));
  if (byKey.size !== events.length || events.some((row) => !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end < row.start)) throw new Error('원문 ID 또는 시각이 올바르지 않습니다.');
  const saved = input.pipeline?.slotNumber === input.slotNumber ? input.pipeline : undefined;
  const pipeline: SellerLogicPipelineState = saved ? structuredClone(saved) : {
    slotNumber: input.slotNumber, seenRevisions: {}, carry: [], signals: [], observedThrough: 0,
    stats: { detectCalls: 0, linkCalls: 0, detectMs: 0, linkMs: 0 },
  };
  const decisions = new Map((input.previousDecisions || []).map((row) => [row.id, row]));
  const intents = new Set(input.analysisState?.purchaseIntentCommentIds || []);
  let appliedVersion = pipeline.appliedVersion || input.analysisState?.appliedVersion || 0, provider = pipeline.provider || '', model = pipeline.model || '', summary = '새로운 분석 자료가 없습니다.';
  const checkAbort = () => options.signal?.throwIfAborted();
  const clock = () => options.now ?? Date.now();
  const visible = () => options.live ? events : events.filter((row) => pipeline.seenRevisions[row.key] !== undefined);
  const source = (keys: Set<string>) => ({ comments: input.comments.filter((row) => keys.has(`C:${row.id}`)),
    transcripts: input.transcripts.filter((row) => keys.has(`S:${row.id}`)) });
  const snapshot = (): SellerLogicAnalysisResult => ({
    decisions: [...decisions.values()], purchaseIntentCommentIds: [...intents], summary, provider, model,
    analysisState: {
      processedCommentIds: input.comments.filter((row) => pipeline.seenRevisions[`C:${row.id}`] !== undefined).map((row) => row.id),
      processedTranscriptIds: input.transcripts.filter((row) => pipeline.seenRevisions[`S:${row.id}`] !== undefined).map((row) => row.id),
      memory: [], purchaseIntentCommentIds: [...intents], slotNumber: input.slotNumber, appliedVersion,
    },
    hasMore: events.some((row) => pipeline.seenRevisions[row.key] !== row.signature) || pipeline.signals.some((signal) => signal.needsAnalysis),
    pipeline: structuredClone(pipeline),
  });
  const publish = () => { checkAbort(); pipeline.provider = provider; pipeline.model = model; pipeline.appliedVersion = appliedVersion; options.onProgress?.(snapshot()); checkAbort(); };
  const includeRefs = (keys: Set<string>, item: { commentIds: string[]; transcriptIds: string[] }) => {
    for (const key of references(item)) { if (!byKey.has(key)) throw new Error('보관된 발화 근거를 원문에서 찾을 수 없습니다.'); keys.add(key); }
  };
  const candidateEvents = (signal: SellerLogicSignal) => visible().filter((row) =>
    row.end >= Date.parse(signal.startedAt) - 60_000 && row.start <= Date.parse(signal.observedUntil));
  const fingerprint = (signal: SellerLogicSignal) => JSON.stringify(candidateEvents(signal).map((row) => [row.key, row.signature]));

  const analyzeSignals = async (now: number, finishing = false) => {
    const due = pipeline.signals.filter((signal) => {
      if (signal.needsAnalysis) return true;
      const changed = fingerprint(signal) !== signal.lastAnalyzedFingerprint;
      if (!changed) {
        if (finishing || now >= Date.parse(signal.observedUntil)) signal.observationClosed = true;
        return false;
      }
      return signal.observationClosed || finishing || now >= Date.parse(signal.observedUntil);
    });
    while (due.length) {
      checkAbort();
      const first = due.shift()!;
      const group = [first];
      // Overlapping windows can share one source packet while retaining separate
      // candidate IDs. Never group by nickname or guessed product identity.
      for (let index = 0; index < due.length && group.length < 10;) {
        const next = due[index];
        if (Date.parse(next.startedAt) - 60_000 <= Date.parse(first.observedUntil) && Date.parse(next.observedUntil) >= Date.parse(first.startedAt) - 60_000) {
          group.push(next); due.splice(index, 1);
        } else index++;
      }
      const baseKeys = new Set(group.flatMap((signal) => candidateEvents(signal).map((row) => row.key)));
      group.forEach((signal) => includeRefs(baseKeys, signal));
      const previous = [...decisions.values()].filter((decision) => group.some((signal) => signal.decisionIds.includes(decision.id)) || references(decision).some((key) => baseKeys.has(key)));
      previous.forEach((decision) => includeRefs(baseKeys, decision));
      const makePacket = (queries: string[] = []): SellerLogicAnalysisInput => {
        const keys = new Set(baseKeys);
        const extraDecisions: SellerLogicDecision[] = [];
        for (const query of queries) {
          const literal = query.toLocaleLowerCase();
          const available = visible();
          const found = available.filter((event) => {
            const raw = event.kind === 'C' ? input.comments.find((row) => row.id === event.id) : input.transcripts.find((row) => row.id === event.id);
            return JSON.stringify(raw).toLocaleLowerCase().includes(literal);
          }).slice(-6);
          for (const hit of found) {
            const index = available.indexOf(hit);
            available.slice(Math.max(0, index - 3), index + 4).forEach((row) => keys.add(row.key));
          }
          for (const decision of decisions.values()) {
            if ([decision.nickname, decision.productName, decision.spokenNickname, decision.orderCode].filter(Boolean).join(' ').toLocaleLowerCase().includes(literal)) {
              includeRefs(keys, decision); extraDecisions.push(decision);
            }
          }
        }
        const packetPrevious = [...new Map([...previous, ...extraDecisions].map((row) => [row.id, row])).values()];
        const rows = source(keys);
        const packet: SellerLogicAnalysisInput = { sessionId: input.sessionId, slotNumber: input.slotNumber, ...rows,
          previousDecisions: packetPrevious,
          analysisState: { processedCommentIds: [], processedTranscriptIds: [], memory: [],
            purchaseIntentCommentIds: [...intents].filter((id) => rows.comments.some((row) => row.id === id) && packetPrevious.some((decision) => decision.commentIds.includes(id))),
            slotNumber: input.slotNumber, appliedVersion },
          linkSignals: group.map(({ id, summary, commentIds, transcriptIds }) => ({ id, summary, commentIds, transcriptIds })),
          incremental: { newCommentIds: rows.comments.map((row) => row.id), newTranscriptIds: rows.transcripts.map((row) => row.id),
            historyQueries: queries, historyExhausted: queries.length > 0, omittedEvents: visible().filter((row) => !keys.has(row.key)).length,
            omittedDecisions: decisions.size - packetPrevious.length },
        };
        return packet;
      };
      // Separate large groups first, then page each complete local window. The
      // unsplit packet stays in the browser and is never sent to the server.
      let packet = makePacket();
      if (group.length > 1 && JSON.stringify(packet).length > SELLER_LOGIC_LIMITS.packetCharacters) {
        due.unshift(...group.slice(1)); group.splice(1);
        baseKeys.clear(); candidateEvents(first).forEach((row) => baseKeys.add(row.key)); includeRefs(baseKeys, first);
        previous.splice(0, previous.length, ...[...decisions.values()].filter((row) => first.decisionIds.includes(row.id) || references(row).some((key) => baseKeys.has(key))));
        previous.forEach((row) => includeRefs(baseKeys, row)); packet = makePacket();
      }
      const request = async (payload: SellerLogicAnalysisInput) => {
        checkAbort(); const started = Date.now(); pipeline.stats.linkCalls++;
        try { return await calls.link(payload); } finally { pipeline.stats.linkMs += Date.now() - started; }
      };
      let result = await analyzeSellerLogicLinkWindow(packet, request, options); checkAbort();
      if (result.historyRequests?.length) {
        if (!Array.isArray(result.historyRequests) || result.historyRequests.length > 3 || result.historyRequests.some((query) => typeof query !== 'string' || !query.trim() || query.length > 80)) throw new Error('과거 근거 조회 형식이 올바르지 않습니다.');
        packet = makePacket(result.historyRequests); result = await analyzeSellerLogicLinkWindow(packet, request, options); checkAbort();
      }
      if (result.historyRequests?.length || !Array.isArray(result.signalLinks) || result.signalLinks.length !== group.length || !Array.isArray(result.decisions)) throw new Error('2차 AI가 모든 발화의 연결 결과를 반환하지 않았습니다.');
      const returned = new Map(result.decisions.map((row) => [row.id, row]));
      const linkedIds = new Set(result.signalLinks.flatMap((link) => link.decisionIds));
      const sentC = new Set(packet.comments.map((row) => row.id)), sentS = new Set(packet.transcripts.map((row) => row.id));
      if (new Set(result.signalLinks.map((link) => link.signalId)).size !== group.length ||
          result.signalLinks.some((link) => !group.some((signal) => signal.id === link.signalId) || !['MATCHED', 'UNMATCHED', 'NOT_SALE'].includes(link.outcome) ||
            !Array.isArray(link.decisionIds) || (link.outcome === 'MATCHED') !== Boolean(link.decisionIds.length) || link.decisionIds.some((id) => !returned.has(id))) ||
          result.decisions.some((row) => row.commentIds.some((id) => !sentC.has(id)) || row.transcriptIds.some((id) => !sentS.has(id)))) throw new Error('2차 AI의 발화·거래 근거 연결이 올바르지 않습니다.');
      for (const row of result.decisions) {
        if (linkedIds.has(row.id) || decisions.has(row.id)) decisions.set(row.id, row);
      }
      for (const id of result.retractedPurchaseIntentCommentIds || []) intents.delete(id);
      for (const id of result.purchaseIntentCommentIds) if ([...decisions.values()].some((row) => row.commentIds.includes(id))) intents.add(id);
      for (const signal of group) {
        const link = result.signalLinks.find((row) => row.signalId === signal.id)!;
        signal.decisionIds = link.decisionIds;
        signal.needsAnalysis = false;
        signal.observationClosed = finishing || now >= Date.parse(signal.observedUntil);
        signal.status = link.outcome === 'MATCHED' ? 'LINKED' : link.outcome === 'NOT_SALE' ? 'DISMISSED' : signal.observationClosed ? 'UNMATCHED' : 'WATCHING';
        signal.lastAnalyzedFingerprint = fingerprint(signal);
        signal.lastAnalyzedAt = new Date(now).toISOString();
      }
      appliedVersion = result.analysisState?.appliedVersion ?? appliedVersion; provider = result.provider; model = result.model; summary = result.summary;
      publish();
    }
  };

  for (;;) {
    checkAbort();
    const pending = events.filter((row) => pipeline.seenRevisions[row.key] !== row.signature);
    if (!pending.length) break;
    const fresh: Event[] = []; let freshSize = 0;
    for (const event of pending) {
      if (fresh.length >= 30 || (fresh.length && event.start - fresh[0].start >= 5000)) break;
      const cost = JSON.stringify(source(new Set([event.key]))).length;
      if (cost > 10_000) throw new Error('한 원문 조각이 1차 AI 입력 한도를 초과했습니다. 원문은 보존됩니다.');
      if (fresh.length && freshSize + cost > 10_000) break;
      fresh.push(event); freshSize += cost;
    }
    const keys = new Set(fresh.map((row) => row.key));
    const selectedCarry: SellerLogicCarry[] = [], selectedSignals: SellerLogicSignal[] = [];
    const packet = (): SellerLogicDetectionInput => ({ sessionId: input.sessionId, slotNumber: input.slotNumber, ...source(keys),
      freshCommentIds: fresh.filter((row) => row.kind === 'C').map((row) => row.id), freshTranscriptIds: fresh.filter((row) => row.kind === 'S').map((row) => row.id),
      existingSignals: selectedSignals.map(({ id, summary, commentIds, transcriptIds }) => ({ id, summary, commentIds, transcriptIds })), carry: [...selectedCarry] });
    const tryInclude = (item: SellerLogicCarry | SellerLogicSignal, kind: 'carry' | 'signal') => {
      const oldKeys = new Set(keys); includeRefs(keys, item);
      if (kind === 'carry') selectedCarry.push(item as SellerLogicCarry); else selectedSignals.push(item as SellerLogicSignal);
      if (JSON.stringify(packet()).length <= SELLER_LOGIC_LIMITS.packetCharacters) return true;
      keys.clear(); oldKeys.forEach((key) => keys.add(key));
      if (kind === 'carry') selectedCarry.pop(); else selectedSignals.pop(); return false;
    };
    for (const item of pipeline.carry) { if (selectedCarry.length >= 20) break; tryInclude(item, 'carry'); }
    const end = Math.max(...fresh.map((row) => row.end));
    const nearby = events.filter((row) => pipeline.seenRevisions[row.key] !== undefined && fresh.some((next) => Math.abs(next.start - row.end) <= 15_000));
    for (const row of nearby.slice(-60)) {
      const had = keys.has(row.key); keys.add(row.key); if (JSON.stringify(packet()).length > SELLER_LOGIC_LIMITS.packetCharacters && !had) keys.delete(row.key);
    }
    for (const item of [...pipeline.signals].reverse()) {
      if (selectedSignals.length >= 20) break;
      const unresolvedTransaction = item.decisionIds.some((id) => {
        const decision = decisions.get(id);
        return decision?.status === 'PENDING' || decision?.status === 'REVIEW';
      });
      if (item.status !== 'DISMISSED' && (end - Date.parse(item.observedUntil) <= 60_000 || item.status === 'WATCHING' || item.status === 'UNMATCHED' || unresolvedTransaction)) tryInclude(item, 'signal');
    }
    const detectionInput = packet(), began = Date.now(); pipeline.stats.detectCalls++;
    let detected: SellerLogicDetectionResult;
    try { detected = await calls.detect(detectionInput); } finally { pipeline.stats.detectMs += Date.now() - began; }
    checkAbort();
    const allowedC = new Set(detectionInput.comments.map((row) => row.id)), allowedS = new Set(detectionInput.transcripts.map((row) => row.id));
    if (!Array.isArray(detected.signals) || !Array.isArray(detected.carry) || [...detected.signals, ...detected.carry].some((item) =>
      !Array.isArray(item.commentIds) || !Array.isArray(item.transcriptIds) || !references(item).length ||
      item.commentIds.some((id) => !allowedC.has(id)) || item.transcriptIds.some((id) => !allowedS.has(id)))) throw new Error('1차 AI가 원문에 없는 근거를 반환했습니다.');
    for (const event of fresh) pipeline.seenRevisions[event.key] = event.signature;
    const replaced = new Set(selectedCarry.map(carryKey));
    pipeline.carry = [...new Map([...pipeline.carry.filter((item) => !replaced.has(carryKey(item))), ...detected.carry].map((item) => [carryKey(item), item])).values()];
    pipeline.observedThrough = Math.max(pipeline.observedThrough, end);
    for (const row of detected.signals) {
      const grounds = references(row).map((key) => byKey.get(key)!);
      const existing = pipeline.signals.find((signal) => signal.id === row.id);
      // Historical/carry citations remain evidence, but cannot stretch the active
      // window over the whole broadcast. Anchor on the cited current source.
      const freshGrounds = grounds.filter((event) => fresh.some((item) => item.key === event.key));
      const newGrounds = existing ? grounds.filter((event) => !(event.kind === 'C' ? existing.commentIds : existing.transcriptIds).includes(event.id)) : grounds;
      const latestGroundTime = newGrounds.reduce((latest, event) => Math.max(latest, event.start), -Infinity);
      const currentGrounds = freshGrounds.length ? freshGrounds : newGrounds.filter((event) => event.start === latestGroundTime);
      const speech = currentGrounds.filter((event) => event.kind === 'S');
      const anchor = speech.length ? speech : currentGrounds;
      const start = anchor.length ? Math.min(...anchor.map((event) => event.start)) : 0;
      const finish = anchor.length ? Math.max(...anchor.map((event) => event.end)) : 0;
      if (existing) {
        const sameSourceRevision = anchor.length > 0 && anchor.every((event) => event.kind === 'S' && existing.transcriptIds.includes(event.id));
        existing.summary = row.summary; existing.commentIds = unique([...existing.commentIds, ...row.commentIds]); existing.transcriptIds = unique([...existing.transcriptIds, ...row.transcriptIds]);
        existing.needsAnalysis = true;
        if (anchor.length && finish > Date.parse(existing.endedAt)) {
          // Only an update of the same source row preserves its past boundary.
          // Another fragment may share utteranceId for minutes, and a buyer-only
          // response is also a new AI-linked follow-up with its own time window.
          if (!sameSourceRevision) existing.startedAt = new Date(start).toISOString();
          existing.endedAt = new Date(finish).toISOString(); existing.observedUntil = new Date(finish + 60_000).toISOString(); existing.observationClosed = false;
        }
      } else pipeline.signals.push({ ...row, startedAt: new Date(start).toISOString(), endedAt: new Date(finish).toISOString(), observedUntil: new Date(finish + 60_000).toISOString(),
        status: 'WATCHING', decisionIds: [], needsAnalysis: true, observationClosed: false });
    }
    appliedVersion = detected.appliedVersion; provider = detected.provider; model = detected.model; summary = detected.summary;
    publish();
    await analyzeSignals(options.live ? clock() : pipeline.observedThrough);
  }
  await analyzeSignals(options.live ? clock() : pipeline.observedThrough || clock(), !options.live);
  // A clock tick with no new evidence closes observation without another AI call.
  for (const signal of pipeline.signals) if (signal.observationClosed && signal.status === 'WATCHING') signal.status = 'UNMATCHED';
  return snapshot();
}
