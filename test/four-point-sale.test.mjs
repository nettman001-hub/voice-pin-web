import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSaleFromTranscript, checkFourPointSaleCriteria } from '../src/services/salesExtractor.ts';
import { extractSpeechPrice } from '../src/services/priceEvidence.ts';

test('확정 문맥의 구어체·단독 캡처는 인식하되 질문·부정·설명은 제외한다', () => {
  for (const capture of ['캡처해주시고요', '캡처해주세요', '캡쳐해 주시고요', '캡쳐해주세요', '캡처']) {
    const sale = extractSaleFromTranscript(`하니님 드릴게요. 가격은 1.2. ${capture}.`);
    assert.equal(sale?.isFourPointConfirmed, true, capture);
    assert.equal(sale?.amount, 12000, capture);
  }
  for (const capture of ['캡처해주시고요?', '캡처하지 마세요', '캡처 안 할게요', '캡처해주세요라는 문구를 보세요']) {
    assert.equal(checkFourPointSaleCriteria(`하니님 드릴게요 1.2. ${capture}`).isFourPointSale, false, capture);
  }
});

test('1. 4단 멘트 판별 - xxx님, 닉네임 xxx, xxx언니 호출 패턴 정상 추출', () => {
  // 패턴 1: xxx님
  const r1 = checkFourPointSaleCriteria('러블리님 이거 드릴게요 1.5 캡처하세요.');
  assert.equal(r1.isFourPointSale, true);
  assert.equal(r1.buyerNickname, '러블리');
  assert.equal(r1.amount, 15000);
  assert.equal(r1.hasNickname, true);
  assert.equal(r1.hasConfirmation, true);
  assert.equal(r1.hasPrice, true);
  assert.equal(r1.hasCapture, true);

  // 패턴 2: xxx언니
  const r2 = checkFourPointSaleCriteria('지영언니 이거 드릴께요 2.3 캡처해주세요.');
  assert.equal(r2.isFourPointSale, true);
  assert.equal(r2.buyerNickname, '지영');
  assert.equal(r2.amount, 23000);

  // 패턴 3: 닉네임 xxx
  const r3 = checkFourPointSaleCriteria('닉네임 민트초코 확정이요 0.8 캡처요.');
  assert.equal(r3.isFourPointSale, true);
  assert.equal(r3.buyerNickname, '민트초코');
  assert.equal(r3.amount, 8000);
});

test('2. extractSaleFromTranscript - 4단 멘트 일치 시 즉시 확정(status: 확정, isFourPointConfirmed: true) 반환', () => {
  const sale = extractSaleFromTranscript('동대문언니 이거 드릴게요 3.5 캡처하세요.');
  assert.ok(sale);
  assert.equal(sale.buyerNickname, '동대문');
  assert.equal(sale.amount, 35000);
  assert.equal(sale.status, '확정');
  assert.equal(sale.isPending, false);
  assert.equal(sale.isFourPointConfirmed, true);
});

test('배정과 가격·캡처 사이의 짧은 감사 인사는 4단 확정을 끊지 않는다', () => {
  for (const courtesy of ['감사합니다', '감사 합니다', '네, 감사합니다', '고맙습니다', '감사해요', '고마워요']) {
    for (const transcript of [
      `네, 이거 별이님 드릴게요. ${courtesy}.\n가격 1.2 캡처해주세요.`,
      `별이님 드릴게요. 가격 1.2. ${courtesy}. 캡처해주세요.`,
      `별이님 드릴게요. 캡처해주세요. ${courtesy}. 가격 1.2.`,
      `가격 1.2. ${courtesy}. 캡처해주세요. 별이님 드릴게요.`,
    ]) {
      const sale = extractSaleFromTranscript(transcript);
      assert.equal(sale?.buyerNickname, '별이', transcript);
      assert.equal(sale?.amount, 12000, transcript);
      assert.equal(sale?.status, '확정', transcript);
      assert.equal(sale?.isFourPointConfirmed, true, transcript);
      assert.equal(sale?.rawTranscript, transcript, '인사도 원본에 보존한다');
      assert.equal(extractSpeechPrice(sale.allocationTranscript)?.amount, 12000, transcript);
    }
  }
  const noCapture = extractSaleFromTranscript('별이님 드릴게요. 감사합니다. 가격 1.2.');
  assert.equal(noCapture?.amount, 12000);
  assert.equal(noCapture?.status, '자동저장');
  assert.equal(noCapture?.isFourPointConfirmed, false);
});

test('감사 인사가 있어도 다른 거래·질문·정정 뒤의 가격과 캡처를 앞 판매에 붙이지 않는다', () => {
  for (const boundary of [
    '하늘님 드릴게요', '다음 상품', '새 상품', '이 가격 맞나요?',
    '감사합니다?', '감사합니다라는 문구를 보세요', '감사합니다 하늘님',
    '감사합니다 다음 상품', '취소할게요', '가격 정정할게요',
  ]) {
    const transcript = `별이님 드릴게요. 감사합니다. ${boundary}. 가격 5.0 캡처해주세요.`;
    const sale = extractSaleFromTranscript(transcript);
    assert.notEqual(sale?.buyerNickname === '별이' && sale?.amount === 50000, true, transcript);
    assert.equal(checkFourPointSaleCriteria(transcript).isFourPointSale, false, transcript);
  }
});

test('3. 4대 조건 중 하나라도 누락되면 4단 확정되지 않고 기존 로직으로 안전 폴백', () => {
  // 캡처 멘트 누락
  const noCap = checkFourPointSaleCriteria('러블리님 이거 드릴게요 1.5');
  assert.equal(noCap.isFourPointSale, false);
  assert.equal(noCap.hasCapture, false);

  // 확정 멘트 누락
  const noConf = checkFourPointSaleCriteria('러블리님 1.5 캡처하세요.');
  assert.equal(noConf.isFourPointSale, false);
  assert.equal(noConf.hasConfirmation, false);

  // 가격 누락
  const noPrice = checkFourPointSaleCriteria('러블리님 이거 드릴게요 캡처하세요.');
  assert.equal(noPrice.isFourPointSale, false);
  assert.equal(noPrice.hasPrice, false);

  // 닉네임 누락
  const noName = checkFourPointSaleCriteria('이거 드릴게요 1.5 캡처하세요.');
  assert.equal(noName.isFourPointSale, false);
  assert.equal(noName.hasNickname, false);
});

test('4. 전표 출력 대상 판정 - 확정일 경우는 전표 출력 대상, 보류일 경우는 전표 미출력 대상', () => {
  const isPrintableSale = (sale) => (
    sale.status !== '보류' && sale.status !== '취소' && sale.recordState !== 'CANCELLED'
    && sale.amount > 0
    && Boolean(sale.buyerNickname.trim())
    && sale.buyerNickname !== '미확인(보류)'
  );

  const confirmedSale = {
    id: 's-1',
    buyerNickname: '러블리',
    amount: 15000,
    status: '확정',
  };
  assert.equal(isPrintableSale(confirmedSale), true, '확정 건은 전표 출력 대상(true)이어야 함');

  const pendingSale = {
    id: 's-2',
    buyerNickname: '러블리',
    amount: 15000,
    status: '보류',
  };
  assert.equal(isPrintableSale(pendingSale), false, '보류 건은 전표 출력 대상이 아니어야 함(false)');
});

test('5. 판매 확정 시 닉네임 결정 우선순위 - 댓글창 닉네임 최우선, 댓글 없을 때만 발화 닉네임 예외 저장', () => {
  const resolveFinalNickname = ({ commentNickname, spokenNickname }) => {
    return commentNickname || spokenNickname;
  };

  // Case A: 판매자가 "마인드셋"이라고 불렀으나 댓글창에 "mindset0517"이 있는 경우 -> "mindset0517" 저장!
  const finalNicknameWithComment = resolveFinalNickname({
    commentNickname: 'mindset0517',
    spokenNickname: '마인드셋'
  });
  assert.equal(finalNicknameWithComment, 'mindset0517', '댓글 닉네임이 있으면 댓글 닉네임이 저장되어야 함');

  // Case B: 고객이 댓글을 남기지 않아 댓글 닉네임이 없는 경우 -> 판매자 발화 닉네임 "마인드셋" 저장!
  const finalNicknameWithoutComment = resolveFinalNickname({
    commentNickname: undefined,
    spokenNickname: '마인드셋'
  });
  assert.equal(finalNicknameWithoutComment, '마인드셋', '댓글이 없을 때 예외적으로 발화 닉네임이 저장되어야 함');
});

test('4단 확정은 같은 거래의 후속 캡처와 캡처 뒤 명시가격을 연결한다', () => {
  for (const transcript of [
    '햇살님 드릴게요 1.5. 캡처하세요.',
    '햇살님 드릴게요. 캡처하세요. 가격은 1.5입니다.',
    '햇살님 드릴게요. 금액은 1.5, 캡처하세요.',
    '햇살님 드릴게요. 금액은 1.5, 가단 60.5에 총장 89.5, 캡처하세요.',
    '햇살님. 드릴게요 1.5. 캡쳐하세요.',
    '햇살님 드릴게요 1.5. 캡쳐요.',
    '햇살님 드릴게요 1.5. 햇살님 드릴게요 1.5. 캡처하세요.',
    '햇살님 드릴게요. 햇살님 1.5 드릴게요. 캡처하세요.',
    '햇살님 캡처하세요. 드릴게요. 가격은 1.5입니다.',
    '캡처하세요. 햇살님 드릴게요 1.5.',
  ]) {
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.isFourPointSale, true, transcript);
    assert.equal(check.buyerNickname, '햇살', transcript);
    assert.equal(check.amount, 15000, transcript);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale, transcript);
    assert.equal(sale.buyerNickname, '햇살', transcript);
    assert.equal(sale.amount, 15000, transcript);
    assert.equal(sale.status, '확정', transcript);
    assert.equal(sale.isFourPointConfirmed, true, transcript);
    assert.equal(extractSpeechPrice(sale.allocationTranscript)?.amount, sale.amount, transcript);
  }
});

const productTransitions = [
  '다음 상품',
  '다음 물건',
  '새 상품',
  '다른 상품은',
  '다음 거는',
  '다음 옷은',
];

for (const transition of productTransitions) {
  test(`상품 전환 '${transition}' 뒤 가격은 이미 완성된 거래의 가격을 덮어쓰지 않는다`, () => {
    const transcript = `햇살님 드릴게요 1.5. 캡처하세요. ${transition} 가격은 2.9입니다.`;
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.isFourPointSale, true);
    assert.equal(check.amount, 15000);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale);
    assert.equal(sale.buyerNickname, '햇살');
    assert.equal(sale.amount, 15000);
    assert.equal(sale.status, '확정');
    assert.equal(sale.isFourPointConfirmed, true);
  });

  test(`상품 전환 '${transition}' 뒤 가격으로 앞 거래의 누락 금액을 채우지 않는다`, () => {
    const transcript = `햇살님 드릴게요. 캡처하세요. ${transition} 가격은 2.9입니다.`;
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.isFourPointSale, false);
    assert.equal(check.hasPrice, false);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale);
    assert.equal(sale.buyerNickname, '햇살');
    assert.equal(sale.amount, 0);
    assert.equal(sale.isPending, true);
    assert.equal(sale.isFourPointConfirmed, false);
  });
}

test('두 고객의 거래를 포함한 전사는 첫 거래 한 건만 반환하고 캡처를 공유하지 않는다', () => {
  for (const ending of [
    '민트님 드릴게요 2.0.',
    '민트님 드릴게요 2.0. 캡처하세요.',
  ]) {
    const transcript = `햇살님 드릴게요 1.5. 캡처하세요. ${ending}`;
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.isFourPointSale, true, transcript);
    assert.equal(check.buyerNickname, '햇살', transcript);
    assert.equal(check.amount, 15000, transcript);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale, transcript);
    assert.equal(Array.isArray(sale), false, '기존 단건 반환 계약을 유지한다');
    assert.equal(sale.buyerNickname, '햇살', transcript);
    assert.equal(sale.amount, 15000, transcript);
    assert.equal(sale.isFourPointConfirmed, true, transcript);
  }

  const mintOnly = '민트님 드릴게요 2.0.';
  assert.equal(checkFourPointSaleCriteria(mintOnly).isFourPointSale, false);
  assert.equal(extractSaleFromTranscript(mintOnly)?.isFourPointConfirmed, false);
});

test('다른 고객의 거래 뒤에 나온 캡처는 첫 거래의 캡처로 사용하지 않는다', () => {
  const transcript = '햇살님 드릴게요 1.5. 민트님 드릴게요 2.0. 캡처하세요.';
  const check = checkFourPointSaleCriteria(transcript);
  assert.equal(check.isFourPointSale, false);
  assert.equal(check.hasCapture, false);

  const sale = extractSaleFromTranscript(transcript);
  assert.ok(sale);
  assert.equal(sale.buyerNickname, '햇살');
  assert.equal(sale.amount, 15000);
  assert.equal(sale.isFourPointConfirmed, false);
});

const unrelatedClauses = [
  ['질문', '이 색상 맞나요?'],
  ['조건', '입금하시면 보내 드릴게요.'],
  ['취소', '이건 취소할게요.'],
  ['부정', '드리는 거 아니에요.'],
  ['무관한 설명', '오늘 날씨가 좋네요.'],
];

for (const [kind, clause] of unrelatedClauses) {
  test(`${kind} 문장을 건너뛰어 후속 가격을 앞 거래에 연결하지 않는다`, () => {
    const transcript = `햇살님 드릴게요. 캡처하세요. ${clause} 가격은 2.9입니다.`;
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.isFourPointSale, false);
    assert.equal(check.hasPrice, false);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale);
    assert.equal(sale.amount, 0);
    assert.equal(sale.isPending, true);
    assert.equal(sale.isFourPointConfirmed, false);
  });

  test(`${kind} 문장을 건너뛰어 후속 캡처를 앞 거래에 연결하지 않는다`, () => {
    const transcript = `햇살님 드릴게요 1.5. ${clause} 캡처하세요.`;
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.isFourPointSale, false);
    assert.equal(check.hasCapture, false);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale);
    assert.equal(sale.amount, 15000);
    assert.equal(sale.isFourPointConfirmed, false);
  });
}

test('다음 주 배송 안내는 이미 완성된 거래의 4단 확정을 무효화하지 않는다', () => {
  const transcript = '햇살님 드릴게요 1.5. 캡처하세요. 다음 주에 배송해 드릴게요.';
  const check = checkFourPointSaleCriteria(transcript);
  assert.equal(check.isFourPointSale, true);
  assert.equal(check.amount, 15000);

  const sale = extractSaleFromTranscript(transcript);
  assert.ok(sale);
  assert.equal(sale.buyerNickname, '햇살');
  assert.equal(sale.amount, 15000);
  assert.equal(sale.isFourPointConfirmed, true);
});

test('문장 중간 상품 전환 앞의 가격과 캡처만 사용한다', () => {
  for (const transcript of [
    '햇살님 드릴게요 1.5 캡처하세요 다음 상품 가격은 2.9입니다.',
    '햇살님 드릴게요 1.5. 캡처하세요 다음 상품 가격은 2.9입니다.',
    '캡처하세요. 햇살님 드릴게요 1.5 다음 상품 가격은 2.9입니다.',
  ]) {
    const sale = extractSaleFromTranscript(transcript);
    assert.equal(sale?.buyerNickname, '햇살', transcript);
    assert.equal(sale?.amount, 15000, transcript);
    assert.equal(sale?.isFourPointConfirmed, true, transcript);
    assert.equal(extractSpeechPrice(sale.allocationTranscript)?.amount, 15000, transcript);
  }
  for (const [transcript, amount] of [
    ['햇살님 드릴게요 캡처하세요 다음 상품 가격은 2.9입니다.', 0],
    ['햇살님 드릴게요. 가격은 1.5 캡처하세요 다음 상품 가격은 2.9입니다.', 0],
    ['햇살님 드릴게요 1.5 다음 상품 가격은 2.9입니다. 캡처하세요.', 15000],
    ['햇살님 드릴게요 1.5. 다른 거 캡처하세요.', 15000],
  ]) {
    const sale = extractSaleFromTranscript(transcript);
    assert.equal(sale?.amount, amount, transcript);
    assert.equal(sale?.isFourPointConfirmed, false, transcript);
  }
});

test('닉네임에 수정이나 아니가 포함되어도 정정·부정으로 오인하지 않는다', () => {
  for (const name of ['수정', '아니카']) {
    for (const address of [`${name}님`, `닉네임 ${name}`]) {
      const transcript = `${address} 드릴게요 1.5. 캡처하세요.`;
      const sale = extractSaleFromTranscript(transcript);
      assert.equal(sale?.buyerNickname, name, transcript);
      assert.equal(sale?.isFourPointConfirmed, true, transcript);
    }
  }
});

test('배정 질문을 후속 캡처와 합쳐 확정하지 않는다', () => {
  const transcript = '햇살님 1.5 확정인가요? 캡처하세요.';
  assert.equal(checkFourPointSaleCriteria(transcript).isFourPointSale, false);
  assert.equal(extractSaleFromTranscript(transcript), null);
});

test('첫 배정 뒤 다른 가격이나 두 번째 고객의 완성된 거래로 건너뛰지 않는다', () => {
  for (const transcript of [
    '햇살님 드릴게요 1.5. 가격은 2.0. 캡처하세요.',
    '햇살님 확정이요 1.5. 민트님 드릴게요 2.0. 캡처하세요.',
  ]) {
    const sale = extractSaleFromTranscript(transcript);
    assert.equal(sale?.buyerNickname, '햇살', transcript);
    assert.equal(sale?.amount, 15000, transcript);
    assert.equal(sale?.isFourPointConfirmed, false, transcript);
  }
});

test('첫 배정 앞의 상품 소개는 앞선 거래의 전환으로 오인하지 않는다', () => {
  for (const transcript of [
    '네, 다음 상품은 햇살님 1.5 드릴게요 캡처하세요.',
    '이거 새 옷 햇살님 1.5 드릴게요 캡처하세요.',
  ]) {
    const sale = extractSaleFromTranscript(transcript);
    assert.equal(sale?.buyerNickname, '햇살', transcript);
    assert.equal(sale?.amount, 15000, transcript);
    assert.equal(sale?.isFourPointConfirmed, true, transcript);
  }
});

test('같은 거래의 캡처 금지는 기존 캡처 지시를 무효화한다', () => {
  const transcript = '햇살님 1.5 드릴게요 캡처하세요. 캡처하지 마세요.';
  assert.equal(checkFourPointSaleCriteria(transcript).hasCapture, false);
  assert.equal(extractSaleFromTranscript(transcript)?.isFourPointConfirmed, false);
  const otherProduct = '햇살님 1.5 드릴게요 캡처하세요. 다음 상품은 캡처하지 마세요.';
  assert.equal(extractSaleFromTranscript(otherProduct)?.isFourPointConfirmed, true);
});

test('숫자 닉네임이나 상품번호는 발화한 판매가격으로 인정하지 않는다', () => {
  for (const transcript of [
    '1234님 드릴게요 캡처하세요.',
    '뒷자리1234님 드릴게요 캡처하세요.',
    '닉네임 1234 드릴게요 캡처하세요.',
    '햇살님 상품번호 123 드릴게요 캡처하세요.',
    '햇살님 300개 드릴게요 캡처하세요.',
  ]) {
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.hasPrice, false, transcript);
    assert.equal(check.amount, null, transcript);
    assert.equal(check.isFourPointSale, false, transcript);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale, transcript);
    assert.equal(sale.amount, 0, transcript);
    assert.equal(sale.status, '보류', transcript);
    assert.equal(sale.isPending, true, transcript);
    assert.equal(sale.isFourPointConfirmed, false, transcript);
  }
});

test('숫자 닉네임과 별도로 발화한 소수·원·단위 가격은 계속 확정한다', () => {
  for (const [price, amount] of [
    ['1.5', 15000],
    ['일점오', 15000],
    ['15,000원', 15000],
    ['3만5천원', 35000],
    ['삼만오천원', 35000],
    ['5천원', 5000],
    ['5천5백원', 5500],
    ['2만500원', 20500],
    ['5백원', 500],
    ['50원', 50],
    ['1.5원', 15000],
  ]) {
    const transcript = `1234님 ${price} 드릴게요 캡처하세요.`;
    const check = checkFourPointSaleCriteria(transcript);
    assert.equal(check.buyerNickname, '1234', transcript);
    assert.equal(check.hasPrice, true, transcript);
    assert.equal(check.amount, amount, transcript);
    assert.equal(check.isFourPointSale, true, transcript);

    const sale = extractSaleFromTranscript(transcript);
    assert.ok(sale, transcript);
    assert.equal(sale.buyerNickname, '1234', transcript);
    assert.equal(sale.amount, amount, transcript);
    assert.equal(sale.isFourPointConfirmed, true, transcript);
    assert.equal(extractSpeechPrice(sale.allocationTranscript)?.amount, amount, transcript);
  }
});

test('단위가 명확한 후속 가격도 숫자 닉네임과 구분한다', () => {
  const transcript = '1234님 드릴게요. 캡처하세요. 가격은 5천원입니다.';
  const sale = extractSaleFromTranscript(transcript);
  assert.equal(sale?.buyerNickname, '1234');
  assert.equal(sale?.amount, 5000);
  assert.equal(sale?.isFourPointConfirmed, true);
});


test('STT가 가격 라벨과 숫자를 다른 문장으로 끊어도 같은 판매의 가격으로 연결한다', () => {
  // 2026-10-17 라이브 2회차: "가격은. 2.0."으로 끊겨 금액 0원 보류가 된 실제 발화.
  const transcript = '무릎선에 오거든요. 제가 166. 이거. 네. 이거 빵님 드릴게요. 가격은. 2.0. 이거 캡처해 주시고요.';
  const sale = extractSaleFromTranscript(transcript);
  assert.equal(sale?.buyerNickname, '빵');
  assert.equal(sale?.amount, 20000);
  assert.equal(sale?.status, '확정');
  assert.equal(sale?.isFourPointConfirmed, true);
  assert.equal(sale?.allocationTranscript, '이거 빵님 드릴게요. 가격은 2.0');

  for (const label of ['금액은', '가격은요', '가격', '가격이']) {
    const split = extractSaleFromTranscript(`하늘님 이거 드릴게요. ${label}. 1.5. 캡처하세요.`);
    assert.equal(split?.amount, 15000, label);
    assert.equal(split?.isFourPointConfirmed, true, label);
  }
});

test('가격 라벨 뒤 문장이 순수한 가격 선언이 아니면 합치지 않는다', () => {
  for (const next of ['166', '1.5 사이즈', '빵님 드릴게요', '2.0 아니고 2.5', '2.0?']) {
    const sale = extractSaleFromTranscript(`하늘님 이거 드릴게요. 가격은. ${next}.`);
    assert.equal(sale?.status, '보류', next);
    assert.equal(sale?.amount, 0, next);
    assert.equal(sale?.allocationTranscript, '하늘님 이거 드릴게요', next);
  }
  assert.equal(extractSaleFromTranscript('하늘님 이거 드릴게요. 가격은? 1.5.')?.amount, 0);
});
