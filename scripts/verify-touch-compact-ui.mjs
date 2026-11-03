import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Real phone UI/producer and PC relay service share an isolated API and helper.
// Database concurrency is covered by the SQL tests, not this deterministic mock.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tools/touch-compact-ui');
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

  await page.goto(`${url}?shell=1`);
  await page.locator('.touch-phone-offer button').click();
  await page.getByRole('button', { name: '지금 회차 이어서 판매', exact: true }).click();
  await page.locator('.touch-phone-stop').waitFor();
  assert.deepEqual(await page.locator('.touch-selection-bar > div button').allTextContents(), ['판매', '관리', '취소', '확인']);
  assert.equal(await page.locator('.touch-app-navigation').count(), 0);
  await page.locator('.touch-selection-bar').getByRole('button', { name: '관리', exact: true }).click();
  await page.getByText('관리 화면', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.nativeTab), 'manage');
  await page.locator('.touch-app-navigation').getByRole('button', { name: '판매', exact: true }).click();
  await page.locator('.touch-selection-bar').waitFor();
  assert.equal(await page.getByText(/깜빡이는 구매 댓글/).count(), 0);
  const before = await page.locator('.touch-comment-scroll').evaluate(el => el.clientHeight);
  await page.getByRole('button', { name: '판매 설정 숨기기' }).click();
  assert.equal(await page.getByRole('textbox', { name: '닉네임 검색' }).isVisible(), false);
  const after = await page.locator('.touch-comment-scroll').evaluate(el => el.clientHeight);
  assert.ok(after > before);
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.runCalls.includes('STOP')), false);
  await page.screenshot({ path: path.join(output, 'collapsed.png'), fullPage: true });
  await page.getByRole('button', { name: '판매 설정 펼치기' }).click();
  checks.push('compact actions ordered sell/manage/cancel/confirm; collapse gains comment space without stopping producer');
  await page.evaluate(() => window.phoneLifecycle.comment('compact-1', '꽃미', '저요'));
  const comment = page.locator('[data-comment-id="compact-1"]');
  await comment.click();
  await page.locator('.touch-selection-bar').getByRole('button', { name: '확인', exact: true }).click();
  await page.locator('.touch-price-screen').waitFor();
  const keypad = page.locator('.touch-keypad');
  const y = (await keypad.boundingBox()).y;
  for (const key of ['0', '.']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
    assert.equal((await keypad.boundingBox()).y, y);
    assert.equal(await page.locator('.touch-price-validation').innerText(), '');
    assert.equal(await page.locator('.touch-confirm-price').isDisabled(), true);
  }
  await page.getByRole('button', { name: '가격 모두 지우기' }).click();
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  assert.ok((await page.locator('.touch-price-product').innerText()).includes('1번'));
  await page.locator('.touch-confirm-price').click();
  await page.waitForFunction(() => window.phoneLifecycle.state.commits === 1 && window.phoneLifecycle.state.savedCaptures.length === 1);
  await page.locator('.touch-phone-shot:not(.touch-phone-shot-idle)').waitFor({ state: 'hidden' });
  checks.push('zero and decimal intermediate input keep keypad fixed and confirmation disabled; unnamed product previews 1번');
  await comment.click();
  await page.locator('.touch-selection-bar').getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('heading', { name: '판매 상세', exact: true }).waitFor();
  assert.equal(await page.locator('.touch-app-navigation').isVisible(), true);
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.commits), 1);
  await page.getByRole('button', { name: '키핑하기', exact: true }).click();
  await page.getByRole('button', { name: '키핑 중', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.keeping[0].totalAmount), 10000);
  await page.screenshot({ path: path.join(output, 'keeping-detail.png'), fullPage: true });
  await page.getByRole('button', { name: '판매내역으로 돌아가기' }).click();
  await page.evaluate(() => {
    const s = window.phoneLifecycle.state.sales[0];
    window.phoneLifecycle.state.sales.unshift({ ...s, id: 'compact-second', amount: 20000, productName: '2번' });
  });
  await page.getByRole('button', { name: '판매내역', exact: true }).click();
  await page.getByText('오늘합계 30,000원').first().waitFor();
  assert.ok(await page.getByText('전표O', { exact: true }).count());
  await page.locator('.touch-sale-row').filter({ hasText: '20,000원' }).click();
  await page.getByText('기존 키핑 · 10,000원').waitFor();
  await page.getByRole('button', { name: '키핑하기', exact: true }).click();
  await page.getByRole('button', { name: '키핑 중', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({ count: window.phoneLifecycle.state.keeping[0].saleIds.length, amount: window.phoneLifecycle.state.keeping[0].totalAmount })), { count: 2, amount: 30000 });
  checks.push('confirmed comment opens existing detail; keeping adds without losing prior sale; repeat buyer total and compact print badge shown');
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.phoneLifecycle.unmount());
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  fixture.kill();
  await browserServer?.kill();
}
