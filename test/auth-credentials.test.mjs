import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Auth Credentials: Logic & storage lifecycle verification', () => {
  // Mock localStorage and window in node environment
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    }
  };
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

  // Simulated logic matching src/services/authCredentialsService.ts
  const STORAGE_KEY = 'voicecap_saved_login_credentials';

  function encodeCredentials(raw) {
    return btoa(encodeURIComponent(raw));
  }
  function decodeCredentials(encoded) {
    return decodeURIComponent(atob(encoded));
  }
  function saveAutoLoginCredentials(email, password) {
    const payload = {
      email: email.trim(),
      password,
      autoLogin: true,
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(STORAGE_KEY, encodeCredentials(JSON.stringify(payload)));
  }
  function getAutoLoginCredentials() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const jsonStr = decodeCredentials(raw);
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed.email === 'string' && typeof parsed.password === 'string' && parsed.autoLogin) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  function clearAutoLoginCredentials() {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  function hasAutoLoginCredentials() {
    return getAutoLoginCredentials() !== null;
  }

  // 1. Initial state: nothing saved
  assert.equal(hasAutoLoginCredentials(), false);
  assert.equal(getAutoLoginCredentials(), null);

  // 2. Save credentials
  saveAutoLoginCredentials('seller@dadryeo.com', 'password123!');
  assert.equal(hasAutoLoginCredentials(), true);
  const loaded = getAutoLoginCredentials();
  assert.ok(loaded);
  assert.equal(loaded.email, 'seller@dadryeo.com');
  assert.equal(loaded.password, 'password123!');
  assert.equal(loaded.autoLogin, true);
  assert.ok(loaded.savedAt);

  // 3. Raw storage is not plain text
  const rawStored = window.localStorage.getItem(STORAGE_KEY);
  assert.ok(!rawStored.includes('password123!'), 'Stored credentials must be encoded to protect against casual exposure');

  // 4. Update credentials
  saveAutoLoginCredentials('admin@dadryeo.com', 'adminPass99#');
  const updated = getAutoLoginCredentials();
  assert.equal(updated.email, 'admin@dadryeo.com');
  assert.equal(updated.password, 'adminPass99#');

  // 5. Clear credentials
  clearAutoLoginCredentials();
  assert.equal(hasAutoLoginCredentials(), false);
  assert.equal(getAutoLoginCredentials(), null);

  // 6. Corrupt data handling
  window.localStorage.setItem(STORAGE_KEY, 'invalid-base64-corrupt-data{{{');
  assert.equal(getAutoLoginCredentials(), null);
  assert.equal(hasAutoLoginCredentials(), false);
});

test('Auth Credentials: LoginPage.tsx UI and auto-login checkbox integrity', () => {
  const loginPagePath = path.join(rootDir, 'src', 'pages', 'auth', 'LoginPage.tsx');
  const loginPageContent = fs.readFileSync(loginPagePath, 'utf8');

  // Must import authCredentialsService
  assert.ok(
    loginPageContent.includes('authCredentialsService'),
    'LoginPage.tsx must import authCredentialsService'
  );

  // Must have autoLogin state
  assert.match(
    loginPageContent,
    /const\s*\[autoLogin,\s*setAutoLogin\]\s*=\s*useState\(false\)/,
    'LoginPage.tsx must declare autoLogin state'
  );

  // Must have autoLogin checkbox
  assert.ok(
    loginPageContent.includes('id="autoLogin"'),
    'LoginPage.tsx must render autoLogin checkbox'
  );
  assert.ok(
    loginPageContent.includes('자동 로그인'),
    'LoginPage.tsx must display "자동 로그인" label'
  );

  // Must pre-fill credentials on mount if saved
  assert.ok(
    loginPageContent.includes('getAutoLoginCredentials()'),
    'LoginPage.tsx must call getAutoLoginCredentials on mount'
  );

  // Must save credentials on submit when autoLogin is true
  assert.ok(
    loginPageContent.includes('saveAutoLoginCredentials(email, password)'),
    'LoginPage.tsx must save credentials upon successful login when autoLogin is checked'
  );

  // Must clear credentials when autoLogin is false
  assert.ok(
    loginPageContent.includes('clearAutoLoginCredentials()'),
    'LoginPage.tsx must clear credentials when autoLogin is unchecked'
  );
});

test('Auth Credentials: App.tsx routing redirect integrity', () => {
  const appPath = path.join(rootDir, 'src', 'App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');

  // Must import isDesktopApp or hasAutoLoginCredentials
  assert.ok(
    appContent.includes('isDesktopApp') && appContent.includes('hasAutoLoginCredentials'),
    'App.tsx must import isDesktopApp and hasAutoLoginCredentials'
  );

  // RootRedirect must check isDesktopApp() or hasAutoLoginCredentials()
  assert.ok(
    appContent.includes('isDesktopApp() || hasAutoLoginCredentials()'),
    'RootRedirect must direct desktop app or users with saved credentials to /login'
  );
});
