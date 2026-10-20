import { DurableStorage } from '../durableStorage';

// No operating workspace cache/outbox is used by this database.
export const LIVE_TEST_DATABASE = 'voicecap-live-test-v1';

export class LocalTestDatabase {
  readonly durable = new DurableStorage(LIVE_TEST_DATABASE);
  private writes: Promise<unknown> = Promise.resolve();
  private failure: unknown = null;
  private values = new Map<string, string>();

  constructor(readonly owner: string) {
    Object.defineProperty(this.web, 'length', { get: () => this.values.size });
  }

  async restore() {
    const rows = await this.durable.entries<string>(`web:${this.owner}:`);
    for (const [key, value] of rows) if (value !== null) this.values.set(key.slice(`web:${this.owner}:`.length), value);
  }

  readonly web: Storage = {
    get length() { return 0; },
    clear: () => { throw new Error('테스트 기록은 회차별로 초기화해 주세요.'); },
    key: (index: number) => [...this.values.keys()][index] || null,
    getItem: (key: string) => this.values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      this.values.set(key, value);
      this.track(this.durable.set(`web:${this.owner}:${key}`, value));
    },
    removeItem: (key: string) => {
      this.values.delete(key);
      this.track(this.durable.set(`web:${this.owner}:${key}`, null));
    },
  };

  private track(write: Promise<unknown>) {
    this.writes = Promise.all([this.writes, write]).catch(error => {
      this.failure = error;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('voicecap_persistence_changed'));
    });
  }

  async flush() {
    await this.writes;
    // StorageService also writes critical records through this same durable queue.
    await this.durable.get('__flush__');
    if (this.failure) throw new Error('테스트 DB 저장에 실패했습니다. 브라우저의 저장 공간을 확인해 주세요.');
  }

  get<T>(table: string, fallback: T): T {
    const raw = this.web.getItem(`table:${table}`);
    return raw ? JSON.parse(raw) as T : fallback;
  }

  async put<T>(table: string, value: T) {
    this.web.setItem(`table:${table}`, JSON.stringify(value));
    await this.flush();
  }

  async read<T>(table: string, fallback: T): Promise<T> {
    const key = `table:${table}`;
    const raw = await this.durable.get<string>(`web:${this.owner}:${key}`);
    if (raw !== null) this.values.set(key, raw);
    return raw ? JSON.parse(raw) as T : fallback;
  }

  async update<T>(table: string, fallback: T, change: (current: T) => T): Promise<T> {
    const key = `table:${table}`;
    const raw = await this.durable.update<string>(`web:${this.owner}:${key}`, current =>
      JSON.stringify(change(current ? JSON.parse(current) as T : fallback)));
    this.values.set(key, raw);
    return JSON.parse(raw) as T;
  }
}
