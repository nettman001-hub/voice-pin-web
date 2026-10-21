import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTouchDelay,
  StableTouchDelay,
} from '../src/services/touchDelayEstimator.ts';
let seed = 12345;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const phone = Array.from({ length: 1400 }, (_, i) => ({
  at: i * 50,
  value: random() * 0.12,
}));
test('audio amplitude delay is measured without speech recognition for several shifts', () => {
  for (const seconds of [1.5, 5, 8, 15, 20]) {
    const tab = phone.map((p) => ({
      at: p.at + seconds * 1000,
      value: p.value * 0.6 + 0.001,
    }));
    const estimate = estimateTouchDelay(phone, tab, 65000);
    assert.ok(estimate, seconds);
    assert.equal(estimate.seconds, seconds);
  }
});
test('silence, unrelated noise and immediate playback echo do not overwrite delay', () => {
  const silent = phone.map((p) => ({ ...p, value: 0 }));
  assert.equal(estimateTouchDelay(silent, silent, 65000), null);
  assert.equal(estimateTouchDelay(phone, phone, 65000), null);
  assert.equal(
    estimateTouchDelay(
      phone,
      phone.map((p) => ({ ...p, value: random() * 0.1 })),
      65000,
    ),
    null,
  );
  const stable = new StableTouchDelay();
  assert.equal(stable.add({ seconds: 5, correlation: 1 }), null);
  assert.equal(stable.add(null), null);
  assert.equal(stable.add({ seconds: 5.2, correlation: 1 }), null);
  assert.equal(stable.add({ seconds: 8, correlation: 1 }), 5.2);
});
