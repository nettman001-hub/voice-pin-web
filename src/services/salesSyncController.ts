import type { SaleRecord } from '../types/live';

export interface SaleSyncOperation {
  id: string;
  token: string;
  kind: 'UPSERT' | 'DELETE';
  sale?: SaleRecord;
}

export interface SalesLocalState {
  records: SaleRecord[];
  pending: SaleSyncOperation[];
}

interface SalesSyncDependencies {
  scope?: string;
  read: () => SalesLocalState;
  persist: (state: SalesLocalState) => void;
  update?: (change: (current: SalesLocalState) => SalesLocalState) => Promise<SalesLocalState>;
  save: (sale: SaleRecord) => Promise<void>;
  remove: (id: string) => Promise<void>;
  load: () => Promise<SaleRecord[]>;
  changed: (records: SaleRecord[]) => void;
  error: (message: string | null) => void;
  active: () => boolean;
}

// Survives provider/account remounts: a later writer for the same workspace
// cannot reach the server ahead of an older in-flight request.
const writesByScope = new Map<string, Promise<void>>();

export class SalesSyncController {
  records: SaleRecord[];
  private pending = new Map<string, SaleSyncOperation>();
  private changes = new Map<string, number>();
  private generation = 0;
  private request = 0;
  private draining: Promise<void> | null = null;
  private persistence: Promise<void> = Promise.resolve();
  private publishedState: SalesLocalState;

  constructor(private dependencies: SalesSyncDependencies) {
    const state = dependencies.read();
    this.records = state.records;
    for (const operation of state.pending) this.pending.set(operation.id, operation);
    // Recover older clients' unsent additions as well.
    for (const sale of this.records) {
      if (sale.syncStatus === 'PENDING' && !this.pending.has(sale.id)) {
        this.pending.set(sale.id, { id: sale.id, token: crypto.randomUUID(), kind: 'UPSERT', sale });
      }
    }
    for (const operation of this.pending.values()) {
      this.records = this.records.filter((sale) => sale.id !== operation.id);
      if (operation.sale && operation.kind === 'UPSERT') this.records.unshift(operation.sale);
    }
    this.publishedState = { records: [...this.records], pending: [...this.pending.values()] };
  }

  private publish() {
    const previous = this.publishedState;
    const next = { records: [...this.records], pending: [...this.pending.values()] };
    this.publishedState = next;
    const update = this.dependencies.update;
    if (!update) this.dependencies.persist(next);
    else {
      const generation = this.generation;
      const beforeRows = new Map(previous.records.map((sale) => [sale.id, sale]));
      const afterRows = new Map(next.records.map((sale) => [sale.id, sale]));
      const beforePending = new Map(previous.pending.map((operation) => [operation.id, operation]));
      const afterPending = new Map(next.pending.map((operation) => [operation.id, operation]));
      const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
      this.persistence = this.persistence.then(() => update((current) => {
        const rows = new Map(current.records.map((sale) => [sale.id, sale]));
        const pending = new Map(current.pending.map((operation) => [operation.id, operation]));
        const ids = new Set([...beforeRows.keys(), ...afterRows.keys(), ...beforePending.keys(), ...afterPending.keys()]);
        for (const id of ids) {
          const before = beforePending.get(id), after = afterPending.get(id);
          const newOperation = after && after.token !== before?.token;
          const concurrentOperation = pending.get(id);
          if (newOperation) pending.set(id, after);
          else if (before && !after && concurrentOperation?.token === before.token) pending.delete(id);
          // An ACK/refresh must not replace another tab's newer edit. Explicit
          // local operations apply only their own entity, preserving other rows.
          if (!newOperation && concurrentOperation && concurrentOperation.token !== before?.token) continue;
          if (newOperation || (!pending.has(id) && equal(rows.get(id), beforeRows.get(id)))) {
            if (afterRows.has(id)) rows.set(id, afterRows.get(id)!);
            else rows.delete(id);
          }
        }
        return { records: [...rows.values()].sort((a, b) => Date.parse(b.recognizedAt) - Date.parse(a.recognizedAt)), pending: [...pending.values()] };
      })).then((state) => {
        if (!this.dependencies.active() || this.generation !== generation) return;
        this.trackExternalChanges(state);
        this.records = state.records;
        this.pending = new Map(state.pending.map((operation) => [operation.id, operation]));
        this.publishedState = state;
        this.dependencies.changed(this.records);
      }).catch((error) => {
        if (this.dependencies.active()) this.dependencies.error(error instanceof Error ? error.message : '로컬 저장 실패');
      });
    }
    if (this.dependencies.active()) this.dependencies.changed(this.records);
    return this.persistence;
  }

  async reloadState() {
    const generation = this.generation;
    await this.persistence;
    if (!this.dependencies.active() || generation !== this.generation) return;
    const state = this.dependencies.read();
    this.trackExternalChanges(state);
    this.records = state.records;
    this.pending = new Map(state.pending.map((operation) => [operation.id, operation]));
    this.publishedState = state;
    this.dependencies.changed(this.records);
  }

  private trackExternalChanges(state: SalesLocalState) {
    const before = new Map(this.records.map((sale) => [sale.id, JSON.stringify(sale)]));
    const after = new Map(state.records.map((sale) => [sale.id, JSON.stringify(sale)]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(id) !== after.get(id)) this.changes.set(id, ++this.generation);
    }
  }

  upsert(sale: SaleRecord): SaleRecord {
    const previous = this.records.find((item) => item.id === sale.id);
    const next: SaleRecord = {
      ...sale,
      revision: previous ? Math.max((previous.revision || 1) + 1, sale.revision || 1) : sale.revision || 1,
      syncStatus: 'PENDING',
    };
    this.changes.set(next.id, ++this.generation);
    this.pending.set(next.id, { id: next.id, token: crypto.randomUUID(), kind: 'UPSERT', sale: next });
    this.records = [next, ...this.records.filter((item) => item.id !== next.id)];
    this.publish();
    void this.flush();
    return next;
  }

  delete(id: string) {
    this.changes.set(id, ++this.generation);
    this.pending.set(id, { id, token: crypto.randomUUID(), kind: 'DELETE' });
    this.records = this.records.filter((item) => item.id !== id);
    this.publish();
    void this.flush();
  }

  applyConfirmed(records: SaleRecord[]) {
    for (const sale of records) {
      const pending = this.pending.get(sale.id);
      if (pending) continue;
      this.changes.set(sale.id, ++this.generation);
      this.records = [{ ...sale, syncStatus: 'SYNCED' }, ...this.records.filter((item) => item.id !== sale.id)];
    }
    this.publish();
  }

  async refresh(): Promise<SaleRecord[]> {
    if (this.dependencies.update) await this.persistence;
    const generation = this.generation;
    const request = ++this.request;
    const rows = await this.dependencies.load();
    if (!this.dependencies.active() || request !== this.request) return this.records;
    const local = new Map(this.records.map((sale) => [sale.id, sale]));
    const merged = new Map<string, SaleRecord>();
    for (const row of rows) {
      const operation = this.pending.get(row.id);
      if (operation?.kind === 'DELETE' || ((this.changes.get(row.id) || 0) > generation && !local.has(row.id))) continue;
      const current = local.get(row.id);
      const protectedChange = operation?.kind === 'UPSERT' || (this.changes.get(row.id) || 0) > generation;
      merged.set(row.id, protectedChange && current ? current : { ...row, syncStatus: 'SYNCED' });
    }
    for (const sale of this.records) {
      if (this.pending.get(sale.id)?.kind === 'UPSERT' || (this.changes.get(sale.id) || 0) > generation) {
        merged.set(sale.id, sale);
      }
    }
    this.records = [...merged.values()].sort((a, b) => Date.parse(b.recognizedAt) - Date.parse(a.recognizedAt));
    await this.publish();
    return this.records;
  }

  flush(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => { this.draining = null; });
    return this.draining;
  }

  private async drain() {
    if (this.dependencies.update) await this.persistence;
    while (this.dependencies.active() && this.pending.size) {
      const operation = this.pending.values().next().value as SaleSyncOperation;
      try {
        const write = async () => {
          if (!this.dependencies.active()) return;
          if (operation.kind === 'DELETE') await this.dependencies.remove(operation.id);
          else if (operation.sale) await this.dependencies.save(operation.sale);
        };
        const scope = this.dependencies.scope;
        if (scope) {
          const previous = writesByScope.get(scope) || Promise.resolve();
          const next = previous.catch(() => {}).then(write).finally(() => {
            if (writesByScope.get(scope) === next) writesByScope.delete(scope);
          });
          writesByScope.set(scope, next);
          await next;
        } else await write();
      } catch (error) {
        if (this.dependencies.active()) this.dependencies.error(error instanceof Error ? error.message : '클라우드 저장 실패');
        return; // The durable pending entry remains available for reconnect/retry.
      }
      if (!this.dependencies.active()) return; // An obsolete controller must not rewrite a restored outbox.
      if (this.pending.get(operation.id)?.token === operation.token) {
        // The snapshot may have started while this operation was pending. Its
        // ACK must protect the committed row (or deletion) from that snapshot.
        this.changes.set(operation.id, ++this.generation);
        this.pending.delete(operation.id);
        this.records = this.records.map((sale) => sale.id === operation.id ? { ...sale, syncStatus: 'SYNCED' } : sale);
      }
      await this.publish();
      if (this.dependencies.active()) this.dependencies.error(null);
    }
  }
}
