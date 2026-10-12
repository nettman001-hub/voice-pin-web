import type { AiStatusSummaryResponse } from '../types/aiStatusSummary';

interface Entry<T> {
  value?: T;
  updatedAt: number;
  generation: number;
  inFlight?: Promise<T>;
  listeners: Set<(value: T) => void>;
}

// A second sidebar/modal consumer shares the same request and result. Keys must
// include both user and workspace so switching identities cannot leak a snapshot.
export class SnapshotCache<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(private ttlMs = 60_000, private now = () => Date.now()) {}

  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { updatedAt: 0, generation: 0, listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  peek(key: string): T | undefined { return this.entries.get(key)?.value; }

  subscribe(key: string, listener: (value: T) => void) {
    const entry = this.entry(key);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }

  refresh(key: string, load: () => Promise<T>, force = false): Promise<T> {
    const entry = this.entry(key);
    if (entry.inFlight) return entry.inFlight;
    if (!force && entry.value !== undefined && this.now() - entry.updatedAt < this.ttlMs) {
      return Promise.resolve(entry.value);
    }
    const generation = entry.generation;
    const request = Promise.resolve().then(load).then((value) => {
      if (generation === entry.generation) {
        entry.value = value;
        entry.updatedAt = this.now();
        entry.listeners.forEach((listener) => listener(value));
      }
      return value;
    }).finally(() => {
      if (entry.inFlight === request) entry.inFlight = undefined;
    });
    entry.inFlight = request;
    return request;
  }

  invalidateAll() {
    this.entries.forEach((entry) => {
      entry.generation++;
      entry.updatedAt = Number.NEGATIVE_INFINITY;
      entry.inFlight = undefined;
    });
  }
}

export const aiStatusCache = new SnapshotCache<AiStatusSummaryResponse>();
