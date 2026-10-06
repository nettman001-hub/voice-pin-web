import type { CommentRecord } from '../types/comment.ts';
import type { WorkflowTranscript } from '../types/salesWorkflow.ts';
import {
  SELLER_LOGIC_LIMITS,
  type SellerLogicAnalysisInput,
  type SellerLogicDecision,
  type SellerLogicMemoryItem,
} from '../types/sellerLogicAnalysis.ts';

const FRESH_CHARACTERS = 10_000;
const RECENT_MILLISECONDS = 60_000;
const CONTEXT_EVENTS = 60;
const CONTEXT_ITEMS = 20;
const HISTORY_MATCHES_PER_QUERY = 6;
const HISTORY_NEIGHBORS = 3;

type Event = { key: string; kind: 'C'; id: string; time: number; row: CommentRecord }
  | { key: string; kind: 'S'; id: string; time: number; row: WorkflowTranscript };
type References = Pick<SellerLogicMemoryItem, 'commentIds' | 'transcriptIds'>;

/**
 * Selects a bounded transport packet; it never classifies purchase intent or
 * matches a spoken buyer/product. All omitted source and AI state stay local.
 * Priority: fresh source, AI-requested literal history + linked decisions,
 * directly linked decisions, AI memory, unresolved decisions, recent source,
 * then recent completed decisions. Context groups are admitted atomically.
 */
export function prepareSellerLogicPacket(
  input: SellerLogicAnalysisInput,
  historyQueries: string[] = [],
): SellerLogicAnalysisInput | null {
  const old = input.analysisState;
  const sameSlot = old?.slotNumber === input.slotNumber;
  const processedC = new Set(sameSlot ? old.processedCommentIds : []);
  const processedS = new Set(sameSlot ? old.processedTranscriptIds : []);
  const events: Event[] = [
    ...input.comments.map((row): Event => ({ key: `C\0${row.id}`, kind: 'C', id: row.id, time: Date.parse(row.capturedAt), row })),
    ...input.transcripts.map((row): Event => ({ key: `S\0${row.id}`, kind: 'S', id: row.id, time: Date.parse(row.recognizedAt), row })),
  ].sort((a, b) => a.time - b.time);
  const byKey = new Map(events.map((event) => [event.key, event]));
  const processed = (event: Event) => (event.kind === 'C' ? processedC : processedS).has(event.id);
  const fresh: Event[] = [];
  let freshCharacters = 0;
  for (const event of events) {
    if (processed(event)) continue;
    const characters = JSON.stringify(event.row).length;
    if (characters > FRESH_CHARACTERS) {
      if (fresh.length) break;
      throw new Error(`분석 원문 한 행이 ${FRESH_CHARACTERS.toLocaleString()}자 전송 한도를 초과했습니다. 원문은 보존되며 자동으로 자르지 않습니다.`);
    }
    if (fresh.length >= SELLER_LOGIC_LIMITS.windowEvents || freshCharacters + characters > FRESH_CHARACTERS) break;
    fresh.push(event);
    freshCharacters += characters;
  }
  if (!fresh.length) return null;

  const queries = [...new Set(historyQueries.map((query) => query.trim()).filter(Boolean))].slice(0, 3);
  const cutoff = Math.max(...fresh.map((event) => event.time));
  const freshKeys = new Set(fresh.map((event) => event.key));
  const selected = new Set(freshKeys);
  const decisions: SellerLogicDecision[] = [];
  const selectedDecisionIds = new Set<string>();
  const memory: SellerLogicMemoryItem[] = [];
  const sourceDecisions = input.previousDecisions || [];
  // Previously processed evidence may follow a late-arriving STT on the source
  // clock. It is valid context; unprocessed later source must stay out.
  const eligible = (event: Event) => processed(event) || freshKeys.has(event.key);
  const references = (item: References): Event[] | null => {
    const keys = [...item.commentIds.map((id) => `C\0${id}`), ...item.transcriptIds.map((id) => `S\0${id}`)];
    if (!keys.length) return null;
    const rows = keys.map((key) => byKey.get(key));
    if (rows.some((event) => !event || !eligible(event))) return null;
    return rows as Event[];
  };
  const latestReference = (item: References) => Math.max(0, ...item.commentIds.map((id) => byKey.get(`C\0${id}`)?.time || 0),
    ...item.transcriptIds.map((id) => byKey.get(`S\0${id}`)?.time || 0));
  const recentDecisions = [...sourceDecisions].sort((a, b) => latestReference(b) - latestReference(a));

  const packet = (): SellerLogicAnalysisInput => {
    const rows = events.filter((event) => selected.has(event.key));
    const citedComments = new Set(decisions.flatMap((decision) => decision.commentIds));
    return {
      sessionId: input.sessionId,
      slotNumber: input.slotNumber,
      comments: rows.filter((event): event is Extract<Event, { kind: 'C' }> => event.kind === 'C').map((event) => event.row),
      transcripts: rows.filter((event): event is Extract<Event, { kind: 'S' }> => event.kind === 'S').map((event) => event.row),
      previousDecisions: [...decisions],
      analysisState: {
        processedCommentIds: rows.filter((event) => event.kind === 'C' && !freshKeys.has(event.key)).map((event) => event.id),
        processedTranscriptIds: rows.filter((event) => event.kind === 'S' && !freshKeys.has(event.key)).map((event) => event.id),
        memory: [...memory],
        purchaseIntentCommentIds: (old?.purchaseIntentCommentIds || []).filter((id) => selected.has(`C\0${id}`) && citedComments.has(id)),
        slotNumber: input.slotNumber,
        appliedVersion: old?.appliedVersion || 0,
      },
      incremental: {
        newCommentIds: fresh.filter((event) => event.kind === 'C').map((event) => event.id),
        newTranscriptIds: fresh.filter((event) => event.kind === 'S').map((event) => event.id),
        historyQueries: queries,
        historyExhausted: historyQueries.length > 0,
        omittedEvents: events.length - selected.size,
        omittedDecisions: sourceDecisions.length - decisions.length,
      },
    };
  };
  if (JSON.stringify(packet()).length > SELLER_LOGIC_LIMITS.packetCharacters) {
    throw new Error('새 분석 원문의 전송 크기가 한도를 초과했습니다. 원문은 보존되며 자동으로 자르지 않습니다.');
  }

  const include = (rows: Event[], decision?: SellerLogicDecision, item?: SellerLogicMemoryItem) => {
    if (decision && (selectedDecisionIds.has(decision.id) || decisions.length >= CONTEXT_ITEMS)) return false;
    if (item && memory.length >= CONTEXT_ITEMS) return false;
    if (rows.some((event) => !eligible(event))) return false;
    const added = rows.filter((event) => !selected.has(event.key));
    added.forEach((event) => selected.add(event.key));
    if (decision) decisions.push(decision);
    if (item) memory.push(item);
    if (JSON.stringify(packet()).length > SELLER_LOGIC_LIMITS.packetCharacters) {
      added.forEach((event) => selected.delete(event.key));
      if (decision) decisions.pop();
      if (item) memory.pop();
      return false;
    }
    if (decision) selectedDecisionIds.add(decision.id);
    return true;
  };
  const includeDecision = (decision: SellerLogicDecision) => {
    const rows = references(decision);
    return rows ? include(rows, decision) : false;
  };
  const history = events.filter((event) => processed(event));
  for (const query of queries) {
    const literal = query.toLocaleLowerCase();
    const matches = history.filter((event) => (event.kind === 'C'
      ? `${event.row.nickname}\n${event.row.content}` : event.row.text).toLocaleLowerCase().includes(literal))
      .sort((a, b) => b.time - a.time).slice(0, HISTORY_MATCHES_PER_QUERY);
    for (const match of matches) {
      // Admit the exact hit before optional neighboring context or prior state.
      if (!include([match])) continue;
      for (const decision of recentDecisions) {
        if ((match.kind === 'C' ? decision.commentIds : decision.transcriptIds).includes(match.id)) includeDecision(decision);
      }
      const index = history.indexOf(match);
      include(history.slice(Math.max(0, index - HISTORY_NEIGHBORS), index + HISTORY_NEIGHBORS + 1));
    }
    for (const decision of recentDecisions) {
      // Literal lookup over AI-written metadata is retrieval, not classification.
      if ([decision.nickname, decision.productName, decision.orderCode, decision.spokenNickname, decision.reason]
        .filter(Boolean).join('\n').toLocaleLowerCase().includes(literal)) includeDecision(decision);
    }
  }
  for (const decision of recentDecisions) {
    if (decision.commentIds.some((id) => freshKeys.has(`C\0${id}`)) || decision.transcriptIds.some((id) => freshKeys.has(`S\0${id}`))) {
      includeDecision(decision);
    }
  }
  const recentMemory = [...(old?.memory || [])].sort((a, b) => latestReference(b) - latestReference(a));
  for (const item of recentMemory) {
    const rows = references(item);
    if (rows) include(rows, undefined, item);
  }
  for (const decision of recentDecisions) {
    if (decision.status === 'PENDING' || decision.status === 'REVIEW') includeDecision(decision);
  }
  const overlap = history.filter((event) => Math.abs(cutoff - event.time) <= RECENT_MILLISECONDS)
    .sort((a, b) => Math.abs(cutoff - a.time) - Math.abs(cutoff - b.time) || b.time - a.time).slice(0, CONTEXT_EVENTS);
  for (const event of overlap) include([event]);
  for (const decision of recentDecisions) {
    if (Math.abs(cutoff - latestReference(decision)) <= RECENT_MILLISECONDS) includeDecision(decision);
  }
  return packet();
}
