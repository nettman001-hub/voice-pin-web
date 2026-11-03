/**
 * 폰 판매: Windows 댓글도우미가 서버에 올린 댓글을 커서로 받아 온다(PC_HELPER 댓글 출처).
 * - 서버가 정한 단조 증가 cursor로만 다음 페이지를 정한다(폰 시계를 쓰지 않음).
 * - hasMore면 바로 다음 페이지를 이어 받는다(1,000건에서 잘라내지 않음).
 * - 회차·연결 세대가 바뀌거나 멈추면 늦게 도착한 응답은 버린다.
 * - 판매 실행권(touch-run)은 그대로 폰이 갖는다. 이 스트림은 댓글 입력만 맡는다.
 */
import type { EulerStatus } from './eulerComments.ts';
import type { TouchComment } from '../types/touchSales.ts';

export type HelperPullComment = {
  cursor: number;
  commentId?: string;
  platformMessageId: string;
  platformUserId?: string | null;
  uniqueId?: string | null;
  nickname: string;
  content: string;
  capturedAt: string;
  storedAt?: string;
};

export type HelperPullResult = {
  enabled: boolean;
  sessionActive: boolean;
  helperAlive: boolean;
  stateVersion: number;
  generation: number;
  collector?: { tiktok?: string; username?: string; message?: string; lastCommentAt?: string | null; pending?: number };
  comments: HelperPullComment[];
  cursor: number;
  hasMore: boolean;
};

export interface HelperStreamApi {
  call<T>(action: string, payload?: Record<string, unknown>): Promise<T>;
}

export interface HelperCommentStreamOptions {
  api: HelperStreamApi;
  sessionId: string;
  producerId: string;
  linkToken: () => Promise<string | null>;
  onComments: (comments: TouchComment[]) => void;
  onStatus?: (status: EulerStatus) => void;
  /** 처음 붙을 때 보여 줄 최근 댓글 수(이후는 새 댓글만). */
  tail?: number;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  isVisible?: () => boolean;
}

export function helperToTouchComment(c: HelperPullComment, sessionId: string): TouchComment {
  return {
    id: c.commentId || `helper-${c.platformMessageId}`,
    platformMessageId: c.platformMessageId,
    sessionId,
    nickname: c.nickname,
    uniqueId: c.uniqueId || undefined,
    platformUserId: c.platformUserId || undefined,
    content: c.content,
    capturedAt: c.capturedAt,
    // 서버 cursor가 곧 표시 순서다.
    sequence: c.cursor,
  };
}

/** 서버 상태 → 화면 한 줄. "댓글 없음"(정상)과 "연결 끊김"을 구분한다. */
export function helperStatus(r: HelperPullResult): EulerStatus {
  if (!r.enabled) return { state: 'waiting', message: 'PC 도우미에서 댓글 연결이 꺼져 있습니다' };
  if (!r.helperAlive) return { state: 'error', message: 'PC 도우미 연결 끊김 · PC와 도우미 실행을 확인해 주세요' };
  if (!r.sessionActive) return { state: 'connecting' };
  const c = r.collector || {};
  if (c.tiktok === 'collecting') return { state: 'connected' };
  if (c.tiktok === 'waiting_live') return { state: 'waiting', message: 'PC 도우미 · 방송 시작 대기' };
  if (c.tiktok === 'ended') return { state: 'waiting', message: 'PC 도우미 · 방송 종료됨' };
  if (c.tiktok === 'error' || c.tiktok === 'blocked')
    return { state: 'error', message: `PC 도우미 · ${c.message || '틱톡 수집 오류'}` };
  return { state: 'connecting' };
}

const LINK_ERRORS = new Set(['LINK_NOT_ACTIVE', 'LINK_NOT_FOUND']);

export class HelperCommentStream {
  private stopped = true;
  private epoch = 0;
  private timer: unknown = null;
  private cursor: number | null = null;
  private failures = 0;
  private attached = false;
  /** 판매 시작 직후 첫 연결: 서버가 PC 도우미 댓글 연결을 켠다. 재연결·자동 재부착은 켜지 않는다. */
  private startPending = false;
  private o: Required<Pick<HelperCommentStreamOptions, 'intervalMs' | 'tail'>> & HelperCommentStreamOptions;
  private lastStatus = '';

  constructor(o: HelperCommentStreamOptions) {
    this.o = { intervalMs: 1500, tail: 100, ...o };
  }

  private status(s: EulerStatus) {
    const key = JSON.stringify(s);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.o.onStatus?.(s);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    const set = this.o.setTimer || ((fn: () => void, t: number) => setTimeout(fn, t));
    this.timer = set(() => void this.tick(), ms);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.epoch += 1;
    this.startPending = true;
    this.attached = false;
    this.status({ state: 'connecting' });
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    this.epoch += 1;
    if (this.timer) (this.o.clearTimer || ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
    this.status({ state: 'stopped' });
  }

  /** "댓글 재연결": 기다리던 확인을 버리고 회차에 다시 붙어 바로 받는다. 받은 위치(cursor)는 그대로라 같은 댓글이 두 번 오지 않는다. */
  reconnect() {
    if (this.stopped) return;
    this.epoch += 1;
    if (this.timer) (this.o.clearTimer || ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
    this.attached = false;
    this.failures = 0;
    this.status({ state: 'connecting' });
    this.schedule(0);
  }

  /** 판매 회차를 도우미 전달에 연결한다(판매 시작·이어서 판매 때 1회, 끊겼다 돌아오면 다시). 판매 시작의 첫 연결은 PC 도우미 댓글 연결도 켠다. */
  private async attach(token: string) {
    const start = this.startPending;
    await this.o.api.call('helper-attach', {
      linkToken: token,
      sessionId: this.o.sessionId,
      producerId: this.o.producerId,
      ...(start ? { start: true } : {}),
    });
    this.attached = true;
    this.startPending = false;
  }

  async detach() {
    const token = await this.o.linkToken();
    if (!token) return;
    await this.o.api
      .call('helper-detach', { linkToken: token, sessionId: this.o.sessionId, producerId: this.o.producerId })
      .catch(() => {});
  }

  async tick() {
    if (this.stopped) return;
    const epoch = this.epoch;
    let next = this.o.intervalMs;
    try {
      if (this.o.isVisible && !this.o.isVisible()) {
        // 화면이 꺼져도 짧게 계속 확인한다(접기·다른 화면 이동 때 수신기를 새로 만들지 않음).
        next = Math.max(next, 3000);
      }
      const token = await this.o.linkToken();
      if (epoch !== this.epoch) return;
      if (!token) {
        this.status({ state: 'error', message: 'PC 댓글도우미와 연결되지 않았습니다. 판매 설정에서 PC와 연결해 주세요' });
        next = 5000;
        return;
      }
      if (!this.attached) await this.attach(token);
      if (epoch !== this.epoch) return;
      for (let page = 0; page < 20; page += 1) {
        const r = await this.o.api.call<HelperPullResult>('helper-pull', {
          linkToken: token,
          sessionId: this.o.sessionId,
          after: this.cursor,
          tail: this.o.tail,
          limit: 500,
        });
        // 멈췄거나 회차가 바뀐 뒤 도착한 응답은 버린다.
        if (epoch !== this.epoch || this.stopped) return;
        this.failures = 0;
        if (!r.sessionActive && r.enabled && this.attached) {
          // 서버에서 회차 연결이 풀렸으면(도우미 재등록·폰 재승인 등) 다시 붙는다.
          this.attached = false;
        }
        this.status(helperStatus(r));
        if (r.comments.length) {
          this.o.onComments(r.comments.map((c) => helperToTouchComment(c, this.o.sessionId)));
        }
        if (r.enabled && r.sessionActive) this.cursor = r.cursor;
        if (!r.hasMore) break;
        next = 0;
      }
    } catch (e) {
      if (epoch !== this.epoch) return;
      const code = (e as { code?: string }).code || '';
      if (LINK_ERRORS.has(code)) {
        this.attached = false;
        this.status({ state: 'error', message: 'PC 도우미 연결이 해제되었습니다. 판매 설정에서 다시 연결해 주세요' });
        next = 5000;
      } else if (code === 'RUN_NOT_ACTIVE') {
        this.attached = false;
        this.status({ state: 'connecting' });
        next = 2000;
      } else {
        this.failures += 1;
        this.status(this.failures >= 3
          ? { state: 'error', message: '서버 연결 끊김 · 다시 연결 중' }
          : { state: 'waiting', message: '다시 연결 중' });
        next = Math.min(10000, 1000 * 2 ** Math.min(this.failures, 4));
      }
    } finally {
      if (epoch === this.epoch) this.schedule(next);
    }
  }
}
