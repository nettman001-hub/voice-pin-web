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
  }

  private publish() {
    this.dependencies.persist({ records: this.records, pending: [...this.pending.values()] });
    if (this.dependencies.active()) this.dependencies.changed(this.records);
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
    this.publish();
    return this.records;
  }

  flush(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => { this.draining = null; });
    return this.draining;
  }

  private async drain() {
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
        this.pending.delete(operation.id);
        this.records = this.records.map((sale) => sale.id === operation.id ? { ...sale, syncStatus: 'SYNCED' } : sale);
      }
      this.publish();
      if (this.dependencies.active()) this.dependencies.error(null);
    }
  }
}
