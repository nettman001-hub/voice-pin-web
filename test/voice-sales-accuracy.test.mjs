import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSaleFromTranscript } from '../src/services/salesExtractor.ts';
import { extractSpeechPrice } from '../src/services/priceEvidence.ts';

test('구매 미발생 호스트 가격 안내 발화는 판매로 적재되지 않아야 함 (null 반환)', () => {
  const negatives = [
    '장 112, 가격 35,000원인데 오늘 25,000원에 드릴게요. 롱 가디건, 이렇게. 저처럼 정장 위에다가 이렇게 입으셔도',
    '로 보여드릴 수도 있는데, 일단 가격은 그냥. 1.2에 해드릴게요. 구매 가격이 2.7이었는데,. 이렇게 완전 블랙이고요.',
    '70. 가단 54, 총장. 77. 저희 가격 1.0에 해드릴게요.',
    '단 55, 총장 50, 가격 1.8인데, 오늘 1.2에 해드릴게요. 여리여리 사랑. 스러운 니트, 1.2.'
  ];

  for (const utterance of negatives) {
    const result = extractSaleFromTranscript(utterance);
    assert.equal(result, null, `판매로 오탐 적재되지 않아야 함: ${utterance}`);
  }
});

test('구매 확정 발화에서 구매자 닉네임과 금액이 정확하게 추출되어야 함', () => {
  // 1. 소수점 뒤 띄어쓰기(0. 8) 및 닉네임 빙그레
  const s1 = '얘 브라운 컬러고. 이 아이 0.8이요. 그 밑에 빙그레님 드릴게요, 가격은 0. 8. 밑에 스트링도 있어요. 이거 1.0 할 줄';
  const r1 = extractSaleFromTranscript(s1);
  assert.ok(r1, 's1 추출 성공');
  assert.equal(r1.buyerNickname, '빙그레');
  assert.equal(r1.amount, 8000);
  assert.equal(r1.status, '자동저장');
  assert.equal(r1.intent, 'ALLOCATION');

  // 2. 넹넹님 0.4 (4,000원)
  const s2 = '스트링인 줄 알았네. 이렇게 단이 있어서. 네, 넹넹님. 드릴게요. 가격은 0.4';
  const r2 = extractSaleFromTranscript(s2);
  assert.ok(r2, 's2 추출 성공');
  assert.equal(r2.buyerNickname, '넹넹');
  assert.equal(r2.amount, 4000);
  assert.equal(r2.status, '자동저장');

  // 3. 홍시몽이님 (문장에 금액 없음 -> 금액 미인식 보류 상태로 보존)
  const s3 = '예쁘게 입어주시면 됩니다. 감사합니다. 이거 홍시몽이님 드릴게요. 여기 010-5855-5668 전화번호로 지금.';
  const r3 = extractSaleFromTranscript(s3);
  assert.ok(r3, 's3 추출 성공');
  assert.equal(r3.buyerNickname, '홍시몽이');
  assert.equal(r3.amount, 0);
  assert.equal(r3.status, '보류');

  // 4. 션솨님 0.4 캡처
  const s4 = '고 총장 60. 이 아이 0.4. 이렇게. 네. 션솨님. 닉네임 션솨님. 이거 0.4. 캡처. 네. 감사합니다.';
  const r4 = extractSaleFromTranscript(s4);
  assert.ok(r4, 's4 추출 성공');
  assert.equal(r4.buyerNickname, '션솨');
  assert.equal(r4.amount, 4000);
  assert.equal(r4.status, '자동저장');

  // 5. 빙그레님 0.3 캡처
  const s5 = '이렇게 입으시면. 돼요. 빙그레 언니가 먼저 하셨네요. 닉네임 빙그레님. 이거 캡처해주시고, 금액은 0.3.';
  const r5 = extractSaleFromTranscript(s5);
  assert.ok(r5, 's5 추출 성공');
  assert.equal(r5.buyerNickname, '빙그레');
  assert.equal(r5.amount, 3000);
  assert.equal(r5.status, '자동저장');
});

test('소수점 뒤 마침표 및 띄어쓰기 금액 인식 검증', () => {
  assert.deepEqual(extractSpeechPrice('이거 0.4. 캡처'), { quote: '0.4', amount: 4000, notation: 'DECIMAL_MAN' });
  assert.deepEqual(extractSpeechPrice('금액은 0.3.'), { quote: '0.3', amount: 3000, notation: 'DECIMAL_MAN' });
  assert.deepEqual(extractSpeechPrice('가격은 0. 8.'), { quote: '0. 8', amount: 8000, notation: 'DECIMAL_MAN' });
  // 전화번호는 가격으로 오인되지 않아야 함
  assert.equal(extractSpeechPrice('전화번호 010-5855-5668'), null);
});
