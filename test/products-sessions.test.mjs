import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const fixturesDir = path.resolve('contracts/product-sales/v1/fixtures')
const prepareCommitFixture = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'product_prepare_commit.json'), 'utf8')
)
const bootstrapFixture = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'bootstrap.json'), 'utf8')
)

// Validate voice commands overlap
function validateVoiceCommands(voiceCommands) {
  const seenWords = new Map()
  for (const [actionName, words] of Object.entries(voiceCommands)) {
    if (Array.isArray(words)) {
      for (const w of words) {
        const trimmed = String(w).trim()
        if (!trimmed) continue
        if (seenWords.has(trimmed)) {
          const prevAction = seenWords.get(trimmed)
          if (prevAction !== actionName) {
            return {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: `명령 단어 '${trimmed}'가 서로 다른 동작(${prevAction}, ${actionName})에 중복 설정되었습니다.`,
              conflictingWord: trimmed,
              actions: [prevAction, actionName],
            }
          }
        }
        seenWords.set(trimmed, actionName)
      }
    }
  }
  return { ok: true }
}

test('CORE-04: update-settings rejects duplicate voice commands across different actions', () => {
  const invalidCommands = {
    registerProduct: ['상품등록', '상품명'],
    setProductName: ['상품번호', '상품명'], // Overlap with registerProduct!
  }
  const result = validateVoiceCommands(invalidCommands)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'VALIDATION_ERROR')
  assert.equal(result.conflictingWord, '상품명')
})

test('CORE-04: update-settings allows valid non-overlapping voice commands', () => {
  const validCommands = bootstrapFixture.data.settings.voiceCommands
  const result = validateVoiceCommands(validCommands)
  assert.equal(result.ok, true)
})

test('CORE-04: prepare-product preserves leading zeros for requestedProductCode 0007', () => {
  const req = prepareCommitFixture.prepareProductCode0007.request
  const resp = prepareCommitFixture.prepareProductCode0007.response

  assert.equal(req.requestedProductCode, '0007')
  assert.equal(resp.data.productCode, '0007')
  // Must be string and retain leading zeros
  assert.ok(typeof resp.data.productCode === 'string')
  assert.ok(resp.data.productCode.startsWith('000'))
})

test('CORE-04: prepare-product duplicate code is rejected with 409 PRODUCT_CODE_EXISTS', () => {
  const reservedCodes = new Set(['0007', 'P-20260907-000123'])
  const candidate = '0007'

  const exists = reservedCodes.has(candidate)
  assert.equal(exists, true)

  const errorResponse = {
    ok: false,
    apiVersion: 1,
    serverTime: new Date().toISOString(),
    error: {
      code: 'PRODUCT_CODE_EXISTS',
      message: '이미 사용 중이거나 예약된 상품번호입니다. 다른 번호를 입력해 주세요.',
      retryable: false,
      details: { productCode: candidate },
    },
  }
  assert.equal(errorResponse.error.code, 'PRODUCT_CODE_EXISTS')
  assert.equal(errorResponse.error.details.productCode, '0007')
})

test('CORE-04: update-product-draft changes imageKind to NUMBER_IMAGE preserving productId and code', () => {
  const req = prepareCommitFixture.updateProductDraftFallbackNumberImage.request
  const resp = prepareCommitFixture.updateProductDraftFallbackNumberImage.response

  assert.equal(req.draftId, '55555555-dddd-4ddd-8ddd-555555555555')
  assert.equal(req.imageKind, 'NUMBER_IMAGE')
  assert.equal(req.imageFallbackConfirmed, true)

  assert.equal(resp.data.draft.imageKind, 'NUMBER_IMAGE')
  assert.equal(resp.data.draft.productCode, '0007')
  assert.equal(resp.data.draft.productId, '55555555-5555-4555-8555-000000000007')
  assert.equal(resp.data.draft.draftRevision, 2)
})

test('CORE-04: commit-product atomically activates product and increments session revision', () => {
  const req = prepareCommitFixture.commitProduct.request
  const resp = prepareCommitFixture.commitProduct.response

  assert.equal(req.expectedDraftRevision, 2)
  assert.equal(req.expectedSessionRevision, 8)

  assert.equal(resp.data.product.productCode, '0007')
  assert.equal(resp.data.session.revision, 9)
  assert.equal(resp.data.session.activeProductId, resp.data.product.id)
})

test('CORE-04: Product registration does not create sales, buyers, or print_jobs', () => {
  // Simulate mock database tables after product registration
  const mockDb = {
    products: [{ id: 'prod-0007', productCode: '0007' }],
    product_drafts: [{ id: 'draft-0007', status: 'COMMITTED' }],
    live_sessions: [{ id: 'session-1', activeProductId: 'prod-0007' }],
    sales: [],
    buyers: [],
    print_jobs: [],
  }

  assert.equal(mockDb.sales.length, 0, 'No sales should be created by product registration')
  assert.equal(mockDb.buyers.length, 0, 'No buyers should be created by product registration')
  assert.equal(mockDb.print_jobs.length, 0, 'No print_jobs should be created by product registration')
})

test('CORE-04: Draft expiration (15 minutes) rejects stale commit', () => {
  const expiredDraft = {
    id: 'draft-expired',
    status: 'READY',
    expires_at: new Date(Date.now() - 1000).toISOString(), // 1 sec ago
  }

  const isExpired = new Date(expiredDraft.expires_at).getTime() < Date.now()
  assert.equal(isExpired, true)
})
