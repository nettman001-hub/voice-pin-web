const crypto = require('crypto');

class CloudCommentPublisher {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || process.env.VOICECAP_SALES_API_URL || '';
    this.deviceToken = options.deviceToken || process.env.VOICECAP_DEVICE_TOKEN || '';
    this.workspaceId = options.workspaceId || process.env.VOICECAP_WORKSPACE_ID || '';
    this.sessionId = options.sessionId || null;
    this.collectorId = options.collectorId || process.env.VOICECAP_DEVICE_ID || null;

    this.batchSize = options.batchSize || 20;
    this.flushIntervalMs = options.flushIntervalMs || 500;
    this.maxRetries = options.maxRetries || 3;
    this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    this.logger = options.logger || console;

    this.queue = [];
    this.sequence = 0;
    this.flushTimer = null;
    this.isFlushing = false;

    this.stats = {
      queuedCount: 0,
      sentCount: 0,
      failedCount: 0,
      retryCount: 0,
    };
  }

  configure(options = {}) {
    if (options.apiUrl !== undefined) this.apiUrl = options.apiUrl;
    if (options.deviceToken !== undefined) this.deviceToken = options.deviceToken;
    if (options.workspaceId !== undefined) this.workspaceId = options.workspaceId;
    if (options.sessionId !== undefined) this.sessionId = options.sessionId;
    if (options.collectorId !== undefined) this.collectorId = options.collectorId;
    if (options.batchSize !== undefined) this.batchSize = options.batchSize;
    if (options.flushIntervalMs !== undefined) this.flushIntervalMs = options.flushIntervalMs;
    if (options.maxRetries !== undefined) this.maxRetries = options.maxRetries;
    if (options.fetchFn !== undefined) this.fetchFn = options.fetchFn;
  }

  setSession(sessionId) {
    this.sessionId = sessionId;
  }

  enqueue(raw) {
    if (!raw) return;

    this.sequence += 1;
    const normalized = {
      platformMessageId: String(raw.id || raw.platformMessageId || `msg-${Date.now()}-${this.sequence}`),
      platformUserId: raw.userId != null ? String(raw.userId) : (raw.uniqueId ? String(raw.uniqueId) : undefined),
      platformUniqueId: raw.uniqueId ? String(raw.uniqueId) : undefined,
      nickname: String(raw.nickname || raw.uniqueId || '익명'),
      content: String(raw.content || '').trim(),
      capturedAt: raw.receivedAt || raw.capturedAt || new Date().toISOString(),
      ingestSequence: this.sequence,
    };

    this.queue.push(normalized);
    this.stats.queuedCount += 1;

    if (this.queue.length >= this.batchSize) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  async flush() {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const batch = this.queue.splice(0, this.batchSize);

    const payload = {
      action: 'ingest-comments',
      operationId: crypto.randomUUID(),
      sessionId: this.sessionId,
      collectorId: this.collectorId,
      comments: batch,
    };

    if (this.workspaceId) {
      payload.workspaceId = this.workspaceId;
    }

    let success = false;
    let attempt = 0;

    while (!success && attempt <= this.maxRetries) {
      if (!this.fetchFn || !this.apiUrl) {
        // Mock / unconfigured mode: count as dispatched
        this.stats.sentCount += batch.length;
        success = true;
        break;
      }

      try {
        const headers = {
          'Content-Type': 'application/json',
        };
        if (this.deviceToken) {
          headers['x-voicecap-device-token'] = this.deviceToken;
        }

        const res = await this.fetchFn(this.apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          this.stats.sentCount += batch.length;
          success = true;
          break;
        } else {
          const errText = await res.text().catch(() => '');
          attempt += 1;
          this.stats.retryCount += 1;
          this.logger.warn?.(`[CloudCommentPublisher] Ingest failed (HTTP ${res.status}): ${errText}. Attempt ${attempt}/${this.maxRetries}`);
          if (attempt <= this.maxRetries) {
            const backoff = Math.min(2000, 100 * Math.pow(2, attempt));
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      } catch (err) {
        attempt += 1;
        this.stats.retryCount += 1;
        this.logger.warn?.(`[CloudCommentPublisher] Network error: ${err.message}. Attempt ${attempt}/${this.maxRetries}`);
        if (attempt <= this.maxRetries) {
          const backoff = Math.min(2000, 100 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    if (!success) {
      this.stats.failedCount += batch.length;
      this.logger.error?.(`[CloudCommentPublisher] Dropping ${batch.length} comments after ${this.maxRetries} failed retries.`);
    }

    this.isFlushing = false;

    // Flush remaining if any
    if (this.queue.length > 0 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
    };
  }

  stop() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

module.exports = {
  CloudCommentPublisher,
};
