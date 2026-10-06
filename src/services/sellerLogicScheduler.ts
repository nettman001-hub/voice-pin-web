/** A transport queue, not a sales classifier. New events coalesce while AI is busy. */
export class SellerLogicScheduler<Input, Output> {
  private latest: { revision: number; input: Input } | null = null;
  private completed = 0;
  private revision = 0;
  private running = false;
  private automatic = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: {
    execute: (input: Input) => Promise<Output>;
    result: (output: Output, input: Input) => void;
    error: (error: unknown) => void;
    state?: (state: { running: boolean; automatic: boolean }) => void;
    intervalMs?: number;
  }) {}

  submit(input: Input) {
    if (this.disposed) return;
    this.latest = { revision: ++this.revision, input };
    this.schedule();
  }

  setAutomatic(value: boolean) {
    if (this.disposed) return;
    this.automatic = value;
    if (!value && this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.notify();
    this.schedule();
  }

  setIntervalMs(intervalMs: number) {
    if (this.disposed || !Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs === this.options.intervalMs) return;
    this.options.intervalMs = intervalMs;
    // Only waiting work is rescheduled. An active analysis keeps its snapshot.
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.schedule();
  }

  analyzeNow() {
    if (this.disposed) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void this.run(true);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.latest = null;
  }

  private notify() {
    if (!this.disposed) this.options.state?.({ running: this.running, automatic: this.automatic });
  }

  private schedule() {
    if (this.disposed || !this.automatic || this.running || this.timer || !this.latest || this.latest.revision <= this.completed) return;
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, this.options.intervalMs ?? 5000);
  }

  private async run(force = false) {
    if (this.disposed || this.running || !this.latest || (!force && this.latest.revision <= this.completed)) return;
    const snapshot = this.latest;
    this.running = true;
    this.notify();
    try {
      const output = await this.options.execute(snapshot.input);
      if (this.disposed) return;
      this.options.result(output, snapshot.input);
      this.completed = snapshot.revision;
    } catch (error) {
      if (!this.disposed) {
        this.automatic = false;
        this.options.error(error);
      }
    } finally {
      this.running = false;
      this.notify();
      this.schedule();
    }
  }
}
