import { admin, successResponse, errorResponse, AuthContext } from '../../_shared/productSales.ts';
import type {
  PendingReasonCode,
  StructuredPendingReason,
  PendingEvidenceSnapshot,
  SaleHistoryRecord,
  BatchConfirmResult,
} from '../../../../src/types/pendingSale.ts';
import type { SaleRecord } from '../../../../src/types/live.ts';
import {
  buildPendingReasons,
  buildEvidenceSnapshot,
  evaluatePendingRules,
  validateAiResolutionForSale,
  applyResolutionToPendingReasons,
  validateSaleForBatchConfirm,
} from './pendingSalesCore.ts';
import { createAiTaskObject, processAiTask } from './aiTaskCore.ts';
import { AI_TASK_CONFIG } from './aiTaskConfig.ts';

/**
 * 1. 단건 판매 보류 해결 및 원자적 확정 (Revision 충돌 검증 포함)
 */
export async function handleResolvePendingSale(
  workspaceId: string,
  actorId: string,
  _auth: AuthContext,
  body: any
) {
  const {
    saleId,
    expectedRevision,
    resolvedBy = 'MANUAL',
    changes = {},
    resolvedReasonCodes = [],
    resolutionDetails,
    evidenceSnapshotVersion,
  } = body || {};

  if (!saleId) {
    return errorResponse('VALIDATION_ERROR', 'saleId가 필요합니다.', 400);
  }

  // 1. 현재 판매 조회
  const { data: sale, error: saleErr } = await admin
    .from('sales')
    .select('*')
    .eq('id', saleId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (saleErr || !sale) {
    return errorResponse('NOT_FOUND', `판매 내역을 찾을 수 없습니다: ${saleId}`, 404);
  }

  // 2. 판매 revision 검증 (오래된 결과 및 사용자 동시 수정 방어)
  const currentRevision = sale.revision || 1;
  if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
    return errorResponse(
      'REVISION_CONFLICT',
      `판매 버전 충돌이 발생했습니다 (현재 v${currentRevision}, 요청 v${expectedRevision}). 변경사항을 덮어쓰지 않습니다.`,
      409,
      { currentRevision, expectedRevision }
    );
  }

  let effectiveResolvedBy = resolvedBy;
  let effectiveChanges = { ...changes };
  let effectiveResolvedReasonCodes: PendingReasonCode[] = [...resolvedReasonCodes];
  let effectiveResolutionDetails = resolutionDetails;
  let verifiedAiMeta: AiVerificationMeta | null = null;

  // 2-1. AI 작업 ID가 전달된 경우 해당 작업 조회 및 revision 검증
  if (body.aiTaskId) {
    const { data: aiTask } = await admin
      .from('ai_tasks')
      .select('*')
      .eq('task_id', body.aiTaskId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!aiTask) {
      return errorResponse('NOT_FOUND', `AI 작업을 찾을 수 없습니다: ${body.aiTaskId}`, 404);
    }
    if (aiTask.sale_revision !== currentRevision) {
      return errorResponse(
        'REVISION_CONFLICT',
        `판매가 이미 수정되어 이전 AI 작업(v${aiTask.sale_revision})을 적용할 수 없습니다. (현재 판매 v${currentRevision})`,
        409,
        { currentRevision, taskRevision: aiTask.sale_revision }
      );
    }
    if (!aiTask.resolution_result) {
      return errorResponse('VALIDATION_ERROR', 'AI 작업에 해결 결과가 없습니다.', 400);
    }
    body.aiResult = aiTask.resolution_result;
    effectiveResolvedBy = 'AI';
  }

  // 2-2. AI 해결인 경우 실제 댓글/구매자/상품과 교차 검증 (환각 차단)
  if (effectiveResolvedBy === 'AI' || body.aiResult) {
    const aiResult = body.aiResult;
    if (!aiResult) {
      return errorResponse('VALIDATION_ERROR', 'AI 해결을 적용하려면 aiResult 또는 aiTaskId가 필요합니다.', 400);
    }

    const { data: comments } = await admin
      .from('comments')
      .select('id, nickname, text')
      .eq('workspace_id', workspaceId)
      .limit(50);

    const { data: buyers } = await admin
      .from('buyers')
      .select('id, display_nickname')
      .eq('workspace_id', workspaceId)
      .limit(100);

    const { data: products } = await admin
      .from('products')
      .select('id, product_code, name, unit_price')
      .eq('workspace_id', workspaceId);

    const validation = validateAiResolutionForSale(aiResult, sale, {
      sessionComments: comments || [],
      registeredBuyers: buyers || [],
      sessionProducts: products || [],
    });

    if (!validation.valid) {
      return errorResponse('AI_VALIDATION_FAILED', validation.reason || 'AI 결과 검증 실패', 422, {
        validation,
      });
    }

    if (validation.changes) {
      effectiveChanges = { ...effectiveChanges, ...validation.changes };
    }
    if (validation.resolvedReasonCodes) {
      effectiveResolvedReasonCodes = Array.from(
        new Set([...effectiveResolvedReasonCodes, ...validation.resolvedReasonCodes])
      );
    }
    effectiveResolvedBy = 'AI';
    effectiveResolutionDetails = effectiveResolutionDetails || aiResult.evidenceSummary || 'AI 분석 및 서버 교차 검증 통과';

    verifiedAiMeta = {
      verified: true,
      adapterType: aiResult.execution?.adapterType || 'CLOUD',
      verifiedAt: new Date().toISOString(),
      evidenceIds: aiResult.evidenceIds || [],
      evidenceSummary: aiResult.evidenceSummary || '서버 교차 검증 완료',
      checksPassed: validation.checksPassed || [],
    };
  }

  // 3. 보류 사유 갱신 (일부 해결 시 잔여 사유 보존)
  const existingReasons: StructuredPendingReason[] = Array.isArray(sale.pending_reasons)
    ? sale.pending_reasons
    : [];

  const { updatedReasons, allResolved } = applyResolutionToPendingReasons(
    existingReasons,
    effectiveResolvedReasonCodes,
    effectiveResolvedBy,
    effectiveResolutionDetails
  );

  // 4. 적용할 새 값 계산
  const nextNickname = effectiveChanges.buyerNickname !== undefined ? effectiveChanges.buyerNickname : sale.buyer_nickname;
  const nextAmount = effectiveChanges.amount !== undefined ? Number(effectiveChanges.amount) : sale.amount;
  const nextUnitPrice = effectiveChanges.unitPrice !== undefined ? Number(effectiveChanges.unitPrice) : (sale.unit_price || nextAmount);
  const nextQuantity = effectiveChanges.quantity !== undefined ? Number(effectiveChanges.quantity) : (sale.quantity || 1);
  const nextProductCode = effectiveChanges.productCode !== undefined ? effectiveChanges.productCode : sale.product_code_snapshot;
  const nextProductId = effectiveChanges.productId !== undefined ? effectiveChanges.productId : sale.product_id;
  const nextBuyerId = effectiveChanges.buyerId !== undefined ? effectiveChanges.buyerId : sale.buyer_id;

  // 모든 보류 사유가 해결되었고 필수값(닉네임, 금액 > 0)이 채워졌으면 자동저장/확정으로 전환
  const hasValidValues =
    Boolean(nextNickname) &&
    nextNickname !== '미확인(보류)' &&
    nextNickname !== '미확인' &&
    nextAmount > 0;

  const nextStatus = allResolved && hasValidValues ? '자동저장' : sale.status;
  const nextRevision = currentRevision + 1;

  // 5. 변경 이력(history) 기록
  const historyItem: SaleHistoryRecord = {
    revision: nextRevision,
    changedAt: new Date().toISOString(),
    changedBy: effectiveResolvedBy === 'RULE' ? 'SYSTEM' : effectiveResolvedBy === 'AI' ? 'AI' : 'SELLER',
    changeType: effectiveResolvedBy === 'RULE' ? 'RULE_RESOLVE' : effectiveResolvedBy === 'AI' ? 'AI_RESOLVE' : 'MANUAL_EDIT',
    before: {
      buyerNickname: sale.buyer_nickname,
      amount: sale.amount,
      status: sale.status,
      productCode: sale.product_code_snapshot,
      pendingReasons: existingReasons,
    },
    after: {
      buyerNickname: nextNickname,
      amount: nextAmount,
      status: nextStatus,
      productCode: nextProductCode,
      pendingReasons: updatedReasons,
    },
    summary: effectiveResolutionDetails || `${effectiveResolvedBy}에 의해 보류 사유 해결 반영`,
  };

  const existingHistory = Array.isArray(sale.history) ? sale.history : [];
  const nextHistory = [...existingHistory, historyItem];

  // 6. DB 원자적 업데이트
  const updatePayload: any = {
    buyer_nickname: nextNickname,
    buyer_id: nextBuyerId,
    amount: nextAmount,
    unit_price: nextUnitPrice,
    quantity: nextQuantity,
    product_code_snapshot: nextProductCode,
    product_id: nextProductId,
    status: nextStatus,
    revision: nextRevision,
    pending_reasons: updatedReasons,
    history: nextHistory,
    updated_at: new Date().toISOString(),
  };

  if (verifiedAiMeta) {
    updatePayload.ai_verification = verifiedAiMeta;
  }

  if (evidenceSnapshotVersion !== undefined) {
    updatePayload.evidence_snapshot = {
      ...(sale.evidence_snapshot || {}),
      snapshotVersion: evidenceSnapshotVersion,
    };
  }

  const { data: updatedSale, error: updateErr } = await admin
    .from('sales')
    .update(updatePayload)
    .eq('id', saleId)
    .select('*')
    .single();

  if (updateErr) {
    return errorResponse('DATABASE_ERROR', `판매 보류 해결 업데이트 실패: ${updateErr.message}`, 500);
  }

  // 7. 보류 해제로 인쇄 가능 상태가 된 경우 출력 작업 등록
  if (nextStatus !== '보류' && hasValidValues) {
    const { data: existingJobs } = await admin
      .from('print_jobs')
      .select('id')
      .eq('sale_id', saleId)
      .limit(1);

    // 아직 출력된 적이 없는 신규 출력 건이면 print_job 생성
    if (!existingJobs || existingJobs.length === 0) {
      await admin.from('print_jobs').insert({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        sale_id: saleId,
        sale_revision: nextRevision,
        kind: 'SALE',
        status: 'QUEUED',
        immutable_payload: {
          saleId,
          productCode: nextProductCode,
          buyerNickname: nextNickname,
          quantity: nextQuantity,
          unitPrice: nextUnitPrice,
          amount: nextAmount,
          createdAt: new Date().toISOString(),
          kind: 'SALE',
        },
      });
    }
  }

  return successResponse({
    sale: updatedSale,
    allResolved,
    remainingReasons: updatedReasons.filter((r) => !r.resolved),
  });
}

/**
 * 2. 남은 보류 건 일괄 확정 (검증 통과 건만 확정, 미확인 잔여 건은 보류 유지)
 */
export async function handleBatchConfirmPendingSales(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any
) {
  const { saleIds = [] } = body || {};

  if (!Array.isArray(saleIds) || saleIds.length === 0) {
    return errorResponse('VALIDATION_ERROR', '확정할 saleIds 배열이 필요합니다.', 400);
  }

  const { data: sales, error: fetchErr } = await admin
    .from('sales')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('id', saleIds);

  if (fetchErr) {
    return errorResponse('DATABASE_ERROR', `판매 내역 조회 실패: ${fetchErr.message}`, 500);
  }

  const confirmedSaleIds: string[] = [];
  const skippedSales: BatchConfirmResult['skippedSales'] = [];

  for (const sale of sales || []) {
    const reasons: StructuredPendingReason[] = Array.isArray(sale.pending_reasons)
      ? sale.pending_reasons
      : [];

    const validation = validateSaleForBatchConfirm({
      buyerNickname: sale.buyer_nickname,
      amount: sale.amount,
      productCode: sale.product_code_snapshot,
      productId: sale.product_id,
      productName: sale.product_name,
      pendingReasons: reasons,
    });

    if (!validation.canConfirm) {
      // 미확인 값이 남아 있으므로 보류 유지!
      skippedSales.push({
        saleId: sale.id,
        buyerNickname: sale.buyer_nickname,
        amount: sale.amount,
        remainingReasons: validation.validationErrors,
      });
      continue;
    }

    // 검증 통과 -> '확정'으로 안전 전환
    const nextRevision = (sale.revision || 1) + 1;
    const historyItem: SaleHistoryRecord = {
      revision: nextRevision,
      changedAt: new Date().toISOString(),
      changedBy: 'SELLER',
      changeType: 'BATCH_CONFIRM',
      before: {
        buyerNickname: sale.buyer_nickname,
        amount: sale.amount,
        status: sale.status,
      },
      after: {
        buyerNickname: sale.buyer_nickname,
        amount: sale.amount,
        status: '확정',
      },
      summary: '방송 후 보류 건 일괄 검증 통과 확정',
    };

    const existingHistory = Array.isArray(sale.history) ? sale.history : [];

    await admin
      .from('sales')
      .update({
        status: '확정',
        revision: nextRevision,
        history: [...existingHistory, historyItem],
        updated_at: new Date().toISOString(),
      })
      .eq('id', sale.id);

    confirmedSaleIds.push(sale.id);
  }

  const result: BatchConfirmResult = {
    totalRequested: saleIds.length,
    confirmedCount: confirmedSaleIds.length,
    confirmedSaleIds,
    skippedCount: skippedSales.length,
    skippedSales,
  };

  return successResponse({ result });
}

/**
 * 3. 보류 판매에 대한 규칙 우선 해결 및 AI 작업 생성/재분석 오케스트레이션
 * - 규칙을 먼저 적용하여 해결되면 즉시 DB 반영
 * - 미해결 건만 AI 작업 생성 (동일 근거 스냅샷 반복 호출 방지)
 */
export async function handleTriggerPendingAiResolution(
  workspaceId: string,
  actorId: string,
  auth: AuthContext,
  body: any
) {
  const { saleId, followUpUtterance, forceReanalyze = false } = body || {};

  if (!saleId) {
    return errorResponse('VALIDATION_ERROR', 'saleId가 필요합니다.', 400);
  }

  // 1. 판매 건 조회
  const { data: sale, error: saleErr } = await admin
    .from('sales')
    .select('*')
    .eq('id', saleId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (saleErr || !sale) {
    return errorResponse('NOT_FOUND', `판매 내역을 찾을 수 없습니다: ${saleId}`, 404);
  }

  if (sale.status !== '보류') {
    return successResponse({
      message: '이미 보류 상태가 아닌 판매 건입니다.',
      sale,
    });
  }

  // 2. 관련 방송 회차 및 댓글/상품 컨텍스트 조회
  const sessionId = sale.session_id;

  const { data: comments } = await admin
    .from('comments')
    .select('id, nickname, text, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: buyers } = await admin
    .from('buyers')
    .select('id, display_nickname')
    .eq('workspace_id', workspaceId)
    .limit(100);

  const { data: products } = await admin
    .from('products')
    .select('id, product_code, name, unit_price')
    .eq('workspace_id', workspaceId);

  // 현재 보류 사유가 없으면 자동 빌드
  let currentReasons: StructuredPendingReason[] = Array.isArray(sale.pending_reasons) && sale.pending_reasons.length > 0
    ? sale.pending_reasons
    : buildPendingReasons(sale, {
        comments: comments || [],
        activeProduct: products?.[0] ? { unitPrice: products[0].unit_price, productCode: products[0].product_code } : undefined,
      });

  // 3. [Step 1] 기존 규칙 우선 파이프라인 실행
  const ruleResult = evaluatePendingRules(currentReasons, {
    sale,
    comments: comments || [],
    buyers: buyers || [],
    activeProduct: products?.find((p) => p.id === sale.product_id || p.product_code === sale.product_code_snapshot),
    sessionProducts: products || [],
    followUpUtterance,
  });

  if (ruleResult.resolvedReasonCodes.length > 0) {
    // 규칙으로 일부 또는 전부 해결됨 -> 판매 데이터 원자적 반영
    return await handleResolvePendingSale(workspaceId, actorId, auth, {
      saleId,
      expectedRevision: sale.revision || 1,
      resolvedBy: 'RULE',
      changes: ruleResult.changes,
      resolvedReasonCodes: ruleResult.resolvedReasonCodes,
      resolutionDetails: '기존 비즈니스 규칙(닉네임 일치/단가 연결)에 의해 보류 해결',
    });
  }

  // 4. [Step 2] 규칙으로 해결되지 않은 경우 -> AI 작업 대기열 연동
  const currentSnapshotVersion = (sale.evidence_snapshot?.snapshotVersion || 1) + (followUpUtterance ? 1 : 0);
  const evidenceSnapshot = buildEvidenceSnapshot(sale, {
    relevantCommentIds: (comments || []).slice(0, 10).map((c) => c.id),
    snapshotVersion: currentSnapshotVersion,
  });

  // 동일 근거 스냅샷 중복 호출 검사 (멱등성 보장)
  const { data: existingTasks } = await admin
    .from('ai_tasks')
    .select('*')
    .eq('sale_id', saleId)
    .eq('evidence_snapshot_version', currentSnapshotVersion)
    .order('created_at', { ascending: false })
    .limit(1);

  const existingTask = existingTasks?.[0];
  if (existingTask && !forceReanalyze && (existingTask.status === 'PROCESSING' || existingTask.status === 'RESOLVED')) {
    return successResponse({
      message: '동일한 근거 스냅샷으로 이미 분석이 완료되었거나 진행 중입니다 (중복 호출 차단).',
      task: existingTask,
      sale,
    });
  }

  // AI 분석 요청 생성
  const aiPayload = {
    workspaceId,
    sessionId,
    saleId,
    saleRevision: sale.revision || 1,
    settingVersion: 1,
    evidenceSnapshotVersion: currentSnapshotVersion,
    taskType: 'PENDING_RESOLUTION' as const,
    currentUtterance: followUpUtterance || sale.raw_transcript,
    request: {
      workspaceId,
      sessionId,
      taskId: `pending_${saleId}_${Date.now()}`,
      taskType: 'PENDING_RESOLUTION' as const,
      currentUtterance: followUpUtterance || sale.raw_transcript,
      priorUtterances: sale.raw_transcript ? [{ text: sale.raw_transcript, timestamp: sale.recognized_at }] : [],
      relevantComments: (comments || []).slice(0, 10).map((c) => ({
        commentId: c.id,
        nickname: c.nickname,
        text: c.text,
        timestamp: c.created_at,
      })),
      activeProduct: products?.[0] ? {
        productCode: products[0].product_code,
        productName: products[0].name,
        unitPrice: products[0].unit_price,
      } : undefined,
    },
  };

  const aiTaskObj = createAiTaskObject(aiPayload);

  // DB에 AI 작업 등록
  await admin.from('ai_tasks').insert({
    task_id: aiTaskObj.taskId,
    workspace_id: aiTaskObj.workspaceId,
    session_id: aiTaskObj.sessionId,
    sale_id: aiTaskObj.saleId,
    sale_revision: aiTaskObj.saleRevision,
    setting_version: aiTaskObj.settingVersion,
    evidence_snapshot_version: aiTaskObj.evidenceSnapshotVersion,
    task_type: aiTaskObj.taskType,
    status: aiTaskObj.status,
    active_slot: aiTaskObj.activeSlot,
    current_attempt_id: aiTaskObj.currentAttemptId,
    current_utterance: aiTaskObj.currentUtterance,
    request_payload: aiTaskObj.requestPayload,
    resolution_result: aiTaskObj.resolutionResult,
    created_at: aiTaskObj.createdAt,
    updated_at: aiTaskObj.updatedAt,
  });

  return successResponse({
    message: '보류 해결을 위한 AI 분석 작업이 큐에 등록되었습니다.',
    task: aiTaskObj,
    evidenceSnapshot,
  });
}
