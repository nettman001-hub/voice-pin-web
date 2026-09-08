import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const fixturesDir = path.resolve('contracts/product-sales/v1/fixtures')
const feedFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'feed.json'), 'utf8'))
const buyersFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'buyers.json'), 'utf8'))

test('CORE-05: feed fixture matches contract schema and pagination', () => {
  const normalFeed = feedFixture.normalFeedWithComments.data
  assert.equal(normalFeed.comments.length, 3)
  assert.equal(normalFeed.activeProduct.productCode, 'P-20260907-000123')
  assert.equal(normalFeed.sessionRevision, 8)
  assert.equal(normalFeed.summary.sessionQuantity, 2)
  assert.equal(normalFeed.summary.sessionAmount, 40000)
  assert.equal(normalFeed.hasMore, false)
  assert.equal(normalFeed.nextCursor, 'cursor-comment-feed-seq-3')

  // Check buyerStats
  const cheolsuStats = normalFeed.buyerStats['66666666-6666-4666-8666-666666666666']
  assert.ok(cheolsuStats)
  assert.equal(cheolsuStats.displayNickname, '철수')
  assert.equal(cheolsuStats.sessionQuantity, 2)
  assert.equal(cheolsuStats.sessionAmount, 40000)
})

test('CORE-05: Two comments by the same buyer coalesce into 1 buyer with default quantity 1', () => {
  const comments = [
    {
      id: 'c-1',
      platformMessageId: 'msg-1',
      buyerId: 'buyer-cheolsu',
      nicknameSnapshot: '철수',
      content: '저요',
    },
    {
      id: 'c-2',
      platformMessageId: 'msg-2',
      buyerId: 'buyer-cheolsu',
      nicknameSnapshot: '철수',
      content: '123번 저요',
    },
  ]

  // Coalesce comments by buyerId
  const buyerMap = new Map()
  for (const c of comments) {
    if (!buyerMap.has(c.buyerId)) {
      buyerMap.set(c.buyerId, {
        buyerId: c.buyerId,
        displayNickname: c.nicknameSnapshot,
        defaultQuantity: 1, // Contract requirement: default quantity is 1
        commentCount: 0,
        commentIds: [],
      })
    }
    const item = buyerMap.get(c.buyerId)
    item.commentCount += 1
    item.commentIds.push(c.id)
  }

  assert.equal(buyerMap.size, 1, 'Two comments by same buyer must coalesce into 1 candidate buyer')
  const cheolsu = buyerMap.get('buyer-cheolsu')
  assert.equal(cheolsu.defaultQuantity, 1)
  assert.equal(cheolsu.commentCount, 2)
  assert.deepEqual(cheolsu.commentIds, ['c-1', 'c-2'])
})

test('CORE-05: confirm-buyer manually creates buyer with MANUAL_CONFIRMED status', () => {
  const fixture = buyersFixture.confirmBuyerManual.response.data.buyer
  assert.equal(fixture.platform, 'MANUAL')
  assert.equal(fixture.displayNickname, '철수삼촌')
  assert.equal(fixture.identityStatus, 'MANUAL_CONFIRMED')
})

test('CORE-05: empty comments with watchedBuyersStatsUpdate returns updated stats', () => {
  const updateFeed = feedFixture.emptyCommentsWithWatchedBuyersStatsUpdate.data
  assert.equal(updateFeed.comments.length, 0)
  assert.ok(updateFeed.buyerStats['66666666-6666-4666-8666-666666666666'])
  assert.equal(updateFeed.buyerStats['66666666-6666-4666-8666-666666666666'].sessionQuantity, 4)
  assert.equal(updateFeed.summary.sessionQuantity, 5)
  assert.equal(updateFeed.summary.sessionAmount, 100000)
})
