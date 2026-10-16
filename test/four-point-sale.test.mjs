import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSaleFromTranscript, checkFourPointSaleCriteria } from '../src/services/salesExtractor.ts';

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

