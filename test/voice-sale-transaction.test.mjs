import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceVoiceSaleTransaction } from '../src/services/voiceSaleTransaction.ts';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { extractSpeechPrice } from '../src/services/priceEvidence.ts';
import { shouldReviewVoiceSaleText } from '../src/services/voicePendingReviewService.ts';

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

test('실제 별이 발화의 감사 인사 뒤 가격·캡처는 같은 판매를 확정하고 보류 AI에서 제외한다', () => {
  const sky = advance(null, '하늘님 드릴게요. 가격 5.0 캡처해주세요.', 0);
  const allocation = '네, 이거 별이님 드릴게요. 감사합니다.';
  const star = advance(sky.state, allocation, 14);
  assert.equal(star.emission.result.status, '보류');
  assert.equal(star.emission.result.amount, 0);
  const confirmed = advance(star.state, '가격 1.2 캡처해주세요.', 16.75);
  assert.ok(confirmed.emission, '판매 사실이 바뀌었으므로 기존 보류를 갱신한다');
  assert.equal(confirmed.emission.transactionId, star.emission.transactionId);
  assert.equal(confirmed.emission.continuation, true);
  assert.equal(confirmed.emission.result.buyerNickname, '별이');
  assert.equal(confirmed.emission.result.amount, 12000);
  assert.equal(confirmed.emission.result.status, '확정');
  assert.equal(confirmed.emission.result.isFourPointConfirmed, true);
  assert.equal(confirmed.emission.captureRequested, true);
  assert.equal(confirmed.emission.evidenceText, `${allocation}\n가격 1.2 캡처해주세요.`);
  assert.equal(extractSaleFromTranscript(confirmed.emission.result.rawTranscript).amount, 12000);
  assert.equal(sky.emission.result.buyerNickname, '하늘');
  assert.equal(sky.emission.result.amount, 50000);
  const anchor = { source: 'WEB_VOICE', sessionId: 'session', recognizedAt: at(14) };
  const comments = [{ id: 'star-comment', sessionId: 'session', nickname: '별이', content: '저요', capturedAt: at(12) }];
  assert.equal(shouldReviewVoiceSaleText({ ...star.emission.result, ...anchor }, comments), true);
  assert.equal(shouldReviewVoiceSaleText({ ...confirmed.emission.result, ...anchor }, comments), false);
});

test('가격과 인사와 캡처가 한 STT 조각으로 오거나 나뉘어 와도 같은 거래로 확정한다', () => {
  for (const fragments of [
    ['별이님 드릴게요.', '가격 1.2. 감사합니다. 캡처해주세요.'],
    ['별이님 드릴게요.', '가격 1.2. 감사합니다.', '캡처해주세요.'],
    ['별이님 드릴게요.', '감사합니다.', '가격 1.2 캡처해주세요.'],
    ['별이님 드릴게요. 감사합니다.', '가격 1.2.', '감사합니다. 캡처해주세요.'],
  ]) {
    let state = null;
    let transactionId;
    let step;
    let captures = 0;
    for (const [index, text] of fragments.entries()) {
      step = advance(state, text, index * 2);
      state = step.state;
      transactionId ||= state?.id;
      if (step.emission?.captureRequested) captures++;
    }
    assert.equal(step.emission?.transactionId, transactionId, fragments.join('\n'));
    assert.equal(step.emission?.result.status, '확정', fragments.join('\n'));
    assert.equal(step.emission?.result.amount, 12000, fragments.join('\n'));
    assert.equal(step.emission?.result.buyerNickname, '별이', fragments.join('\n'));
    assert.equal(captures, 1);
  }
});

test('독립된 감사 인사는 거래 대기 시간을 연장하거나 다른 구매자·상품을 합치지 않는다', () => {
  const first = () => advance(null, '별이님 드릴게요.', 0);
  const thanked = advance(first().state, '감사합니다.', 3);
  assert.equal(thanked.emission, null);
  assert.notEqual(advance(thanked.state, '가격 1.2 캡처해주세요.', 16).emission?.result.isFourPointConfirmed, true);
  for (const boundary of ['하늘님 드릴게요.', '다음 상품입니다.', '이 가격 맞나요?', '취소할게요.']) {
    const interrupted = advance(thanked.state, boundary, 4);
    const next = advance(interrupted.state, '가격 5.0 캡처해주세요.', 5);
    assert.notEqual(next.emission?.result.buyerNickname === '별이' && next.emission?.result.amount === 50000, true, boundary);
    if (boundary.startsWith('하늘')) {
      assert.equal(next.emission.result.buyerNickname, '하늘');
      assert.equal(next.emission.result.amount, 50000);
      assert.notEqual(next.emission.transactionId, thanked.state.id);
    }
  }
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
  '있으면 드릴게요.', '캡처해주세요라는 문구를 보세요.',
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

test('가격 앞에서 끊긴 배정은 다음 조각 첫 가격을 다른 말이 섞여도 붙인다', () => {
  for (const [speech, amount] of [
    ['1.0이고요. 색깔 너무 예뻐요.', 10000], ['만 원. 이거 진짜 예쁘죠?', 10000], ['어, 1.0.', 10000],
    ['1.5예요.', 15000], ['1.0 할게요.', 10000], ['1.0 받을게요.', 10000],
    ['1.0. 다음 상품 보여 드릴게요.', 10000], ['1.0이고요. 예뻐요. 캡처하세요.', 10000],
  ]) {
    const first = advance(null, '네, 이거 우아한 유령님 드릴게요. 가격은.', 0);
    assert.equal(first.emission.result.amount, 0, speech);
    const next = advance(first.state, speech, 4);
    assert.equal(next.emission?.result.amount, amount, speech);
    assert.equal(next.emission.continuation, true, speech);
    // sales-api re-reads the saved speech; it must find the same price.
    assert.equal(extractSaleFromTranscript(next.emission.result.rawTranscript)?.amount, amount, speech);
  }
  const captured = advance(advance(null, '루나님 드릴게요.', 0).state, '1.0이고요. 예뻐요. 캡처하세요.', 3);
  assert.equal(captured.emission.captureRequested, true);
});

test('끊긴 배정의 가격 연결은 다른 구매자·다른 가격·15초 경과에서 멈춘다', () => {
  const first = () => advance(null, '이거, 이거 루나님 드릴게요.', 0);
  assert.equal(advance(first().state, '1.0이고요. 예뻐요.', 20).emission, null);
  assert.equal(advance(first().state, '1.0. 유령님 드릴게요.', 3).emission?.result.buyerNickname, '유령');
  assert.equal(advance(first().state, '1.0이고요. 저건 1.5 했어요.', 3).emission, null);
  assert.equal(advance(first().state, '1.0 아니고요, 취소할게요.', 3).emission, null);
  const closed = advance(first().state, '1.0. 다음 상품 보여 드릴게요.', 3);
  assert.equal(closed.emission.result.amount, 10000);
  assert.equal(closed.state, null);
});

test('4단 멘트는 순서가 바뀌어도, 조각으로 끊겨도 확정한다', () => {
  const parts = ['루나님', '드릴게요', '가격은 1.0', '캡처하세요'];
  const orders = [];
  const permute = (rest, acc = []) => rest.length ? rest.forEach((part, i) =>
    permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, part])) : orders.push(acc);
  permute(parts);
  assert.equal(orders.length, 24);
  for (const order of orders) {
    const sentence = `${order.join('. ')}.`;
    const whole = extractSaleFromTranscript(sentence);
    assert.equal(whole?.isFourPointConfirmed, true, sentence);
    assert.equal(whole.buyerNickname, '루나', sentence);
    assert.equal(whole.amount, 10000, sentence);
    let step = { state: null, emission: null };
    let last = null;
    order.forEach((part, i) => {
      step = advance(step.state, `${part}.`, i * 2);
      last = step.emission || last;
    });
    assert.equal(last?.result.isFourPointConfirmed, true, `조각: ${sentence}`);
    assert.equal(extractSaleFromTranscript(last.result.rawTranscript)?.isFourPointConfirmed, true, `서버: ${sentence}`);
  }
});

test('순서 무관 4단도 구매자 둘·가격 둘·질문·정정·상품 전환이면 확정하지 않는다', () => {
  for (const speech of [
    '가격은 1.0. 캡처하세요. 루나님, 루비님 드릴게요.',
    '가격은 1.0. 1.5. 캡처하세요. 루나님 드릴게요.',
    '가격은 1.0. 캡처하세요. 루나님 드릴까요?',
    '가격은 1.0. 캡처하지 마세요. 루나님 드릴게요.',
    '가격은 1.0. 캡처하세요. 다음 상품. 루나님 드릴게요.',
    '가격은 1.0. 캡처하세요. 루나님 보여 드릴게요.',
  ]) assert.notEqual(extractSaleFromTranscript(speech)?.isFourPointConfirmed, true, speech);
});

test('가격 앞에서 끊긴 4단 멘트는 캡처가 가격 앞뒤 어디에 와도 확정한다', () => {
  const first = () => advance(null, '네, 이거 우아한 유령님 드릴게요. 가격은.', 0);
  for (const rest of [['1.0이고요. 예뻐요. 캡처하세요.'], ['캡처하세요.', '1.0'], ['캡처하세요. 1.0이에요.'], ['1.0', '캡처해 놓으세요.']]) {
    let step = first();
    rest.forEach((text, i) => { step = advance(step.state, text, 3 + i * 2); });
    assert.equal(step.emission?.result.isFourPointConfirmed, true, rest.join(' / '));
    assert.equal(step.emission.result.amount, 10000, rest.join(' / '));
  }
  let split = advance(null, '우아한 유령님', 0);
  split = advance(split.state, '드릴게요. 가격은.', 2);
  split = advance(split.state, '1.0. 캡처하세요.', 4);
  assert.equal(split.emission?.result.isFourPointConfirmed, true);
});

test('가격·캡처 사이 잡담 조각은 15초 동안 거래를 끊지 않는다 (2026-10-19 사용자 결정)', () => {
  for (const chatter of ['오늘 날씨가 좋네요.', '색깔 너무 예뻐요.', '이거 진짜 부드러워요']) {
    let step = advance(null, '네, 이거 우아한 유령님 드릴게요. 가격은.', 0);
    step = advance(step.state, '1.0이고요.', 3);
    const kept = advance(step.state, chatter, 5);
    assert.equal(kept.emission, null, chatter);
    assert.ok(kept.state, chatter);
    const capture = advance(kept.state, '캡처하세요.', 8);
    assert.equal(capture.emission?.result.isFourPointConfirmed, true, chatter);
    assert.equal(capture.emission.result.amount, 10000, chatter);
    assert.equal(extractSaleFromTranscript(capture.emission.result.rawTranscript)?.isFourPointConfirmed, true, chatter);
  }
  // 잡담 뒤 15초가 지나면 끊고, 질문·숫자·다른 구매자는 잡담이 아니다.
  const priced = advance(advance(null, '루나님 드릴게요.', 0).state, '1.0', 2);
  assert.equal(advance(advance(priced.state, '색깔 예뻐요.', 4).state, '캡처하세요.', 20).emission, null);
  for (const boundary of ['이 색상 맞나요?', '가단 60에 총장 89.', '유령님 반가워요.']) {
    const next = advance(advance(priced.state, boundary, 4).state, '캡처하세요.', 6);
    assert.notEqual(next.emission?.result.isFourPointConfirmed, true, boundary);
  }
});
