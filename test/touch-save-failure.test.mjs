import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTouchSaveFailure } from '../src/services/touchSaveFailure.ts';

test('database rejection stays retryable and explains the pending server save, without exposing database details', () => {
  const failure = classifyTouchSaveFailure(Object.assign(new Error('column "buyer_id" is ambiguous'), {
    code: 'DATABASE_ERROR',
  }));
  assert.equal(failure.kind, 'SERVER');
  assert.equal(failure.blocked, false);
  assert.match(failure.message, /서버 오류/);
  assert.match(failure.message, /자동으로 다시 시도/);
  assert.match(failure.message, /판매내역/);
  assert.doesNotMatch(failure.message, /인터넷|연결이 복구|buyer_id|전표 출력 중/);
  assert.equal(failure.detail, 'column "buyer_id" is ambiguous');
});

test('authentication and permission failures ask for account recovery instead of blaming the network', () => {
  for (const code of ['AUTH_REQUIRED', 'CAPABILITY_DENIED']) {
    const failure = classifyTouchSaveFailure({ code, message: 'Failed to fetch' });
    assert.equal(failure.kind, 'AUTH');
    assert.equal(failure.blocked, false, 'a repaired session can retry the same queued operation');
    assert.match(failure.message, /로그인|권한/);
    assert.match(failure.message, /판매내역/);
    assert.doesNotMatch(failure.message, /인터넷|연결이 복구/);
  }
});

test('only recognized transport failures receive a reconnect explanation', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    new Error('Failed to send a request to the Edge Function'),
    { code: 'NETWORK_ERROR', message: 'connection interrupted' },
  ]) {
    const failure = classifyTouchSaveFailure(error);
    assert.equal(failure.kind, 'NETWORK');
    assert.equal(failure.blocked, false);
    assert.match(failure.message, /연결이 복구되면 자동으로/);
  }
  const unknown = classifyTouchSaveFailure(new Error('unrecognized failure'));
  assert.equal(unknown.kind, 'UNKNOWN');
  assert.doesNotMatch(unknown.message, /인터넷|연결이 복구/);
});

test('server errors take precedence over transport-like error text', () => {
  const failure = classifyTouchSaveFailure({ code: 'DATABASE_ERROR', message: 'network timeout' });
  assert.equal(failure.kind, 'SERVER');
  assert.equal(failure.blocked, false);
});

test('permanent operation and comment conflicts require review consistently on first submission and retry', () => {
  for (const code of [
    'COMMENT_ALREADY_COMMITTED', 'SESSION_ENDED', 'TOUCH_NOT_RUNNING', 'VALIDATION_ERROR',
    'OPERATION_PAYLOAD_MISMATCH', 'CLOCK_INVALID', 'COMMENT_IDENTITY_CONFLICT',
  ]) {
    const failure = classifyTouchSaveFailure({ code, message: '확인할 내용' });
    assert.equal(failure.kind, 'BLOCKED');
    assert.equal(failure.blocked, true);
    assert.equal(failure.message, '확인할 내용');
  }
});
