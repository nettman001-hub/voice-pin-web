import type { SellerLogicDecision } from '../types/sellerLogicAnalysis.ts';
import type { SalePrintRequest, SalePrintResult } from './commentStreamService.ts';

export type SellerLogicReceiptStatus = 'READY' | 'QUEUED' | 'PRINTED' | 'FAILED';
export interface SellerLogicReceipt {
  decisionId: string;
  revision: number;
  fingerprint: string;
  status: SellerLogicReceiptStatus;
  printedAt?: string;
  error?: string;
  /** A prior physical label may need removal after an AI correction/cancellation. */
  previousPrinted: boolean;
  outdated: boolean;
}
type Job = { decision: SellerLogicDecision; revision: number; fingerprint: string; automatic: boolean };
interface ReceiptOptions {
  sessionId: string;
  print: (request: SalePrintRequest) => Promise<SalePrintResult>;
  change: (receipts: SellerLogicReceipt[]) => void;
}

/** Checks transport fields; the AI alone chooses transaction identity and confirmation. */
export function sellerLogicPrintable(decision: SellerLogicDecision): boolean {
  return decision.status === 'CONFIRMED' && typeof decision.nickname === 'string' && !!decision.nickname.trim() &&
    Number.isSafeInteger(decision.unitPrice) && Number(decision.unitPrice) > 0 &&
    Number.isSafeInteger(decision.quantity) && decision.quantity > 0 && decision.quantity <= 99 &&
    Number(decision.unitPrice) * decision.quantity <= 99_999_999 && Number.isFinite(Date.parse(decision.decidedAt));
}
const fingerprint = (decision: SellerLogicDecision) => JSON.stringify([
  decision.nickname, decision.unitPrice, decision.quantity, decision.productName || '', decision.option || '', decision.orderCode || '',
]);

/** One queue per analysis session. Stable IDs/revisions match the helper's idempotency key. */
export class SellerLogicReceiptQueue {
  private decisions = new Map<string, SellerLogicDecision>();
  private receipts = new Map<string, SellerLogicReceipt>();
  private jobs: Job[] = [];
  private busy = false;
  private disposed = false;
  private printing: Job | null = null;
  private preparing: Job | null = null;
  private options: ReceiptOptions;
  constructor(options: ReceiptOptions) { this.options = options; }

  snapshot(): SellerLogicReceipt[] { return [...this.receipts.values()].map((row) => ({ ...row })); }
  private publish(): void { if (!this.disposed) this.options.change(this.snapshot()); }

  update(decisions: SellerLogicDecision[], automatic: boolean): void {
    if (this.disposed) return;
    this.decisions = new Map(decisions.map((row) => [row.id, { ...row }]));
    if (!automatic) {
      // Switching off automatic output cancels jobs that have not reached the device.
      for (const job of this.jobs.filter((row) => row.automatic)) this.cancelQueued(job);
      if (this.preparing?.automatic) this.cancelQueued(this.preparing);
      this.jobs = this.jobs.filter((row) => !row.automatic);
    }
    for (const receipt of this.receipts.values()) {
      if (!this.decisions.has(receipt.decisionId) && receipt.status === 'QUEUED') {
        this.receipts.set(receipt.decisionId, { ...receipt, status: 'READY' });
      }
    }
    for (const decision of decisions) {
      const before = this.receipts.get(decision.id);
      if (!sellerLogicPrintable(decision)) {
        if (before) this.receipts.set(decision.id, { ...before,
          status: before.status === 'QUEUED' ? 'READY' : before.status,
          outdated: before.previousPrinted || before.status === 'PRINTED' });
        continue;
      }
      const key = fingerprint(decision);
      if (!before || before.fingerprint !== key) this.receipts.set(decision.id, {
        decisionId: decision.id, revision: before?.revision || 0, fingerprint: key, status: 'READY',
        previousPrinted: before?.previousPrinted || before?.status === 'PRINTED' || false,
        outdated: before?.previousPrinted || before?.status === 'PRINTED' || false,
      });
      if (automatic && this.receipts.get(decision.id)?.status === 'READY') this.enqueue(decision, false, true);
    }
    this.publish();
    void this.drain();
  }

  print(decisionId: string, reprint = false): boolean {
    if (this.disposed) return false;
    const decision = this.decisions.get(decisionId), receipt = this.receipts.get(decisionId);
    if (!decision || !receipt || !sellerLogicPrintable(decision) || receipt.status === 'QUEUED' ||
        (receipt.status === 'PRINTED' && !reprint)) return false;
    this.enqueue(decision, reprint);
    this.publish();
    void this.drain();
    return true;
  }

  private cancelQueued(job: Job): void {
    if (this.printing === job) return;
    const receipt = this.receipts.get(job.decision.id);
    if (receipt?.revision === job.revision && receipt.status === 'QUEUED' && receipt.fingerprint === job.fingerprint) {
      this.receipts.set(job.decision.id, { ...receipt, status: 'READY' });
    }
  }

  private enqueue(decision: SellerLogicDecision, reprint = false, automatic = false): void {
    const receipt = this.receipts.get(decision.id)!;
    // A timeout can occur after the printer succeeded. Retry the same revision
    // so the helper can acknowledge its existing job without producing another label.
    const revision = receipt.status === 'FAILED' && !reprint ? Math.max(1, receipt.revision) : receipt.revision + 1;
    this.receipts.set(decision.id, { ...receipt, revision, status: 'QUEUED', error: undefined });
    this.jobs.push({ decision: { ...decision }, revision, fingerprint: receipt.fingerprint, automatic });
  }

  private current(job: Job): boolean {
    const decision = this.decisions.get(job.decision.id), receipt = this.receipts.get(job.decision.id);
    return !this.disposed && !!decision && sellerLogicPrintable(decision) && fingerprint(decision) === job.fingerprint &&
      receipt?.revision === job.revision && receipt.fingerprint === job.fingerprint && receipt.status === 'QUEUED';
  }

  private async drain(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.jobs.length && !this.disposed) {
        const job = this.jobs.shift()!;
        this.preparing = job;
        if (!this.current(job)) continue;
        // Evidence-issued IDs can exceed the helper's 160-character limit.
        // Hash the complete session + decision identity instead of truncating it.
        let response: SalePrintResult;
        try {
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([this.options.sessionId, job.decision.id])));
          const saleId = `codex:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
          if (!this.current(job)) continue;
          this.printing = job;
          response = await this.options.print({ saleId, printRevision: job.revision,
            buyerNickname: job.decision.nickname!, amount: job.decision.unitPrice! * job.decision.quantity,
            recognizedAt: job.decision.decidedAt, sessionId: `AI-${this.options.sessionId.slice(0, 8)}` });
        } catch (error) {
          response = { ok: false, status: 'FAILED', error: error instanceof Error ? error.message : String(error) };
        }
        this.printing = null;
        if (this.disposed) break;
        const receipt = this.receipts.get(job.decision.id);
        if (!receipt) continue;
        // Preserve the fact an older physical label was printed even if AI changed
        // or cancelled this transaction while the device response was in flight.
        if (!this.current(job)) {
          if (response.ok) this.receipts.set(job.decision.id, { ...receipt, previousPrinted: true, outdated: true });
        } else this.receipts.set(job.decision.id, { ...receipt,
          status: response.ok ? 'PRINTED' : 'FAILED', printedAt: response.ok ? response.printedAt || new Date().toISOString() : undefined,
          error: response.ok ? undefined : response.error || '전표 출력에 실패했습니다.',
          previousPrinted: receipt.previousPrinted || response.ok, outdated: response.ok ? false : receipt.outdated,
        });
        this.publish();
      }
    } finally { this.busy = false; this.preparing = this.printing = null; }
  }

  dispose(): void { this.disposed = true; this.jobs = []; }
}
