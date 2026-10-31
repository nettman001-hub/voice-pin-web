import type { TouchCommit } from '../types/touchSales';
import type { TouchFrame } from './touchFrameBuffer';
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
/** 다시 보내도 결과가 같아 판매자가 직접 확인해야 하는 실패. */
export const TOUCH_BLOCKED_CODES = [
  'COMMENT_ALREADY_COMMITTED',
  'SESSION_ENDED',
  'TOUCH_NOT_RUNNING',
  'VALIDATION_ERROR',
  'OPERATION_PAYLOAD_MISMATCH',
  'CLOCK_INVALID',
  'COMMENT_IDENTITY_CONFLICT',
];
/**
 * 판매 저장 실패를 판매자에게 보여 줄 말로 바꾼다.
 * 서버 응답 코드가 없을 때만 인터넷 문제로 본다. 로그인 풀림·서버 거부를
 * "인터넷 연결 후 자동으로 보냅니다"로 감추면 전표가 왜 안 나오는지 알 수 없다.
 */
export function touchCommitFailure(error: unknown): {
  blocked: boolean;
  network: boolean;
  message: string;
} {
  const e = (error || {}) as { message?: string; code?: string };
  const code = e.code || '';
  const blocked = TOUCH_BLOCKED_CODES.includes(code);
  if (!code)
    return {
      blocked: false,
      network: true,
      message: '인터넷 연결 후 자동으로 보냅니다.',
    };
  if (code === 'AUTH_REQUIRED')
    return {
      blocked: false,
      network: false,
      message:
        '로그인이 풀려 판매가 저장되지 않았습니다(전표도 나오지 않음). 다시 로그인하면 자동으로 보냅니다.',
    };
  if (code === 'CAPABILITY_DENIED')
    return {
      blocked: false,
      network: false,
      message:
        '이 계정에 판매 저장 권한이 없어 저장되지 않았습니다(전표도 나오지 않음). 판매자 계정으로 로그인해 주세요.',
    };
  return {
    blocked,
    network: false,
    message: blocked
      ? e.message || '확인해 주세요.'
      : `서버가 판매를 저장하지 못했습니다(전표도 나오지 않음): ${e.message || code} [${code}] 잠시 뒤 자동으로 다시 보냅니다.`,
  };
}
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
      const e = error as { message?: string; code?: string };
      const blocked = TOUCH_BLOCKED_CODES.includes(e.code || '');
      await store.putOutbox({
        ...item,
        error: e.message || '저장 확인 중',
        code: e.code,
        blocked,
      });
      if (!blocked) return;
    }
  }
}
