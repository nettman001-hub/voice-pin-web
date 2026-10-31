const workspace = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const channels: any[] = [];
const settings = { mode: 'COMMENT_TOUCH', prepareSeconds: 0, fallbackDelaySeconds: 0, tiktokId: 'fixture_live' };
export const phoneLifecycleState: any = {
  workspace, session, settings, run: null, sales: [], operations: new Map(),
  runCalls: [], commits: 0, printAcks: [], savedCaptures: [], nativeSelling: [],
  printJobs: [], captures: [], nativeWrites: 0, stream: null,
  nativePayloads: [], nativeSendDelayMs: 0,
  printerConnected: true, printerSaved: true, printerReconnects: 0, printerPicks: 0,
  printerDisconnects: 0, printerName: 'M50-fixture', printerSavedName: 'M50-fixture', nextPrinterName: 'M50-fixture',
  cameraStarts: 0, captureFrames: 0, captureFrameDelayMs: 0, cameraError: '',
  captureClaims: [], captureResets: 0, commitError: '',
  buyers: [
    { id: '33333333-3333-4333-8333-333333333331', platform: 'TIKTOK', platformUserId: 'buyer-hani', platformUniqueId: 'hani_shop', displayNickname: '하니', identityStatus: 'VERIFIED' },
    { id: '33333333-3333-4333-8333-333333333332', platform: 'TIKTOK', platformUserId: 'buyer-haneul', platformUniqueId: 'haneul_live', displayNickname: '하늘', identityStatus: 'VERIFIED' },
    { id: '33333333-3333-4333-8333-333333333333', platform: 'TIKTOK', platformUserId: 'buyer-flower', platformUniqueId: 'flower_shop', displayNickname: '꽃미', identityStatus: 'VERIFIED' },
    { id: '33333333-3333-4333-8333-333333333334', platform: 'TIKTOK', platformUserId: 'buyer-jini', platformUniqueId: 'jini_live', displayNickname: '지니', identityStatus: 'VERIFIED' },
    { id: '33333333-3333-4333-8333-333333333335', platform: 'TIKTOK', platformUserId: '718000000000000001', displayNickname: '소라', identityStatus: 'VERIFIED' },
    { id: '33333333-3333-4333-8333-333333333336', platform: 'TIKTOK', platformUserId: '718000000000000002', displayNickname: '소라', identityStatus: 'VERIFIED' },
  ],
  buyerSearchCalls: [], buyerSearchCompleted: [], buyerSearchHolds: new Set(), buyerSearchReleases: new Map(),
  buyerSearchErrors: new Set(), updateCalls: [],
};
const emitChange = () => {
  for (const channel of channels)
    for (const listener of channel.listeners)
      if (listener.type === 'postgres_changes') listener.callback({});
};
const client: any = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-only' } } }) },
  realtime: { setAuth: async () => {} },
  channel(name: string) {
    const channel: any = {
      name, listeners: [],
      on(type: string, filter: any, callback: any) { this.listeners.push({ type, filter, callback }); return this; },
      subscribe(callback: any) { channels.push(this); queueMicrotask(() => callback?.('SUBSCRIBED')); return this; },
      send: async () => 'ok',
    };
    return channel;
  },
  removeChannel: async (channel: any) => { const at = channels.indexOf(channel); if (at >= 0) channels.splice(at, 1); },
};
export const requireSupabase = () => client;
export const isSupabaseConfigured = true;
export const useAuth = () => ({ workspaceId: workspace, user: { id: 'seller', nickname: '테스트 판매자' }, logout: async () => {} });
export const remoteWorkspaceService = { fetchWorkspaceSettings: async () => ({ ...settings }) };
export const productSalesApi = {
  startSession: async () => ({ session: { id: session, displayCode: '2026-10-30 라이브 1회차' } }),
  searchBuyers: async (query = '') => {
    phoneLifecycleState.buyerSearchCalls.push(query);
    const normalized = query.trim().toLocaleLowerCase();
    const buyers = phoneLifecycleState.buyers.filter((buyer: any) =>
      `${buyer.displayNickname} ${buyer.platformUniqueId || ''}`.toLocaleLowerCase().includes(normalized),
    );
    if (phoneLifecycleState.buyerSearchHolds.has(query))
      await new Promise<void>((resolve) => phoneLifecycleState.buyerSearchReleases.set(query, resolve));
    phoneLifecycleState.buyerSearchCompleted.push(query);
    if (phoneLifecycleState.buyerSearchErrors.has(query)) throw new Error('구매자 목록을 불러오지 못했습니다.');
    return { buyers: structuredClone(buyers) };
  },
};
export class TouchSalesApi {
  readonly workspaceId: string;
  constructor(id: string) { this.workspaceId = id; }
  async bootstrap() {
    return {
      run: phoneLifecycleState.run ? structuredClone(phoneLifecycleState.run) : null,
      session: { id: session, display_code: '2026-10-30 라이브 1회차', status: 'ACTIVE' },
      product: null, sales: structuredClone(phoneLifecycleState.sales), serverNow: Date.now(),
    };
  }
  async clock() { return { receivedAt: Date.now(), sentAt: Date.now() }; }
  async call(action: string, payload: any) {
    if (action === 'search-buyers') return productSalesApi.searchBuyers(payload.query);
    if (action === 'touch-comment-token') return { mode: 'JWT', uniqueId: settings.tiktokId, jwtKey: 'fixture-token' };
    if (action === 'touch-tiktok-id') { settings.tiktokId = payload.uniqueId; return { tiktokId: settings.tiktokId }; }
    throw new Error(`Unexpected fixture action: ${action}`);
  }
  async run(kind: string, producerId: string, sessionId: string, runSettings: any, state: any) {
    phoneLifecycleState.runCalls.push(kind);
    phoneLifecycleState.run = {
      running: kind !== 'STOP', producer_id: producerId, session_id: sessionId,
      lease_expires_at: new Date(Date.now() + 30000).toISOString(), settings: runSettings, last_state: state,
    };
    emitChange();
    return { ok: true };
  }
  async commit(sale: any) {
    if (phoneLifecycleState.commitError)
      throw Object.assign(new Error('fixture database rejection'), { code: phoneLifecycleState.commitError });
    if (!phoneLifecycleState.run?.running)
      throw Object.assign(new Error('판매 연결이 멈췄습니다.'), { code: 'TOUCH_NOT_RUNNING' });
    const previous = phoneLifecycleState.operations.get(sale.operationId);
    if (previous) return previous;
    phoneLifecycleState.lastCommittedSale = structuredClone(sale);
    phoneLifecycleState.commits++;
    const captureDueAt = new Date(Date.now() + 400).toISOString();
    const id = `sale-${phoneLifecycleState.commits}`;
    const row = {
      id, sessionId: session, buyerId: sale.comment.platformUserId, buyerNickname: sale.comment.nickname,
      amount: sale.unitPrice * sale.quantity, unitPrice: sale.unitPrice, quantity: sale.quantity,
      recognizedAt: sale.confirmedAt, status: '자동저장', printStatus: 'PENDING', captureStatus: 'PENDING',
      captureDueAt, revision: 1, comment: sale.comment, history: [], recordState: 'ACTIVE',
    };
    phoneLifecycleState.sales.unshift(row);
    phoneLifecycleState.printJobs.push({ id: `print-${id}`, sale_id: id, immutable_payload: { buyerNickname: row.buyerNickname, amount: row.amount } });
    phoneLifecycleState.captures.push({ sale_id: id, capture_generation: `capture-${id}`, capture_due_at: captureDueAt });
    const result = { saleId: id, buyerId: row.buyerId, commentId: sale.comment.platformMessageId, amount: row.amount, captureDueAt };
    phoneLifecycleState.operations.set(sale.operationId, result);
    emitChange();
    return result;
  }
  async claimPrints() { return { jobs: phoneLifecycleState.printJobs.splice(0), leaseToken: 'fixture-lease' }; }
  async print(kind: string, jobId: string, leaseToken: string, result: string) {
    if (kind === 'ACK') {
      phoneLifecycleState.printAcks.push(result);
      const sale = phoneLifecycleState.sales.find((s: any) => `print-${s.id}` === jobId);
      if (sale) sale.printStatus = result === 'SUCCESS' ? 'PRINTED' : 'FAILED';
      emitChange();
    }
    return { ok: true };
  }
  async claimCaptures() {
    const captures = structuredClone(phoneLifecycleState.captures);
    phoneLifecycleState.captureClaims.push(captures);
    return { captures };
  }
  async saveCapture(producer: string, saleId: string, image: string, capturedAt: string, generation: string) {
    phoneLifecycleState.savedCaptures.push({ saleId, hasImage: !!image, generation });
    phoneLifecycleState.captures = phoneLifecycleState.captures.filter(
      (capture: any) => capture.sale_id !== saleId || capture.capture_generation !== generation,
    );
    const sale = phoneLifecycleState.sales.find((s: any) => s.id === saleId);
    if (sale) { sale.captureStatus = image ? 'CAPTURED' : 'MISSING'; sale.imageUrl = image; }
    emitChange();
    return { ok: true };
  }
  async detail() { return { history: [], settlementUsed: false, entryContext: {} }; }
  async update(patch: any) {
    phoneLifecycleState.updateCalls.push(structuredClone(patch));
    const sale = phoneLifecycleState.sales.find((s: any) => s.id === patch.saleId);
    if (!sale) throw new Error('Missing fixture sale');
    if (patch.kind === 'PRICE') { sale.unitPrice = patch.unitPrice; sale.amount = patch.unitPrice * sale.quantity; }
    if (patch.kind === 'CANCEL') sale.status = '취소';
    if (patch.kind === 'BUYER') {
      const buyer = phoneLifecycleState.buyers.find((item: any) => item.id === patch.buyerId);
      if (!buyer) throw new Error('Missing fixture buyer');
      sale.buyerId = buyer.id;
      sale.buyerNickname = buyer.displayNickname;
    }
    sale.revision++;
    emitChange();
    return { ok: true };
  }
  async resetCapture(saleId: string) {
    phoneLifecycleState.captureResets++;
    const generation = `capture-${saleId}-retake-${phoneLifecycleState.captureResets}`;
    const dueAt = new Date(Date.now() + 400).toISOString();
    phoneLifecycleState.captures.push({ sale_id: saleId, capture_generation: generation, capture_due_at: dueAt });
    const sale = phoneLifecycleState.sales.find((s: any) => s.id === saleId);
    if (sale) { sale.captureStatus = 'PENDING'; sale.captureDueAt = dueAt; }
    emitChange();
    return { ok: true };
  }
}
