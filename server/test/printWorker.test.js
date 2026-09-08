const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PrintJobStore } = require('../printJobStore');
const { CloudPrintWorker } = require('../cloudPrintWorker');

test('CORE-10: PrintJobStore saves jobs, recovers from file, and checks payload idempotency', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicecap-print-test-'));
  try {
    const store = new PrintJobStore(tmpDir);

    const payload = {
      productCode: '0007',
      buyerNickname: '철수',
      quantity: 2,
      unitPrice: 20000,
      amount: 40000,
    };
    const hash = PrintJobStore.hashPayload(payload);

    // Initial check: not submitted
    assert.equal(store.isPayloadAlreadySubmitted(hash), false);

    // Save job as CLAIMED
    store.saveJob({
      id: 'job-101',
      saleId: 'sale-1',
      saleRevision: 1,
      status: 'CLAIMED',
      payloadHash: hash,
    });

    assert.equal(store.isPayloadAlreadySubmitted(hash), false);

    // Advance to SUBMITTING
    store.updateJobStatus('job-101', 'SUBMITTING');
    assert.equal(store.getJob('job-101').status, 'SUBMITTING');

    // Advance to SUBMITTED
    store.updateJobStatus('job-101', 'SUBMITTED', { spoolJobId: 1042 });
    assert.equal(store.isPayloadAlreadySubmitted(hash), true);

    // Test persistence recovery on new instance
    const store2 = new PrintJobStore(tmpDir);
    const recovered = store2.getJob('job-101');
    assert.ok(recovered);
    assert.equal(recovered.status, 'SUBMITTED');
    assert.equal(recovered.spoolJobId, 1042);
    assert.equal(store2.isPayloadAlreadySubmitted(hash), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CORE-10: CloudPrintWorker claims jobs, calls begin-print-job, executes print, and acknowledges SUBMITTED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicecap-worker-test-'));
  try {
    const store = new PrintJobStore(tmpDir);
    const apiCalls = [];
    let spooledCount = 0;

    const worker = new CloudPrintWorker({
      apiEndpoint: 'http://mock-api.local',
      workspaceId: 'ws-test',
      printJobStore: store,
      printFn: async (job) => {
        spooledCount++;
        return { ok: true, spoolJobId: 8888 };
      },
    });

    // Mock invokeApi
    worker.invokeApi = async (action, payload) => {
      apiCalls.push({ action, payload });
      if (action === 'claim-print-jobs') {
        return {
          jobs: [
            {
              id: 'job-999',
              saleId: 'sale-99',
              saleRevision: 1,
              kind: 'SALE',
              immutablePayload: { productCode: '0007', amount: 20000 },
            },
          ],
          leaseToken: 'lease_mock_123',
          leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
        };
      }
      if (action === 'begin-print-job') {
        return { status: 'SUBMITTING', serverRecordedAt: new Date().toISOString() };
      }
      if (action === 'acknowledge-print-job') {
        return { status: 'SUBMITTED', job: { id: payload.jobId, status: 'SUBMITTED' } };
      }
      return {};
    };

    // Execute one poll cycle
    await worker.pollAndProcess();

    // Verify API sequence
    assert.equal(apiCalls[0].action, 'claim-print-jobs');
    assert.equal(apiCalls[1].action, 'begin-print-job');
    assert.equal(apiCalls[1].payload.jobId, 'job-999');
    assert.equal(apiCalls[1].payload.leaseToken, 'lease_mock_123');
    assert.equal(apiCalls[2].action, 'acknowledge-print-job');
    assert.equal(apiCalls[2].payload.result, 'SUCCESS');
    assert.equal(apiCalls[2].payload.spoolJobId, 8888);

    // Verify physical spool was executed
    assert.equal(spooledCount, 1);

    // Verify store status is SUBMITTED
    const saved = store.getJob('job-999');
    assert.equal(saved.status, 'SUBMITTED');
    assert.equal(saved.spoolJobId, 8888);

    // Second execution with identical payload should NOT re-spool physically
    apiCalls.length = 0;
    await worker.pollAndProcess();
    assert.equal(spooledCount, 1); // Not incremented!
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CORE-10: Inconclusive print result marks UNKNOWN status requiring manual review without auto-reprint', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicecap-unknown-test-'));
  try {
    const store = new PrintJobStore(tmpDir);
    const worker = new CloudPrintWorker({
      apiEndpoint: 'http://mock-api.local',
      workspaceId: 'ws-test',
      printJobStore: store,
      printFn: async () => {
        throw new Error('Printer spool communication error');
      },
    });

    worker.invokeApi = async (action, payload) => {
      if (action === 'claim-print-jobs') {
        return {
          jobs: [
            {
              id: 'job-err',
              saleId: 'sale-err',
              saleRevision: 1,
              kind: 'SALE',
              immutablePayload: { productCode: '0007' },
            },
          ],
          leaseToken: 'lease_err',
        };
      }
      if (action === 'begin-print-job') {
        return { status: 'SUBMITTING' };
      }
      return {};
    };

    await worker.pollAndProcess();

    const job = store.getJob('job-err');
    assert.ok(job);
    assert.equal(job.status, 'UNKNOWN');
    assert.equal(job.requiresManualReview, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
