import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as scheduleService from '../src/services/listeningStopScheduleService.ts';

const { resolveListeningStopAt, toLocalDateTimeInput, remainingListeningStopSeconds,
  formatListeningStopCountdown, isListeningStopOwner } = scheduleService;

test('relative stop reservations accept presets/custom minutes and reject invalid duration', () => {
  const now = Date.parse('2026-10-01T09:10:00Z');
  for (const minutes of [1, 30, 60, 120, 1440]) {
    assert.equal(resolveListeningStopAt({ mode: 'DURATION', minutes: String(minutes) }, now), now + minutes * 60_000);
  }
  for (const minutes of ['', ' ', '0', '-1', '1.5', '1441', 'invalid', 'Infinity']) {
    assert.throws(() => resolveListeningStopAt({ mode: 'DURATION', minutes }, now));
  }
});

test('fixed local stop times support crossing midnight but reject the past and invalid dates', () => {
  const now = new Date(2026, 9, 1, 23, 45).getTime();
  assert.equal(resolveListeningStopAt({ mode: 'AT_TIME', datetime: '2026-10-02T00:15' }, now), now + 30 * 60_000);
  assert.equal(toLocalDateTimeInput(now), '2026-10-01T23:45');
  for (const datetime of ['2026-10-01T23:44', '2026-10-01T23:45', '2026-10-03T00:15',
    '2026-02-30T12:00', 'invalid', '', '2026-10-02T00:15:00Z']) {
    assert.throws(() => resolveListeningStopAt({ mode: 'AT_TIME', datetime }, now));
  }
});

test('countdown uses the absolute deadline, includes hours and never becomes negative', () => {
  assert.equal(remainingListeningStopSeconds(10_500, 1000), 10);
  assert.equal(remainingListeningStopSeconds(10_500, 10_499), 1);
  assert.equal(remainingListeningStopSeconds(10_500, 20_000), 0);
  assert.equal(formatListeningStopCountdown(3661), '01:01:01');
  assert.equal(formatListeningStopCountdown(-1), '00:00:00');
  assert.equal(formatListeningStopCountdown(86400), '24:00:00');
});

test('reservations belong to one account, workspace, session and listening run', () => {
  const owner = { userId: 'user', workspaceId: 'workspace', sessionId: 'session', listeningRunId: 1 };
  assert.equal(isListeningStopOwner(owner, { ...owner }), true);
  for (const change of [{ userId: 'other' }, { workspaceId: 'other' }, { sessionId: 'other' }, { listeningRunId: 2 }]) {
    assert.equal(isListeningStopOwner(owner, { ...owner, ...change }), false);
  }
});

// Execute the real provider with hook lifecycles and a controllable browser
// clock. Route changes unmount pages, not this provider.
function providerFixture() {
  let now = new Date(2026, 9, 1, 20, 0).getTime();
  const cells = [], effects = [], intervals = new Map(), events = new Map();
  let index = 0, timerId = 0, listeningStops = 0, commentStops = 0;
  const state = { auth: { user: { id: 'seller' }, workspaceId: 'workspace' },
    live: { isListening: true, currentSessionId: 'session', listeningRunId: 1 } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    createContext() { return { Provider: 'provider' }; },
    useRef(value) { const i = index++; cells[i] ||= { current: value }; return cells[i]; },
    useState(value) {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof value === 'function' ? value() : value;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }];
    },
    useCallback(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) cells[i] = { deps, callback };
      return cells[i].callback;
    },
    useEffect(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) {
        const previous = cells[i]; cells[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
      }
    },
  };
  const eventTarget = (prefix) => ({
    addEventListener(name, callback) { events.set(`${prefix}:${name}`, callback); },
    removeEventListener(name, callback) { if (events.get(`${prefix}:${name}`) === callback) events.delete(`${prefix}:${name}`); },
  });
  const dependencies = {
    react: { ...react, default: react },
    './AuthContext': { useAuth: () => state.auth },
    './LiveContext': { useLive: () => ({ ...state.live, stopListening() {
      listeningStops++; state.live.isListening = false; state.live.listeningRunId++;
    } }) },
    './CommentCaptureContext': { useCommentCapture: () => ({ stopCapture() { commentStops++; } }) },
    '../services/listeningStopScheduleService': scheduleService,
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('src/context/ListeningStopScheduleContext.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, Error, Date: class extends Date { static now() { return now; } },
    require: (name) => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
    document: eventTarget('document'), window: { ...eventTarget('window'),
      setInterval(callback) { intervals.set(++timerId, callback); return timerId; }, clearInterval(id) { intervals.delete(id); } },
  });
  const render = (children = 'live-home') => {
    index = 0;
    const tree = module.exports.ListeningStopScheduleProvider({ children });
    effects.splice(0).forEach((effect) => effect());
    return tree.props.value;
  };
  return { state, render, get now() { return now; }, setNow(value) { now = value; }, intervals,
    tick() { for (const callback of [...intervals.values()]) callback(); },
    event(name) { events.get(name)?.(); },
    get stops() { return { listening: listeningStops, comments: commentStops }; },
    settle(children) { render(children); return render(children); },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

test('without a reservation, listening starts and continues without any schedule timer or stop', () => {
  const ctx = providerFixture();
  ctx.state.live.isListening = false; ctx.settle();
  ctx.state.live.isListening = true; ctx.state.live.listeningRunId++; ctx.settle();
  ctx.setNow(ctx.now + 30 * 60_000); ctx.tick(); ctx.event('window:focus');
  assert.equal(ctx.render().scheduledStop, null);
  assert.equal(ctx.intervals.size, 0);
  assert.equal(ctx.state.live.isListening, true);
  assert.deepEqual(ctx.stops, { listening: 0, comments: 0 });
});

test('the scheduled deadline stops listening and comments exactly once, even after menu navigation', () => {
  const ctx = providerFixture();
  ctx.render().scheduleStop(ctx.now + 60_000);
  let view = ctx.settle('sales-list');
  assert.equal(view.remainingSeconds, 60);
  assert.ok(view.scheduledStop);
  ctx.setNow(ctx.now + 59_000); ctx.tick();
  assert.equal(ctx.settle().remainingSeconds, 1);
  assert.deepEqual(ctx.stops, { listening: 0, comments: 0 });
  ctx.setNow(ctx.now + 1000); ctx.tick(); ctx.event('window:focus'); ctx.tick();
  view = ctx.settle();
  assert.deepEqual(ctx.stops, { listening: 1, comments: 1 });
  assert.equal(view.scheduledStop, null);
  assert.equal(view.completedAt, ctx.now);
});

test('replacing or cancelling a reservation cannot leave the old deadline armed', () => {
  const ctx = providerFixture();
  ctx.render().scheduleStop(ctx.now + 60_000); ctx.settle();
  const previouslyQueuedCheck = [...ctx.intervals.values()][0];
  ctx.render().scheduleStop(ctx.now + 120_000); ctx.settle();
  assert.equal(ctx.intervals.size, 1);
  ctx.setNow(ctx.now + 60_000); ctx.tick(); previouslyQueuedCheck();
  assert.deepEqual(ctx.stops, { listening: 0, comments: 0 });
  ctx.render().cancelScheduledStop(); ctx.settle();
  ctx.setNow(ctx.now + 120_000); ctx.tick(); ctx.event('window:focus'); previouslyQueuedCheck();
  assert.deepEqual(ctx.stops, { listening: 0, comments: 0 });
  assert.equal(ctx.intervals.size, 0);
});

test('manual stop, account/session changes and a new run all disarm the old reservation', () => {
  for (const change of [
    (state) => { state.live.isListening = false; },
    (state) => { state.auth.user.id = 'other'; },
    (state) => { state.auth.workspaceId = 'other'; },
    (state) => { state.live.currentSessionId = 'other'; },
    (state) => { state.live.listeningRunId++; },
  ]) {
    const ctx = providerFixture();
    ctx.render().scheduleStop(ctx.now + 60_000); ctx.settle();
    change(ctx.state); ctx.render();
    ctx.setNow(ctx.now + 120_000); ctx.tick();
    assert.equal(ctx.settle().scheduledStop, null);
    assert.deepEqual(ctx.stops, { listening: 0, comments: 0 });
  }
});

test('a delayed background tick or focus/visibility event uses wall-clock time, not a paused countdown', () => {
  for (const wake of ['tick', 'window:focus', 'document:visibilitychange']) {
    const ctx = providerFixture();
    ctx.render().scheduleStop(ctx.now + 60_000); ctx.settle();
    ctx.setNow(ctx.now + 5 * 60_000);
    if (wake === 'tick') ctx.tick(); else ctx.event(wake);
    assert.deepEqual(ctx.stops, { listening: 1, comments: 1 });
  }
});

test('reservations require an active authenticated listening run and reset on reload/unmount', () => {
  const ctx = providerFixture();
  ctx.state.live.isListening = false;
  assert.throws(() => ctx.render().scheduleStop(ctx.now + 60_000), /청취를 시작/);
  ctx.state.live.isListening = true; ctx.state.auth.user = null;
  assert.throws(() => ctx.render().scheduleStop(ctx.now + 60_000), /청취를 시작/);
  ctx.state.auth.user = { id: 'seller' };
  ctx.render().scheduleStop(ctx.now + 60_000); ctx.settle(); ctx.unmount();
  assert.equal(ctx.intervals.size, 0);
  assert.equal(providerFixture().render().scheduledStop, null);
});

test('the schedule provider wraps route content outside the listening page', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const page = fs.readFileSync('src/pages/seller/LiveHomePage.tsx', 'utf8');
  assert.match(app, /<CommentCaptureProvider>\s*<ListeningStopScheduleProvider>\s*<AppDataProvider>/);
  assert.match(page, /<ListeningStopControl\s*\/>/);
  assert.match(page, /<ListeningStopStatus\s*\/>/);
});

function controlFixture() {
  const now = new Date(2026, 9, 1, 20, 0).getTime();
  const state = { isListening: true, scheduledStop: null, remainingSeconds: 0, completedAt: null };
  const cells = [], effects = [], events = new Map(), reservations = [];
  let index = 0, cancelled = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useRef(value) { const i = index++; cells[i] ||= { current: value }; return cells[i]; },
    useState(value) {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof value === 'function' ? value() : value;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }];
    },
    useEffect(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) {
        const previous = cells[i]; cells[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
      }
    },
  };
  const dependencies = {
    react: { ...react, default: react },
    'lucide-react': { Clock: 'Clock', X: 'X' },
    '../../context/LiveContext': { useLive: () => state },
    '../../context/ListeningStopScheduleContext': { useListeningStopSchedule: () => ({ ...state,
      scheduleStop(endsAt) { reservations.push(endsAt); state.scheduledStop = { endsAt }; },
      cancelScheduledStop() { cancelled++; state.scheduledStop = null; },
      dismissCompletion() { state.completedAt = null; },
    }) },
    '../../services/listeningStopScheduleService': { ...scheduleService,
      resolveListeningStopAt: (input) => resolveListeningStopAt(input, now),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/live/ListeningStopControl.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, { module, exports: module.exports, Error, Date: class extends Date { static now() { return now; } },
    require: (name) => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
    window: { addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name) { events.delete(name); } },
  });
  return { state, now, reservations, get cancelled() { return cancelled; },
    render() {
      index = 0; const tree = module.exports.ListeningStopControl();
      effects.splice(0).forEach((effect) => effect()); return tree;
    },
    status: () => module.exports.ListeningStopStatus(),
    escape() { events.get('keydown')?.({ key: 'Escape', preventDefault() {} }); },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? textOf(tree.props?.children) : '';
}
const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && textOf(node) === label);
const submit = (tree) => nodes(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('the real reservation control opens, accepts presets/custom minutes and offers cancellation', () => {
  const ctx = controlFixture();
  button(ctx.render(), '종료 예약').props.onClick();
  let tree = ctx.render();
  assert.ok(nodes(tree).some((node) => node.props?.role === 'dialog'));
  button(tree, '30분').props.onClick(); tree = ctx.render(); submit(tree);
  assert.deepEqual(ctx.reservations, [ctx.now + 30 * 60_000]);
  assert.ok(textOf(ctx.status()).includes('예약 취소'));
  button(ctx.render(), '예약 변경').props.onClick(); tree = ctx.render();
  nodes(tree).find((node) => node.type === 'input' && node.props.type === 'radio').props.onChange(); tree = ctx.render();
  nodes(tree).find((node) => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { value: '15' } });
  tree = ctx.render(); submit(tree);
  assert.equal(ctx.reservations.at(-1), ctx.now + 15 * 60_000);
  button(ctx.render(), '예약 변경').props.onClick(); tree = ctx.render();
  button(tree, '예약 취소').props.onClick();
  assert.equal(ctx.cancelled, 1);
  assert.equal(ctx.state.scheduledStop, null);
});

test('fixed-time UI submits a valid local deadline and rejects a missing time', () => {
  const ctx = controlFixture();
  button(ctx.render(), '종료 예약').props.onClick();
  let tree = ctx.render();
  const radios = nodes(tree).filter((node) => node.type === 'input' && node.props.type === 'radio');
  radios[1].props.onChange(); tree = ctx.render();
  const input = () => nodes(tree).find((node) => node.type === 'input' && node.props.type === 'datetime-local');
  input().props.onChange({ target: { value: '' } }); tree = ctx.render(); submit(tree); tree = ctx.render();
  assert.equal(ctx.reservations.length, 0);
  assert.ok(nodes(tree).some((node) => node.props?.role === 'alert'));
  input().props.onChange({ target: { value: toLocalDateTimeInput(ctx.now + 90 * 60_000) } });
  tree = ctx.render(); submit(tree);
  assert.equal(ctx.reservations[0], ctx.now + 90 * 60_000);
});

test('the control is unavailable when stopped and the completion notice can be dismissed', () => {
  const ctx = controlFixture();
  ctx.state.isListening = false;
  assert.equal(button(ctx.render(), '종료 예약').props.disabled, true);
  ctx.state.completedAt = ctx.now;
  assert.match(textOf(ctx.status()), /음성 청취와 댓글 캡처를 중지/);
  button(ctx.status(), '닫기').props.onClick();
  assert.equal(ctx.status(), null);
  ctx.state.isListening = true;
  button(ctx.render(), '종료 예약').props.onClick(); ctx.render(); ctx.escape();
  assert.equal(nodes(ctx.render()).some((node) => node.props?.role === 'dialog'), false);
});
