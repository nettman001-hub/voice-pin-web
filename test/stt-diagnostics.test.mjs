import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import 'fake-indexeddb/auto';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `
  export { SttDiagnostics, sanitizeSttDiagnostic } from './src/services/sttDiagnostics';
  export { DurableStorage } from './src/services/durableStorage';
  export { SalesSyncController } from './src/services/salesSyncController';
  export { advanceVoiceSaleTransaction } from './src/services/voiceSaleTransaction';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { SttDiagnostics, sanitizeSttDiagnostic, DurableStorage, SalesSyncController, advanceVoiceSaleTransaction } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const scope = (extra = {}) => ({ workspaceId: 'seller-1', sessionId: 'broadcast-1', mode: 'TEST', ...extra });
const database = () => new DurableStorage(`diagnostic-test-${crypto.randomUUID()}`);
const clone = value => JSON.parse(JSON.stringify(value));

test('one export survives reload and isolates broadcast, account and operating/test mode', async () => {
  const store = database(), recorder = new SttDiagnostics(store);
  const original = { tokens: [{ text: '민트님', is_final: true, start_ms: 12, end_ms: 500 }], request_id: 'request-1' };
  recorder.record(scope(), 'stt.response', original);
  original.tokens[0].text = 'mutated later';
  for (const other of [scope({ mode: 'PRODUCTION' }), scope({ workspaceId: 'seller-2' }), scope({ sessionId: 'broadcast-2' })]) {
    recorder.record(other, 'stt.response', { text: 'must not appear' });
  }
  await recorder.flush();
  const restored = await new SttDiagnostics(store).export(scope(), { sale: { id: 's-1' } });
  assert.equal(restored.eventCount, 1);
  assert.equal(restored.events[0].detail.tokens[0].text, '민트님');
  assert.equal(restored.snapshots.sale.id, 's-1');
  assert.equal(restored.warnings.length, 0);
  assert.ok(!JSON.stringify(restored).includes('must not appear'));
});

test('partial flushes retain full pages, bound storage and disclose evicted sequence numbers after reload', async () => {
  const store = database(), recorder = new SttDiagnostics(store, 2, 3);
  for (let index = 1; index <= 10; index++) {
    recorder.record(scope(), 'stt.response', { index });
    await recorder.flush();
  }
  const restored = await new SttDiagnostics(store, 2, 3).export(scope());
  assert.equal(restored.eventCount, 4);
  assert.deepEqual(restored.events.map(event => event.detail.index), [7, 8, 9, 10]);
  assert.equal(restored.streams[0].omittedEarlierEvents, 6);
  assert.match(restored.warnings.join(), /EARLIER_EVENTS_EVICTED/);
  assert.equal((await store.entries('session:')).length, 2);
});

test('failed local storage still permits an in-memory export with an explicit warning', async () => {
  const recorder = new SttDiagnostics({ set: async () => { throw Error('quota'); }, entries: async () => { throw Error('unavailable'); } });
  recorder.record(scope(), 'sale.save.failed', new Error('offline'));
  const report = await recorder.export(scope());
  assert.equal(report.events[0].detail.message, 'offline');
  assert.match(report.warnings.join(), /LOCAL_DIAGNOSTIC_STORAGE_FAILED/);
});

test('sanitization preserves speech/timing while excluding nested credentials, bearer/JWT strings and binary audio', () => {
  const value = { response: { tokens: [{ text: '가격은 3.8', start_ms: 3, end_ms: 8 }], api_key: 'secret-key' },
    authorization: 'secret-auth', access_token: 'secret-token',
    message: 'Bearer abcdef https://host/path?api_key=secret-query&ok=true',
    malformed: '{"api_key":"secret-json",broken', bytes: new Uint8Array([1, 2]),
    error: Object.assign(new Error('Bearer error-token'), { refresh_token: 'secret-refresh' }) };
  value.circular = value;
  const sanitized = sanitizeSttDiagnostic(value);
  const text = JSON.stringify(sanitized);
  for (const secret of ['secret-key', 'secret-auth', 'secret-token', 'abcdef', 'secret-query', 'secret-json', 'error-token', 'secret-refresh']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.equal(sanitized.response.tokens[0].text, '가격은 3.8');
  assert.equal(sanitized.response.tokens[0].end_ms, 8);
  assert.equal(sanitized.bytes, '[binary omitted]');
});

function cloudFixture(provider, sink, onTranscript) {
  const sockets = [];
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL('../src/services/deepgramService.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, WebSocket: Socket, ArrayBuffer, Int16Array,
    window: { setTimeout, clearTimeout }, console: { log() {}, warn() {}, error() {} } });
  const service = new exports.DeepgramSttService();
  service.startLiveStream({ provider, model: 'nova-3', apiKey: 'DO-NOT-EXPORT-KEY', keyterms: [], allowBrowserSpeechFallback: false,
    diagnostics: sink }, onTranscript, () => {});
  const socket = sockets.at(-1);
  socket.readyState = Socket.OPEN;
  socket.onopen();
  return { service, socket };
}

test('Soniox wire responses, assembled transaction and save failure/retry ACK are correlated in one JSON', async () => {
  const recorder = new SttDiagnostics(database());
  const sink = recorder.sink(scope());
  let state = null, local = { records: [], pending: [] }, offline = true;
  const sync = new SalesSyncController({ read: () => local, persist: next => { local = clone(next); },
    save: async () => { if (offline) throw Object.assign(Error('offline'), { retryable: true }); },
    load: async () => [], remove: async () => {}, changed() {}, error() {}, active: () => true,
    diagnostic: sink,
  });
  const ctx = cloudFixture('SONIOX', sink, data => {
    recorder.record(scope(), 'stt.transcript', { eventId: data.diagnosticEventId, text: data.text, isFinal: data.isFinal });
    if (!data.isFinal) return;
    const next = advanceVoiceSaleTransaction(state, { sessionId: scope().sessionId, eventId: data.diagnosticEventId,
      recognizedAt: new Date().toISOString(), text: data.text, diagnostics: sink });
    state = next.state;
    if (next.emission) sync.upsert({ id: 's-one', sessionId: scope().sessionId, buyerNickname: next.emission.result.buyerNickname,
      amount: next.emission.result.amount, status: '자동저장', rawTranscript: next.emission.result.rawTranscript,
      recognizedAt: next.emission.startedAt, source: 'WEB_VOICE' });
  });
  const raw = { request_id: 'wire-request', tokens: [{ text: '민트님 드릴게요. 가격은 0.5. 캡쳐해주세요.',
    is_final: true, start_ms: 10, end_ms: 900 }, { text: '<end>', is_final: true }] };
  ctx.socket.onmessage({ data: JSON.stringify(raw) });
  await sync.flush();
  offline = false;
  await sync.flush();
  ctx.service.stopLiveStream();
  const report = await recorder.export(scope());
  const wire = report.events.find(event => event.stage === 'stt.response');
  const transcript = report.events.find(event => event.stage === 'stt.transcript');
  const transaction = report.events.find(event => event.stage === 'transaction.decision');
  assert.equal(wire.detail.response.tokens[0].end_ms, 900);
  assert.equal(wire.detail.responseId, transcript.detail.eventId);
  assert.equal(transaction.detail.eventId, transcript.detail.eventId);
  assert.equal(transaction.detail.capture.requested, true);
  assert.equal(transaction.detail.emission.result.amount, 5000);
  assert.ok(report.events.some(event => event.stage === 'sale.save.failed'));
  assert.equal(report.events.find(event => event.stage === 'sale.save.acknowledged').detail.saleId, 's-one');
  assert.ok(!JSON.stringify(report).includes('DO-NOT-EXPORT-KEY'));
});

test('Deepgram raw is_final and speech_final survive with the transcript response ID', async () => {
  const recorder = new SttDiagnostics(database()), transcripts = [];
  const ctx = cloudFixture('DEEPGRAM', recorder.sink(scope()), data => transcripts.push(data));
  ctx.socket.onmessage({ data: JSON.stringify({ type: 'Results', is_final: true, speech_final: false,
    channel: { alternatives: [{ transcript: '3.8, 3.8이고요.', confidence: 0.9, words: [] }] } }) });
  ctx.service.stopLiveStream();
  const report = await recorder.export(scope());
  const raw = report.events.find(event => event.stage === 'stt.response');
  assert.equal(raw.detail.response.is_final, true);
  assert.equal(raw.detail.response.speech_final, false);
  assert.equal(raw.detail.responseId, transcripts[0].diagnosticEventId);
});

test('the actual live download callback produces one TEST JSON with persisted events and current sale/transcript snapshots', async () => {
  const recorder = new SttDiagnostics(database());
  recorder.record(scope(), 'stt.response', { tokens: [{ text: '3.8', is_final: true }] });
  const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'downloadSttDiagnostics') callback = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback);
  let blob, clicks = 0;
  const link = { click() { clicks++; }, remove() {} };
  const module = { exports: {} };
  const identity = { current: scope().workspaceId };
  const compiled = ts.transpileModule(`module.exports = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { module, sttDiagnostics: recorder, workspaceId: scope().workspaceId, user: { id: 'user' },
    runtime: { isTest: true }, Blob, URL: { createObjectURL(value) { blob = value; return 'blob:report'; }, revokeObjectURL() {} },
    window: { location: { pathname: '/live-test' }, setTimeout(callback) { callback(); } },
    document: { createElement: () => link, body: { appendChild() {} }, querySelector: () => ({ getAttribute: () => '/assets/app.js' }) },
    productSalesRef: { current: { activeSession: { id: scope().sessionId, displayCode: '20261021-1' } } },
    currentSessionIdRef: { current: scope().sessionId }, transcriptWorkspaceIdRef: identity, appliedWorkflowRef: { current: null },
    sessionTranscriptsRef: { current: new Map([[scope().sessionId, [{ text: '가격은 3.8' }]]]) },
    currentWorkflowSalesRef: { current: [{ id: 's-one', sessionId: scope().sessionId, amount: 38000, rawTranscript: '가격은 3.8' }] },
  });
  await module.exports();
  assert.equal(clicks, 1);
  assert.match(link.download, /VoiceCAP_STT_진단_테스트_.*\.json$/u);
  const report = JSON.parse(await blob.text());
  assert.equal(report.events[0].stage, 'stt.response');
  assert.equal(report.snapshots.sales[0].amount, 38000);
  assert.equal(report.snapshots.transcripts[0].text, '가격은 3.8');
  assert.equal(report.scope.mode, 'TEST');
  // Switching accounts while a report is being read cancels the download.
  identity.current = 'another-seller';
  await module.exports();
  assert.equal(clicks, 1);
});
