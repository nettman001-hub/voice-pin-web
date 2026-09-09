import { admin, successResponse, errorResponse } from '../../_shared/productSales.ts'
import { calculateSummary, calculateBuyerStats } from './common.ts'

export async function handleIngestComments(workspaceId: string, actorId: string, body: any) {
  const { sessionId, collectorId, comments } = body
  if (!sessionId || !Array.isArray(comments)) {
    return errorResponse('VALIDATION_ERROR', 'sessionId와 comments 배열은 필수입니다.', 400)
  }

  const acceptedIds: string[] = []
  const duplicateIds: string[] = []

  for (const c of comments) {
    let buyerId = null
    if (c.platformUserId) {
      const { data: existingBuyer } = await admin
        .from('buyers')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('platform_user_id', c.platformUserId)
        .maybeSingle()

      if (existingBuyer) {
        buyerId = existingBuyer.id
      } else {
        const { data: newBuyer } = await admin
          .from('buyers')
          .insert({
            workspace_id: workspaceId,
            platform: 'TIKTOK',
            platform_user_id: c.platformUserId,
            platform_unique_id: c.platformUniqueId || null,
            display_nickname: c.nickname || '익명',
            identity_status: 'VERIFIED',
          })
          .select('id')
          .single()
        buyerId = newBuyer?.id || null
      }
    }

    const commentId = crypto.randomUUID()
    const { error: insertErr } = await admin.from('live_comments').insert({
      id: commentId,
      workspace_id: workspaceId,
      session_id: sessionId,
      collector_id: collectorId || actorId,
      platform_message_id: c.platformMessageId,
      buyer_id: buyerId,
      nickname_snapshot: c.nickname || '',
      content: c.content || '',
      captured_at: c.capturedAt || new Date().toISOString(),
      ingest_sequence: Number(c.ingestSequence || Date.now()),
    })

    if (insertErr) {
      duplicateIds.push(c.platformMessageId)
    } else {
      acceptedIds.push(commentId)
    }
  }

  return successResponse({
    acceptedIds,
    duplicateIds,
    nextIngestCursor: `cursor-seq-${Date.now()}`,
  })
}

export async function handleGetSalesFeed(workspaceId: string, body: any) {
  const { sessionId, watchedBuyerIds = [], limit = 50 } = body
  if (!sessionId) return errorResponse('VALIDATION_ERROR', 'sessionId는 필수입니다.', 400)

  const { data: session } = await admin
    .from('live_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single()

  let activeProduct = null
  if (session?.active_product_id) {
    const { data: prod } = await admin
      .from('products')
      .select('*')
      .eq('id', session.active_product_id)
      .maybeSingle()
    if (prod) {
      activeProduct = {
        id: prod.id,
        productCode: prod.product_code,
        name: prod.name,
        unitPrice: prod.unit_price,
        imageKind: prod.image_kind,
        imageUrl: prod.image_path,
        imagePath: prod.image_path,
        source: prod.source,
        revision: prod.revision,
        salesRevision: prod.sales_revision,
      }
    }
  }

  const { data: comments } = await admin
    .from('live_comments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('session_id', sessionId)
    .order('captured_at', { ascending: false })
    .order('ingest_sequence', { ascending: false })
    .limit(limit)

  const summary = await calculateSummary(workspaceId, sessionId)
  const buyerStats = await calculateBuyerStats(workspaceId, sessionId, watchedBuyerIds.slice(0, 100))

  return successResponse({
    comments: (comments || []).map((c) => ({
      id: c.id,
      sessionId: c.session_id,
      collectorId: c.collector_id,
      platformMessageId: c.platform_message_id,
      buyerId: c.buyer_id,
      nicknameSnapshot: c.nickname_snapshot,
      content: c.content,
      capturedAt: c.captured_at,
      ingestSequence: Number(c.ingest_sequence),
    })),
    buyerStats,
    summary,
    activeProduct,
    sessionRevision: session?.revision || 1,
    nextCursor: comments?.length ? `cursor-seq-${comments[0].ingest_sequence}` : null,
    hasMore: false,
  })
}

export async function handleSearchBuyers(workspaceId: string, body: any) {
  const { query, limit = 20 } = body
  const { data: buyers } = await admin
    .from('buyers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .ilike('display_nickname', `%${query || ''}%`)
    .limit(limit)

  return successResponse({
    buyers: (buyers || []).map((b) => ({
      id: b.id,
      platform: b.platform,
      platformUserId: b.platform_user_id || undefined,
      displayNickname: b.display_nickname,
      identityStatus: b.identity_status,
    })),
    nextCursor: null,
  })
}

export async function handleConfirmBuyer(workspaceId: string, body: any) {
  const { displayNickname, selectedBuyerId, confirmationReason } = body
  if (selectedBuyerId) {
    const { data: existing } = await admin
      .from('buyers')
      .select('*')
      .eq('id', selectedBuyerId)
      .eq('workspace_id', workspaceId)
      .single()
    if (existing) {
      return successResponse({
        buyer: {
          id: existing.id,
          platform: existing.platform,
          platformUserId: existing.platform_user_id || undefined,
          displayNickname: existing.display_nickname,
          identityStatus: existing.identity_status,
        },
      })
    }
  }

  const { data: newBuyer } = await admin
    .from('buyers')
    .insert({
      workspace_id: workspaceId,
      platform: 'MANUAL',
      display_nickname: displayNickname,
      identity_status: 'MANUAL_CONFIRMED',
    })
    .select('*')
    .single()

  return successResponse({
    buyer: {
      id: newBuyer.id,
      platform: newBuyer.platform,
      displayNickname: newBuyer.display_nickname,
      identityStatus: newBuyer.identity_status,
    },
  })
}
