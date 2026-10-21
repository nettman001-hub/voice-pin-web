import { TouchSalesApi } from './touchSalesApi';
interface Event {
  id: string;
  kind: string;
  sessionId: string;
  producerId: string;
  metrics: Record<string, number>;
}
/** Only counters and opaque run IDs. Retry the same event ID after a lost acknowledgement. */
export class TouchTelemetry {
  private pending: Event[] = [];
  private busy = false;
  private key: string;
  constructor(private api: TouchSalesApi) {
    this.key = `voicecap-touch-telemetry:${api.workspaceId}`;
    try {
      this.pending = JSON.parse(localStorage.getItem(this.key) || '[]').slice(
        -500,
      );
    } catch {}
  }
  log(
    kind: string,
    sessionId: string,
    producerId: string,
    metrics: Record<string, number> = {},
  ) {
    this.pending.push({
      id: crypto.randomUUID(),
      kind,
      sessionId,
      producerId,
      metrics,
    });
    this.persist();
    void this.flush();
  }
  private persist() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.pending));
    } catch {
      /* telemetry cannot block selling */
    }
  }
  async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length) {
        const e = this.pending[0];
        await this.api.event(
          e.kind,
          e.sessionId,
          e.producerId,
          e.metrics,
          e.id,
        );
        this.pending.shift();
        this.persist();
      }
    } catch {
      /* the next summary/connection event retries the durable queue */
    } finally {
      this.busy = false;
    }
  }
}
