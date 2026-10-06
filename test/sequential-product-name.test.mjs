import test from 'node:test';
import assert from 'node:assert/strict';

export function formatSequentialProductName(productName, sequenceIndex, productCode) {
  if (!productName || typeof productName !== 'string') {
    return undefined;
  }

  const trimmed = productName.trim();
  if (!trimmed) {
    return undefined;
  }

  const targetIndex = sequenceIndex > 0 ? sequenceIndex : 1;

  // 1. 만약 8자리 날짜(YYYYMMDD)로 시작하는 경우 (예: '20261006-1회차'), 앞에 '001-'을 붙여 적용
  if (/^\d{8}(-\d+회차)?/.test(trimmed)) {
    const padded = String(targetIndex).padStart(3, '0');
    return `${padded}-${trimmed}`;
  }

  // 2. 숫자로 시작하는 경우 (예: '001-20261006-1회차', '01-데님자켓', '1번 상품')
  const match = trimmed.match(/^(\d+)(.*)$/);
  if (match) {
    const origDigits = match[1];
    const rest = match[2];
    const padLength = Math.max(origDigits.length, 3);
    const padded = String(targetIndex).padStart(padLength, '0');
    return `${padded}${rest}`;
  }

  return trimmed;
}

test('formatSequentialProductName: increments 001 prefix sequentially', () => {
  const baseName = '001-20261006-1회차';

  // 1번째 판매
  assert.equal(formatSequentialProductName(baseName, 1), '001-20261006-1회차');

  // 2번째 판매
  assert.equal(formatSequentialProductName(baseName, 2), '002-20261006-1회차');

  // 3번째 판매
  assert.equal(formatSequentialProductName(baseName, 3), '003-20261006-1회차');

  // 10번째 판매
  assert.equal(formatSequentialProductName(baseName, 10), '010-20261006-1회차');

  // 100번째 판매
  assert.equal(formatSequentialProductName(baseName, 100), '100-20261006-1회차');
});

test('formatSequentialProductName: handles various digit lengths and keeps 3-digit padding', () => {
  assert.equal(formatSequentialProductName('1-20261006-1회차', 1), '001-20261006-1회차');
  assert.equal(formatSequentialProductName('1-20261006-1회차', 2), '002-20261006-1회차');
  assert.equal(formatSequentialProductName('01-20261006-1회차', 5), '005-20261006-1회차');
  assert.equal(formatSequentialProductName('0001-20261006-1회차', 5), '0005-20261006-1회차');
});

test('formatSequentialProductName: handles pure session code date format', () => {
  assert.equal(formatSequentialProductName('20261006-1회차', 1), '001-20261006-1회차');
  assert.equal(formatSequentialProductName('20261006-1회차', 2), '002-20261006-1회차');
});

test('formatSequentialProductName: preserves non-numeric product names', () => {
  assert.equal(formatSequentialProductName('프리미엄 데님 자켓', 1), '프리미엄 데님 자켓');
  assert.equal(formatSequentialProductName('캐시미어 니트', 2), '캐시미어 니트');
});

test('formatSequentialProductName: handles null and undefined safely', () => {
  assert.equal(formatSequentialProductName(null, 1), undefined);
  assert.equal(formatSequentialProductName(undefined, 1), undefined);
  assert.equal(formatSequentialProductName('', 1), undefined);
});
