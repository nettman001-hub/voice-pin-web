import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree == null || typeof tree === 'boolean' ? []
    : [tree, ...(typeof tree === 'object' ? nodes(tree.props?.children) : [])];
const visible = (tree) => nodes(tree).filter((node) => typeof node === 'string' || typeof node === 'number').join('');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const sample = '[고객 댓글]\n오후 11:50:36 · 햇살: 저요\n[판매자 멘트]\n오후 11:50:49 · 햇살님 1.5 드릴게요.';
const comment = (id, sessionId) => ({ id, sessionId, nickname: '햇살', content: id, capturedAt: '2026-10-16T01:00:00Z' });
const decision = (id, commentId, extra = {}) => ({
  id, status: 'CONFIRMED', nickname: '햇살', unitPrice: 15000, quantity: 1,
  reason: id, commentIds: [commentId], transcriptIds: [`speech-${id}`], decidedAt: '2026-10-16T01:00:00Z', ...extra,
});
const result = (decisions = [], extra = {}) => ({
  decisions, signals: [], context: [], unreviewedContext: [], segments: [], warnings: [],
  summary: 'A 회차의 분석 결과', provider: 'TEST', model: 'test', appliedVersion: 1,
  stats: { segmentCalls: 1, segmentMs: 1 },
  state: { slotNumber: 1, processedSegments: { a: 'done' }, context: [], unreviewedContext: [],
    decisions, warnings: [], stats: { segmentCalls: 1, segmentMs: 1 } }, ...extra,
});

// Execute the real page and scheduler with a transport that can resolve after abort.
function fixture() {
  const cells = [], effects = [], calls = [], runs = [], captures = [], blobs = [];
  const timers = new Map();
  let index = 0, sequence = 0, writes = 0, onComment;
  const state = { liveComments: [] };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initial) {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], (next) => { writes++; cells[i] = typeof next === 'function' ? next(cells[i]) : next; }];
    },
    useRef(initial) { const i = index++; return cells[i] ||= { current: initial }; },
    useEffect(callback, deps) {
      const i = index++;
      if (!same(cells[i]?.deps, deps)) {
        const previous = cells[i]; cells[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
      }
    },
  };
  const globals = {
    AbortController, Blob, console,
    crypto: { randomUUID: () => `local-${++sequence}` },
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement() { return { click() {} }; } },
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  function load(path, imports = {}) {
    const output = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(output, { ...globals, module, exports: module.exports,
      require(name) { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; },
    }, { filename: path });
    return module.exports;
  }
  const imports = {
    react: { __esModule: true, default: react, ...react },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    '../../context/LiveContext': { useLive: () => ({ isListening: false, sonioxApiKey: 'test' }) },
    '../../context/CommentCaptureContext': { useCommentCapture: () => ({
      liveComments: state.liveComments, serverStatus: 'CONNECTED',
      config: { tiktokUsername: 'seller', serverUrl: 'http://localhost' }, startCapture() {}, stopCapture() {},
    }) },
    '../../services/commentStreamService': { commentStreamService: {
      connect() {}, disconnect() {}, startCollecting() {}, stopCollecting() {},
      onStatus: () => () => {}, onComment(callback) { onComment = callback; return () => {}; },
    } },
    '../../types/comment': { DEFAULT_COMMENT_SERVER_URL: 'http://localhost' },
    '../../services/storageService': { storageService: { getCommentRecords: () => [] } },
    '../../services/productSalesApi': { productSalesApi: { listSessions: async () => ({ sessions: [
      { id: 'broadcast-b', displayCode: 'B 방송', status: 'ACTIVE' },
      { id: 'broadcast-c', status: 'ACTIVE' },
    ] }) } },
    '../../utils/sessionFormatter': { formatSessionDisplay: (id) => id },
    '../../services/sellerLogicDeepApi': {
      getSellerLogicSlots: async () => ({ primarySlot: 1, presetWords: ['test'], ruleWords: [],
        slots: [{ slotNumber: 1, provider: 'TEST', model: 'test' }] }),
      getSellerLogicDeepHints: async () => ({ presetWords: [], ruleWords: [] }),
      analyzeSellerLogicDeep(input, options) { const work = deferred(); calls.push({ input, options, ...work }); return work.promise; },
    },
    '../../services/sellerLogicDeepEngine': { async runSellerLogicDeep(input, call, options) {
      runs.push(input);
      const output = await call({ ...input, segment: { id: 'segment-a' } });
      options.onProgress(output);
      return output;
    } },
    '../../services/sellerLogicInput': load('src/services/sellerLogicInput.ts'),
    '../../services/sellerLogicScheduler': load('src/services/sellerLogicScheduler.ts'),
    '../../services/sellerLogicDeepTransactions': load('src/services/sellerLogicDeepTransactions.ts'),
    '../../services/sellerLogicCapture': { SellerLogicCapture: class {
      constructor() { captures.push(this); }
      async start(options) { this.options = options; }
      async stop() {}
      prioritizeNicknames() {}
    } },
    '../../services/sellerLogic04Argon': {
      updateActiveProductContext: (_previous, transcripts, comments) => transcripts.length || comments.length
        ? { unitPrice: 15000, stock: 1, candidateComments: [] } : null,
      buildArgonPromptWithContext: () => ({ systemPrompt: '', userPrompt: '{}' }),
      promoteArgonDecisions: (decisions) => decisions,
    },
    '../../components/admin/ArgonLiveConsole': { ArgonLiveConsole: 'ArgonLiveConsole' },
  };
  const page = load('src/pages/admin/SellerLogicAnalysis04ArgonPage.tsx', imports).default;
  const ctx = {
    state, calls, runs, captures, blobs,
    get writes() { return writes; },
    render() { index = 0; const tree = page(); effects.splice(0).forEach((effect) => effect()); return tree; },
    field(label) { const found = nodes(this.render()).find((node) => node.props?.['aria-label'] === label); assert.ok(found, label); return found; },
    button(label) { const found = nodes(this.render()).find((node) => node.type === 'button' && visible(node).trim() === label); assert.ok(found, label); return found; },
    click(label) { const button = this.button(label); assert.ok(!button.props.disabled, label); return button.props.onClick(); },
    select(id) { this.field('방송 회차 선택').props.onChange({ target: { value: id } }); this.render(); },
    emit(comment) { onComment(comment); },
    fireTimers() { const due = [...timers.values()]; timers.clear(); due.forEach((callback) => callback()); },
    async import() {
      this.render(); await tick();
      this.field('분석할 대화 텍스트').props.onChange({ target: { value: sample } });
      this.click('대화 자료 적용');
    },
    async download() { this.click('결과 내려받기'); return JSON.parse(await blobs.at(-1).text()); },
  };
  return ctx;
}

test('switching broadcasts clears A evidence and results and does not reimport its global comment buffer', async () => {
  const ctx = fixture();
  await ctx.import();
  const oldId = ctx.runs[0].sessionId;
  ctx.calls[0].resolve(result([decision('a-order', ctx.runs[0].comments[0].id)]));
  await tick();
  assert.equal((await ctx.download()).result.decisions.length, 1);

  ctx.select('broadcast-b');
  assert.equal(ctx.button('결과 내려받기').props.disabled, true);
  assert.ok(!visible(ctx.render()).includes('A 회차의 분석 결과'));
  ctx.state.liveComments = [comment('old-comment', oldId), comment('b-comment', 'broadcast-b')];
  ctx.render();
  const exported = await ctx.download();
  assert.equal(exported.sessionId, 'broadcast-b');
  assert.equal(exported.sessionDisplay, 'B 방송');
  assert.deepEqual(exported.comments.map((row) => row.id), ['b-comment']);
  assert.deepEqual(exported.transcripts, []);
  assert.equal(exported.result, null);
  assert.deepEqual(exported.extendedDecisions, []);

  ctx.select('broadcast-c');
  ctx.state.liveComments = [comment('c-comment', 'broadcast-c')];
  ctx.render();
  assert.equal((await ctx.download()).sessionDisplay, 'broadcast-c', 'a session without a name must not retain the previous name');
});

for (const outcome of ['success', 'error']) test(`late A analysis ${outcome} and socket comments cannot mutate the reset B session`, async () => {
  const ctx = fixture();
  await ctx.import();
  const pendingA = ctx.calls[0];
  // A queued UI event can arrive while analysis is still pending.
  ctx.select('broadcast-b');
  assert.equal(pendingA.options.signal.aborted, true);
  const writes = ctx.writes;
  if (outcome === 'success') pendingA.resolve(result([decision('late-order', 'a-comment')]));
  else pendingA.reject(new Error('A 회차의 지연 오류'));
  await tick();
  assert.equal(ctx.writes, writes, 'transport success after abort must not update results, diagnostics, or counters');
  ctx.emit({ id: 'late-comment', nickname: 'A', content: 'old', receivedAt: new Date().toISOString() });
  assert.equal(ctx.button('결과 내려받기').props.disabled, true);
  const consoleNode = nodes(ctx.render()).find((node) => node.type === 'ArgonLiveConsole');
  assert.equal(consoleNode.props.totalResponsesCount, 0);
  assert.equal(consoleNode.props.totalCallsCount, 0);
});

test('the first analysis after switching to B starts without A engine state', async () => {
  const ctx = fixture();
  await ctx.import();
  ctx.calls[0].resolve(result([decision('a-order', 'a-comment')]));
  await tick();
  ctx.select('broadcast-b');
  await ctx.click('실시간 청취 시작');
  ctx.captures.at(-1).options.transcript({ id: 'b-speech', text: 'B 방송의 멘트', recognizedAt: new Date().toISOString(), isFinal: true });
  ctx.fireTimers();
  assert.equal(ctx.runs.at(-1).sessionId, 'broadcast-b');
  assert.equal(ctx.runs.at(-1).state, undefined);
  assert.equal(ctx.runs.at(-1).comments.length, 0);
  assert.equal(ctx.runs.at(-1).transcripts[0].id, 'b-speech');
  ctx.calls.at(-1).resolve(result([], { summary: 'B 분석' }));
  await tick();
});

test('the Argon page keeps separate purchases with equal prices and conflicting products sharing a comment', async () => {
  const ctx = fixture();
  await ctx.import();
  const decisions = [
    decision('first', 'comment-1'), decision('repeat-purchase', 'comment-2'),
    decision('shirt', 'bundle-comment', { lineKey: 'shirt', productName: '셔츠' }),
    decision('pants', 'bundle-comment', { lineKey: 'pants', productName: '바지' }),
    decision('shirt-update', 'bundle-comment', { lineKey: 'shirt', productName: '셔츠', unitPrice: 18000 }),
  ];
  ctx.calls[0].resolve(result(decisions));
  await tick();
  const exported = await ctx.download();
  assert.equal(exported.result.decisions.length, 4);
  assert.equal(exported.extendedDecisions.length, 4, 'displayed decisions must use the same safe merge as exported decisions');
  assert.equal(exported.result.decisions.find((row) => row.id === 'shirt').unitPrice, 18000);
});
