import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = process.cwd(),
  artifactDir = path.join(root, 'artifacts', 'touch-sales');
fs.mkdirSync(artifactDir, { recursive: true });
const mock = path.join(root, 'test/fixtures/touchBrowserMock.ts');
const result = await build({
  entryPoints: ['test/fixtures/touchBrowserApp.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'isolated-touch-fixtures',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /\/(AuthContext|touchSalesApi|supabaseClient|productSalesApi)$/,
          },
          () => ({ path: mock }),
        );
      },
    },
  ],
});
const js = result.outputFiles[0].text,
  css = fs.readFileSync('src/styles/touchSales.css', 'utf8');
const server = http.createServer((req, res) => {
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(js);
    return;
  }
  if (req.url === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(css);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}button{font-family:inherit}</style><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let executablePath =
  process.env.VOICECAP_CHROMIUM_PATH || chromium.executablePath();
if (!fs.existsSync(executablePath) && process.platform === 'win32') {
  const cache = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'),
    'ms-playwright',
  );
  for (const folder of fs
    .readdirSync(cache)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
    const candidate = path.join(cache, folder, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(candidate)) {
      executablePath = candidate;
      break;
    }
  }
}
const browser = await chromium.launch({ headless: true, executablePath });
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('[data-comment-id="c"]');
  await page.waitForFunction(() => window.touchTest.pc.transport === 'DIRECT');
  checks.push('actual browser RTCPeerConnection reaches DIRECT');
  assert.equal(await page.locator('.touch-purchase-flash').count(), 3);
  await page.screenshot({
    path: path.join(artifactDir, '01-purchase-alerts.png'),
  });
  await page.locator('[data-comment-id="a"]').tap();
  assert.equal(await page.locator('.touch-purchase-flash').count(), 0);
  assert.equal(await page.locator('.touch-comment-selected').count(), 1);
  checks.push(
    'one purchase tap stops every current row alert and selects exactly one row',
  );
  await page.evaluate(() => window.touchTest.add('new', '새고객', '저요'));
  await page.waitForSelector('[data-comment-id="new"].touch-purchase-flash');
  await page.locator('[data-comment-id="talk"]').tap();
  assert.equal(await page.locator('.touch-purchase-flash').count(), 1);
  await page.locator('[data-comment-id="a"]').tap();
  assert.equal(await page.locator('.touch-purchase-flash').count(), 1);
  checks.push(
    'only new purchases flash; ordinary and acknowledged rows do not clear them',
  );
  await page.locator('[data-comment-id="new"]').tap();
  await page.getByRole('button', { name: '확인', exact: true }).tap();
  for (const key of ['1', '.', '5'])
    await page.getByRole('button', { name: key, exact: true }).tap();
  assert.equal(
    await page.locator('.touch-amount-result').textContent(),
    '= 15,000원',
  );
  await page.screenshot({ path: path.join(artifactDir, '02-price-input.png') });
  await page
    .getByRole('button', { name: '확정 · 15,000원', exact: true })
    .tap();
  await page.waitForSelector('.touch-toast');
  await page.getByRole('button', { name: '판매내역', exact: true }).tap();
  await page.waitForSelector('.touch-sale-row');
  assert.equal(
    await page.evaluate(() => window.touchTest.state.sales.length),
    1,
  );
  checks.push('real price pad converts 1.5 and creates one durable-queue sale');
  await page.locator('.touch-toast').waitFor({ state: 'hidden', timeout: 5000 });
  await page.screenshot({
    path: path.join(artifactDir, '03-sales-history.png'),
  });
  await page.locator('.touch-sale-row').first().tap();
  await page.waitForSelector('.touch-detail-content');
  await page.screenshot({ path: path.join(artifactDir, '04-sale-detail.png') });
  await page.getByRole('button', { name: '판매내역으로 돌아가기' }).tap();
  await page.getByRole('button', { name: '판매하기', exact: true }).tap();
  await page.locator('[data-comment-id="b"]').tap();
  await page.getByRole('button', { name: '확인', exact: true }).tap();
  for (const key of ['0', '.', '8'])
    await page.getByRole('button', { name: key, exact: true }).tap();
  await page.evaluate(() => {
    window.touchTest.state.replyLost = true;
  });
  await page
    .getByRole('button', { name: '확정 · 8,000원', exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page.waitForSelector('.touch-top-tabs');
  await page.reload();
  await page.waitForSelector('[data-comment-id="a"]');
  await page.getByRole('button', { name: '판매내역', exact: true }).tap();
  await page.waitForFunction(() => window.touchTest.state.commits >= 3);
  assert.equal(
    await page.evaluate(() => window.touchTest.state.sales.length),
    2,
  );
  assert.equal(
    await page.evaluate(() => window.touchTest.state.operations.size),
    2,
  );
  const ids = await page.evaluate(() => window.touchTest.state.requestIds);
  assert.equal(ids.at(-1), ids.at(-2));
  checks.push(
    'double tap and reload after a lost server reply replay the same durable operation exactly once',
  );
  await page.getByRole('button', { name: '판매하기', exact: true }).tap();
  await page.evaluate(() => window.touchTest.forceFallback());
  await page.waitForFunction(
    () => window.touchTest.pc.transport === 'FALLBACK',
    { timeout: 10000 },
  );
  await page.evaluate(() =>
    window.touchTest.add('fallback', '예비고객', '저요'),
  );
  await page.waitForSelector('[data-comment-id="fallback"]');
  assert.equal(await page.locator('[data-comment-id="a"]').count(), 1);
  checks.push(
    'WebRTC disconnect switches to Broadcast without duplicate comments',
  );
  assert.equal(
    await page.evaluate(() =>
      window.touchTest.pc.send({
        kind: 'audio',
        samples: [{ at: Date.now(), value: 0.1 }],
      }),
    ),
    false,
  );
  checks.push('audio envelopes are blocked from fallback transport');
  assert.equal(
    await page.evaluate(() =>
      window.touchTest.state.channelConfigs
        .filter((c) => c.name.startsWith('touch-sales:'))
        .every((c) => c.config?.config?.private === true),
    ),
    true,
  );
  checks.push(
    'signaling and fallback always request a private authenticated channel',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('[data-comment-id="fallback"]')
      .evaluate((el) => getComputedStyle(el).animationName),
    'none',
  );
  checks.push('reduced motion uses a static visible alert');
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks.push('390px phone layout has no horizontal overflow');
  assert.deepEqual(errors, []);
  checks.push('no browser runtime errors');
  await page.evaluate(() => window.touchTest.restartPc());
  await page.waitForSelector('[data-comment-id="restarted"]', {
    timeout: 12000,
  });
  assert.equal(await page.locator('[data-comment-id="a"]').count(), 0);
  checks.push(
    'PC replacement resets the old sequence snapshot within the same broadcast',
  );
  await context.close();
  const blocked = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  await blocked.addInitScript(() => {
    window.RTCPeerConnection = class {
      constructor() {
        throw new Error('fixture blocks WebRTC');
      }
    };
  });
  const fallback = await blocked.newPage();
  await fallback.goto(`http://127.0.0.1:${server.address().port}/`);
  await fallback.waitForSelector('[data-comment-id="a"]', { timeout: 10000 });
  await fallback.waitForFunction(
    () => window.touchTest.pc.transport === 'FALLBACK',
  );
  checks.push(
    'initial WebRTC failure still receives the full comment snapshot through fallback',
  );
  await blocked.close();
  fs.writeFileSync(
    path.join(artifactDir, 'browser-checks.json'),
    JSON.stringify(
      {
        checks,
        passed: checks.length,
        date: new Date().toISOString(),
        scope:
          'isolated fixtures; real browser WebRTC and production phone UI; no operating account or printer',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, artifacts: artifactDir },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
