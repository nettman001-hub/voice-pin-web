import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchPhoneProducer } from '../src/services/touchPhoneProducer.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const claim = (sale = 'sale-1', generation = 'generation-1') => ({
  sale_id: sale,
  capture_generation: generation,
  capture_due_at: new Date().toISOString(),
});
const image = 'data:image/jpeg;base64,AAAA';

function fixture({ capture, save, claimCaptures } = {}) {
  const state = { pending: [claim()], captures: [], saves: [], errors: [], changes: 0, claims: 0 };
  const producer = new TouchPhoneProducer({
    api: {
      run: async () => {},
      call: async () => ({ mode: 'JWT', uniqueId: 'shop01', jwtKey: 'token' }),
      claimCaptures: async () => {
        state.claims++;
        return claimCaptures ? claimCaptures(state.claims) : { captures: [...state.pending] };
      },
      saveCapture: async (...args) => {
        state.saves.push(args);
        await save?.(...args);
      },
    },
    producerId: 'producer-1',
    sessionId: 'session-1',
    displayCode: '1회차',
    settings: { mode: 'COMMENT_TOUCH', prepareSeconds: 4, fallbackDelaySeconds: 0 },
    printer: { connected: false, name: '' },
    serverOffset: () => 0,
    totals: () => ({ totalCount: 0, totalAmount: 0 }),
    label: () => new Uint8Array(),
    capture: async (request) => {
      state.captures.push(request);
      return capture ? capture(request) : image;
    },
    onComments: () => {},
    onStatus: () => {},
    onError: (...args) => state.errors.push(args),
    onChange: () => { state.changes++; },
    socketFactory: () => ({ close() {} }),
  });
  return { producer, state };
}

test('repeated claims during countdown and upload take and save one photo per generation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const camera = deferred(), upload = deferred();
  const f = fixture({ capture: () => camera.promise, save: () => upload.promise });
  try {
    await f.producer.start();
    await settle();
    assert.equal(f.state.captures.length, 1);
    for (let i = 0; i < 4; i++) {
      t.mock.timers.tick(1500);
      f.producer.wake();
      await settle();
    }
    assert.ok(f.state.claims > 1);
    assert.equal(f.state.captures.length, 1);
    assert.equal(f.state.saves.length, 0);
    camera.resolve(image);
    await settle();
    assert.equal(f.state.saves.length, 1);
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(1500);
      f.producer.wake();
      await settle();
    }
    upload.resolve();
    await settle();
    f.producer.wake();
    await settle();
    assert.equal(f.state.captures.length, 1);
    assert.equal(f.state.saves.length, 1);
    assert.equal(f.state.saves[0][4], 'generation-1');
    assert.equal(f.state.changes, 1);
    assert.deepEqual(f.state.errors, []);
  } finally {
    camera.resolve(image);
    upload.resolve();
    await f.producer.stop();
  }
});

test('queued sales stay distinct and an explicit retake captures the next generation once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const camera = deferred();
  const f = fixture({ capture: (request) => request.saleId === 'sale-1' && request.generation === 'generation-1' ? camera.promise : image });
  f.state.pending = [claim(), claim('sale-2')];
  try {
    await f.producer.start();
    await settle();
    for (let i = 0; i < 3; i++) {
      f.producer.wake();
      await settle();
    }
    camera.resolve(image);
    await settle();
    assert.deepEqual(f.state.captures.map((r) => [r.saleId, r.generation]), [
      ['sale-1', 'generation-1'], ['sale-2', 'generation-1'],
    ]);
    f.state.pending = [claim(), claim('sale-1', 'generation-2'), claim('sale-1', 'generation-2')];
    for (let i = 0; i < 3; i++) {
      f.producer.wake();
      await settle();
    }
    assert.deepEqual(f.state.captures.map((r) => [r.saleId, r.generation]), [
      ['sale-1', 'generation-1'], ['sale-2', 'generation-1'], ['sale-1', 'generation-2'],
    ]);
    assert.equal(f.state.saves.length, 3);
  } finally {
    camera.resolve(image);
    await f.producer.stop();
  }
});

test('a claim from a stopped run cannot enqueue captures or unlock the restarted claim', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const oldClaim = deferred(), newClaim = deferred();
  const f = fixture({ claimCaptures: (n) => n === 1 ? oldClaim.promise : newClaim.promise });
  try {
    await f.producer.start();
    await settle();
    await f.producer.stop();
    await f.producer.start();
    await settle();
    assert.equal(f.state.claims, 2);
    oldClaim.resolve({ captures: [claim('old-sale')] });
    await settle();
    f.producer.wake();
    await settle();
    assert.equal(f.state.claims, 2);
    assert.equal(f.state.captures.length, 0);
    newClaim.resolve({ captures: [claim('new-sale')] });
    await settle();
    assert.deepEqual(f.state.captures.map((r) => r.saleId), ['new-sale']);
    assert.equal(f.state.saves.length, 1);
  } finally {
    oldClaim.resolve({ captures: [] });
    newClaim.resolve({ captures: [] });
    await f.producer.stop();
  }
});

test('an upload in flight stays deduplicated through stop and restart', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const upload = deferred();
  const f = fixture({ save: () => upload.promise });
  try {
    await f.producer.start();
    await settle();
    assert.equal(f.state.saves.length, 1);
    await f.producer.stop();
    await f.producer.start();
    await settle();
    f.producer.wake();
    await settle();
    assert.equal(f.state.captures.length, 1);
    upload.resolve();
    await settle();
    f.producer.wake();
    await settle();
    assert.equal(f.state.captures.length, 1);
    assert.equal(f.state.saves.length, 1);
    assert.equal(f.state.changes, 0, 'an obsolete run must not refresh the restarted UI');
  } finally {
    upload.resolve();
    await f.producer.stop();
  }
});

test('a stopped countdown cannot save a late image into a restarted run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const oldCamera = deferred();
  const f = fixture({ capture: (request) => request.saleId === 'sale-1' ? oldCamera.promise : image });
  try {
    await f.producer.start();
    await settle();
    await f.producer.stop();
    f.state.pending = [claim('new-sale')];
    await f.producer.start();
    await settle();
    oldCamera.resolve(image);
    await settle();
    assert.deepEqual(f.state.saves.map((args) => args[1]), ['new-sale']);
    assert.equal(f.state.changes, 1);
    assert.deepEqual(f.state.errors, []);
  } finally {
    oldCamera.resolve(image);
    await f.producer.stop();
  }
});
