import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { IDBFactory } from 'fake-indexeddb';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const compile = (file) => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const adapterSource = compile('../src/services/authSessionStorage.ts');
const apiSource = compile('../src/services/productSalesApi.ts');
const PUBLIC_KEY = 'sb_publishable_synthetic_header_test';
const AUTH_KEY = 'sb-sdk-headers-auth-token';
const memoryStorage = () => {
  const values = new Map();
  return {
    get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key),
  };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function harness({ localWritesFail = false, loginGate } = {}) {
  const window = { VoiceCapAndroid: {}, localStorage: memoryStorage(), sessionStorage: memoryStorage() };
  if (localWritesFail) window.localStorage.setItem = () => { throw new Error('storage full'); };
  const adapter = { exports: {} };
  vm.runInNewContext(adapterSource, { module: adapter, exports: adapter.exports, window, Set });
  let currentAccess = null, sequence = 0;
  const observations = [];
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/auth/v1/token')) {
      if (loginGate && url.includes('grant_type=password')) await loginGate.promise;
      // These strings are synthetic markers, never credentials for an external service.
      currentAccess = `synthetic-user-access-${++sequence}`;
      return json({ user, access_token: currentAccess, refresh_token: `synthetic-refresh-${sequence}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (url.includes('/auth/v1/logout')) { currentAccess = null; return json({}); }
    if (url.includes('/functions/v1/')) {
      const headers = new Headers(init.headers);
      const authenticated = currentAccess !== null && headers.get('authorization') === `Bearer ${currentAccess}`;
      observations.push({
        function: url.split('/').at(-1), action: JSON.parse(init.body || '{}').action,
        hasBearer: headers.has('authorization'), matchesCurrentUser: authenticated,
        apiKeyMatches: headers.get('apikey') === PUBLIC_KEY,
        apiKeyUsedAsBearer: headers.get('authorization') === `Bearer ${PUBLIC_KEY}`,
      });
      return authenticated ? json({ ok: true, data: { accepted: true } }) : json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'synthetic authentication required' } }, 401);
    }
    throw new Error('Unexpected synthetic SDK request');
  };
  const client = createClient('https://sdk-headers.supabase.co', PUBLIC_KEY, {
    auth: { persistSession: true, storage: adapter.exports.authSessionStorage, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  const api = { exports: {} };
  vm.runInNewContext(apiSource, {
    module: api, exports: api.exports,
    require: (name) => {
      assert.ok(name.endsWith('supabaseClient'), 'production API imports only the configured Supabase client');
      return { isSupabaseConfigured: true, requireSupabase: () => client };
    },
  });
  return {
    client, window, adapter: adapter.exports, observations, api: api.exports,
    login: () => client.auth.signInWithPassword({ email: user.email, password: 'synthetic-password' }),
  };
}

function actualStorage(h) {
  const modules = new Map();
  const indexedDB = new IDBFactory();
  const load = (file) => {
    const url = new URL(file, import.meta.url);
    if (modules.has(url.href)) return modules.get(url.href).exports;
    const module = { exports: {} }; modules.set(url.href, module);
    vm.runInNewContext(compile(url), {
      module, exports: module.exports, window: h.window, localStorage: h.window.localStorage,
      indexedDB, console, Event, Set, Map,
      require: (name) => load(new URL(`${name}.ts`, url)),
    });
    return module.exports;
  };
  return load('../src/services/storageService.ts');
}

// Run the real AppDataProvider's effects on both the logged-out mount and the
// user update after login. All storage/seeding logic remains production code.
function appDataProvider(h, storageService) {
  let cursor = 0, effects = [], slots = [], auth = { user: null, workspaceId: null };
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (sameDeps(slots[index]?.deps, deps)) return;
      const previous = slots[index]; slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  react.default = react;
  const module = { exports: {} };
  vm.runInNewContext(compile('../src/context/AppDataContext.tsx'), {
    module, exports: module.exports, console,
    require: (name) => {
      if (name === 'react') return react;
      if (name.endsWith('WorkspaceRuntimeContext')) return {
        useRuntimeAuth: () => auth,
        useWorkspaceRuntime: () => ({ storageService, remoteWorkspaceService: {
          loadRecognitionRules: async () => [], saveRecognitionRules: async () => {},
          loadCaptureAreaConfig: async () => null, saveCaptureAreaConfig: async () => {},
        } }),
      };
      if (name.endsWith('supabaseClient')) return { isSupabaseConfigured: true };
      return require(name);
    },
  });
  return {
    render(user, workspaceId = null) {
      auth = { user, workspaceId }; cursor = 0;
      module.exports.AppDataProvider({ children: null });
      const currentEffects = effects; effects = [];
      for (const effect of currentEffects) effect();
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('SDK functions created before login read the signed-in user token at request time', async (t) => {
  const h = harness(); t.after(() => h.client.auth.dispose());
  const functionsBeforeLogin = h.client.functions;
  const before = await functionsBeforeLogin.invoke('sales-api', { body: { action: 'before-login' } });
  assert.equal(before.error?.context?.status, 401);
  assert.equal(h.observations.at(-1).hasBearer, false);
  h.adapter.setKeepLogin(false);
  assert.equal((await h.login()).error, null);
  const after = await functionsBeforeLogin.invoke('sales-api', { body: { action: 'after-login' } });
  assert.equal(after.error, null);
  assert.equal(h.observations.at(-1).matchesCurrentUser, true);
  assert.equal(h.observations.at(-1).apiKeyUsedAsBearer, false);
});

test('actual invokeSalesApi sends the signed-in bearer for simultaneous first bootstrap calls', async (t) => {
  const h = harness(); t.after(() => h.client.auth.dispose());
  h.adapter.setKeepLogin(false);
  assert.equal((await h.login()).error, null);
  await Promise.all(Array.from({ length: 12 }, (_, index) => h.api.invokeSalesApi('touch-bootstrap', { workspaceId: `synthetic-${index}` })));
  assert.equal(h.observations.length, 12);
  assert.ok(h.observations.every((item) => item.matchesCurrentUser && item.apiKeyMatches && !item.apiKeyUsedAsBearer));
});

test('refresh replaces the bearer used by the actual API wrapper and by an existing FunctionsClient', async (t) => {
  const h = harness(); t.after(() => h.client.auth.dispose());
  await h.login();
  const functions = h.client.functions;
  await h.api.invokeSalesApi('touch-bootstrap');
  assert.equal((await h.client.auth.refreshSession()).error, null);
  await h.api.invokeSalesApi('touch-bootstrap');
  assert.equal((await functions.invoke('sales-api', { body: { action: 'after-refresh' } })).error, null);
  assert.ok(h.observations.every((item) => item.matchesCurrentUser));
});

test('app sessionStorage fallback still supplies the user bearer when localStorage writes fail', async (t) => {
  const h = harness({ localWritesFail: true }); t.after(() => h.client.auth.dispose());
  await h.login();
  assert.ok(h.window.sessionStorage.getItem(AUTH_KEY), 'SDK session is in the per-view fallback');
  await h.api.invokeSalesApi('touch-bootstrap');
  assert.equal(h.observations.at(-1).matchesCurrentUser, true);
});

test('calls made before a pending login completes have no user bearer; post-login calls receive it', async (t) => {
  const gate = deferred();
  const h = harness({ loginGate: gate }); t.after(() => h.client.auth.dispose());
  await h.client.auth.getSession();
  const pendingLogin = h.login();
  await assert.rejects(h.api.invokeSalesApi('touch-bootstrap'), (error) => error.code === 'AUTH_REQUIRED');
  assert.equal(h.observations.at(-1).hasBearer, false);
  gate.resolve(); await pendingLogin;
  await h.api.invokeSalesApi('touch-bootstrap');
  assert.equal(h.observations.at(-1).matchesCurrentUser, true);
});

test('losing persisted session storage after login makes SDK omit authorization rather than use cached React identity', async (t) => {
  const h = harness(); t.after(() => h.client.auth.dispose());
  const login = await h.login();
  assert.ok(login.data.session?.user);
  await h.api.invokeSalesApi('touch-bootstrap');
  h.window.localStorage.removeItem(AUTH_KEY);
  await assert.rejects(h.api.invokeSalesApi('touch-bootstrap'), (error) => error.code === 'AUTH_REQUIRED');
  assert.equal(h.observations.at(-1).hasBearer, false);
  assert.equal(h.observations.at(-1).apiKeyUsedAsBearer, false);
});

test('real StorageService initialization and legacy cleanup preserve the SDK session and outgoing bearer', async (t) => {
  const h = harness(); t.after(() => h.client.auth.dispose());
  const { StorageService } = actualStorage(h);
  const storage = new StorageService({ webStorage: h.window.localStorage });
  h.window.localStorage.setItem('dadryeo_users', 'old demo accounts');
  h.window.localStorage.setItem('dadryeo_token', 'old demo token');
  h.window.localStorage.setItem('voicecap_soniox_api_key', 'old STT key');
  const login = await h.login();
  assert.equal(login.error, null);
  for (let pass = 0; pass < 3; pass++) {
    storage.init(); storage.clearLegacyMemberData();
    assert.ok((await h.client.auth.getSession()).data.session?.user, 'initialization must keep the active Supabase session');
    await h.api.invokeSalesApi('touch-bootstrap');
    assert.equal(h.observations.at(-1).matchesCurrentUser, true);
  }
  assert.equal(h.window.localStorage.getItem('dadryeo_users'), null);
  assert.equal(h.window.localStorage.getItem('dadryeo_token'), null);
  assert.equal(h.window.localStorage.getItem('voicecap_soniox_api_key'), null);
});

test('real AppDataProvider user-change initialization keeps the password login bearer for first bootstrap', async (t) => {
  const h = harness(); t.after(() => h.client.auth.dispose());
  const storage = actualStorage(h).storageService;
  const provider = appDataProvider(h, storage); t.after(() => provider.dispose());
  provider.render(null);
  const login = await h.login();
  assert.equal(login.error, null);
  provider.render({ ...login.data.user, role: '판매자', subscriptionPlan: '프로' }, 'synthetic-workspace');
  await h.api.invokeSalesApi('touch-bootstrap', { workspaceId: 'synthetic-workspace' });
  assert.equal(h.observations.at(-1).matchesCurrentUser, true);
  assert.ok((await h.client.auth.getSession()).data.session?.user);
});
