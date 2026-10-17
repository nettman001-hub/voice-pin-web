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
