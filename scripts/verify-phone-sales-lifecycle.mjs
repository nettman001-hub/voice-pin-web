import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Start scripts/serve-phone-sales-lifecycle.mjs, then call this from an existing
 * ego-browser task with its Page handle. The fixture uses the production page,
 * producer, durable outbox and label renderer; external services are isolated.
 */
export async function verifyPhoneSalesLifecycle(page, { url = 'http://127.0.0.1:43188/' } = {}) {
  const checks = [];
  const state = () => page.evaluate(() => ({
    calls: [...window.phoneLifecycle.state.runCalls],
    commits: window.phoneLifecycle.state.commits,
    printAcks: [...window.phoneLifecycle.state.printAcks],
    captures: [...window.phoneLifecycle.state.savedCaptures],
  }));
  const assertActive = async (screen) => {
    const value = await state();
    assert.equal(value.calls.filter(kind => kind === 'START').length, 1, screen);
    assert.equal(value.calls.includes('STOP'), false, `${screen} stopped the phone producer`);
  };
  const start = async () => {
    await page.click('loc=css:.touch-phone-offer button');
    await page.waitForSelector('loc=css:.touch-phone-start');
    await page.click('text="지금 회차 이어서 판매"');
    await page.waitForSelector('loc=css:.touch-phone-stop');
  };
  await page.goto(url);
  await page.waitForSelector('loc=css:.touch-phone-offer button');
  console.log(await page.snapshot());
  await start();
  await page.evaluate(() => window.phoneLifecycle.comment());
  await page.waitForSelector('loc=css:[data-comment-id="comment-1"]');
  await page.click('loc=css:[data-comment-id="comment-1"]');
  await page.click('text="확인"');
  await page.waitForSelector('loc=css:.touch-price-screen');
  await assertActive('price entry');
  assert.equal(await page.evaluate(() => document.body.innerText.includes('PC')), false);
  checks.push('opening price entry preserves the phone run and has no PC-only copy');
  for (const key of ['1', '.', '5']) await page.click(`loc=css:.touch-keypad button:text-is("${key}")`);
  await page.click('loc=css:.touch-confirm-price');
  await page.waitForFunction(() => window.phoneLifecycle.state.commits === 1);
  await page.waitForSelector('loc=css:.touch-top-tabs');
  await assertActive('sale commit');
  await page.waitForFunction(() =>
    window.phoneLifecycle.state.printAcks.includes('SUCCESS') &&
    window.phoneLifecycle.state.savedCaptures.some(capture => capture.hasImage));
  checks.push('15,000원 sale commits while the same native producer prints and saves its photo');
  await page.click('text="판매내역"');
  await page.waitForSelector('loc=css:.touch-sale-row');
  await page.click('loc=css:.touch-sale-row');
  await page.waitForSelector('loc=css:.touch-detail-content');
  await assertActive('sale detail');
  await page.click('loc=css:button[aria-label="판매내역으로 돌아가기"]');
  await page.waitForSelector('loc=css:.touch-top-tabs');
  await page.click('loc=css:button[aria-label="계정 보기"]');
  await page.waitForSelector('loc=css:[role="dialog"][aria-label="계정"]');
  await assertActive('account dialog');
  await page.click('loc=css:[role="dialog"][aria-label="계정"] button:text-is("닫기")');
  await page.waitForSelector('loc=css:.touch-phone-stop');
  await assertActive('back to history');
  checks.push('detail, back navigation and account dialog keep the active producer mounted');
  await page.click('loc=css:.touch-phone-stop');
  await page.waitForFunction(() => window.phoneLifecycle.state.runCalls.filter(kind => kind === 'STOP').length === 1);
  await start();
  await page.evaluate(() => window.phoneLifecycle.unmount());
  await page.waitForFunction(() => window.phoneLifecycle.state.runCalls.filter(kind => kind === 'STOP').length === 2);
  checks.push('explicit stop and actual page unmount each stop the producer exactly once');

  await page.goto(`${url}?blocked=1`);
  await page.waitForSelector('loc=css:.touch-phone-offer button');
  await start();
  await page.click('text="판매내역"');
  await page.waitForSelector('text="판매 연결 후 다시 저장"');
  assert.equal(await page.evaluate(() => document.body.innerText.includes('PC')), false, 'legacy blocked request leaked a PC-only instruction');
  const original = await page.evaluate(() => window.phoneLifecycle.seededSale);
  assert.equal((await state()).commits, 0, 'blocked request was replayed without user action');
  await page.click('text="판매 연결 후 다시 저장"');
  await page.waitForFunction(async () =>
    window.phoneLifecycle.state.commits === 1 && (await window.phoneLifecycle.outbox()).length === 0);
  const retried = await page.evaluate(() => window.phoneLifecycle.state.lastCommittedSale);
  assert.deepEqual(retried, original, 'retry changed operation ID, confirmation time or sale payload');
  assert.equal((await state()).calls.includes('STOP'), false);
  checks.push('same-session blocked request retries only after a tap with the exact original payload');
  await page.click('loc=css:.touch-phone-stop');
  await page.waitForFunction(() => !window.phoneLifecycle.state.run.running);
  const output = { passed: checks.length, checks, date: new Date().toISOString(), scope: 'isolated backend, real phone selling UI/producer/outbox; no production writes or printer' };
  const directory = path.join(fileURLToPath(new URL('../', import.meta.url)), 'artifacts/phone-sales-lifecycle');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'browser-checks.json'), JSON.stringify(output, null, 2));
  return output;
}
