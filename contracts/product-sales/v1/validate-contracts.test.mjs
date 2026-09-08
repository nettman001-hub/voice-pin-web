import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, 'fixtures');
const schemasDir = path.join(__dirname, 'schemas');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidUuid(id, msg) {
  assert.match(id, UUID_REGEX, msg || `${id} must be a valid UUID`);
}

test('Contract Fixture Verification: Bootstrap', () => {
  const file = path.join(fixturesDir, 'bootstrap.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(data.ok, true);
  assert.equal(data.apiVersion, 1);
  assert.ok(data.serverTime);

  const d = data.data;
  assertValidUuid(d.workspaceId, 'workspaceId');
  assert.equal(d.settings.revision, 1);
  assert.equal(d.settings.productRegistrationEnabled, true);
  assert.equal(d.settings.voicePreviewMs, 2500);
  assert.deepEqual(d.settings.voiceCommands.registerProduct, ['상품등록']);
  assert.deepEqual(d.settings.voiceCommands.confirmSale, ['판매완료', '구매확정']);

  assertValidUuid(d.activeSession.id, 'sessionId');
  assert.equal(d.activeSession.status, 'ACTIVE');
  assert.equal(d.activeSession.revision, 8);

  assertValidUuid(d.activeProduct.id, 'productId');
  assert.equal(d.activeProduct.productCode, 'P-20260907-000123');
  assert.equal(d.activeProduct.unitPrice, 20000);
  assert.equal(d.activeProduct.imageKind, 'PHOTO');
  assert.equal(d.activeProduct.revision, 2);
  assert.equal(d.activeProduct.salesRevision, 0);

  assertValidUuid(d.printerStatus.outputDeviceId, 'printerDeviceId');
  assert.equal(d.printerStatus.online, true);
  assert.ok(Array.isArray(d.permissions));
  assert.ok(d.permissions.includes('SALES_WRITE'));
});

test('Contract Fixture Verification: Feed & Real-time Stats', () => {
  const file = path.join(fixturesDir, 'feed.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const normal = data.normalFeedWithComments;
  assert.equal(normal.ok, true);
  assert.equal(normal.data.comments.length, 3);

  // Order must be capturedAt / ingestSequence descending
  assert.equal(normal.data.comments[0].nicknameSnapshot, '영희');
  assert.equal(normal.data.comments[1].nicknameSnapshot, '철수');
  assert.equal(normal.data.comments[2].nicknameSnapshot, '철수');

  // Verify same buyer comments do not inflate buyer stats prior to sale
  assert.equal(normal.data.buyerStats['66666666-6666-4666-8666-666666666666'].sessionQuantity, 2);
  assert.equal(normal.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseCount, 5);

  // Empty comments feed with watchedBuyerIds stats update
  const emptyFeed = data.emptyCommentsWithWatchedBuyersStatsUpdate;
  assert.equal(emptyFeed.ok, true);
  assert.equal(emptyFeed.data.comments.length, 0);
  assert.equal(emptyFeed.data.summary.sessionQuantity, 5);
  assert.equal(emptyFeed.data.summary.sessionAmount, 100000);
  assert.equal(emptyFeed.data.buyerStats['66666666-6666-4666-8666-666666666666'].sessionQuantity, 4);
  assert.equal(emptyFeed.data.buyerStats['66666666-6666-4666-8666-666666666666'].sessionAmount, 80000);
  assert.equal(emptyFeed.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseCount, 6);
  assert.equal(emptyFeed.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseAmount, 160000);
});

test('Contract Fixture Verification: Product Prepare, Fallback & Commit', () => {
  const file = path.join(fixturesDir, 'product_prepare_commit.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Leading zeros preservation
  const prep = data.prepareProductCode0007;
  assert.equal(prep.request.action, 'prepare-product');
  assert.equal(prep.request.requestedProductCode, '0007');
  assert.equal(prep.response.data.productCode, '0007');
  assertValidUuid(prep.response.data.draftId, 'draftId');
  assertValidUuid(prep.response.data.productId, 'productId');

  // Fallback to NUMBER_IMAGE
  const fallback = data.updateProductDraftFallbackNumberImage;
  assert.equal(fallback.request.action, 'update-product-draft');
  assert.equal(fallback.request.imageFallbackConfirmed, true);
  assert.equal(fallback.request.imageKind, 'NUMBER_IMAGE');
  assert.equal(fallback.response.data.draft.imageKind, 'NUMBER_IMAGE');
  assert.equal(fallback.response.data.draft.draftRevision, 2);

  // Commit product
  const commit = data.commitProduct;
  assert.equal(commit.request.action, 'commit-product');
  assert.equal(commit.response.data.product.productCode, '0007');
  assert.equal(commit.response.data.product.imageKind, 'NUMBER_IMAGE');
  assert.equal(commit.response.data.session.activeProductId, commit.response.data.product.id);
  assert.equal(commit.response.data.session.revision, 9);
});

test('Contract Fixture Verification: Commit Sales (Math & Acceptance Test Alignment)', () => {
  const file = path.join(fixturesDir, 'commit_sales.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const req = data.request;
  assert.equal(req.action, 'commit-sales');
  assertValidUuid(req.operationId, 'operationId');
  assert.equal(req.buyers.length, 2);

  // Cheolsu had 2 comments, but quantity is explicitly set to 2
  assert.equal(req.buyers[0].quantity, 2);
  assert.equal(req.buyers[0].sourceCommentIds.length, 2);
  // Yeonghui had 1 comment, quantity 1
  assert.equal(req.buyers[1].quantity, 1);

  const res = data.response;
  assert.equal(res.ok, true);
  assert.equal(res.data.status, 'SUCCEEDED');
  assert.equal(res.data.sales.length, 2);

  // Sale amounts
  const cheolsuSale = res.data.sales[0];
  assert.equal(cheolsuSale.quantity, 2);
  assert.equal(cheolsuSale.unitPrice, 20000);
  assert.equal(cheolsuSale.amount, 40000);
  assert.equal(cheolsuSale.recordState, 'ACTIVE');

  const yeonghuiSale = res.data.sales[1];
  assert.equal(yeonghuiSale.quantity, 1);
  assert.equal(yeonghuiSale.unitPrice, 20000);
  assert.equal(yeonghuiSale.amount, 20000);
  assert.equal(yeonghuiSale.recordState, 'ACTIVE');

  // Summary: Previous P100 (2 qty, 40k) + P101 (3 qty, 60k) = 5 qty, 100,000 KRW
  assert.equal(res.data.summary.sessionQuantity, 5);
  assert.equal(res.data.summary.sessionAmount, 100000);

  // BuyerStats: Cheolsu prior 5 count, 120k. New sale row added -> count 6, amount 160,000
  assert.equal(res.data.buyerStats['66666666-6666-4666-8666-666666666666'].sessionQuantity, 4);
  assert.equal(res.data.buyerStats['66666666-6666-4666-8666-666666666666'].sessionAmount, 80000);
  assert.equal(res.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseCount, 6);
  assert.equal(res.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseAmount, 160000);

  // Yeonghui prior 0 count, 0 amount. New sale row added -> count 1, amount 20,000
  assert.equal(res.data.buyerStats['77777777-7777-4777-8777-777777777777'].totalPurchaseCount, 1);
  assert.equal(res.data.buyerStats['77777777-7777-4777-8777-777777777777'].totalPurchaseAmount, 20000);

  // Print jobs
  assert.equal(res.data.printJobs.length, 2);
  assert.equal(res.data.printJobs[0].kind, 'SALE');
  assert.equal(res.data.printJobs[0].status, 'QUEUED');
});

test('Contract Fixture Verification: Product Price Change Preview and Commit', () => {
  const file = path.join(fixturesDir, 'product_change.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const preview = data.previewProductChange;
  assert.equal(preview.request.action, 'preview-product-change');
  assert.equal(preview.request.proposedProduct.unitPrice, 25000);

  const prevRes = preview.response.data;
  assert.equal(prevRes.before.unitPrice, 20000);
  assert.equal(prevRes.before.salesAmount, 60000);
  assert.equal(prevRes.after.unitPrice, 25000);
  assert.equal(prevRes.after.salesAmount, 75000);
  assert.equal(prevRes.diffAmount, 15000);
  assert.equal(prevRes.after.sessionAmount, 115000);

  // Commit change
  const commit = data.commitProductChange;
  assert.equal(commit.request.action, 'commit-product-change');
  assert.equal(commit.response.data.product.unitPrice, 25000);
  assert.equal(commit.response.data.product.revision, 3);
  assert.equal(commit.response.data.product.salesRevision, 2);
  assert.equal(commit.response.data.summary.sessionAmount, 115000);

  // Cheolsu total amount is now 170,000, purchase count remains 6
  assert.equal(commit.response.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseCount, 6);
  assert.equal(commit.response.data.buyerStats['66666666-6666-4666-8666-666666666666'].totalPurchaseAmount, 170000);

  // Correction print jobs must be generated
  assert.equal(commit.response.data.printJobs.length, 2);
  assert.equal(commit.response.data.printJobs[0].kind, 'CORRECTION');
  assert.equal(commit.response.data.printJobs[0].status, 'QUEUED');
});

test('Contract Fixture Verification: Print Workflow & Lease Protocol', () => {
  const file = path.join(fixturesDir, 'print_workflow.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const claim = data.claimPrintJobs;
  assert.equal(claim.request.action, 'claim-print-jobs');
  assert.equal(claim.response.data.jobs[0].status, 'CLAIMED');
  assert.ok(claim.response.data.leaseToken);

  const renew = data.renewPrintLease;
  assert.equal(renew.request.action, 'renew-print-lease');
  assert.ok(renew.response.data.leaseExpiresAt);

  const begin = data.beginPrintJobSubmitting;
  assert.equal(begin.request.action, 'begin-print-job');
  assert.equal(begin.response.data.status, 'SUBMITTING');

  const ack = data.acknowledgePrintJobSubmitted;
  assert.equal(ack.request.action, 'acknowledge-print-job');
  assert.equal(ack.response.data.status, 'SUBMITTED');

  const unknown = data.unknownPrintJobStatus;
  assert.equal(unknown.data.jobs[0].status, 'UNKNOWN');
  assert.equal(unknown.data.jobs[0].requiresManualReview, true);
});

test('Contract Fixture Verification: Operations & Idempotency', () => {
  const file = path.join(fixturesDir, 'operations.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(data.notFound.ok, false);
  assert.equal(data.notFound.error.code, 'NOT_FOUND');
  assert.equal(data.notFound.error.retryable, true);

  assert.equal(data.processing.data.status, 'PROCESSING');
  assert.equal(data.succeeded.data.status, 'SUCCEEDED');
});

test('Contract Fixture Verification: Error Codes & Handling', () => {
  const file = path.join(fixturesDir, 'errors.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const expectedCodes = [
    'REVISION_CONFLICT',
    'CAPABILITY_DENIED',
    'PRODUCT_CODE_EXISTS',
    'OPERATION_PAYLOAD_MISMATCH',
    'COMMENT_ALREADY_COMMITTED',
    'PREVIEW_EXPIRED',
    'PRICE_REQUIRED'
  ];

  for (const [key, errObj] of Object.entries(data)) {
    assert.equal(errObj.ok, false);
    assert.equal(errObj.apiVersion, 1);
    assert.ok(expectedCodes.includes(errObj.error.code), `Unexpected error code: ${errObj.error.code}`);
    assert.ok(errObj.error.message.length > 0);
  }
});
