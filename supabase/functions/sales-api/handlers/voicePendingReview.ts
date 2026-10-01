import { admin, successResponse, errorResponse, type AuthContext } from '../../_shared/productSales.ts';
import type { SaleRecord } from '../../../../src/types/live.ts';
import { buildVoiceReviewRequest, shouldReviewVoiceSale, validateVoiceReviewResult, voiceReviewFingerprint,
  isVoiceReviewReady, getVoiceReviewWindows, type ReviewTranscript } from '../../../../src/services/voicePendingReviewService.ts';
import { handleCreateAiTask, handleProcessAiTask } from './aiTasks.ts';
import { getOperationalAiSetting } from './aiOperationalSettings.ts';

export async function handleReviewVoicePendingSale(workspaceId: string, actorId: string, auth: AuthContext, row: any, body: any) {
  const sale: SaleRecord = {
    id: row.id, sessionId: row.session_id, buyerNickname: row.buyer_nickname, buyerId: row.buyer_id,
    amount: Number(row.amount), recognizedAt: row.recognized_at, rawTranscript: row.raw_transcript || '',
    status: row.status, source: row.source, revision: row.revision || 1, recordState: row.record_state,
    productCode: row.product_code_snapshot, quantity: row.quantity, aiVerification: row.ai_verification,
    purchaseRequestId: row.purchase_request_id, sourceCommentIds: row.source_comment_ids || [],
  };
  const when = Date.parse(sale.recognizedAt);
  if (!Number.isFinite(when)) return errorResponse('VALIDATION_ERROR', '판매 발화 시각이 유효하지 않습니다.', 400);
  const { data: rows, count, error } = await admin.from('live_comments')
    .select('id,session_id,platform_message_id,buyer_id,nickname_snapshot,content,captured_at', { count: 'exact' })
    .eq('workspace_id', workspaceId).eq('session_id', sale.sessionId)
    .gte('captured_at', new Date(when - 100_000).toISOString())
    .lte('captured_at', new Date(when + 100_000).toISOString()).order('captured_at', { ascending: false }).limit(1001);
  if (error) return errorResponse('DATABASE_ERROR', error.message, 500);
  if ((count || 0) > 1000 || (rows || []).length > 1000) {
    return errorResponse('COMMENT_WINDOW_TOO_LARGE', '댓글 후보가 많아 일부만 선택하지 않고 판매자 확인을 기다립니다.', 409);
  }
  const comments = (rows || []).map((c: any) => ({ id: c.id, sessionId: c.session_id,
    platformMessageId: c.platform_message_id, buyerId: c.buyer_id, nickname: c.nickname_snapshot,
    content: c.content, capturedAt: c.captured_at }));
  if (!shouldReviewVoiceSale(sale, comments)) return successResponse({ sale: row, skipped: true,
    message: '검토 가능한 판매 발화·구매 댓글 근거가 없어 추가 근거를 기다립니다.' });
  if (!isVoiceReviewReady(sale, comments)) return successResponse({ sale: row, skipped: true, waitingForWindow: true,
    retryAfterMs: Math.max(...getVoiceReviewWindows(sale, comments).map((window) => Date.parse(window.endAt))) - Date.now(),
    message: '구매 댓글 이후 70초의 판매자 멘트를 모으고 있습니다.' });
  const setting = await getOperationalAiSetting();
  if (setting?.enabled_pending_resolution === false) return successResponse({ sale: row, skipped: true,
    message: '관리자 설정에서 보류 AI 검토가 비활성화되어 있습니다.' });
  const followingText = String(body.followingUtterance || body.followUpUtterance || '').slice(0, 600);
  const { data: transcriptArchive, error: archiveError } = await admin.from('workspace_settings').select('value')
    .eq('workspace_id', workspaceId).eq('namespace', `session_transcripts_${sale.sessionId}`).maybeSingle();
  if (archiveError) return errorResponse('DATABASE_ERROR', archiveError.message, 500);
  const archive = transcriptArchive?.value;
  const logs: ReviewTranscript[] = archive?.workspaceId === workspaceId && archive?.sessionId === sale.sessionId
    && Array.isArray(archive.logs) ? archive.logs : [];
  const fingerprint = voiceReviewFingerprint(sale, comments, followingText, logs);
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
    const request = { ...buildVoiceReviewRequest(sale, comments, followingText, logs), workspaceId };
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
  const meta = validateVoiceReviewResult(sale, comments, task?.resolutionResult || null,
    task?.activeSlot || 1, task?.taskId || '', fingerprint, followingText, logs);
  if (processingError) meta.errorMessage = processingError;
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
  const rejected = meta.reviewDecision === 'NOT_SALE';
  const nextSale = { ...sale };
  if (!rejected && meta.candidateAmount && meta.saleConfirmed) {
    nextSale.amount = meta.candidateAmount;
    nextSale.unitPrice = meta.candidateAmount;
  }
  if (!rejected && meta.nicknameVerified && meta.candidateBuyer) {
    nextSale.buyerNickname = meta.candidateBuyer.nickname;
    nextSale.buyerId = meta.candidateBuyer.buyerId || undefined;
    nextSale.purchaseRequestId = meta.candidatePurchaseRequestId;
    nextSale.sourceCommentIds = meta.candidateCommentId ? [meta.candidateCommentId] : [];
  }
  const valuesChanged = nextSale.amount !== sale.amount || nextSale.buyerNickname !== sale.buyerNickname
    || nextSale.buyerId !== sale.buyerId || nextSale.purchaseRequestId !== sale.purchaseRequestId;
  nextSale.revision = sale.revision! + (valuesChanged ? 1 : 0);
  meta.reviewFingerprint = voiceReviewFingerprint(nextSale, comments, followingText, logs);
  const history = { revision: nextSale.revision, changedAt: new Date().toISOString(), changedBy: 'AI', changeType: 'AI_RESOLVE',
    before: { status: sale.status, buyerNickname: sale.buyerNickname, amount: sale.amount },
    after: { status: rejected ? '취소' : sale.status, buyerNickname: nextSale.buyerNickname, amount: nextSale.amount },
    summary: meta.resolutionSummary, appliedSlot: task?.activeSlot, switchReason: task?.switchReason,
    failoverAttempted: Boolean(task?.attempts?.length > 1), evidenceIds: task?.resolutionResult?.evidenceIds || [],
  };
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
