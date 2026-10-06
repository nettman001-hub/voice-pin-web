import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as voiceSaleValidation from '../src/services/voiceSaleValidation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTypescript(relativePath, globals = {}, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected runtime import: ${id}`);
      return dependencies[id];
    },
    console,
    ...globals,
  }, { filename: relativePath });
  return exports;
}

test('STT vocabulary accepts 50 distinct short terms and discards invalid extras', () => {
  const { normalizeSttVocabulary, buildCloudSttTerms } = loadTypescript('src/services/sttVocabularyService.ts');
  const words = normalizeSttVocabulary([
    '  코듀로이  ', '코듀로이', 'AFTERNOON tea', 'afternoon tea',
    ...Array.from({ length: 60 }, (_, index) => `상품${index}`),
  ]);
  assert.equal(words.length, 50);
  assert.deepEqual(Array.from(words.slice(0, 3)), ['코듀로이', 'AFTERNOON tea', '상품0']);
  assert.ok(!words.includes('상품59'));
  assert.deepEqual(Array.from(normalizeSttVocabulary(['짧은말, 다음말\n세 번째'])), ['짧은말', '다음말', '세 번째']);
  assert.deepEqual(Array.from(normalizeSttVocabulary(['x'.repeat(41), '정상'])), ['정상']);

  const presets = Array.from({ length: 50 }, (_, index) => `브랜드${index}`);
  const nicknames = Array.from({ length: 25 }, (_, index) => `고객${index}`);
  const rules = ['브랜드0', ...Array.from({ length: 70 }, (_, index) => `규칙${index}`)];
  const combined = buildCloudSttTerms(presets, nicknames, rules);
  assert.equal(combined.length, 100);
  assert.deepEqual(Array.from(combined.slice(0, 50)), presets);
  assert.deepEqual(Array.from(combined.slice(50, 75)), nicknames);
  assert.equal(combined.filter((word) => word === '브랜드0').length, 1);
});

test('cloud STT nickname hints use the latest 25 distinct commenters', () => {
  const { getRecentCommentNicknames } = loadTypescript('src/services/sttVocabularyService.ts');
  const comments = Array.from({ length: 30 }, (_, index) => ({
    nicknameSnapshot: `고객${index}`,
    capturedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
    ingestSequence: index,
  })).reverse();
  comments.push({
    nicknameSnapshot: '고객10',
    capturedAt: new Date(Date.UTC(2026, 9, 1, 0, 1, 0)).toISOString(),
    ingestSequence: 31,
  });

  const nicknames = getRecentCommentNicknames(comments);
  assert.equal(nicknames.length, 25);
  assert.equal(nicknames[0], '고객10');
  assert.equal(nicknames.filter((nickname) => nickname === '고객10').length, 1);
  assert.ok(nicknames.includes('고객29'));
  assert.ok(!nicknames.includes('고객4'));
});

test('STT session rotation reacts to nickname set changes without rotating for order alone', () => {
  const { decideSttSessionRotation, STT_ROTATION_POLICY } = loadTypescript('src/services/sttSessionRotationService.ts');
  assert.equal(decideSttSessionRotation([], ['첫고객'], 9_999).shouldRotate, false);
  assert.equal(decideSttSessionRotation([], ['첫고객'], 10_000).reason, 'INITIAL_NICKNAMES');

  const sent = ['고객1', '고객2', '고객3'];
  assert.equal(decideSttSessionRotation(sent, [...sent].reverse(), 120_000).shouldRotate, false);
  assert.equal(decideSttSessionRotation(sent, [...sent, '고객4'], 59_999).shouldRotate, false);
  assert.equal(decideSttSessionRotation(sent, [...sent, '고객4'], 60_000).reason, 'NICKNAME_SET_CHANGED');
  assert.equal(decideSttSessionRotation(sent, [...sent, '신규1', '신규2', '신규3', '신규4', '신규5'], 30_000).reason, 'MANY_NEW_NICKNAMES');
  assert.equal(
    decideSttSessionRotation(sent, sent, STT_ROTATION_POLICY.PROVIDER_LIMIT_REFRESH_MS).reason,
    'PROVIDER_DURATION_LIMIT',
  );
});

test('saved vocabulary and pending sync state are isolated by workspace', () => {
  const entries = new Map();
  const localStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const vocabulary = loadTypescript('src/services/sttVocabularyService.ts');
  const commentTypes = loadTypescript('src/types/comment.ts');
  const { StorageService } = loadTypescript('src/services/storageService.ts', { localStorage }, {
    '../types/comment': commentTypes,
    './sttVocabularyService': vocabulary,
    './durableStorage': { durableStorage: {} },
  });
  const storage = new StorageService();
  assert.equal(storage.saveSttVocabulary('seller-A', ['코듀로이'], true), true);
  assert.deepEqual(Array.from(storage.getSttVocabulary('seller-A')), ['코듀로이']);
  assert.equal(storage.isSttVocabularyPending('seller-A'), true);
  assert.deepEqual(Array.from(storage.getSttVocabulary('seller-B')), []);
  assert.equal(storage.isSttVocabularyPending('seller-B'), false);
  storage.saveSttVocabulary('seller-A', ['코듀로이'], false);
  assert.equal(storage.isSttVocabularyPending('seller-A'), false);
});

test('workspace cloud vocabulary uses its own namespace and reports failed sync', async () => {
  const stored = new Map();
  let fail = false;
  const client = {
    from(table) {
      assert.equal(table, 'workspace_settings');
      return {
        async upsert(row) {
          if (fail) return { error: { message: 'offline' } };
          stored.set(`${row.workspace_id}:${row.namespace}`, row.value);
          return { error: null };
        },
        select() { return this; },
        eq(column, value) { this[column] = value; return this; },
        async maybeSingle() {
          return { data: { value: stored.get(`${this.workspace_id}:${this.namespace}`) }, error: null };
        },
      };
    },
    functions: { async invoke() { return { data: null, error: { message: 'offline' } }; } },
  };
  const vocabulary = loadTypescript('src/services/sttVocabularyService.ts');
  const { remoteWorkspaceService } = loadTypescript('src/services/remoteWorkspaceService.ts', {
    console: { log() {}, warn() {}, error() {} },
  }, {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => client },
    './commerceChanges': {},
    './sttVocabularyService': vocabulary,
    './voiceSaleValidation': voiceSaleValidation,
  });
  await remoteWorkspaceService.saveSttVocabulary('seller-A', ['코듀로이']);
  assert.equal(JSON.stringify(stored.get('seller-A:stt_vocabulary')), JSON.stringify({ words: ['코듀로이'] }));
  assert.deepEqual(Array.from(await remoteWorkspaceService.loadSttVocabulary('seller-A')), ['코듀로이']);
  assert.equal(await remoteWorkspaceService.loadSttVocabulary('seller-B'), null);
  fail = true;
  await assert.rejects(() => remoteWorkspaceService.saveSttVocabulary('seller-A', ['새 단어']));
});

test('cloud STT WebSocket setup forwards terms to both Deepgram and Soniox without logging them', () => {
  const sockets = [];
  const logged = [];
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = MockWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const { DeepgramSttService } = loadTypescript('src/services/deepgramService.ts', {
    WebSocket: MockWebSocket,
    console: { log: (...args) => logged.push(args.join(' ')), warn() {}, error() {} },
  });
  const keyterms = ['코듀로이', '특별 브랜드', '아주희귀한별칭'];
  const baseConfig = {
    apiKey: 'test-api-key-long-enough', model: 'nova-3', language: 'ko',
    keyterms, punctuate: true, interimResults: true, endpointing: 300,
  };

  const deepgram = new DeepgramSttService();
  deepgram.startLiveStream({ ...baseConfig, provider: 'DEEPGRAM' }, () => {}, () => {});
  const deepgramSocket = sockets.at(-1);
  assert.equal(new URL(deepgramSocket.url).searchParams.getAll('keyterm').join('|'), keyterms.join('|'));
  assert.ok(!logged.join(' ').includes('코듀로이'));
  assert.ok(!logged.join(' ').includes('아주희귀한별칭'));

  const soniox = new DeepgramSttService();
  soniox.startLiveStream({ ...baseConfig, provider: 'SONIOX' }, () => {}, () => {});
  const sonioxSocket = sockets.at(-1);
  sonioxSocket.readyState = MockWebSocket.OPEN;
  sonioxSocket.onopen();
  const setup = JSON.parse(sonioxSocket.sent[0]);
  assert.deepEqual(setup.context.terms, keyterms);
  assert.equal(setup.language_hints[0], 'ko');
});

test('cloud STT rotation prepares the replacement socket and switches only at a quiet finalized boundary', async () => {
  const sockets = [];
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = MockWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const { DeepgramSttService } = loadTypescript('src/services/deepgramService.ts', {
    WebSocket: MockWebSocket,
    ArrayBuffer,
    window: { setTimeout, clearTimeout },
    console: { log() {}, warn() {}, error() {} },
  });
  const config = {
    provider: 'DEEPGRAM', apiKey: 'test-api-key-long-enough', model: 'nova-3', language: 'ko',
    keyterms: ['기존고객'], punctuate: true, interimResults: true, endpointing: 300,
    allowBrowserSpeechFallback: false,
  };
  const service = new DeepgramSttService();
  service.startLiveStream(config, () => {}, () => {});
  const oldSocket = sockets.at(-1);
  oldSocket.readyState = MockWebSocket.OPEN;
  oldSocket.onopen();

  const silentChunk = new ArrayBuffer(4096 * 2);
  for (let index = 0; index < 4; index += 1) service.sendAudioChunk(silentChunk);
  assert.equal(service.isSafeToRotateLiveStream(), true);

  const rotation = service.rotateLiveStream({ ...config, keyterms: ['최신고객'] });
  const nextSocket = sockets.at(-1);
  assert.notEqual(nextSocket, oldSocket);
  assert.equal(oldSocket.readyState, MockWebSocket.OPEN, 'replacement preparation must keep the old socket active');
  nextSocket.readyState = MockWebSocket.OPEN;
  nextSocket.onopen();
  assert.equal(await rotation, true);
  assert.equal(oldSocket.readyState, 3);

  const markerChunk = new ArrayBuffer(128);
  service.sendAudioChunk(markerChunk);
  assert.equal(nextSocket.sent.at(-1), markerChunk);
});

test('cloud STT rotation keeps the current socket when speech resumes during replacement preparation', async () => {
  const sockets = [];
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const { DeepgramSttService } = loadTypescript('src/services/deepgramService.ts', {
    WebSocket: MockWebSocket, ArrayBuffer,
    window: { setTimeout, clearTimeout }, console: { log() {}, warn() {}, error() {} },
  });
  const config = { provider: 'DEEPGRAM', apiKey: 'test-api-key-long-enough', model: 'nova-3', language: 'ko',
    keyterms: ['기존고객'], punctuate: true, interimResults: true, endpointing: 300, allowBrowserSpeechFallback: false };
  const service = new DeepgramSttService();
  service.startLiveStream(config, () => {}, () => {});
  const oldSocket = sockets.at(-1);
  oldSocket.readyState = MockWebSocket.OPEN;
  oldSocket.onopen();
  const silence = new ArrayBuffer(4096 * 2);
  for (let index = 0; index < 4; index += 1) service.sendAudioChunk(silence);

  const rotation = service.rotateLiveStream({ ...config, keyterms: ['최신고객'] });
  const candidate = sockets.at(-1);
  const speech = new Int16Array(4096);
  speech.fill(10_000);
  service.sendAudioChunk(speech.buffer);
  candidate.readyState = MockWebSocket.OPEN;
  candidate.onopen();

  assert.equal(await rotation, false);
  assert.equal(oldSocket.readyState, MockWebSocket.OPEN);
  assert.equal(candidate.readyState, 3);
  const marker = new ArrayBuffer(64);
  service.sendAudioChunk(marker);
  assert.equal(oldSocket.sent.at(-1), marker);
});

test('Soniox rotation waits until the current utterance is finalized', () => {
  const sockets = [];
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const { DeepgramSttService } = loadTypescript('src/services/deepgramService.ts', {
    WebSocket: MockWebSocket, ArrayBuffer,
    window: { setTimeout, clearTimeout }, console: { log() {}, warn() {}, error() {} },
  });
  const service = new DeepgramSttService();
  service.startLiveStream({
    provider: 'SONIOX', apiKey: 'test-api-key-long-enough', model: 'stt-rt-v5', language: 'ko',
    keyterms: ['기존고객'], punctuate: true, interimResults: true, endpointing: 300,
    allowBrowserSpeechFallback: false,
  }, () => {}, () => {});
  const socket = sockets.at(-1);
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();

  const speech = new Int16Array(4096);
  speech.fill(10_000);
  service.sendAudioChunk(speech.buffer);
  const silence = new ArrayBuffer(4096 * 2);
  for (let index = 0; index < 8; index += 1) service.sendAudioChunk(silence);

  assert.equal(service.isSafeToRotateLiveStream(), false);
  assert.ok(socket.sent.some((value) => typeof value === 'string' && JSON.parse(value).type === 'finalize'));

  socket.onmessage({ data: JSON.stringify({
    tokens: [
      { text: '판매 발화', is_final: true, confidence: 0.99 },
      { text: '<fin>', is_final: true, confidence: 0.99 },
    ],
  }) });
  assert.equal(service.isSafeToRotateLiveStream(), true);
});

test('navigation replaces the mock training page and live requests use saved vocabulary', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/common/Sidebar.tsx'), 'utf8');
  const live = fs.readFileSync(path.join(root, 'src/context/LiveContext.tsx'), 'utf8');
  assert.match(app, /path="\/stt-vocabulary" element=\{<SttVocabularyPage \/>\}/);
  assert.match(app, /path="\/voice-training" element=\{<Navigate to="\/stt-vocabulary" replace \/>\}/);
  assert.ok(!sidebar.includes('음성인식 훈련 (학습)'));
  assert.ok(sidebar.includes('음성인식 발음 힌트'));
  assert.ok(!fs.existsSync(path.join(root, 'src/pages/seller/VoiceTrainingPage.tsx')));
  assert.ok(live.includes('storageService.getSessionCommentRecords(newSessionId, transcriptWorkspaceIdRef.current)'));
  assert.ok(live.includes('buildCloudSttTerms(await getWordsForConnection(), recentNicknameTerms, ruleTerms)'));
  assert.ok(live.includes('keyterms: cloudKeyterms'));
});
