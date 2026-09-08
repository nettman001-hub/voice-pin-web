const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PrintJobStore {
  constructor(storageDir) {
    this.storageDir = storageDir || process.cwd();
    this.filePath = path.join(this.storageDir, 'print-jobs.json');
    this.jobs = new Map();
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id) {
              this.jobs.set(item.id, item);
            }
          }
        }
      }
    } catch {
      // Storage corruption fallback: start clean
      this.jobs = new Map();
    }
  }

  flush() {
    try {
      const list = Array.from(this.jobs.values());
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch {
      // Disk write failure silently tolerated to protect daemon
    }
  }

  saveJob(job) {
    if (!job || !job.id) return;
    const existing = this.jobs.get(job.id) || {};
    const updated = {
      ...existing,
      ...job,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, updated);
    this.flush();
    return updated;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  updateJobStatus(jobId, status, details = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = status;
    Object.assign(job, details);
    job.updatedAt = new Date().toISOString();
    this.flush();
    return job;
  }

  listIncompleteJobs() {
    return Array.from(this.jobs.values()).filter((j) =>
      ['CLAIMED', 'SUBMITTING', 'UNKNOWN'].includes(j.status)
    );
  }

  isPayloadAlreadySubmitted(payloadHash) {
    if (!payloadHash) return false;
    for (const j of this.jobs.values()) {
      if (j.payloadHash === payloadHash && j.status === 'SUBMITTED') {
        return true;
      }
    }
    return false;
  }

  static hashPayload(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
  }
}

module.exports = { PrintJobStore };
