import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercises the real camera, JPEG encoder, worker and phone UI with a synthetic
// MediaStream. The sale API and printer are isolated; no real device/account writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tools/phone-capture-latency');
const [app, worker] = await Promise.all([
  build({
    absWorkingDir: root, entryPoints: ['test/fixtures/phoneLifecycleApp.tsx'],
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'isolated-phone-backend', setup(builder) {
      builder.onResolve({ filter: /\/(AuthContext|touchSalesApi|supabaseClient|productSalesApi|remoteWorkspaceService)$/ },
        () => ({ path: path.join(root, 'test/fixtures/phoneLifecycleMock.ts') }));
    } }],
  }),
  build({
    absWorkingDir: root, entryPoints: ['src/services/cameraJpegEncoder.worker.ts'],
    bundle: true, write: false, format: 'esm', platform: 'browser',
  }),
]);
const server = http.createServer(async (req, res) => {
  if (req.url === '/app.js' || req.url === '/cameraJpegEncoder.worker.ts') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end((req.url === '/app.js' ? app : worker).outputFiles[0].text);
    return;
  }
  if (req.url === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(await fs.readFile(path.join(root, 'src/styles/touchSales.css')));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}</style><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browserServer;
const checks = [];
const measurements = [];
try {
  browserServer = await chromium.launchServer({ headless: true }).catch(error => {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    return chromium.launchServer({ headless: true, channel: 'chrome' });
  });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  await fs.mkdir(output, { recursive: true });
  const scenarios = [
    { name: 'worker-with-main-toBlob-stalled' },
    { name: 'delayed-encoding-phase', workerDelayMs: 900 },
    { name: 'delayed-sampling-phase', sampleDelayMs: 1000 },
    { name: 'worker-unavailable', workerMode: 'unavailable' },
    { name: 'worker-error', workerMode: 'error' },
    { name: 'worker-timeout', workerMode: 'timeout' },
    { name: 'camera-play-rejected', rejectPlay: true },
  ];
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true });
    await context.addInitScript(config => {
      const events = [];
      const mark = (name, detail = {}) => events.push({ name, at: performance.now(), ...detail });
      const state = window.captureCheck = {
        events, videoSamples: [], canvasToBlobCalls: 0, fallbackCalls: 0,
        streams: 0, stoppedTracks: 0, workers: 0, terminatedWorkers: 0, workerPosts: 0,
        delayedSampleGaps: 0,
      };
      if (config.sampleDelayMs) {
        const schedule = window.setTimeout;
        window.setTimeout = (handler, delay, ...args) => {
          if (delay === 150) { state.delayedSampleGaps++; delay += config.sampleDelayMs; }
          return schedule(handler, delay, ...args);
        };
      }
      let lastPhase = '';
      const observeUi = () => {
        const shot = document.querySelector('.touch-phone-shot:not(.touch-phone-shot-idle)');
        const phase = !shot ? 'hidden' : shot.querySelector('img') ? 'preview' : shot.querySelector('strong')?.textContent || 'unknown';
        if (phase !== lastPhase) { lastPhase = phase; mark('ui', { phase }); }
      };
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(observeUi).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        observeUi();
        setInterval(() => {
          const shot = document.querySelector('.touch-phone-shot:not(.touch-phone-shot-idle)');
          const video = shot?.querySelector('video');
          if (!video) return;
          state.videoSamples.push({ at: performance.now(), phase: shot.querySelector('strong')?.textContent || 'preview',
            currentTime: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames });
        }, 100);
      });
      // The old path would wait forever here. Neither worker nor fallback should
      // touch this main-thread idle-scheduled encoding API.
      HTMLCanvasElement.prototype.toBlob = function() { state.canvasToBlobCalls++; mark('mainToBlob.called'); };
      const realDataUrl = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        state.fallbackCalls++; mark('fallback.encode');
        return realDataUrl.apply(this, args);
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        state.streams++; mark('camera.start');
        const canvas = document.createElement('canvas');
        canvas.width = 1280; canvas.height = 960;
        const ctx = canvas.getContext('2d');
        let frame = 0;
        const draw = () => {
          ctx.fillStyle = '#abd7bc'; ctx.fillRect(0, 0, 1280, 960);
          ctx.fillStyle = '#24577f'; ctx.fillRect(180 + ((frame++ % 8) * 15), 120, 400, 700);
          ctx.fillStyle = 'white'; ctx.font = '80px sans-serif'; ctx.fillText('TEST CAMERA', 220, 520);
        };
        draw();
        const stream = canvas.captureStream(15);
        const interval = setInterval(draw, 60);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { state.stoppedTracks++; clearInterval(interval); mark('camera.stop'); stop(); };
        }
        return stream;
      } });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = async function() {
        if (config.rejectPlay) throw new Error('fixture video.play rejection');
        return play.call(this);
      };
      const NativeWorker = window.Worker;
      if (config.workerMode === 'unavailable') Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
      else window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); state.workers++; mark('worker.start'); }
        postMessage(...args) {
          state.workerPosts++; mark('worker.post');
          if (config.workerMode === 'error') {
            setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'fixture worker encoding failure', cancelable: true })), 0);
            return;
          }
          if (config.workerMode === 'timeout') return;
          if (config.workerDelayMs) {
            setTimeout(() => super.postMessage(...args), config.workerDelayMs);
            return;
          }
          return super.postMessage(...args);
        }
        terminate() { state.terminatedWorkers++; mark('worker.stop'); return super.terminate(); }
      };
    }, scenario);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.touch-phone-offer button').click();
    await page.getByRole('button', { name: '지금 회차 이어서 판매', exact: true }).click();
    await page.locator('.touch-phone-stop').waitFor();
    await page.evaluate(() => window.phoneLifecycle.comment());
    await page.locator('[data-comment-id="comment-1"]').click();
    await page.getByRole('button', { name: '확인', exact: true }).click();
    for (const key of ['1', '.', '5']) await page.locator('.touch-keypad').getByRole('button', { name: key, exact: true }).click();
    await page.locator('.touch-confirm-price').click();
    if (scenario.workerDelayMs || scenario.sampleDelayMs) {
      await page.locator('.touch-phone-shot strong').filter({ hasText: '사진 처리 중' }).waitFor();
      await page.screenshot({ path: path.join(output, scenario.sampleDelayMs ? 'sampling-phase.png' : 'encoding-phase.png') });
    }
    await page.waitForFunction(() => window.phoneLifecycle.state.savedCaptures.length === 1, null, { timeout: 10000 });
    await page.waitForTimeout(1600);
    const result = await page.evaluate(async () => {
      const check = window.captureCheck;
      const lifecycle = window.phoneLifecycle.state;
      const url = lifecycle.sales[0].imageUrl;
      let jpeg = null;
      if (url) {
        const response = await fetch(url);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const image = new Image(); image.src = url; await image.decode();
        jpeg = { mime: response.headers.get('content-type'), first: [...bytes.slice(0, 2)],
          last: [...bytes.slice(-2)], width: image.naturalWidth, height: image.naturalHeight, size: bytes.length };
      }
      return { ...check, savedCaptures: lifecycle.savedCaptures, captureStatus: lifecycle.sales[0].captureStatus,
        pendingClaims: lifecycle.captureClaims.filter(items => items.length).length,
        diagnostics: JSON.parse(localStorage.getItem(`voicecap-phone-capture-diagnostics:${lifecycle.workspace}`) || '[]'),
        visibleCamera: !!document.querySelector('.touch-phone-shot:not(.touch-phone-shot-idle)'),
        videoHasStream: !!document.querySelector('.touch-phone-shot video')?.srcObject, jpeg };
    });
    const ui = result.events.filter(event => event.name === 'ui');
    const intervals = ui.flatMap((event, i) => ui[i + 1] ? [{ phase: event.phase, ms: ui[i + 1].at - event.at }] : []);
    result.clickMs = Math.round(intervals.filter(item => item.phase === '찰칵').reduce((sum, item) => sum + item.ms, 0));
    result.processingMs = Math.round(intervals.filter(item => item.phase === '사진 처리 중').reduce((sum, item) => sum + item.ms, 0));
    result.name = scenario.name;
    assert.equal(result.canvasToBlobCalls, 0, `${scenario.name}: touched main-thread toBlob`);
    assert.equal(result.streams, 1, `${scenario.name}: repeated capture started`);
    assert.equal(result.stoppedTracks, 1, `${scenario.name}: acquired camera track was not stopped exactly once`);
    assert.equal(result.savedCaptures.length, 1);
    assert.equal(result.diagnostics.length, 1, `${scenario.name}: expected one persisted capture timing record`);
    const diagnostic = result.diagnostics[0];
    for (const [phase, ms] of Object.entries(diagnostic.timings))
      assert.ok(Number.isFinite(ms) && ms >= 0, `${scenario.name}: invalid ${phase} timing`);
    assert.ok(diagnostic.timings.totalMs < 10000, `${scenario.name}: capture exceeded the regression budget`);
    assert.doesNotMatch(JSON.stringify(diagnostic), /data:image|꽃미|저 그거두/, 'timing record contains image/customer content');
    assert.equal(result.visibleCamera, false);
    assert.deepEqual(errors, [], `${scenario.name}: browser errors`);
    if (scenario.rejectPlay) {
      assert.equal(result.savedCaptures[0].hasImage, false);
      assert.equal(result.captureStatus, 'MISSING');
      assert.equal(diagnostic.status, 'FAILED');
      assert.equal(result.videoHasStream, false, 'rejected video.play left srcObject attached');
      await page.getByRole('alert').filter({ hasText: '사진을 찍지 못했습니다' }).waitFor();
      checks.push('video.play rejection stops and detaches the acquired camera stream and leaves a retryable missing photo');
    } else {
      assert.equal(result.captureStatus, 'CAPTURED');
      assert.equal(diagnostic.status, 'CAPTURED');
      assert.deepEqual(result.jpeg.first, [255, 216]);
      assert.deepEqual(result.jpeg.last, [255, 217]);
      assert.match(result.jpeg.mime, /image\/jpeg/);
      assert.equal(result.jpeg.width, 1280);
      assert.equal(result.jpeg.height, 960);
      assert.ok(result.jpeg.size > 1000);
      assert.ok(result.clickMs < 1500, `${scenario.name}: sampling caption lasted ${result.clickMs}ms`);
      assert.equal(result.workers, result.terminatedWorkers, `${scenario.name}: worker was not disposed`);
      if (scenario.workerMode) {
        assert.equal(result.fallbackCalls, 1, `${scenario.name}: expected exactly one fallback`);
        checks.push(`${scenario.name}: fallback saves one valid JPEG without main-thread toBlob`);
      } else {
        assert.equal(result.workers, 1);
        assert.equal(result.workerPosts, 1);
        assert.equal(result.fallbackCalls, 0, `${scenario.name}: expected worker encoder`);
        if (scenario.workerDelayMs || scenario.sampleDelayMs) {
          assert.ok(result.processingMs >= 600, `processing caption was only ${result.processingMs}ms`);
          const samples = result.videoSamples.filter(sample => sample.phase === '사진 처리 중');
          assert.ok(samples.length >= 3);
          assert.ok(samples.at(-1).currentTime - samples[0].currentTime > 0.3, 'camera feed stopped during encoding');
          assert.ok(samples.at(-1).frames > samples[0].frames, 'no fresh camera frames during encoding');
          if (scenario.sampleDelayMs) {
            assert.equal(result.delayedSampleGaps, 2, 'expected both real frame sampling gaps to be delayed');
            assert.ok(diagnostic.timings.samplingMs >= 2100, 'persisted sampling timing omitted the injected gaps');
            assert.ok(result.clickMs < 900, `slow sampling held 찰칵 for ${result.clickMs}ms`);
            checks.push('slow frame sampling changes 찰칵 to 사진 처리 중 within one second and still saves exactly one JPEG');
          } else {
            assert.ok(diagnostic.timings.encodingMs >= 800, 'persisted encoding timing omitted the injected delay');
            checks.push('delayed encoding displays 사진 처리 중 while video keeps moving; 찰칵 ends after sampling');
          }
        } else checks.push('real worker saves a single valid JPEG even when main-thread toBlob never invokes its callback');
      }
    }
    measurements.push(result);
    await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify({ scenario: scenario.name, clickMs: result.clickMs, processingMs: result.processingMs,
      timings: diagnostic.timings,
      workers: result.workers, fallbackCalls: result.fallbackCalls, saved: result.savedCaptures.length, jpegBytes: result.jpeg?.size }));
    await context.close();
  }
  const report = { passed: checks.length, checks, scope: 'real browser camera/JPEG/worker/UI with synthetic stream and isolated backend/printer' };
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.close();
  await browserServer?.kill();
}
