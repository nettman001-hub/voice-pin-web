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
  const rules = ['브랜드0', ...Array.from({ length: 70 }, (_, index) => `규칙${index}`)];
  const combined = buildCloudSttTerms(presets, rules);
  assert.equal(combined.length, 100);
  assert.deepEqual(Array.from(combined.slice(0, 50)), presets);
  assert.equal(combined.filter((word) => word === '브랜드0').length, 1);
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

test('navigation replaces the mock training page and live requests use saved vocabulary', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/common/Sidebar.tsx'), 'utf8');
  const live = fs.readFileSync(path.join(root, 'src/context/LiveContext.tsx'), 'utf8');
  assert.match(app, /path="\/stt-vocabulary" element=\{<SttVocabularyPage \/>\}/);
  assert.match(app, /path="\/voice-training" element=\{<Navigate to="\/stt-vocabulary" replace \/>\}/);
  assert.ok(!sidebar.includes('음성인식 훈련 (학습)'));
  assert.ok(sidebar.includes('음성인식 발음 힌트'));
  assert.ok(!fs.existsSync(path.join(root, 'src/pages/seller/VoiceTrainingPage.tsx')));
  assert.ok(live.includes('buildCloudSttTerms(await getWordsForConnection(), ruleTerms)'));
  assert.ok(live.includes('keyterms: cloudKeyterms'));
});
