import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { encodeCameraJpeg } from '../src/services/cameraJpegEncoder.ts';
import { grabSharpestFrame, startFrontCamera } from '../src/services/frontCamera.ts';

const jpeg = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' });
const jpegUrl = 'data:image/jpeg;base64,/9j/2Q==';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function install(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
}

function fixture(t, options = {}) {
  const calls = { fallback: [], workers: [], bitmapsClosed: 0 };
  const bitmap = { width: 1280, height: 960, close() { calls.bitmapsClosed++; } };
  const canvas = {
    width: 1280, height: 960,
    toBlob() { throw new Error('main-thread toBlob must never be called'); },
    toDataURL(...args) { calls.fallback.push(args); return jpegUrl; },
  };
  class FakeWorker {
    constructor(url, config) {
      if (options.constructorError) throw new Error('worker unavailable');
      this.url = url;
      this.config = config;
      this.terminated = 0;
      calls.workers.push(this);
    }
    postMessage(message, transfer) {
      if (options.transferError) throw new Error('bitmap transfer failed');
      this.message = message;
      this.transfer = transfer;
    }
    terminate() { this.terminated++; }
  }
  install(t, 'Worker', FakeWorker);
  install(t, 'OffscreenCanvas', class {});
  install(t, 'createImageBitmap', options.bitmapFactory || (async () => bitmap));
  return { calls, bitmap, canvas };
}

test('worker encoding transfers the selected bitmap and returns JPEG without main-thread toBlob', async (t) => {
  const f = fixture(t);
  const pending = encodeCameraJpeg(f.canvas);
  await settle();
  const worker = f.calls.workers[0];
  assert.match(worker.url.pathname, /cameraJpegEncoder\.worker\.ts$/);
  assert.deepEqual(worker.config, { type: 'module' });
  assert.equal(worker.message.bitmap, f.bitmap);
  assert.equal(worker.message.quality, 0.85);
  assert.deepEqual(worker.transfer, [f.bitmap]);
  worker.onmessage({ data: { blob: jpeg } });
  assert.equal(await pending, jpeg);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(f.calls.bitmapsClosed, 0, 'transferred bitmap is owned by the worker');
  assert.deepEqual(f.calls.fallback, []);
});

test('older WebViews encode JPEG at the same quality without requesting idle-time toBlob', async (t) => {
  const f = fixture(t);
  install(t, 'Worker', undefined);
  const blob = await encodeCameraJpeg(f.canvas);
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([255, 216, 255, 217]));
  assert.deepEqual(f.calls.fallback, [['image/jpeg', 0.85]]);
  assert.equal(f.calls.workers.length, 0);
});

test('a worker failure falls back once and terminates before accepting any late result', async (t) => {
  const f = fixture(t);
  const pending = encodeCameraJpeg(f.canvas);
  await settle();
  const worker = f.calls.workers[0], late = worker.onmessage;
  let prevented = false;
  worker.onerror({ preventDefault() { prevented = true; } });
  const blob = await pending;
  late({ data: { blob: jpeg } });
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(prevented, true);
  assert.equal(worker.terminated, 1);
  assert.equal(f.calls.fallback.length, 1);
});

test('worker timeouts are bounded and do not emit a second result after fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const pending = encodeCameraJpeg(f.canvas);
  await settle();
  const worker = f.calls.workers[0], late = worker.onmessage;
  t.mock.timers.tick(2000);
  const blob = await pending;
  late({ data: { blob: jpeg } });
  t.mock.timers.tick(10000);
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(worker.terminated, 1);
  assert.equal(f.calls.fallback.length, 1);
});

test('bitmap preparation shares the deadline and closes late bitmaps without starting a worker', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bitmapReady = deferred();
  const f = fixture(t, { bitmapFactory: () => bitmapReady.promise });
  const pending = encodeCameraJpeg(f.canvas);
  t.mock.timers.tick(2000);
  assert.equal((await pending).type, 'image/jpeg');
  bitmapReady.resolve(f.bitmap);
  await settle();
  assert.equal(f.calls.bitmapsClosed, 1);
  assert.equal(f.calls.workers.length, 0);
  assert.equal(f.calls.fallback.length, 1);
});

test('worker construction and bitmap transfer errors close locally owned resources', async (t) => {
  for (const failure of ['constructorError', 'transferError']) {
    await t.test(failure, async (child) => {
      const f = fixture(child, { [failure]: true });
      assert.equal((await encodeCameraJpeg(f.canvas)).type, 'image/jpeg');
      assert.equal(f.calls.bitmapsClosed, 1);
      assert.equal(f.calls.fallback.length, 1);
      if (f.calls.workers.length) assert.equal(f.calls.workers[0].terminated, 1);
    });
  }
});

test('unsupported bitmap creation and invalid worker output use the JPEG compatibility path', async (t) => {
  await t.test('bitmap creation rejected', async (child) => {
    const f = fixture(child, { bitmapFactory: async () => { throw new Error('unsupported canvas'); } });
    assert.equal((await encodeCameraJpeg(f.canvas)).type, 'image/jpeg');
    assert.equal(f.calls.workers.length, 0);
    assert.equal(f.calls.fallback.length, 1);
  });
  await t.test('worker cannot encode', async (child) => {
    const f = fixture(child);
    const pending = encodeCameraJpeg(f.canvas);
    await settle();
    f.calls.workers[0].onmessage({ data: { error: true } });
    assert.equal((await pending).type, 'image/jpeg');
    assert.equal(f.calls.fallback.length, 1);
  });
});

test('the worker preserves dimensions and quality and closes its bitmap even when conversion fails', async () => {
  const source = ts.transpileModule(
    fs.readFileSync(new URL('../src/services/cameraJpegEncoder.worker.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  for (const fail of [false, true]) {
    const calls = [];
    let closed = 0;
    const worker = { postMessage: (message) => calls.push(['reply', message]) };
    vm.runInNewContext(source, {
      exports: {}, self: worker,
      OffscreenCanvas: class {
        constructor(w, h) { calls.push(['dimensions', w, h]); }
        getContext() { return { drawImage: (...args) => calls.push(['draw', ...args]) }; }
        async convertToBlob(options) {
          calls.push(['encode', options]);
          assert.equal(closed, 1, 'release bitmap before asynchronous encoding');
          if (fail) throw new Error('encoding unavailable');
          return jpeg;
        }
      },
    });
    const bitmap = { width: 1280, height: 960, close() { closed++; } };
    await worker.onmessage({ data: { bitmap, quality: 0.85 } });
    assert.deepEqual(calls[0], ['dimensions', 1280, 960]);
    assert.equal(calls[1][1], bitmap);
    assert.deepEqual(calls[1].slice(2), [0, 0], 'no mirror transform or resizing');
    assert.equal(calls[2][1].type, 'image/jpeg');
    assert.equal(calls[2][1].quality, 0.85);
    assert.equal(closed, 1);
    assert.equal(fail ? calls[3][1].error : calls[3][1].blob, fail ? true : jpeg);
  }
});

test('camera playback rejection releases the acquired stream and clears its video reference', async (t) => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  install(t, 'navigator', { mediaDevices: { getUserMedia: async () => stream } });
  const video = { play: async () => { throw new Error('play failed'); } };
  await assert.rejects(startFrontCamera(video), /play failed/);
  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
});

test('frame selection still samples three unmirrored frames, then encodes the sharpest at max width', async (t) => {
  install(t, 'Worker', undefined);
  const phases = [], frames = [], encoded = [];
  let sample = 0;
  const probe = {
    getContext: () => ({
      drawImage: () => { sample++; },
      getImageData: () => {
        const bytes = new Uint8ClampedArray(probe.width * probe.height * 4);
        if (sample === 2) {
          for (let i = 0; i < bytes.length; i += 4) {
            const pixel = i / 4;
            const value = (pixel % probe.width + Math.floor(pixel / probe.width)) % 2 ? 255 : 0;
            bytes[i] = bytes[i + 1] = bytes[i + 2] = value;
          }
        }
        return { data: bytes };
      },
    }),
  };
  let created = 0;
  install(t, 'document', { createElement: () => {
    if (!created++) return probe;
    const frame = {
      draw: [],
      getContext: () => ({ drawImage: (...args) => frame.draw.push(args) }),
      toBlob() { throw new Error('idle encoding used'); },
      toDataURL(...args) { encoded.push([frame, ...args]); return jpegUrl; },
    };
    frames.push(frame);
    return frame;
  } });
  const video = { videoWidth: 1920, videoHeight: 1080 };
  const result = await grabSharpestFrame(video, { gapMs: 0, onPhase: (phase) => phases.push(phase) });
  try {
    assert.deepEqual(phases, ['SAMPLING', 'ENCODING']);
    assert.equal(frames.length, 3);
    for (const frame of frames) {
      assert.equal(frame.width, 1280);
      assert.equal(frame.height, 720);
      assert.deepEqual(frame.draw, [[video, 0, 0, 1280, 720]]);
    }
    assert.equal(encoded[0][0], frames[1]);
    assert.deepEqual(encoded[0].slice(1), ['image/jpeg', 0.85]);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.equal(result.blob.type, 'image/jpeg');
    assert.equal(result.candidates.length, 3);
  } finally {
    URL.revokeObjectURL(result.url);
  }
});
