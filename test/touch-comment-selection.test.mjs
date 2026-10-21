import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectTouchComment,
  shouldFlashTouchComment,
  touchCommentKey,
  mergeTouchComments,
} from '../src/services/touchCommentState.ts';
const c = (id, content, sequence) => ({
  id,
  platformMessageId: id,
  sessionId: 's',
  nickname: id,
  content,
  sequence,
});
test('purchase tap stops every existing purchase alert, ordinary tap does not, new purchase alone flashes', () => {
  const a = c('a', '저요', 1),
    b = c('b', '제가 살게요', 2),
    talk = c('talk', '예뻐요', 3),
    later = c('later', 'ㅈㅇ', 4);
  const initial = { selectedKey: null, acknowledged: new Set() };
  assert.equal(shouldFlashTouchComment(a, initial, new Set()), true);
  assert.equal(shouldFlashTouchComment(b, initial, new Set()), true);
  const ordinary = selectTouchComment(initial, talk, [a, b, talk]);
  assert.equal(shouldFlashTouchComment(a, ordinary, new Set()), true);
  const selected = selectTouchComment(initial, a, [a, b, talk]);
  assert.equal(selected.selectedKey, touchCommentKey(a));
  assert.equal(shouldFlashTouchComment(a, selected, new Set()), false);
  assert.equal(shouldFlashTouchComment(b, selected, new Set()), false);
  assert.equal(shouldFlashTouchComment(later, selected, new Set()), true);
  const oldTap = selectTouchComment(selected, a, [a, b, talk, later]);
  assert.equal(
    shouldFlashTouchComment(later, oldTap, new Set()),
    true,
    'a previously acknowledged row must not acknowledge new alerts',
  );
  assert.equal(
    shouldFlashTouchComment(later, selected, new Set([touchCommentKey(later)])),
    false,
  );
  assert.equal(
    shouldFlashTouchComment(c('no', '구매 취소요', 5), initial, new Set()),
    false,
  );
});
test('direct/fallback replay merges by canonical platform message and keeps 500 ordered comments', () => {
  const all = Array.from({ length: 520 }, (_, i) => c('c' + i, '저요', i + 1));
  const rows = mergeTouchComments(
    all,
    all.slice(-40).map((x) => ({ ...x, stats: { todayCount: 2 } })),
    's',
  );
  assert.equal(rows.length, 500);
  assert.equal(rows[0].sequence, 21);
  assert.equal(rows.at(-1).stats.todayCount, 2);
});
