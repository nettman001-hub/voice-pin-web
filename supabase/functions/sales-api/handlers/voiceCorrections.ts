import { admin, successResponse, errorResponse, AuthContext } from '../../_shared/productSales.ts';
import type { SaleRecord } from '../../../../src/types/live.ts';
import type { SaleHistoryRecord } from '../../../../src/types/pendingSale.ts';
import type {
  VoiceCorrectionIntent,
  PendingCorrectionRequest,
} from '../../../../src/types/voiceCorrection.ts';
import {
  parseVoiceCorrection,
  findTargetSaleForCorrection,
  linkFollowUpToPendingCorrection,
  applyCorrectionToSale,
  rollbackCorrection,
} from './voiceCorrectionsCore.ts';
import { normalizeNickname } from './pendingSalesCore.ts';

/**
 * 1. 음성 정정 발화 처리 오케스트레이터
 * - 정정 의도 우선 판별
 * - 대상 특정 시 즉시 반영
 * - 복수 후보 시 '정정 보류' 등록
 */
export async function handleProcessVoiceCorrection(
  workspaceId: string,
  actorId: string,
  _auth: AuthContext,
  body: any
) {
  const { sessionId, utterance } = body || {};

  if (!sessionId || !utterance) {
    return errorResponse('VALIDATION_ERROR', 'sessionId와 utterance가 필요합니다.', 400);
  }

  // 1-1. 정정 의도 파싱
  const intent = parseVoiceCorrection(utterance);

  // 부정 명령 및 질문은 수정 미실행
  if (intent.isNegativeCommand || intent.isQuestion) {
    return successResponse({
      isCorrection: false,
      executed: false,
      reason: intent.isNegativeCommand ? '부정 명령 감지로 수정 미실행' : '질문 형태 발화로 수정 미실행',
      intent,
    });
  }

  // 정정 취소 ("방금 수정한 거 취소")
  if (intent.isCancellation) {
    return await handleRollbackVoiceCorrection(workspaceId, actorId, _auth, {
      sessionId,
      utterance,
    });
  }

  // 미완성 발화 ("0.9가 아니고...")
  if (intent.isIncomplete) {
    return successResponse({
      isCorrection: true,
      executed: false,
      action: 'KEEP_PENDING',
      message: '정정 금액 또는 구매자 값이 완성될 때까지 초안 대기 중입니다.',
      intent,
    });
  }

  if (!intent.isCorrection) {
    return successResponse({
      isCorrection: false,
      message: '정정 의도가 감지되지 않았습니다.',
      intent,
    });
  }

  // 1-2. 해당 회차 판매 내역 조회
  const { data: dbSales, error: salesErr } = await admin
    .from('sales')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });

  if (salesErr) {
    return errorResponse('DATABASE_ERROR', `판매 내역 조회 실패: ${salesErr.message}`, 500);
  }

  // camelCase 변환
  const sales: SaleRecord[] = (dbSales || []).map((s: any) => ({
    id: s.id,
    sessionId: s.session_id,
    productCode: s.product_code_snapshot || '',
    productId: s.product_id,
    productName: s.product_name,
    buyerNickname: s.buyer_nickname || '',
    buyerId: s.buyer_id,
    unitPrice: s.unit_price,
    quantity: s.quantity || 1,
    amount: s.amount || 0,
    status: s.status,
    revision: s.revision || 1,
    history: s.history || [],
    pendingReasons: s.pending_reasons || [],
    printStatus: s.print_status || 'NOT_REQUESTED',
    rawTranscript: s.raw_transcript,
    recognizedAt: s.recognized_at,
    createdAt: s.created_at,
  }));

  // 1-3. 대상 판매 탐색
  const { targetSaleId, candidates, missingInfo } = findTargetSaleForCorrection(intent, sales);

  // 유일 일치 시 즉시 반영
  if (targetSaleId) {
    const targetSale = sales.find((s) => s.id === targetSaleId)!;
    return await handleApplyVoiceCorrection(workspaceId, actorId, _auth, {
      saleId: targetSaleId,
      intent,
      expectedRevision: targetSale.revision,
    });
  }

  // 복수 후보 존재 시 -> 정정 보류 요청(pending_corrections) 생성
  if (candidates.length > 1) {
    const pendingId = crypto.randomUUID();
    const candidateIds = candidates.map((c) => c.id);

    await admin.from('pending_corrections').insert({
      id: pendingId,
      workspace_id: workspaceId,
      session_id: sessionId,
      status: 'PENDING',
      target_sale_id: null,
      candidate_sale_ids: candidateIds,
      original_utterance: utterance,
      follow_up_utterances: [],
      parsed_correction: intent,
      missing_info: missingInfo,
      conflict_reason: '동일 조건 복수 판매 후보 존재 (상품번호 확인 필요)',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return successResponse({
      isCorrection: true,
      action: 'PENDING_CREATED',
      pendingCorrectionId: pendingId,
      candidateSales: candidates.map((c) => ({
        id: c.id,
        productCode: c.productCode,
        buyerNickname: c.buyerNickname,
        amount: c.amount,
      })),
      missingInfo,
      message: '복수 후보가 존재하여 정정 보류로 등록되었습니다. 상품번호를 말씀해 주세요.',
    });
  }

  return successResponse({
    isCorrection: true,
    action: 'INSUFFICIENT_DATA',
    missingInfo,
    message: '일치하는 기존 판매를 특정할 수 없습니다.',
  });
}

/**
 * 2. 특정 판매에 음성 정정 조건부 적용 (Revision 검증, 이력 생성, 수정 전표 큐잉)
 */
export async function handleApplyVoiceCorrection(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any
) {
  const { saleId, intent, expectedRevision, pendingCorrectionId } = body || {};

  if (!saleId || !intent) {
    return errorResponse('VALIDATION_ERROR', 'saleId와 intent가 필요합니다.', 400);
  }

  // 2-1. 판매 건 조회
  const { data: saleRow, error: fetchErr } = await admin
    .from('sales')
    .select('*')
    .eq('id', saleId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (fetchErr || !saleRow) {
    return errorResponse('NOT_FOUND', `판매 건을 찾을 수 없습니다: ${saleId}`, 404);
  }

  const currentRevision = saleRow.revision || 1;
  if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
    return errorResponse(
      'REVISION_CONFLICT',
      `판매 revision 충돌이 발생했습니다 (현재 v${currentRevision}, 요청 v${expectedRevision}). 다른 작업이 먼저 수정되었습니다.`,
      409,
      { currentRevision, expectedRevision }
    );
  }

  // 2-2. 댓글 및 등록 구매자 조회 (구매자 닉네임 검증용)
  const { data: comments } = await admin
    .from('comments')
    .select('id, nickname')
    .eq('workspace_id', workspaceId)
    .limit(50);

  const { data: buyers } = await admin
    .from('buyers')
    .select('id, display_nickname')
    .eq('workspace_id', workspaceId)
    .limit(100);

  const { data: printJobs } = await admin
    .from('print_jobs')
    .select('sale_id')
    .eq('sale_id', saleId);

  const saleRecord: SaleRecord = {
    id: saleRow.id,
    sessionId: saleRow.session_id,
    productCode: saleRow.product_code_snapshot || '',
    productId: saleRow.product_id,
    buyerNickname: saleRow.buyer_nickname || '',
    buyerId: saleRow.buyer_id,
    unitPrice: saleRow.unit_price,
    quantity: saleRow.quantity || 1,
    amount: saleRow.amount || 0,
    status: saleRow.status,
    revision: currentRevision,
    history: saleRow.history || [],
    pendingReasons: saleRow.pending_reasons || [],
    printStatus: saleRow.print_status || 'NOT_REQUESTED',
    createdAt: saleRow.created_at,
  };

  const { updatedSale, historyRecord, printJobRequired } = applyCorrectionToSale(
    saleRecord,
    intent,
    {
      expectedRevision,
      registeredBuyers: buyers || [],
      sessionComments: comments || [],
      printJobs: printJobs || [],
    }
  );

  // 2-3. DB 원자적 업데이트
  const { data: savedSale, error: updateErr } = await admin
    .from('sales')
    .update({
      buyer_nickname: updatedSale.buyerNickname,
      buyer_id: updatedSale.buyerId,
      amount: updatedSale.amount,
      unit_price: updatedSale.unitPrice,
      quantity: updatedSale.quantity,
      status: updatedSale.status,
      revision: updatedSale.revision,
      history: updatedSale.history,
      pending_reasons: updatedSale.pendingReasons,
      updated_at: new Date().toISOString(),
    })
    .eq('id', saleId)
    .select('*')
    .single();

  if (updateErr) {
    return errorResponse('DATABASE_ERROR', `판매 정정 반영 실패: ${updateErr.message}`, 500);
  }

  // 2-4. 이미 출력된 건이면 수정 전표(CORRECTION) 생성 (중복 방지)
  let createdPrintJobId: string | null = null;
  if (printJobRequired) {
    const { data: existingJob } = await admin
      .from('print_jobs')
      .select('id')
      .eq('sale_id', saleId)
      .eq('sale_revision', updatedSale.revision)
      .maybeSingle();

    if (!existingJob) {
      createdPrintJobId = crypto.randomUUID();
      await admin.from('print_jobs').insert({
        id: createdPrintJobId,
        workspace_id: workspaceId,
        sale_id: saleId,
        sale_revision: updatedSale.revision,
        kind: 'CORRECTION',
        status: 'QUEUED',
        immutable_payload: {
          saleId,
          saleRevision: updatedSale.revision,
          kind: 'CORRECTION',
          isCorrection: true,
          productCode: updatedSale.productCode,
          buyerNickname: updatedSale.buyerNickname,
          quantity: updatedSale.quantity,
          unitPrice: updatedSale.unitPrice,
          amount: updatedSale.amount,
          createdAt: new Date().toISOString(),
        },
      });
    } else {
      createdPrintJobId = existingJob.id;
    }
  }

  // 2-5. 연결된 정정 보류 요청이 있으면 상태를 APPLIED로 업데이트
  if (pendingCorrectionId) {
    await admin
      .from('pending_corrections')
      .update({
        status: 'APPLIED',
        target_sale_id: saleId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pendingCorrectionId);
  }

  return successResponse({
    sale: savedSale,
    historyRecord,
    printJobCreated: Boolean(createdPrintJobId),
    printJobId: createdPrintJobId,
    message: '음성 정정이 성공적으로 반영되었습니다.',
  });
}

/**
 * 3. 후속 발화("12번이요")를 기존 정정 보류 요청과 연결하여 특정
 */
export async function handleLinkFollowUpCorrection(
  workspaceId: string,
  actorId: string,
  auth: AuthContext,
  body: any
) {
  const { pendingCorrectionId, followUpUtterance } = body || {};

  if (!pendingCorrectionId || !followUpUtterance) {
    return errorResponse('VALIDATION_ERROR', 'pendingCorrectionId와 followUpUtterance가 필요합니다.', 400);
  }

  const { data: pending, error: fetchErr } = await admin
    .from('pending_corrections')
    .select('*')
    .eq('id', pendingCorrectionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (fetchErr || !pending) {
    return errorResponse('NOT_FOUND', `정정 보류 요청을 찾을 수 없습니다: ${pendingCorrectionId}`, 404);
  }

  if (pending.status !== 'PENDING') {
    return successResponse({
      message: `이미 ${pending.status} 처리된 정정 요청입니다.`,
      pending,
    });
  }

  // 세션 판매 목록 조회
  const { data: dbSales } = await admin
    .from('sales')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('session_id', pending.session_id);

  const sales: SaleRecord[] = (dbSales || []).map((s: any) => ({
    id: s.id,
    sessionId: s.session_id,
    productCode: s.product_code_snapshot || '',
    productId: s.product_id,
    buyerNickname: s.buyer_nickname || '',
    amount: s.amount || 0,
    unitPrice: s.unit_price,
    quantity: s.quantity || 1,
    status: s.status,
    revision: s.revision || 1,
    printStatus: s.print_status || 'NOT_REQUESTED',
    createdAt: s.created_at,
  }));

  const linkResult = linkFollowUpToPendingCorrection(
    {
      id: pending.id,
      workspaceId: pending.workspace_id,
      sessionId: pending.session_id,
      status: pending.status,
      targetSaleId: pending.target_sale_id,
      candidateSaleIds: pending.candidate_sale_ids || [],
      originalUtterance: pending.original_utterance,
      followUpUtterances: pending.follow_up_utterances || [],
      parsedCorrection: pending.parsed_correction,
      missingInfo: pending.missing_info || [],
      createdAt: pending.created_at,
      updatedAt: pending.updated_at,
    },
    followUpUtterance,
    sales
  );

  const updatedFollowUps = [
    ...(pending.follow_up_utterances || []),
    { text: followUpUtterance, timestamp: new Date().toISOString() },
  ];

  if (linkResult.resolvedSaleId) {
    // 특정 성공 -> 정정 적용
    const resolvedSale = sales.find((s) => s.id === linkResult.resolvedSaleId)!;
    return await handleApplyVoiceCorrection(workspaceId, actorId, auth, {
      saleId: linkResult.resolvedSaleId,
      intent: pending.parsed_correction,
      expectedRevision: resolvedSale.revision,
      pendingCorrectionId: pending.id,
    });
  }

  // 여전히 모호함
  await admin
    .from('pending_corrections')
    .update({
      follow_up_utterances: updatedFollowUps,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pending.id);

  return successResponse({
    stillAmbiguous: true,
    message: '후속 발화가 수신되었으나 여전히 판매 건이 특정되지 않았습니다.',
    pendingCorrectionId: pending.id,
  });
}

/**
 * 4. 음성 정정 취소 및 되돌리기 (Rollback)
 * - 판매 삭제와 엄격히 구분
 * - 결제/출고 충돌 검증
 */
export async function handleRollbackVoiceCorrection(
  workspaceId: string,
  _actorId: string,
  _auth: AuthContext,
  body: any
) {
  const { sessionId, saleId, pendingCorrectionId } = body || {};

  // 4-1. 미적용 정정 보류 요청 취소
  if (pendingCorrectionId) {
    const { data: pending } = await admin
      .from('pending_corrections')
      .select('*')
      .eq('id', pendingCorrectionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (pending && pending.status === 'PENDING') {
      await admin
        .from('pending_corrections')
        .update({
          status: 'CANCELLED',
          conflict_reason: '판매자 요청으로 정정 취소',
          updated_at: new Date().toISOString(),
        })
        .eq('id', pendingCorrectionId);

      return successResponse({
        action: 'CANCELLED',
        message: '미적용 정정 보류 요청이 취소되었습니다 (판매 데이터 불변).',
      });
    }
  }

  // 4-2. 적용된 정정 복원 (Rollback)
  let targetSaleRow: any = null;

  if (saleId) {
    const { data } = await admin
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    targetSaleRow = data;
  } else if (sessionId) {
    // 직전에 정정된 가장 최근 판매 건 탐색
    const { data: sessionSales } = await admin
      .from('sales')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false });

    targetSaleRow = (sessionSales || []).find((s: any) => {
      const history = Array.isArray(s.history) ? s.history : [];
      return history.some((h: any) => h.changeType === 'VOICE_CORRECTION');
    });
  }

  if (!targetSaleRow) {
    return errorResponse('NOT_FOUND', '복원할 수 있는 최근 음성 정정 판매 건을 찾을 수 없습니다.', 404);
  }

  const saleRecord: SaleRecord = {
    id: targetSaleRow.id,
    sessionId: targetSaleRow.session_id,
    productCode: targetSaleRow.product_code_snapshot || '',
    productId: targetSaleRow.product_id,
    buyerNickname: targetSaleRow.buyer_nickname || '',
    buyerId: targetSaleRow.buyer_id,
    unitPrice: targetSaleRow.unit_price,
    quantity: targetSaleRow.quantity || 1,
    amount: targetSaleRow.amount || 0,
    status: targetSaleRow.status,
    revision: targetSaleRow.revision || 1,
    history: targetSaleRow.history || [],
    pendingReasons: targetSaleRow.pending_reasons || [],
    printStatus: targetSaleRow.print_status || 'NOT_REQUESTED',
    createdAt: targetSaleRow.created_at,
  };

  const rollbackRes = rollbackCorrection(saleRecord);

  if (!rollbackRes.success || !rollbackRes.rolledBackSale) {
    return errorResponse(
      'CONFLICT_REQUIRING_CONFIRMATION',
      rollbackRes.conflictReason || '정정 복원 중 충돌이 발생했습니다.',
      409,
      { saleId: targetSaleRow.id, reason: rollbackRes.conflictReason }
    );
  }

  const restored = rollbackRes.rolledBackSale;

  // DB 복원 저장
  const { data: updatedDbSale, error: saveErr } = await admin
    .from('sales')
    .update({
      buyer_nickname: restored.buyerNickname,
      amount: restored.amount,
      unit_price: restored.unitPrice,
      status: restored.status,
      revision: restored.revision,
      history: restored.history,
      updated_at: new Date().toISOString(),
    })
    .eq('id', restored.id)
    .select('*')
    .single();

  if (saveErr) {
    return errorResponse('DATABASE_ERROR', `정정 복원 저장 실패: ${saveErr.message}`, 500);
  }

  return successResponse({
    action: 'RESTORED',
    sale: updatedDbSale,
    message: '음성 정정이 성공적으로 취소되고 이전 값으로 복원되었습니다.',
  });
}
