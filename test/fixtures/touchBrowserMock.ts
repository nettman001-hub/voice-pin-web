import type { TouchCommit } from '../../src/types/touchSales';
const workspace = '11111111-1111-4111-8111-111111111111',
  session = '22222222-2222-4222-8222-222222222222';
const channels: any[] = [];
let saved: any = {};
try {
  saved = JSON.parse(sessionStorage.getItem('touch-fixture-server') || '{}');
} catch {}
export const mockState: any = {
  workspace,
  session,
  sales: saved.sales || [],
  commits: saved.commits || 0,
  replyLost: false,
  operations: new Map(saved.operations || []),
  requestIds: saved.requestIds || [],
  channelConfigs: [],
  bridge: null,
};
const persist = () =>
  sessionStorage.setItem(
    'touch-fixture-server',
    JSON.stringify({
      sales: mockState.sales,
      commits: mockState.commits,
      operations: [...mockState.operations],
      requestIds: mockState.requestIds,
    }),
  );
const client: any = {
  auth: {
    getSession: async () => ({
      data: { session: { access_token: 'fixture-only' } },
    }),
  },
  realtime: { setAuth: async () => {} },
  channel: (name: string, config: any) => {
    const channel: any = {
      name,
      config,
      listeners: [],
      on(type: string, filter: any, callback: any) {
        this.listeners.push({ type, filter, callback });
        return this;
      },
      subscribe(callback: any) {
        channels.push(this);
        mockState.channelConfigs.push({ name, config });
        queueMicrotask(() => callback?.('SUBSCRIBED'));
        return this;
      },
      async send(envelope: any) {
        for (const other of channels)
          if (other !== this && other.name === name)
            queueMicrotask(() =>
              other.listeners
                .filter((l: any) => l.type === 'broadcast')
                .forEach((l: any) => l.callback({ payload: envelope.payload })),
            );
        return 'ok';
      },
    };
    return channel;
  },
  removeChannel: async (channel: any) => {
    const index = channels.indexOf(channel);
    if (index >= 0) channels.splice(index, 1);
  },
};
export const requireSupabase = () => client;
export const isSupabaseConfigured = true;
export const useAuth = () => ({
  workspaceId: workspace,
  user: { id: 'seller', nickname: '테스트 판매자' },
  isRemoteAuth: true,
  isAuthenticated: true,
  isInitialized: true,
});
export const emitChange = () => {
  for (const channel of channels)
    for (const listener of channel.listeners)
      if (listener.type === 'postgres_changes') listener.callback({});
};
export class TouchSalesApi {
  readonly workspaceId: string;
  constructor(id: string) {
    this.workspaceId = id;
  }
  async bootstrap() {
    return {
      run: {
        running: true,
        session_id: session,
        producer_id: 'fixture-pc',
        settings: {
          prepareSeconds: 4,
          fallbackDelaySeconds: 5,
          salesMode: sessionStorage.getItem('touch-fixture-mode') || undefined,
        },
      },
      session: {
        id: session,
        display_code: '2026-10-21 라이브 1회차',
        status: 'ACTIVE',
      },
      product: null,
      sales: structuredClone(mockState.sales),
      serverNow: Date.now(),
    };
  }
  async clock() {
    return { receivedAt: Date.now(), sentAt: Date.now() };
  }
  async detail() {
    return { history: [], settlementUsed: false, entryContext: {} };
  }
  async commit(sale: TouchCommit) {
    mockState.commits++;
    mockState.requestIds.push(sale.operationId);
    persist();
    let result = mockState.operations.get(sale.operationId);
    if (result) return result;
    if (
      mockState.sales.some(
        (s: any) =>
          s.comment.platformMessageId === sale.comment.platformMessageId,
      ) &&
      !sale.allowAdditional
    )
      throw Object.assign(new Error('이미 이 댓글로 판매했습니다.'), {
        code: 'COMMENT_ALREADY_COMMITTED',
      });
    result = {
      saleId: `s-${sale.operationId}`,
      buyerId: sale.comment.platformUserId || sale.comment.nickname,
      commentId: sale.comment.platformMessageId,
      amount: sale.unitPrice * sale.quantity,
      captureDueAt: new Date(Date.parse(sale.confirmedAt) + 9000).toISOString(),
    };
    mockState.operations.set(sale.operationId, result);
    mockState.sales.unshift({
      id: result.saleId,
      sessionId: session,
      buyerId: result.buyerId,
      buyerNickname: sale.comment.nickname,
      amount: result.amount,
      unitPrice: sale.unitPrice,
      quantity: sale.quantity,
      recognizedAt: sale.confirmedAt,
      status: '자동저장',
      printStatus: 'PRINTED',
      captureStatus: sale.captureOff
        ? 'SKIPPED'
        : sale.reuseProductPhoto
          ? 'MISSING'
          : 'PENDING',
      captureDueAt: result.captureDueAt,
      productName: sale.productLabel,
      slipLine: sale.slipLine,
      reuseProductPhoto: sale.reuseProductPhoto,
      revision: 1,
      comment: sale.comment,
      history: [],
    });
    persist();
    emitChange();
    if (mockState.replyLost) {
      mockState.replyLost = false;
      throw new Error('fixture network response lost after storing');
    }
    return result;
  }
  async update(patch: any) {
    const row = mockState.sales.find((s: any) => s.id === patch.saleId);
    if (!row) throw new Error('missing sale');
    if (row.revision !== patch.expectedRevision)
      throw new Error('revision conflict');
    if (patch.kind === 'CANCEL') row.status = '취소';
    if (patch.kind === 'PRICE') {
      row.unitPrice = patch.unitPrice;
      row.amount = patch.unitPrice * row.quantity;
      row.status = '수동수정';
    }
    row.revision++;
    persist();
    emitChange();
    return { ok: true };
  }
  async resetCapture() {
    return { ok: true };
  }
}
export const productSalesApi = { searchBuyers: async () => ({ buyers: [] }) };
