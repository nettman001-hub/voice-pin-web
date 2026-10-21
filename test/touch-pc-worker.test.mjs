import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(
  new URL('../src/services/touchPcWorker.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture({
  slowPrint = false,
  slowBegin = false,
  missing = false,
} = {}) {
  let now = 100000,
    delay = 5;
  const intervals = new Set(),
    timeouts = new Set(),
    images = [],
    errors = [],
    prints = [],
    targets = [];
  const pendingPrint = deferred(),
    pendingBegin = deferred(),
    details = [];
  let hasJob = true;
  const api = {
    workspaceId: 'workspace',
    claimCaptures: async () => ({ captures: details }),
    claimPrints: async () => ({
      jobs: hasJob
        ? ((hasJob = false),
          [
            {
              id: 'job',
              sale_id: 'sale-a',
              sale_revision: 1,
              immutable_payload: { buyerNickname: '하니', amount: 15000 },
            },
          ])
        : [],
      leaseToken: 'lease',
    }),
    print: async (kind) => {
      if (kind === 'BEGIN' && slowBegin) await pendingBegin.promise;
    },
    saveCapture: async (producer, sale, image, at) => {
      images.push({ producer, sale, image, at });
    },
    call: async (kind, payload) => {
      targets.push({ kind, payload });
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    Map,
    Set,
    Promise,
    Error,
    setInterval: (fn) => {
      intervals.add(fn);
      return fn;
    },
    clearInterval: (fn) => intervals.delete(fn),
    setTimeout: (fn) => {
      timeouts.add(fn);
      return fn;
    },
    clearTimeout: (fn) => timeouts.delete(fn),
    require: (name) => {
      assert.equal(name, './touchLocalStore');
      return {
        touchLocalStore: {
          saveFrames: async () => {},
          getFrames: async () => [],
        },
      };
    },
  });
  const worker = new module.exports.TouchPcWorker({
    api,
    producerId: 'pc',
    frames: {
      nearest: (at) =>
        missing || at < now - 30000 ? null : { at, image: `frame-${at}` },
    },
    serverOffset: () => 5000,
    delaySeconds: () => delay,
    prepareSeconds: () => 4,
    canPrint: () => true,
    print: async (payload) => {
      prints.push(payload);
      if (slowPrint) await pendingPrint.promise;
      return { ok: true };
    },
    onChange: () => {},
    onError: (kind, e) => errors.push({ kind, e }),
  });
  const detail = (id, at) => ({
    sale_id: id,
    capture_generation: `generation-${id}`,
    confirmed_at: new Date(at + 5000).toISOString(),
    capture_due_at: new Date(at + 14000).toISOString(),
  });
  return {
    worker,
    images,
    errors,
    prints,
    targets,
    details,
    detail,
    pendingPrint,
    pendingBegin,
    setDelay: (value) => {
      delay = value;
    },
    advance: async (value) => {
      now = value;
      for (const callback of intervals) callback();
      await settle();
    },
    setNow: (value) => {
      now = value;
    },
  };
}
test('a slow printer cannot delay claiming/capturing later phone sales', async () => {
  const f = fixture({ slowPrint: true });
  f.details.push(f.detail('sale-a', 100000));
  f.worker.start();
  await settle();
  assert.equal(f.prints.length, 1);
  f.details.push(f.detail('sale-b', 102000));
  await f.advance(109600);
  await f.advance(111600);
  assert.deepEqual(
    f.images.map((i) => i.sale),
    ['sale-a', 'sale-b'],
  );
  assert.equal(f.images[0].image, 'frame-109000');
  assert.equal(f.images[1].image, 'frame-111000');
  f.worker.stop();
  f.pendingPrint.resolve();
  await settle();
});
test('late sales without a matching historical frame are marked missing, never photographed using now', async () => {
  const f = fixture({ missing: true });
  f.setNow(200000);
  f.details.push(f.detail('old', 100000));
  f.worker.start();
  await settle();
  await f.advance(200500);
  assert.equal(f.images.length, 1);
  assert.equal(f.images[0].sale, 'old');
  assert.equal(f.images[0].image, undefined);
  assert.equal(f.errors[0].kind, 'CAPTURE_MISSING');
  f.worker.stop();
});
test('a revised broadcast delay updates pending target using corrected server/PC clocks', async () => {
  const f = fixture();
  f.details.push(f.detail('a', 100000));
  f.worker.start();
  await settle();
  f.setDelay(8);
  await f.advance(101500);
  assert.equal(Date.parse(f.targets.at(-1).payload.dueAt), 117000);
  await f.advance(112600);
  assert.equal(f.images[0].image, 'frame-112000');
  f.worker.stop();
});
test('stopping while the server acknowledges BEGIN does not submit a late physical print', async () => {
  const f = fixture({ slowBegin: true });
  f.worker.start();
  await settle();
  f.worker.stop();
  f.pendingBegin.resolve();
  await settle();
  assert.equal(f.prints.length, 0);
});

test('a stale pending claim after completion cannot capture again; a new generation can', async () => {
  const f = fixture();
  f.details.push(f.detail('a', 100000));
  f.worker.start();
  await settle();
  await f.advance(109600);
  await f.advance(112600);
  await f.advance(114000);
  await f.advance(115000);
  assert.equal(f.images.length, 1);
  f.details[0] = {
    ...f.details[0],
    capture_generation: 'recapture-a',
    recapture: true,
    capture_due_at: new Date(121000).toISOString(),
  };
  await f.advance(116000);
  await f.advance(116600);
  assert.equal(f.images.length, 2);
  f.worker.stop();
});
