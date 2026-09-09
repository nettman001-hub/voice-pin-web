import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareNicknames,
  matchNicknameAgainstCandidates,
  generateNicknameAliases,
  spellEnglishToKorean,
  parseSpelledKoreanToEnglish,
  convertDigitsToKoreanPronunciations,
  parseKoreanDigitsToNumber,
  detectPositionExpression,
  cleanHonorificsAndGuides
} from '../src/services/nicknameMatcher.ts';

// =========================================================================
// 필수 테스트 1: gieblsmdi ↔ 지아이이비엘에스엠디아이 (전체 영문 철자 발음)
// =========================================================================
test('필수 1: gieblsmdi ↔ 지아이이비엘에스엠디아이 (spelled-pronunciation)', () => {
  const result = compareNicknames('gieblsmdi', '지아이이비엘에스엠디아이');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'spelled-pronunciation');
  assert.ok(result.score >= 98);

  const candidateMatch = matchNicknameAgainstCandidates('지아이이비엘에스엠디아이', ['gieblsmdi', 'other123']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.ambiguous, false);
  assert.equal(candidateMatch.matchedNickname, 'gieblsmdi');
  assert.equal(candidateMatch.matchType, 'spelled-pronunciation');
});

// =========================================================================
// 필수 테스트 2: gieblsmdi ↔ 뒷자리 에스엠디아이 (접미부 철자 발음)
// =========================================================================
test('필수 2: gieblsmdi ↔ 뒷자리 에스엠디아이 (suffix)', () => {
  const result = compareNicknames('gieblsmdi', '뒷자리 에스엠디아이');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'suffix');
  assert.ok(result.score >= 94);

  const candidateMatch = matchNicknameAgainstCandidates('뒷자리 에스엠디아이', ['gieblsmdi']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.ambiguous, false);
  assert.equal(candidateMatch.matchedNickname, 'gieblsmdi');
  assert.equal(candidateMatch.matchType, 'suffix');
});

// =========================================================================
// 필수 테스트 3: gieblsmdi ↔ 끝번호 smdi (접미부 영문 철자)
// =========================================================================
test('필수 3: gieblsmdi ↔ 끝번호 smdi (suffix)', () => {
  const result = compareNicknames('gieblsmdi', '끝번호 smdi');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'suffix');
  assert.ok(result.score >= 94);

  const candidateMatch = matchNicknameAgainstCandidates('끝번호 smdi', ['gieblsmdi']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'gieblsmdi');
  assert.equal(candidateMatch.matchType, 'suffix');
});

// =========================================================================
// 필수 테스트 4: gieblsmdi ↔ 앞자리 지아이이 (접두부 철자 발음)
// =========================================================================
test('필수 4: gieblsmdi ↔ 앞자리 지아이이 (prefix)', () => {
  const result = compareNicknames('gieblsmdi', '앞자리 지아이이');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'prefix');
  assert.ok(result.score >= 94);

  const candidateMatch = matchNicknameAgainstCandidates('앞자리 지아이이', ['gieblsmdi']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'gieblsmdi');
  assert.equal(candidateMatch.matchType, 'prefix');
});

// =========================================================================
// 필수 테스트 5: gie0517 ↔ 지아이이공오일칠 (철자 + 숫자 한자리씩 발음)
// =========================================================================
test('필수 5: gie0517 ↔ 지아이이공오일칠 (spelled-pronunciation 또는 numeric)', () => {
  const result = compareNicknames('gie0517', '지아이이공오일칠');
  assert.equal(result.isSame, true);
  assert.ok(result.matchType === 'spelled-pronunciation' || result.matchType === 'numeric');
  assert.ok(result.score >= 90);

  const candidateMatch = matchNicknameAgainstCandidates('지아이이공오일칠', ['gie0517']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'gie0517');
});

// =========================================================================
// 필수 테스트 6: gie0517 ↔ 뒷번호 0517님 (접미부 숫자 + 호칭)
// =========================================================================
test('필수 6: gie0517 ↔ 뒷번호 0517님 (suffix)', () => {
  const result = compareNicknames('gie0517', '뒷번호 0517님');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'suffix');
  assert.ok(result.score >= 94);

  const candidateMatch = matchNicknameAgainstCandidates('뒷번호 0517님', ['gie0517']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'gie0517');
});

// =========================================================================
// 필수 테스트 7: mindset0517 ↔ 마인드셋 (단어 음역 발음)
// =========================================================================
test('필수 7: mindset0517 ↔ 마인드셋 (word-pronunciation)', () => {
  const result = compareNicknames('mindset0517', '마인드셋');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'word-pronunciation');
  assert.ok(result.score >= 96);

  const candidateMatch = matchNicknameAgainstCandidates('마인드셋', ['mindset0517']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'mindset0517');
  assert.equal(candidateMatch.matchType, 'word-pronunciation');
});

// =========================================================================
// 필수 테스트 8: mindset0517 ↔ 뒷번호 공오일칠 (접미부 한글 숫자 발음)
// =========================================================================
test('필수 8: mindset0517 ↔ 뒷번호 공오일칠 (suffix)', () => {
  const result = compareNicknames('mindset0517', '뒷번호 공오일칠');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'suffix');
  assert.ok(result.score >= 94);

  const candidateMatch = matchNicknameAgainstCandidates('뒷번호 공오일칠', ['mindset0517']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'mindset0517');
});

// =========================================================================
// 필수 테스트 9: mindset0517 ↔ 엠아이엔디에스이티공오일칠 (철자 + 숫자 전체 발음)
// =========================================================================
test('필수 9: mindset0517 ↔ 엠아이엔디에스이티공오일칠 (spelled-pronunciation)', () => {
  const result = compareNicknames('mindset0517', '엠아이엔디에스이티공오일칠');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'spelled-pronunciation');
  assert.ok(result.score >= 98);

  const candidateMatch = matchNicknameAgainstCandidates('엠아이엔디에스이티공오일칠', ['mindset0517']);
  assert.equal(candidateMatch.matched, true);
  assert.equal(candidateMatch.matchedNickname, 'mindset0517');
});

// =========================================================================
// 필수 테스트 10: 코맹 ↔ 코맹맹 (유사 후보로 판단하되 정확 일치는 아님)
// =========================================================================
test('필수 10: 코맹 ↔ 코맹맹 (유사 후보 판정, 정확 일치 아님)', () => {
  const result = compareNicknames('코맹', '코맹맹');
  assert.equal(result.isSame, false, '정확 일치는 아니어야 함');
  assert.equal(result.isSimilar, true, '유사 후보로 판단되어야 함');
  assert.equal(result.matchType, 'fuzzy');
  assert.ok(result.score >= 80 && result.score < 94);
});

// =========================================================================
// 필수 테스트 11: abc0517, xyz0517 ↔ 뒷번호 0517 (ambiguous, 자동 확정 금지)
// =========================================================================
test('필수 11: abc0517, xyz0517 ↔ 뒷번호 0517 (ambiguous: true, 자동 확정 금지)', () => {
  const match = matchNicknameAgainstCandidates('뒷번호 0517', ['abc0517', 'xyz0517']);
  assert.equal(match.matched, false, '중복 후보 존재 시 자동 확정 금지');
  assert.equal(match.ambiguous, true, 'ambiguous는 true여야 함');
  assert.equal(match.matchType, 'suffix');
  assert.ok(match.candidates && match.candidates.length === 2);
  assert.ok(match.candidates.includes('abc0517'));
  assert.ok(match.candidates.includes('xyz0517'));
});

// =========================================================================
// 필수 테스트 12: gieblsmdi, testsmdi ↔ 뒷자리 에스엠디아이 (ambiguous, 자동 확정 금지)
// =========================================================================
test('필수 12: gieblsmdi, testsmdi ↔ 뒷자리 에스엠디아이 (ambiguous: true, 자동 확정 금지)', () => {
  const match = matchNicknameAgainstCandidates('뒷자리 에스엠디아이', ['gieblsmdi', 'testsmdi']);
  assert.equal(match.matched, false, '중복 후보 존재 시 자동 확정 금지');
  assert.equal(match.ambiguous, true, 'ambiguous는 true여야 함');
  assert.equal(match.matchType, 'suffix');
  assert.ok(match.candidates && match.candidates.length === 2);
  assert.ok(match.candidates.includes('gieblsmdi'));
  assert.ok(match.candidates.includes('testsmdi'));
});

// =========================================================================
// 추가 테스트 13: 영문 대소문자 무관 비교
// =========================================================================
test('추가 13: 영문 대소문자 무관 (GieBlSmdi ↔ 지아이이비엘에스엠디아이)', () => {
  const result = compareNicknames('GieBlSmdi', '지아이이비엘에스엠디아이');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'spelled-pronunciation');
});

// =========================================================================
// 추가 테스트 14: 공백 포함 여부 무관 비교
// =========================================================================
test('추가 14: 공백 무관 (gie bl smdi ↔ 지아이이 비엘 에스엠 디아이)', () => {
  const result = compareNicknames('gie bl smdi', '지아이이 비엘 에스엠 디아이');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'spelled-pronunciation');
});

// =========================================================================
// 추가 테스트 15: 하이픈 및 밑줄 포함 여부 무관
// =========================================================================
test('추가 15: 하이픈 및 밑줄 무관 (gie_bl-smdi ↔ 지아이이비엘에스엠디아이)', () => {
  const result = compareNicknames('gie_bl-smdi', '지아이이비엘에스엠디아이');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'spelled-pronunciation');
});

// =========================================================================
// 추가 테스트 16: 호칭(회원님, 고객님 등) 포함 여부
// =========================================================================
test('추가 16: 님/회원님/고객님 포함 여부 (mindset0517 회원님 ↔ 마인드셋 고객님)', () => {
  const result = compareNicknames('mindset0517 회원님', '마인드셋 고객님');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'word-pronunciation');
});

// =========================================================================
// 추가 테스트 17: 숫자 0을 영, 공, 제로로 읽는 경우
// =========================================================================
test('추가 17: 숫자 0의 다양한 발음 (영, 공, 제로)', () => {
  assert.equal(compareNicknames('gie0517', '뒷번호 제로오일칠').isSame, true);
  assert.equal(compareNicknames('gie0517', '뒷번호 영오일칠').isSame, true);
  assert.equal(compareNicknames('gie0517', '뒷번호 공오일칠').isSame, true);
});

// =========================================================================
// 추가 테스트 18: 영문과 숫자가 섞인 닉네임 단어 음역
// =========================================================================
test('추가 18: 영문-숫자 혼합 닉네임 음역 (pinkstar77 ↔ 핑크스타)', () => {
  const result = compareNicknames('pinkstar77', '핑크스타');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'word-pronunciation');
});

// =========================================================================
// 추가 테스트 19: 짧은 접미부가 여러 후보에 중복되는 경우
// =========================================================================
test('추가 19: 짧은 접미부 중복 (abc1, xyz1 ↔ 끝자리 1)', () => {
  const match = matchNicknameAgainstCandidates('끝자리 1', ['abc1', 'xyz1']);
  assert.equal(match.matched, false);
  assert.equal(match.ambiguous, true);
});

// =========================================================================
// 추가 테스트 20: 음성인식 결과에 불필요한 공백이 들어간 경우
// =========================================================================
test('추가 20: STT 불필요 공백 (뒷 자리   에스 엠 디아이 ↔ gieblsmdi)', () => {
  const result = compareNicknames('뒷 자리   에스 엠 디아이', 'gieblsmdi');
  assert.equal(result.isSame, true);
  assert.equal(result.matchType, 'suffix');
});

// =========================================================================
// 별칭 생성 구조(generateNicknameAliases) 테스트
// =========================================================================
test('별칭 생성 구조(generateNicknameAliases) 검증', () => {
  const aliases = generateNicknameAliases('mindset0517');
  assert.equal(aliases.original, 'mindset0517');
  assert.equal(aliases.normalized, 'mindset0517');
  assert.ok(aliases.spelledPronunciations.includes('엠아이엔디에스이티'));
  assert.ok(aliases.wordPronunciations.includes('마인드셋'));
  assert.ok(aliases.numericPronunciations.includes('0517'));
  assert.ok(aliases.numericPronunciations.includes('공오일칠'));
  assert.ok(aliases.combinedPronunciations.includes('마인드셋0517'));
  assert.ok(aliases.combinedPronunciations.includes('마인드셋공오일칠'));
});
