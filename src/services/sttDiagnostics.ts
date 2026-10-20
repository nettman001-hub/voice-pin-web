import { DurableStorage } from './durableStorage.ts';

export interface SttDiagnosticScope {
  workspaceId: string;
  sessionId: string;
  mode: 'TEST' | 'PRODUCTION';
}
export interface SttDiagnosticEvent {
  id: string;
  recordedAt: string;
  sequence: number;
  recorderId: string;
  stage: string;
  detail: unknown;
}
export interface SttDiagnosticSignal { stage: string; detail: unknown }
export type SttDiagnosticSink = (event: SttDiagnosticSignal) => void;

const SECRET_KEY = /^(?:api[-_]?key|authorization|proxy[-_]?authorization|access[-_]?token|refresh[-_]?token|token|password|secret|cookie|set[-_]?cookie)$/i;
const scrubText = (text: string) => text
  .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
  .replace(/([?&](?:api_key|apiKey|token|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/("(?:api_key|apiKey|authorization|access_token|refresh_token|password)"\s*:\s*)"[^"\n]*"/gi, '$1"[REDACTED]"');

/** Incoming responses are retained; credentials and binary audio are never exported. */
export function sanitizeSttDiagnostic(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[binary omitted]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  let result: unknown;
  if (value instanceof Error) result = sanitizeSttDiagnostic({ name: value.name, message: value.message,
    ...Object.fromEntries(Object.getOwnPropertyNames(value).map(key => [key, (value as any)[key]])) }, seen);
  else if (Array.isArray(value)) result = value.map(item => sanitizeSttDiagnostic(item, seen));
  else result = Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeSttDiagnostic(item, seen)]));
  seen.delete(value);
  return result;
}

interface Batch { recorderId: string; batch: number; events: SttDiagnosticEvent[] }
interface SessionBuffer { scope: SttDiagnosticScope; sequence: number;
  pending: SttDiagnosticEvent[]; memory: SttDiagnosticEvent[]; failure: boolean }
interface DiagnosticStore {
  set(key: string, value: unknown): Promise<void>;
  entries<T>(prefix: string): Promise<Array<[string, T]>>;
}

/** Dedicated local storage, scoped by account, mode and broadcast. No remote writes. */
export class SttDiagnostics {
  private sessions = new Map<string, SessionBuffer>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly recorderId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  constructor(private readonly store: DiagnosticStore = new DurableStorage('voicecap-stt-diagnostics-v1'),
    private readonly slots = 128, private readonly batchSize = 100) {}

  private key(scope: SttDiagnosticScope) { return `session:${encodeURIComponent(JSON.stringify([scope.mode, scope.workspaceId, scope.sessionId]))}:`; }

  record(scope: SttDiagnosticScope, stage: string, detail: unknown) {
    // Diagnostics must never break audio, sale processing or persistence.
    try {
      if (!scope.workspaceId || !scope.sessionId) return;
      const key = this.key(scope);
      let session = this.sessions.get(key);
      if (!session) {
        session = { scope: { ...scope }, sequence: 0, pending: [], memory: [], failure: false };
        this.sessions.set(key, session);
      }
      const sequence = ++session.sequence;
      const event = { id: `${this.recorderId}:${sequence}`, recordedAt: new Date().toISOString(),
        sequence, recorderId: this.recorderId, stage, detail: sanitizeSttDiagnostic(detail) };
      session.pending.push(event);
      session.memory.push(event);
      if (session.memory.length > this.slots * this.batchSize) session.memory.splice(0, session.memory.length - this.slots * this.batchSize);
      if (session.pending.length >= this.batchSize) void this.flush();
      else if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 1000);
    } catch { /* Logging is independent of the business pipeline. */ }
  }

  sink(scope: SttDiagnosticScope): SttDiagnosticSink {
    const owner = { ...scope };
    return event => this.record(owner, event.stage, event.detail);
  }

  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    for (const [prefix, session] of this.sessions) {
      while (session.pending.length) {
        const batch = Math.floor((session.pending[0].sequence - 1) / this.batchSize);
        const through = (batch + 1) * this.batchSize;
        session.pending.splice(0, session.pending.findIndex(event => event.sequence > through) < 0
          ? session.pending.length : session.pending.findIndex(event => event.sequence > through));
        const events = session.memory.filter(event => event.sequence > batch * this.batchSize && event.sequence <= through);
        const value: Batch = { recorderId: this.recorderId, batch, events };
        this.writes = this.writes.catch(() => {}).then(() => this.store.set(
          `${prefix}${this.recorderId}:${batch % this.slots}`, value)).catch(() => { session.failure = true; });
      }
    }
    await this.writes;
  }

  async export(scope: SttDiagnosticScope, snapshots: unknown = {}) {
    await this.flush();
    const prefix = this.key(scope);
    const session = this.sessions.get(prefix);
    let batches: Batch[] = [];
    let unavailable = false;
    try { batches = (await this.store.entries<Batch>(prefix)).map(([, value]) => value).filter(Boolean); }
    catch { unavailable = true; }
    const events = [...new Map([...batches.flatMap(batch => batch.events), ...(session?.memory || [])]
      .map(event => [event.id, event])).values()]
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.recorderId.localeCompare(b.recorderId) || a.sequence - b.sequence);
    const streams = [...new Set(events.map(event => event.recorderId))].map(recorderId => {
      const rows = events.filter(event => event.recorderId === recorderId);
      const firstSequence = Math.min(...rows.map(event => event.sequence));
      return { recorderId, firstSequence, lastSequence: Math.max(...rows.map(event => event.sequence)),
        omittedEarlierEvents: firstSequence - 1, missingEventsWithinRange: Math.max(...rows.map(event => event.sequence)) - firstSequence + 1 - rows.length };
    });
    return { schema: 'voicecap.stt-diagnostics.v1', exportedAt: new Date().toISOString(), timeZone: 'Asia/Seoul',
      scope: { ...scope }, eventCount: events.length, streams,
      retention: { maxBatchesPerRecorder: this.slots, maxEventsPerBatch: this.batchSize },
      warnings: [unavailable || session?.failure ? 'LOCAL_DIAGNOSTIC_STORAGE_FAILED: available in-memory events included' : '',
        streams.some(stream => stream.omittedEarlierEvents > 0) ? 'EARLIER_EVENTS_EVICTED: see streams for the missing sequence count' : '',
        streams.some(stream => stream.missingEventsWithinRange > 0) ? 'EVENT_SEQUENCE_GAPS: see streams for missing events' : ''].filter(Boolean),
      snapshots: sanitizeSttDiagnostic(snapshots), events };
  }
}

export const sttDiagnostics = new SttDiagnostics();
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { void sttDiagnostics.flush(); });
