import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture({ workletSupported = true, failModule = false, state = 'running', deferModule = false } = {}) {
  const contexts = [], worklets = [], generated = [], logs = [], modules = [], frames = new Map();
  const track = { readyState: 'live', enabled: true, muted: false, stops: 0, stop() { this.stops++; } };
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getAudioTracks() { return this.tracks; }
    getTracks() { return this.tracks; }
  }
  let Processor;
  vm.runInNewContext(fs.readFileSync('src/services/voicecapPcmWorklet.js', 'utf8'), {
    Int16Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor(name, processor) { assert.equal(name, 'voicecap-pcm'); Processor = processor; },
  });
  class Worklet {
    constructor(context, name) {
      assert.equal(name, 'voicecap-pcm'); this.context = context; worklets.push(this);
      this.port = { onmessage: null, closed: false, close() { this.closed = true; } };
      this.processor = new Processor();
      this.processor.port.postMessage = (data) => this.port.onmessage?.({ data });
    }
    connect() {}
    disconnect() { this.disconnected = true; }
    process(channels) {
      const output = new Float32Array(channels[0]?.length || 128).fill(1);
      const running = this.processor.process([channels], [[output]]);
      assert.equal(output.every((sample) => sample === 0), true, 'capture must not echo shared audio');
      assert.equal(running, true);
    }
  }
  class Context {
    constructor() {
      this.state = state; this.sampleRate = 16000; this.destination = {}; contexts.push(this);
      if (workletSupported) this.audioWorklet = { addModule: async (url) => {
        assert.ok(url.pathname.endsWith('/voicecapPcmWorklet.js'));
        assert.equal(url.search, '?no-inline');
        if (failModule) throw new Error('module failed');
        if (deferModule) await new Promise((resolve) => modules.push(resolve));
      } };
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { frequencyBinCount: 128, connect() {}, disconnect() {}, getByteFrequencyData(array) { array.fill(0); } }; }
    createScriptProcessor() {
      this.legacy = { connect() {}, disconnect() {}, onaudioprocess: null };
      return this.legacy;
    }
  }
  const source = fs.readFileSync('src/services/audioCaptureService.ts', 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(new URL('../src/services/audioCaptureService.ts', import.meta.url).href));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URL, Date, DOMException, ArrayBuffer, Int16Array, Uint8Array, MediaStream: Stream,
    window: { AudioContext: Context, ...(workletSupported ? { AudioWorkletNode: Worklet } : {}) },
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    requestAnimationFrame(callback) { const id = frames.size + 1; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    require(name) {
      assert.equal(name, './screenCaptureService');
      return { screenCaptureService: { getActiveAudioTrack: () => track } };
    },
  });
  const service = new exports.AudioCaptureService();
  return { service, contexts, worklets, generated, track, logs, modules,
    start: () => service.startCapture('TAB_AUDIO', (data) => generated.push(data), () => {}),
    resume: () => service.resumeCapture((data) => generated.push(data), () => {}),
  };
}

test('the real capture graph generates 16 kHz PCM through AudioWorklet without ScriptProcessor', async () => {
  const ctx = fixture();
  await ctx.start();
  assert.equal(ctx.contexts[0].legacy, undefined);
  for (let index = 0; index < 32; index++) ctx.worklets[0].process([new Float32Array(128).fill(0.25)]);
  assert.equal(ctx.generated.length, 1);
  assert.equal(ctx.generated[0].byteLength, 8192);
  assert.equal(new Int16Array(ctx.generated[0])[0], 8191);
  const stats = ctx.service.getDiagnostics();
  assert.equal(stats.processor, 'AUDIO_WORKLET');
  assert.equal(stats.contextState, 'running');
  assert.equal(stats.audioSeconds, 0.256);
  assert.ok(stats.lastSignalAt > 0);
  ctx.service.stopCapture();
});

test('a cancelled asynchronous resume cannot tear down the newer active audio graph', async () => {
  const ctx = fixture({ deferModule: true });
  const first = ctx.start(); await new Promise(setImmediate);
  ctx.modules[0](); await first;
  ctx.service.pauseCapture();
  const cancelled = ctx.resume(); await new Promise(setImmediate);
  ctx.service.pauseCapture();
  const current = ctx.resume(); await new Promise(setImmediate);
  ctx.modules[2](); assert.equal(await current, true);
  ctx.modules[1](); assert.equal(await cancelled, false);
  assert.equal(ctx.service.getDiagnostics().contextState, 'running');
  for (let index = 0; index < 32; index++) ctx.worklets.at(-1).process([new Float32Array(128).fill(0.5)]);
  assert.equal(ctx.generated.length, 1);
  assert.equal(ctx.track.stops, 0);
  ctx.service.stopCapture();
});

test('worklet mixes stereo to mono and does not invent input during silence or an absent channel', async () => {
  const ctx = fixture(); await ctx.start();
  const processor = ctx.worklets[0];
  processor.process([]);
  assert.equal(ctx.generated.length, 0);
  for (let index = 0; index < 32; index++) processor.process([new Float32Array(128)]);
  assert.equal(new Int16Array(ctx.generated[0]).every((value) => value === 0), true);
  assert.equal(ctx.service.getDiagnostics().lastSignalAt, 0);
  for (let index = 0; index < 32; index++) processor.process([new Float32Array(128).fill(1), new Float32Array(128).fill(-0.5)]);
  assert.equal(new Int16Array(ctx.generated[1])[0], 8191);
  ctx.service.stopCapture();
});

test('pause/resume retains the shared track, rebuilds processing and rejects delayed old PCM', async () => {
  const ctx = fixture(); await ctx.start();
  const old = ctx.worklets[0], staleCallback = old.port.onmessage;
  ctx.service.pauseCapture();
  assert.equal(old.port.closed, true);
  assert.equal(ctx.track.stops, 0);
  assert.equal(await ctx.resume(), true);
  staleCallback({ data: new Int16Array(4096).fill(1000).buffer });
  assert.equal(ctx.generated.length, 0);
  for (let index = 0; index < 32; index++) ctx.worklets[1].process([new Float32Array(128).fill(0.5)]);
  assert.equal(ctx.generated.length, 1);
  assert.equal(ctx.service.getDiagnostics().chunks, 1);
  ctx.service.stopCapture();
});

test('a failed audio module or stopped AudioContext cannot be reported as a successful capture start', async () => {
  for (const options of [{ failModule: true }, { state: 'closed' }]) {
    const ctx = fixture(options);
    await assert.rejects(ctx.start());
    assert.equal(ctx.service.getActiveStream(), null);
    assert.equal(ctx.service.getDiagnostics().processor, 'NONE');
    assert.equal(ctx.track.stops, 0, 'a setup error must not destroy the owned shared tab track');
  }
});

test('legacy capture remains available only when AudioWorklet is unsupported', async () => {
  const ctx = fixture({ workletSupported: false }); await ctx.start();
  ctx.contexts[0].legacy.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(-0.5) } });
  assert.equal(ctx.generated.length, 1);
  assert.equal(new Int16Array(ctx.generated[0])[0], -16384);
  assert.equal(ctx.service.getDiagnostics().processor, 'SCRIPT_PROCESSOR');
  ctx.service.stopCapture();
});
