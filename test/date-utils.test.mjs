import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeKST, formatDateTimeKST } from '../src/utils/dateUtils.ts';

test('formatTimeKST converts UTC ISO timestamps to KST HH:mm:ss', () => {
  // 14:04:40 UTC -> 23:04:40 KST (+9 hours)
  assert.equal(formatTimeKST('2026-10-06T14:04:40.000Z'), '23:04:40');
  // 13:59:20 UTC -> 22:59:20 KST
  assert.equal(formatTimeKST('2026-10-06T13:59:20.000Z'), '22:59:20');
  // 13:50:22 UTC -> 22:50:22 KST
  assert.equal(formatTimeKST('2026-10-06T13:50:22.000Z'), '22:50:22');
  // 날짜 경계: 15:00:00 UTC -> 00:00:00 KST
  assert.equal(formatTimeKST('2026-10-06T15:00:00.000Z'), '00:00:00');
  // 빈 값 및 비정상 값
  assert.equal(formatTimeKST(null), '-');
  assert.equal(formatTimeKST(''), '-');
  assert.equal(formatTimeKST('invalid-date'), '-');
});

test('formatDateTimeKST converts UTC ISO timestamps to KST YYYY-MM-DD HH:mm:ss', () => {
  assert.equal(formatDateTimeKST('2026-10-06T14:04:40.000Z'), '2026-10-06 23:04:40');
  // 날짜가 다음날로 넘어가는 경우
  assert.equal(formatDateTimeKST('2026-10-06T15:30:00.000Z'), '2026-10-07 00:30:00');
  // 빈 값 및 비정상 값
  assert.equal(formatDateTimeKST(null), '-');
  assert.equal(formatDateTimeKST(''), '-');
  assert.equal(formatDateTimeKST('invalid-date'), '-');
});
