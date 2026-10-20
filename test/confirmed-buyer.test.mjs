import { runtimeFixture } from './runtime-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveConfirmedBuyer, applyConfirmedBuyer, BUYER_LINK_PENDING, mergeBuyerComments } from '../src/services/confirmedBuyerResolver.ts';
import { getPurchaseRequests, matchPurchaseRequest } from '../src/services/purchaseFirstSales.ts';
import { hangulSoundScore } from '../src/services/hangulSound.ts';
import { buildEvidenceSnapshot } from '../src/services/pendingSalesService.ts';
import { collectFourPointWorkflowSales } from '../src/services/fourPointWorkflow.ts';

const when = '2026-10-18T12:00:00Z';
const comment = (nickname, extra = {}) => ({ id: nickname, platformMessageId: nickname, buyerId: `buyer:${nickname}`,
  sessionId: 'broadcast', nickname, content: '안녕하세요', capturedAt: '2026-10-18T11:59:55Z', ...extra });
const resolve = (spokenNickname, comments, extra = {}) => resolveConfirmedBuyer({
  spokenNickname, comments, sessionId: 'broadcast', recognizedAt: when, ...extra,
});
const sale = (resolution) => {
  const record = { id: 'sale', sessionId: 'broadcast', source: 'WEB_VOICE', status: '확정',
    buyerNickname: BUYER_LINK_PENDING, recognizedAt: when, amount: 10000, unitPrice: 10000,
    rawTranscript: '꼬순이님 1.0 드릴게요. 캡처하세요.', captureImageUrls: ['capture'] };
  return { ...record, evidenceSnapshot: { ...buildEvidenceSnapshot(record), buyerResolution: resolution } };
};

test('four-point buyer resolution links 꼬순이 to 꽃순이 without requiring a purchase comment', () => {
  const result = resolve('꼬순이', [comment('꽃순이')]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.candidates[0].nickname, '꽃순이');
  assert.equal(result.candidates[0].buyerId, 'buyer:꽃순이');
  assert.ok(result.candidates[0].nameScore >= 84);
  assert.equal(result.candidates[0].purchaseRequestId, undefined);
  const linked = applyConfirmedBuyer(sale(result), result);
  assert.equal(linked.status, '확정');
  assert.equal(linked.buyerNickname, '꽃순이');
  assert.equal(linked.amount, 10000);
  assert.deepEqual(linked.captureImageUrls, ['capture']);
  assert.deepEqual(linked.sourceCommentIds, ['꽃순이']);
  assert.equal(linked.evidenceSnapshot.buyerResolution.spokenNickname, '꼬순이');
});

test('jamo scoring connects split syllables and missing codas', () => {
  assert.ok(hangulSoundScore('꽃심이', '꽃시미') >= 84);
  assert.equal(resolve('꽃시미', [comment('꽃심이')]).status, 'MATCHED');
});

test('search includes older comments in this broadcast but excludes other broadcasts and future commenters', () => {
  const old = comment('꽃순이', { capturedAt: '2026-10-18T09:00:00Z' });
  assert.equal(resolve('꼬순이', [old]).status, 'MATCHED');
  assert.equal(resolve('꼬순이', [comment('꽃순이', { sessionId: 'another' })]).candidates.length, 0);
  assert.equal(resolve('꼬순이', [comment('꽃순이', { capturedAt: '2026-10-18T12:01:00Z' })]).candidates.length, 0);
});

test('different accounts sharing a nickname stay separate and retain the confirmed sale', () => {
  const result = resolve('꼬순이', [comment('꽃순이'), comment('꽃순이', { id: 'other', platformMessageId: 'other', buyerId: 'other' })]);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
  const waiting = applyConfirmedBuyer(sale(result), result);
  assert.equal(waiting.status, '확정');
  assert.equal(waiting.amount, 10000);
  assert.equal(waiting.buyerNickname, BUYER_LINK_PENDING);
  assert.equal(waiting.buyerId, undefined);
});

test('recent purchase evidence distinguishes equally sounding actual commenters', () => {
  const result = resolve('꼬순이', [comment('꽃순이', { content: '저요' }),
    comment('꽃순이', { id: 'other', platformMessageId: 'other', buyerId: 'other' })]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.candidates[0].buyerId, 'buyer:꽃순이');
  assert.equal(result.candidates[0].purchaseRequestId, 'broadcast:꽃순이');
});

test('low scoring names remain available for manual linking without inventing an identity', () => {
  const result = resolve('꼬순이', [comment('abcdefgh'), comment('zzzzz'), comment('다른사람'), comment('qwerty')]);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.candidates.length, 3);
  assert.equal(resolve('꼬순이', []).candidates.length, 0);
});

test('account-bound manual aliases apply only to current commenters and respect explicit numeric conflicts', () => {
  const aliases = [{ spokenNickname: '꼬순이', nickname: '꽃순이', accountKey: 'buyer:꽃순이', updatedAt: when }];
  assert.equal(resolve('꼬순이', [comment('꽃순이'), comment('꼬순이')], { aliases }).status, 'AMBIGUOUS');
  assert.equal(resolve('꼬순이', [comment('꽃순이')], { aliases }).candidates[0].nameScore, 100);
  assert.equal(resolve('꼬순이', [], { aliases }).status, 'NO_MATCH');
  const numericAlias = [{ ...aliases[0], spokenNickname: '꽃순이5678', accountKey: 'buyer:꽃순이1234' }];
  assert.equal(resolve('꽃순이5678', [comment('꽃순이1234')], { aliases: numericAlias }).status, 'NO_MATCH');
});

test('local and server copies of one comment enrich one canonical account', () => {
  const local = comment('꽃순이', { id: 'local', platformMessageId: 'shared', buyerId: undefined, platformUserId: 'platform', uniqueId: 'flower' });
  const remote = comment('꽃순이', { id: 'server', platformMessageId: 'shared' });
  const merged = mergeBuyerComments([remote, local]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'server');
  assert.equal(merged[0].uniqueId, 'flower');
  assert.equal(resolve('꼬순이', [remote, local]).status, 'MATCHED');
});

function sourceCallback(path, name) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) callback = node.initializer?.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback, `Expected ${name}`);
  return ts.transpileModule(`module.exports = ${callback}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

test('actual print gate holds only identity, then permits the linked confirmed order', () => {
  const module = { exports: {} };
  vm.runInNewContext(sourceCallback('../src/context/SalesContext.tsx', 'isPrintableSale'), { module });
  const waiting = sale(resolve('꼬순이', []));
  assert.equal(module.exports(waiting), false);
  assert.equal(module.exports(applyConfirmedBuyer(waiting, resolve('꼬순이', [comment('꽃순이')]))), true);
});

test('late general comments resolve the existing confirmed sale without changing its amount or creating a second sale', () => {
  const records = [sale(resolve('꼬순이', []))];
  const comments = [comment('꽃순이')];
  const updates = [];
  const module = { exports: {} };
  vm.runInNewContext(sourceCallback('../src/context/LiveContext.tsx', 'reconcileVoiceSaleComments'), {
    module, workspaceId: 'workspace', currentWorkflowSalesRef: { current: records }, currentSessionIdRef: { current: 'broadcast' },
    reservedPurchaseRequestsRef: { current: new Set() },
    productSalesRef: { current: { feed: { comments: [] }, activeSession: { id: 'broadcast' } } },
    storageService: { getCommentRecords: () => comments, getPurchaseRequests: () => [] },
    getPurchaseRequests, matchPurchaseRequest, resolveConfirmedBuyer, applyConfirmedBuyer, mergeBuyerComments,
    confirmedBuyerAliases: { get: () => [] },
    updateSale: (updated) => { updates.push(updated); records[0] = updated; return updated; },
  });
  module.exports();
  assert.equal(updates.length, 1);
  assert.equal(records[0].id, 'sale');
  assert.equal(records[0].status, '확정');
  assert.equal(records[0].buyerNickname, '꽃순이');
  assert.equal(records[0].amount, 10000);
  module.exports();
  assert.equal(updates.length, 1);
});

test('manual candidate selection uses the real comment account and remembers its alias in the current workspace', async () => {
  const resolution = resolve('꼬순이', [comment('꽃순이', { uniqueId: 'flower1' }),
    comment('꽃순이', { id: 'other', platformMessageId: 'other', buyerId: 'other', uniqueId: 'flower2' })]);
  const record = { ...sale(resolution), syncStatus: 'SYNCED' };
  const updates = [], aliases = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (value) => [value, () => {}] };
  const dependencies = {
    react: { ...react, default: react },
    '../../context/SalesContext': { useSales: () => ({ updateSale: (next) => { updates.push(next); return next; } }) },
    '../../context/AuthContext': { useAuth: () => ({ workspaceId: 'seller-A' }) },
    '../../services/confirmedBuyerResolver': { applyConfirmedBuyer },
    '../../services/confirmedBuyerAliases': { confirmedBuyerAliases: { remember: async (...args) => aliases.push(args) } },
  };
  const source = fs.readFileSync(new URL('../src/components/sales/ConfirmedBuyerCard.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => {
    if (name.endsWith('WorkspaceRuntimeContext')) return runtimeFixture(dependencies);
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  const tree = module.exports.ConfirmedBuyerCard({ sale: record });
  const nodes = (value) => Array.isArray(value) ? value.flatMap(nodes)
    : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const buttons = nodes(tree).filter((node) => node.type === 'button');
  assert.equal(buttons.length, 2);
  buttons[1].props.onClick();
  await new Promise((done) => setImmediate(done));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].buyerId, resolution.candidates[1].buyerId);
  assert.equal(updates[0].buyerNickname, '꽃순이');
  assert.equal(updates[0].status, '확정');
  assert.equal(updates[0].evidenceSnapshot.buyerResolution.matchedBy, 'MANUAL');
  assert.equal(aliases[0][0], 'seller-A');
  assert.equal(aliases[0][1].accountKey, resolution.candidates[1].accountKey);
});

test('server comment synchronization enriches a resolved platform account without changing the buyer or amount', () => {
  const local = comment('꽃순이', { id: 'local', platformMessageId: 'message', buyerId: undefined, platformUserId: 'platform' });
  const initial = resolve('꼬순이', [local]);
  const records = [applyConfirmedBuyer(sale(initial), initial)];
  const canonical = { ...local, id: 'canonical-comment', buyerId: 'canonical-buyer' };
  const module = { exports: {} };
  vm.runInNewContext(sourceCallback('../src/context/LiveContext.tsx', 'reconcileVoiceSaleComments'), {
    module, workspaceId: 'workspace', currentWorkflowSalesRef: { current: records }, currentSessionIdRef: { current: 'broadcast' },
    reservedPurchaseRequestsRef: { current: new Set() },
    productSalesRef: { current: { feed: { comments: [] }, activeSession: { id: 'broadcast' } } },
    storageService: { getCommentRecords: () => [local, canonical], getPurchaseRequests: () => [] },
    getPurchaseRequests, matchPurchaseRequest, resolveConfirmedBuyer, applyConfirmedBuyer, mergeBuyerComments,
    confirmedBuyerAliases: { get: () => [] }, updateSale: (updated) => { records[0] = updated; return updated; },
  });
  module.exports();
  assert.equal(records[0].buyerId, 'canonical-buyer');
  assert.equal(records[0].buyerNickname, '꽃순이');
  assert.equal(records[0].amount, 10000);
  assert.deepEqual(records[0].sourceCommentIds, ['canonical-comment']);
});

test('confirmed nickname aliases survive cloud reload and stay isolated by workspace', async () => {
  const entries = new Map(), remote = new Map();
  const source = fs.readFileSync(new URL('../src/services/confirmedBuyerAliases.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Event,
    localStorage: { getItem: (key) => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) },
    window: { dispatchEvent() {} }, require: (name) => {
    if (name.endsWith('WorkspaceRuntimeContext')) return runtimeFixture(dependencies);
      if (name === './nicknameMatcher') return { normalizeNickname: (value) => value };
      assert.equal(name, './remoteWorkspaceService');
      return { remoteWorkspaceService: {
        fetchWorkspaceSettings: async (workspace, namespace) => remote.get(`${workspace}:${namespace}`),
        saveWorkspaceSettings: async (workspace, namespace, value) => remote.set(`${workspace}:${namespace}`, value),
      } };
    },
  });
  const service = module.exports.confirmedBuyerAliases;
  const alias = { spokenNickname: '꼬순이', nickname: '꽃순이', accountKey: 'buyer', updatedAt: when };
  await service.remember('A', alias);
  assert.equal(service.get('A')[0].nickname, '꽃순이');
  assert.equal(service.get('B').length, 0);
  entries.clear();
  await service.fetch('B');
  assert.equal(service.get('B').length, 0);
  await service.fetch('A');
  assert.equal(service.get('A')[0].spokenNickname, '꼬순이');
});

test('seller workflow recognizes complete and split four-point speech using the same confirmation rule', () => {
  const t = (id, text, sec) => ({ id, text, recognizedAt: `2026-10-18T12:00:0${sec}Z`, isFinal: true });
  const complete = collectFourPointWorkflowSales([t('one', '꼬순이님 1.0 드릴게요. 캡처하세요.', 0)]);
  assert.equal(complete.length, 1);
  assert.equal(complete[0].result.isFourPointConfirmed, true);
  const split = collectFourPointWorkflowSales([t('allocation', '꼬순이님 드릴게요.', 0),
    t('price', '가격은 1.0입니다.', 1), t('capture', '캡처하세요.', 2)]);
  assert.equal(split.length, 1);
  assert.equal(split[0].result.buyerNickname, '꼬순이');
  assert.equal(split[0].result.amount, 10000);
  assert.deepEqual(split[0].transcriptIds, ['allocation', 'price', 'capture']);
  assert.equal(collectFourPointWorkflowSales([t('one', '꼬순이님 1.0 드릴게요.', 0)]).length, 0);
});

// 2026-10-20 2회차 판매 001: "이거 하니님 드릴게요. 캡처해 주시고요. 가격은 1.8." → 구매자 연결 대기.
// 업로드된 "ㅈㅇ"은 서버 buyerId를, 같은 시청자의 다른 댓글은 플랫폼 ID만 가져 한 사람이 두 계정으로 갈렸다.
test('4단 멘트: 서버 buyerId 댓글과 플랫폼 ID 댓글이 같은 시청자면 한 구매자로 연결한다 (모든 순서·조각·말끝)', async () => {
  const { extractSaleFromTranscript } = await import('../src/services/salesExtractor.ts');
  const { advanceVoiceSaleTransaction } = await import('../src/services/voiceSaleTransaction.ts');
  const spokeAt = Date.parse('2026-10-20T14:25:04Z');
  const iso = (offsetSeconds) => new Date(spokeAt + offsetSeconds * 1000).toISOString();
  const viewer = (jyAgoSeconds) => {
    const feed = { id: 'uuid-jy', sessionId: 'broadcast', platformMessageId: 'm-jy', buyerId: 'buyer-hani',
      nickname: '하니', content: 'ㅈㅇ', capturedAt: iso(-jyAgoSeconds) };
    const local = [{ ...feed, platformUserId: 'tt-777', uniqueId: 'hani_' },
      { id: 'stream-m-hi', sessionId: 'broadcast', platformMessageId: 'm-hi', platformUserId: 'tt-777', uniqueId: 'hani_',
        nickname: '하니', content: '색깔 예뻐요', capturedAt: iso(-jyAgoSeconds - 30) }];
    return mergeBuyerComments([feed, ...local]);
  };
  const check = (spokenNickname, label) => {
    for (const ago of [20, 120, 299, 400]) {
      const comments = viewer(ago);
      const result = resolveConfirmedBuyer({ spokenNickname, comments, sessionId: 'broadcast', recognizedAt: iso(0),
        requests: getPurchaseRequests(comments, 'broadcast') });
      assert.equal(result.status, 'MATCHED', `${label} / ㅈㅇ ${ago}초 전`);
      assert.equal(result.candidates.length, 1, `${label} / ㅈㅇ ${ago}초 전`);
      assert.equal(result.candidates[0].nickname, '하니');
      assert.equal(result.candidates[0].buyerId, 'buyer-hani');
      if (ago < 300) assert.equal(result.candidates[0].purchaseRequestId, 'broadcast:m-jy', label);
    }
  };
  for (const price of ['가격은 1.8', '가격은 1.8이에요', '가격은 1.8이고요', '가격은 1.8 할게요', '어, 가격은 1.8', '어, 1.8', '1.8 받을게요']) {
    const parts = ['이거 하니님', price.startsWith('어') ? '네, 드릴게요' : '드릴게요', '캡처해 주시고요', price];
    const orders = [];
    const permute = (rest, acc = []) => rest.length ? rest.forEach((part, i) =>
      permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, part])) : orders.push(acc);
    permute(parts);
    assert.equal(orders.length, 24);
    for (const order of orders) {
      const sentence = `${order.join('. ')}.`;
      const whole = extractSaleFromTranscript(sentence);
      assert.equal(whole?.isFourPointConfirmed, true, sentence);
      assert.equal(whole.amount, 18000, sentence);
      check(whole.buyerNicknamePhrase || whole.buyerNickname, sentence);
      let step = { state: null, emission: null };
      let last = null;
      order.forEach((part, i) => {
        step = advanceVoiceSaleTransaction(step.state, { sessionId: 'broadcast', eventId: `e${i}`, text: `${part}.`, recognizedAt: iso(i * 2) });
        last = step.emission || last;
      });
      assert.equal(last?.result.isFourPointConfirmed, true, `조각: ${sentence}`);
      check(last.result.buyerNicknamePhrase || last.result.buyerNickname, `조각: ${sentence}`);
    }
  }
});

test('4단 멘트: 공유 ID가 없는 동명이인 "하니" 두 계정은 여전히 확인 필요로 남긴다', () => {
  const comments = [comment('하니', { id: 'a', platformMessageId: 'a', buyerId: undefined, platformUserId: 'tt-1' }),
    comment('하니', { id: 'b', platformMessageId: 'b', buyerId: undefined, platformUserId: 'tt-2' })];
  assert.equal(resolve('하니', comments).status, 'AMBIGUOUS');
});
