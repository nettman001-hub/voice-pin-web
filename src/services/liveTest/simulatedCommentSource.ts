import type { CommentStreamStatus, StreamedComment, SalePrintRequest, SalePrintResult } from '../commentStreamService';

const BUYERS = [
  { nickname: '민트', uniqueId: 'test_mint', userId: 'test-account-1' },
  { nickname: '하늘', uniqueId: 'test_sky', userId: 'test-account-2' },
  { nickname: '봄이', uniqueId: 'test_spring', userId: 'test-account-3' },
  { nickname: '초코', uniqueId: 'test_choco', userId: 'test-account-4' },
  { nickname: '별이', uniqueId: 'test_star', userId: 'test-account-5' },
];
const CONTENTS = ['저요', '안녕하세요', '2개 주세요', '가격이 얼마예요?', '이거 할게요', '예쁘네요', '저요', '배송은 언제 되나요?'];

// Only comments are synthesized. No transcript, sale, or AI answer is invented.
export class SimulatedCommentSource {
  private statuses = new Set<(status: CommentStreamStatus, message?: string) => void>();
  private comments = new Set<(comment: StreamedComment) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private connected = false;
  private sequence = 0;
  private status: CommentStreamStatus = 'DISCONNECTED';

  constructor(private readonly print: (request: SalePrintRequest) => Promise<void>) {}
  get isConnectedToServer() { return this.connected; }
  onStatus(listener: (status: CommentStreamStatus, message?: string) => void) {
    this.statuses.add(listener);
    listener(this.status, '가상 댓글 생성기');
    return () => { this.statuses.delete(listener); };
  }
  onComment(listener: (comment: StreamedComment) => void) {
    this.comments.add(listener);
    return () => { this.comments.delete(listener); };
  }
  private emit(status: CommentStreamStatus) {
    this.status = status;
    for (const listener of this.statuses) listener(status, status === 'COLLECTING' ? '가상 댓글을 실시간 생성하고 있습니다.' : '가상 댓글 생성 대기');
  }
  connect(_url: string) {
    if (this.connected) return;
    this.connected = true;
    this.emit('CONNECTED');
  }
  startCollecting(_username: string) {
    if (this.timer) return;
    this.emit('COLLECTING');
    const next = () => {
      const i = this.sequence++;
      const buyer = BUYERS[i % BUYERS.length];
      const comment = { ...buyer, id: `test-${crypto.randomUUID()}`, content: CONTENTS[i % CONTENTS.length], receivedAt: new Date().toISOString() };
      for (const listener of this.comments) listener(comment);
    };
    // Let the shared capture provider activate its listener/session first.
    this.timer = setInterval(next, 2500);
    next();
  }
  stopCollecting() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.connected && this.status !== 'CONNECTED') this.emit('CONNECTED');
  }
  disconnect() { this.stopCollecting(); this.connected = false; this.emit('DISCONNECTED'); }
  configureCloudPublishing(_config: unknown) { /* This source has no publishing connection. */ }
  async printSale(request: SalePrintRequest): Promise<SalePrintResult> {
    await this.print(request);
    return { ok: true, status: 'PRINTED', printedAt: new Date().toISOString() };
  }
}
