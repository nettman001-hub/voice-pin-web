import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, Event, Error, ...globals,
    require(name) { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name]; },
  }, { filename: path });
  return module.exports;
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const history = load('../src/utils/transcriptHistory.ts');
const { mergeTranscriptHistory, filterTranscriptHistory, buildTranscriptCsv, buildTranscriptTxt } = history;
const workspace1 = '11111111-1111-4111-8111-111111111111';
const workspace2 = '22222222-2222-4222-8222-222222222222';
const session1 = '33333333-3333-4333-8333-333333333333';
const session2 = '44444444-4444-4444-8444-444444444444';
const log = (id, changes = {}) => ({
  id, sessionId: session1, timestamp: '2026-09-29T12:00:00.000Z', text: `판매 멘트 ${id}`,
  isFinal: true, confidence: 0.95, matchedKeywords: [], actionTriggered: 'NONE', ...changes,
});

test('history merges cloud, local and live records without truncating to the 300-row UI limit', () => {
  const cloud = Array.from({ length: 450 }, (_, index) => log(`log-${index}`));
  const local = cloud.map((row) => ({ ...row }));
  const current = [log('log-449', { text: '수정된 마지막 멘트', actionTriggered: 'SALE_SAVED' }), log('new')];
  const records = mergeTranscriptHistory(cloud, local, current);
  assert.equal(records.length, 451);
  assert.equal(records.find((row) => row.id === 'log-449').text, '수정된 마지막 멘트');
  assert.equal(buildTranscriptTxt(records, () => '1회차').split('\r\n').length, 451);
});

test('identical utterances and IDs in separate sessions remain independent', () => {
  const records = mergeTranscriptHistory([log('same'), log('same', { sessionId: session2 }), log('repeat', { text: '판매 멘트 same' })]);
  assert.equal(records.length, 3);
});

test('legacy localized timestamps are recovered from the generated ID, including across midnight', () => {
  const before = Date.parse('2026-09-29T14:59:59.000Z');
  const after = Date.parse('2026-09-29T15:00:01.000Z');
  const records = mergeTranscriptHistory([
    log(`log-${after}-abcd`, { timestamp: '오전 12:00:01' }),
    log(`log-${before}-abcd`, { timestamp: '오후 11:59:59' }),
  ]);
  assert.deepEqual(clone(records.map((row) => row.timestamp)), ['2026-09-29T14:59:59.000Z', '2026-09-29T15:00:01.000Z']);
});

test('new ISO recognition timestamps take priority and invalid or interim records are excluded', () => {
  const records = mergeTranscriptHistory([
    log('new', { timestamp: '오후 9:00:00', recognizedAt: '2026-09-29T12:00:00Z' }),
    log('interim', { isFinal: false }), log('blank', { text: '  ' }),
    log('invalid', { timestamp: 'not a date' }), null,
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].timestamp, '2026-09-29T12:00:00.000Z');
});

test('session, local date and text filters apply to the same full history used for download', () => {
  const date = '2026-09-29';
  const at = (time) => new Date(`${date}T${time}`).toISOString();
  const records = mergeTranscriptHistory([
    log('start', { timestamp: at('00:00:00'), text: '신상 상품 소개' }),
    log('end', { timestamp: at('23:59:59.999'), text: '신상 상품 마감' }),
    log('previous', { timestamp: new Date('2026-09-28T23:59:59').toISOString(), text: '신상 상품' }),
    log('other', { sessionId: session2, timestamp: at('12:00:00'), text: '신상 상품' }),
    log('unmatched', { timestamp: at('12:00:00'), text: '인사드립니다' }),
  ]);
  const filtered = filterTranscriptHistory(records, { sessionId: session1, fromDate: date, toDate: date, searchText: ' 신상 ' });
  assert.deepEqual(clone(filtered.map((row) => row.id)), ['start', 'end']);
  assert.equal(filterTranscriptHistory(records, { sessionId: 'ALL', fromDate: '', toDate: '', searchText: '' }).length, 5);
});

test('CSV contains BOM, escaped multiline text, session labels, confidence and action metadata', () => {
  const csv = buildTranscriptCsv([log('quoted', { text: '"신상", 상품\n확정', confidence: 0, matchedKeywords: ['구매', '"확정"'], actionTriggered: 'SALE_SAVED' })], () => '방송 1회차');
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /""신상"", 상품\n확정/);
  assert.match(csv, /"0\.0%"/);
  assert.match(csv, /"방송 1회차"/);
  assert.match(csv, /"판매 저장"/);
  assert.match(csv, /구매; ""확정""/);
});

test('CSV does not execute spreadsheet formulas from spoken text or session labels', () => {
  const csv = buildTranscriptCsv([log('formula', { text: '=HYPERLINK("url")', matchedKeywords: ['@SUM(1)'] })], () => '+위험한 회차');
  assert.match(csv, /"'=HYPERLINK\(""url""\)"/);
  assert.match(csv, /"'\+위험한 회차"/);
  assert.match(csv, /"'@SUM\(1\)"/);
});

test('TXT includes original sales wording and broadcast context', () => {
  const txt = buildTranscriptTxt([log('sale', { text: '구매확정 러블리샵님 32000원', actionTriggered: 'SALE_SAVED' })], () => '9월 29일 1회차');
  assert.match(txt, /\[2026-09-29T12:00:00.000Z\] \[9월 29일 1회차\] 판매자: 구매확정 러블리샵님 32000원 \[판매 저장\]/);
});

// Run the actual LiveContext callback bodies without starting audio devices,
// timers, React providers or real cloud requests.
function liveCallback(name, globals) {
  const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0].getText(file);
    }
    if (name === 'ownerEffect' && ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect'
      && node.arguments[0]?.getText(file).includes("const nextOwner = workspaceId || user?.id || 'local'")) {
      callback = node.arguments[0].getText(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback, `Live callback ${name} exists`);
  const { outputText } = ts.transpileModule(`module.exports = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, console: { log() {}, warn() {} }, ...globals });
  return module.exports;
}

test('the live getter returns the complete session array and rejects stale workspace ownership', () => {
  const rows = Array.from({ length: 420 }, (_, index) => log(`actual-live-${index}`));
  const globals = { workspaceId: workspace1, user: { id: 'seller' }, transcriptWorkspaceIdRef: { current: workspace1 },
    currentSessionIdRef: { current: session1 }, sessionTranscriptsRef: { current: new Map([[session1, rows]]) },
    allSessionTranscriptsRef: { current: rows } };
  const getter = liveCallback('getCurrentSessionTranscripts', globals);
  const result = getter();
  assert.equal(result.length, 420); assert.notEqual(result, rows);
  globals.transcriptWorkspaceIdRef.current = workspace2;
  assert.equal(getter().length, 0);
});

test('workspace changes retain each owner archive without letting old cleanup upload the new owner logs', async () => {
  const before = [log('previous-owner')], after = [log('next-owner')], localWrites = [], cloudWrites = [];
  const globals = {
    workspaceId: workspace1, user: { id: 'seller-1' }, isSupabaseConfigured: true,
    transcriptWorkspaceIdRef: { current: workspace1 }, currentSessionIdRef: { current: session1 },
    sessionTranscriptsRef: { current: new Map([[session1, before]]) }, allSessionTranscriptsRef: { current: before },
    transcriptPersistTimerRef: { current: 123 }, lastSavedCloudTranscriptCountRef: { current: new Map([[session1, 1]]) },
    storageService: { saveSessionTranscripts: (owner, session, rows) => localWrites.push({ owner, session, rows }),
      getSessionTranscripts: (owner) => owner === workspace2 ? after : [] },
    remoteWorkspaceService: { saveCloudSessionTranscripts: async (...args) => { cloudWrites.push(args); return true; } },
    setTranscriptLogs() {}, setTotalSessionTranscriptCount() {}, setCloudSyncStatus() {}, window: { clearTimeout() {} },
  };
  const previousCleanupSync = liveCallback('syncSessionTranscriptsToCloud', globals);
  liveCallback('ownerEffect', { ...globals, workspaceId: workspace2, user: { id: 'seller-2' } })();
  assert.equal(localWrites[0].owner, workspace1);
  assert.equal(localWrites[0].rows[0].id, 'previous-owner');
  assert.equal(globals.allSessionTranscriptsRef.current[0].id, 'next-owner');
  assert.equal(globals.transcriptWorkspaceIdRef.current, workspace2);
  assert.equal(globals.transcriptPersistTimerRef.current, null);
  assert.equal(globals.lastSavedCloudTranscriptCountRef.current.size, 0);
  assert.equal(await previousCleanupSync(), false);
  assert.equal(cloudWrites.length, 0);
});

test('empty live cleanup cannot overwrite an existing persisted session archive', () => {
  const writes = [];
  liveCallback('persistCurrentSessionTranscripts', {
    transcriptPersistTimerRef: { current: null }, currentSessionIdRef: { current: session1 },
    sessionTranscriptsRef: { current: new Map() }, allSessionTranscriptsRef: { current: [] },
    transcriptWorkspaceIdRef: { current: workspace1 }, storageService: { saveSessionTranscripts: (...args) => writes.push(args) },
  })();
  assert.equal(writes.length, 0);
});

function localStorageFixture() {
  const entries = new Map();
  const localStorage = {
    get length() { return entries.size; }, key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; }, setItem(key, value) { entries.set(key, value); }, removeItem(key) { entries.delete(key); },
  };
  const { StorageService } = load('../src/services/storageService.ts', {
    '../types/comment': load('../src/types/comment.ts'), './durableStorage': { durableStorage: {} },
    './sttVocabularyService': { normalizeSttVocabulary: (words) => words },
  }, { localStorage });
  return { storage: new StorageService(), entries };
}

test('local transcript discovery is workspace-scoped and includes encoded legacy session IDs', () => {
  const { storage, entries } = localStorageFixture();
  storage.saveSessionTranscripts(workspace1, session1, [log('own')]);
  storage.saveSessionTranscripts(workspace1, '20260928_01:임시 회차', [log('legacy')]);
  storage.saveSessionTranscripts(workspace2, session1, [log('foreign')]);
  entries.set(`voicecap_transcripts:${workspace1}:broken%`, '{malformed');
  entries.set(`voicecap_transcripts:${workspace1}-other:${session1}`, JSON.stringify([log('similar-workspace')]));
  const records = storage.getTranscriptHistory(workspace1);
  assert.deepEqual(clone(records.map((row) => row.id)), ['own', 'legacy']);
  assert.equal(records[1].sessionId, '20260928_01:임시 회차');
  assert.equal(storage.getTranscriptHistory('').length, 0);
});

function remoteFixture(rows, fail = false) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    return {
      select(columns) { call.columns = columns; return this; },
      eq(column, value) { call.filters.push({ column, value }); return this; },
      like(column, value) { call.like = { column, value }; return this; },
      order(column) { call.order = column; return this; },
      async range(from, to) {
        call.range = [from, to];
        const matching = rows.filter((row) => call.filters.every(({ column, value }) => row[column] === value)
          && (!call.like || row.namespace.startsWith('session_transcripts_'))).sort((a, b) => a.namespace.localeCompare(b.namespace));
        return { data: matching.slice(from, to + 1), error: fail ? { message: 'offline' } : null };
      },
    };
  } };
  const { remoteWorkspaceService: service } = load('../src/services/remoteWorkspaceService.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => client },
    './commerceChanges': { hasCommerceChanges: () => false },
    './sttVocabularyService': { normalizeSttVocabulary: (words) => words },
  });
  return { service, calls };
}
const cloudRow = (sessionId, changes = {}) => ({ workspace_id: workspace1, namespace: `session_transcripts_${sessionId}`,
  value: { workspaceId: workspace1, sessionId, logs: [log(`cloud-${sessionId}`)] }, ...changes });

test('cloud history reads only the requested workspace and session namespace', async () => {
  const { service, calls } = remoteFixture([cloudRow(session1), cloudRow(session2), cloudRow(session1, { workspace_id: workspace2 })]);
  const records = await service.fetchSessionTranscriptHistory(workspace1, session1);
  assert.equal(records.length, 1);
  assert.equal(records[0].sessionId, session1);
  assert.deepEqual(calls[0].filters, [{ column: 'workspace_id', value: workspace1 }, { column: 'namespace', value: `session_transcripts_${session1}` }]);
  assert.equal(calls.length, 1);
});

test('all-session cloud history is paginated and never silently limited to the first page', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => cloudRow(`session-${String(index).padStart(3, '0')}`));
  rows.push({ workspace_id: workspace1, namespace: 'recognition_rules', value: {} });
  const { service, calls } = remoteFixture(rows);
  const records = await service.fetchSessionTranscriptHistory(workspace1);
  assert.equal(records.length, 101);
  assert.deepEqual(calls.map((call) => call.range), [[0, 99], [100, 199]]);
  assert.equal(calls[0].like.value, 'session\\_transcripts\\_%');
  assert.equal(calls.every((call) => call.filters[0].value === workspace1), true);
});

test('cloud payloads cannot claim another workspace or session', async () => {
  const { service } = remoteFixture([
    cloudRow(session1, { value: { workspaceId: workspace2, sessionId: session1, logs: [log('foreign')] } }),
    cloudRow(session2, { value: { workspaceId: workspace1, sessionId: session1, logs: [log('wrong-session')] } }),
  ]);
  assert.equal((await service.fetchSessionTranscriptHistory(workspace1)).length, 0);
  assert.equal((await service.fetchSessionTranscriptHistory('')).length, 0);
});

test('cloud read failures are surfaced instead of being mistaken for an empty archive', async () => {
  const { service } = remoteFixture([], true);
  await assert.rejects(service.fetchSessionTranscriptHistory(workspace1), /클라우드 판매멘트 기록/);
});

function pageFixture({ current = [], saved = [], cloud = [], cloudRead, comments = [] } = {}) {
  const cells = [], effects = [], downloads = [], remoteCalls = [];
  let index = 0, params = new URLSearchParams(), auth = { workspaceId: workspace1, user: { id: 'seller-1' } };
  const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useRef(value) { const i = index++; cells[i] ||= { current: value }; return cells[i]; },
    useState(value) { const i = index++; if (!(i in cells)) cells[i] = typeof value === 'function' ? value() : value;
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useMemo(callback, deps) { const i = index++; if (!same(cells[i]?.deps, deps)) cells[i] = { deps, value: callback() }; return cells[i].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = index++; if (!same(cells[i]?.deps, deps)) {
      const previous = cells[i]; cells[i] = { deps };
      effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = callback(); });
    } },
  };
  const getCurrentSessionTranscripts = () => auth.workspaceId === workspace1 ? current : [];
  let lastBlob;
  const { CommentRecordsPage } = load('../src/pages/seller/CommentRecordsPage.tsx', {
    react: { ...react, default: react },
    'react-router-dom': { Link: 'link', useSearchParams: () => [params, (next) => { params = next; }] },
    '../../context/AuthContext': { useAuth: () => auth },
    '../../context/CommentCaptureContext': { useCommentCapture: () => ({ isActive: false, isRunning: false }) },
    '../../context/LiveContext': { useLive: () => ({ currentSessionId: session1, totalSessionTranscriptCount: current.length,
      transcriptLogs: current.slice(-300), getCurrentSessionTranscripts }) },
    '../../services/productSalesApi': { productSalesApi: {
      listLiveComments: async () => ({ comments }),
      listSessions: async () => ({ sessions: [
        { id: session1, startedAt: '2026-09-29T12:00:00Z', status: 'ACTIVE', displayCode: '오늘 1회차' },
        { id: session2, startedAt: '2026-09-28T12:00:00Z', status: 'ENDED', displayCode: '어제 1회차' },
      ] }),
    } },
    '../../services/remoteWorkspaceService': { remoteWorkspaceService: {
      async fetchSessionTranscriptHistory(owner, sessionId) { remoteCalls.push({ owner, sessionId });
        return cloudRead ? cloudRead(owner, sessionId) : cloud.filter((row) => !sessionId || row.sessionId === sessionId); },
    } },
    '../../services/storageService': { storageService: { getTranscriptHistory: (owner) => owner === workspace1 ? saved : [] } },
    '../../utils/sessionFormatter': { formatSessionDisplay: (id, options) => options?.sessions?.find((row) => row.id === id)?.displayCode || id },
    '../../utils/transcriptHistory': history,
    'lucide-react': Object.fromEntries(['MessageSquareText', 'Trash2', 'Download', 'ArrowRight', 'BellRing', 'Search', 'RefreshCw', 'FileText', 'FileSpreadsheet', 'Mic'].map((icon) => [icon, icon])),
  }, {
    window: { addEventListener() {}, removeEventListener() {} }, Blob, URLSearchParams,
    URL: { createObjectURL(blob) { lastBlob = blob; return 'blob:download'; }, revokeObjectURL() {} },
    document: { body: { appendChild() {}, removeChild() {} }, createElement() {
      return { setAttribute(name, value) { this[name] = value; }, click() { downloads.push({ filename: this.download, blob: lastBlob }); } };
    } }, alert(message) { throw new Error(message); },
  });
  const render = () => { index = 0; const tree = CommentRecordsPage(); while (effects.length) effects.shift()(); return tree; };
  const settle = async () => { let tree; for (let i = 0; i < 4; i++) { tree = render(); await tick(); } return render(); };
  return { render, settle, downloads, remoteCalls, setAuth(next) { auth = next; }, setSession(sessionId) {
    params = new URLSearchParams(params); params.set('session', sessionId);
  } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
const textContent = (tree) => Array.isArray(tree) ? tree.map(textContent).join('')
  : tree && typeof tree === 'object' ? textContent(tree.props?.children) : tree == null ? '' : String(tree);
const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && textContent(node) === label);

test('record menu lazily loads seller history and TXT/CSV exports all current utterances, not only the UI tail', async () => {
  const current = Array.from({ length: 420 }, (_, index) => log(`current-${index}`));
  const ctx = pageFixture({ current, saved: current.slice(0, 200), cloud: current.slice(0, 300) });
  let tree = await ctx.settle();
  assert.match(textContent(tree), /댓글\/판매멘트 기록/);
  assert.equal(ctx.remoteCalls.length, 0);
  button(tree, '판매멘트').props.onClick(); tree = await ctx.settle();
  assert.equal(ctx.remoteCalls.at(-1).sessionId, session1);
  assert.equal(button(tree, 'TXT').props.disabled, false);
  button(tree, 'TXT').props.onClick();
  assert.match(ctx.downloads[0].filename, /^판매멘트기록_.*\.txt$/);
  const txt = await ctx.downloads[0].blob.text();
  assert.equal(txt.split('\r\n').length, 420);
  assert.match(txt, /current-0/); assert.match(txt, /current-419/);
  button(tree, 'CSV').props.onClick();
  const csv = await ctx.downloads[1].blob.text();
  assert.equal(csv.split('\r\n').length, 421);
  assert.match(csv, /오늘 1회차/);
  assert.equal(nodes(tree).some((node) => node.props?.children?.includes('선택 삭제 (0)')), false);
});

test('seller downloads obey shared session and search filters, including all archived sessions', async () => {
  const ctx = pageFixture({ current: [log('new', { text: '오늘 상품' })],
    saved: [log('old', { sessionId: session2, timestamp: '2026-09-28T12:00:00Z', text: '어제 상품' })],
    cloud: [log('remote-old', { sessionId: session2, timestamp: '2026-09-28T13:00:00Z', text: '원격 상품' })],
  });
  let tree = await ctx.settle(); button(tree, '판매멘트').props.onClick(); tree = await ctx.settle();
  ctx.setSession('ALL'); tree = await ctx.settle();
  button(tree, 'TXT').props.onClick();
  assert.equal((await ctx.downloads[0].blob.text()).split('\r\n').length, 3);
  const search = nodes(tree).find((node) => node.type === 'input' && node.props.type === 'text');
  search.props.onChange({ target: { value: '원격' } }); tree = await ctx.settle();
  button(tree, 'TXT').props.onClick();
  const filtered = await ctx.downloads[1].blob.text();
  assert.match(filtered, /원격 상품/); assert.doesNotMatch(filtered, /오늘 상품|어제 상품/);
  assert.match(filtered, /어제 1회차/);
});

test('default session waits for the cloud session list rather than locking onto an older local archive', async () => {
  const ctx = pageFixture({ saved: [log('old', { sessionId: session2, timestamp: '2026-09-28T12:00:00Z' })] });
  const tree = await ctx.settle();
  assert.equal(nodes(tree).find((node) => node.type === 'select').props.value, session1);
});

test('cloud history failure preserves downloadable local utterances and displays a warning', async () => {
  const ctx = pageFixture({ saved: [log('local')], cloudRead: async () => { throw new Error('클라우드 오류: 로컬 기록만 표시'); } });
  let tree = await ctx.settle(); button(tree, '판매멘트').props.onClick(); tree = await ctx.settle();
  assert.match(textContent(tree), /클라우드 오류: 로컬 기록만 표시/);
  assert.equal(button(tree, 'TXT').props.disabled, false);
  button(tree, 'TXT').props.onClick(); assert.match(await ctx.downloads[0].blob.text(), /판매 멘트 local/);
});

test('comment downloads still export comments only after adding the seller transcript tab', async () => {
  const ctx = pageFixture({ current: [log('seller')], comments: [{ id: 'comment-1', sessionId: session1,
    nicknameSnapshot: '구매자', content: '저요 구매합니다', capturedAt: '2026-09-29T12:01:00Z' }] });
  const tree = await ctx.settle();
  button(tree, 'TXT').props.onClick();
  assert.match(ctx.downloads[0].filename, /^댓글캡처기록_.*\.txt$/);
  const txt = await ctx.downloads[0].blob.text();
  assert.match(txt, /구매자: 저요 구매합니다/); assert.doesNotMatch(txt, /판매 멘트 seller/);
  assert.equal(ctx.remoteCalls.length, 0);
});

test('downloads stay disabled while cloud history is loading to avoid partial exports', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const ctx = pageFixture({ current: [log('local')], cloudRead: () => pending });
  let tree = await ctx.settle(); button(tree, '판매멘트').props.onClick(); tree = await ctx.settle();
  assert.equal(button(tree, 'TXT').props.disabled, true);
  assert.equal(button(tree, 'CSV').props.disabled, true);
  button(tree, 'TXT').props.onClick(); assert.equal(ctx.downloads.length, 0);
  resolve([log('cloud')]); tree = await ctx.settle();
  assert.equal(button(tree, 'TXT').props.disabled, false);
  button(tree, 'TXT').props.onClick(); assert.equal((await ctx.downloads[0].blob.text()).split('\r\n').length, 2);
});

test('late archive responses cannot leak a previous workspace into the current seller menu', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const ctx = pageFixture({ cloudRead: (owner) => owner === workspace1 ? pending : Promise.resolve([]) });
  let tree = await ctx.settle(); button(tree, '판매멘트').props.onClick(); ctx.render();
  ctx.setAuth({ workspaceId: workspace2, user: { id: 'seller-2' } }); tree = await ctx.settle();
  resolve([log('private-old-record', { text: '이전 판매자의 비공개 멘트' })]); tree = await ctx.settle();
  assert.doesNotMatch(textContent(tree), /이전 판매자의 비공개 멘트/);
  assert.equal(button(tree, 'TXT').props.disabled, true);
});
