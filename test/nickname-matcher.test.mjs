import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareNicknames,
  areNicknamesSame,
  areNicknamesSimilar,
  extractPhoneSuffix4Digits,
  extractTrailing4Digits,
  transliterateEnglishToKorean,
  normalizeNickname
} from '../src/services/nicknameMatcher.ts';

test('정규화(normalizeNickname) - 님, 공백, 특수문자 제거 및 소문자 변환', () => {
  assert.equal(normalizeNickname('  @뒷번호 0517님  '), '뒷번호0517');
  assert.equal(normalizeNickname('mindset0517'), 'mindset0517');
  assert.equal(normalizeNickname('코맹님!'), '코맹');
  assert.equal(normalizeNickname(''), '');
});

test('전화번호 뒷번호 호칭 추출(extractPhoneSuffix4Digits)', () => {
  assert.equal(extractPhoneSuffix4Digits('뒷번호 0517님'), '0517');
  assert.equal(extractPhoneSuffix4Digits('끝번호 1234'), '1234');
  assert.equal(extractPhoneSuffix4Digits('전화번호 뒤 9876'), '9876');
  assert.equal(extractPhoneSuffix4Digits('뒷자리 4567'), '4567');
  assert.equal(extractPhoneSuffix4Digits('끝자리 0517번'), '0517');
  assert.equal(extractPhoneSuffix4Digits('0517님'), '0517');
  assert.equal(extractPhoneSuffix4Digits('마인드셋'), null);
});

test('닉네임 끝 4자리 숫자 추출(extractTrailing4Digits)', () => {
  assert.equal(extractTrailing4Digits('mindset0517'), '0517');
  assert.equal(extractTrailing4Digits('flower_9876'), '9876');
  assert.equal(extractTrailing4Digits('러블리1234님'), '1234');
  assert.equal(extractTrailing4Digits('코맹'), null);
  assert.equal(extractTrailing4Digits('test12'), null); // 2자리는 4자리가 아님
});

test('영문-한글 발음 변환(transliterateEnglishToKorean)', () => {
  assert.equal(transliterateEnglishToKorean('mindset'), '마인드셋');
  assert.equal(transliterateEnglishToKorean('lovely'), '러블리');
  assert.equal(transliterateEnglishToKorean('mintchoco'), '민트초코');
});

// =========================================================================
// 사용자 명시 규칙 1: "코맹"과 "코맹맹" 비교 (유사 닉네임 판단)
// =========================================================================
test('규칙 1: "코맹"과 "코맹맹" - 편집거리 1, 반복 글자, 포함 관계로 유사함(SIMILAR) 판정', () => {
  const result = compareNicknames('코맹', '코맹맹');
  assert.equal(result.isSimilar, true, '코맹과 코맹맹은 유사해야 함');
  assert.ok(result.score >= 85, `유사도 점수는 85점 이상이어야 함 (실제: ${result.score})`);
  assert.equal(result.reason, 'REPEATED_TRAILING_CHAR');

  // 역방향 비교도 동일
  const reverseResult = compareNicknames('코맹맹', '코맹');
  assert.equal(reverseResult.isSimilar, true);
  assert.ok(reverseResult.score >= 85);

  // areNicknamesSimilar 헬퍼 함수 검증
  assert.equal(areNicknamesSimilar('코맹', '코맹맹'), true);
  assert.equal(areNicknamesSimilar('코맹님', '코맹맹'), true);
});

test('규칙 1: 마지막 글자 반복 및 편집거리 1 다양한 변형 검증', () => {
  // 끝 글자 반복
  assert.equal(areNicknamesSimilar('러블리', '러블리리'), true);
  assert.equal(areNicknamesSimilar('달콤', '달콤콤'), true);

  // 편집 거리 1
  assert.equal(areNicknamesSimilar('하늘이', '하늘'), true);
  assert.equal(areNicknamesSimilar('꽃길', '꽃길만'), true);
});

// =========================================================================
// 사용자 명시 규칙 2: “mindset0517”과 “마인드셋” 비교 (영문-한글 발음 + 숫자 분리)
// =========================================================================
test('규칙 2: "mindset0517"과 "마인드셋" - 숫자 분리 및 영문-한글 발음 변환으로 매우 유사함(PHONETIC_EXACT) 판정', () => {
  const result = compareNicknames('mindset0517', '마인드셋');
  assert.equal(result.isSimilar, true, 'mindset0517과 마인드셋은 유사해야 함');
  assert.equal(result.reason, 'PHONETIC_EXACT');
  assert.ok(result.score >= 95, `점수는 95점 이상이어야 함 (실제: ${result.score})`);

  // 역방향 비교 (마인드셋 vs mindset0517)
  const reverseResult = compareNicknames('마인드셋', 'mindset0517');
  assert.equal(reverseResult.isSimilar, true);
  assert.equal(reverseResult.reason, 'PHONETIC_EXACT');
  assert.ok(reverseResult.score >= 95);

  // areNicknamesSimilar 헬퍼 함수 검증
  assert.equal(areNicknamesSimilar('mindset0517', '마인드셋'), true);
  assert.equal(areNicknamesSimilar('마인드셋님', 'mindset0517'), true);
});

test('규칙 2: 다양한 영문-한글 닉네임 발음 매칭 검증', () => {
  assert.equal(areNicknamesSimilar('lovely1004', '러블리'), true);
  assert.equal(areNicknamesSimilar('mintchoco99', '민트초코'), true);
  assert.equal(areNicknamesSimilar('pinkstar_12', '핑크스타'), true);
});

// =========================================================================
// 사용자 명시 규칙 3: "뒷번호 0517님"과 "mindset0517" 비교 (같은 닉네임 확정)
// =========================================================================
test('규칙 3: "뒷번호 0517님"과 "mindset0517" - 4자리 식별자 일치로 같은 닉네임(동일인) 확정 판정', () => {
  const result = compareNicknames('뒷번호 0517님', 'mindset0517');
  assert.equal(result.isSame, true, '뒷번호 0517님과 mindset0517은 같은 닉네임으로 확정되어야 함');
  assert.equal(result.isSimilar, true);
  assert.equal(result.score, 100, '확정 매칭은 100점이어야 함');
  assert.equal(result.reason, 'SUFFIX_CONFIRMED');
  assert.equal(result.matchedSuffixDigits, '0517');

  // 역방향 비교 (mindset0517 vs 뒷번호 0517님)
  const reverseResult = compareNicknames('mindset0517', '뒷번호 0517님');
  assert.equal(reverseResult.isSame, true);
  assert.equal(reverseResult.reason, 'SUFFIX_CONFIRMED');
  assert.equal(reverseResult.matchedSuffixDigits, '0517');

  // areNicknamesSame 헬퍼 함수 검증
  assert.equal(areNicknamesSame('뒷번호 0517님', 'mindset0517'), true);
  assert.equal(areNicknamesSame('mindset0517', '뒷번호 0517님'), true);
});

test('규칙 3: 끝번호/전화번호 뒤 등 다양한 호칭 표현 및 4자리 매칭 검증', () => {
  assert.equal(areNicknamesSame('끝번호 1234', '꽃길1234'), true);
  assert.equal(areNicknamesSame('전화번호 뒤 9876님', 'user_9876'), true);
  assert.equal(areNicknamesSame('뒷자리 3321', '달콤3321'), true);
  assert.equal(areNicknamesSame('0517님', 'mindset0517'), true);

  // 불일치 케이스: 4자리 숫자가 다르면 확정되면 안 됨
  const diff = compareNicknames('뒷번호 0517님', 'mindset9999');
  assert.equal(diff.isSame, false, '식별자가 다르면 isSame은 false여야 함');
});
