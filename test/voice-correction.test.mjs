import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVoiceCorrection,
  findTargetSaleForCorrection,
  linkFollowUpToPendingCorrection,
  applyCorrectionToSale,
  rollbackCorrection,
} from '../src/services/voiceCorrectionService.ts';

// 1. 가격 정정 파싱 검증
test('Voice Correction: "가격이 0.9가 아니고 1.2입니다" -> 기존 9,000원, 새 12,000원 정확 추출', () => {
  const utterance = '가격이 0.9가 아니고 1.2입니다';
  const intent = parseVoiceCorrection(utterance);

  assert.equal(intent.isCorrection, true);
  assert.equal(intent.field, 'AMOUNT');
  assert.equal(intent.negatedOldValue?.amount, 9000, '기존 0.9는 9,000원으로 해석되어야 함');
  assert.equal(intent.affirmedNewValue?.amount, 12000, '새 1.2는 12,000원으로 해석되어야 함');
  assert.equal(intent.isNegativeCommand, false);
  assert.equal(intent.isQuestion, false);
});

// 2. 구매자 정정 파싱 검증
test('Voice Correction: "좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다" -> 기존 xxx, 새 ooo 구매자 교체 추출', () => {
  const utterance = '좀전에 판매한거 xxx님이 아니시고 ooo님께 판매하겠습니다';
  const intent = parseVoiceCorrection(utterance);

  assert.equal(intent.isCorrection, true);
  assert.equal(intent.field, 'BUYER');
  assert.equal(intent.negatedOldValue?.buyerNickname, 'xxx');
  assert.equal(intent.affirmedNewValue?.buyerNickname, 'ooo');
  assert.equal(intent.targetReference?.relativeTime, 'JUST_BEFORE');
});

// 3. 부정 명령 감지 및 실행 제외 검증
test('Negative Command: "1.2로 변경하지 마세요" -> 변경 명령으로 실행하지 않음', () => {
  const utterance = '1.2로 변경하지 마세요';
  const intent = parseVoiceCorrection(utterance);

  assert.equal(intent.isNegativeCommand, true, '부정 명령 감지되어야 함');
  assert.equal(intent.isCorrection, false, '실행 가능한 정정으로 간주되지 않아야 함');
});

// 4. 질문 형태 발화 감지 및 실행 제외 검증
test('Question Form: "1.2인가요?" -> 질문 형태 발화는 수정 명령으로 실행하지 않음', () => {
  const utterance = '가격이 1.2인가요?';
  const intent = parseVoiceCorrection(utterance);

  assert.equal(intent.isQuestion, true, '질문 형태 감지되어야 함');
  assert.equal(intent.isCorrection, false, '실행 가능한 정정으로 간주되지 않아야 함');
});

// 5. 미완성/분리 발화 검증
test('Incomplete Utterance: "0.9가 아니고..." -> 미완성 발화로 감지되어 새 값 대기', () => {
  const utterance = 'xx님 가격이 0.9가 아니고...';
  const intent = parseVoiceCorrection(utterance);

  assert.equal(intent.isCorrection, true);
  assert.equal(intent.isIncomplete, true, '미완성 발화 플래그 설정되어야 함');
});

// 6. 대상 탐색: 복수 후보 존재 시 마지막 1건 임의 선택 금지 (정정 보류)
test('Target Finding: 동일 구매자/금액의 주문이 복수 개일 때 마지막 판매를 임의 수정하지 않고 보류 처리', () => {
  const utterance = 'xxx님이 아니고 ooo님입니다';
  const intent = parseVoiceCorrection(utterance);

  const existingSales = [
    {
      id: 'sale_1',
      productCode: '10',
      buyerNickname: 'xxx',
      amount: 15000,
      revision: 1,
    },
    {
      id: 'sale_2',
      productCode: '12',
      buyerNickname: 'xxx',
      amount: 15000,
      revision: 1,
    },
  ];

  const result = findTargetSaleForCorrection(intent, existingSales);

  assert.equal(result.targetSaleId, null, '복수 후보가 있으므로 targetSaleId는 null이어야 함');
  assert.equal(result.candidates.length, 2, '두 건 모두 후보로 보존되어야 함');
  assert.ok(result.missingInfo.some((m) => m.includes('상품번호')));
});

// 7. 후속 발화 연결: "12번이요" 도착 시 복수 후보 중 12번 상품 특정
test('Follow-up Linking: 보류된 정정 요청에 "12번이요" 후속 발화 연결 시 단일 판매로 특정 성공', () => {
  const pendingCorrection = {
    id: 'pc_001',
    workspaceId: 'ws_test',
    sessionId: 'session_test',
    status: 'PENDING',
    targetSaleId: null,
    candidateSaleIds: ['sale_1', 'sale_2'],
    originalUtterance: 'xxx님이 아니고 ooo님입니다',
    followUpUtterances: [],
    parsedCorrection: {
      isCorrection: true,
      field: 'BUYER',
      negatedOldValue: { buyerNickname: 'xxx' },
      affirmedNewValue: { buyerNickname: 'ooo' },
      scope: 'THIS_SALE_ONLY',
      isNegativeCommand: false,
      isQuestion: false,
      isCancellation: false,
      isIncomplete: false,
      rawUtterance: 'xxx님이 아니고 ooo님입니다',
    },
    missingInfo: ['상품번호 확인 필요'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sessionSales = [
    { id: 'sale_1', productCode: '10', buyerNickname: 'xxx', amount: 15000, revision: 1 },
    { id: 'sale_2', productCode: '12', buyerNickname: 'xxx', amount: 15000, revision: 1 },
  ];

  const linkResult = linkFollowUpToPendingCorrection(pendingCorrection, '12번이요', sessionSales);

  assert.equal(linkResult.resolvedSaleId, 'sale_2', '12번 상품인 sale_2로 정확히 특정되어야 함');
  assert.equal(linkResult.stillAmbiguous, false);
});

// 8. 검증 완료된 정정 적용: revision 증가, 단가·수량·총액 일관성, 변경 이력 기록
test('Apply Correction: 정정 적용 시 동일 판매 ID 유지, revision 증가 및 변경 이력 기록', () => {
  const originalSale = {
    id: 'sale_100',
    sessionId: 'sess_1',
    productCode: '03',
    buyerNickname: '러블리',
    unitPrice: 9000,
    quantity: 2,
    amount: 18000,
    status: '확정',
    revision: 1,
    history: [],
  };

  const intent = {
    isCorrection: true,
    field: 'AMOUNT',
    affirmedNewValue: { amount: 12000 }, // 새 단가 12,000원
    scope: 'THIS_SALE_ONLY',
    isNegativeCommand: false,
    isQuestion: false,
    isCancellation: false,
    isIncomplete: false,
    rawUtterance: '가격 1.2로 정정합니다',
  };

  const { updatedSale, historyRecord } = applyCorrectionToSale(originalSale, intent, {
    expectedRevision: 1,
  });

  assert.equal(updatedSale.id, 'sale_100', '판매 ID는 동일하게 유지되어야 함');
  assert.equal(updatedSale.revision, 2, 'revision은 2로 증가해야 함');
  assert.equal(updatedSale.unitPrice, 12000);
  assert.equal(updatedSale.quantity, 2);
  assert.equal(updatedSale.amount, 24000, '수량 2에 따라 총액은 24,000원으로 일관되게 재계산되어야 함');
  assert.equal(historyRecord.changeType, 'VOICE_CORRECTION');
  assert.equal(historyRecord.before.amount, 18000);
  assert.equal(historyRecord.after.amount, 24000);
});

// 9. 이미 인쇄된 판매 정정 시 수정 전표(CORRECTION) 발행 플래그
test('Print Job: 이미 출력된 판매를 정정하면 수정 전표(CORRECTION) 발행 필요를 표시', () => {
  const printedSale = {
    id: 'sale_printed',
    sessionId: 'sess_1',
    productCode: '05',
    buyerNickname: '철수',
    unitPrice: 10000,
    quantity: 1,
    amount: 10000,
    status: '확정',
    revision: 1,
    printStatus: 'PRINTED', // 이미 출력 완료된 건
    history: [],
  };

  const intent = {
    isCorrection: true,
    field: 'AMOUNT',
    affirmedNewValue: { amount: 15000 },
    scope: 'THIS_SALE_ONLY',
    isNegativeCommand: false,
    isQuestion: false,
    isCancellation: false,
    isIncomplete: false,
    rawUtterance: '15000원으로 정정',
  };

  const { printJobRequired, updatedSale } = applyCorrectionToSale(printedSale, intent, {
    expectedRevision: 1,
  });

  assert.equal(printJobRequired, true, '이미 출력된 건이므로 수정 전표 생성이 요구되어야 함');
  assert.equal(updatedSale.revision, 2);
});

// 10. "방금 수정한 거 취소": 판매 삭제와 구분되는 복원 처리
test('Correction Rollback: "방금 수정한 거 취소" 발화 시 판매는 삭제되지 않고 이전 정정 전 값으로 복원', () => {
  const correctedSale = {
    id: 'sale_corr',
    sessionId: 'sess_1',
    productCode: '07',
    buyerNickname: 'ooo', // 정정된 값
    amount: 12000,
    revision: 2,
    history: [
      {
        revision: 2,
        changedAt: '2026-09-10T12:00:00Z',
        changedBy: 'SELLER',
        changeType: 'VOICE_CORRECTION',
        before: {
          buyerNickname: 'xxx', // 원본 값
          amount: 9000,
          status: '확정',
        },
        after: {
          buyerNickname: 'ooo',
          amount: 12000,
          status: '확정',
        },
        summary: '구매자 및 금액 정정',
      },
    ],
  };

  const rollbackResult = rollbackCorrection(correctedSale);

  assert.equal(rollbackResult.success, true);
  assert.equal(rollbackResult.rolledBackSale?.buyerNickname, 'xxx', '구매자가 정정 전 xxx로 복원되어야 함');
  assert.equal(rollbackResult.rolledBackSale?.amount, 9000, '금액이 정정 전 9,000원으로 복원되어야 함');
  assert.equal(rollbackResult.rolledBackSale?.revision, 3, '복원 이력에 따라 revision은 3으로 증가');
  assert.equal(
    rollbackResult.rolledBackSale?.history?.[rollbackResult.rolledBackSale.history.length - 1].changeType,
    'CORRECTION_ROLLBACK'
  );
});

// 11. 결제 완료 건 되돌리기 충돌 방어
test('Rollback Conflict: 이미 결제가 완료된 판매 건은 자동 복원하지 않고 충돌 반환', () => {
  const paidSale = {
    id: 'sale_paid',
    sessionId: 'sess_1',
    productCode: '08',
    buyerNickname: '고객',
    amount: 20000,
    paymentStatus: 'PAID', // 결제 완료 상태
    revision: 2,
    history: [
      {
        revision: 2,
        changedAt: '2026-09-10T12:00:00Z',
        changedBy: 'SELLER',
        changeType: 'VOICE_CORRECTION',
        before: { amount: 15000 },
        after: { amount: 20000 },
        summary: '금액 정정',
      },
    ],
  };

  const rollbackResult = rollbackCorrection(paidSale);

  assert.equal(rollbackResult.success, false);
  assert.ok(rollbackResult.conflictReason?.includes('결제가 완료'));
});

// 12. 향후 상품 가격 정정과 특정 판매 정정의 범위 구분
test('Scope Distinction: "앞으로 판매할 가격은 1.2입니다" -> FUTURE_PRODUCT_SALES 범위로 구분', () => {
  const utterance = '앞으로 판매할 가격은 1.2입니다';
  const intent = parseVoiceCorrection(utterance);

  assert.equal(intent.scope, 'FUTURE_PRODUCT_SALES', '향후 상품 가격 변경으로 인식되어야 함');
  assert.equal(intent.affirmedNewValue?.amount, 12000);
});
