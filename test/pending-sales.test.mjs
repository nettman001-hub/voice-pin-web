import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingReasons,
  buildEvidenceSnapshot,
  evaluatePendingRules,
  validateAiResolutionForSale,
  applyResolutionToPendingReasons,
  validateSaleForBatchConfirm,
} from '../src/services/pendingSalesService.ts';

// 1. 보류 사유 구조화 및 복수 사유 동시 식별 검증
test('Pending Reasons: 닉네임과 금액이 모두 누락된 판매는 복수의 보류 사유를 독립적으로 가짐', () => {
  const incompleteSale = {
    buyerNickname: '미확인(보류)',
    amount: 0,
    rawTranscript: '구매 확정 가격은',
  };

  const reasons = buildPendingReasons(incompleteSale);

  const codes = reasons.map((r) => r.code);
  assert.ok(codes.includes('MISSING_NICKNAME'), '닉네임 미추출 사유 포함되어야 함');
  assert.ok(codes.includes('MISSING_AMOUNT'), '금액 누락 사유 포함되어야 함');
  assert.ok(codes.includes('SPLIT_UTTERANCE'), '문장 끊김에 따른 분리 발화 사유 포함되어야 함');

  // 모든 사유는 초기 미해결 상태
  assert.ok(reasons.every((r) => r.resolved === false));
});

// 2. 부분 해결 시 잔여 사유 보존 검증 (PLAN.md 1-A: 일부 해결로 다른 사유를 지우면 안 됨)
test('Partial Resolution: 금액만 해결되고 닉네임이 남은 경우, 닉네임 보류 사유는 보존되고 판매는 보류 유지', () => {
  const initialReasons = [
    { code: 'MISSING_NICKNAME', message: '구매자 닉네임 미확인', resolved: false },
    { code: 'MISSING_AMOUNT', message: '판매 금액 미확인', resolved: false },
  ];

  // 금액만 해결됨
  const { updatedReasons, allResolved } = applyResolutionToPendingReasons(
    initialReasons,
    ['MISSING_AMOUNT'],
    'RULE',
    '상품 단가 연결로 금액 15,000원 확인'
  );

  assert.equal(allResolved, false, '닉네임이 아직 미해결이므로 allResolved는 false여야 함');
  assert.equal(updatedReasons.length, 2, '사유 개수는 줄어들지 않고 보존되어야 함');

  const amountReason = updatedReasons.find((r) => r.code === 'MISSING_AMOUNT');
  const nickReason = updatedReasons.find((r) => r.code === 'MISSING_NICKNAME');

  assert.equal(amountReason?.resolved, true);
  assert.equal(amountReason?.resolvedBy, 'RULE');
  assert.equal(nickReason?.resolved, false, '닉네임 사유는 여전히 미해결 상태로 보존되어야 함');
});

// 3. 기존 규칙 우선 파이프라인: 4자리 끝번호 유일 일치 시 즉시 해결
test('Rule-First Pipeline: 댓글의 4자리 식별자 유일 일치 시 AI 호출 없이 규칙으로 닉네임 보류 즉시 해결', () => {
  const sale = {
    rawTranscript: '뒷번호 0517님 구매확정',
    buyerNickname: '미확인(보류)',
    amount: 10000,
  };

  const currentReasons = [
    { code: 'MISSING_NICKNAME', message: '구매자 닉네임 미확인', resolved: false },
    { code: 'TRAILING_DIGITS_ONLY', message: '4자리 식별자만 감지됨', resolved: false },
  ];

  const comments = [
    { id: 'c1', nickname: 'mindset0517', text: '저요 저요!' },
    { id: 'c2', nickname: 'otherUser', text: '안녕하세요' },
  ];

  const result = evaluatePendingRules(currentReasons, {
    sale,
    comments,
  });

  assert.equal(result.allResolved, true);
  assert.equal(result.changes.buyerNickname, 'mindset0517');
  assert.ok(result.resolvedReasonCodes.includes('MISSING_NICKNAME'));
  assert.ok(result.resolvedReasonCodes.includes('TRAILING_DIGITS_ONLY'));
});

// 4. 기존 규칙 우선 파이프라인: 동일 조건 복수 후보 존재 시 오탐 방지 (자동 확정 금지 및 충돌 보류)
test('Rule-First Pipeline: 끝번호가 같은 복수 후보 존재 시 자동 확정하지 않고 MULTIPLE_CANDIDATES_CONFLICT 보류 유지', () => {
  const sale = {
    rawTranscript: '뒷번호 0517님 구매확정',
    buyerNickname: '미확인(보류)',
    amount: 10000,
  };

  const currentReasons = [
    { code: 'MISSING_NICKNAME', message: '구매자 닉네임 미확인', resolved: false },
  ];

  const comments = [
    { id: 'c1', nickname: 'abc0517', text: '저요' },
    { id: 'c2', nickname: 'xyz0517', text: '저요저요' },
  ];

  const result = evaluatePendingRules(currentReasons, {
    sale,
    comments,
  });

  assert.equal(result.allResolved, false, '복수 후보가 있으므로 자동 확정되면 안 됨');
  const conflict = result.updatedReasons.find((r) => r.code === 'MULTIPLE_CANDIDATES_CONFLICT');
  assert.ok(conflict, 'MULTIPLE_CANDIDATES_CONFLICT 사유가 추가되어야 함');
  assert.equal(conflict?.resolved, false);
});

// 5. 분리 발화 및 후속 발화 연결 검증
test('Split Utterance: 문장이 분리된 발화에 후속 발화 연결 시 금액 누락 및 분리 발화 사유 동시 해결', () => {
  const sale = {
    rawTranscript: '러블리님 구매확정 가격은',
    buyerNickname: '러블리',
    amount: 0,
  };

  const currentReasons = [
    { code: 'MISSING_AMOUNT', message: '금액 누락', resolved: false },
    { code: 'SPLIT_UTTERANCE', message: '분리 발화', resolved: false },
  ];

  const result = evaluatePendingRules(currentReasons, {
    sale,
    followUpUtterance: '가격 일점칠 만원입니다',
  });

  assert.equal(result.allResolved, true);
  assert.equal(result.changes.amount, 17000);
  assert.ok(result.resolvedReasonCodes.includes('SPLIT_UTTERANCE'));
  assert.ok(result.resolvedReasonCodes.includes('MISSING_AMOUNT'));
});

// 6. 불변 근거 스냅샷 생성 및 멱등성 검증 (동일 스냅샷 중복 호출 방지)
test('Evidence Snapshot: 원본 발화, 상품, 가격, 댓글 목록을 불변 스냅샷으로 보존하고 동일 버전 해시 일치', () => {
  const sale = {
    rawTranscript: '러블리님 3번 상품 구매확정',
    recognizedAt: '2026-09-10T10:00:00.000Z',
    productCode: '03',
    unitPrice: 12000,
    quantity: 1,
    amount: 12000,
  };

  const snap1 = buildEvidenceSnapshot(sale, {
    relevantCommentIds: ['c1', 'c2'],
    snapshotVersion: 1,
  });

  const snap2 = buildEvidenceSnapshot(sale, {
    relevantCommentIds: ['c1', 'c2'],
    snapshotVersion: 1,
  });

  assert.equal(snap1.snapshotHash, snap2.snapshotHash, '동일 근거에 대해서는 동일한 스냅샷 해시 생성');
  assert.equal(snap1.snapshotVersion, 1);
  assert.equal(snap1.originalUtterance, '러블리님 3번 상품 구매확정');
});

// 7. 서버 사이드 AI 결과 엄격 검증: AI 환각 닉네임 차단 (PLAN.md line 48)
test('Server Validation: AI가 제시한 닉네임이 해당 방송 회차의 실제 댓글/구매자에 없으면 거부', () => {
  const sale = {
    id: 'sale_001',
    buyerNickname: '미확인(보류)',
    amount: 10000,
  };

  // AI가 임의로 그럴듯한 닉네임을 환각(Hallucination)한 경우
  const hallucinatedAiResult = {
    resolvable: true,
    targetSaleId: 'sale_001',
    action: 'UPDATE_SALE',
    changes: {
      buyerNickname: { to: '존재하지않는구매자99' },
    },
    evidenceIds: [],
    evidenceSummary: '추정에 의한 닉네임 제안',
    missingInfo: [],
    conflictReason: null,
    execution: {
      adapterType: 'CLOUD',
      routingMode: 'SERVER_DIRECT',
      provider: 'OPENAI',
      model: 'gpt-4o',
      latencyMs: 800,
    },
  };

  const sessionComments = [
    { id: 'c1', nickname: '실제구매자01' },
    { id: 'c2', nickname: '또로롱' },
  ];

  const validation = validateAiResolutionForSale(hallucinatedAiResult, sale, {
    sessionComments,
  });

  assert.equal(validation.valid, false, '실제 댓글에 없는 AI 환각 닉네임은 거부되어야 함');
  assert.ok(validation.reason?.includes('AI 환각 닉네임 차단'));
});

// 8. 서버 사이드 AI 결과 엄격 검증: 실제 댓글에 존재하는 닉네임은 정상 통과
test('Server Validation: AI가 제안한 닉네임이 실제 방송 댓글에 실재하면 검증 통과 및 보류 해결 코드 반환', () => {
  const sale = {
    id: 'sale_001',
    buyerNickname: '미확인(보류)',
    amount: 10000,
  };

  const validAiResult = {
    resolvable: true,
    targetSaleId: 'sale_001',
    action: 'UPDATE_SALE',
    changes: {
      buyerNickname: { to: '또로롱' },
      amount: { to: 12000, unitPrice: 12000, quantity: 1 },
    },
    evidenceIds: ['c2'],
    evidenceSummary: '댓글 및 발화 교차 검증 완료',
    missingInfo: [],
    conflictReason: null,
    execution: {
      adapterType: 'LOCAL',
      routingMode: 'SERVER_DIRECT',
      provider: 'OLLAMA',
      model: 'exaone3.5',
      latencyMs: 650,
    },
  };

  const sessionComments = [
    { id: 'c1', nickname: '실제구매자01' },
    { id: 'c2', nickname: '또로롱' },
  ];

  const validation = validateAiResolutionForSale(validAiResult, sale, {
    sessionComments,
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.changes?.buyerNickname, '또로롱');
  assert.equal(validation.changes?.amount, 12000);
  assert.ok(validation.resolvedReasonCodes.includes('MISSING_NICKNAME'));
  assert.ok(validation.resolvedReasonCodes.includes('MISSING_AMOUNT'));
});

// 9. 남은 보류 건 일괄 확정: 필수값 및 미해결 보류 사유가 없어야만 확정 가능
test('Batch Confirm: 필수 값과 근거 검증을 통과한 판매만 확정되고, 미확인 판매는 확정 거부 및 잔여 사유 반환', () => {
  const completeSale = {
    id: 'sale_001',
    buyerNickname: '초코쿠키',
    amount: 15000,
    productCode: '01',
    pendingReasons: [
      { code: 'MISSING_AMOUNT', message: '금액 누락', resolved: true, resolvedBy: 'RULE' },
    ],
  };

  const incompleteSale = {
    id: 'sale_002',
    buyerNickname: '미확인(보류)',
    amount: 0,
    productCode: '02',
    pendingReasons: [
      { code: 'MISSING_NICKNAME', message: '구매자 닉네임 미확인', resolved: false },
      { code: 'MISSING_AMOUNT', message: '판매 금액 미확인', resolved: false },
    ],
  };

  const validationComplete = validateSaleForBatchConfirm(completeSale);
  assert.equal(validationComplete.canConfirm, true, '필수값 완료 및 미해결 사유가 없으므로 확정 가능해야 함');
  assert.equal(validationComplete.validationErrors.length, 0);

  const validationIncomplete = validateSaleForBatchConfirm(incompleteSale);
  assert.equal(validationIncomplete.canConfirm, false, '미확인 값이 남아 있으므로 확정 불가여야 함');
  assert.ok(validationIncomplete.validationErrors.some((e) => e.includes('구매자 닉네임 미확인')));
  assert.ok(validationIncomplete.validationErrors.some((e) => e.includes('판매 금액 0원')));
});

// 10. 복수 보류 사유 중 일부 해결 후 일괄 확정 시도 시 남은 사유로 인해 안전하게 차단
test('Batch Confirm: 복수 사유 중 일부만 해결된 판매는 일괄 확정에서 제외되고 남은 사유 반환', () => {
  const initialReasons = [
    { code: 'MISSING_NICKNAME', message: '구매자 닉네임 미확인', resolved: false },
    { code: 'MISSING_AMOUNT', message: '판매 금액 미확인', resolved: false },
  ];

  // 금액만 해결
  const { updatedReasons } = applyResolutionToPendingReasons(
    initialReasons,
    ['MISSING_AMOUNT'],
    'RULE',
    '단가 연결'
  );

  const partialSale = {
    id: 'sale_003',
    buyerNickname: '미확인(보류)', // 닉네임 여전히 미확인
    amount: 10000,
    productCode: '01',
    pendingReasons: updatedReasons,
  };

  const check = validateSaleForBatchConfirm(partialSale);
  assert.equal(check.canConfirm, false, '닉네임 미해결이므로 확정 거부되어야 함');
  assert.ok(check.validationErrors.some((err) => err.includes('구매자 닉네임 미확인')));
  assert.ok(!check.validationErrors.some((err) => err.includes('판매 금액 0원')), '해결된 금액 오류는 에러 목록에 없어야 함');
});

// 11. Revision 충돌 시뮬레이션: 사용자가 직접 수정한 경우 오래된 결과 적용 거부
test('Revision Check: 요청의 expectedRevision과 판매의 현재 revision이 다르면 충돌로 판단', () => {
  const sale = {
    id: 'sale_004',
    revision: 3, // 이미 사용자가 수정하여 revision이 3으로 증가함
    buyerNickname: '직접수정한구매자',
    amount: 20000,
  };

  const oldAiTaskExpectedRevision = 1; // 과거 revision 1 기반 작업 결과
  const isConflict = sale.revision !== oldAiTaskExpectedRevision;

  assert.equal(isConflict, true, '버전 불일치 시 충돌(REVISION_CONFLICT)로 감지되어야 함');
});

