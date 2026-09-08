import { admin, successResponse, errorResponse, sha256 } from '../../_shared/productSales.ts'
import { calculateSummary, calculateBuyerStats } from './common.ts'

export async function handlePrepareProduct(workspaceId: string, actorId: string, body: any) {
  const { sessionId, requestedProductCode, name, unitPrice, imageKind } = body
  const effectiveImageKind = imageKind || 'PHOTO'

  let productCode = requestedProductCode ? String(requestedProductCode).trim() : null
  if (productCode) {
    const { data: reserved } = await admin
      .from('product_code_reservations')
      .select('product_code')
      .eq('workspace_id', workspaceId)
      .eq('product_code', productCode)
      .maybeSingle()

    if (reserved) {
      return errorResponse('PRODUCT_CODE_EXISTS', '이미 사용 중이거나 예약된 상품번호입니다.', 409, {
        productCode,
      })
    }
  } else {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const rnd = Math.floor(100000 + Math.random() * 900000)
    productCode = `P-${dateStr}-${rnd}`
  }

  const draftId = crypto.randomUUID()
  const productId = crypto.randomUUID()

  await admin.from('product_code_reservations').insert({
    workspace_id: workspaceId,
    product_code: productCode,
    product_id: productId,
    draft_id: draftId,
  })

  await admin.from('product_drafts').insert({
    id: draftId,
    workspace_id: workspaceId,
    session_id: sessionId,
    product_id: productId,
    product_code: productCode,
    name: name || null,
    unit_price: unitPrice || null,
    image_kind: effectiveImageKind,
    status: 'READY',
    revision: 1,
    actor_id: actorId,
  })

  return successResponse({
    draftId,
    draftRevision: 1,
    productId,
    productCode,
    imageUpload: {
      uploadUrl: `https://storage.voicecap.local/upload/drafts/${draftId}.jpg`,
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      maxSizeBytes: 2097152,
    },
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  })
}

export async function handleUpdateProductDraft(workspaceId: string, body: any) {
  const { draftId, expectedDraftRevision, imageKind, imageFallbackConfirmed } = body
  const { data: draft } = await admin
    .from('product_drafts')
    .select('*')
    .eq('id', draftId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!draft) return errorResponse('NOT_FOUND', '초안을 찾을 수 없습니다.', 404)
  if (expectedDraftRevision !== undefined && draft.revision !== expectedDraftRevision) {
    return errorResponse('REVISION_CONFLICT', '초안 버전 충돌이 발생했습니다.', 409)
  }

  const nextRev = draft.revision + 1
  const { data: updated } = await admin
    .from('product_drafts')
    .update({
      image_kind: imageKind,
      revision: nextRev,
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftId)
    .select('*')
    .single()

  return successResponse({
    draft: {
      id: updated.id,
      draftRevision: updated.revision,
      productId: updated.product_id,
      productCode: updated.product_code,
      name: updated.name,
      unitPrice: updated.unit_price,
      imageKind: updated.image_kind,
      status: updated.status,
    },
  })
}

export async function handleCommitProduct(workspaceId: string, body: any) {
  const { draftId, expectedDraftRevision, expectedSessionRevision } = body
  const { data: draft } = await admin
    .from('product_drafts')
    .select('*')
    .eq('id', draftId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!draft) return errorResponse('NOT_FOUND', '초안을 찾을 수 없습니다.', 404)
  if (expectedDraftRevision !== undefined && draft.revision !== expectedDraftRevision) {
    return errorResponse('REVISION_CONFLICT', '초안 버전 충돌이 발생했습니다.', 409)
  }

  const { data: session } = await admin
    .from('live_sessions')
    .select('*')
    .eq('id', draft.session_id)
    .eq('workspace_id', workspaceId)
    .single()

  if (!session) return errorResponse('NOT_FOUND', '회차를 찾을 수 없습니다.', 404)
  if (expectedSessionRevision !== undefined && session.revision !== expectedSessionRevision) {
    return errorResponse('REVISION_CONFLICT', '회차 버전 충돌이 발생했습니다.', 409)
  }

  const { data: product } = await admin
    .from('products')
    .insert({
      id: draft.product_id,
      workspace_id: workspaceId,
      session_id: draft.session_id,
      product_code: draft.product_code,
      name: draft.name,
      unit_price: draft.unit_price,
      image_kind: draft.image_kind,
      image_path: draft.image_kind === 'NUMBER_IMAGE' ? `products/number_${draft.product_code}.png` : `products/${draft.product_id}.jpg`,
      revision: 1,
      sales_revision: 0,
    })
    .select('*')
    .single()

  await admin
    .from('product_drafts')
    .update({ status: 'COMMITTED', updated_at: new Date().toISOString() })
    .eq('id', draftId)

  const nextSessionRev = session.revision + 1
  await admin
    .from('live_sessions')
    .update({
      active_product_id: product.id,
      revision: nextSessionRev,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  return successResponse({
    product: {
      id: product.id,
      productCode: product.product_code,
      name: product.name,
      unitPrice: product.unit_price,
      imageKind: product.image_kind,
      imageUrl: `https://storage.voicecap.local/${product.image_path}`,
      revision: product.revision,
      salesRevision: product.sales_revision,
    },
    session: {
      id: session.id,
      activeProductId: product.id,
      revision: nextSessionRev,
    },
  })
}

export async function handleActivateProduct(workspaceId: string, body: any) {
  const { sessionId, productId, expectedSessionRevision } = body
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

  const nextRev = session.revision + 1
  await admin
    .from('live_sessions')
    .update({ active_product_id: productId, revision: nextRev, updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return successResponse({
    session: { id: session.id, activeProductId: productId, revision: nextRev },
    activeProduct: {
      id: product.id,
      productCode: product.product_code,
      name: product.name,
      unitPrice: product.unit_price,
      imageKind: product.image_kind,
      imageUrl: product.image_path,
      revision: product.revision,
      salesRevision: product.sales_revision,
    },
  })
}

export async function handleListSessionProducts(workspaceId: string, body: any) {
  const { sessionId } = body
  const { data: products } = await admin
    .from('products')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  return successResponse({
    products: (products || []).map((p) => ({
      id: p.id,
      productCode: p.product_code,
      name: p.name,
      unitPrice: p.unit_price,
      imageKind: p.image_kind,
      imageUrl: p.image_path,
      revision: p.revision,
      salesRevision: p.sales_revision,
    })),
    nextCursor: null,
  })
}

export async function handlePrepareProductImage(workspaceId: string, body: any) {
  const { productId, expectedProductRevision, fileName, mimeType, size } = body
  const imageId = `img-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  return successResponse({
    imageId,
    imageUpload: {
      uploadUrl: `https://storage.voicecap.local/upload/products/${imageId}.jpg`,
      method: 'PUT',
      headers: { 'Content-Type': mimeType || 'image/jpeg' },
      maxSizeBytes: 2097152,
    },
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  })
}

export async function handlePreviewProductChange(workspaceId: string, actorId: string, body: any) {
  const { productId, proposedProduct, proposedSales = [], expectedProductRevision, expectedSalesRevision } = body

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
  if (expectedSalesRevision !== undefined && product.sales_revision !== expectedSalesRevision) {
    return errorResponse('REVISION_CONFLICT', '판매 이력 버전 충돌이 발생했습니다.', 409)
  }

  const newUnitPrice = proposedProduct?.unitPrice !== undefined ? proposedProduct.unitPrice : product.unit_price
  const oldUnitPrice = product.unit_price

  const { data: currentSales } = await admin
    .from('sales')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('product_id', productId)
    .eq('record_state', 'ACTIVE')

  let oldSalesQty = 0
  let oldSalesAmt = 0
  currentSales?.forEach((s) => {
    oldSalesQty += Number(s.quantity || 1)
    oldSalesAmt += Number(s.amount || 0)
  })

  const affectedBuyers: any[] = []
  let newSalesQty = 0
  let newSalesAmt = 0

  for (const s of currentSales || []) {
    const prop = proposedSales.find((p: any) => p.saleId === s.id)
    const qty = prop?.quantity !== undefined ? Number(prop.quantity) : Number(s.quantity || 1)
    const isCancelled = prop?.cancelled === true

    if (!isCancelled) {
      const newAmt = qty * newUnitPrice
      newSalesQty += qty
      newSalesAmt += newAmt

      affectedBuyers.push({
        buyerId: s.buyer_id,
        displayNickname: s.buyer_nickname,
        quantity: qty,
        oldUnitPrice: oldUnitPrice,
        newUnitPrice: newUnitPrice,
        oldAmount: s.amount,
        newAmount: newAmt,
        diffAmount: newAmt - s.amount,
      })
    }
  }

  const diffAmount = newSalesAmt - oldSalesAmt
  const currentSummary = await calculateSummary(workspaceId, product.session_id)
  const token = `prevtok_${crypto.randomUUID().replace(/-/g, '')}`

  await admin.from('product_change_previews').insert({
    token_hash: await sha256(token),
    workspace_id: workspaceId,
    actor_id: actorId,
    product_id: productId,
    proposed_patch: { proposedProduct, proposedSales, newUnitPrice },
    product_revision: product.revision,
    sales_revision: product.sales_revision,
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
  })

  return successResponse({
    previewToken: token,
    expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    before: {
      unitPrice: oldUnitPrice,
      salesQuantity: oldSalesQty,
      salesAmount: oldSalesAmt,
      sessionQuantity: currentSummary.sessionQuantity,
      sessionAmount: currentSummary.sessionAmount,
    },
    after: {
      unitPrice: newUnitPrice,
      salesQuantity: newSalesQty,
      salesAmount: newSalesAmt,
      sessionQuantity: currentSummary.sessionQuantity + (newSalesQty - oldSalesQty),
      sessionAmount: currentSummary.sessionAmount + diffAmount,
    },
    diffAmount,
    affectedBuyers,
    settlements: { affectedSettlementsCount: 0, requiresManualReview: false },
  })
}

export async function handleCommitProductChange(workspaceId: string, actorId: string, body: any) {
  const { operationId, previewToken } = body
  if (!previewToken) return errorResponse('VALIDATION_ERROR', 'previewToken은 필수입니다.', 400)

  const tokenHash = await sha256(previewToken)
  const { data: preview } = await admin
    .from('product_change_previews')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!preview) return errorResponse('NOT_FOUND', '미리보기 토큰을 찾을 수 없습니다.', 404)
  if (new Date(preview.expires_at) < new Date()) {
    return errorResponse('PREVIEW_EXPIRED', '미리보기가 만료되었습니다.', 410)
  }

  const { product_id, proposed_patch } = preview
  const { data: product } = await admin
    .from('products')
    .select('*')
    .eq('id', product_id)
    .eq('workspace_id', workspaceId)
    .single()

  if (product.sales_revision !== preview.sales_revision) {
    return errorResponse('REVISION_CONFLICT', '판매 이력 버전이 변경되었습니다.', 409)
  }

  const newUnitPrice = proposed_patch.newUnitPrice
  const nextProductRev = product.revision + 1
  const nextSalesRev = product.sales_revision + 1

  const { data: updatedProduct } = await admin
    .from('products')
    .update({
      unit_price: newUnitPrice,
      revision: nextProductRev,
      sales_revision: nextSalesRev,
      updated_at: new Date().toISOString(),
    })
    .eq('id', product_id)
    .select('*')
    .single()

  const { data: currentSales } = await admin
    .from('sales')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('product_id', product_id)
    .eq('record_state', 'ACTIVE')

  const updatedSalesList: any[] = []
  const correctionJobs: any[] = []
  const buyerIds: string[] = []

  for (const s of currentSales || []) {
    const prop = proposed_patch.proposedSales?.find((p: any) => p.saleId === s.id)
    const qty = prop?.quantity !== undefined ? Number(prop.quantity) : Number(s.quantity || 1)
    const isCancelled = prop?.cancelled === true

    buyerIds.push(s.buyer_id)
    const oldRev = s.revision
    const nextRev = oldRev + 1
    const newAmt = qty * newUnitPrice

    const { data: updatedSale } = await admin
      .from('sales')
      .update({
        quantity: qty,
        unit_price: newUnitPrice,
        amount: newAmt,
        record_state: isCancelled ? 'CANCELLED' : 'ACTIVE',
        revision: nextRev,
        updated_at: new Date().toISOString(),
      })
      .eq('id', s.id)
      .select('*')
      .single()

    updatedSalesList.push(updatedSale)

    await admin.from('sale_revisions').insert({
      workspace_id: workspaceId,
      sale_id: s.id,
      old_revision: oldRev,
      new_revision: nextRev,
      before_value: { unitPrice: s.unit_price, amount: s.amount, quantity: s.quantity },
      after_value: { unitPrice: newUnitPrice, amount: newAmt, quantity: qty, recordState: isCancelled ? 'CANCELLED' : 'ACTIVE' },
      reason: '단가 일괄 수정 및 수량 변경',
      operation_id: operationId || null,
    })

    const jobId = crypto.randomUUID()
    const { data: pJob } = await admin
      .from('print_jobs')
      .insert({
        id: jobId,
        workspace_id: workspaceId,
        sale_id: s.id,
        sale_revision: nextRev,
        kind: isCancelled ? 'CANCEL' : 'CORRECTION',
        status: 'QUEUED',
        immutable_payload: {
          productCode: product.product_code,
          productName: product.name,
          buyerNickname: s.buyer_nickname,
          oldUnitPrice: s.unit_price,
          newUnitPrice: newUnitPrice,
          quantity: qty,
          amount: newAmt,
          kind: isCancelled ? 'CANCEL' : 'CORRECTION',
          createdAt: new Date().toISOString(),
        },
      })
      .select('*')
      .single()

    correctionJobs.push(pJob)
  }

  const summary = await calculateSummary(workspaceId, product.session_id)
  const buyerStats = await calculateBuyerStats(workspaceId, product.session_id, buyerIds)

  return successResponse({
    product: {
      id: updatedProduct.id,
      productCode: updatedProduct.product_code,
      name: updatedProduct.name,
      unitPrice: updatedProduct.unit_price,
      imageKind: updatedProduct.image_kind,
      imageUrl: updatedProduct.image_path,
      revision: updatedProduct.revision,
      salesRevision: updatedProduct.sales_revision,
    },
    sales: updatedSalesList,
    summary,
    buyerStats,
    printJobs: correctionJobs,
  })
}
