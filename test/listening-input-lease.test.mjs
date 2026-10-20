import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireListeningInput } from '../src/services/listeningInputLease.ts';

test('test and operating listeners cannot own the same input concurrently; releasing it permits the next run', async () => {
  let held = false;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    async request(name, options, callback) {
      assert.equal(name, 'voicecap-live-listening-input'); assert.equal(options.ifAvailable, true);
      if (held) return callback(null);
      held = true;
      try { return await callback({ name }); } finally { held = false; }
    },
  } } });
  try {
    const stopOperating = await acquireListeningInput();
    await assert.rejects(acquireListeningInput(), /다른 탭/);
    stopOperating();
    await new Promise(resolve => setImmediate(resolve));
    const stopTest = await acquireListeningInput();
    stopTest();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(held, false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});
