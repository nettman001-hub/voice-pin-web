const crypto = require('crypto');
const { PrintJobStore } = require('./printJobStore');

class CloudPrintWorker {
  constructor(options = {}) {
    this.apiEndpoint = options.apiEndpoint || 'http://127.0.0.1:54321/functions/v1/sales-api';
    this.deviceToken = options.deviceToken || '';
    this.workspaceId = options.workspaceId || '';
    this.deviceId = options.deviceId || '';
    this.store = options.printJobStore || new PrintJobStore();
    this.printFn = options.printFn || (async () => ({ ok: true, spoolJobId: Math.floor(Math.random() * 9000 + 1000) }));
    this.pollIntervalMs = options.pollIntervalMs || 2000;
    this.logger = options.logger || console;

    this.timer = null;
    this.leaseHeartbeats = new Map();
    this.isRunning = false;
    this.isProcessing = false;
  }

  async invokeApi(action, payload = {}) {
    const url = this.apiEndpoint;
    const headers = {
      'Content-Type': 'application/json',
      'x-workspace-id': this.workspaceId,
    };
    if (this.deviceToken) {
      headers['x-device-token'] = this.deviceToken;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, workspaceId: this.workspaceId, ...payload }),
    });

    const json = await response.json();
    if (!json.ok) {
      const err = new Error(json.error?.message || `API error on ${action}`);
      err.code = json.error?.code;
      err.details = json.error?.details;
      throw err;
    }
    return json.data;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextPoll(0);
    this.logger.log(`[CloudPrintWorker] Started with interval ${this.pollIntervalMs}ms`);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [, timer] of this.leaseHeartbeats) {
      clearInterval(timer);
    }
    this.leaseHeartbeats.clear();
    this.logger.log('[CloudPrintWorker] Stopped');
  }

  scheduleNextPoll(delayMs = this.pollIntervalMs) {
    if (!this.isRunning) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        await this.pollAndProcess();
      } catch (err) {
        this.logger.error('[CloudPrintWorker] Poll error:', err.message);
      } finally {
        this.scheduleNextPoll();
      }
    }, delayMs);
  }

  async pollAndProcess() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const claimResult = await this.invokeApi('claim-print-jobs', { limit: 5 });
      const jobs = claimResult.jobs || [];
      const leaseToken = claimResult.leaseToken;

      for (const job of jobs) {
        await this.processJob(job, leaseToken);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async processJob(job, leaseToken) {
    const payloadHash = PrintJobStore.hashPayload(job.immutablePayload);

    // Check if duplicate execution was already physically submitted
    if (this.store.isPayloadAlreadySubmitted(payloadHash)) {
      this.logger.log(`[CloudPrintWorker] Job ${job.id} payload already printed; skipping physical spool.`);
      try {
        await this.invokeApi('acknowledge-print-job', {
          jobId: job.id,
          leaseToken,
          result: 'SUCCESS',
          spoolJobId: 0,
        });
        this.store.updateJobStatus(job.id, 'SUBMITTED', { spoolJobId: 0 });
      } catch (err) {
        this.logger.error(`[CloudPrintWorker] Failed to acknowledge duplicate job ${job.id}:`, err.message);
      }
      return;
    }

    // Save initial claimed state
    this.store.saveJob({
      id: job.id,
      saleId: job.saleId || job.sale_id,
      saleRevision: job.saleRevision || job.sale_revision,
      kind: job.kind,
      status: 'CLAIMED',
      payloadHash,
      leaseToken,
      immutablePayload: job.immutablePayload,
    });

    // Start 10-second lease renewal heartbeat
    const heartbeat = setInterval(async () => {
      try {
        await this.invokeApi('renew-print-lease', { jobId: job.id, leaseToken });
      } catch (err) {
        this.logger.warn(`[CloudPrintWorker] Lease renew failed for ${job.id}:`, err.message);
      }
    }, 10000);
    this.leaseHeartbeats.set(job.id, heartbeat);

    try {
      // Step 1: Call begin-print-job and wait for server to record SUBMITTING
      const beginResult = await this.invokeApi('begin-print-job', {
        jobId: job.id,
        leaseToken,
        payloadHash,
        expectedSaleRevision: job.saleRevision || job.sale_revision || 1,
      });

      if (beginResult.status !== 'SUBMITTING') {
        throw new Error(`Invalid begin-print-job status: ${beginResult.status}`);
      }

      this.store.updateJobStatus(job.id, 'SUBMITTING');

      // Step 2: Spool to physical / Electron printer
      const printResult = await this.printFn(job);

      if (printResult.ok) {
        // Step 3: Acknowledge SUCCESS
        await this.invokeApi('acknowledge-print-job', {
          jobId: job.id,
          leaseToken,
          result: 'SUCCESS',
          spoolJobId: printResult.spoolJobId,
        });
        this.store.updateJobStatus(job.id, 'SUBMITTED', { spoolJobId: printResult.spoolJobId });
        this.logger.log(`[CloudPrintWorker] Job ${job.id} printed and submitted successfully`);
      } else {
        // Acknowledge FAILED
        await this.invokeApi('acknowledge-print-job', {
          jobId: job.id,
          leaseToken,
          result: 'FAILED',
          error: printResult.error,
        });
        this.store.updateJobStatus(job.id, 'FAILED', { error: printResult.error });
        this.logger.error(`[CloudPrintWorker] Job ${job.id} print failed: ${printResult.error}`);
      }
    } catch (err) {
      this.logger.error(`[CloudPrintWorker] Error processing job ${job.id}:`, err.message);
      // Inconclusive state -> UNKNOWN requiring manual review
      this.store.updateJobStatus(job.id, 'UNKNOWN', {
        message: err.message,
        requiresManualReview: true,
      });
    } finally {
      clearInterval(heartbeat);
      this.leaseHeartbeats.delete(job.id);
    }
  }
}

module.exports = { CloudPrintWorker };
