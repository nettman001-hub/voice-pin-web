import test from 'node:test';
import assert from 'node:assert/strict';
import { findNicknameInText, findNicknameInMessages } from '../src/services/smsNicknameLink.ts';

const buyers = ['꽃심이', '성훈 맘', 'jennylee', '하늘'];

test('본문에 닉네임이 그대로 있으면 확정 연결', () => {
  assert.deepEqual(findNicknameInText('꽃심이입니다 주소 보내요', buyers), { nickname: '꽃심이', kind: 'EXACT' });
});

test('띄어쓰기가 달라도 확정 연결', () => {
  assert.deepEqual(findNicknameInText('꽃 심이 에요', buyers), { nickname: '꽃심이', kind: 'SPACING' });
  assert.deepEqual(findNicknameInText('성훈맘입니다', buyers), { nickname: '성훈 맘', kind: 'SPACING' });
  assert.deepEqual(findNicknameInText('Jenny Lee 입금했어요', buyers), { nickname: 'jennylee', kind: 'SPACING' });
});

test('받침 하나 정도 다르면 비슷함(확인필요)', () => {
  assert.deepEqual(findNicknameInText('꼿심이에요 주소는', buyers), { nickname: '꽃심이', kind: 'SIMILAR' });
  assert.deepEqual(findNicknameInText('jenylee 입니다', buyers), { nickname: 'jennylee', kind: 'SIMILAR' });
});

test('평범한 문장이나 짧은 닉네임은 비슷함으로 잡지 않음', () => {
  assert.equal(findNicknameInText('감사합니다 잘 받았어요', buyers), null);
  assert.equal(findNicknameInText('하눌', buyers), null);
});

test('1~2글자 닉네임은 한 단어로 쓰였을 때만 확인필요로 연결', () => {
  assert.deepEqual(findNicknameInText('하늘입니다 입금했어요', buyers), { nickname: '하늘', kind: 'SHORT' });
  assert.deepEqual(findNicknameInText('하늘 님', buyers), { nickname: '하늘', kind: 'SHORT' });
  assert.deepEqual(findNicknameInText('별', ['별']), { nickname: '별', kind: 'SHORT' });
  assert.equal(findNicknameInText('하늘색 원피스 입금했어요', buyers), null);
  assert.equal(findNicknameInText('별로 안 늦게 보내주세요', ['별']), null);
});

test('긴 닉네임의 확정 연결이 짧은 닉네임보다 먼저', () => {
  assert.deepEqual(findNicknameInText('하늘 꽃심이 입금', buyers), { nickname: '꽃심이', kind: 'EXACT' });
});

test('여러 문자 중 확실한 연결을 비슷함보다 먼저, 보낸 문자는 제외', () => {
  const messages = [
    { direction: 'OUTGOING', body: '꽃심이님 주문 확인' },
    { direction: 'INCOMING', body: '꼿심이요' },
    { direction: 'INCOMING', body: '꽃 심이 입금했어요' },
  ];
  assert.deepEqual(findNicknameInMessages(messages, buyers), { nickname: '꽃심이', kind: 'SPACING' });
  assert.equal(findNicknameInMessages([{ direction: 'OUTGOING', body: '꽃심이님' }], buyers), null);
});
