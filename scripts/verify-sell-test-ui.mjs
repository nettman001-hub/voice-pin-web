// Phase-0 test page (/sell-test): label print bytes over a mocked Web Bluetooth
// printer, and the front-camera countdown shot with Chromium's fake camera.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = process.cwd(),
  artifactDir = path.join(root, 'artifacts', 'sell-test');
fs.mkdirSync(artifactDir, { recursive: true });
const result = await build({
  entryPoints: ['src/sellTestMain.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
const js = result.outputFiles[0].text;
const server = http.createServer((req, res) => {
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(js);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath:
    process.env.VOICECAP_CHROMIUM_PATH || chromium.executablePath(),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
});
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['camera'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__writes = [];
    const listeners = [];
    const notify = {
      uuid: '0000ff03-0000-1000-8000-00805f9b34fb',
      properties: { write: false, writeWithoutResponse: false, notify: true },
      startNotifications: async () => notify,
      addEventListener: (_t, cb) => listeners.push(cb),
    };
    const credit = (n) => {
      notify.value = new DataView(Uint8Array.of(1, n).buffer);
      listeners.forEach((cb) => cb({ target: notify }));
    };
    let sinceCredit = 0;
    const write = {
      uuid: '0000ff02-0000-1000-8000-00805f9b34fb',
      properties: { write: false, writeWithoutResponse: true, notify: false },
      writeValueWithoutResponse: async (d) => {
        window.__writes.push(Array.from(d));
        if (++sinceCredit >= 4) {
          sinceCredit = 0;
          setTimeout(() => credit(4), 5);
        }
      },
    };
    const service = {
      uuid: '0000ff00-0000-1000-8000-00805f9b34fb',
      getCharacteristics: async () => [write, notify],
    };
    navigator.bluetooth = {
      requestDevice: async () => ({
        name: 'M50 테스트',
        id: 'x',
        addEventListener() {},
        gatt: {
          connected: true,
          connect: async () => {
            setTimeout(() => credit(4), 50);
            return { getPrimaryServices: async () => [service] };
          },
          disconnect() {},
        },
      }),
    };
  });
  await page.goto(url);
  await page.getByRole('heading', { name: '폰 판매 0단계 시험' }).waitFor();
  await page.getByRole('button', { name: '프린터 찾기·연결' }).click();
  await page.getByText(/연결됨/).waitFor();
  check('connects to FF02 write and FF03 credits', true);
  await page.getByRole('button', { name: '시험 인쇄', exact: true }).click();
  await page.waitForFunction(() =>
    /보냄 \d{4,}바이트/.test(document.querySelector('pre').innerText),
  );
  const writes = await page.evaluate(() => window.__writes);
  const job = writes.slice(1).flat();
  const hex = (a) => a.map((b) => b.toString(16).padStart(2, '0')).join('');
  check(
    'chunks are at most 90 bytes',
    Math.max(...writes.map((w) => w.length)) <= 90,
  );
  check(
    'job starts with paper, density, speed, start, align, 1F10 48x240',
    hex(job.slice(0, 25)) ===
      '1f8001201f7001031f6001011fc001001f11511f10003000f0',
    hex(job.slice(0, 25)),
  );
  check('job ends with stop and feed', hex(job.slice(-7)) === '1fc001011f1150');
  await page.screenshot({
    path: path.join(artifactDir, '01-printer.png'),
    fullPage: true,
  });

  await page.selectOption('select >> nth=-1', '2');
  await page.getByRole('button', { name: '촬영 시험' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '저요' }).click();
  await page.waitForSelector('img[alt^="시험 사진"]', { timeout: 8000 });
  check(
    'countdown shot saves one photo',
    (await page.locator('img[alt^="시험 사진"]').count()) === 1,
  );
  check(
    'comments stay tappable during the countdown',
    /눌린 횟수 1/.test(await page.getByText(/눌린 횟수/).innerText()),
  );
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({
    path: path.join(artifactDir, '02-camera.png'),
    fullPage: true,
  });
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
assert.equal(failed.length, 0);
