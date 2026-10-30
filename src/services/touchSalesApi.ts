import { invokeSalesApi } from './productSalesApi';
import type {
  TouchCommit,
  TouchCommitResult,
  TouchPcState,
  TouchRun,
  TouchSale,
  TouchSettings,
} from '../types/touchSales';
export interface TouchBootstrap {
  run: TouchRun | null;
  session: { id: string; display_code: string; status: string } | null;
  sales: TouchSale[];
  product: TouchPcState['product'];
  serverNow: number;
}
export class TouchSalesApi {
  constructor(readonly workspaceId: string) {}
  call<T>(action: string, payload: Record<string, unknown> = {}) {
    return invokeSalesApi<T>(action, {
      ...payload,
      workspaceId: this.workspaceId,
    });
  }
  bootstrap() {
    return this.call<TouchBootstrap>('touch-bootstrap');
  }
  clock() {
    return this.call<{ receivedAt: number; sentAt: number }>('touch-time');
  }
  detail(saleId: string) {
    return this.call<{
      history: any[];
      settlementUsed: boolean;
      entryContext: Record<string, unknown>;
    }>('touch-sale-detail', { saleId });
  }
  commit(sale: TouchCommit) {
    return this.call<TouchCommitResult>('commit-touch-sale', { sale });
  }
  run(
    kind: 'START' | 'HEARTBEAT' | 'STOP',
    producerId: string,
    sessionId: string,
    settings: TouchSettings,
    state: Partial<TouchPcState>,
  ) {
    return this.call('touch-run', {
      kind,
      producerId,
      sessionId,
      settings,
      state,
    });
  }
  claimPrints(producerId: string) {
    return this.call<{ jobs: any[]; leaseToken: string }>('claim-touch-jobs', {
      producerId,
    });
  }
  print(
    kind: 'BEGIN' | 'ACK',
    jobId: string,
    leaseToken: string,
    result?: 'SUCCESS' | 'FAILED' | 'UNKNOWN',
  ) {
    return this.call('touch-print', { kind, jobId, leaseToken, result });
  }
  /** 판매를 켜지 않고 폰 프린터로 바로 출력한 결과를 서버 기록에 남긴다. */
  recordPrint(saleId: string, result: 'SUCCESS' | 'FAILED') {
    return this.call('touch-record-print', { saleId, result });
  }
  claimCaptures(producerId: string) {
    return this.call<{ captures: any[] }>('claim-touch-captures', {
      producerId,
    });
  }
  saveCapture(
    producerId: string,
    saleId: string,
    image?: string,
    capturedAt?: string,
    generation?: string,
  ) {
    return this.call('touch-capture-save', {
      producerId,
      saleId,
      image,
      capturedAt,
      generation,
    });
  }
  resetCapture(saleId: string) {
    return this.call('touch-capture-reset', { saleId });
  }
  update(patch: {
    saleId: string;
    expectedRevision: number;
    kind: 'PRICE' | 'BUYER' | 'CANCEL' | 'REPRINT';
    inputPrice?: string;
    unitPrice?: number;
    buyerId?: string;
    reprint?: boolean;
  }) {
    return this.call('update-touch-sale', {
      patch: { operationId: crypto.randomUUID(), ...patch },
    });
  }
  event(
    kind: string,
    sessionId: string,
    producerId: string,
    metrics: Record<string, number> = {},
    eventId: string = crypto.randomUUID(),
  ) {
    return this.call('touch-events', {
      kind,
      sessionId,
      producerId,
      metrics,
      eventId,
    });
  }
}
