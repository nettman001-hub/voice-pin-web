import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree == null || typeof tree === 'boolean' ? []
    : [tree, ...(typeof tree === 'object' ? nodes(tree.props?.children) : [])];
const visible = (tree) => nodes(tree).filter((node) => typeof node === 'string' || typeof node === 'number').join('');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const pending = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const sample = `[고객 댓글]
오후 11:50:36 · 😚JJEONG😚: 저용
[판매자 멘트]
오후 11:50:28 · 후드 아이보리 니트 집업 2만 원.
오후 11:50:49 · 정원이 드릴게요.`;

const savedSlots = {
  appliedVersion: 7,
  primarySlot: 1,
  slots: [
    { slotNumber: 1, provider: 'DEEPSEEK', model: 'existing-deepseek-model' },
    { slotNumber: 2, provider: 'OPENAI', model: 'existing-openai-model' },
  ],
};

function fixture(options = {}) {
  const cells = [], effects = [], cleanups = [], calls = [], captures = [];
  const timers = new Map();
  const timerDelays = new Map();
  let index = 0, stateWrites = 0, sequence = 0, slotRequests = 0;
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initial) {
      const key = index++;
      if (!(key in cells)) cells[key] = typeof initial === 'function' ? initial() : initial;
      return [cells[key], (value) => { stateWrites++; cells[key] = typeof value === 'function' ? value(cells[key]) : value; }];
    },
    useRef(initial) { const key = index++; return cells[key] ||= { current: initial }; },
    useEffect(effect) { const key = index++; if (!(key in cells)) { cells[key] = true; effects.push(effect); } },
  };
  const globals = {
    AbortController,
    crypto: { randomUUID: () => `session-${++sequence}` },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, callback); timerDelays.set(id, delay); return id; },
    clearTimeout(id) { timers.delete(id); timerDelays.delete(id); },
  };
  function load(path, imports = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(compiled, {
      module, exports: module.exports, ...globals,
      require(name) { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; },
    }, { filename: path });
    return module.exports;
  }
  const imports = {
    react: { __esModule: true, default: react, ...react },
    'react-router-dom': { Link: 'a' },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    '../../context/LiveContext': { useLive: () => ({ isListening: false, sonioxApiKey: 'test-only' }) },
    '../../context/CommentCaptureContext': { useCommentCapture: () => ({ isActive: false, config: { tiktokUsername: 'seller', serverUrl: 'http://127.0.0.1:12345' } }) },
    '../../services/sellerLogicInput': load('src/services/sellerLogicInput.ts'),
    '../../services/sellerLogicScheduler': load('src/services/sellerLogicScheduler.ts'),
    '../../services/sellerLogicApi': {
      getSellerLogicSlots() {
        slotRequests++;
        return options.loadSlots?.(slotRequests) || options.slotPromise || Promise.resolve(options.savedSlots || savedSlots);
      },
      analyzeSellerLogic(input, analysisOptions) { const work = pending(); calls.push({ input, analysisOptions, ...work }); return work.promise; },
    },
    '../../services/sellerLogicCapture': { SellerLogicCapture: class {
      constructor() { this.stopped = pending(); this.priorities = []; this.stopCalls = 0; captures.push(this); }
      async start(options) { this.options = options; }
      stop() { this.stopCalls++; return this.stopped.promise; }
      prioritizeNicknames(names) { this.priorities.push(names); }
    } },
  };
  const page = load('src/pages/admin/SellerLogicAnalysisPage.tsx', imports).default;
  const ctx = {
    calls, captures, timerDelays,
    get stateWrites() { return stateWrites; },
    get slotRequests() { return slotRequests; },
    fireTimers() {
      const due = [...timers.values()]; timers.clear(); timerDelays.clear();
      due.forEach((callback) => callback());
    },
    render() {
      index = 0;
      const tree = page();
      while (effects.length) { const cleanup = effects.shift()(); if (cleanup) cleanups.push(cleanup); }
      return tree;
    },
    find(label) {
      const node = nodes(this.render()).find((node) => node.props?.['aria-label'] === label);
      assert.ok(node, `Missing field ${label}`); return node;
    },
    button(label) {
      const node = nodes(this.render()).find((node) => node.type === 'button' && visible(node).trim() === label);
      assert.ok(node, `Missing button ${label}`); return node;
    },
    click(label) {
      const node = this.button(label);
      assert.ok(!node.props.disabled, `Disabled button ${label}`);
      return node.props.onClick();
    },
    async import(text = sample) {
      this.render(); await settle();
      this.find('분석할 대화 텍스트').props.onChange({ target: { value: text } });
      this.click('대화 자료 적용');
    },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
  };
  return ctx;
}

function decisionResult(input) {
  return {
    summary: '정원이 호칭과 댓글의 동일 상품 요청을 연결했습니다.', provider: 'TEST_PROVIDER', model: 'test-model',
    purchaseIntentCommentIds: [input.comments[0].id],
    decisions: [{
      id: 'decision-1', status: 'CONFIRMED', nickname: '😚JJEONG😚', spokenNickname: '정원이',
      productName: '후드 아이보리 니트 집업', unitPrice: 20000, quantity: 1,
      reason: '판매자의 제공 확답과 구매 댓글이 연결됨', commentIds: [input.comments[0].id],
      transcriptIds: input.transcripts.map((row) => row.id), decidedAt: input.transcripts.at(-1).recognizedAt,
    }],
  };
}

function completeResult(input, extra = {}) {
  return {
    decisions: [], purchaseIntentCommentIds: [], summary: '', provider: 'TEST', model: 'test', hasMore: false,
    analysisState: { processedCommentIds: input.comments.map((row) => row.id), processedTranscriptIds: input.transcripts.map((row) => row.id),
      memory: [], purchaseIntentCommentIds: [], slotNumber: input.slotNumber, appliedVersion: 7 },
    pipeline: { slotNumber: input.slotNumber, seenRevisions: {}, carry: [], signals: [], observedThrough: 0,
      stats: { detectCalls: 1, linkCalls: 1, detectMs: 12, linkMs: 34 } },
    ...extra,
  };
}

const captureSpeech = (id, text, extra = {}) => ({ id, text, recognizedAt: '2026-10-05T15:00:00Z', isFinal: true, ...extra });

function signal(id, input, extra = {}) {
  return { id, summary: `${id} 판매 발화`, commentIds: input.comments.map((row) => row.id), transcriptIds: input.transcripts.map((row) => row.id),
    startedAt: '2026-10-05T15:00:00Z', endedAt: '2026-10-05T15:00:00Z', observedUntil: '2026-10-05T15:01:00Z',
    status: 'WATCHING', decisionIds: [], needsAnalysis: false, observationClosed: false, ...extra };
}

test('the always-visible comment panel receives comments immediately before and during AI analysis', async () => {
  const f = fixture();
  const emptyPanel = f.find('실시간 댓글');
  assert.ok(visible(emptyPanel).includes('아직 수집된 댓글이 없습니다.'));
  assert.ok(visible(emptyPanel).includes('누적 0개'));
  assert.equal(f.calls.length, 0);
  await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  const first = { id: 'live-first', sessionId: capture.options.sessionId, nickname: '😚JJEONG😚',
    content: '아이보리 저용\n한 개 부탁해요', capturedAt: '2026-10-05T03:04:05Z' };
  capture.options.comment(first);
  const beforeAnalysis = f.find('실시간 댓글');
  assert.ok(visible(beforeAnalysis).includes(first.nickname));
  assert.ok(visible(beforeAnalysis).includes(first.content));
  const commentTime = nodes(beforeAnalysis).find((node) => node.type === 'time');
  assert.match(visible(commentTime), /12(?::|시\s)0?4(?::|분\s)0?5/u, 'comment time is displayed in Korea time across supported locale formats');
  assert.equal(commentTime.props.dateTime, first.capturedAt);
  assert.equal(f.calls.length, 0, 'comment rendering must not wait for an AI request or timer');

  f.click('지금 AI 분석');
  assert.equal(f.calls.length, 1);
  capture.options.comment({ ...first, id: 'live-second', nickname: '루비', content: '검정도 있나요?' });
  capture.options.transcript(captureSpeech('seller-live', '검정 재고 확인해 드릴게요.'));
  const duringAnalysis = f.find('실시간 댓글');
  assert.ok(visible(duringAnalysis).includes('검정도 있나요?'));
  assert.ok(visible(duringAnalysis).includes('누적 2개'));
  assert.equal(nodes(duringAnalysis).filter((node) => node.type === 'li').length, 2);
  assert.ok(!visible(duringAnalysis).includes('검정 재고 확인해 드릴게요.'));
  assert.ok(visible(f.render()).includes('검정 재고 확인해 드릴게요.'), 'the existing seller speech timeline remains visible');
  assert.equal(f.calls.length, 1, 'new comments do not start concurrent AI analysis');
  f.unmount(); capture.stopped.resolve(); f.calls[0].resolve(completeResult(f.calls[0].input)); await settle();
});

test('the comment panel bounds visible rows while preserving the full archive and duplicate suppression', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  const comments = Array.from({ length: 205 }, (_, index) => ({ id: `comment-${index}`,
    sessionId: capture.options.sessionId, platformMessageId: `platform-${index}`, nickname: `구매자-${index}`,
    content: `수집 댓글 ${index}`, capturedAt: new Date(Date.parse('2026-10-05T03:04:05Z') + index * 1000).toISOString() }));
  comments.forEach(capture.options.comment);
  capture.options.comment(comments[204]);
  capture.options.comment({ ...comments[204], id: 'duplicate-platform-message' });
  const panel = f.find('실시간 댓글');
  const rows = nodes(panel).filter((node) => node.type === 'li');
  assert.equal(rows.length, 200);
  assert.ok(visible(rows[0]).includes('구매자-204'), 'latest received comment is first');
  assert.ok(visible(rows.at(-1)).includes('구매자-5'));
  assert.ok(!rows.some((row) => visible(row).includes('수집 댓글 0')));
  assert.ok(visible(panel).includes('누적 205개'));
  assert.ok(visible(panel).includes('최근 200개 표시'));
  assert.ok(visible(panel).includes('전체 댓글은 분석과 내려받기에 포함됩니다.'));
  f.click('지금 AI 분석');
  assert.equal(f.calls[0].input.comments.length, 205);
  assert.equal(f.calls[0].input.comments[0].content, comments[0].content);
  assert.equal(f.calls[0].input.comments.at(-1).content, comments.at(-1).content);
  f.unmount(); capture.stopped.resolve(); f.calls[0].resolve(completeResult(f.calls[0].input)); await settle();
});

test('imported comments are visible without AI and a new session clears the comment panel', async () => {
  const f = fixture(); await f.import();
  const panel = f.find('실시간 댓글');
  assert.ok(visible(panel).includes('😚JJEONG😚'));
  assert.ok(visible(panel).includes('저용'));
  assert.ok(visible(panel).includes('누적 1개'));
  assert.equal(f.calls.length, 0);
  f.click('새 분석');
  assert.ok(visible(f.find('실시간 댓글')).includes('누적 0개'));
  assert.ok(!visible(f.find('실시간 댓글')).includes('😚JJEONG😚'));
  f.unmount();
});

test('analysis interval defaults to five seconds and changes waiting work without interrupting analysis', async () => {
  const f = fixture(); await f.import();
  const interval = f.find('자동 분석 주기');
  assert.equal(interval.props.value, 5);
  assert.deepEqual(nodes(interval).filter((node) => node.type === 'option').map((node) => node.props.value), [5, 10, 15, 30]);
  const enableAutomatic = () => nodes(f.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  enableAutomatic();
  assert.deepEqual([...f.timerDelays.values()], [5000]);
  interval.props.onChange({ target: { value: '10' } });
  assert.deepEqual([...f.timerDelays.values()], [10000]);
  f.fireTimers();
  assert.equal(f.calls.length, 1);
  assert.ok(!f.find('자동 분석 주기').props.disabled);
  f.find('자동 분석 주기').props.onChange({ target: { value: '30' } });
  assert.equal(f.calls[0].analysisOptions.signal.aborted, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timerDelays.size, 0);
  f.calls[0].resolve(decisionResult(f.calls[0].input)); await settle();
  enableAutomatic(); f.fireTimers();
  assert.equal(f.calls.length, 1, 'changing the interval does not submit unchanged evidence');
  f.click('새 분석');
  await f.import(); enableAutomatic();
  assert.equal(f.find('자동 분석 주기').props.value, 30);
  assert.deepEqual([...f.timerDelays.values()], [30000], 'a new analysis retains the chosen interval');
  f.unmount();
});

test('capture keeps the entire archive beyond the former row and character limits', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  const longContent = '원문'.repeat(226000);
  for (let i = 0; i < 2001; i++) {
    capture.options.comment({ id: `comment-${i}`, sessionId: capture.options.sessionId, nickname: '루비',
      content: i === 2000 ? longContent : `댓글 ${i}`, capturedAt: '2026-10-05T15:00:00Z' });
    capture.options.transcript({ id: `speech-${i}`, text: `판매자 원문 ${i}`, recognizedAt: '2026-10-05T15:00:00Z', isFinal: true });
  }
  assert.equal(capture.stopCalls, 0);
  assert.ok(!f.button('청취 종료').props.disabled);
  assert.ok(!visible(f.render()).includes('한도에 도달'));
  f.click('지금 AI 분석');
  const input = f.calls[0].input;
  assert.equal(input.comments.length, 2001);
  assert.equal(input.transcripts.length, 2001);
  assert.equal(input.comments[0].id, 'comment-0');
  assert.equal(input.comments.at(-1).content, longContent);
  assert.equal(input.transcripts.at(-1).id, 'speech-2000');
  f.unmount(); capture.stopped.resolve();
  f.calls[0].resolve({ decisions: [], purchaseIntentCommentIds: [], summary: '', provider: 'TEST', model: 'test' });
  await settle();
});

test('large pasted archives are applied without silently truncating the original text', async () => {
  const f = fixture();
  const longContent = '보관할 원문 '.repeat(60000);
  await f.import(`[고객 댓글]\n오후 11:50:36 · 루비: ${longContent}`);
  assert.equal(f.find('분석할 대화 텍스트').props.maxLength, undefined);
  f.click('지금 AI 분석');
  assert.equal(f.calls[0].input.comments[0].content, longContent.trim());
  f.unmount();
  f.calls[0].resolve({ decisions: [], purchaseIntentCommentIds: [], summary: '', provider: 'TEST', model: 'test' });
  await settle();
});

test('the existing saved slot models are shown and the applied primary slot is selected by default', async () => {
  const f = fixture({ savedSlots: { ...savedSlots, primarySlot: 2 } });
  await f.import();
  const selector = f.find('분석 AI 슬롯');
  assert.equal(f.slotRequests, 1);
  assert.equal(selector.props.value, 2);
  const optionLabels = nodes(selector).filter((node) => node.type === 'option').map(visible);
  assert.ok(optionLabels.some((label) => label.includes('1') && label.includes('DEEPSEEK') && label.includes('existing-deepseek-model')));
  assert.ok(optionLabels.some((label) => label.includes('2') && label.includes('OPENAI') && label.includes('existing-openai-model')));
  assert.ok(!optionLabels.some((label) => label.includes('qwen2.5:7b')), 'local defaults must not masquerade as saved settings');
  f.click('지금 AI 분석');
  assert.equal(f.calls[0].input.slotNumber, 2);
  assert.equal(f.calls[0].input.slotConfig, undefined, 'the server resolves saved model and credentials');
  f.calls[0].resolve(decisionResult(f.calls[0].input)); await settle();
  f.find('분석 AI 슬롯').props.onChange({ target: { value: '1' } });
  f.click('지금 AI 분석');
  assert.equal(f.calls[1].input.slotNumber, 1);
  f.calls[1].resolve(decisionResult(f.calls[1].input)); await settle();
  f.unmount();
});

for (const outcome of ['resolve', 'reject']) {
  test(`unmount suppresses a late saved-slot metadata ${outcome}`, async () => {
    const slots = pending();
    const f = fixture({ slotPromise: slots.promise });
    f.render();
    f.unmount(); const before = f.stateWrites;
    slots[outcome](outcome === 'resolve' ? savedSlots : new Error('late metadata failure')); await settle();
    assert.equal(f.stateWrites, before);
  });
}

test('failed slot metadata blocks requests and retries using the existing server settings', async () => {
  const first = pending();
  const f = fixture({ loadSlots: (request) => request === 1 ? first.promise : Promise.resolve(savedSlots) });
  await f.import();
  assert.equal(f.find('분석 AI 슬롯').props.disabled, true);
  assert.equal(f.button('지금 AI 분석').props.disabled, true);
  first.reject(new Error('metadata unavailable')); await settle();
  assert.equal(f.calls.length, 0);
  assert.equal(f.find('분석 AI 슬롯').props.disabled, true);
  assert.equal(f.button('지금 AI 분석').props.disabled, true);
  f.click('슬롯 다시 불러오기'); await settle();
  assert.equal(f.slotRequests, 2);
  assert.equal(f.find('분석 AI 슬롯').props.disabled, false);
  assert.equal(f.button('지금 AI 분석').props.disabled, false);
  assert.ok(visible(f.render()).includes('existing-deepseek-model'));
  f.click('지금 AI 분석');
  assert.equal(f.calls[0].input.slotNumber, 1);
  f.calls[0].resolve(decisionResult(f.calls[0].input)); await settle();
  f.unmount();
});

test('automatic analysis uses the applied primary slot even when evidence loads before slot metadata', async () => {
  const slots = pending();
  const f = fixture({ slotPromise: slots.promise });
  await f.import();
  slots.resolve({ ...savedSlots, primarySlot: 2 }); await settle();
  assert.equal(f.find('분석 AI 슬롯').props.value, 2);
  const automatic = nodes(f.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.ok(automatic);
  automatic.props.onChange({ target: { checked: true } });
  f.fireTimers();
  assert.equal(f.calls[0].input.slotNumber, 2);
  f.calls[0].resolve(decisionResult(f.calls[0].input)); await settle();
  f.unmount();
});

test('the selected AI slot receives unchanged evidence and renders its buyer, price and citations', async () => {
  const f = fixture(); await f.import();
  f.find('분석 AI 슬롯').props.onChange({ target: { value: '2' } });
  f.click('지금 AI 분석');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].input.slotNumber, 2);
  assert.equal(f.calls[0].input.comments[0].nickname, '😚JJEONG😚');
  assert.equal(f.calls[0].input.comments[0].content, '저용');
  assert.equal(f.calls[0].input.previousDecisions.length, 0);
  assert.equal(f.calls[0].analysisOptions.live, false, 'imported text uses the complete archive timeline');
  assert.equal(f.find('분석 AI 슬롯').props.disabled, true);
  f.calls[0].resolve(decisionResult(f.calls[0].input)); await settle();
  const text = visible(f.render());
  for (const expected of ['슬롯 2', 'TEST_PROVIDER', 'test-model', '😚JJEONG😚', '20,000원', 'STT 호칭: 정원이', '근거 대화 3개', '정원이 드릴게요.', '판매 장부에는 자동 등록되지 않습니다']) {
    assert.ok(text.includes(expected), expected);
  }
  f.unmount();
});

test('a failed analysis preserves prior results and evidence for retry on the selected slot', async () => {
  const f = fixture(); await f.import(); f.click('지금 AI 분석');
  const previous = decisionResult(f.calls[0].input);
  f.calls[0].resolve(previous); await settle();
  f.find('분석 AI 슬롯').props.onChange({ target: { value: '2' } });
  f.click('지금 AI 분석');
  assert.equal(f.calls[1].input.previousDecisions[0].id, 'decision-1');
  f.calls[1].reject(new Error('선택한 슬롯 연결 실패')); await settle();
  const text = visible(f.render());
  assert.ok(text.includes('선택한 슬롯 연결 실패'));
  assert.ok(text.includes('자료는 유지됩니다'));
  assert.ok(text.includes('20,000원'));
  assert.ok(text.includes('댓글 1개 · 판매자 멘트 2개'));
  f.click('지금 AI 분석');
  assert.equal(f.calls[2].input.slotNumber, 2);
  assert.equal(f.calls[2].input.comments[0].id, f.calls[0].input.comments[0].id);
  assert.equal(f.calls[2].input.previousDecisions[0].id, 'decision-1');
  f.calls[2].resolve(previous); await settle();
  f.unmount();
});

for (const outcome of ['resolve', 'reject']) {
  test(`unmount prevents late ${outcome} from writing page state`, async () => {
    const f = fixture(); await f.import(); f.click('지금 AI 분석');
    f.unmount(); const before = f.stateWrites;
    f.calls[0][outcome](outcome === 'resolve' ? decisionResult(f.calls[0].input) : new Error('late failure'));
    await settle();
    assert.equal(f.stateWrites, before);
  });
}

test('stopping capture retains final transcripts until the capture service finishes draining', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  f.click('청취 종료');
  assert.equal(f.button('새 분석').props.disabled, true);
  capture.options.transcript({ id: 'last-speech', text: '마지막 판매 확답', recognizedAt: '2026-10-05T15:00:00Z', isFinal: true });
  assert.ok(visible(f.render()).includes('마지막 판매 확답'));
  capture.stopped.resolve(); await settle();
  assert.equal(f.button('새 분석').props.disabled, true, 'the final archive analysis is now running');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].analysisOptions.live, false);
  assert.equal(f.calls[0].input.transcripts.at(-1).text, '마지막 판매 확답');
  f.calls[0].resolve({ decisions: [], purchaseIntentCommentIds: [], summary: '', provider: 'TEST', model: 'test' });
  await settle();
  assert.equal(f.button('새 분석').props.disabled, false);
  f.unmount();
});

test('cumulative AI intent IDs prioritize only newly classified comments and reset for a new analysis', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const firstCapture = f.captures[0];
  const addComment = (capture, id, nickname) => capture.options.comment({
    id, sessionId: capture.options.sessionId, nickname, content: '저요',
    capturedAt: '2026-10-05T15:00:00Z',
  });
  const finishAnalysis = async (ids) => {
    f.click('지금 AI 분석');
    f.calls.at(-1).resolve({
      decisions: [], purchaseIntentCommentIds: ids, summary: '', provider: 'TEST', model: 'test',
    });
    await settle();
  };
  addComment(firstCapture, 'intent-old', '루비');
  await finishAnalysis(['intent-old']);
  assert.equal(firstCapture.priorities.flat().join(','), '루비');

  await finishAnalysis(['intent-old']);
  assert.equal(firstCapture.priorities.flat().join(','), '루비', 'the cumulative result must not prioritize the historical intent again');

  addComment(firstCapture, 'intent-new', '지성이👻');
  await finishAnalysis(['intent-old', 'intent-new']);
  assert.equal(firstCapture.priorities.flat().join(','), '루비,지성이👻');

  f.click('청취 종료'); firstCapture.stopped.resolve(); await settle();
  f.calls.at(-1).resolve(completeResult(f.calls.at(-1).input)); await settle();
  f.click('새 분석');
  f.click('실시간 청취 시작'); await settle();
  const secondCapture = f.captures[1];
  addComment(secondCapture, 'intent-old', '루비');
  await finishAnalysis(['intent-old']);
  assert.equal(secondCapture.priorities.flat().join(','), '루비', 'a fresh analysis clears the prior intent ID history');
  f.unmount(); secondCapture.stopped.resolve(); await settle();
});

test('completed batches remain visible and retry resumes their state after a later batch fails', async () => {
  const f = fixture(); await f.import(); f.click('지금 AI 분석');
  const call = f.calls[0];
  const partial = { ...decisionResult(call.input), hasMore: true, analysisState: {
    processedCommentIds: [call.input.comments[0].id], processedTranscriptIds: [], memory: [],
    purchaseIntentCommentIds: [call.input.comments[0].id], slotNumber: 1, appliedVersion: 7,
  }, pipeline: completeResult(call.input).pipeline };
  call.analysisOptions.onProgress(partial);
  assert.ok(visible(f.render()).includes('1 / 3개 완료'));
  assert.ok(visible(f.render()).includes('20,000원'));
  call.reject(new Error('다음 구간 오류')); await settle();
  assert.ok(visible(f.render()).includes('20,000원'));
  f.click('지금 AI 분석');
  assert.equal(f.calls[1].input.analysisState, partial.analysisState);
  assert.equal(f.calls[1].input.pipeline, partial.pipeline);
  assert.equal(f.calls[1].input.previousDecisions[0].id, 'decision-1');
  f.calls[1].resolve({ ...partial, hasMore: false }); await settle();
  f.unmount();
});

test('stopping an analysis aborts further batches and suppresses late partial progress', async () => {
  const f = fixture(); await f.import(); f.click('지금 AI 분석');
  const call = f.calls[0];
  f.click('분석 중지');
  assert.equal(call.analysisOptions.signal.aborted, true);
  const before = f.stateWrites;
  call.analysisOptions.onProgress(decisionResult(call.input));
  assert.equal(f.stateWrites, before);
  call.reject({ name: 'AbortError' }); await settle();
  assert.ok(visible(f.render()).includes('AI 분석 중지'));
  assert.ok(!visible(f.render()).includes('20,000원'));
  f.unmount();
});

test('manual reanalysis of a completed archive restarts the cursor while retaining prior transactions', async () => {
  const f = fixture(); await f.import(); f.click('지금 AI 분석');
  const call = f.calls[0];
  const complete = { ...decisionResult(call.input), pipeline: completeResult(call.input).pipeline, hasMore: false, analysisState: {
    processedCommentIds: call.input.comments.map((row) => row.id), processedTranscriptIds: call.input.transcripts.map((row) => row.id), memory: [],
    purchaseIntentCommentIds: [call.input.comments[0].id], slotNumber: 1, appliedVersion: 7,
  } };
  call.resolve(complete); await settle();
  f.click('지금 AI 분석');
  assert.equal(f.calls[1].input.analysisState, undefined);
  assert.equal(f.calls[1].input.pipeline, undefined);
  assert.equal(f.calls[1].input.previousDecisions[0].id, 'decision-1');
  f.calls[1].resolve(complete); await settle(); f.unmount();
});

test('partial purchase-intent results update Soniox hints before the archive finishes', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  capture.options.comment({ id: 'buyer-early', sessionId: capture.options.sessionId, nickname: '루비', content: '저요', capturedAt: '2026-10-05T15:00:00Z' });
  f.click('지금 AI 분석');
  const call = f.calls[0];
  const partial = { decisions: [], purchaseIntentCommentIds: ['buyer-early'], summary: '', provider: 'TEST', model: 'test', hasMore: true,
    analysisState: { processedCommentIds: ['buyer-early'], processedTranscriptIds: [], memory: [], purchaseIntentCommentIds: ['buyer-early'], slotNumber: 1, appliedVersion: 7 } };
  call.analysisOptions.onProgress(partial);
  assert.equal(capture.priorities.flat().join(','), '루비');
  call.resolve({ ...partial, hasMore: false }); await settle();
  assert.equal(capture.priorities.flat().join(','), '루비', 'completion must not repeat the early hint');
  f.unmount(); capture.stopped.resolve(); await settle();
});

test('live heartbeat reuses the completed pipeline so silent observation windows can close without replaying history', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  f.fireTimers();
  assert.equal(f.calls.length, 0, 'a heartbeat without any source does not start analysis');
  capture.options.transcript(captureSpeech('offer', '루비 언니 이만원 드릴게요'));
  f.fireTimers();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].analysisOptions.live, true);
  const complete = completeResult(f.calls[0].input);
  complete.pipeline.signals = [signal('observing', f.calls[0].input)];
  f.calls[0].resolve(complete); await settle();
  assert.ok(visible(f.render()).includes('후속 대화를 관찰합니다'));

  f.fireTimers();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].input.pipeline, complete.pipeline);
  assert.equal(f.calls[1].input.analysisState, complete.analysisState);
  assert.equal(f.calls[1].input.transcripts.length, 1);
  assert.equal(f.calls[1].analysisOptions.live, true);
  f.calls[1].resolve(complete); await settle();

  nodes(f.render()).find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  f.fireTimers();
  assert.equal(f.calls.length, 2, 'pausing automatic analysis also pauses heartbeat execution');
  f.unmount();
  assert.equal(f.timerDelays.size, 0, 'page cleanup cancels the observation clock');
  capture.stopped.resolve(); await settle();
});

test('same-id STT revisions replace evidence and finalization waits for an active live request', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  capture.options.transcript(captureSpeech('offer', '루비 언니 이만원', { isFinal: false, revision: 1 }));
  f.click('지금 AI 분석');
  const first = f.calls[0];
  assert.equal(first.analysisOptions.live, true);
  f.click('청취 종료');
  const finalSpeech = captureSpeech('offer', '루비 언니 이만원 드릴게요', { revision: 2, endedAt: '2026-10-05T15:00:02Z' });
  capture.options.transcript(finalSpeech);
  capture.options.transcript(finalSpeech);
  capture.stopped.resolve(); await settle();
  assert.equal(f.calls.length, 1, 'the archive finalization must not overlap the live request');
  const partial = completeResult(first.input);
  partial.pipeline.signals = [signal('observing', first.input)];
  first.resolve(partial); await settle();

  assert.equal(f.calls.length, 2, 'draining requests exactly one final analysis');
  const final = f.calls[1];
  assert.equal(final.analysisOptions.live, false);
  assert.equal(final.input.pipeline, partial.pipeline);
  assert.equal(final.input.transcripts.length, 1, 'revisions must not create duplicate utterances');
  assert.equal(final.input.transcripts[0].text, finalSpeech.text);
  assert.equal(final.input.transcripts[0].revision, 2);
  assert.equal(final.input.transcripts[0].isFinal, true);
  capture.options.transcript(captureSpeech('late-after-drain', '종료 뒤 늦은 콜백'));
  assert.ok(!visible(f.render()).includes('종료 뒤 늦은 콜백'));
  final.resolve(completeResult(final.input)); await settle();
  f.fireTimers();
  assert.equal(f.calls.length, 2, 'no heartbeat remains after capture ends');
  f.unmount();
});

test('unlinked and watching signals expose original evidence separately from linked sales', async () => {
  const f = fixture(); await f.import(); f.find('분석 AI 슬롯').props.onChange({ target: { value: '2' } }); f.click('지금 AI 분석');
  const call = f.calls[0];
  const complete = completeResult(call.input, decisionResult(call.input));
  complete.pipeline.signals = [
    signal('watching', call.input, { summary: '후속 대화를 확인하는 발화' }),
    signal('unmatched', call.input, { status: 'UNMATCHED', summary: '연결할 구매자를 찾지 못한 발화', observationClosed: true }),
    signal('linked', call.input, { status: 'LINKED', summary: '이미 연결된 발화', decisionIds: ['decision-1'] }),
    signal('dismissed', call.input, { status: 'DISMISSED', summary: '판매와 무관한 발화' }),
  ];
  call.resolve(complete); await settle();
  const panel = f.find('미연결 및 확인 중인 발화');
  const text = visible(panel);
  for (const expected of ['2건', '연결 확인 중', '미연결', '후속 대화 관찰 중', '관찰 마감', '😚JJEONG😚', '저용', '정원이 드릴게요.', '발화 근거 3개']) assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes('이미 연결된 발화'));
  assert.ok(!text.includes('판매와 무관한 발화'));
  assert.ok(visible(f.render()).includes('판매 적재함'));
  assert.ok(visible(f.render()).includes('20,000원'), 'confirmed sales appear while other signals are still observing');
  assert.ok(visible(f.render()).includes('두 단계 모두 선택한 슬롯 2 사용'));

  f.find('분석 AI 슬롯').props.onChange({ target: { value: '1' } }); f.click('지금 AI 분석');
  assert.equal(f.calls[1].input.pipeline, undefined, 'a different model starts with a new detection state');
  f.calls[1].reject(new Error('다음 분석 오류')); await settle();
  assert.ok(visible(f.find('미연결 및 확인 중인 발화')).includes('연결할 구매자를 찾지 못한 발화'), 'failed analysis retains earlier signals');
  f.unmount();
});

test('an aborted request cannot publish a late successful final result', async () => {
  const f = fixture(); await f.import(); f.click('지금 AI 분석');
  const call = f.calls[0];
  f.click('분석 중지');
  call.resolve(completeResult(call.input, decisionResult(call.input))); await settle();
  assert.ok(!visible(f.render()).includes('20,000원'));
  assert.ok(!visible(f.render()).includes('TEST_PROVIDER'));
  f.unmount();
});

test('automatic capture failure drains final STT, closes live mode and finalizes once without a lingering heartbeat', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  capture.options.transcript(captureSpeech('before-error', '연결 오류 전 발화'));
  capture.options.status('청취 중지: 탭 오디오 공유가 종료되었습니다.');
  assert.equal(capture.stopCalls, 1, 'the page awaits the capture service drain already initiated by its failure handler');
  assert.equal(f.button('새 분석').props.disabled, true, 'the session cannot reset before the final transcription arrives');
  assert.equal(f.button('연결 처리 중…').props.disabled, true);
  capture.options.transcript(captureSpeech('draining-tail', '오류 종료 중 마지막 확답'));
  assert.ok(visible(f.render()).includes('오류 종료 중 마지막 확답'));
  assert.equal(f.calls.length, 0);

  capture.stopped.resolve(); await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].analysisOptions.live, false);
  assert.deepEqual(Array.from(f.calls[0].input.transcripts, (row) => row.id), ['before-error', 'draining-tail']);
  const complete = completeResult(f.calls[0].input);
  f.calls[0].resolve(complete); await settle();
  f.fireTimers();
  assert.equal(f.calls.length, 1);
  assert.equal(f.timerDelays.size, 0, 'automatic capture failure also cancels the observation clock');
  assert.ok(visible(f.render()).includes('탭 오디오 공유가 종료되었습니다'), 'a successful final analysis must not hide the capture failure');

  f.click('지금 AI 분석');
  assert.equal(f.calls[1].analysisOptions.live, false);
  assert.equal(f.calls[1].input.pipeline, undefined, 'completed manual reanalysis now follows the archival restart path');
  f.calls[1].resolve(complete); await settle();
  f.click('새 분석'); f.click('실시간 청취 시작'); await settle();
  const nextCapture = f.captures[1];
  const before = f.stateWrites;
  capture.options.status('청취 중지: 이전 회차의 늦은 오류');
  capture.options.transcript(captureSpeech('obsolete', '이전 회차의 늦은 전사'));
  assert.equal(f.stateWrites, before);
  assert.equal(nextCapture.stopCalls, 0);
  assert.ok(!visible(f.render()).includes('탭 오디오 공유가 종료되었습니다'), 'a new session clears the previous capture failure');
  f.unmount(); nextCapture.stopped.resolve(); await settle();
});

test('unmount during automatic failure draining blocks late transcripts, AI progress and finalization', async () => {
  const f = fixture(); f.render(); await settle(); f.click('실시간 청취 시작'); await settle();
  const capture = f.captures[0];
  capture.options.transcript(captureSpeech('before-error', '기존 발화'));
  f.click('지금 AI 분석');
  const call = f.calls[0];
  capture.options.status('청취 중지: Soniox 연결 오류');
  f.unmount();
  const before = f.stateWrites;
  capture.options.transcript(captureSpeech('too-late', '페이지 종료 뒤 전사'));
  capture.options.status('청취 중지: 페이지 종료 뒤 상태');
  call.analysisOptions.onProgress(completeResult(call.input));
  capture.stopped.resolve(); call.resolve(completeResult(call.input)); await settle();
  assert.equal(f.stateWrites, before);
  assert.equal(f.calls.length, 1, 'the disposed page cannot enqueue a finalization');
  assert.equal(f.timerDelays.size, 0);
  assert.equal(call.analysisOptions.signal.aborted, true);
});
