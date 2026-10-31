import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Real sale-detail UI with deterministic buyer responses. No account or backend writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tools/buyer-change-suggestions');
const fixture = spawn(process.execPath, ['scripts/serve-phone-sales-lifecycle.mjs'], {
  cwd: root, env: { ...process.env, PORT: '0' }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browserServer;
try {
  const url = await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${logs}`)), 20000);
    const collect = (data) => {
      logs += data.toString();
      const match = logs.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    fixture.stdout.on('data', collect);
    fixture.stderr.on('data', collect);
    fixture.once('error', (error) => { clearTimeout(timer); reject(error); });
    fixture.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${logs}`)); });
  });
  browserServer = await chromium.launchServer({ headless: true }).catch((error) => {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    return chromium.launchServer({ headless: true, channel: 'chrome' });
  });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  const checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fs.mkdir(output, { recursive: true });
  await page.goto(`${url}?buyerChange=1`);
  await page.getByRole('button', { name: '판매내역', exact: true }).click();
  await page.locator('.touch-sale-row').click();
  const open = async () => {
    await page.getByRole('button', { name: '구매자 변경', exact: true }).click();
    await page.getByRole('dialog', { name: '구매자 변경' }).waitFor();
  };
  const modal = page.getByRole('dialog', { name: '구매자 변경' });
  const input = modal.getByRole('textbox', { name: '구매자 이름 검색' });
  const options = modal.locator('.touch-buyer-option');
  const searchCalls = () => page.evaluate(() => [...window.phoneLifecycle.state.buyerSearchCalls]);
  await open();
  await modal.getByText('닉네임을 입력하면 추천 목록이 표시됩니다.').waitFor();
  await page.waitForTimeout(350);
  assert.deepEqual(await searchCalls(), []);
  assert.equal(await options.count(), 0);
  checks.push('opening the buyer dialog shows an input hint without searching an empty query');

  // Native Korean keyboards send input events throughout composition. No request
  // should run until compositionend, even when the debounce interval passes.
  await input.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await input.fill('ㅎ');
  await page.waitForTimeout(350);
  assert.deepEqual(await searchCalls(), []);
  await input.fill('하니');
  await page.waitForTimeout(350);
  assert.deepEqual(await searchCalls(), []);
  await input.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '하니' })));
  await options.filter({ hasText: '하니' }).waitFor();
  assert.deepEqual(await searchCalls(), ['하니']);
  assert.equal(await options.count(), 1);
  assert.match(await options.first().innerText(), /hani_shop/);
  await page.screenshot({ path: path.join(output, 'korean-suggestions.png'), fullPage: true });
  checks.push('Korean composition searches the completed nickname automatically without a search click');

  const callsBeforeClear = await searchCalls();
  await modal.getByRole('button', { name: '검색어 지우기' }).click();
  assert.equal(await input.inputValue(), '');
  await input.fill('   ');
  await modal.getByText('닉네임을 입력하면 추천 목록이 표시됩니다.').waitFor();
  await page.waitForTimeout(350);
  assert.equal(await options.count(), 0);
  assert.deepEqual(await searchCalls(), callsBeforeClear);
  await input.fill('존재하지않는닉네임');
  await page.waitForFunction(() => window.phoneLifecycle.state.buyerSearchCompleted.includes('존재하지않는닉네임'));
  await modal.getByText(/검색 결과가 없습니다|일치하는.*없|찾을 수 없/).waitFor();
  assert.equal(await options.count(), 0);
  checks.push('cleared or whitespace input removes suggestions without a request; unmatched nicknames show no results');

  await page.evaluate(() => window.phoneLifecycle.state.buyerSearchHolds.add('하'));
  await input.fill('하');
  await page.waitForFunction(() => window.phoneLifecycle.state.buyerSearchCalls.includes('하'));
  await input.fill('꽃');
  await options.filter({ hasText: '꽃미' }).waitFor();
  await page.evaluate(() => window.phoneLifecycle.releaseBuyerSearch('하'));
  await page.waitForFunction(() => window.phoneLifecycle.state.buyerSearchCompleted.includes('하'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await options.count(), 1);
  assert.match(await options.first().innerText(), /꽃미/);
  assert.doesNotMatch(await options.first().innerText(), /하니|하늘/);
  checks.push('a slower old query cannot overwrite the newer nickname suggestions');

  await page.evaluate(() => window.phoneLifecycle.state.buyerSearchHolds.add('지니'));
  await input.fill('지니');
  await page.waitForFunction(() => window.phoneLifecycle.state.buyerSearchCalls.includes('지니'));
  await modal.getByRole('button', { name: '닫기', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  await open();
  assert.equal(await input.inputValue(), '');
  await modal.getByText('닉네임을 입력하면 추천 목록이 표시됩니다.').waitFor();
  await page.evaluate(() => window.phoneLifecycle.releaseBuyerSearch('지니'));
  await page.waitForFunction(() => window.phoneLifecycle.state.buyerSearchCompleted.includes('지니'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await options.count(), 0);
  assert.equal(await input.inputValue(), '');
  checks.push('closing and reopening clears the input and ignores responses from the previous dialog');

  await page.evaluate(() => window.phoneLifecycle.state.buyerSearchErrors.add('오류'));
  await input.fill('오류');
  const searchError = modal.getByText('추천 닉네임을 불러오지 못했습니다. 다시 시도해 주세요.');
  await searchError.waitFor();
  assert.equal(await options.count(), 0);
  await input.fill('하니');
  await options.filter({ hasText: '하니' }).waitFor();
  assert.equal(await searchError.count(), 0);
  checks.push('a search error is displayed inside the dialog and a new query recovers');

  // Cancellation keeps the existing buyer; acceptance retains the established
  // revision/reprint update path and submits the suggested buyer's exact ID.
  let confirmation = '';
  page.once('dialog', (dialog) => { confirmation = dialog.message(); return dialog.dismiss(); });
  await options.filter({ hasText: '하니' }).click();
  assert.match(confirmation, /하니.*변경.*수정 전표/);
  assert.deepEqual(await page.evaluate(() => window.phoneLifecycle.state.updateCalls), []);
  page.once('dialog', (dialog) => dialog.accept());
  await options.filter({ hasText: '하니' }).click();
  await modal.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.phoneLifecycle.state.updateCalls), [{
    kind: 'BUYER', saleId: 'buyer-change-sale', expectedRevision: 1,
    buyerId: '33333333-3333-4333-8333-333333333331', reprint: true,
  }]);
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.sales[0].buyerNickname), '하니');
  assert.match(await page.locator('.touch-detail-content').innerText(), /하니/);
  await page.screenshot({ path: path.join(output, 'buyer-updated.png'), fullPage: true });
  checks.push('choosing a suggestion requires confirmation and updates only the selected buyer with revision and reprint');

  // Production search can omit platformUniqueId. Duplicate nicknames must still
  // be distinguishable by the returned account ID, and selection must use buyer ID.
  await open();
  await input.fill('소라');
  await options.filter({ hasText: '계정 ID: 718000000000000002' }).waitFor();
  assert.equal(await options.count(), 2);
  assert.match(await options.nth(0).innerText(), /소라[\s\S]*계정 ID: 718000000000000001/);
  assert.match(await options.nth(1).innerText(), /소라[\s\S]*계정 ID: 718000000000000002/);
  await page.screenshot({ path: path.join(output, 'duplicate-nickname-suggestions.png'), fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await options.filter({ hasText: '계정 ID: 718000000000000002' }).click();
  await modal.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.phoneLifecycle.state.updateCalls.at(-1)), {
    kind: 'BUYER', saleId: 'buyer-change-sale', expectedRevision: 2,
    buyerId: '33333333-3333-4333-8333-333333333336', reprint: true,
  });
  assert.equal(await page.evaluate(() => window.phoneLifecycle.state.sales[0].buyerId), '33333333-3333-4333-8333-333333333336');
  checks.push('duplicate nicknames without unique handles show distinct account IDs and update the exact selected buyer');
  assert.deepEqual(errors, [], 'browser page errors');
  const result = { passed: checks.length, checks, scope: 'headless browser; real sale UI, isolated buyer API' };
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  fixture.kill();
  await browserServer?.kill();
}
