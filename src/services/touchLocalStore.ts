import type { TouchCommit } from '../types/touchSales';
import type { TouchFrame } from './touchFrameBuffer';
import { classifyTouchSaveFailure } from './touchSaveFailure.ts';
export interface TouchOutboxItem {
  id: string;
  workspaceId: string;
  sale: TouchCommit;
  error?: string;
  code?: string;
  blocked?: boolean;
  createdAt: number;
}
interface LocalFrames {
  id: string;
  workspaceId: string;
  frames: TouchFrame[];
  expiresAt: number;
}
/** Account-scoped durable queue; IndexedDB failures are reported, never disguised as a saved sale. */
export class TouchLocalStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db() {
    if (!this.dbPromise)
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('voicecap-touch-sales', 1);
        request.onupgradeneeded = () => {
          for (const name of ['outbox', 'frames'])
            if (!request.result.objectStoreNames.contains(name))
              request.result.createObjectStore(name, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    return this.dbPromise;
  }
  private async transact<T>(
    store: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode),
        req = action(tx.objectStore(store));
      let value: T;
      req.onsuccess = () => {
        value = req.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  putOutbox(item: TouchOutboxItem) {
    return this.transact('outbox', 'readwrite', (s) => s.put(item));
  }
  removeOutbox(id: string) {
    return this.transact('outbox', 'readwrite', (s) => s.delete(id));
  }
  async listOutbox(workspaceId: string) {
    return (
      await this.transact<TouchOutboxItem[]>('outbox', 'readonly', (s) =>
        s.getAll(),
      )
    )
      .filter((i) => i.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async saveFrames(workspaceId: string, saleId: string, frames: TouchFrame[]) {
    const all = await this.transact<LocalFrames[]>('frames', 'readonly', (s) =>
      s.getAll(),
    );
    for (const item of all)
      if (item.expiresAt < Date.now())
        await this.transact('frames', 'readwrite', (s) => s.delete(item.id));
    return this.transact('frames', 'readwrite', (s) =>
      s.put({
        id: `${workspaceId}:${saleId}`,
        workspaceId,
        frames,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }),
    );
  }
  async getFrames(workspaceId: string, saleId: string) {
    const row = await this.transact<LocalFrames | undefined>(
      'frames',
      'readonly',
      (s) => s.get(`${workspaceId}:${saleId}`),
    );
    if (row && row.expiresAt <= Date.now())
      await this.transact('frames', 'readwrite', (s) => s.delete(row.id));
    return row && row.workspaceId === workspaceId && row.expiresAt > Date.now()
      ? row.frames
      : [];
  }
}
export const touchLocalStore = new TouchLocalStore();
export async function flushTouchOutbox(
  store: TouchLocalStore,
  workspaceId: string,
  send: (sale: TouchCommit) => Promise<unknown>,
  active: () => boolean = () => true,
) {
  for (const item of await store.listOutbox(workspaceId)) {
    if (!active()) return;
    if (item.blocked) continue;
    try {
      await send(item.sale);
      if (!active()) return;
      await store.removeOutbox(item.id);
    } catch (error) {
      if (!active()) return;
      const failure = classifyTouchSaveFailure(error);
      await store.putOutbox({
        ...item,
        error: failure.detail || failure.message,
        code: failure.code,
        blocked: failure.blocked,
      });
      if (!failure.blocked) return;
    }
  }
}
