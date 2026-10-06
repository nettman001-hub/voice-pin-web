import type { CommentRecord } from "../types/comment.ts";
import type { WorkflowTranscript } from "../types/salesWorkflow.ts";
import { SELLER_LOGIC_DEEP_LIMITS, type SellerLogicDeepSegment } from "../types/sellerLogicDeep.ts";

interface DeepEvent {
  key: string;
  kind: "C" | "S";
  id: string;
  start: number;
  end: number;
  signature: string;
}

export interface SellerLogicDeepSegmentOptions {
  idleMs?: number;
  maxEvents?: number;
  maxDurationMs?: number;
  /** When given, the last bucket is marked closed if no event arrived within idleMs. */
  now?: number;
}

export function sellerLogicDeepCommentSignature(row: CommentRecord): string {
  return JSON.stringify([row.content, row.nickname, row.capturedAt]);
}

export function sellerLogicDeepTranscriptSignature(row: WorkflowTranscript): string {
  return JSON.stringify([row.text, row.recognizedAt, row.startedAt, row.endedAt, row.isFinal, row.utteranceId, row.utteranceEnded, row.revision, row.endReason]);
}

function buildEvents(comments: CommentRecord[], transcripts: WorkflowTranscript[]): DeepEvent[] {
  const events: DeepEvent[] = [
    ...comments.map((row) => {
      const at = Date.parse(row.capturedAt);
      return { key: `C:${row.id}`, kind: "C" as const, id: row.id, start: at, end: at, signature: sellerLogicDeepCommentSignature(row) };
    }),
    ...transcripts.map((row) => {
      const start = Date.parse(row.startedAt || row.recognizedAt);
      const end = Date.parse(row.endedAt || row.recognizedAt);
      return { key: `S:${row.id}`, kind: "S" as const, id: row.id, start, end, signature: sellerLogicDeepTranscriptSignature(row) };
    }),
  ];
  events.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
  if (events.some((row) => !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end < row.start)) {
    throw new Error("구간 분석: 원문 시각이 올바르지 않습니다.");
  }
  return events;
}

/** Mechanical time buckets; every semantic judgment stays with the AI. */
export function segmentSellerLogicDeepEvents(
  comments: CommentRecord[],
  transcripts: WorkflowTranscript[],
  options: SellerLogicDeepSegmentOptions = {},
): SellerLogicDeepSegment[] {
  const idleMs = options.idleMs ?? SELLER_LOGIC_DEEP_LIMITS.segmentIdleMs;
  const maxEvents = options.maxEvents ?? SELLER_LOGIC_DEEP_LIMITS.segmentEvents;
  const maxDurationMs = options.maxDurationMs ?? SELLER_LOGIC_DEEP_LIMITS.segmentMaxMs;
  const events = buildEvents(comments, transcripts);
  const segments: SellerLogicDeepSegment[] = [];
  let bucket: DeepEvent[] = [];
  let bucketStart = 0;
  let bucketEnd = 0;
  const flush = (closed: boolean) => {
    if (!bucket.length) return;
    segments.push({
      id: `dseg:${segments.length}:${bucket[0].key}`,
      index: segments.length,
      startedAt: new Date(bucketStart).toISOString(),
      endedAt: new Date(bucketEnd).toISOString(),
      closed,
      commentIds: bucket.filter((row) => row.kind === "C").map((row) => row.id),
      transcriptIds: bucket.filter((row) => row.kind === "S").map((row) => row.id),
    });
    bucket = [];
  };
  for (const event of events) {
    if (bucket.length && (event.start - bucketEnd > idleMs || bucket.length >= maxEvents || event.end - bucketStart >= maxDurationMs)) {
      flush(true);
    }
    if (!bucket.length) {
      bucketStart = event.start;
      bucketEnd = event.end;
    }
    bucket.push(event);
    bucketEnd = Math.max(bucketEnd, event.end);
  }
  const idleClosed = options.now !== undefined && events.length > 0 && options.now - bucketEnd >= idleMs;
  flush(idleClosed);
  return segments;
}

export function sellerLogicDeepSegmentSignature(
  segment: SellerLogicDeepSegment,
  comments: CommentRecord[],
  transcripts: WorkflowTranscript[],
): string {
  const events = new Map(buildEvents(comments, transcripts).map((event) => [event.key, event]));
  const rows = [
    ...segment.commentIds.map((id) => `C:${id}`),
    ...segment.transcriptIds.map((id) => `S:${id}`),
  ].sort();
  return JSON.stringify(rows.map((key) => {
    const event = events.get(key);
    if (!event) throw new Error("구간 근거를 수집 원문에서 찾을 수 없습니다.");
    return [key, event.signature];
  }));
}
