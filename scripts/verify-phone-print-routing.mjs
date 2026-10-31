import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Real phone UI/producer and PC relay service share an isolated API and helper.
// Database concurrency is covered by the SQL tests, not this deterministic mock.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tools/phone-print-routing');
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
  await page.goto(url);
  await page.locator('.touch-phone-offer button').click();
  const setup = page.getByRole('dialog', { name: '폰으로 판매 시작' });
  await setup.getByRole('radio', { name: 'PC 판매도우미', exact: true }).check();
  const start = setup.getByRole('button', { name: '지금 회차 이어서 판매', exact: true });
  assert.equal(await start.isDisabled(), true, 'PC output must wait for relay readiness');
  await page.evaluate(async () => { await window.phoneLifecycle.startRelay(); window.dispatchEvent(new Event('focus')); });
  await setup.getByText(/PC 전표 대기 연결됨/).waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    runs: window.phoneLifecycle.state.runCalls, captures: window.phoneLifecycle.state.captureClaimOwners,
  })), { runs: [], captures: [] }, 'starting only the relay must not claim the phone run or camera');
  await page.screenshot({ path: path.join(output, 'pc-output-ready.png'), fullPage: true });
  checks.push('phone PC-output start waits for a ready relay; relay activation does not take the sale or capture lease');
  await page.evaluate(() => { window.phoneLifecycle.state.helperHold = true; });
  await start.click();
  await page.locator('.touch-phone-stop').waitFor();
  await page.waitForFunction(() => window.phoneLifecycle.state.run.settings.printTarget === 'PC_HELPER');
  const owner = await page.evaluate(() => window.phoneLifecycle.state.run.producer_id);
  const nativeBefore = await page.evaluate(() => window.phoneLifecycle.state.nativeWrites);
  const sell = async n => {
    await page.evaluate(n => window.phoneLifecycle.comment(`route-${n}`, `고객${n}`, `구매 ${n}`), n);
    await page.locator(`[data-comment-id="route-${n}"]`).click();
    await page.getByRole('button', { name: '확인', exact: true }).click();
    for (const key of ['1', '.', '5']) await page.locator('.touch-keypad').getByRole('button', { name: key, exact: true }).click();
    await page.locator('.touch-confirm-price').click();
    await page.waitForFunction(count => window.phoneLifecycle.state.commits === count, n);
  };
  const waitPhoto = async count => {
    await page.waitForFunction(n => window.phoneLifecycle.state.savedCaptures.length === n, count);
    await page.locator('.touch-phone-shot:not(.touch-phone-shot-idle)').waitFor({ state: 'hidden' });
  };
  const openSwitch = async () => {
    await page.getByRole('button', { name: '출력 위치 변경', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '출력 위치 변경' });
    await dialog.getByRole('radio', { name: '폰 블루투스', exact: true }).check();
    return dialog;
  };
  await sell(1);
  await page.waitForFunction(() => window.phoneLifecycle.state.helperPrints.length === 1 && window.phoneLifecycle.state.printJobs[0].status === 'SUBMITTING');
  await waitPhoto(1);
  const first = await page.evaluate(() => ({
    helper: window.phoneLifecycle.state.helperPrints[0], nativeWrites: window.phoneLifecycle.state.nativeWrites,
    photo: window.phoneLifecycle.state.savedCaptures[0], frames: window.phoneLifecycle.state.captureFrames,
  }));
  assert.equal(first.helper.buyerNickname, '고객1');
  assert.equal(first.helper.amount, 15000);
  assert.equal(first.helper.saleId, 'sale-1');
  assert.match(first.helper.sessionId, /회차/);
  assert.equal(first.nativeWrites, nativeBefore, 'PC sale was also sent to the phone printer');
  assert.equal(first.photo.producerId, owner);
  assert.equal(first.photo.hasImage, true);
  assert.equal(first.frames, 1);
  checks.push('a PC-routed sale reaches the real relay once while the original phone captures exactly one photo');
  let change = await openSwitch();
  await change.getByRole('button', { name: '대기 전표부터 적용', exact: true }).click();
  await change.getByRole('alert').filter({ hasText: '출력 중인 전표' }).waitFor();
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.run.settings.printTarget), 'PC_HELPER');
  await page.screenshot({ path: path.join(output, 'switch-blocked-during-print.png'), fullPage: true });
  await page.evaluate(() => window.phoneLifecycle.releaseHelper());
  await page.waitForFunction(() => window.phoneLifecycle.state.printJobs[0].status === 'SUBMITTED');
  await change.getByRole('button', { name: '닫기', exact: true }).click();
  checks.push('switching during helper submission is rejected without changing output; the original job still acknowledges once');

  await page.evaluate(() => { window.phoneLifecycle.state.pauseRelayClaims = true; });
  await sell(2);
  await waitPhoto(2);
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.printJobs[1].status), 'QUEUED');
  change = await openSwitch();
  await change.getByRole('button', { name: '대기 전표부터 적용', exact: true }).click();
  await change.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.phoneLifecycle.state.printJobs[1].status === 'SUBMITTED');
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.run.settings.printTarget), 'PHONE_BLUETOOTH');
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.printJobs[1].target), 'PHONE_BLUETOOTH');
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.helperPrints.length), 1);
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.nativeWrites), nativeBefore + 1);
  checks.push('an unstarted queued PC receipt moves to Bluetooth after a successful live switch without replaying the printed PC receipt');

  await page.evaluate(() => { window.phoneLifecycle.state.pauseRelayClaims = false; window.phoneLifecycle.wakeRelay(); });
  await sell(3);
  await waitPhoto(3);
  await page.waitForFunction(() => window.phoneLifecycle.state.printJobs[2].status === 'SUBMITTED');
  await page.waitForTimeout(1200);
  const final = await page.evaluate(() => ({
    calls: window.phoneLifecycle.state.runCalls, owner: window.phoneLifecycle.state.run.producer_id,
    comments: window.phoneLifecycle.state.commits, nativeWrites: window.phoneLifecycle.state.nativeWrites,
    helperPrints: window.phoneLifecycle.state.helperPrints.length, frames: window.phoneLifecycle.state.captureFrames,
    photos: window.phoneLifecycle.state.savedCaptures, captureOwners: [...new Set(window.phoneLifecycle.state.captureClaimOwners)],
    acks: window.phoneLifecycle.state.printAcks, transitions: window.phoneLifecycle.state.printTransitions,
    relayErrors: window.phoneLifecycle.state.relayErrors,
  }));
  assert.equal(final.calls.filter(kind => kind === 'START').length, 1);
  assert.equal(final.calls.includes('STOP'), false);
  assert.equal(final.owner, owner);
  assert.equal(final.comments, 3);
  assert.equal(final.nativeWrites, nativeBefore + 2);
  assert.equal(final.helperPrints, 1);
  assert.equal(final.frames, 3);
  assert.equal(final.photos.length, 3);
  assert.ok(final.photos.every(photo => photo.producerId === owner && photo.hasImage));
  assert.deepEqual(final.captureOwners, [owner]);
  assert.deepEqual(final.acks, ['SUCCESS', 'SUCCESS', 'SUCCESS']);
  assert.deepEqual(final.relayErrors, []);
  assert.equal(final.transitions.filter(item => item.kind === 'BEGIN').length, 3);
  assert.equal(final.transitions.filter(item => item.kind === 'ACK').length, 3);
  await page.screenshot({ path: path.join(output, 'bluetooth-after-live-switch.png'), fullPage: true });
  checks.push('later comments, Bluetooth receipts and photos continue without restarting the phone producer or moving camera ownership');
  await page.evaluate(async () => { await window.phoneLifecycle.stopRelay(); window.phoneLifecycle.unmount(); });
  await page.waitForFunction(() => !window.phoneLifecycle.state.run?.running);
  assert.deepEqual(errors, [], 'browser page errors');
  const result = { passed: checks.length, checks, scope: 'real phone UI/producer + PC relay service, isolated backend/helper/camera; SQL tests cover database races' };
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  fixture.kill();
  await browserServer?.kill();
}
