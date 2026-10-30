import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({
  absWorkingDir: root, entryPoints: ['test/fixtures/salesAppShellApp.tsx'], bundle: true,
  write: false, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'sales-app-shell-fixture', setup(builder) {
    builder.onResolve({ filter: /\/(AuthContext|touchSalesApi|supabaseClient|productSalesApi|remoteWorkspaceService)$/ },
      () => ({ path: path.join(root, 'test/fixtures/salesAppShellMock.tsx') }));
    builder.onResolve({ filter: /\/frontCamera$/ }, () => ({ path: 'camera', namespace: 'shell-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'shell-fixture' }, () => ({ contents: `
      export const startFrontCamera = async () => ({ getTracks: () => [{ stop() {} }] });
      export const grabSharpestFrame = async () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        return { blob, url: URL.createObjectURL(blob) };
      };` }));
  } }],
});
console.log('Sales app shell fixture built');
const server = http.createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(built.outputFiles[0].text); return; }
  if (request.url === '/style.css') { response.setHeader('content-type', 'text/css'); response.end(fs.readFileSync(path.join(root, 'src/styles/touchSales.css'))); return; }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
console.log('Sales app shell browser ready');
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = `http://127.0.0.1:${server.address().port}`;
const state = () => page.evaluate(() => ({
  ...window.salesAppTest.diagnostics,
  runs: [...window.salesAppTest.state.runCalls],
  prints: [...window.salesAppTest.state.printAcks], captures: [...window.salesAppTest.state.savedCaptures],
  streamStarts: window.salesAppTest.state.streamStarts, streamCloses: window.salesAppTest.state.streamCloses || 0,
}));
const tab = (value) => page.evaluate((tab) => window.salesAppTest.tab(tab), value);
const login = async () => {
  await page.locator('input[type=email]').fill('fixture@example.com');
  await page.locator('input[type=password]').fill('fixture-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
};
try {
  await page.goto(`${url}/app/sell`);
  console.log('Sales app entry loaded');
  await login();
  console.log('Single login completed');
  await page.locator('.touch-phone-offer button').click();
  await page.getByRole('button', { name: '지금 회차 이어서 판매', exact: true }).click();
  await page.locator('.touch-phone-stop').waitFor();
  await page.evaluate(() => window.salesAppTest.comment());
  await page.locator('[data-comment-id="comment-1"]').click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  for (const key of ['1', '.', '5']) await page.locator('.touch-keypad button').filter({ hasText: new RegExp(`^${key === '.' ? '\\.' : key}$`) }).click();
  await page.locator('.touch-confirm-price').click();
  await page.waitForFunction(() => window.salesAppTest.state.commits === 1);
  await tab('manage');
  await page.locator('[data-testid=management]').waitFor();
  assert.equal(await page.locator('[data-sales-app-page=sell]').isVisible(), false);
  await page.waitForFunction(() => window.salesAppTest.state.savedCaptures.some((capture) => capture.hasImage)
    && window.salesAppTest.state.printAcks.includes('SUCCESS'));
  await page.evaluate(() => window.salesAppTest.comment('during-manage', '관리중고객', '새댓글'));
  await page.locator('a').filter({ hasText: '판매 상세' }).click();
  assert.equal(await page.locator('[data-testid=route]').textContent(), '/sales/sale-1?source=manage#detail');
  await page.locator('a').filter({ hasText: '정산 이동' }).click();
  const deepRoute = '/settlement?period=current#totals';
  assert.equal(await page.locator('[data-testid=route]').textContent(), deepRoute);
  await tab('sell');
  await page.locator('.touch-phone-stop').waitFor();
  await page.locator('[data-comment-id="during-manage"]').waitFor();
  await tab('manage');
  await page.waitForFunction((route) => document.querySelector('[data-testid=route]').textContent === route, deepRoute);
  const active = await state();
  assert.equal(active.logins, 1);
  assert.equal(active.providerMounts, 1);
  assert.equal(active.providerUnmounts, 0);
  assert.equal(active.runs.filter((kind) => kind === 'START').length, 1);
  assert.equal(active.runs.includes('STOP'), false);
  assert.equal(active.streamStarts, 1);
  assert.equal(active.streamCloses, 0);
  assert.ok(active.prints.includes('SUCCESS'));
  assert.ok(active.captures.some((capture) => capture.hasImage));
  await page.goBack();
  await page.waitForFunction(() => location.pathname === '/app/sell');
  await page.waitForFunction(() => window.salesAppTest.diagnostics.tabs.at(-1) === 'sell');
  await tab('manage');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.waitForFunction(() => window.salesAppTest.state.runCalls.includes('STOP'));
  await tab('sell');
  await page.getByRole('heading', { name: 'VoiceCAP 로그인', exact: true }).waitFor();
  assert.equal((await state()).runs.filter((kind) => kind === 'STOP').length, 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: one login/provider/router; management keeps producer, comments, printer and delayed capture alive; deep routes/back restore native tabs; logout stops producer once');

  await context.clearCookies();
  await page.goto(`${url}/app/sell?initialTab=manage`);
  await page.getByRole('heading', { name: 'VoiceCAP 로그인', exact: true }).waitFor();
  await page.waitForFunction(() => location.pathname === '/login');
  assert.equal((await state()).tabs[0], 'manage');
  await login();
  await page.locator('[data-testid=management]').waitFor();
  await tab('sell');
  await page.locator('.touch-phone-offer').waitFor();
  assert.equal((await state()).logins, 1);
  console.log('PASS: management selected before web readiness survives initial render and shares the later login');
} finally {
  await context.close(); await browser.close(); server.closeAllConnections(); await new Promise((done) => server.close(done));
}
