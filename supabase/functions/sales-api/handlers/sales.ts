import { admin, successResponse, errorResponse, sha256 } from '../../_shared/productSales.ts'
import { calculateSummary, calculateBuyerStats } from './common.ts'

export async function handleCommitSales(workspaceId: string, actorId: string, body: any) {
  const { operationId, sessionId, productId, expectedProductRevision, expectedSessionRevision, buyers: saleBuyers } = body

  if (!operationId || !sessionId || !productId || !Array.isArray(saleBuyers)) {
    return errorResponse('VALIDATION_ERROR', '필수 필드가 누락되었습니다.', 400)
  }

  const reqHash = await sha256(JSON.stringify({ sessionId, productId, buyers: saleBuyers }))
  const { data: existingOp } = await admin
    .from('operations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('operation_id', operationId)
    .maybeSingle()

  if (existingOp) {
    if (existingOp.request_hash !== reqHash) {
      return errorResponse('OPERATION_PAYLOAD_MISMATCH', '동일 operationId에 다른 내용이 전송되었습니다.', 409)
    }
    if (existingOp.status === 'SUCCEEDED' && existingOp.response_json) {
      return successResponse(existingOp.response_json)
    }
  } else {
    await admin.from('operations').insert({
      workspace_id: workspaceId,
      operation_id: operationId,
      actor_id: actorId,
      action: 'commit-sales',
      request_hash: reqHash,
      status: 'PROCESSING',
    })
  }

  const { data: session } = await admin
    .from('live_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!session) return errorResponse('NOT_FOUND', '회차를 찾을 수 없습니다.', 404)
  if (expectedSessionRevision !== undefined && session.revision !== expectedSessionRevision) {
    return errorResponse('REVISION_CONFLICT', '회차 버전 충돌이 발생했습니다.', 409)
  }

  const { data: product } = await admin
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!product) return errorResponse('NOT_FOUND', '상품을 찾을 수 없습니다.', 404)
  if (expectedProductRevision !== undefined && product.revision !== expectedProductRevision) {
    return errorResponse('REVISION_CONFLICT', '상품 버전 충돌이 발생했습니다.', 409)
  }

  const unitPrice = product.unit_price
  if (unitPrice === null || unitPrice === undefined) {
    return errorResponse('PRICE_REQUIRED', '상품 단가가 지정되지 않았습니다.', 422)
  }

  const createdSales: any[] = []
  const createdPrintJobs: any[] = []
  const buyerIds: string[] = []

  for (const b of saleBuyers) {
    const qty = Number(b.quantity || 1)
    const amount = qty * unitPrice
    const saleId = `sale-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    buyerIds.push(b.buyerId)

    const { data: buyerInfo } = await admin
      .from('buyers')
      .select('display_nickname')
      .eq('id', b.buyerId)
      .maybeSingle()
    const nickname = buyerInfo?.display_nickname || '구매자'

    if (Array.isArray(b.sourceCommentIds)) {
      for (const cId of b.sourceCommentIds) {
        const { data: consumed } = await admin
          .from('sale_comment_sources')
          .select('sale_id')
          .eq('workspace_id', workspaceId)
          .eq('product_id', productId)
          .eq('comment_id', cId)
          .maybeSingle()

        if (consumed) {
          return errorResponse('COMMENT_ALREADY_COMMITTED', '이미 해당 상품에 판매 등록된 댓글입니다.', 409, {
            commentId: cId,
            existingSaleId: consumed.sale_id,
          })
        }
      }
    }

    const { data: sale } = await admin
      .from('sales')
      .insert({
        id: saleId,
        workspace_id: workspaceId,
        session_id: sessionId,
        product_id: productId,
        buyer_id: b.buyerId,
        buyer_nickname: nickname,
        quantity: qty,
        unit_price: unitPrice,
        amount: amount,
        status: '자동저장',
        record_state: 'ACTIVE',
        product_code_snapshot: product.product_code,
        product_name_snapshot: product.name,
        product_image_path_snapshot: product.image_path,
        source: 'ANDROID_COMMENTS',
        source_comment_ids: b.sourceCommentIds || [],
        operation_id: operationId,
        recognized_at: new Date().toISOString(),
        revision: 1,
      })
      .select('*')
      .single()

    createdSales.push(sale)

    if (Array.isArray(b.sourceCommentIds)) {
      for (const cId of b.sourceCommentIds) {
        await admin.from('sale_comment_sources').insert({
          workspace_id: workspaceId,
          product_id: productId,
          comment_id: cId,
          sale_id: saleId,
        })
      }
    }

    const jobId = crypto.randomUUID()
    const { data: printJob } = await admin
      .from('print_jobs')
      .insert({
        id: jobId,
        workspace_id: workspaceId,
        sale_id: saleId,
        sale_revision: 1,
        kind: 'SALE',
        status: 'QUEUED',
        immutable_payload: {
          sessionCode: session.display_code,
          productCode: product.product_code,
          productName: product.name,
          buyerNickname: nickname,
          quantity: qty,
          unitPrice: unitPrice,
          amount: amount,
          createdAt: new Date().toISOString(),
          kind: 'SALE',
        },
      })
      .select('*')
      .single()

    createdPrintJobs.push(printJob)
  }

  await admin
    .from('products')
    .update({ sales_revision: product.sales_revision + 1, updated_at: new Date().toISOString() })
    .eq('id', productId)

  const summary = await calculateSummary(workspaceId, sessionId)
  const buyerStats = await calculateBuyerStats(workspaceId, sessionId, buyerIds)

  const resultPayload = {
    operationId,
    status: 'SUCCEEDED',
    sales: createdSales.map((s) => ({
      id: s.id,
      productId: s.product_id,
      buyerId: s.buyer_id,
      buyerNickname: s.buyer_nickname,
      quantity: s.quantity,
      unitPrice: s.unit_price,
      amount: s.amount,
      revision: s.revision,
      recordState: s.record_state,
      productCodeSnapshot: s.product_code_snapshot,
      productNameSnapshot: s.product_name_snapshot,
      productImagePathSnapshot: s.product_image_path_snapshot,
    })),
    summary,
    buyerStats,
    printJobs: createdPrintJobs.map((p) => ({
      id: p.id,
      saleId: p.sale_id,
      saleRevision: p.sale_revision,
      kind: p.kind,
      status: p.status,
    })),
  }

  await admin
    .from('operations')
    .update({ status: 'SUCCEEDED', response_json: resultPayload, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('operation_id', operationId)

  return successResponse(resultPayload)
}

export async function handleGetOperation(workspaceId: string, body: any) {
  const { operationId } = body
  const { data: op } = await admin
    .from('operations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('operation_id', operationId)
    .maybeSingle()

  if (!op) {
    return errorResponse('NOT_FOUND', '해당 operationId가 서버에 접수되지 않았습니다.', 404, { operationId }, true)
  }

  return successResponse({
    operationId: op.operation_id,
    status: op.status,
    result: op.response_json,
  })
}

export async function handleGetProductSales(workspaceId: string, body: any) {
  const { sessionId, productId } = body
  const { data: product } = await admin
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!product) return errorResponse('NOT_FOUND', '상품을 찾을 수 없습니다.', 404)

  const { data: sales } = await admin
    .from('sales')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('product_id', productId)
    .eq('record_state', 'ACTIVE')

  const buyerMap: Record<string, any> = {}
  const buyerIds = Array.from(new Set(sales?.map((s) => s.buyer_id).filter(Boolean) || []))
  if (buyerIds.length) {
    const { data: buyers } = await admin
      .from('buyers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('id', buyerIds)
    buyers?.forEach((b) => {
      buyerMap[b.id] = b
    })
  }

  return successResponse({
    product: {
      id: product.id,
      productCode: product.product_code,
      name: product.name,
      unitPrice: product.unit_price,
      imageKind: product.image_kind,
      imageUrl: product.image_path,
      revision: product.revision,
      salesRevision: product.sales_revision,
    },
    sales: sales || [],
    buyers: buyerMap,
    salesRevision: product.sales_revision,
  })
}
