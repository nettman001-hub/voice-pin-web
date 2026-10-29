import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commentProductNumber,
  touchCommentTone,
  nextUnsoldNumber,
  touchSlipLine,
  touchLabelNumber,
} from '../src/services/touchSaleModes.ts';

test('number comments: 번, 이요, 주세요, bare digits, keycap; prices, counts and other numbers are not number 1', () => {
  const yes = [
    '1번',
    '1번이요',
    '1번 주세요',
    '1번 저요',
    '저요 1번',
    '1',
    '1요',
    '1이요',
    '1주세요',
    '1 주세요',
    '1 살께요',
    '1살게요',
    '1 할게요',
    '1저요',
    '1️⃣',
    '1!',
    ' 1 ',
  ];
  for (const text of yes) assert.equal(commentProductNumber(text), 1, text);
  for (const text of [
    '1.5',
    '1만',
    '1개',
    '1장',
    '1시',
    '1주일',
    '1개 주세요',
    '1.5요',
    '저요',
    '언니 이뻐요',
    '15000',
  ])
    assert.notEqual(commentProductNumber(text), 1, text);
  assert.equal(commentProductNumber('11번'), 11);
  assert.equal(commentProductNumber('10'), 10);
  assert.equal(commentProductNumber('21'), 21);
  assert.equal(commentProductNumber('2번 1개'), 2);
  assert.equal(commentProductNumber('1.5'), null);
  assert.equal(commentProductNumber('1개 주세요'), null);
  assert.equal(commentProductNumber('15000'), null);
});

test('tones: current number flashes, other numbers get a badge, plain purchase intent is light', () => {
  assert.deepEqual(touchCommentTone({ content: '2번요' }, 'NUMBER', 2), {
    tone: 'CURRENT',
    number: 2,
  });
  assert.deepEqual(touchCommentTone({ content: '1번 주세요' }, 'NUMBER', 2), {
    tone: 'OTHER',
    number: 1,
  });
  assert.deepEqual(touchCommentTone({ content: '저요' }, 'NUMBER', 2), {
    tone: 'INTENT',
    number: null,
  });
  assert.deepEqual(touchCommentTone({ content: 'ㅈㅇ' }, 'NUMBER', 2), {
    tone: 'INTENT',
    number: null,
  });
  assert.deepEqual(touchCommentTone({ content: '이거 살께요' }, 'NUMBER', 2), {
    tone: 'INTENT',
    number: null,
  });
  assert.deepEqual(touchCommentTone({ content: '1개 주세요' }, 'NUMBER', 2), {
    tone: 'INTENT',
    number: null,
  });
  assert.deepEqual(touchCommentTone({ content: '보여 주세요' }, 'NUMBER', 2), {
    tone: null,
    number: null,
  });
  assert.deepEqual(
    touchCommentTone({ content: '블랙 M 저요' }, 'SIZE_COLOR', 2),
    { tone: 'INTENT', number: null },
  );
  assert.deepEqual(touchCommentTone({ content: '2번' }, 'SIZE_COLOR', 2), {
    tone: null,
    number: null,
  });
  assert.deepEqual(touchCommentTone({ content: '2번' }, 'BASIC', 2), {
    tone: null,
    number: null,
  });
});

test('next number skips sold numbers; slip line carries number and size/color comment', () => {
  assert.equal(nextUnsoldNumber(1, new Set([1])), 2);
  assert.equal(nextUnsoldNumber(1, new Set([1, 2, 3])), 4);
  assert.equal(touchSlipLine('NUMBER', 2, '블랙 M'), '2번');
  assert.equal(
    touchSlipLine('SIZE_COLOR', 2, '  블랙   M 저요 '),
    '2번 · 블랙 M 저요',
  );
  assert.equal(touchSlipLine('BASIC', 2, '블랙'), '');
  assert.equal(touchLabelNumber('12번'), 12);
  assert.equal(touchLabelNumber('니트'), null);
});
