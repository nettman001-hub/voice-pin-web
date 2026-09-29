// A separate browser database keeps unsent work when Web Storage is full.
// Writes are serialized so an older fallback cannot replace a newer one.
export class DurableStorage {
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open('voicecap-local-recovery', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('entries');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Local recovery database is blocked'));
      });
      this.database.catch(() => { this.database = null; });
    }
    return this.database;
  }

  set(key: string, value: unknown): Promise<void> {
    // Capture the value now, not after another mutation changes its references.
    const captured = JSON.stringify(value);
    const operation = this.queue.catch(() => {}).then(async () => {
      const database = await this.open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('entries', 'readwrite');
        transaction.objectStore('entries').put(captured, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
    this.queue = operation;
    return operation;
  }

  update<T>(key: string, change: (current: T | null) => T): Promise<T> {
    const operation = this.queue.catch(() => {}).then(async () => {
      const database = await this.open();
      return new Promise<T>((resolve, reject) => {
        // Read and write in one transaction: independent tabs cannot replace
        // each other's operations with a snapshot read before the transaction.
        const transaction = database.transaction('entries', 'readwrite');
        const entries = transaction.objectStore('entries');
        const request = entries.get(key);
        let next: T;
        request.onsuccess = () => {
          try {
            next = change(request.result ? JSON.parse(request.result) as T : null);
            entries.put(JSON.stringify(next), key);
          } catch (error) {
            reject(error);
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(next);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
    this.queue = operation;
    return operation;
  }

  async get<T>(key: string): Promise<T | null> {
    await this.queue.catch(() => {});
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction('entries').objectStore('entries').get(key);
      request.onsuccess = () => {
        try { resolve(request.result ? JSON.parse(request.result) as T : null); }
        catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const durableStorage = new DurableStorage();
