import type { TouchSalesApi } from './touchSalesApi.ts';
import type { TouchComment, TouchPcState, TouchSettings, TouchPrintTarget } from '../types/touchSales.ts';
import {
  EulerCommentStream,
  type CommentToken,
  type EulerComment,
  type EulerStatus,
} from './eulerComments.ts';
import type { PhoneLabelPrinter } from './labelPrinter/phonePrinter.ts';
import { touchLabelNumber } from './touchSaleModes.ts';

/** 폰 단독 판매에서 사진 한 장을 찍어 달라는 요청. 화면이 카운트다운을 보여 주고 사진(JPEG data URL)을 돌려준다. */
export type PhoneCaptureRequest = {
  saleId: string;
  generation: string;
  /** 이 폰 시계 기준 찍을 시각(ms). */
  dueAt: number;
};

export type PhoneProducerStatus = {
  comments: EulerStatus;
  printer: { connected: boolean; name: string; printing: boolean; error: string };
  lastPrintAt: number;
};

export interface PhoneProducerOptions {
  api: TouchSalesApi;
  producerId: string;
  sessionId: string;
  displayCode: string;
  settings: TouchSettings;
  printer: PhoneLabelPrinter;
  serverOffset: () => number;
  totals: () => { totalCount: number; totalAmount: number };
  label: (payload: { buyer: string; amount: number; productLabel?: string }) => Uint8Array;
  capture: (request: PhoneCaptureRequest) => Promise<string | null>;
  onComments: (comments: TouchComment[]) => void;
  onStatus: (status: PhoneProducerStatus) => void;
  onError: (kind: string, error: unknown) => void;
  onChange: () => void;
  /** 시험용: 웹소켓 만들기 바꾸기. */
  socketFactory?: (url: string) => WebSocket;
}

/** Euler 댓글 1건 → 판매 화면 댓글. platformMessageId가 같으면 같은 댓글로 본다. */
export function eulerToTouchComment(c: EulerComment, sessionId: string, sequence: number): TouchComment {
  return {
    id: `euler-${c.id}`,
    platformMessageId: c.id,
    sessionId,
    nickname: c.nickname,
    uniqueId: c.uniqueId || undefined,
    platformUserId: c.userId,
    content: c.content,
    capturedAt: c.receivedAt,
    sequence,
  };
}

export function phoneOnlyState(
  o: Pick<PhoneProducerOptions, 'producerId' | 'sessionId' | 'displayCode' | 'settings'>,
  extra: { commentStatus: string; printerConnected: boolean; totalCount: number; totalAmount: number },
): Partial<TouchPcState> & { phoneOnly: true } {
  return {
    running: true,
    producerId: o.producerId,
    sessionId: o.sessionId,
    displayCode: o.displayCode,
    helperConnected: extra.commentStatus === 'connected',
    commentStatus: extra.commentStatus,
    screenConnected: false,
    printerConnected: extra.printerConnected,
    // 사진은 카운트다운이 끝나면 폰 앞카메라로 찍는다: 지연 0, 준비 시간 = 카운트다운.
    delaySeconds: 0,
    delaySource: 'SETTING',
    prepareSeconds: o.settings.prepareSeconds,
    totalCount: extra.totalCount,
    totalAmount: extra.totalAmount,
    phoneOnly: true,
  };
}

/**
 * 폰 단독 판매(PC 없음): 이 폰이 판매 연결(touch-run)의 주인이 되어
 * 댓글을 Euler에서 직접 받고, 전표는 블루투스 라벨프린터로, 사진은 앞카메라로 처리한다.
 */
export class TouchPhoneProducer {
  private stream: EulerCommentStream;
  private stopped = true;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private printTimer: ReturnType<typeof setTimeout> | null = null;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private printing = false;
  private printFlight = false;
  private capturing = false;
  private activeCaptureKey: string | null = null;
  private captureEpoch = 0;
  private claimBusy = false;
  private sequence = 0;
  private done = new Set<string>();
  private queue: PhoneCaptureRequest[] = [];
  private status: PhoneProducerStatus = {
    comments: { state: 'connecting' },
    printer: { connected: false, name: '', printing: false, error: '' },
    lastPrintAt: 0,
  };
  private o: PhoneProducerOptions;
  constructor(o: PhoneProducerOptions) {
    this.o = o;
    this.stream = new EulerCommentStream({
      getToken: () => o.api.call<CommentToken>('touch-comment-token'),
      onComments: (items) =>
        o.onComments(items.map((c) => eulerToTouchComment(c, o.sessionId, ++this.sequence))),
      onStatus: (s) => {
        this.status = { ...this.status, comments: s };
        this.emit();
      },
      socketFactory: o.socketFactory,
    });
  }

  private emit() {
    this.status = {
      ...this.status,
      printer: {
        ...this.status.printer,
        connected: this.o.printer.connected,
        name: this.o.printer.name,
        printing: this.printing,
      },
    };
    this.o.onStatus(this.status);
  }

  private state() {
    return phoneOnlyState(this.o, {
      commentStatus: this.status.comments.state,
      printerConnected: this.o.printer.connected,
      ...this.o.totals(),
    });
  }

  async start() {
    await this.o.api.run('START', this.o.producerId, this.o.sessionId, this.o.settings, this.state());
    this.stopped = false;
    this.stream.start();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 10000);
    this.captureTimer = setInterval(() => void this.claimCaptures(), 1500);
    void this.printLoop();
    void this.claimCaptures();
    this.emit();
  }

  private async heartbeat() {
    if (this.stopped) return;
    try {
      await this.o.api.run('HEARTBEAT', this.o.producerId, this.o.sessionId, this.o.settings, this.state());
    } catch (e) {
      if ((e as any)?.code === 'PC_LEASE_LOST') {
        this.o.onError('LEASE_LOST', e);
        this.halt();
      } else this.o.onError('HEARTBEAT', e);
    }
  }

  private async printLoop() {
    if (this.stopped || this.printFlight) return;
    this.printFlight = true;
    try {
      if (this.o.settings.printTarget !== 'PC_HELPER' && this.o.printer.connected) await this.printJobs();
    } catch (e) {
      this.o.onError('PRINT_ERROR', e);
    } finally {
      this.printFlight = false;
      if (!this.stopped) this.printTimer = setTimeout(() => void this.printLoop(), 1000);
    }
  }

  /** Server acknowledgement is authoritative; changing output never restarts comments or camera. */
  async changePrintTarget(printTarget: TouchPrintTarget) {
    if (this.stopped) throw new Error('판매를 시작한 뒤 출력 위치를 변경해 주세요.');
    const result = await this.o.api.setPrintTarget(this.o.producerId, printTarget);
    this.syncPrintTarget(result.printTarget);
    return result.printTarget;
  }

  syncPrintTarget(printTarget: TouchPrintTarget) {
    if (this.o.settings.printTarget === printTarget) return;
    this.o.settings = { ...this.o.settings, printTarget };
    this.emit();
    this.wake();
  }

  private async printJobs() {
    const { jobs, leaseToken } = await this.o.api.claimPrints(this.o.producerId);
    for (const job of jobs || []) {
      if (this.stopped) break;
      await this.o.api.print('BEGIN', job.id, leaseToken);
      const p = job.immutable_payload || {};
      const n = touchLabelNumber(p.productName);
      this.printing = true;
      this.emit();
      let result: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'SUCCESS';
      try {
        await this.o.printer.send(
          this.o.label({
            buyer: String(p.buyerNickname || ''),
            amount: Number(p.amount) || 0,
            productLabel: n !== null ? `${n}번` : undefined,
          }),
        );
        this.status.printer.error = '';
        this.status.lastPrintAt = Date.now();
      } catch (e) {
        // 보내다 끊기면 종이가 나왔는지 알 수 없다.
        result = this.o.printer.connected ? 'FAILED' : 'UNKNOWN';
        this.status.printer.error = (e as Error).message || '인쇄 실패';
        this.o.onError('PRINT_ERROR', e);
      } finally {
        this.printing = false;
      }
      await this.o.api.print('ACK', job.id, leaseToken, result);
      this.emit();
      this.o.onChange();
    }
  }

  /** 인쇄를 바로 확인한다(판매 저장 직후, 프린터 연결 직후). */
  wake() {
    if (this.stopped || this.printing) return;
    if (this.printTimer) clearTimeout(this.printTimer);
    void this.printLoop();
    void this.claimCaptures();
    this.emit();
  }

  private async claimCaptures() {
    if (this.stopped || this.claimBusy) return;
    const epoch = this.captureEpoch;
    this.claimBusy = true;
    try {
      const { captures } = await this.o.api.claimCaptures(this.o.producerId);
      if (this.stopped || epoch !== this.captureEpoch) return;
      for (const d of captures || []) {
        const key = `${d.sale_id}:${d.capture_generation}`;
        // A pending server claim can repeat throughout the countdown and upload.
        if (this.done.has(key) || this.activeCaptureKey === key ||
          this.queue.some((q) => q.saleId === d.sale_id && q.generation === d.capture_generation))
          continue;
        this.queue.push({
          saleId: d.sale_id,
          generation: d.capture_generation,
          dueAt: Date.parse(d.capture_due_at) - this.o.serverOffset(),
        });
      }
      this.queue.sort((a, b) => a.dueAt - b.dueAt);
    } catch (e) {
      if (!this.stopped && epoch === this.captureEpoch) this.o.onError('CAPTURE_ERROR', e);
    } finally {
      if (epoch === this.captureEpoch) this.claimBusy = false;
    }
    void this.nextCapture();
  }

  private async nextCapture() {
    if (this.stopped || this.capturing) return;
    let request = this.queue.shift();
    while (request && this.done.has(`${request.saleId}:${request.generation}`))
      request = this.queue.shift();
    if (!request) return;
    this.capturing = true;
    const key = `${request.saleId}:${request.generation}`;
    const epoch = this.captureEpoch;
    this.activeCaptureKey = key;
    let saving = false;
    try {
      const image = await this.o.capture(request);
      if (this.stopped || epoch !== this.captureEpoch) return;
      saving = true;
      await this.o.api.saveCapture(
        this.o.producerId,
        request.saleId,
        image || undefined,
        image ? new Date(Date.now() + this.o.serverOffset()).toISOString() : undefined,
        request.generation,
      );
      if (!this.stopped && epoch === this.captureEpoch) this.o.onChange();
    } catch (e) {
      if (!this.stopped && epoch === this.captureEpoch) this.o.onError('CAPTURE_ERROR', e);
    } finally {
      // A stopped countdown may be claimed again. An upload already sent must
      // remain deduplicated even when the same producer has since restarted.
      if (saving || epoch === this.captureEpoch) this.done.add(key);
      while (this.done.size > 1000) this.done.delete(this.done.values().next().value!);
      this.activeCaptureKey = null;
      this.capturing = false;
      if (!this.stopped && this.queue.length) void this.nextCapture();
    }
  }

  private halt() {
    this.stopped = true;
    this.captureEpoch++;
    this.claimBusy = false;
    this.stream.stop();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.captureTimer) clearInterval(this.captureTimer);
    if (this.printTimer) clearTimeout(this.printTimer);
    this.heartbeatTimer = this.captureTimer = null;
    this.printTimer = null;
    this.queue = [];
  }

  async stop() {
    if (this.stopped) return;
    this.halt();
    await this.o.api
      .run('STOP', this.o.producerId, this.o.sessionId, this.o.settings, {
        ...this.state(),
        running: false,
      })
      .catch(() => {});
  }

  get running() {
    return !this.stopped;
  }
}

/** 사진 Blob → 서버에 올리는 data URL. */
export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('사진을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}
