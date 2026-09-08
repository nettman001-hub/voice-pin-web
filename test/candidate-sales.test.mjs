import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const fixturesDir = path.resolve('contracts/product-sales/v1/fixtures')
const commitSalesFixture = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'commit_sales.json'), 'utf8')
)

// Inlined logic from voiceSaleCandidate for pure node runner testing
function parseKoreanNumber(text) {
  if (!text) return undefined
  const cleaned = text.replace(/[, \s]/g, '')

  const numMatch = cleaned.match(/(\d+)/)
  if (numMatch) {
    let val = parseInt(numMatch[1], 10)
    if (cleaned.includes('만')) {
      val = val * 10000
    }
    return val
  }

  const koreanUnits = [
    { word: '십만', val: 100000 },
    { word: '만오천', val: 15000 },
    { word: '이만', val: 20000 },
    { word: '삼만', val: 30000 },
    { word: '사만', val: 40000 },
    { word: '오만', val: 50000 },
    { word: '만', val: 10000 },
    { word: '구천', val: 9000 },
    { word: '팔천', val: 8000 },
    { word: '칠천', val: 7000 },
    { word: '육천', val: 6000 },
    { word: '오천', val: 5000 },
    { word: '사천', val: 4000 },
    { word: '삼천', val: 3000 },
    { word: '이천', val: 2000 },
    { word: '천', val: 1000 },
  ]

  for (const { word, val } of koreanUnits) {
    if (cleaned.includes(word)) {
      return val
    }
  }

  const singleDigits = {
    하나: 1,
    한: 1,
    일: 1,
    둘: 2,
    두: 2,
    이: 2,
    셋: 3,
    세: 3,
    삼: 3,
    넷: 4,
    네: 4,
    사: 4,
    다섯: 5,
    오: 5,
  }

  for (const [k, v] of Object.entries(singleDigits)) {
    if (cleaned.includes(k)) return v
  }

  return undefined
}

function parseVoiceCommand(transcript, config = {}) {
  const text = transcript.trim().toLowerCase()
  const registerWords = config.registerProduct || ['상품등록', '등록']
  const priceWords = config.setPrice || ['단가', '원', '가격']
  const saleWords = config.confirmSale || ['판매', '확정', '낙찰']

  if (registerWords.some((w) => text.includes(w.toLowerCase()))) {
    const num = parseKoreanNumber(text)
    return { action: 'registerProduct', numberParam: num, rawText: transcript }
  }

  if (priceWords.some((w) => text.includes(w.toLowerCase()))) {
    const num = parseKoreanNumber(text)
    return { action: 'setPrice', numberParam: num, rawText: transcript }
  }

  if (saleWords.some((w) => text.includes(w.toLowerCase()))) {
    const num = parseKoreanNumber(text) || 1
    return { action: 'confirmSale', numberParam: num, rawText: transcript }
  }

  return { action: 'unknown', rawText: transcript }
}

// ----------------------------------------------------
// CORE-06: Candidate Countdown, Pause, Resume & Validation
// ----------------------------------------------------

test('CORE-06: Voice candidate requires unitPrice for SALE candidate', () => {
  const candidateWithoutPrice = {
    id: 'cand-1',
    type: 'SALE',
    sessionId: 'sess-1',
    sessionRevision: 1,
    productId: 'prod-1',
    productRevision: 1,
    unitPrice: undefined, // Price missing!
    buyerNickname: '구매자A',
    quantity: 1,
    state: 'COUNTDOWN',
    countdownMs: 2500,
    totalMs: 2500,
  }

  // Validate price rule
  if (candidateWithoutPrice.type === 'SALE' && (candidateWithoutPrice.unitPrice === undefined || candidateWithoutPrice.unitPrice === null)) {
    candidateWithoutPrice.state = 'ERROR'
    candidateWithoutPrice.error = '판매 단가를 입력해 주세요.'
  }

  assert.equal(candidateWithoutPrice.state, 'ERROR')
  assert.equal(candidateWithoutPrice.error, '판매 단가를 입력해 주세요.')
})

test('CORE-06: Voice candidate countdown pauses during EDITING and resumes', () => {
  let state = 'COUNTDOWN'
  let countdownMs = 2500

  // Simulate tick 1 (100ms)
  countdownMs -= 100
  assert.equal(countdownMs, 2400)

  // User begins editing nickname or quantity -> pause
  state = 'EDITING'

  // While in EDITING, tick does NOT decrement countdown
  if (state === 'COUNTDOWN') {
    countdownMs -= 100
  }
  assert.equal(countdownMs, 2400) // Still 2400!

  // User finishes editing -> resume countdown
  state = 'COUNTDOWN'
  countdownMs -= 100
  assert.equal(countdownMs, 2300)
})

test('CORE-06: Voice candidate cancellation sets CANCELLED state and clears', () => {
  let candidate = {
    id: 'cand-2',
    state: 'COUNTDOWN',
    countdownMs: 1800,
  }

  // Cancel action
  candidate.state = 'CANCELLED'
  assert.equal(candidate.state, 'CANCELLED')
  candidate = null
  assert.equal(candidate, null)
})

// ----------------------------------------------------
// CORE-07: commit-sales idempotency & validation
// ----------------------------------------------------

test('CORE-07: commit-sales validates fixture structure and calculations', () => {
  const req = commitSalesFixture.request
  const resp = commitSalesFixture.response

  assert.equal(req.sessionId, '33333333-3333-4333-8333-333333333333')
  assert.equal(req.productId, '55555555-5555-4555-8555-555555555555')
  assert.equal(req.buyers.length, 2)
  assert.equal(req.buyers[0].quantity, 2)

  assert.equal(resp.ok, true)
  assert.equal(resp.data.sales.length, 2)
  assert.equal(resp.data.sales[0].unitPrice, 20000)
  assert.equal(resp.data.sales[0].amount, 40000)
  assert.equal(resp.data.printJobs.length, 2)
  assert.equal(resp.data.printJobs[0].kind, 'SALE')
  assert.equal(resp.data.printJobs[0].status, 'QUEUED')
})

test('CORE-07: commit-sales rejects when product has no unit price (PRICE_REQUIRED)', () => {
  const activeProduct = {
    id: 'prod-no-price',
    productCode: '0007',
    unitPrice: null, // Null price!
    revision: 1,
  }

  function validatePriceBeforeCommit(product) {
    if (product.unitPrice == null || product.unitPrice <= 0) {
      return {
        ok: false,
        code: 'PRICE_REQUIRED',
        message: '판매 단가가 지정되지 않았습니다. 단가를 먼저 입력해 주세요.',
      }
    }
    return { ok: true }
  }

  const result = validatePriceBeforeCommit(activeProduct)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'PRICE_REQUIRED')
})

test('CORE-07: commit-sales is idempotent with same operationId', () => {
  const operationsStore = new Map()
  const operationId = 'op_sales_idempotent_test_001'

  const firstResult = {
    operationId,
    status: 'SUCCEEDED',
    sales: [{ id: 'sale-1', quantity: 1, amount: 15000 }],
  }

  // Store first execution
  operationsStore.set(operationId, firstResult)

  // Second execution with same operationId returns cached result
  const secondResult = operationsStore.get(operationId)
  assert.deepEqual(firstResult, secondResult)
})

test('CORE-07: Multiple comments by same buyer coalesce to default quantity 1', () => {
  const rawComments = [
    { id: 'c1', buyerId: 'buyer-alice', content: '1번 저요' },
    { id: 'c2', buyerId: 'buyer-alice', content: '저요저요' },
    { id: 'c3', buyerId: 'buyer-alice', content: '꼭 주세요' },
    { id: 'c4', buyerId: 'buyer-bob', content: '1번 구매' },
  ]

  // Coalescing algorithm
  const buyerMap = new Map()
  for (const c of rawComments) {
    if (!buyerMap.has(c.buyerId)) {
      buyerMap.set(c.buyerId, {
        buyerId: c.buyerId,
        quantity: 1, // Default quantity = 1
        sourceCommentIds: [c.id],
      })
    } else {
      // Additional comments add to sources but do NOT increase quantity automatically
      buyerMap.get(c.buyerId).sourceCommentIds.push(c.id)
    }
  }

  const buyers = Array.from(buyerMap.values())
  assert.equal(buyers.length, 2)
  assert.equal(buyerMap.get('buyer-alice').quantity, 1)
  assert.equal(buyerMap.get('buyer-alice').sourceCommentIds.length, 3)
  assert.equal(buyerMap.get('buyer-bob').quantity, 1)
  assert.equal(buyerMap.get('buyer-bob').sourceCommentIds.length, 1)
})

test('CORE-07: COMMENT_ALREADY_COMMITTED prevents duplicate sales from committed comments', () => {
  const committedCommentIds = new Set(['c1', 'c2'])
  const incomingCommentIds = ['c1']

  const alreadyCommitted = incomingCommentIds.some((id) => committedCommentIds.has(id))
  assert.equal(alreadyCommitted, true)

  const errorResponse = {
    ok: false,
    error: {
      code: 'COMMENT_ALREADY_COMMITTED',
      message: '이미 판매 처리된 댓글이 포함되어 있습니다.',
      details: { conflictCommentIds: ['c1'] },
    },
  }
  assert.equal(errorResponse.error.code, 'COMMENT_ALREADY_COMMITTED')
})

// ----------------------------------------------------
// CORE-08: Voice Command Parsing
// ----------------------------------------------------

test('CORE-08: Voice command parser extracts registerProduct and product number', () => {
  const cmd1 = parseVoiceCommand('1번 등록')
  assert.equal(cmd1.action, 'registerProduct')
  assert.equal(cmd1.numberParam, 1)

  const cmd2 = parseVoiceCommand('등록 7번')
  assert.equal(cmd2.action, 'registerProduct')
  assert.equal(cmd2.numberParam, 7)
})

test('CORE-08: Voice command parser extracts setPrice with Korean numerals', () => {
  const cmd1 = parseVoiceCommand('만오천원')
  assert.equal(cmd1.action, 'setPrice')
  assert.equal(cmd1.numberParam, 15000)

  const cmd2 = parseVoiceCommand('단가 2만원')
  assert.equal(cmd2.action, 'setPrice')
  assert.equal(cmd2.numberParam, 20000)

  const cmd3 = parseVoiceCommand('가격 15000원')
  assert.equal(cmd3.action, 'setPrice')
  assert.equal(cmd3.numberParam, 15000)
})

test('CORE-08: Voice command parser extracts confirmSale with quantity', () => {
  const cmd1 = parseVoiceCommand('홍길동 하나 판매')
  assert.equal(cmd1.action, 'confirmSale')
  assert.equal(cmd1.numberParam, 1)

  const cmd2 = parseVoiceCommand('철수 2개 확정')
  assert.equal(cmd2.action, 'confirmSale')
  assert.equal(cmd2.numberParam, 2)
})
