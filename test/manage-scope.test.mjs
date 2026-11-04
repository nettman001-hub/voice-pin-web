import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManageSessions, latestManageSessionId, selectedManageSessionIds, selectManageSales,
  normalizeManageScope, withManageScope, manageScopeLabel,
} from '../src/services/manage/scope.ts';

const now = new Date('2026-11-04T12:00:00+09:00');
const session = (id, startedAt, status = 'ENDED') => ({ id, startedAt, status, displayCode: `${id} 표시명` });
const sale = (id, sessionId, recognizedAt) => ({ id, sessionId, recognizedAt, buyerNickname: '구매자', amount: 10000, status: '확정', rawTranscript: '' });

test('session selection keeps all sales of an overnight broadcast together', () => {
  const sessions = [session('night', '2026-11-03T22:00:00+09:00'), session('morning', '2026-11-04T09:00:00+09:00')];
  const sales = [sale('before', 'night', '2026-11-03T23:30:00+09:00'), sale('after', 'night', '2026-11-04T00:30:00+09:00'), sale('new', 'morning', '2026-11-04T10:00:00+09:00')];
  assert.deepEqual(selectManageSales(sales, sessions, { mode: 'session', sessionId: 'night' }, now).map((item) => item.id), ['before', 'after']);
  assert.deepEqual(selectManageSales(sales, sessions, { mode: 'period', periodDays: 1 }, now).map((item) => item.id), ['new']);
  assert.deepEqual(selectManageSales(sales, sessions, { mode: 'period', periodDays: 7 }, now).map((item) => item.id), ['before', 'after', 'new']);
});

test('today uses Korean midnight and includes every broadcast started that day', () => {
  const sessions = [session('before', '2026-11-03T14:59:59Z'), session('midnight', '2026-11-03T15:00:00Z'), session('later', '2026-11-04T01:00:00Z'), session('future', '2026-11-04T13:00:00+09:00')];
  assert.deepEqual([...selectedManageSessionIds({ mode: 'period', periodDays: 1 }, sessions, now)], ['midnight', 'later']);
  assert.deepEqual([...selectedManageSessionIds({ mode: 'session', sessionId: 'ALL' }, sessions, now)], ['before', 'midnight', 'later']);
  assert.equal(selectedManageSessionIds({ mode: 'session', sessionId: 'future' }, sessions, now).size, 0);
});

test('7 and 30 calendar days include today and use broadcast start, not individual sales', () => {
  const sessions = [session('oct5', '2026-10-05T23:59:59+09:00'), session('oct6', '2026-10-06T00:00:00+09:00'), session('oct28', '2026-10-28T23:59:59+09:00'), session('oct29', '2026-10-29T00:00:00+09:00')];
  assert.deepEqual([...selectedManageSessionIds({ mode: 'period', periodDays: 7 }, sessions, now)], ['oct29']);
  assert.deepEqual([...selectedManageSessionIds({ mode: 'period', periodDays: 30 }, sessions, now)], ['oct6', 'oct28', 'oct29']);
  assert.equal(selectedManageSessionIds({ mode: 'period', periodDays: 0 }, sessions, now).size, 4);
});

test('default is the active broadcast, otherwise the most recently started one', () => {
  const sessions = [session('old-active', '2026-11-02T20:00:00+09:00', 'ACTIVE'), session('recent-ended', '2026-11-04T10:00:00+09:00')];
  assert.equal(latestManageSessionId(sessions), 'old-active');
  assert.deepEqual([...selectedManageSessionIds({ mode: 'session', sessionId: 'LATEST' }, sessions, now)], ['old-active']);
  assert.equal(latestManageSessionId(sessions.map((item) => ({ ...item, status: 'ENDED' }))), 'recent-ended');
  assert.equal(latestManageSessionId([]), null);
  assert.equal(selectedManageSessionIds({ mode: 'session', sessionId: 'LATEST' }, [], now).size, 0);
});

test('legacy sessions use the earliest sale, preserve IDs, and never override server start metadata', () => {
  const sales = [sale('later', 'legacy-1', '2026-11-04T01:00:00+09:00'), sale('first', 'legacy-1', '2026-11-03T22:00:00+09:00'), sale('real', 'server', '2026-11-04T10:00:00+09:00')];
  const available = buildManageSessions([session('server', '2026-11-03T20:00:00+09:00', 'ACTIVE')], sales);
  const legacy = available.find((item) => item.id === 'legacy-1');
  assert.equal(legacy.startedAt, '2026-11-03T22:00:00+09:00');
  assert.equal(legacy.estimated, true);
  assert.match(legacy.displayCode, /^2026-11-03 22:00/);
  assert.equal(available.find((item) => item.id === 'server').startedAt, '2026-11-03T20:00:00+09:00');
  assert.equal(available[0].id, 'legacy-1');
  assert.equal(selectManageSales(sales, available, { mode: 'period', periodDays: 1 }, now).length, 0);
  assert.deepEqual([...selectedManageSessionIds({ mode: 'session', sessionId: 'missing-old-id' }, [], now)], ['missing-old-id']);
});

test('invalid legacy timestamps stay available in all sessions but cannot enter a dated scope', () => {
  const sales = [sale('bad-date', 'legacy-invalid', 'invalid')];
  const available = buildManageSessions([], sales);
  assert.equal(available.length, 1);
  assert.equal(available[0].id, 'legacy-invalid');
  assert.equal(selectManageSales(sales, available, { mode: 'session', sessionId: 'ALL' }, now).length, 1);
  assert.equal(selectManageSales(sales, available, { mode: 'period', periodDays: 1 }, now).length, 0);
});

test('scope URLs keep status filters and hash while selecting only one query mode', () => {
  const sessionPath = withManageScope('/manage/orders?stage=READY_TO_BILL&period=7#buyer', { mode: 'session', sessionId: '회차 A' });
  const sessionUrl = new URL(sessionPath, 'https://voicecap.shop');
  assert.equal(sessionUrl.searchParams.get('session'), '회차 A');
  assert.equal(sessionUrl.searchParams.has('period'), false);
  assert.equal(sessionUrl.searchParams.get('stage'), 'READY_TO_BILL');
  assert.equal(sessionUrl.hash, '#buyer');
  assert.equal(withManageScope('/manage/ship?filter=refund&session=old', { mode: 'period', periodDays: 30 }), '/manage/ship?filter=refund&period=30');
});

test('server scope validation rejects invalid modes, session IDs, and periods', () => {
  assert.deepEqual(normalizeManageScope({ mode: 'session', sessionId: ' LATEST ' }), { mode: 'session', sessionId: 'LATEST' });
  assert.deepEqual(normalizeManageScope({ mode: 'period', periodDays: 0 }), { mode: 'period', periodDays: 0 });
  for (const input of [null, undefined, [], 'LATEST', {}, { mode: 'invalid' }, { mode: 'session', sessionId: '' }, { mode: 'session', sessionId: 'a'.repeat(201) }, { mode: 'period', periodDays: '7' }, { mode: 'period', periodDays: 2 }, { mode: 'period', periodDays: Infinity }, { mode: 'period', periodDays: -1 }]) assert.equal(normalizeManageScope(input), null);
  assert.equal(manageScopeLabel({ mode: 'session', sessionId: 'ALL' }, []), '전체 방송 회차');
  assert.equal(manageScopeLabel({ mode: 'session', sessionId: 'LATEST' }, []), '최근 방송 회차 없음');
  assert.equal(manageScopeLabel({ mode: 'period', periodDays: 1 }, []), '오늘 시작한 방송');
});
