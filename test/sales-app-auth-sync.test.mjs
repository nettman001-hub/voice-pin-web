import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const AUTH_KEY = 'sb-sales-sync-auth-token';
const result = await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { AuthProvider } from './src/context/AuthContext';
      export { authSessionStorage } from './src/services/authSessionStorage';`,
    resolveDir: root,
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic',
  plugins: [{
    name: 'auth-backend-fixture',
    setup(builder) {
      builder.onResolve({ filter: /\/(supabaseClient|storageService)$/ }, ({ path }) => ({ path, namespace: 'auth-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, ({ path }) => ({ contents: path.endsWith('supabaseClient')
        ? `export const isSupabaseConfigured = true;
           export const supabase = globalThis.fixture.bridge;
           export const requireSupabase = () => supabase;
           let restored;
           export const restoreSupabaseSession = () => restored ||= supabase.auth.getSession().then(({data}) => data.session);`
        : 'export const storageService = globalThis.fixture.storageService;',
      }));
    },
  }],
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const eventually = async (predicate, message) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 2));
  }
  assert.ok(predicate(), message);
};
const memoryStorage = (map = new Map(), changed = () => {}) => ({
  get length() { return map.size; },
  key: (index) => [...map.keys()][index] ?? null,
  getItem: (key) => map.get(key) ?? null,
  setItem(key, value) {
    const oldValue = map.get(key) ?? null;
    map.set(key, String(value));
    if (oldValue !== String(value)) changed(key, oldValue, String(value));
  },
  removeItem(key) {
    const oldValue = map.get(key) ?? null;
    map.delete(key);
    if (oldValue !== null) changed(key, oldValue, null);
  },
});
const emit = (target, type, fields = {}) => {
  const event = new Event(type);
  Object.assign(event, fields);
  target.dispatchEvent(event);
};

// Each VM mounts the real AuthProvider with isolated hook state and browser globals.
// Auth itself uses real Supabase clients; only profile/workspace network IO is stubbed.
const createWebViews = ({ storageEvents = true, native = true } = {}) => {
  const sharedLocal = new Map();
  const views = [];
  function createView() {
    const window = new EventTarget();
    const document = new EventTarget();
    document.visibilityState = 'visible';
    if (native) window.VoiceCapAndroid = {};
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    window.location = { origin: 'https://www.voicecap.shop' };
    window.localStorage = memoryStorage(sharedLocal, (key, oldValue, newValue) => {
      if (!storageEvents) return;
      for (const other of views) {
        if (other.window !== window) queueMicrotask(() => emit(other.window, 'storage', {
          key, oldValue, newValue, storageArea: other.window.localStorage,
        }));
      }
    });
    window.sessionStorage = memoryStorage();
    const fixture = {
      onboardCalls: 0, restores: [], workspace: null, profileGates: new Map(), sessionRead: null,
      storageService: {
        async restoreWorkspace(id) { fixture.restores.push(id); },
        setWorkspaceId(id) { fixture.workspace = id; },
        clearWorkspaceSessionData() {},
      },
    };
    fixture.bridge = {
      auth: new Proxy({}, { get: (_, key) => (...args) => {
        if (key === 'onAuthStateChange') fixture.authListener = args[0];
        return key === 'getSession' && fixture.sessionRead ? fixture.sessionRead() : fixture.client.auth[key](...args);
      } }),
      functions: { async invoke() { fixture.onboardCalls++; return { data: { ok: true } }; } },
      from(table) {
        const query = {
          select() { return query; }, eq(_key, id) { query.id = id; return query; },
          order() { return query; }, limit() { return query; },
          async maybeSingle() {
            const gate = fixture.profileGates.get(query.id);
            if (gate) await gate.promise;
            return { data: table === 'profiles'
              ? { display_name: query.id }
              : { workspace_id: `workspace-${query.id}`, role: 'OWNER' } };
          },
        };
        return query;
      },
    };
    let slots = [], cursor = 0, pendingEffects = [], rendering = false, scheduled = false, disposed = false;
    let provider;
    let value;
    const sameDeps = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
    const scheduleRender = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; render(); });
    };
    const hooks = {
      createContext: () => ({ Provider: 'provider' }),
      useState(initial) {
        const index = cursor++;
        slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
        return [slots[index].value, (next) => {
          const nextValue = typeof next === 'function' ? next(slots[index].value) : next;
          if (!Object.is(nextValue, slots[index].value)) { slots[index].value = nextValue; scheduleRender(); }
        }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useCallback(callback, deps) {
        const index = cursor++;
        if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
        return slots[index].value;
      },
      useEffect(effect, deps) {
        const index = cursor++;
        if (sameDeps(slots[index]?.deps, deps)) return;
        const previous = slots[index];
        slots[index] = { deps };
        pendingEffects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
      },
      useContext() { throw new Error('Consumer is read from the mounted provider value'); },
    };
    const module = { exports: {} };
    vm.runInNewContext(result.outputFiles[0].text, {
      module, exports: module.exports, fixture, window, document, localStorage: window.localStorage,
      console, setTimeout, clearTimeout,
      require: (name) => name === 'react' ? hooks : require(name),
    });
    let authTokenNumber = 0;
    fixture.client = createClient('https://sales-sync.supabase.co', 'fixture-publishable-key', {
      auth: { storage: module.exports.authSessionStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url, options) => {
        if (String(url).includes('/logout')) return new Response('{}', { status: 200 });
        const email = JSON.parse(options.body).email;
        const id = email.split('@')[0];
        const user = { id, aud: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
        return new Response(JSON.stringify({
          user, access_token: `access-${id}-${++authTokenNumber}`, refresh_token: `refresh-${id}`,
          token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      } },
    });
    provider = module.exports.AuthProvider;
    function render() {
      if (rendering || disposed) return;
      rendering = true;
      cursor = 0;
      value = provider({ children: null }).props.value;
      rendering = false;
      const effects = pendingEffects; pendingEffects = [];
      for (const effect of effects) effect();
    }
    const view = {
      window, document, fixture,
      get value() { return value; },
      activate(detail = { type: 'app-tab-active' }) { emit(window, 'voicecap-android', { detail }); },
      focus() { emit(window, 'focus'); },
      async dispose() {
        disposed = true;
        for (const slot of slots) slot?.cleanup?.();
        await fixture.client.auth.dispose();
      },
    };
    views.push(view);
    render();
    return view;
  }
  return {
    createView,
    async ready(...items) { await eventually(() => items.every((item) => item.value.isInitialized), 'providers initialize'); },
    async dispose() { for (const view of views) await view.dispose(); },
  };
};

test('already-open management WebView sees sales login through shared storage without BroadcastChannel', async (t) => {
  const app = createWebViews(); t.after(() => app.dispose());
  const sales = app.createView(), manage = app.createView();
  await app.ready(sales, manage);
  assert.equal(manage.value.isAuthenticated, false);
  assert.notEqual(sales.window.sessionStorage, manage.window.sessionStorage);
  assert.equal((await sales.value.login('alice@example.com', 'pw', false)).success, true);
  await eventually(() => manage.value.user?.id === 'alice', 'management must share the sales login');
  assert.equal(manage.value.workspaceId, 'workspace-alice');
  assert.equal(manage.window.sessionStorage.getItem(AUTH_KEY), null);
});

test('native tab activation recovers cached signed-out state and repeated activations avoid profile/workspace reload', async (t) => {
  const app = createWebViews({ storageEvents: false }); t.after(() => app.dispose());
  const sales = app.createView(), manage = app.createView();
  await app.ready(sales, manage);
  await sales.value.login('alice@example.com', 'pw');
  assert.equal(manage.value.isAuthenticated, false);
  manage.activate(JSON.stringify({ type: 'app-tab-active' }));
  await eventually(() => manage.value.user?.id === 'alice', 'tab activation must re-read storage instead of cached initial null');
  const count = manage.fixture.onboardCalls, restores = manage.fixture.restores.length;
  manage.activate(); manage.focus(); emit(manage.document, 'visibilitychange');
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(manage.fixture.onboardCalls, count);
  assert.equal(manage.fixture.restores.length, restores);
  assert.equal(manage.value.user.id, 'alice');
});

test('login from management and logout/account change propagate to the sales WebView', async (t) => {
  const app = createWebViews(); t.after(() => app.dispose());
  const sales = app.createView(), manage = app.createView();
  await app.ready(sales, manage);
  await manage.value.login('alice@example.com', 'pw');
  await eventually(() => sales.value.user?.id === 'alice', 'reverse-direction login');
  await manage.value.logout();
  await eventually(() => !sales.value.isAuthenticated && sales.fixture.workspace === null, 'other tab logout');
  await manage.value.login('bob@example.com', 'pw');
  await eventually(() => sales.value.user?.id === 'bob', 'new account must replace the previous account');
  assert.equal(sales.value.workspaceId, 'workspace-bob');
});

test('old app focus and visibility events recover login when native and storage events are unavailable', async (t) => {
  const app = createWebViews({ storageEvents: false }); t.after(() => app.dispose());
  const sales = app.createView(), manage = app.createView();
  await app.ready(sales, manage);
  await sales.value.login('alice@example.com', 'pw');
  manage.document.visibilityState = 'hidden';
  emit(manage.document, 'visibilitychange');
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(manage.value.isAuthenticated, false);
  manage.document.visibilityState = 'visible';
  emit(manage.document, 'visibilitychange');
  await eventually(() => manage.value.user?.id === 'alice', 'visible WebView resumes current identity');
  await sales.value.logout();
  manage.focus();
  await eventually(() => !manage.value.isAuthenticated, 'focus reflects logout');
});

test('late profile for an old account cannot restore that workspace after a newer login or logout', async (t) => {
  const app = createWebViews(); t.after(() => app.dispose());
  const sales = app.createView(), manage = app.createView();
  await app.ready(sales, manage);
  const gate = deferred(); manage.fixture.profileGates.set('alice', gate);
  await sales.value.login('alice@example.com', 'pw');
  await eventually(() => manage.fixture.onboardCalls > 0, 'old profile request started');
  await sales.value.logout();
  await sales.value.login('bob@example.com', 'pw');
  await eventually(() => manage.value.user?.id === 'bob', 'new account applied while old profile is pending');
  gate.resolve();
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(manage.value.user.id, 'bob');
  assert.equal(manage.fixture.workspace, 'workspace-bob');
  assert.ok(!manage.fixture.restores.includes('workspace-alice'), 'late old profile must not restore its workspace');
  await sales.value.logout();
  await eventually(() => !manage.value.isAuthenticated, 'logout remains signed out');
});

test('a delayed session recheck cannot undo a newer SDK sign-out event', async (t) => {
  const app = createWebViews({ storageEvents: false }); t.after(() => app.dispose());
  const manage = app.createView(); await app.ready(manage);
  await manage.value.login('alice@example.com', 'pw');
  const oldSession = (await manage.fixture.client.auth.getSession()).data.session;
  const gate = deferred(); let started = false;
  manage.fixture.sessionRead = () => { started = true; return gate.promise; };
  manage.activate();
  await eventually(() => started, 'recheck started');
  await manage.value.logout();
  gate.resolve({ data: { session: oldSession }, error: null });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(manage.value.isAuthenticated, false);
  assert.equal(manage.fixture.workspace, null);
});

test('initial shared login stays in loading state until its profile/workspace is ready', async (t) => {
  const app = createWebViews({ storageEvents: false }); t.after(() => app.dispose());
  const sales = app.createView(); await app.ready(sales);
  await sales.value.login('alice@example.com', 'pw');
  const manage = app.createView();
  const gate = deferred(); manage.fixture.profileGates.set('alice', gate);
  await eventually(() => manage.fixture.onboardCalls > 0, 'initial shared profile request started');
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(manage.value.isInitialized, false, 'must show the login check, not a second login form');
  gate.resolve();
  await app.ready(manage);
  assert.equal(manage.value.user?.id, 'alice');
  assert.equal(manage.value.workspaceId, 'workspace-alice');
});

test('queued SDK sign-in cannot resurrect an account after a newer sign-out', async (t) => {
  const app = createWebViews({ storageEvents: false }); t.after(() => app.dispose());
  const manage = app.createView(); await app.ready(manage);
  await manage.value.login('alice@example.com', 'pw');
  const session = (await manage.fixture.client.auth.getSession()).data.session;
  manage.fixture.authListener('SIGNED_IN', session);
  manage.fixture.authListener('SIGNED_OUT', null);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(manage.value.isAuthenticated, false);
  assert.equal(manage.fixture.workspace, null);
});

test('SDK user updates still reload profiles even when the user and access token have not changed', async (t) => {
  const app = createWebViews({ storageEvents: false }); t.after(() => app.dispose());
  const manage = app.createView(); await app.ready(manage);
  await manage.value.login('alice@example.com', 'pw');
  // Let the login's own deferred SDK notification finish before recording the count.
  await new Promise((done) => setTimeout(done, 10));
  const count = manage.fixture.onboardCalls;
  const session = (await manage.fixture.client.auth.getSession()).data.session;
  manage.fixture.authListener('USER_UPDATED', session);
  await eventually(() => manage.fixture.onboardCalls > count, 'existing SDK profile refresh must remain active');
});

test('ordinary browser windows do not opt into sales-app storage/focus syncing', async (t) => {
  const app = createWebViews({ native: false }); t.after(() => app.dispose());
  const sales = app.createView(), manage = app.createView(); await app.ready(sales, manage);
  await sales.value.login('alice@example.com', 'pw', true);
  manage.activate(); manage.focus(); emit(manage.document, 'visibilitychange');
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(manage.value.isAuthenticated, false);
});
