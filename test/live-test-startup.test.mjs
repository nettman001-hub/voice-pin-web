import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { diagnosticGlobals } from './runtime-fixture.mjs';
import assert from 'node:assert/strict';

function loadClass(path, globals = {}) {
  const source = fs.readFileSync(path, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console: { log() {}, warn() {}, error() {} }, ...globals });
  return exports;
}
const source = fs.readFileSync('src/context/LiveContext.tsx', 'utf8');
const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let start;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'startListening') start = node.initializer.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
const compiled = ts.transpileModule(`module.exports = ${start}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function scenario(mode, micFailure = false) {
  const state = { transitions: [], comments: 0, listening: false, status: '', message: '', audioStops: 0, releases: 0 };
  const intervals = new Map(); let timerId = 0;
  const { SimulatedCommentSource } = loadClass('src/services/liveTest/simulatedCommentSource.ts', {
    crypto: webcrypto, setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
  });
  const comments = new SimulatedCommentSource(async () => {});
  comments.onComment(() => state.comments++);
  comments.connect('test');
  const { localSttService } = loadClass('src/services/localSttService.ts', {
    setTimeout, clearTimeout,
    require(name) {
      if (name === 'socket.io-client') return { io: () => ({ connected: false, on() {}, emit() {} }) };
      if (name === '../types/comment') return { DEFAULT_COMMENT_SERVER_URL: 'http://127.0.0.1:2137' };
      throw Error(name);
    },
  });
  const globals = {
    ...diagnosticGlobals,
    console: { error() {} }, Uint8Array, Date, Map,
    isAuthenticatedRef: { current: true }, currentUserIdRef: { current: 'seller' }, authBoundaryGenerationRef: { current: 0 },
    listeningGenerationRef: { current: 0 }, activeListeningUserIdRef: { current: null }, startInFlightRef: { current: false },
    pendingStartupRef: { current: null }, window: { setTimeout, clearTimeout },
    isListeningRef: { current: false }, inputReleaseRef: { current: null }, currentUserRef: { current: { role: '관리자' } },
    currentSessionIdRef: { current: 'session' }, activeAudioSourceModeRef: { current: 'MIC' }, shareOwnerUserIdRef: { current: null },
    appliedWorkflowRef: { current: null }, workflowDecisionsRef: { current: new Set() }, workflowFingerprintsRef: { current: new Map() },
    workflowReplayRef: { current: null }, workflowObservationAtRef: { current: 0 },
    sessionTranscriptsRef: { current: new Map([['session', []]]) }, allSessionTranscriptsRef: { current: [] },
    transcriptWorkspaceIdRef: { current: 'test-workspace' }, sttModeRef: { current: mode },
    runtime: { isTest: true, acquireListeningInput: async () => () => { state.releases++; } }, isRemoteAuth: true,
    sellerAnalysisApi: { currentWorkflow: async () => null }, isSupabaseConfigured: false, workspaceId: 'test-workspace', user: { id: 'seller' },
    storageService: { getRules: () => [], getLocalSttModel: () => 'base' }, collectHintNicknames: () => ({ nicknames: [] }),
    localSttModel: 'base', localSttService,
    audioCaptureService: { async startCapture() { await new Promise(setImmediate); if (micFailure) throw new DOMException('Permission denied', 'NotAllowedError'); }, stopCapture() { state.audioStops++; } },
    screenCaptureService: {}, persistCurrentSessionTranscripts() {}, resetSonioxBusinessAccumulator() {}, syncSessionTranscriptsToCloud: async () => true,
    setWorkflowProcessingError() {}, setCurrentSessionId() {}, setTranscriptLogs() {}, setTotalSessionTranscriptCount() {}, setSessionStartTime() {},
    setLiveTranscriptFlow() {}, setLastMatchedRuleItem() {}, setCurrentInterimTranscript() {}, interimStreamChunkerRef: { current: { reset() {} } },
    setIsListening(value) { state.listening = value; state.transitions.push(value); queueMicrotask(() => { if (state.listening) comments.startCollecting('test'); else comments.stopCollecting(); }); },
    setSttEngineStatus(value) { state.status = value; }, setSttEngineMessage(value) { state.message = value; }, setAudioLevel() {}, setWaveform() {},
    handleTranscript() {}, getWordsForConnection: async () => [], buildNicknameHintTerms: () => [], buildCloudSttTerms: () => [],
    sttProvider: 'DEEPGRAM', deepgramApiKey: 'test-only-key', sonioxApiKey: '',
    cloudSttStartTimeRef: {}, activeCloudProviderRef: {}, activeCloudSttConfigRef: {}, activeCloudNicknameTermsRef: {},
    lastSuccessfulSttConnectionAtRef: {}, sttRotationBusyRef: {},
    deepgramService: { startLiveStream(_config, _text, _error, status) { status('CONNECTED', 'STT connected'); }, stopLiveStream() {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, Error, DOMException, ...globals });
  let outcome;
  try { await module.exports('MIC', 'session'); outcome = 'resolved'; } catch (error) { outcome = error.message; }
  await new Promise(setImmediate);
  const commentsAfterStart = state.comments;
  for (let i = 0; i < 3; i++) for (const tick of intervals.values()) tick();
  const result = { scenario: micFailure ? 'MIC permission failure' : mode === 'LOCAL' ? 'LOCAL helper offline' : 'CLOUD connected', outcome, ...state,
    commentsAfterStart, commentsAfterThreeTicks: state.comments, commentTimerCount: intervals.size };
  comments.disconnect();
  return result;
}
test('offline STT and microphone denial never start test comments and report the failure', async () => {
  const offline = await scenario('LOCAL');
  assert.match(offline.outcome, /내 PC STT에 연결할 수 없습니다/u);
  assert.equal(offline.commentsAfterStart, 0);
  assert.equal(offline.commentTimerCount, 0);
  assert.equal(offline.listening, false);
  const denied = await scenario('CLOUD', true);
  assert.match(denied.outcome, /마이크 권한이 거부되었습니다/u);
  assert.equal(denied.commentsAfterStart, 0);
  assert.equal(denied.commentTimerCount, 0);
  assert.equal(denied.listening, false);
});

test('comments continue at timed intervals only after microphone and STT are ready', async () => {
  const connected = await scenario('CLOUD');
  assert.equal(connected.outcome, 'resolved');
  assert.equal(connected.commentsAfterStart, 1);
  assert.equal(connected.commentsAfterThreeTicks, 4);
  assert.equal(connected.commentTimerCount, 1);
  assert.equal(connected.listening, true);
  assert.equal(connected.status, 'CONNECTED');
});
