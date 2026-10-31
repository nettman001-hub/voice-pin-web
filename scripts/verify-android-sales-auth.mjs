// Runs the real app and Supabase client inside a debug APK's Android WebView.
// All backend requests use synthetic fixtures; no production account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _android } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.codex-build', 'android-single-view-auth');
fs.mkdirSync(output, { recursive: true });
if (process.env.ANDROID_AUTH_SKIP_BUILD !== '1') await build({
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'], outfile: path.join(output, 'app.js'),
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env': JSON.stringify({
    VITE_SUPABASE_URL: 'https://android-auth-fixture.invalid',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
    PROD: true, DEV: false, MODE: 'production',
  }), 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
});
console.log('Android auth fixture bundle ready.');

const serial = process.env.ANDROID_SERIAL || 'emulator-5580';
assert.ok(serial.startsWith('emulator-'), 'This fixture runs only on a disposable Android emulator');
const devices = await _android.devices();
const device = devices.find((item) => item.serial() === serial);
assert.ok(device, `Android test device ${serial} is connected`);
const view = await device.webView({ pkg: 'shop.voicecap.seller' });
const page = await view.page();
page.setDefaultTimeout(30_000);
const tapNativeTab = async (label) => {
  await device.shell('uiautomator dump /sdcard/codex-sales-auth-window.xml');
  const xml = (await device.shell('cat /sdcard/codex-sales-auth-window.xml')).toString();
  const button = [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => match[0]).find((node) =>
    node.includes(`text="${label}"`) && node.includes('class="android.widget.Button"'));
  assert.ok(button, `Native ${label} tab exists`);
  const bounds = button.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(bounds, 'Native tab has screen bounds');
  await device.shell(`input tap ${Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)} ${Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)}`);
};
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const userId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const user = { id: userId, aud: 'authenticated', email: 'android-fixture@example.invalid',
  app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
let logins = 0;
let documentLoads = 0;
let issuedAccessToken;
let rejectedPrivateRequests = 0;
const authenticatedActions = [];
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const headers = { 'access-control-allow-origin': '*',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (data) => route.fulfill({ status: 200,
    contentType: 'application/json', headers, body: JSON.stringify(data) });
  if (url.hostname === 'www.voicecap.shop') {
    if (url.pathname === '/app.js' || url.pathname === '/app.css') {
      return route.fulfill({ status: 200,
        contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css',
        body: fs.readFileSync(path.join(output, url.pathname.slice(1))) });
    }
    if (request.isNavigationRequest()) documentLoads++;
    return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  }
  if (url.hostname !== 'android-auth-fixture.invalid') return route.abort();
  if (request.method() === 'OPTIONS') return json({});
  if (url.pathname.includes('/auth/v1/token')) {
    logins++;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
    issuedAccessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp, aud: 'authenticated' })}.fixture`;
    return json({ user, token_type: 'bearer', expires_in: 3600, expires_at: exp,
      access_token: issuedAccessToken,
      refresh_token: 'synthetic-android-fixture-refresh' });
  }
  if (url.pathname.includes('/auth/v1/user')) return json(user);
  if (url.pathname.includes('/auth/v1/logout')) return json({});
  if (url.pathname.includes('/rest/v1/profiles')) return json({ display_name: 'Android 시험 판매자' });
  if (url.pathname.includes('/rest/v1/workspace_members')) return json({ workspace_id: workspaceId, role: 'OWNER' });
  if (url.pathname.includes('/rest/v1/')) return json([]);
  if (url.pathname.includes('/functions/v1/') &&
      (!issuedAccessToken || request.headers().authorization !== `Bearer ${issuedAccessToken}`)) {
    rejectedPrivateRequests++;
    return route.fulfill({ status: 401, contentType: 'application/json', headers,
      body: JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Login token is missing' } }) });
  }
  if (url.pathname.endsWith('/voicecap-onboard')) return json({ ok: true, configured: false, allowed: false });
  if (url.pathname.endsWith('/sales-api')) {
    const { action } = request.postDataJSON() || {};
    authenticatedActions.push(action);
    let data = {};
    if (action === 'touch-bootstrap') data = { run: null, session: null, sales: [], product: null, serverNow: Date.now() };
    else if (action === 'get-bootstrap') data = { workspaceId, activeSession: null, activeProduct: null,
      settings: { revision: 1 }, printerStatus: {}, permissions: [] };
    else if (action === 'touch-time') data = { receivedAt: Date.now(), sentAt: Date.now() };
    else if (action.startsWith('list-')) data = { buyers: [], sessions: [], products: [], devices: [] };
    return json({ ok: true, data });
  }
  return json({});
});

try {
  await page.goto('https://www.voicecap.shop/app/sell', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('sb-android-auth-fixture-auth-token');
    sessionStorage.removeItem('sb-android-auth-fixture-auth-token');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('synthetic-fixture-password');
  await page.locator('button[type="submit"]').click();
  await page.locator('[data-sales-app-page="sell"] .touch-app').waitFor({ state: 'visible' });
  const start = await page.evaluate(() => {
    window.__authTestWindow = 'same-window';
    window.__authTestSalesNode = document.querySelector('[data-sales-app-page="sell"] > *');
    return { href: location.href, info: JSON.parse(VoiceCapAndroid.info()) };
  });
  assert.equal(start.info.singleWebView, true);
  const initialLoads = documentLoads;
  for (let turn = 0; turn < 3; turn++) {
    await tapNativeTab('관리');
    await page.waitForURL('**/sales');
    assert.equal(await page.locator('input[type="password"]:visible').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(VoiceCapAndroid.info()).tab), 'manage');
    await tapNativeTab('판매');
    await page.waitForURL('**/app/sell');
    await page.locator('[data-sales-app-page="sell"] .touch-app').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__authTestWindow), 'same-window');
    assert.equal(await page.evaluate(() => window.__authTestSalesNode === document.querySelector('[data-sales-app-page="sell"] > *')), true);
    assert.equal(await page.locator('input[type="password"]:visible').count(), 0);
  }
  assert.equal(logins, 1, 'tab changes never issue another login');
  assert.equal(rejectedPrivateRequests, 0, 'every private API call keeps the login token');
  assert.ok(authenticatedActions.includes('touch-bootstrap'), 'the authenticated sales bootstrap succeeds');
  assert.equal(documentLoads, initialLoads, 'native tabs never navigate the WebView document');
  await device.shell('input keyevent KEYCODE_BACK');
  await page.waitForURL('**/sales');
  assert.equal(await page.evaluate(() => JSON.parse(VoiceCapAndroid.info()).tab), 'manage');
  assert.equal(await page.locator('input[type="password"]:visible').count(), 0);
  assert.deepEqual(errors, [], 'no JavaScript exceptions');
  await page.screenshot({ path: path.join(output, 'android-management.png') });
  console.log(JSON.stringify({ ok: true, serial, androidVersion: (await device.shell('getprop ro.build.version.release')).toString().trim(),
    app: start.info, loginRequests: logins, tabRoundTrips: 3, extraDocumentLoads: documentLoads - initialLoads,
    sellingNodePreserved: true, androidBackTabSynced: true, rejectedPrivateRequests, pageErrors: errors }, null, 2));
} finally {
  await device.close();
}
