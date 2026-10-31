import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Browser regression with the real selling UI/producer and isolated backend,
// camera and Android bridge. No account, camera, printer or production writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tools/phone-sales-recovery');
const server = spawn(process.execPath, ['scripts/serve-phone-sales-lifecycle.mjs'], {
  cwd: root, env: { ...process.env, PORT: '0' }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
let browserServer;
const checks = [];
try {
  const url = await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${logs}`)), 20000);
    const collect = (data) => {
      logs += data.toString();
      const match = logs.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${logs}`)); });
  });
  browserServer = await chromium.launchServer({ headless: true }).catch((error) => {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    return chromium.launchServer({ headless: true, channel: 'chrome' });
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  const newPage = async (query) => {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}${query}`);
    await page.locator('.touch-phone-offer button').waitFor();
    return page;
  };
  const start = async (page) => {
    await page.locator('.touch-phone-offer button').click();
    await page.getByRole('button', { name: '지금 회차 이어서 판매', exact: true }).click();
    await page.locator('.touch-phone-stop').waitFor();
  };
  const sell = async (page) => {
    await page.evaluate(() => window.phoneLifecycle.comment());
    await page.locator('[data-comment-id="comment-1"]').click();
    await page.getByRole('button', { name: '확인', exact: true }).click();
    for (const key of ['1', '.', '5'])
      await page.locator('.touch-keypad').getByRole('button', { name: key, exact: true }).click();
    await page.locator('.touch-confirm-price').click();
    await page.waitForFunction(() => window.phoneLifecycle.state.commits === 1);
  };
  const stop = async (page) => {
    await page.evaluate(() => window.phoneLifecycle.unmount());
    await page.waitForFunction(() => !window.phoneLifecycle.state.run?.running);
    await page.context().close();
  };

  const page = await newPage('?remembered=1&slowCapture=1');
  await start(page);
  await page.waitForFunction(() => document.querySelector('.touch-phone-bar')?.textContent.includes('연결됨 · M50-fixture'));
  assert.deepEqual(await page.evaluate(() => ({
    connected: window.phoneLifecycle.state.printerConnected,
    reconnects: window.phoneLifecycle.state.printerReconnects,
    picks: window.phoneLifecycle.state.printerPicks,
  })), { connected: true, reconnects: 1, picks: 0 });
  checks.push('remembered Android printer reconnects once without a picker and displays 연결됨');
  await sell(page);
  await page.waitForFunction(() => window.phoneLifecycle.state.captureFrames === 1);
  await page.locator('.touch-recent-card').waitFor();
  await page.screenshot({ path: path.join(output, 'capture-pending.png'), fullPage: true });
  await page.waitForFunction(() => window.phoneLifecycle.state.savedCaptures.length >= 1);
  await page.waitForFunction(() => !document.querySelector('.touch-recent-card'));
  // More than two claim cycles after completion catches a duplicate queued while
  // the first camera request was still in flight.
  await page.waitForTimeout(3500);
  assert.deepEqual(await page.evaluate(() => ({
    frames: window.phoneLifecycle.state.captureFrames,
    saves: window.phoneLifecycle.state.savedCaptures.length,
    repeatedClaims: window.phoneLifecycle.state.captureClaims.filter((items) => items.some((item) => item.capture_generation === 'capture-sale-1')).length,
  })).then(({ repeatedClaims, ...result }) => {
    assert.ok(repeatedClaims >= 2, 'fixture must re-offer the generation during the camera request');
    return result;
  }), { frames: 1, saves: 1 });
  assert.deepEqual(await page.evaluate(() => window.phoneLifecycle.state.printAcks), ['SUCCESS']);
  checks.push('repeated in-flight claims take and save exactly one photo and print one receipt');
  await page.screenshot({ path: path.join(output, 'capture-complete.png'), fullPage: true });
  checks.push('successful capture hides the entire recent-sale card and its actions');
  await page.getByRole('button', { name: '판매내역', exact: true }).click();
  await page.locator('.touch-sale-row').click();
  await page.getByRole('button', { name: '캡처 다시 찍기', exact: true }).click();
  await page.waitForFunction(() => window.phoneLifecycle.state.savedCaptures.length === 2);
  await page.waitForTimeout(3500);
  assert.deepEqual(await page.evaluate(() => ({
    resets: window.phoneLifecycle.state.captureResets,
    frames: window.phoneLifecycle.state.captureFrames,
    generations: window.phoneLifecycle.state.savedCaptures.map((item) => item.generation),
  })), { resets: 1, frames: 2, generations: ['capture-sale-1', 'capture-sale-1-retake-1'] });
  checks.push('deliberate retake from sale detail captures the new generation exactly once');
  await stop(page);

  const camera = await newPage('?cameraError=1');
  await start(camera);
  await sell(camera);
  const cameraWarning = camera.getByRole('alert').filter({ hasText: '사진을 찍지 못했습니다' });
  await cameraWarning.waitFor();
  await camera.screenshot({ path: path.join(output, 'camera-warning.png'), fullPage: true });
  await cameraWarning.getByRole('button', { name: '경고 닫기' }).click();
  await cameraWarning.waitFor({ state: 'detached' });
  await camera.waitForTimeout(1800);
  assert.equal(await cameraWarning.count(), 0);
  assert.equal(await camera.locator('.touch-recent-card').count(), 1);
  assert.equal(await camera.evaluate(() => window.phoneLifecycle.state.sales[0].captureStatus), 'MISSING');
  checks.push('camera failure warning dismisses while the failed photo remains available for retry');
  await stop(camera);

  const pending = await newPage('?pending=1');
  await start(pending);
  const queueWarning = pending.getByRole('alert').filter({ hasText: '서버 오류로 판매 저장' });
  await queueWarning.waitFor();
  const original = await pending.evaluate(() => window.phoneLifecycle.outbox());
  assert.equal(original.length, 1);
  await queueWarning.getByRole('button', { name: '경고 닫기' }).click();
  await queueWarning.waitFor({ state: 'detached' });
  // Existing retry timer reloads the same failure. Dismissal must remain stable.
  await pending.waitForTimeout(5500);
  assert.equal(await queueWarning.count(), 0);
  const queued = await pending.evaluate(() => window.phoneLifecycle.outbox());
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].sale, original[0].sale);
  assert.equal(queued[0].id, original[0].id);
  assert.equal(queued[0].blocked, false);
  await pending.getByRole('button', { name: '판매내역', exact: true }).click();
  await pending.screenshot({ path: path.join(output, 'pending-warning-dismissed.png'), fullPage: true });
  checks.push('dismissing a queued server warning preserves its operation and payload across retries');
  await stop(pending);
  assert.deepEqual(errors, [], 'browser page errors');
  const result = { passed: checks.length, checks, scope: 'headless browser; isolated backend, camera and native printer' };
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  server.kill();
  await browserServer?.kill();
}
