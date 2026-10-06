import { admin, errorResponse, successResponse } from '../../_shared/productSales.ts'
import { extractSpeechPrice } from '../../../../src/services/priceEvidence.ts'
import { extractSaleFromTranscript } from '../../../../src/services/salesExtractor.ts'
import { getPurchaseRequests, matchPurchaseRequest } from '../../../../src/services/purchaseFirstSales.ts'
import { invalidVoiceSaleFields, voiceSaleValidationMessage } from '../../../../src/services/voiceSaleValidation.ts'
import { replaySalesWorkflow } from '../../../../src/services/salesWorkflowEngine.ts'
import { getWorkflowEvents } from './sellerWorkflow.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleCommitVoiceSale(workspaceId: string, actorId: string, body: any) {
  const sale = body?.sale
  const invalidFields = invalidVoiceSaleFields(body?.operationId, sale)
  if (invalidFields.length) {
    return errorResponse('VALIDATION_ERROR', voiceSaleValidationMessage(invalidFields), 400, { invalidFields })
  }
  if (sale.workflowEvidence) {
    const proof = sale.workflowEvidence;
    const {data:workspace,error:we}=await admin.from('workspaces').select('owner_id').eq('id',workspaceId).single();
    if(we) throw we;
    const {data:profile,error:pe}=await admin.from('seller_workflow_profiles').select('*').eq('id',proof.profileId).eq('seller_user_id',workspace.owner_id).maybeSingle();
    if(pe) throw pe;
    if(!profile || profile.report_version!==proof.profileVersion || !profile.shadow_verified) return errorResponse('PROFILE_UNVERIFIED','적용된 판매방식 버전을 확인할 수 없습니다.',409);
    // Retry receipts are checked before replay: later comments or product changes
    // cannot turn a successfully committed operation into a false rejection.
    const {data:receipt,error:oe}=await admin.from('operations').select('action,response_json').eq('workspace_id',workspaceId).eq('operation_id',body.operationId).maybeSingle();
    if(oe) throw oe;
    if(receipt) {
      const {data:saved,error:se}=await admin.from('sales').select('id,session_id,purchase_request_id,buyer_nickname,amount,unit_price,quantity,workflow_evidence').eq('workspace_id',workspaceId).eq('id',sale.id).maybeSingle();
      if(se) throw se;
      if(receipt.action!=='commit-workflow-sale' || receipt.response_json?.saleId!==sale.id || !saved
        || saved.session_id!==sale.sessionId || saved.purchase_request_id!==sale.purchaseRequestId
        || saved.buyer_nickname!==sale.buyerNickname || saved.amount!==sale.amount || saved.unit_price!==sale.unitPrice
        || saved.quantity!==(sale.quantity || 1) || saved.workflow_evidence?.decisionId!==proof.decisionId
        || saved.workflow_evidence?.profileId!==proof.profileId) return errorResponse('OPERATION_PAYLOAD_MISMATCH','재시도 요청이 기존 판매와 다릅니다.',409);
      return successResponse(receipt.response_json);
    }
    const events=await getWorkflowEvents(workspaceId,sale.sessionId,{profile:profile.profile,endAt:new Date(Date.parse(sale.recognizedAt)+70_000).toISOString()});
    const decision=replaySalesWorkflow({sessionId:sale.sessionId,profile:profile.profile,...events})
      .find((d)=>d.id===proof.decisionId && d.requestId===sale.purchaseRequestId);
    if(!decision || decision.status!=='CONFIRMED' || decision.amount!==sale.amount || decision.unitPrice!==sale.unitPrice
      || decision.quantity!==(sale.quantity || 1) || decision.nickname!==sale.buyerNickname) {
      return errorResponse('WORKFLOW_EVIDENCE_UNVERIFIED','방송 근거에서 동일한 판매를 검증하지 못했습니다.',409);
    }
    const canonicalEvidence={...proof,profileSnapshot:profile.profile,orderCode:decision.orderCode,offerId:decision.offerId,transcripts:events.transcripts.filter((t)=>t.id===decision.transcriptId || t.id===decision.priceTranscriptId)};
    const {data,error}=await admin.rpc('voicecap_commit_workflow_sale',{p_workspace:workspaceId,p_actor:actorId,p_operation:body.operationId,
      p_sale_id:sale.id,p_session:sale.sessionId,p_decision:decision,p_evidence:canonicalEvidence});
    if(error) throw error;
    if(!data?.ok) return errorResponse(data?.code || 'WORKFLOW_REJECTED','판매 근거 또는 재고 충돌을 확인해 주세요.',409);
    return successResponse(data);
  }
  const extracted = extractSaleFromTranscript(sale.rawTranscript)
  const evidence = extracted?.allocationTranscript ? extractSpeechPrice(extracted.allocationTranscript) : null
  if (!evidence || evidence.amount !== sale.amount || sale.unitPrice !== sale.amount
      || !extracted || extracted.intent !== 'ALLOCATION' || extracted.amount !== sale.amount) {
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
