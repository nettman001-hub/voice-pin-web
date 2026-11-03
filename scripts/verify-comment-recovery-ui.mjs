import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Real phone UI/producer and PC relay service share an isolated API and helper.
// Database concurrency is covered by the SQL tests, not this deterministic mock.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tools/comment-recovery');
const fixture = spawn(process.execPath, ['scripts/serve-phone-sales-lifecycle.mjs'], {
  cwd: root, env: { ...process.env, PORT: '0' }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browserServer;
try {
  const url = await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${logs}`)), 20000);
    const collect = data => {
      logs += data.toString();
      const match = logs.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    fixture.stdout.on('data', collect);
    fixture.stderr.on('data', collect);
    fixture.once('error', error => { clearTimeout(timer); reject(error); });
    fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${logs}`)); });
  });
  browserServer = await chromium.launchServer({ headless: true }).catch(error => {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    return chromium.launchServer({ headless: true, channel: 'chrome' });
  });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true });
  const page = await context.newPage();
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir(output, { recursive: true });

  const started = Date.now();
  await page.goto(url);
  await page.locator('.touch-phone-offer button').click();
  await page.getByRole('button', { name: '지금 회차 이어서 판매', exact: true }).click();
  await page.locator('.touch-phone-stop').waitFor();
  await page.evaluate(() => {
    window.phoneLifecycle.state.originalStream = window.phoneLifecycle.state.stream;
    window.phoneLifecycle.state.staleMessage = window.phoneLifecycle.state.stream.onmessage;
  });
  const sale = async (id, count) => {
    await page.evaluate(id => window.phoneLifecycle.comment(id, '회복고객', '저요'), id);
    await page.locator(`[data-comment-id="${id}"]`).click();
    await page.locator('.touch-selection-bar').getByRole('button', { name: '확인', exact: true }).click();
    await page.locator('.touch-keypad').getByRole('button', { name: '1', exact: true }).click();
    await page.locator('.touch-confirm-price').click();
    await page.waitForFunction(n => window.phoneLifecycle.state.printAcks.length === n && window.phoneLifecycle.state.savedCaptures.length === n, count);
    await page.locator('.touch-phone-shot:not(.touch-phone-shot-idle)').waitFor({ state: 'hidden' });
  };
  await sale('before-loss', 1);
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    await page.evaluate(i => window.phoneLifecycle.comment(`soak-${i}`, '테스트', '안녕하세요'), i);
    if (i % 2 === 1) console.log(JSON.stringify({ stage: 'receiving', elapsedSeconds: Math.round((Date.now()-started)/1000) }));
  }
  console.log(JSON.stringify({ stage: 'simulate-silent-socket', normalStreamingSeconds: 150 }));
  await page.waitForFunction(() => window.phoneLifecycle.state.stream !== window.phoneLifecycle.state.originalStream, null, { timeout: 105000 });
  await page.evaluate(() => window.phoneLifecycle.state.staleMessage({ data: JSON.stringify({ type: 'chat', data: { id: 'stale', content: 'late', user: { nickname: 'late' } } }) }));
  await sale('after-recovery', 2);
  assert.equal(await page.locator('[data-comment-id="stale"]').count(), 0);
  const state = await page.evaluate(() => ({ calls: window.phoneLifecycle.state.runCalls, acks: window.phoneLifecycle.state.printAcks,
    captures: window.phoneLifecycle.state.savedCaptures.length, disconnects: window.phoneLifecycle.state.printerDisconnects,
    diagnostics: JSON.parse(localStorage.getItem(`voicecap-comment-connection:${window.phoneLifecycle.state.workspace}`) || '[]') }));
  assert.equal(state.calls.filter(kind => kind === 'START').length, 1);
  assert.equal(state.calls.includes('STOP'), false);
  assert.deepEqual(state.acks, ['SUCCESS','SUCCESS']);
  assert.equal(state.captures, 2); assert.equal(state.disconnects, 0);
  assert.ok(state.diagnostics.some(d => d.reason === 'NO_FRAMES'));
  assert.deepEqual(errors, []);
  const report = { passed: true, elapsedSeconds: Math.round((Date.now()-started)/1000), checks: ['150 seconds normal streaming', 'silent socket recovered without close event', 'old connection events ignored', 'same sale run and printer retained', 'sales before and after recovery each print and capture once'] };
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(output, 'recovered.png'), fullPage: true });
  console.log(JSON.stringify(report, null, 2));
  await page.evaluate(() => window.phoneLifecycle.unmount());
} finally { fixture.kill(); await browserServer?.kill(); }
