import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as corrections from '../src/services/voiceCorrectionService.ts';
import { extractSaleFromTranscript, parseKoreanAmount } from '../src/services/salesExtractor.ts';
import { parseVoiceCommand } from '../src/services/voiceCommandParser.ts';
import { splitTranscriptClauses, isQuestionUtterance } from '../src/services/voiceUtteranceService.ts';
import {replaySalesWorkflow,DEFAULT_WORKFLOW_PROFILE} from '../src/services/salesWorkflowEngine.ts';

// Execute the real live callbacks with controlled storage/audio/cloud boundaries.
const source = fs.readFileSync(new URL('../src/context/LiveContext.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('LiveContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['handleTranscript', 'handleSonioxTranscript', 'scanSonioxCommands',
  'consumeSonioxConfirmedText', 'scheduleSonioxSaleTimeout'];
const functions = new Map(), constants = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.set(node.name.text, node.getText(file));
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(file).startsWith('SONIOX_'))) {
    constants.push(node.getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(functions.size, names.length);
const compiled = ts.transpileModule(`${constants.join('\n')}\n${[...functions.values()].join('\n')}
  module.exports = { handleTranscript };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const sale = (id = 'sale-1', extra = {}) => ({ id, sessionId: 'broadcast', productCode: '12',
  buyerNickname: '햇살', amount: 9000, unitPrice: 9000, quantity: 1,
  status: '확정', revision: 1, history: [], recognizedAt: new Date().toISOString(), ...extra });
const pending = (candidateSaleIds = ['sale-1']) => ({
  id: 'pending-correction', workspaceId: 'workspace', sessionId: 'broadcast', status: 'PENDING',
  targetSaleId: null, candidateSaleIds,
  parsedCorrection: corrections.parseVoiceCorrection('햇살님 금액 1.2로 정정합니다'),
});

function fixture({ sales = [], rules = [], pendingCorrection = null, failProductProcessing = false, workflow=null, comments=[] } = {}) {
  const state = { sales, rules, logs: [], events: [], beeps: [], saves: [], captures: [], cloud: [], captions: [], productCalls: [] };
  const timers = new Map();
  let nextTimerId = 1;
  const globals = {
    ...corrections, extractSaleFromTranscript, parseKoreanAmount, parseVoiceCommand, splitTranscriptClauses,
    crypto: { randomUUID }, console,
    appliedWorkflowRef: {current:workflow},replaySalesWorkflow,
    workflowQueueRef:{current:Promise.resolve()},workflowReplayRef:{current:null},workflowObservationAtRef:{current:0},
    workflowFingerprintsRef:{current:new Map()},workflowDecisionsRef:{current:new Set()},
    currentWorkflowSalesRef:{current:sales},transcriptWorkspaceIdRef:{current:'workspace'},
    syncSessionTranscriptsToCloud:async()=>true,sellerAnalysisApi:{observe:async()=>state.cloud.push('observe')},
    addSale:data=>{const row={...data,id:'s-'+randomUUID()};sales.push(row);return row;},
    isAuthenticatedRef: { current: true }, currentUserIdRef: { current: 'seller' },
    listeningGenerationRef: { current: 1 }, authBoundaryGenerationRef:{current:1},setWorkflowProcessingError:message=>{state.workflowError=message;},isListeningRef: { current: true }, activeListeningUserIdRef: { current: 'seller' },
    currentSessionIdRef: { current: 'broadcast' }, productSalesRef: { current: { activeSession: { id: 'broadcast' }, feed: { comments: [] } } },
    sales, isRemoteAuth: true, workspaceId: 'workspace',
    storageService: { getRules: () => rules,getCommentRecords:()=>comments },
    interimStreamChunkerRef: { current: { reset() {}, finalize: (text) => [{ text }],
      processInterim: (text) => ({ newFlowItems: [], displayInterimText: text }) } },
    setCurrentInterimTranscript() {}, setLiveTranscriptFlow: (update) => { state.captions = update(state.captions); },
    handleVoiceProductTranscript: (text) => {
      if (failProductProcessing) throw new Error('simulated business processor failure');
      state.productCalls.push(text); return null;
    },
    isVoiceEditingRef: { current: false }, setIsVoiceEditing() {}, setEditingFieldInfo() {}, resetVoiceEditTimeout() {}, editTimeoutRef: { current: null },
    activePendingCorrectionRef: { current: pendingCorrection }, lastSavedSaleRef: { current: sales[0] || null },
    recentFinalFragmentRef: { current: null }, pendingVoiceFollowupRef: { current: new Map() }, setPendingAiTick() {},
    playBeep: (...args) => state.beeps.push(args),
    updateSale: (updated) => { const index = sales.findIndex((entry) => entry.id === updated.id); sales[index] = updated; },
    persistVoiceSale: (...args) => state.saves.push(args), screenCaptureService: { getActiveStream: () => null },
    captureCurrentScreen: (...args) => state.captures.push(args),
    aiSettingsApi: { applyVoiceCorrection: (...args) => state.cloud.push(args), rollbackVoiceCorrection: (...args) => state.cloud.push(args) },
    setLastMatchedRuleItem: (entry) => state.events.push(entry),
    sessionTranscriptsRef: { current: new Map() }, allSessionTranscriptsRef: { current: [] }, setTotalSessionTranscriptCount() {},
    setTranscriptLogs: (update) => { state.logs = update(state.logs); }, scheduleTranscriptPersistence() {},
    sonioxSaleBufferRef: { current: '' }, sonioxCommandTailRef: { current: '' }, sonioxSaleTimeoutRef: { current: null },
    clearSonioxSaleTimeout() {
      timers.delete(globals.sonioxSaleTimeoutRef.current);
      globals.sonioxSaleTimeoutRef.current = null;
    },
    window: {
      setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, ...globals });
  return { state, globals, flushWorkflow:()=>globals.workflowQueueRef.current, flushTimers() {
    const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback());
  }, send: (text, extra = {}, options = {}) => module.exports.handleTranscript(
    { text, isFinal: true, confidence: 0.99, ...extra }, 1, 'seller', options) };
}

test('active workflow replaces the legacy extractor and allocates numeric orders through real live callbacks',async()=>{
  const now=new Date().toISOString();
  const ctx=fixture({workflow:{id:'profile',version:1,mode:'ACTIVE',profile:DEFAULT_WORKFLOW_PROFILE},
    comments:[{id:'c',platformMessageId:'c',platformUserId:'buyer',sessionId:'broadcast',nickname:'햇살',content:'1',capturedAt:now}]});
  ctx.send('댓글에 1번 입력해주세요 0.5',{provider:'DEEPGRAM'});
  await ctx.flushWorkflow();
  ctx.send('햇살언니 챙겨드릴게요',{provider:'DEEPGRAM'});
  await ctx.flushWorkflow();
  assert.equal(ctx.state.saves.length,0);
  assert.equal(ctx.state.sales.length,1);
  assert.equal(ctx.state.sales[0].buyerNickname,'햇살');assert.equal(ctx.state.sales[0].amount,5000);
  assert.equal(ctx.state.sales[0].workflowEvidence.profileId,'profile');
});
test('shadow workflow retains legacy sales processing and never writes a new-profile sale',async()=>{
  const ctx=fixture({workflow:{id:'profile',version:1,mode:'SHADOW',profile:DEFAULT_WORKFLOW_PROFILE}});
  ctx.send('햇살언니 챙겨드릴게요 0.5',{provider:'DEEPGRAM'});await ctx.flushWorkflow();
  assert.equal(ctx.state.saves.length,1);assert.equal(ctx.state.sales.length,0);assert.deepEqual(ctx.state.cloud,['observe']);
});
test('ordinary questions remain logs without correction alerts, beeps, edits, capture or AI calls', () => {
  for (const text of ['이거 자켓 어때, 언니들?', '이거 자켓 어때, 언니들.', '가격이 1.2인가요?', '햇살언니 1.5에 드릴까요?']) {
    const ctx = fixture({ sales: [sale()] });
    ctx.send(text);
    assert.equal(ctx.state.logs.length, 1, text);
    assert.equal(ctx.state.logs[0].actionTriggered, 'NONE', text);
    for (const key of ['events', 'beeps', 'saves', 'captures', 'cloud', 'productCalls']) assert.equal(ctx.state[key].length, 0, `${text}: ${key}`);
    assert.equal(ctx.state.sales[0].revision, 1);
    assert.equal(extractSaleFromTranscript(text), null);
  }
});

for (const provider of [undefined, 'SONIOX']) {
  test(`a business processing failure cannot discard final speech or block the next transcript (${provider || 'standard'})`, () => {
    const ctx = fixture({ failProductProcessing: true });
    for (const text of ['원단이 부드럽습니다.', '다음 상품 보여드릴게요.']) {
      assert.doesNotThrow(() => ctx.send(text, { provider, confirmedTextDelta: text }));
    }
    assert.equal(ctx.state.logs.length, 2);
    assert.equal(ctx.state.logs[1].text, '원단이 부드럽습니다.');
    assert.equal(ctx.state.logs[0].text, '다음 상품 보여드릴게요.');
  });
}

test('an actual registered word in a general question still produces a word-rule event', () => {
  const ctx = fixture({ rules: [{ word: '자켓', isEnabled: true }] });
  ctx.send('이거 자켓 어때, 언니들?');
  assert.equal(ctx.state.events.length, 1);
  assert.deepEqual(Array.from(ctx.state.events[0].matchedKeywords), ['자켓']);
  assert.equal(ctx.state.events[0].action, '단어 규칙 일치');
  assert.equal(ctx.state.beeps.length, 0);
});

test('a correction question is labelled as a correction and never changes a sale', () => {
  const ctx = fixture({ sales: [sale()] });
  ctx.send('햇살님 금액을 1.2로 변경할까요?');
  assert.equal(ctx.state.events[0].action, '정정 질문 — 변경하지 않음');
  assert.deepEqual(Array.from(ctx.state.events[0].matchedKeywords), ['음성 정정']);
  assert.equal(ctx.state.logs[0].actionTriggered, 'CORRECTION_IGNORED');
  assert.equal(ctx.state.sales[0].amount, 9000);
  assert.equal(ctx.state.cloud.length, 0);
});

test('fabric descriptions and general prohibitions do not become buyer corrections', () => {
  for (const text of ['면이 아니고 폴리에스터예요.', '면이 아니고...', '블라우스 말고 셔츠입니다.', '급하게 하지 마세요.',
    '햇살언니 면이 아니고 폴리에스터예요.', '햇살언니 길이 1.2가 아니고 1.5입니다.', '옷 변경하지 마세요.']) {
    const intent = corrections.parseVoiceCorrection(text);
    assert.equal(intent.isCorrection, false, text);
    assert.equal(intent.isNegativeCommand, false, text);
    const ctx = fixture({ sales: [sale()] }); ctx.send(text);
    assert.equal(ctx.state.events.length, 0, text);
    assert.equal(ctx.state.sales[0].revision, 1, text);
  }
});

test('mixed sale/question results preserve a 1.5 price and one original log', () => {
  for (const text of [
    '햇살언니 1.5에 넣어드릴게요. 다음 옷 어때요?',
    '다음 옷 어때요? 햇살언니. 1.5에 넣어드릴게요.',
    '햇살언니 1.5에 넣어드릴게요. 햇살님 금액 1.2로 변경할까요?',
  ]) {
    const ctx = fixture(); ctx.send(text);
    assert.equal(ctx.state.saves.length, 1, text);
    assert.equal(ctx.state.saves[0][0].buyerNickname, '햇살');
    assert.equal(ctx.state.saves[0][0].amount, 15000);
    assert.equal(ctx.state.logs.length, 1);
    assert.equal(ctx.state.logs[0].text, text);
    assert.equal(ctx.state.captions.length, 1);
  }
});

test('the cloud buyer example retains the allocation and following price between unrelated questions', () => {
  const text = '택배 많을걸? 이제 언박싱 하십시오. 구름 언니, 이거 챙겨드릴게요. 금액은 1.0, 가단 60에 총장 89. 이렇게. 허리 스트링 채워도 돼?';
  const ctx = fixture(); ctx.send(text);
  assert.equal(ctx.state.saves.length, 1);
  assert.equal(ctx.state.saves[0][0].buyerNickname, '구름');
  assert.equal(ctx.state.saves[0][0].amount, 10000);
  assert.equal(ctx.state.saves[0][0].isPending, false);
  assert.equal(ctx.state.logs.length, 1);
  assert.equal(ctx.state.logs[0].text, text);
});

test('the casual 가윤 example reaches pending sales in ordinary and Soniox streaming routes', () => {
  const text = '언니, DM 왜 빵바지 보여줄게. 아니, 가까운 건 좋은데, 가윤 언니 챙겨줄게.';
  for (const soniox of [false, true]) {
    const ctx = fixture();
    if (soniox) {
      const start = text.slice(0, text.indexOf('챙겨'));
      ctx.send(start, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: start });
      ctx.send(text, { provider: 'SONIOX', confirmedTextDelta: '챙겨줄게.' });
      ctx.flushTimers(); // Missing prices retain the existing bounded follow-up wait.
    } else ctx.send(text);
    assert.equal(ctx.state.saves.length, 1);
    assert.equal(ctx.state.saves[0][0].buyerNickname, '가윤');
    assert.equal(ctx.state.saves[0][0].status, '보류');
    assert.equal(ctx.state.saves[0][0].amount, 0);
    assert.equal(ctx.state.cloud.length, 0, 'filler 아니 must not trigger a correction');
  }
});

test('이거 언니 never replaces 이뿌쥬 in the completed or streamed sale phrase', () => {
  const text = '금액은 8,000원, 0.8. 이거 언니, 이뿌쥬 언니 챙겨드릴게요, 0.8.';
  for (const soniox of [false, true]) {
    const ctx = fixture();
    if (soniox) {
      const start = '금액은 8,000원, 0.8. 이거 언니, ';
      ctx.send(start, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: start });
      ctx.send(text, { provider: 'SONIOX', confirmedTextDelta: text.slice(start.length) });
      ctx.flushTimers();
    } else ctx.send(text);
    assert.equal(ctx.state.saves.length, 1);
    assert.equal(ctx.state.saves[0][0].buyerNickname, '이뿌쥬');
    assert.equal(ctx.state.saves[0][0].amount, 8000);
    assert.equal(ctx.state.saves[0][0].isPending, false);
  }
});

test('Soniox connects a confirmed allocation to the next explicit price without a duplicate sale', () => {
  const ctx = fixture();
  const allocation = '구름 언니, 이거 챙겨드릴게요.';
  const price = ' 금액은 1.0, 가단 60에 총장 89.';
  ctx.send(allocation, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: allocation });
  assert.equal(ctx.state.saves.length, 0);
  ctx.send(allocation + price, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: price });
  assert.equal(ctx.state.saves.length, 1);
  assert.equal(ctx.state.saves[0][0].buyerNickname, '구름');
  assert.equal(ctx.state.saves[0][0].amount, 10000);
  ctx.send(allocation + price, { provider: 'SONIOX' });
  assert.equal(ctx.state.saves.length, 1);
});

test('Soniox waits for the price ending before treating confirmed price tokens as a declaration', () => {
  for (const ending of ['인가요?', '입니다.']) {
    const ctx = fixture();
    const partial = '구름 언니, 이거 챙겨드릴게요. 금액은 1.0';
    ctx.send(partial, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: partial });
    assert.equal(ctx.state.saves.length, 0);
    ctx.send(partial + ending, { provider: 'SONIOX', confirmedTextDelta: ending });
    assert.equal(ctx.state.saves.length, ending === '입니다.' ? 1 : 0);
    if (ctx.state.saves.length) assert.equal(ctx.state.saves[0][0].amount, 10000);
  }
});

test('decimal prices and incomplete corrections survive clause boundaries', () => {
  assert.deepEqual(splitTranscriptClauses('햇살님. 가격 0.9가 아니고...'), ['햇살님.', '가격 0.9가 아니고...']);
  const complete = corrections.parseVoiceCorrection('햇살님. 금액 1.2로 정정합니다. 다음 옷 어때요?');
  assert.equal(complete.isCorrection, true);
  assert.equal(complete.affirmedNewValue.amount, 12000);
  assert.equal(complete.targetReference.buyerNickname, '햇살');
  assert.equal(corrections.parseVoiceCorrection('가격이 0.9가 아니고...').isIncomplete, true);
  assert.equal(isQuestionUtterance('가격을 1.2로 변경할까요.'), true);
  assert.equal(corrections.parseVoiceCorrection('0.9 말고 1.2').affirmedNewValue.amount, 12000);
  assert.equal(corrections.parseVoiceCorrection('가격이 0.9가 아니고 1.2.').affirmedNewValue.amount, 12000);
});

test('pending correction links only explicit product answers, never prices, measurements or questions', () => {
  const sales = [sale('one', { productCode: '1' }), sale('twelve'), sale('fifty-five', { productCode: '55' })];
  const request = pending(sales.map((entry) => entry.id));
  for (const text of ['1.2인가요?', '가격은 1.2입니다.', '가단 55입니다.', '12개요', '12번인가요?', '12번 보여드릴게요.', '12번과 1번이요']) {
    assert.equal(corrections.linkFollowUpToPendingCorrection(request, text, sales).resolvedSaleId, null, text);
  }
  for (const text of ['12번이요', '아까 12번 상품입니다.', '상품번호는 12번입니다.']) {
    assert.equal(corrections.linkFollowUpToPendingCorrection(request, text, sales).resolvedSaleId, 'twelve', text);
  }
});

test('a price question cannot resolve a pending correction but an explicit product answer can', () => {
  const ctx = fixture({ sales: [sale('one', { productCode: '1' }), sale('twelve')], pendingCorrection: pending(['one', 'twelve']) });
  ctx.send('1.2인가요?');
  assert.equal(ctx.state.sales.every((entry) => entry.revision === 1), true);
  assert.ok(ctx.globals.activePendingCorrectionRef.current);
  ctx.send('12번이요');
  assert.equal(ctx.state.sales[0].revision, 1);
  assert.equal(ctx.state.sales[1].amount, 12000);
  assert.equal(ctx.state.cloud.length, 1);
  assert.equal(ctx.globals.activePendingCorrectionRef.current, null);
  assert.equal(ctx.state.logs.length, 2);
  assert.equal(ctx.state.logs[0].actionTriggered, 'CORRECTION_APPLIED');
});

test('a single remaining sale still requires correction target evidence and a valid changed value', () => {
  const targetless = corrections.parseVoiceCorrection('금액 1.2로 정정합니다');
  assert.equal(corrections.findTargetSaleForCorrection(targetless, [sale()]).targetSaleId, null);
  for (const text of ['햇살님 가격 변경합니다', '햇살님 금액 1.2로 변경할까요?', '앞으로 판매할 가격은 1.2입니다']) {
    assert.throws(() => corrections.applyCorrectionToSale(sale(), corrections.parseVoiceCorrection(text)), /INVALID_CORRECTION/, text);
  }
});

test('corrections are restricted to the active session', () => {
  const ctx = fixture({ sales: [sale('foreign', { sessionId: 'older-session' })] });
  ctx.send('햇살님 금액 1.2로 정정합니다');
  assert.equal(ctx.state.sales[0].revision, 1);
  assert.equal(ctx.state.cloud.length, 0);
});

test('Soniox sale-token processing cannot execute a correction again before the final caption', () => {
  const ctx = fixture({ sales: [sale()] });
  const text = '햇살님이 아니고 구름님께 1.5 드리겠습니다.';
  ctx.send(text, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: text });
  assert.equal(ctx.state.sales[0].revision, 1);
  assert.equal(ctx.state.saves.length, 0);
  ctx.send(text, { provider: 'SONIOX' });
  assert.equal(ctx.state.sales[0].revision, 2);
  assert.equal(ctx.state.sales[0].buyerNickname, '구름');
  assert.equal(ctx.state.cloud.length, 1);
  assert.equal(ctx.state.saves.length, 0);
});

test('Soniox correction without a sale keyword still executes once on the completed utterance', () => {
  const ctx = fixture({ sales: [sale()] });
  const text = '햇살님 금액 1.2로 정정합니다.';
  ctx.send(text, { provider: 'SONIOX', isFinal: false, confirmedTextDelta: text });
  assert.equal(ctx.state.cloud.length, 0);
  ctx.send(text, { provider: 'SONIOX' });
  assert.equal(ctx.state.sales[0].amount, 12000);
  assert.equal(ctx.state.sales[0].revision, 2);
  assert.equal(ctx.state.cloud.length, 1);
});

test('Soniox waits for a whole command before deciding whether it is a question', () => {
  const ctx = fixture();
  ctx.send('수정 시작', { provider: 'SONIOX', isFinal: false, confirmedTextDelta: '수정 시작' });
  assert.equal(ctx.globals.isVoiceEditingRef.current, false);
  ctx.send('수정 시작할까요?', { provider: 'SONIOX', confirmedTextDelta: '할까요?' });
  assert.equal(ctx.globals.isVoiceEditingRef.current, false);
  assert.equal(ctx.state.logs.some((entry) => entry.actionTriggered === 'VOICE_EDIT_START'), false);
  ctx.send('수정 시작.', { provider: 'SONIOX', confirmedTextDelta: '수정 시작.' });
  assert.equal(ctx.globals.isVoiceEditingRef.current, true);
  assert.equal(ctx.state.logs.filter((entry) => entry.actionTriggered === 'VOICE_EDIT_START').length, 1);
});

test('Soniox field-edit questions cannot apply a partial price or leak it into the next answer', () => {
  const ctx = fixture({ sales: [sale()] }); ctx.globals.isVoiceEditingRef.current = true;
  ctx.send('금액은 1.2', { provider: 'SONIOX', isFinal: false, confirmedTextDelta: '금액은 1.2' });
  assert.equal(ctx.state.sales[0].amount, 9000);
  ctx.send('금액은 1.2인가요?', { provider: 'SONIOX', confirmedTextDelta: '인가요?' });
  assert.equal(ctx.state.sales[0].amount, 9000);
  ctx.send('금액은 1.5입니다.', { provider: 'SONIOX', confirmedTextDelta: '금액은 1.5입니다.' });
  assert.equal(ctx.state.sales[0].amount, 15000);
});

test('questions and prohibitions never execute explicit edit/delete commands', () => {
  for (const text of ['수정 시작할까요?', '수정 완료인가요?', '방금 건 삭제할까요?', '삭제하지 마세요', '바꾸지 마세요']) {
    assert.equal(parseVoiceCommand(text, true).type, 'NONE', text);
  }
});

test('manual voice editing cannot revive the first name from an ambiguous parser result', () => {
  for (const text of ['닉네임 햇살님, 닉네임 구름님', '닉네임 햇살, 닉네임 구름, 금액 0.8',
    '이름 햇살, 이름 구름, 금액 0.8']) {
    assert.equal(parseVoiceCommand(text, true).type, 'NONE', text);
  }
  for (const [text, nickname] of [['닉네임 이뿌쥬님', '이뿌쥬'], ['닉네임 봄', '봄'], ['이름 홍길동', '홍길동']]) {
    const command = parseVoiceCommand(text, true);
    assert.equal(command.type, 'FIELD_UPDATE', text);
    assert.equal(command.updatedNickname, nickname, text);
  }
});
