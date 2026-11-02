const assert = require('node:assert/strict');
const test = require('node:test');
const { androidView } = require('./androidCard.js');

const now = Date.parse('2026-11-03T10:00:00Z');

test('안드로이드 카드: 미등록이면 계정 연결 버튼만, 스위치는 잠김', () => {
  const v = androidView({ registered: false, enabled: false, delivery: { key: 'unregistered', label: '판매자 계정 미등록' } }, now);
  assert.equal(v.registered, false);
  assert.equal(v.canToggle, false);
  assert.equal(v.statusLabel, '판매자 계정 미등록');
  assert.equal(v.tone, 'idle');
});

test('안드로이드 카드: 인증번호 남은 시간, 승인 요청, 연결된 폰과 미전송을 보여 준다', () => {
  const v = androidView({
    registered: true, enabled: true, workspaceName: '꽃가게', helperName: '사무실 PC',
    delivery: { key: 'delivering', label: '전달 중' },
    pairCode: { code: '123456', expiresAt: '2026-11-03T10:02:05Z' },
    pendingRequests: [{ id: 'l1', phoneName: 'Galaxy', userEmail: 'a@x.kr', requestedAt: '2026-11-03T09:59:00Z', expiresAt: '2026-11-03T10:04:00Z' }],
    link: { id: 'l0', phoneName: 'Old', lastSeenAt: '2026-11-03T09:59:59Z' },
    sessionId: 'abcdef12-0000-0000-0000-000000000000', tiktokId: 'flower', pending: 1234, dropped: 3, queueError: '',
  }, now);
  assert.equal(v.account, '꽃가게 · 사무실 PC');
  assert.equal(v.pairLeft, '2:05 남음');
  assert.equal(v.requests[0].title, 'Galaxy');
  assert.match(v.requests[0].detail, /a@x.kr/);
  assert.equal(v.phone.name, 'Old');
  assert.equal(v.tiktok, '@flower');
  assert.equal(v.pending, '1,234건');
  assert.equal(v.dropped, 3);
  assert.equal(v.tone, 'collecting');
});

test('안드로이드 카드: 오류와 끊김은 오류 색으로, 대기열 오류를 우선 표시', () => {
  const v = androidView({ registered: true, enabled: true, delivery: { key: 'offline', label: '서버 연결 끊김' }, queueError: '대기열 저장 실패: 디스크', lastError: 'x' }, now);
  assert.equal(v.tone, 'error');
  assert.equal(v.error, '대기열 저장 실패: 디스크');
});
