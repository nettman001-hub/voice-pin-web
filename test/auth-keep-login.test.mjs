import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const createStorage = () => {
  const store = new Map();
  return {
    store,
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
};

// 브라우저 재시작 = sessionStorage만 비워지고 localStorage는 남는다.
const installBrowser = () => {
  const local = createStorage();
  const session = createStorage();
  globalThis.window = { localStorage: local, sessionStorage: session };
  return {
    local,
    session,
    restartBrowser() {
      globalThis.window = { localStorage: local, sessionStorage: createStorage() };
      this.session = globalThis.window.sessionStorage;
    },
  };
};

const mod = await import('../src/services/authSessionStorage.ts');
const AUTH_KEY = 'sb-ymegrhxpbeanvxwdzfym-auth-token';

test('자동 로그인 켜고 로그인하면 브라우저를 닫았다 열어도 세션이 남는다', () => {
  const browser = installBrowser();
  mod.setKeepLogin(true);
  mod.authSessionStorage.setItem(AUTH_KEY, '{"refresh_token":"r1"}');
  assert.equal(browser.local.getItem(AUTH_KEY), '{"refresh_token":"r1"}');

  browser.restartBrowser();
  assert.equal(mod.isKeepLoginEnabled(), true);
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), '{"refresh_token":"r1"}');
});

test('자동 로그인 끄고 로그인하면 새로고침은 유지, 브라우저를 닫으면 로그아웃', () => {
  const browser = installBrowser();
  mod.setKeepLogin(false);
  mod.authSessionStorage.setItem(AUTH_KEY, '{"refresh_token":"r1"}');
  assert.equal(browser.local.getItem(AUTH_KEY), null);
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), '{"refresh_token":"r1"}');

  browser.restartBrowser();
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), null);
});

test('토큰 갱신 시 같은 저장소에 덮어쓰고 다른 저장소에 옛 토큰을 남기지 않는다', () => {
  const browser = installBrowser();
  browser.session.setItem(AUTH_KEY, '{"refresh_token":"old"}');
  mod.setKeepLogin(true);
  // 기존 탭 세션은 localStorage로 옮겨진다
  assert.equal(browser.session.getItem(AUTH_KEY), null);
  assert.equal(browser.local.getItem(AUTH_KEY), '{"refresh_token":"old"}');

  mod.authSessionStorage.setItem(AUTH_KEY, '{"refresh_token":"new"}');
  assert.equal(browser.local.getItem(AUTH_KEY), '{"refresh_token":"new"}');
  assert.equal(browser.session.getItem(AUTH_KEY), null);
});

test('자동 로그인을 끄고 다시 로그인하면 localStorage에 세션이 남지 않는다', () => {
  const browser = installBrowser();
  mod.setKeepLogin(true);
  mod.authSessionStorage.setItem(AUTH_KEY, 'x');
  mod.setKeepLogin(false);
  assert.equal(browser.local.getItem(AUTH_KEY), null);
  assert.equal(browser.local.getItem(mod.KEEP_LOGIN_FLAG_KEY), null);
  assert.equal(browser.session.getItem(AUTH_KEY), 'x');
});

test('로그아웃하면 두 저장소의 세션과 예전 토큰을 모두 지우고 다른 데이터는 남긴다', () => {
  const browser = installBrowser();
  mod.setKeepLogin(true);
  mod.authSessionStorage.setItem(AUTH_KEY, 'x');
  browser.session.setItem(`${AUTH_KEY}-code-verifier`, 'v');
  browser.session.setItem(mod.LEGACY_REFRESH_TOKEN_KEY, 'legacy');
  browser.local.setItem('voicecap_saved_login_credentials', 'keep');
  mod.clearStoredAuthSession();
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), null);
  assert.equal(browser.session.getItem(`${AUTH_KEY}-code-verifier`), null);
  assert.equal(browser.session.getItem(mod.LEGACY_REFRESH_TOKEN_KEY), null);
  assert.equal(browser.local.getItem('voicecap_saved_login_credentials'), 'keep');
});

test('예전 버전의 탭 refresh token은 한 번만 이어받는다', () => {
  const browser = installBrowser();
  browser.session.setItem(mod.LEGACY_REFRESH_TOKEN_KEY, 'legacy');
  assert.equal(mod.takeLegacyRefreshToken(), 'legacy');
  assert.equal(mod.takeLegacyRefreshToken(), null);
});

test('저장소 접근이 막힌 브라우저에서도 오류 없이 동작한다', () => {
  globalThis.window = {
    get localStorage() { throw new Error('blocked'); },
    get sessionStorage() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => mod.setKeepLogin(true));
  assert.doesNotThrow(() => mod.authSessionStorage.setItem(AUTH_KEY, 'x'));
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), null);
  assert.doesNotThrow(() => mod.clearStoredAuthSession());
});

test('Supabase 클라이언트가 세션을 저장하고 로그인 전에 보관 위치를 정한다', () => {
  const client = fs.readFileSync(path.join(rootDir, 'src/services/supabaseClient.ts'), 'utf8');
  assert.match(client, /persistSession:\s*true/);
  assert.match(client, /storage:\s*authSessionStorage/);

  const auth = fs.readFileSync(path.join(rootDir, 'src/context/AuthContext.tsx'), 'utf8');
  const keepIdx = auth.indexOf('setKeepLogin(Boolean(rememberMe))');
  const signInIdx = auth.indexOf('signInWithPassword');
  assert.ok(keepIdx > 0 && keepIdx < signInIdx, '로그인 요청 전에 setKeepLogin이 호출돼야 한다');
  assert.match(auth, /clearStoredAuthSession\(\)/);
});

test('실제 Supabase 클라이언트: 자동 로그인이면 브라우저 재시작 후에도 로그인 상태', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const browser = installBrowser();
  const now = Math.floor(Date.now() / 1000);
  const user = { id: 'u1', aud: 'authenticated', email: 'seller@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const fetchMock = async (url) => {
    if (String(url).includes('/token')) {
      return new Response(JSON.stringify({ access_token: 'a1', refresh_token: 'r1', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(user), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const makeClient = () => createClient('https://example.supabase.co', 'pk', {
    auth: { persistSession: true, storage: mod.authSessionStorage, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchMock },
  });

  mod.setKeepLogin(true);
  const first = makeClient();
  const { data, error } = await first.auth.signInWithPassword({ email: 'seller@example.com', password: 'pw' });
  assert.equal(error, null);
  assert.equal(data.session.refresh_token, 'r1');

  browser.restartBrowser();
  const second = makeClient();
  const { data: restored } = await second.auth.getSession();
  assert.equal(restored.session?.user.id, 'u1');

  // 자동 로그인 끔: 재시작하면 로그아웃
  const other = installBrowser();
  mod.setKeepLogin(false);
  await makeClient().auth.signInWithPassword({ email: 'seller@example.com', password: 'pw' });
  other.restartBrowser();
  const { data: gone } = await makeClient().auth.getSession();
  assert.equal(gone.session, null);
});

test('판매 앱(WebView)에서는 자동 로그인을 꺼도 세션을 localStorage에 둬 [판매]·[관리] 탭이 함께 쓴다', () => {
  const browser = installBrowser();
  globalThis.window.VoiceCapAndroid = {};
  mod.setKeepLogin(false);
  mod.authSessionStorage.setItem(AUTH_KEY, '{"refresh_token":"r1"}');
  assert.equal(browser.local.getItem(AUTH_KEY), '{"refresh_token":"r1"}');
  assert.equal(browser.session.getItem(AUTH_KEY), null);
});

test('판매 앱: 다른 탭에서 로그아웃하면 이 웹뷰에 남은 예전 계정 세션(sessionStorage)으로 되돌아가지 않는다', () => {
  const browser = installBrowser();
  globalThis.window.VoiceCapAndroid = {};
  // 업데이트 전 이 웹뷰에 남아 있던 예전 계정 B
  browser.session.setItem(AUTH_KEY, '{"refresh_token":"old-B"}');
  // 다른 웹뷰가 계정 A를 공용 localStorage에 저장
  browser.local.setItem(AUTH_KEY, '{"refresh_token":"current-A"}');
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), '{"refresh_token":"current-A"}');
  assert.equal(browser.session.getItem(AUTH_KEY), null, '읽을 때 예전 사본을 지운다');
  // A 로그아웃(다른 웹뷰가 localStorage를 지움)
  browser.local.removeItem(AUTH_KEY);
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), null);
});

test('판매 앱: localStorage가 비어 있고 sessionStorage에만 예전 세션이 있어도 그 세션을 쓰지 않는다', () => {
  const browser = installBrowser();
  globalThis.window.VoiceCapAndroid = {};
  browser.session.setItem(AUTH_KEY, '{"refresh_token":"old-B"}');
  assert.equal(mod.authSessionStorage.getItem(AUTH_KEY), null);
  assert.equal(browser.session.getItem(AUTH_KEY), null);
});
