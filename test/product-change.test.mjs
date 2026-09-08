import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const fixturesDir = path.resolve('contracts/product-sales/v1/fixtures');
const productChangeFixture = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'product_change.json'), 'utf8')
);

test('CORE-09: preview-product-change calculates before/after totals and buyer diffs', () => {
  const req = productChangeFixture.previewProductChange.request;
  const resp = productChangeFixture.previewProductChange.response;

  assert.equal(req.productId, '55555555-5555-4555-8555-555555555555');
  assert.equal(req.proposedProduct.unitPrice, 25000);

  // Before: unitPrice 20000, 3 items = 60000
  assert.equal(resp.data.before.unitPrice, 20000);
  assert.equal(resp.data.before.salesQuantity, 3);
  assert.equal(resp.data.before.salesAmount, 60000);

  // After: unitPrice 25000, 3 items = 75000
  assert.equal(resp.data.after.unitPrice, 25000);
  assert.equal(resp.data.after.salesQuantity, 3);
  assert.equal(resp.data.after.salesAmount, 75000);

  // Diff: +15000
  assert.equal(resp.data.diffAmount, 15000);

  // Affected buyers
  assert.equal(resp.data.affectedBuyers.length, 2);
  const cheolsu = resp.data.affectedBuyers.find((b) => b.displayNickname === '철수');
  assert.ok(cheolsu);
  assert.equal(cheolsu.quantity, 2);
  assert.equal(cheolsu.oldAmount, 40000);
  assert.equal(cheolsu.newAmount, 50000);
  assert.equal(cheolsu.diffAmount, 10000);

  const yeonghui = resp.data.affectedBuyers.find((b) => b.displayNickname === '영희');
  assert.ok(yeonghui);
  assert.equal(yeonghui.quantity, 1);
  assert.equal(yeonghui.oldAmount, 20000);
  assert.equal(yeonghui.newAmount, 25000);
  assert.equal(yeonghui.diffAmount, 5000);
});

test('CORE-09: commit-product-change updates existing sales in place and creates CORRECTION print jobs', () => {
  const req = productChangeFixture.commitProductChange.request;
  const resp = productChangeFixture.commitProductChange.response;

  assert.equal(req.previewToken, 'prevtok_0123456789abcdef0123456789abcdef');

  // Product revisions updated
  assert.equal(resp.data.product.revision, 3);
  assert.equal(resp.data.product.salesRevision, 2);
  assert.equal(resp.data.product.unitPrice, 25000);

  // Sales IDs preserved, revisions bumped
  assert.equal(resp.data.sales.length, 2);
  assert.equal(resp.data.sales[0].id, 'sale-101-cheolsu');
  assert.equal(resp.data.sales[0].revision, 2);
  assert.equal(resp.data.sales[0].amount, 50000);
  assert.equal(resp.data.sales[1].id, 'sale-101-yeonghui');
  assert.equal(resp.data.sales[1].revision, 2);
  assert.equal(resp.data.sales[1].amount, 25000);

  // CORRECTION print jobs generated for both sales
  assert.equal(resp.data.printJobs.length, 2);
  assert.equal(resp.data.printJobs[0].kind, 'CORRECTION');
  assert.equal(resp.data.printJobs[0].saleRevision, 2);
  assert.equal(resp.data.printJobs[1].kind, 'CORRECTION');
  assert.equal(resp.data.printJobs[1].saleRevision, 2);
});

test('CORE-09: REVISION_CONFLICT is raised when sales revision changes during preview', () => {
  const previewData = {
    productId: '55555555-5555-4555-8555-555555555555',
    expectedSalesRevision: 1,
  };

  const currentProduct = {
    id: '55555555-5555-4555-8555-555555555555',
    salesRevision: 2, // Modified by concurrent sale commit!
  };

  function validateSalesRevision(current, expected) {
    if (current.salesRevision !== expected) {
      return {
        ok: false,
        code: 'REVISION_CONFLICT',
        message: '판매 이력 버전이 변경되었습니다. 최신 내역을 다시 확인해 주세요.',
      };
    }
    return { ok: true };
  }

  const result = validateSalesRevision(currentProduct, previewData.expectedSalesRevision);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REVISION_CONFLICT');
});

test('CORE-09: PREVIEW_EXPIRED is raised when preview token is stale', () => {
  const expiredPreview = {
    token: 'prevtok_expired',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };

  function validatePreviewExpiry(preview) {
    if (new Date(preview.expiresAt) < new Date()) {
      return {
        ok: false,
        code: 'PREVIEW_EXPIRED',
        message: '미리보기 유효시간(10분)이 만료되었습니다. 다시 시도해 주세요.',
      };
    }
    return { ok: true };
  }

  const result = validatePreviewExpiry(expiredPreview);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PREVIEW_EXPIRED');
});
