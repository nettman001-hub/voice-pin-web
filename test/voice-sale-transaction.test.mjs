import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceVoiceSaleTransaction } from '../src/services/voiceSaleTransaction.ts';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { extractSpeechPrice } from '../src/services/priceEvidence.ts';

const at = (seconds) => new Date(Date.UTC(2026, 9, 17, 11, 11, 0) + seconds * 1000).toISOString();
const advance = (state, text, seconds, eventId = `event-${seconds}`, sessionId = 'session') =>
  advanceVoiceSaleTransaction(state, { sessionId, eventId, text, recognizedAt: at(seconds) });

test('분할된 호명·배정·가격·캡처를 같은 거래로 완성하고 원문을 보존한다', () => {
  const name = advance(null, '하니님', 0);
  assert.equal(name.emission, null);
  const allocation = advance(name.state, '드릴게요', 2);
  assert.equal(allocation.emission.result.amount, 0);
  assert.equal(allocation.emission.continuation, false);
  const price = advance(allocation.state, '1.2', 5);
  assert.equal(price.emission.result.amount, 12000);
  assert.equal(price.emission.continuation, true);
  const capture = advance(price.state, '캡처', 7);
  assert.equal(capture.emission.result.isFourPointConfirmed, true);
  assert.equal(capture.emission.captureRequested, true);
  assert.equal(capture.emission.transactionId, name.state.id);
  assert.equal(capture.emission.evidenceText, '하니님\n드릴게요\n1.2\n캡처');
  assert.equal(extractSaleFromTranscript(capture.emission.result.rawTranscript).isFourPointConfirmed, true);
  assert.equal(name.state.fragments.length, 1, '이전 상태를 변경하지 않는다');
});

test('18초 후 같은 구매자의 독립적인 가격 재확정은 앞 보류를 보충한다', () => {
  const first = advance(null, '하니님 드릴게요.', 0);
  const followup = '네. 맞으시면 ㅇ 한 번만. 하니님 드릴게요. 가격은 1.2, 캡처.';
  const next = advance(first.state, followup, 18);
  assert.equal(next.emission.transactionId, first.state.id);
  assert.equal(next.emission.startedAt, at(0));
  assert.equal(next.emission.continuation, true);
  assert.equal(next.emission.result.amount, 12000);
  assert.equal(next.emission.result.isFourPointConfirmed, true);
  assert.equal(next.emission.evidenceText, `하니님 드릴게요.\n${followup}`);
  assert.equal(next.emission.result.rawTranscript, followup, '재추출 가능한 독립 원문을 사용한다');
  assert.equal(extractSaleFromTranscript(next.emission.result.rawTranscript).amount, 12000);
});

test('짧은 추임새가 끼어든 STT 조각도 호명·배정·가격·캡처를 연결한다', () => {
  let step = { state: null, emission: null };
  for (const [seconds, text] of ['하니님', '네', '드릴게요', '네', '자', '가격은 1.2', '캡처'].entries()) {
    step = advance(step.state, text, seconds);
  }
  assert.equal(step.emission.result.buyerNickname, '하니');
  assert.equal(step.emission.result.amount, 12000);
  assert.equal(step.emission.result.isFourPointConfirmed, true);
  assert.equal(step.emission.evidenceText, '하니님\n네\n드릴게요\n네\n자\n가격은 1.2\n캡처');
});

test('가격 전 캡처는 보존하고 후속 가격에서 다시 캡처하지 않는다', () => {
  const first = advance(null, '하니님 드릴게요. 캡처해주세요.', 0);
  const next = advance(first.state, '하니님 드릴게요 가격은 1.2', 18);
  assert.equal(next.emission.transactionId, first.state.id);
  assert.equal(next.emission.result.isFourPointConfirmed, true);
  assert.equal(next.emission.result.amount, 12000);
  assert.equal(next.emission.captureRequested, false);
});

test('동일 이벤트 재전달과 캡처만 중복 전달되면 추가 판매를 내보내지 않는다', () => {
  const first = advance(null, '하니님 1.2 드릴게요', 0, 'allocation');
  assert.equal(advance(first.state, '하니님 1.2 드릴게요', 0, 'allocation').emission, null);
  const capture = advance(first.state, '캡처해주시고요', 2, 'capture');
  assert.equal(capture.emission.result.isFourPointConfirmed, true);
  assert.equal(advance(capture.state, '캡처해주시고요', 3, 'scanner-duplicate').emission, null);
  assert.equal(advance(capture.state, '캡처', 4, 'capture-duplicate').emission, null);
});

test('완료 뒤 같은 구매자·같은 가격의 새로운 배정도 별도 거래로 보존한다', () => {
  for (const ending of ['', ' 캡처해주세요']) {
    const first = advance(null, `하니님 1.2 드릴게요${ending}`, 0);
    const next = advance(first.state, '하니님 1.2 드릴게요 캡처해주세요', 5);
    assert.notEqual(next.emission.transactionId, first.state.id);
    assert.equal(next.emission.continuation, false);
    assert.equal(next.emission.result.amount, 12000);
    assert.equal(next.emission.precedingTransactionId, first.state.id,
      '새 구매 요청 유무를 저장 경로에서 판단할 수 있도록 앞 거래를 전달한다');
  }
});

test('완료 뒤 같은 구매자를 새로 호명한 분할 거래도 이전 거래에 합치지 않는다', () => {
  const first = advance(null, '하니님 1.2 드릴게요 캡처', 0);
  const name = advance(first.state, '하니님', 5);
  assert.notEqual(name.state.id, first.state.id);
  const next = advance(name.state, '드릴게요. 가격은 1.2. 캡처', 7);
  assert.equal(next.emission.transactionId, name.state.id);
  assert.equal(next.emission.continuation, false);
  assert.equal(next.emission.precedingTransactionId, first.state.id);
});

test('가격 재배정과 후속 캡처에 앞 거래 marker를 유지한다', () => {
  for (const ending of ['', ' 캡처']) {
    const first = advance(null, `러블리님 드릴게요 1.5${ending}`, 0);
    const repeated = advance(first.state, '러블리님 확정이요 1.5', 5);
    assert.notEqual(repeated.emission.transactionId, first.state.id);
    assert.equal(repeated.emission.precedingTransactionId, first.state.id);
    const capture = advance(repeated.state, '캡처', 7);
    assert.equal(capture.emission.transactionId, repeated.state.id);
    assert.equal(capture.emission.precedingTransactionId, first.state.id);
    assert.equal(capture.emission.result.isFourPointConfirmed, true);
  }
});

test('이전 가격 없는 보류를 보완할 때는 앞 거래 marker 없이 같은 id를 유지한다', () => {
  const first = advance(null, '하니님 드릴게요', 0);
  const next = advance(first.state, '하니님 1.2 드릴게요 캡처', 18);
  assert.equal(next.emission.transactionId, first.state.id);
  assert.equal(next.emission.precedingTransactionId, undefined);
});

test('다른 가격·상품·구매자·시간 경계는 앞 거래 marker를 전달하지 않는다', () => {
  const first = advance(null, '하니님 1.2 드릴게요 캡처', 0);
  for (const [text, seconds] of [
    ['하니님 1.5 드릴게요 캡처', 5],
    ['다음 상품 하니님 1.2 드릴게요 캡처', 5],
    ['루비님 1.2 드릴게요 캡처', 5],
    ['하니님 1.2 드릴게요 캡처', 31],
  ]) {
    const next = advance(first.state, text, seconds);
    assert.ok(next.emission, text);
    assert.equal(next.emission.precedingTransactionId, undefined, text);
  }
  const switched = advance(first.state, '다음 상품은 니트입니다.', 2);
  assert.equal(advance(switched.state, '하니님 1.2 드릴게요 캡처', 5).emission.precedingTransactionId, undefined);
  const name = advance(first.state, '하니님', 2);
  assert.equal(name.state.precedingTransactionId, first.state.id);
  const next = advance(name.state, '드릴게요. 가격은 1.5. 캡처', 5);
  assert.equal(next.emission.precedingTransactionId, undefined);
  assert.equal(next.state.precedingTransactionId, undefined);
});

for (const boundary of [
  '다음 상품은 니트입니다.', '새 옷 보여드릴게요.', '다른 상품이에요.',
  '이 색상 맞나요?', '하니님 드릴게요?', '하니님 안 드릴게요.',
  '하니님 드릴게요 취소.', '금액 1.2로 정정합니다.', '캡처하지 마세요.',
  '있으면 드릴게요.', '오늘 날씨가 좋네요.', '캡처해주세요라는 문구를 보세요.',
]) {
  test(`경계 뒤 가격·캡처를 앞 구매자에게 연결하지 않는다: ${boundary}`, () => {
    const first = advance(null, '하니님 드릴게요', 0);
    const interrupted = advance(first.state, boundary, 2);
    assert.equal(interrupted.emission, null);
    assert.equal(interrupted.state, null);
    const next = advance(interrupted.state, '가격은 1.2. 캡처해주세요', 5);
    assert.equal(next.emission, null);
  });
}

test('다른 구매자의 호명은 새 거래를 시작하고 앞 구매자의 가격을 가져오지 않는다', () => {
  const first = advance(null, '하니님 드릴게요 가격은 1.0', 0);
  const other = advance(first.state, '루비님', 2);
  const allocation = advance(other.state, '드릴게요', 4);
  assert.notEqual(allocation.emission.transactionId, first.state.id);
  assert.equal(allocation.emission.result.buyerNickname, '루비');
  assert.equal(allocation.emission.result.amount, 0);
  const complete = advance(allocation.state, '가격은 1.2. 캡쳐해주세요', 6);
  assert.equal(complete.emission.result.amount, 12000);
});

test('30초·회차 경계를 넘어서 앞 호명이나 배정을 사용하지 않는다', () => {
  const first = advance(null, '하니님 드릴게요', 0);
  assert.equal(advance(first.state, '가격은 1.2. 캡처해주세요', 31).emission, null);
  assert.equal(advance(first.state, '가격은 1.2. 캡처해주세요', 5, 'other-session', 'other').emission, null);
  assert.equal(advance(first.state, '가격은 1.2. 캡처해주세요', 30).emission.result.amount, 12000);
});

test('한 입력 안의 뒤 상품·구매자 전환은 앞 판매를 반환한 뒤 연결 상태를 닫는다', () => {
  for (const suffix of ['다음 상품은 니트입니다.', '루비님 2.0 드릴게요.']) {
    const first = advance(null, `하니님 1.2 드릴게요. ${suffix}`, 0);
    assert.equal(first.emission.result.buyerNickname, '하니');
    assert.equal(first.emission.result.amount, 12000);
    assert.equal(first.state, null);
    assert.equal(first.emission.startedAt, at(0));
    assert.equal(advance(first.state, '캡처', 3).emission, null);
    const withCapture = advance(null, `하니님 1.2 드릴게요. ${suffix} 캡처해주세요`, 0);
    assert.equal(withCapture.emission.captureRequested, false);
    assert.equal(withCapture.emission.result.isFourPointConfirmed, false);
  }
});

test('치수·별도 가격 문맥이 판매 가격을 오염시키지 않는다', () => {
  const first = advance(null, '하니님 드릴게요', 0);
  const next = advance(first.state, '가격은 1.2, 가단 60.5에 총장 89.5, 캡처해주세요', 3);
  assert.equal(next.emission.result.amount, 12000);
  assert.equal(extractSpeechPrice(next.emission.result.allocationTranscript).amount, 12000);
  const measurement = advance(first.state, '가단 60.5에 총장 89.5', 3);
  assert.equal(measurement.emission, null);
  assert.equal(advance(measurement.state, '캡처해주세요', 4).emission, null);
});

test('수정·아니카 닉네임을 정정이나 부정으로 오인하지 않는다', () => {
  for (const nickname of ['수정', '아니카']) {
    const first = advance(null, `${nickname}님 드릴게요`, 0);
    const next = advance(first.state, '가격은 1.2. 캡처', 3);
    assert.equal(next.emission.result.buyerNickname, nickname);
    assert.equal(next.emission.result.isFourPointConfirmed, true);
  }
});
