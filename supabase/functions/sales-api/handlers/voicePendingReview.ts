import { prepareVoicePendingReview, evaluateVoicePendingReview, applyVoicePendingReview } from '../../../../src/services/voicePendingReviewCore.ts';
import { admin, successResponse, errorResponse, type AuthContext } from '../../_shared/productSales.ts';
import type { SaleRecord } from '../../../../src/types/live.ts';
import { buildVoiceReviewRequest, shouldReviewVoiceSale, validateVoiceReviewResult, voiceReviewFingerprint,
  isVoiceReviewReady, getVoiceReviewWindows, type ReviewTranscript, buildVoiceTextReviewPrompt, shouldReviewVoiceSaleText,
  isVoiceTextReviewReady, voiceTextReviewFingerprint, validateVoiceTextReviewAnswer,
  VOICE_TEXT_REVIEW_WINDOW_MS } from '../../../../src/services/voicePendingReviewService.ts';
import { handleCreateAiTask, handleProcessAiTask } from './aiTasks.ts';
import { getOperationalAiSetting } from './aiOperationalSettings.ts';
import { getWorkflowEvents } from './sellerWorkflow.ts';
import { replaySalesWorkflow } from '../../../../src/services/salesWorkflowEngine.ts';
import { confirmedAiRecoveryBaseline, previewConfirmedAiRecovery, applyConfirmedAiRecovery } from '../../../../src/services/confirmedVoiceSaleRecovery.ts';

export async function handleReviewVoicePendingSale(workspaceId: string, actorId: string, auth: AuthContext, row: any, body: any) {
  const sale: SaleRecord = {
    id: row.id, sessionId: row.session_id, buyerNickname: row.buyer_nickname, buyerId: row.buyer_id,
    amount: Number(row.amount), recognizedAt: row.recognized_at, rawTranscript: row.raw_transcript || '',
    status: row.status, source: row.source, revision: row.revision || 1, recordState: row.record_state,
    productCode: row.product_code_snapshot, quantity: row.quantity, unitPrice: row.unit_price, history: row.history || [], aiVerification: row.ai_verification,
    purchaseRequestId: row.purchase_request_id, sourceCommentIds: row.source_comment_ids || [],
    workflowEvidence: row.workflow_evidence,
    evidenceSnapshot: row.evidence_snapshot, printStatus: row.print_status, printRevision: row.print_revision,
    printedAt: row.printed_at, printError: row.print_error,
  };
  const recovery = body.confirmedAiRecovery;
  if (recovery && (!['PREVIEW', 'APPLY'].includes(recovery) || body.expectedRevision !== sale.revision
    || !confirmedAiRecoveryBaseline(sale))) return errorResponse('RECOVERY_CONFLICT', '정정 가능한 과거 AI 확정 판매가 아니거나 판매가 변경되었습니다. 새로고침 후 확인해 주세요.', 409);
  if(sale.workflowEvidence){
    const {data:ws,error:we}=await admin.from('workspaces').select('owner_id').eq('id',workspaceId).single();
    if(we) throw we;
    const {data:profile,error:pe}=await admin.from('seller_workflow_profiles').select('*').eq('id',sale.workflowEvidence.profileId).eq('seller_user_id',ws.owner_id).maybeSingle();
    if(pe) throw pe;
    if(!profile) return errorResponse('PROFILE_UNVERIFIED','판매방식 설정을 확인할 수 없습니다.',409);
    const events=await getWorkflowEvents(workspaceId,sale.sessionId,{profile:profile.profile,endAt:new Date(Date.parse(sale.recognizedAt)+70_000).toISOString()});
    const decision=replaySalesWorkflow({sessionId:sale.sessionId,profile:profile.profile,...events}).find(d=>d.id===sale.workflowEvidence!.decisionId);
    if(!decision) return errorResponse('WORKFLOW_EVIDENCE_UNVERIFIED','검토할 원본 발화를 확인할 수 없습니다.',409);
    sale.workflowEvidence={...sale.workflowEvidence,orderCode:decision.orderCode,profileSnapshot:profile.profile};
  }
  const when = Date.parse(sale.recognizedAt);
  if (!Number.isFinite(when)) return errorResponse('VALIDATION_ERROR', '판매 발화 시각이 유효하지 않습니다.', 400);
  const { data: rows, count, error } = await admin.from('live_comments')
    .select('id,session_id,platform_message_id,buyer_id,nickname_snapshot,content,captured_at', { count: 'exact' })
    .eq('workspace_id', workspaceId).eq('session_id', sale.sessionId)
    .gte('captured_at', new Date(when - 180_000).toISOString())
    .lte('captured_at', new Date(when + 180_000).toISOString()).order('captured_at', { ascending: false }).limit(1001);
  if (error) return errorResponse('DATABASE_ERROR', error.message, 500);
  if ((count || 0) > 1000 || (rows || []).length > 1000) {
    return errorResponse('COMMENT_WINDOW_TOO_LARGE', '댓글 후보가 많아 일부만 선택하지 않고 판매자 확인을 기다립니다.', 409);
  }
  const dbComments = (rows || []).map((c: any) => ({ id: c.id, sessionId: c.session_id,
    platformMessageId: c.platform_message_id, buyerId: c.buyer_id, nickname: c.nickname_snapshot,
    content: c.content, capturedAt: c.captured_at }));

  const clientComments = (Array.isArray(body.comments) ? body.comments : []).map((c: any) => ({
    id: c.id || `client-${c.platformMessageId || Math.random().toString(36).slice(2)}`,
    sessionId: sale.sessionId,
    platformMessageId: c.platformMessageId || c.id,
    buyerId: c.buyerId,
    nickname: c.nickname || c.nicknameSnapshot || '',
    content: c.content || c.text || '',
    capturedAt: c.capturedAt || c.timestamp || new Date().toISOString(),
  }));

  const commentMap = new Map<string, any>();
  for (const c of clientComments) {
    const key = `${c.sessionId}:${c.platformMessageId || c.id}`;
    commentMap.set(key, c);
  }
  for (const c of dbComments) {
    const key = `${c.sessionId}:${c.platformMessageId || c.id}`;
    commentMap.set(key, c);
  }
  const comments = [...commentMap.values()].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));

  // A held sale without a numbered-order workflow is asked as plain text: the
  // comments and seller speech one minute either side, in the seller's prompt.
  const textReview = !sale.workflowEvidence;
  if (!recovery && (textReview ? !shouldReviewVoiceSaleText(sale, comments) : !shouldReviewVoiceSale(sale, comments))) return successResponse({ sale: row, skipped: true,
    message: '검토 가능한 판매 발화·구매 댓글 근거가 없어 추가 근거를 기다립니다.' });
  if (!recovery && textReview && !isVoiceTextReviewReady(sale) && !body.forceReanalyze) return successResponse({ sale: row, skipped: true, waitingForWindow: true,
    retryAfterMs: Date.parse(sale.recognizedAt) + VOICE_TEXT_REVIEW_WINDOW_MS - Date.now(),
    message: '보류 판매 뒤 1분의 댓글과 판매자 멘트를 모으고 있습니다.' });
  if (!textReview && !isVoiceReviewReady(sale, comments) && !body.forceReanalyze) return successResponse({ sale: row, skipped: true, waitingForWindow: true,
    retryAfterMs: Math.max(...getVoiceReviewWindows(sale, comments).map((window) => Date.parse(window.endAt))) - Date.now(),
    message: '구매 댓글 이후 70초의 판매자 멘트를 모으고 있습니다.' });
  const setting = recovery ? null : await getOperationalAiSetting();
  if (setting?.enabled_pending_resolution === false) return successResponse({ sale: row, skipped: true,
    message: '관리자 설정에서 보류 AI 검토가 비활성화되어 있습니다.' });
  const followingText = String(body.followingUtterance || body.followUpUtterance || '').slice(0, 600);
  const { data: transcriptArchive, error: archiveError } = await admin.from('workspace_settings').select('value')
    .eq('workspace_id', workspaceId).eq('namespace', `session_transcripts_${sale.sessionId}`).maybeSingle();
  if (archiveError) return errorResponse('DATABASE_ERROR', archiveError.message, 500);
  const archive = transcriptArchive?.value;
  const dbLogs: ReviewTranscript[] = archive?.workspaceId === workspaceId && archive?.sessionId === sale.sessionId
    && Array.isArray(archive.logs) ? archive.logs : [];
  const clientLogs: ReviewTranscript[] = (Array.isArray(body.transcripts) ? body.transcripts : []).map((t: any) => ({
    id: t.id || `client-log-${t.timestamp || Date.now()}`,
    text: t.text || '',
    timestamp: t.timestamp || t.recognizedAt || new Date().toISOString(),
    recognizedAt: t.recognizedAt || t.timestamp || new Date().toISOString(),
    isFinal: t.isFinal !== false,
    sessionId: sale.sessionId,
    confidence: t.confidence ?? 1,
  }));
  const logMap = new Map<string, ReviewTranscript>();
  for (const l of clientLogs) logMap.set(l.id || `${l.timestamp}:${l.text}`, l);
  for (const l of dbLogs) logMap.set(l.id || `${l.timestamp}:${l.text}`, l);
  const logs = [...logMap.values()].sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));
  if (recovery) {
    // Existing confirmed sales are repaired only by an explicit two-step seller
    // request. Canonical stored comments, not submitted buyer/price values, win.
    const meta = previewConfirmedAiRecovery(sale, dbComments, logs);
    if (meta.candidatePurchaseRequestId) {
      const { data: duplicate, error: duplicateError } = await admin.from('sales').select('id')
        .eq('workspace_id', workspaceId).eq('purchase_request_id', meta.candidatePurchaseRequestId)
        .eq('source', 'WEB_VOICE').neq('id', sale.id).maybeSingle();
      if (duplicateError) return errorResponse('DATABASE_ERROR', duplicateError.message, 500);
      if (duplicate) return errorResponse('REQUEST_ALREADY_ALLOCATED', '원본 구매 댓글에 연결된 다른 판매가 있어 정정하지 않았습니다.', 409);
    }
    const next = recovery === 'APPLY'
      ? applyConfirmedAiRecovery(sale, meta, String(body.expectedRecoveryFingerprint || '')) : { ...sale, aiVerification: meta };
    if (!next) return errorResponse('RECOVERY_CONFLICT', '재검토한 정정 후보와 현재 근거가 다릅니다. 원본 근거를 다시 검토해 주세요.', 409);
    const update: any = { ai_verification: next.aiVerification, updated_at: new Date().toISOString() };
    if (recovery === 'APPLY') Object.assign(update, { buyer_nickname: next.buyerNickname, buyer_id: next.buyerId || null,
      amount: next.amount, unit_price: next.unitPrice, purchase_request_id: next.purchaseRequestId,
      source_comment_ids: next.sourceCommentIds, revision: next.revision, history: next.history,
      print_status: next.printStatus, print_revision: next.printRevision, printed_at: null, print_error: null });
    const { data: updated, error: updateError } = await admin.from('sales').update(update)
      .eq('id', sale.id).eq('workspace_id', workspaceId).eq('revision', sale.revision).eq('status', '확정')
      .eq('updated_at', row.updated_at).select('*').maybeSingle();
    if (updateError) return errorResponse(updateError.code === '23505' ? 'REQUEST_ALREADY_ALLOCATED' : 'DATABASE_ERROR', updateError.message, updateError.code === '23505' ? 409 : 500);
    if (!updated) return errorResponse('RECOVERY_CONFLICT', '정정 중 판매가 변경되어 이전 요청을 적용하지 않았습니다.', 409);
    return successResponse({ sale: updated, skipped: !meta.nicknameVerified, recoveryApplied: recovery === 'APPLY', message: next.aiVerification?.resolutionSummary });
  }
  const { fingerprint, request } = prepareVoicePendingReview(sale, comments, logs, followingText, workspaceId);
  const previous = sale.aiVerification;
  if ((previous?.reviewFingerprint === fingerprint && previous.aiStatus !== 'CHECKING' && !previous.errorMessage && !body.forceReanalyze)
    || (previous?.aiStatus === 'CHECKING' && Date.now() - Date.parse(previous.validatedAt || '') < 60_000)) {
    return successResponse({ sale: row, skipped: true, message: '같은 근거의 AI 검토가 이미 완료되었거나 진행 중입니다.' });
  }
  const claimAt = new Date().toISOString();
  // Compare-and-swap prevents two tabs and late results from owning the same sale.
  const { data: claimed, error: claimError } = await admin.from('sales').update({
    ai_verification: { aiStatus: 'CHECKING', reviewFingerprint: fingerprint, validatedAt: claimAt }, updated_at: claimAt,
  }).eq('id', sale.id).eq('workspace_id', workspaceId).eq('revision', sale.revision)
    .eq('status', '보류').eq('updated_at', row.updated_at).select('id').maybeSingle();
  if (claimError) return errorResponse('DATABASE_ERROR', claimError.message, 500);
  if (!claimed) return successResponse({ skipped: true, message: '판매가 변경되어 이전 검토 요청을 적용하지 않습니다.' });

  let task: any = null;
  let processingError: string | undefined;
  try {
    const creation = await (await handleCreateAiTask(workspaceId, actorId, auth, {
      saleId: sale.id, sessionId: sale.sessionId, saleRevision: sale.revision,
      settingVersion: setting?.applied_version || 1,
      taskType: 'PENDING_RESOLUTION', currentUtterance: sale.rawTranscript, request,
    })).json();
    if (!creation.ok || !creation.data?.task) throw new Error(creation.error?.message || 'AI 작업 등록 실패');
    task = creation.data.task;
    const processing = await (await handleProcessAiTask(workspaceId, actorId, auth, { taskId: task.taskId })).json();
    if (!processing.ok || !processing.data?.task) throw new Error(processing.error?.message || 'AI 검토 실행 실패');
    task = processing.data.task;
    if (task.status === 'FAILED') processingError = task.failureReason;
  } catch (err: any) {
    processingError = err.message || 'AI 검토 실행 실패';
  }
  const meta = evaluateVoicePendingReview(sale, comments, logs, followingText, task, fingerprint, processingError);
  // Ordinary chat sent by the browser is not stored; link only stored comments.
  if (textReview && meta.candidateCommentId && !dbComments.some((c: any) => c.id === meta.candidateCommentId)) {
    meta.candidateCommentId = undefined;
  }
  if (meta.nicknameVerified && meta.candidatePurchaseRequestId) {
    const { data: duplicate, error: duplicateError } = await admin.from('sales').select('id')
      .eq('workspace_id', workspaceId).eq('purchase_request_id', meta.candidatePurchaseRequestId)
      .eq('source', 'WEB_VOICE').neq('id', sale.id).maybeSingle();
    if (duplicateError) meta.errorMessage = duplicateError.message;
    if (duplicate || duplicateError) {
      meta.nicknameVerified = false;
      meta.candidateBuyer = undefined;
      meta.candidatePurchaseRequestId = undefined;
      meta.candidateCommentId = undefined;
      meta.resolutionSummary = '이 구매 댓글에 연결된 다른 판매가 있습니다. 중복 여부를 판매자가 확인해 주세요.';
    }
  }
  const nextSale = applyVoicePendingReview(sale, comments, logs, followingText, meta, task);
  const rejected = nextSale.status === '취소';
  const valuesChanged = nextSale.revision !== sale.revision;
  const history = nextSale.history![nextSale.history!.length - 1];
  const update: any = { ai_verification: meta, history: [...(row.history || []), history], updated_at: new Date().toISOString() };
  if (valuesChanged) Object.assign(update, { revision: nextSale.revision, buyer_nickname: nextSale.buyerNickname,
    buyer_id: nextSale.buyerId || null, purchase_request_id: nextSale.purchaseRequestId || null,
    source_comment_ids: nextSale.sourceCommentIds || [], amount: nextSale.amount, unit_price: nextSale.unitPrice || nextSale.amount });
  if (rejected) Object.assign(update, { status: '취소', record_state: 'CANCELLED', print_status: 'NOT_REQUESTED' });
  const { data: updated, error: updateError } = await admin.from('sales').update(update)
    .eq('id', sale.id).eq('workspace_id', workspaceId).eq('revision', sale.revision).eq('status', '보류')
    .eq('updated_at', claimAt).select('*').maybeSingle();
  if (updateError) return errorResponse('DATABASE_ERROR', updateError.message, 500);
  return successResponse({ sale: updated, task, skipped: !updated,
    message: updated ? 'AI 검토 결과를 반영했습니다.' : '검토 중 판매가 변경되어 늦은 결과를 폐기했습니다.' });
}
