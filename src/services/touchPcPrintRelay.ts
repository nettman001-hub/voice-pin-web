import type { SalePrintRequest, SalePrintResult } from './commentStreamService';

export interface PcRelayPrinterState {
  ready: boolean;
  printerName?: string;
  verified: boolean;
  message: string;
}

export function pcRelayPrinterReadiness(
  connected: boolean,
  settings?: { enabled: boolean; printerName: string },
): PcRelayPrinterState {
  if (!connected) return { ready: false, verified: false, message: '댓글 도우미 연결을 기다립니다. PC에서 댓글 도우미를 실행해 주세요.' };
  if (!settings) return { ready: true, verified: false, message: '도우미 연결 · 프린터 설정은 도우미에서 확인해 주세요.' };
  const printerName = settings.printerName.trim();
  return {
    ready: settings.enabled && !!printerName,
    verified: true,
    printerName: printerName || undefined,
    message: settings.enabled && printerName
      ? `${printerName} · 자동 출력 준비됨`
      : '댓글 도우미에서 Windows 프린터를 선택하고 자동 출력을 켜 주세요.',
  };
}

export interface PcPrintRelayStatus extends PcRelayPrinterState {
  running: boolean;
  printing: boolean;
  lastPrintAt: number;
}

interface RelayPrintJob {
  id: string;
  sale_id: string;
  sale_revision: number;
  immutable_payload: {
    buyerNickname?: string;
    amount?: number;
    recognizedAt?: string;
    slipLine?: string;
    sessionDisplayCode?: string;
    displayCode?: string;
  };
}

export interface PcPrintRelayOptions {
  api: {
    printRelay(kind: 'START' | 'HEARTBEAT' | 'STOP', relayId: string, ready: boolean, printerName?: string): Promise<unknown>;
    claimRelayPrints(relayId: string): Promise<{ jobs: RelayPrintJob[]; leaseToken: string }>;
    print(kind: 'BEGIN' | 'ACK', jobId: string, leaseToken: string, result?: 'SUCCESS' | 'FAILED' | 'UNKNOWN'): Promise<unknown>;
  };
  relayId: string;
  readiness: () => Promise<PcRelayPrinterState> | PcRelayPrinterState;
  connected: () => boolean;
  print: (payload: SalePrintRequest) => Promise<SalePrintResult>;
  onStatus: (status: PcPrintRelayStatus) => void;
  onError: (error: unknown) => void;
  onChange: () => void;
}

function relaySessionLine(payload: RelayPrintJob['immutable_payload']) {
  const session = (payload.sessionDisplayCode || payload.displayCode || '').trim();
  return [payload.slipLine?.trim(), session && !session.includes('회차') ? `${session} 회차` : session]
    .filter(Boolean).join(' · ').slice(0, 80) || undefined;
}

/** Prints only phone PC_HELPER jobs. This relay never owns the sale run, comments, or camera. */
export class TouchPcPrintRelay {
  private options: PcPrintRelayOptions;
  private stopped = true;
  private epoch = 0;
  private busy = false;
  private heartbeatBusy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private status: PcPrintRelayStatus = {
    running: false, ready: false, verified: false, message: '', printing: false, lastPrintAt: 0,
  };

  constructor(options: PcPrintRelayOptions) { this.options = options; }
  private active(epoch: number) { return !this.stopped && this.epoch === epoch; }
  private emit(readiness?: PcRelayPrinterState) {
    this.status = { ...this.status, ...readiness, running: !this.stopped };
    this.options.onStatus({ ...this.status });
  }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    const epoch = ++this.epoch;
    try {
      const readiness = await this.options.readiness();
      if (!this.active(epoch)) return;
      await this.options.api.printRelay('START', this.options.relayId, readiness.ready, readiness.printerName);
      if (!this.active(epoch)) {
        await this.options.api.printRelay('STOP', this.options.relayId, false).catch(() => {});
        return;
      }
      this.emit(readiness);
      this.heartbeatTimer = setInterval(() => void this.heartbeat(), 10000);
      void this.tick();
    } catch (error) {
      if (this.active(epoch)) this.halt();
      throw error;
    }
  }

  private async heartbeat() {
    if (this.stopped || this.heartbeatBusy) return;
    const epoch = this.epoch;
    this.heartbeatBusy = true;
    try {
      const readiness = await this.options.readiness();
      if (!this.active(epoch)) return;
      await this.options.api.printRelay('HEARTBEAT', this.options.relayId, readiness.ready, readiness.printerName);
      if (this.active(epoch)) this.emit(readiness);
    } catch (error) {
      if (this.active(epoch)) {
        if ((error as { code?: string })?.code === 'PRINT_RELAY_LEASE_LOST') this.halt();
        this.options.onError(error);
      }
    } finally {
      this.heartbeatBusy = false;
    }
  }

  private async tick() {
    if (this.stopped || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      if (!this.status.ready || !this.options.connected()) return;
      const result = await this.options.api.claimRelayPrints(this.options.relayId);
      for (const job of result.jobs || []) {
        if (!this.active(epoch) || !this.options.connected()) break;
        await this.options.api.print('BEGIN', job.id, result.leaseToken);
        if (!this.active(epoch) || !this.options.connected()) {
          await this.options.api.print('ACK', job.id, result.leaseToken, 'FAILED');
          break;
        }
        this.status.printing = true;
        this.emit();
        let outcome: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN';
        let printError: unknown;
        try {
          const payload = job.immutable_payload || {};
          const printed = await this.options.print({
            saleId: job.sale_id,
            printRevision: job.sale_revision,
            buyerNickname: String(payload.buyerNickname || ''),
            amount: Number(payload.amount) || 0,
            recognizedAt: String(payload.recognizedAt || ''),
            sessionId: relaySessionLine(payload),
          });
          outcome = printed.ok ? 'SUCCESS' : /시간|응답|timeout/i.test(printed.error || '') ? 'UNKNOWN' : 'FAILED';
          if (!printed.ok) printError = new Error(printed.error || '전표를 출력하지 못했습니다.');
          else this.status.lastPrintAt = Date.now();
        } catch (error) {
          // After handing a job to the helper, an exception cannot establish that no paper came out.
          printError = error;
        } finally {
          this.status.printing = false;
        }
        // Keep the acknowledgement even if the user stopped while the helper was printing.
        await this.options.api.print('ACK', job.id, result.leaseToken, outcome);
        if (this.active(epoch)) {
          this.emit();
          this.options.onChange();
          if (printError) this.options.onError(printError);
        }
      }
    } catch (error) {
      if (this.active(epoch)) {
        if ((error as { code?: string })?.code === 'PRINT_RELAY_LEASE_LOST') this.halt();
        this.options.onError(error);
      }
    } finally {
      this.busy = false;
      if (this.active(epoch)) this.timer = setTimeout(() => void this.tick(), 1000);
    }
  }

  wake() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    if (!this.busy) void this.tick();
    void this.heartbeat();
  }

  private halt() {
    this.stopped = true;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = this.heartbeatTimer = null;
    this.status.ready = false;
    this.emit();
  }

  async stop() {
    if (this.stopped) return;
    this.halt();
    await this.options.api.printRelay('STOP', this.options.relayId, false);
  }

  get running() { return !this.stopped; }
}
