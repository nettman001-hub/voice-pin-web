import test from 'node:test';
import assert from 'node:assert/strict';
import { areSameCommentAuthor, getPurchaseRequests, matchCommentAuthor, matchPurchaseRequest } from '../src/services/purchaseFirstSales.ts';
import { hasCommentPurchaseIntent } from '../src/services/commentNicknameVerifier.ts';

const at = '2026-10-17T11:11:34.239Z';
const comment = (patch = {}) => ({
  id: 'comment-1', platformMessageId: 'message-1', sessionId: 'broadcast',
  nickname: '하니', buyerId: 'buyer-hani', content: '네', capturedAt: at, ...patch,
});
const match = (comments, spoken = '하니', time = at) => matchCommentAuthor(spoken, comments, 'broadcast', time);

test('ordinary comments establish identity without creating or consuming purchase requests', () => {
  for (const content of ['네', 'ㅇ', '롱', '예뻐요', '구경이요', '가능하면 이거 할게요']) {
    const records = [comment({ content })];
    assert.equal(getPurchaseRequests(records, 'broadcast').length, 0, content);
    const result = match(records);
    assert.equal(result.kind, 'MATCH', content);
    assert.equal(result.comment.buyerId, 'buyer-hani');
    assert.equal(result.score, 100);
    assert.equal(match(records).kind, 'MATCH', 'identity is reusable');
  }
  const records = [comment({ content: 'ㅈㅇ' })];
  const requests = getPurchaseRequests(records, 'broadcast');
  assert.equal(matchPurchaseRequest('하니', requests, at, new Set([requests[0].id])).kind, 'NO_REQUEST');
  assert.equal(match(records).kind, 'MATCH', 'consumed request does not consume author identity');
});

test('comment identity uses only the same session and the inclusive five-minute/ten-second window', () => {
  for (const offset of [-300_000, 10_000]) {
    assert.equal(match([comment({ capturedAt: new Date(Date.parse(at) + offset).toISOString() })]).kind, 'MATCH');
  }
  for (const patch of [{ sessionId: 'other' }, { capturedAt: 'invalid' }, { nickname: '알 수 없음' },
    { capturedAt: new Date(Date.parse(at) - 300_001).toISOString() },
    { capturedAt: new Date(Date.parse(at) + 10_001).toISOString() }]) {
    assert.equal(match([comment(patch)]).kind, 'NO_MATCH', JSON.stringify(patch));
  }
  assert.equal(match([comment()], '', at).kind, 'NO_MATCH');
  assert.equal(match([comment()], '하니', 'invalid').kind, 'NO_MATCH');
});

test('repeated same-account comments resolve the latest evidence but separate equal names remain ambiguous', () => {
  const records = [comment(), comment({ id: 'comment-2', platformMessageId: 'message-2', content: 'ㅇ',
    capturedAt: new Date(Date.parse(at) + 1000).toISOString() })];
  assert.equal(match(records).comment.id, 'comment-2');
  assert.equal(match([records[0], { ...records[1], buyerId: 'another-buyer' }]).kind, 'AMBIGUOUS');
  assert.equal(match(records.map((entry) => ({ ...entry, buyerId: undefined }))).kind, 'AMBIGUOUS');
});

test('local and canonical identity keys merge only when shared IDs provide a bridge', () => {
  const canonical = comment({ platformUserId: 'platform-hani', uniqueId: 'hani' });
  const local = comment({ id: 'local', platformMessageId: 'local-message', buyerId: undefined,
    platformUserId: 'platform-hani', capturedAt: new Date(Date.parse(at) + 1000).toISOString() });
  const result = match([canonical, local]);
  assert.equal(result.kind, 'MATCH');
  assert.equal(result.comment.id, 'local');
  assert.equal(result.comment.buyerId, 'buyer-hani', 'explicit ID bridge retains the canonical buyer');
  assert.equal(local.buyerId, undefined, 'source evidence is not mutated');
  assert.equal(match([comment(), local]).kind, 'AMBIGUOUS', 'same display name is not a bridge');
  assert.equal(match([canonical, { ...local, platformUserId: undefined, uniqueId: 'HANI' }]).kind, 'MATCH');
  assert.equal(match([canonical, { ...local, buyerId: 'different-buyer' }]).kind, 'AMBIGUOUS', 'contradictory canonical IDs stay separate');
});

test('duplicate local and cloud copies of one platform message are one author', () => {
  const canonical = comment();
  const local = comment({ id: 'local-id', buyerId: undefined });
  assert.equal(match([canonical, local]).kind, 'MATCH');
  assert.equal(match([canonical, { ...local, platformMessageId: 'different-message' }]).kind, 'AMBIGUOUS');
});

test('account equivalence requires a shared ID or an explicit same-session identity bridge', () => {
  const canonical = comment();
  const local = comment({ id: 'local', platformMessageId: 'local', buyerId: undefined, platformUserId: 'platform-hani' });
  assert.equal(areSameCommentAuthor(canonical, local, []), false);
  const bridge = comment({ id: 'bridge', platformMessageId: 'bridge', platformUserId: 'platform-hani' });
  assert.equal(areSameCommentAuthor(canonical, local, [bridge]), true);
  assert.equal(areSameCommentAuthor(canonical, local, [{ ...bridge, sessionId: 'other-session' }]), false);
  assert.equal(areSameCommentAuthor(canonical, { ...canonical, id: 'second', platformMessageId: 'second' }, []), true);
  assert.equal(areSameCommentAuthor(canonical, { ...canonical, id: 'local-id', buyerId: undefined }, []), true);
  assert.equal(areSameCommentAuthor(local, { ...local, id: 'second', platformMessageId: 'second' }, []), true);
  assert.equal(areSameCommentAuthor({ ...local, platformUserId: undefined, uniqueId: 'HANI' },
    { ...local, id: 'second', platformMessageId: 'second', platformUserId: undefined, uniqueId: 'hani' }, []), true);
});

test('account equivalence rejects identical names and contradictory canonical or platform IDs', () => {
  const a = comment();
  const b = comment({ id: 'second', platformMessageId: 'second', buyerId: 'other-buyer' });
  assert.equal(areSameCommentAuthor(a, b, []), false);
  assert.equal(areSameCommentAuthor(a, { ...b, platformMessageId: a.platformMessageId }, []), false);
  assert.equal(areSameCommentAuthor({ ...a, platformUserId: 'shared' }, { ...b, platformUserId: 'shared' }, []), false);
  assert.equal(areSameCommentAuthor({ ...a, platformUserId: 'first' }, { ...b, buyerId: a.buyerId, platformUserId: 'second' }, []), false);
  assert.equal(areSameCommentAuthor(a, { ...a, sessionId: 'other' }, []), false);
  assert.equal(areSameCommentAuthor({ ...a, buyerId: undefined }, { ...b, buyerId: undefined }, []), false);
});

test('author matching preserves fuzzy, digit-conflict and compound-name ambiguity rules', () => {
  assert.equal(match([comment({ nickname: '넥스트' })], '네스트').kind, 'MATCH');
  assert.equal(match([comment({ nickname: '이이돌1234' })], '이이돌5678').kind, 'DIGIT_CONFLICT');
  assert.equal(match([comment({ nickname: '가윤♡예준맘' })], '가윤').kind, 'MATCH');
  assert.equal(match([comment({ nickname: '가윤' }), comment({ id: 'other', platformMessageId: 'other',
    buyerId: 'other', nickname: '가윤♡예준맘' })], '가윤').kind, 'AMBIGUOUS');
  assert.equal(match([comment({ nickname: '성훈 맘' }), comment({ id: 'other', platformMessageId: 'other',
    buyerId: 'other', nickname: '맘' })], '이거 성훈 맘').comment.nickname, '성훈 맘');
  assert.equal(match([comment({ nickname: '성훈 맘' }), comment({ id: 'other', platformMessageId: 'other',
    buyerId: 'other', nickname: '성훈 맘' }), comment({ id: 'third', platformMessageId: 'third',
    buyerId: 'third', nickname: '맘' })], '이거 성훈 맘').kind, 'AMBIGUOUS');
});

test('explicit item-taking statements generate purchase requests', () => {
  for (const content of ['아까꺼 할께요', '아까꺼 할게요', '아까 거 할게요', '이거 할게요',
    '제가 이거 할게요!', '네, 아까꺼 할께요', '요거는 할게요']) {
    assert.equal(hasCommentPurchaseIntent(content), true, content);
    assert.equal(getPurchaseRequests([comment({ content })], 'broadcast').length, 1, content);
    assert.equal(matchPurchaseRequest('하니', getPurchaseRequests([comment({ content })], 'broadcast'), at).kind, 'MATCH');
  }
});

test('item-taking support does not turn questions, conditions, quotations or other future actions into requests', () => {
  for (const content of ['연락할게요', '확인할게요', '이거 확인할게요', '아까꺼 연락할게요',
    '아까꺼 취소할게요', '아까꺼 안 할게요', '가능하면 이거 할게요', '이거 있으면 할게요',
    '맞으면 아까꺼 할게요', '아까꺼 할게요?', '아까꺼 할게요 취소요',
    '아까꺼 할게요라고 했어요', '"아까꺼 할게요"', '네', 'ㅇ', '롱', '할게요']) {
    assert.equal(hasCommentPurchaseIntent(content), false, content);
    assert.equal(getPurchaseRequests([comment({ content })], 'broadcast').length, 0, content);
  }
});

test('operational Hani comments now produce only the explicit earlier request and later abbreviation', () => {
  const records = ['아까꺼 할께요', '롱', '네', 'ㅇ', 'ㅈㅇ'].map((content, i) =>
    comment({ id: `c${i}`, platformMessageId: `m${i}`, content }));
  assert.deepEqual(getPurchaseRequests(records, 'broadcast').map((entry) => entry.content), ['아까꺼 할께요', 'ㅈㅇ']);
  assert.equal(match(records).kind, 'MATCH');
});
