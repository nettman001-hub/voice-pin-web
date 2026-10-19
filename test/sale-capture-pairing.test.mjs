import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCaptureForSale,
  findSaleForCapture,
  hasCaptureInstructionText,
} from '../src/services/saleCapturePairing.ts';

const at = (seconds) => new Date(Date.UTC(2026, 9, 7, 12, 0, 0) + seconds * 1000).toISOString();

test('판매 저장 10초 전 "캡처하세요" 캡처가 이미지1이 된다', () => {
  const captures = [
    { id: 'old', sessionId: 's1', capturedAt: at(-30), purpose: 'SALE' },
    { id: 'near', sessionId: 's1', capturedAt: at(-4), purpose: 'SALE' },
  ];
  assert.equal(findCaptureForSale({ sessionId: 's1', recognizedAt: at(0) }, captures)?.id, 'near');
});

test('10초 밖, 이미 쓰인 캡처, 상품등록 촬영, 다른 방송 캡처는 쓰지 않는다', () => {
  const captures = [
    { id: 'late', sessionId: 's1', capturedAt: at(-11), purpose: 'SALE' },
    { id: 'used', sessionId: 's1', capturedAt: at(-2), purpose: 'SALE', saleId: 'sale-a' },
    { id: 'product', sessionId: 's1', capturedAt: at(-1), purpose: 'PRODUCT_REGISTER' },
    { id: 'legacy', sessionId: 's1', capturedAt: at(-1) },
    { id: 'other', sessionId: 's2', capturedAt: at(-1), purpose: 'SALE' },
  ];
  assert.equal(findCaptureForSale({ sessionId: 's1', recognizedAt: at(0) }, captures), undefined);
});

test('캡처 시각 10초 안에 저장된, 사진 없는 판매에 붙는다', () => {
  const sales = [
    { id: 'prev', sessionId: 's1', recognizedAt: at(-20) },
    { id: 'a', sessionId: 's1', recognizedAt: at(-3) },
  ];
  assert.equal(findSaleForCapture({ sessionIds: ['s1'], capturedAt: at(0) }, sales)?.id, 'a');
});

test('직전 판매에 이미 사진이 있으면 캡처는 그 판매에 붙지 않는다', () => {
  const sales = [
    { id: 'a', sessionId: 's1', recognizedAt: at(-3), captureImageUrls: ['data:a'] },
    { id: 'cancelled', sessionId: 's1', recognizedAt: at(-1), status: '취소' },
  ];
  assert.equal(findSaleForCapture({ sessionIds: ['s1'], capturedAt: at(0) }, sales), undefined);
  assert.equal(findSaleForCapture({ sessionIds: ['s1'], capturedAt: at(0) }, sales, undefined, { allowCaptured: true })?.id, 'a');
});

test('10초 안에 판매가 둘이면 캡처 시각에 더 가까운 판매에 붙는다', () => {
  const sales = [
    { id: 'a', sessionId: 's1', recognizedAt: at(-8) },
    { id: 'b', sessionId: 's1', recognizedAt: at(-2) },
  ];
  assert.equal(findSaleForCapture({ sessionIds: ['s1'], capturedAt: at(0) }, sales)?.id, 'b');
});

test('캡처 지시 문장을 알아듣고, 질문이나 금지는 무시한다', () => {
  for (const text of ['자 캡처하세요.', '캡쳐 해 주세요', '화면 캡처', '캡처할게요', '이거 캡처해 주시고요', '캡처 부탁드립니다']) {
    assert.equal(hasCaptureInstructionText(text), true, text);
  }
  for (const text of ['캡처할까요?', '캡처하세요?', '캡처하지 마세요', '캡처 화면이 예쁘네요', '캡처해 주시고요?']) {
    assert.equal(hasCaptureInstructionText(text), false, text);
  }
});

test('구어체 캡처 지시를 인식하고 단독 캡처는 거래 문맥에서만 인정한다', () => {
  for (const text of ['캡처해주시고요', '캡처해 주시고', '캡쳐해주시고요', '캡쳐해주세요']) {
    assert.equal(hasCaptureInstructionText(text), true, text);
  }
  for (const text of ['캡처', '네, 캡쳐.']) {
    assert.equal(hasCaptureInstructionText(text), false, text);
    assert.equal(hasCaptureInstructionText(text, { saleContext: true }), true, text);
  }
  for (const text of [
    '캡처해주시고요?', '캡쳐하지 마세요', '캡처 안 할게요', '안 캡처해주세요',
    '캡처해주세요라는 문구', '캡처하세요라고 말했어요', '화면 캡처 방법을 설명합니다',
    '캡처 화면이 예쁘네요', '캡처해주세요. 캡처하지 마세요.',
  ]) assert.equal(hasCaptureInstructionText(text, { saleContext: true }), false, text);
});
