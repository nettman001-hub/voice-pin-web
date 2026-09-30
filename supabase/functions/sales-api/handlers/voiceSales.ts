import { admin, errorResponse, successResponse } from '../../_shared/productSales.ts'
import { extractSpeechPrice } from '../../../../src/services/priceEvidence.ts'
import { extractSaleFromTranscript } from '../../../../src/services/salesExtractor.ts'
import { getPurchaseRequests, matchPurchaseRequest } from '../../../../src/services/purchaseFirstSales.ts'
import { invalidVoiceSaleFields, voiceSaleValidationMessage } from '../../../../src/services/voiceSaleValidation.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleCommitVoiceSale(workspaceId: string, actorId: string, body: any) {
  const sale = body?.sale
  const invalidFields = invalidVoiceSaleFields(body?.operationId, sale)
  if (invalidFields.length) {
    return errorResponse('VALIDATION_ERROR', voiceSaleValidationMessage(invalidFields), 400, { invalidFields })
  }
  const evidence = extractSpeechPrice(sale.rawTranscript)
  const extracted = extractSaleFromTranscript(sale.rawTranscript)
  if (!evidence || evidence.amount !== sale.amount || sale.unitPrice !== sale.amount
      || !extracted || extracted.amount !== sale.amount
      || /(?:드릴까요|드리는\s*거\s*아니|안\s*드리|못\s*드리|입금하시면|결제하시면|아까\s*.*(?:드렸|드린)|보여드리|입어드리|설명드리)/u.test(sale.rawTranscript)
      || !/(?:드리겠습니다|드릴게요|드릴께요|챙겨드릴게요|구매\s*확정|낙찰)/u.test(sale.rawTranscript)) {
    return errorResponse('PRICE_OR_INTENT_UNVERIFIED', '판매 확정 발화와 음성 가격 근거를 확인할 수 없습니다.', 422)
  }

  const recognizedAtMs = Date.parse(String(sale.recognizedAt || ''))
  if (!Number.isFinite(recognizedAtMs)) {
    return errorResponse('VALIDATION_ERROR', '판매 발화 시각이 유효하지 않습니다.', 400)
  }
  const { data: comments, count: commentCount, error: commentsError } = await admin.from('live_comments')
    .select('id,session_id,platform_message_id,buyer_id,nickname_snapshot,content,captured_at', { count: 'exact' })
    .eq('workspace_id', workspaceId).eq('session_id', sale.sessionId)
    .gte('captured_at', new Date(recognizedAtMs - 5 * 60_000).toISOString())
    .lte('captured_at', new Date(recognizedAtMs + 10_000).toISOString())
    .limit(1001)
  if (commentsError) return errorResponse('DATABASE_ERROR', commentsError.message, 500)
  if ((commentCount || 0) > 1000) {
    return errorResponse('COMMENT_WINDOW_TOO_LARGE', '댓글 후보가 많아 자동 배정을 보류합니다.', 409)
  }
  const requestCandidates = getPurchaseRequests((comments || []).map((comment: any) => ({
    id: comment.id, sessionId: comment.session_id, platformMessageId: comment.platform_message_id,
    buyerId: comment.buyer_id, nickname: comment.nickname_snapshot, content: comment.content,
    capturedAt: comment.captured_at,
  })), sale.sessionId)
  const match = matchPurchaseRequest(extracted.buyerNickname, requestCandidates, sale.recognizedAt)
  if (match.kind !== 'MATCH' || match.request.id !== sale.purchaseRequestId) {
    return errorResponse('BUYER_AMBIGUOUS', '판매자 호칭과 실제 구매 댓글의 계정 연결을 확인할 수 없습니다.', 409)
  }

  const { data, error } = await admin.rpc('voicecap_commit_voice_sale', {
    p_workspace_id: workspaceId,
    p_actor_id: actorId,
    p_operation_id: body.operationId,
    p_sale_id: sale.id,
    p_session_id: sale.sessionId,
    p_request_id: sale.purchaseRequestId,
    p_platform_message_id: sale.purchaseRequestId.slice(`${sale.sessionId}:`.length),
    p_product_id: UUID.test(String(sale.productId || '')) ? sale.productId : null,
    p_product_code: String(sale.productCode || ''),
    p_product_name: String(sale.productName || ''),
    p_amount: sale.amount,
    p_raw_transcript: sale.rawTranscript,
    p_recognized_at: sale.recognizedAt,
    p_price_quote: evidence.quote,
  })
  if (error) return errorResponse('DATABASE_ERROR', error.message, 500)
  if (!data?.ok) {
    const code = data?.code || 'VOICE_SALE_REJECTED'
    return errorResponse(code, code === 'COMMENT_NOT_SYNCED'
      ? '구매 댓글의 서버 저장을 기다리고 있습니다.'
      : '자동 판매의 근거가 충돌하여 확인이 필요합니다.', 409)
  }
  return successResponse(data)
}
