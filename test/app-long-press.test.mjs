import assert from 'node:assert/strict';
import test from 'node:test';
import { createLongPress, totalsBarVisible } from '../src/services/appLongPress.ts';

const fakeTimers = () => {
  let time = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    timers: {
      set: (callback, ms) => {
        const id = nextId++;
        pending.set(id, { callback, at: time + ms });
        return id;
      },
      clear: (id) => void pending.delete(id),
      now: () => time,
    },
    advance(ms) {
      time += ms;
      for (const [id, item] of [...pending]) {
        if (item.at <= time) {
          pending.delete(id);
          item.callback();
        }
      }
    },
    pendingCount: () => pending.size,
  };
};

test('500ms 동안 가만히 누르면 메뉴가 열린다', () => {
  const fake = fakeTimers();
  const press = createLongPress({ timers: fake.timers });
  let opened = 0;
  press.start(100, 200, () => (opened += 1));
  fake.advance(499);
  assert.equal(opened, 0);
  fake.advance(1);
  assert.equal(opened, 1);
});

test('짧게 누르고 떼면 열리지 않는다', () => {
  const fake = fakeTimers();
  const press = createLongPress({ timers: fake.timers });
  let opened = 0;
  press.start(0, 0, () => (opened += 1));
  fake.advance(200);
  press.end();
  fake.advance(1000);
  assert.equal(opened, 0);
  assert.equal(press.consumeFired(), false);
});

test('손가락이 많이 움직이면(스크롤) 취소하고, 조금 흔들리는 건 허용한다', () => {
  const fake = fakeTimers();
  const press = createLongPress({ timers: fake.timers });
  let opened = 0;
  press.start(50, 50, () => (opened += 1));
  press.move(55, 56);
  fake.advance(500);
  assert.equal(opened, 1);
  press.start(50, 50, () => (opened += 1));
  press.move(50, 75);
  fake.advance(1000);
  assert.equal(opened, 1);
  assert.equal(fake.pendingCount(), 0);
});

test('길게 누른 직후의 클릭은 한 번만 삼키고, 시간이 지나면 다음 탭을 막지 않는다', () => {
  const fake = fakeTimers();
  const press = createLongPress({ timers: fake.timers });
  press.start(0, 0, () => {});
  fake.advance(500);
  assert.equal(press.consumeFired(), true);
  assert.equal(press.consumeFired(), false);
  press.start(0, 0, () => {});
  fake.advance(500);
  fake.advance(900);
  assert.equal(press.consumeFired(), false, '클릭이 오지 않은 기기에서는 다음 탭을 삼키지 않는다');
});

test('새로 누르면 앞의 타이머는 사라진다', () => {
  const fake = fakeTimers();
  const press = createLongPress({ timers: fake.timers });
  let opened = [];
  press.start(0, 0, () => opened.push('a'));
  fake.advance(300);
  press.start(0, 0, () => opened.push('b'));
  fake.advance(300);
  assert.deepEqual(opened, []);
  fake.advance(200);
  assert.deepEqual(opened, ['b']);
});

test('합계 줄은 합계 카드가 헤더 밑으로 올라간 뒤에만 보인다', () => {
  assert.equal(totalsBarVisible(300), false);
  assert.equal(totalsBarVisible(48), false);
  assert.equal(totalsBarVisible(47), true);
  assert.equal(totalsBarVisible(-500), true);
});
