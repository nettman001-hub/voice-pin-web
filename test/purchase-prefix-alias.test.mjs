import test from 'node:test';
import assert from 'node:assert/strict';
import { getPurchaseRequests, matchPurchaseRequest } from '../src/services/purchaseFirstSales.ts';
import { compareNicknames } from '../src/services/nicknameMatcher.ts';

const at = '2026-10-01T00:00:00.000Z';
const recognizedAt = '2026-10-01T00:00:03.000Z';
const comment = (nickname, id = nickname, extra = {}) => ({
  id, platformMessageId: id, platformUserId: id, sessionId: 'session-1',
  nickname, content: '저요', capturedAt: at, ...extra,
});
const match = (spoken, comments, consumed = new Set()) => matchPurchaseRequest(spoken,
  getPurchaseRequests(comments, 'session-1'), recognizedAt, consumed);

test('a complete delimiter-separated prefix resolves to the original purchase nickname', () => {
  for (const nickname of ['가윤♡예준맘', '가윤 예준맘', '가윤/예준맘', '가윤💖예준맘']) {
    const result = match('가윤', [comment(nickname)]);
    assert.equal(result.kind, 'MATCH', nickname);
    assert.equal(result.request.nickname, nickname, 'store the exact comment nickname, including symbols');
    assert.equal(result.score, 94);
  }
  assert.equal(match('가윤 언니', [comment('가윤♡예준맘')]).kind, 'MATCH');
  assert.equal(compareNicknames('가윤', '가윤♡예준맘').isSimilar, false,
    'purchase aliases must not change global identity/history comparisons');
});

test('shared prefix aliases and a competing exact short name remain ambiguous', () => {
  for (const competingNickname of ['가윤♡하늘맘', '가윤']) {
    const result = match('가윤', [comment('가윤♡예준맘', 'first'), comment(competingNickname, 'second')]);
    assert.equal(result.kind, 'AMBIGUOUS', competingNickname);
    assert.equal(result.candidates.length, 2);
  }
});

test('prefix aliases require a complete, nonnumeric, at-least-two-letter first component', () => {
  for (const [spoken, nickname] of [
    ['가윤', '가윤예준맘'], ['가윤', '예준맘♡가윤'], ['가윤', '가윤이♡예준맘'],
    ['가윤', '가은♡예준맘'], ['가', '가♡예준맘'], ['12', '12♡예준맘'],
    ['가윤', '♡가윤예준맘♡'],
  ]) assert.equal(match(spoken, [comment(nickname)]).kind, 'NO_REQUEST', `${spoken} / ${nickname}`);
});

test('a prefix alias never bypasses explicit conflicting digits', () => {
  assert.equal(match('가윤1234', [comment('가윤1234♡예준맘5678')]).kind, 'DIGIT_CONFLICT');
  assert.equal(match('가윤1234', [comment('가윤5678♡예준맘')]).kind, 'DIGIT_CONFLICT');
});

test('prefix aliases retain request eligibility, consumption, and time boundaries', () => {
  const buyer = comment('가윤♡예준맘', 'buyer');
  for (const extra of [
    { content: '보여주세요' }, { content: '있으면 살게요' }, { content: '두 개 주세요' },
    { sessionId: 'other-session' }, { capturedAt: '2026-09-30T23:55:02.000Z' },
    { capturedAt: '2026-10-01T00:00:14.000Z' },
  ]) assert.equal(match('가윤', [{ ...buyer, ...extra }]).kind, 'NO_REQUEST', JSON.stringify(extra));
  assert.equal(match('가윤', [buyer], new Set(['session-1:buyer'])).kind, 'NO_REQUEST');
  const withdrawal = comment('가윤♡예준맘', 'withdrawal', {
    platformUserId: 'buyer', content: '취소요', capturedAt: '2026-10-01T00:00:01.000Z',
  });
  assert.equal(match('가윤', [buyer, withdrawal]).kind, 'NO_REQUEST');
});

test('repeated prefix purchase comments from one account do not create false ambiguity', () => {
  const first = comment('가윤♡예준맘', 'first', { platformUserId: 'same-buyer' });
  const latest = comment('가윤♡예준맘', 'latest', {
    platformUserId: 'same-buyer', capturedAt: '2026-10-01T00:00:02.000Z',
  });
  const result = match('가윤', [first, latest]);
  assert.equal(result.kind, 'MATCH');
  assert.equal(result.request.commentId, 'latest');
  assert.equal(result.request.nickname, '가윤♡예준맘');
});
