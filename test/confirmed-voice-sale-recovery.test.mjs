import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedAiRecoveryBaseline, previewConfirmedAiRecovery, applyConfirmedAiRecovery } from '../src/services/confirmedVoiceSaleRecovery.ts';
import { validateVoiceTextReviewAnswer } from '../src/services/voicePendingReviewService.ts';

const at = hms => new Date(`2026-10-21T${hms}+09:00`).toISOString();
const legacy = { id: 'star-sale', sessionId: 'test-5', source: 'WEB_VOICE', status: '확정', syncStatus: 'SYNCED', revision: 4,
  buyerNickname: '하늘', buyerId: 'sky', amount: 50000, unitPrice: 50000, quantity: 1,
  recognizedAt: at('00:49:32'), rawTranscript: '네, 이거 별이님 드릴게요. 감사합니다.',
  purchaseRequestId: 'test-5:sky-comment', sourceCommentIds: ['sky-comment'], printStatus: 'PRINTED', printRevision: 1,
  aiVerification: { reviewMode: 'TEXT_PROMPT', aiStatus: 'RESOLVED', candidateBuyer: { nickname: '하늘', buyerId: 'sky' }, candidateAmount: 50000 },
  history: [{ revision: 2, changedAt: at('00:50:55'), changedBy: 'AI', changeType: 'AI_RESOLVE',
    before: { status: '보류', buyerNickname: '별이', amount: 0 }, after: { status: '보류', buyerNickname: '하늘', amount: 50000 }, summary: 'old AI overwrite' },
    { revision: 3, changedAt: at('00:50:58'), changedBy: 'AI', changeType: 'AI_RESOLVE',
      before: { status: '보류', buyerNickname: '하늘', amount: 50000 }, after: { status: '확정', buyerNickname: '하늘', amount: 50000 }, summary: 'old AI confirmation' }] };
const comments = [{ id: 'star-comment', platformMessageId: 'star-comment', sessionId: 'test-5', nickname: '별이', buyerId: 'star', content: '저요', capturedAt: at('00:49:27') },
  { id: 'sky-comment', platformMessageId: 'sky-comment', sessionId: 'test-5', nickname: '하늘', buyerId: 'sky', content: '저요', capturedAt: at('00:49:07') }];
const logs = [{ id: 'sky', sessionId: 'test-5', text: '하늘님 5.0 드릴게요', recognizedAt: at('00:49:13'), isFinal: true },
  { id: 'star-price', sessionId: 'test-5', text: '가격 1.2 캡처해주세요.', recognizedAt: at('00:49:35'), isFinal: true }];
const preview = (record = legacy, transcript = logs, records = comments) => previewConfirmedAiRecovery(record, records, transcript);

test('legacy sky/50000 can preview star/12000 without changing the confirmed sale', () => {
  const record = structuredClone(legacy);
  const meta = preview(record);
  assert.deepEqual(record, legacy);
  assert.equal(meta.reviewMode, 'TEXT_PROMPT_RECOVERY');
  assert.equal(meta.aiStatus, 'NEEDS_SELLER_CONFIRM');
  assert.equal(meta.candidateBuyer.nickname, '별이');
  assert.equal(meta.candidateBuyer.buyerId, 'star');
  assert.equal(meta.candidateAmount, 12000);
  assert.equal(meta.candidatePurchaseRequestId, 'test-5:star-comment');
  assert.ok(meta.recoveryReview.candidateFingerprint);
  assert.equal(validateVoiceTextReviewAnswer(legacy, comments, '닉네임: 별이\n가격:12000원', 1, '', '', logs).nicknameVerified, false,
    'Normal review keeps its existing identity protection');
});

test('the real 8ms/9ms STT timeline copies do not cut the target off from its 12000 price', () => {
  const record = { ...legacy, recognizedAt: '2026-10-20T15:49:32.870Z' };
  const transcript = [
    { id: 'copy-one', text: record.rawTranscript, recognizedAt: '2026-10-20T15:49:32.878Z', isFinal: true, workflowEligible: false },
    { id: 'copy-two', text: record.rawTranscript, recognizedAt: '2026-10-20T15:49:32.879Z', isFinal: true, workflowEligible: true },
    { id: 'price', text: '가격 1.2 캡처해주세요.', recognizedAt: '2026-10-20T15:49:35.626Z', isFinal: true },
  ];
  const meta = preview(record, transcript);
  assert.equal(meta.candidateBuyer.nickname, '별이');
  assert.equal(meta.candidateAmount, 12000);
  const reviewed = { ...record, aiVerification: meta };
  assert.equal(applyConfirmedAiRecovery(reviewed, preview(reviewed, transcript), meta.recoveryReview.candidateFingerprint).amount, 12000);
  const laterTrade = [...transcript.slice(0, 2), { id: 'new-sale', text: record.rawTranscript, recognizedAt: '2026-10-20T15:49:34.000Z', isFinal: true }, transcript[2]];
  assert.equal(preview(record, laterTrade).candidateAmount, undefined, 'A real later allocation still ends the target');
});

test('seller application updates the same sale, account and amount with a full before/after audit', () => {
  const reviewed = { ...legacy, aiVerification: preview() };
  const corrected = applyConfirmedAiRecovery(reviewed, preview(reviewed), reviewed.aiVerification.recoveryReview.candidateFingerprint);
  assert.equal(corrected.id, legacy.id);
  assert.equal(corrected.status, '확정');
  assert.equal(corrected.buyerNickname, '별이');
  assert.equal(corrected.buyerId, 'star');
  assert.equal(corrected.amount, 12000);
  assert.equal(corrected.unitPrice, 12000);
  assert.equal(corrected.purchaseRequestId, 'test-5:star-comment');
  assert.deepEqual(corrected.sourceCommentIds, ['star-comment']);
  assert.equal(corrected.rawTranscript, legacy.rawTranscript);
  assert.equal(corrected.revision, 5);
  assert.equal(corrected.history.length, 3);
  assert.deepEqual(corrected.history.at(-1).before, { buyerNickname: '하늘', amount: 50000, status: '확정' });
  assert.equal(corrected.history.at(-1).changedBy, 'SELLER');
  assert.equal(corrected.history.at(-1).after.buyerNickname, '별이');
  assert.equal(corrected.printStatus, 'NOT_REQUESTED');
  assert.equal(corrected.printRevision, 2, 'Old print acknowledgements cannot mark the corrected version printed');
  assert.equal(confirmedAiRecoveryBaseline(corrected), null);
  assert.equal(applyConfirmedAiRecovery(corrected, preview(corrected), reviewed.aiVerification.recoveryReview.candidateFingerprint), null);
});

test('a preview and an unchanged candidate are required before applying a correction', () => {
  const meta = preview();
  const reviewed = { ...legacy, aiVerification: meta };
  const fp = meta.recoveryReview.candidateFingerprint;
  assert.equal(applyConfirmedAiRecovery(legacy, meta, fp), null, 'No saved preview');
  assert.equal(applyConfirmedAiRecovery(reviewed, preview(reviewed), ''), null);
  assert.equal(applyConfirmedAiRecovery(reviewed, preview(reviewed), 'another-sale-preview'), null);
  assert.equal(applyConfirmedAiRecovery({ ...reviewed, revision: 5 }, preview(reviewed), fp), null);
  const changed = logs.map(log => log.id === 'star-price' ? { ...log, text: '가격 1.3 캡처해주세요.' } : log);
  assert.equal(applyConfirmedAiRecovery(reviewed, preview(reviewed, changed), fp), null);
});

test('verified new sales and seller edits cannot enter legacy recovery', () => {
  for (const edit of [{ source: 'MANUAL' }, { status: '취소' }, { status: '수동수정' }, { syncStatus: 'PENDING' },
    { aiVerification: { ...legacy.aiVerification, textReviewEvidence: { version: 1 } } },
    { aiVerification: undefined }, { history: [] }, { history: [{ changedBy: 'AI', changeType: 'AI_RESOLVE' }] },
    { history: [...legacy.history, { changedBy: 'SELLER', changeType: 'MANUAL_EDIT', before: {}, after: {} }] }]) {
    assert.equal(confirmedAiRecoveryBaseline({ ...legacy, ...edit }), null);
  }
});

test('missing target price, ambiguous accounts and missing purchase comments cannot propose a correction', () => {
  for (const meta of [preview(legacy, logs.filter(log => log.id !== 'star-price')),
    preview(legacy, logs, comments.filter(c => c.buyerId !== 'star')),
    preview(legacy, logs, [...comments, { ...comments[0], id: 'other-star', platformMessageId: 'other-star', buyerId: 'different-star' }])]) {
    assert.equal(meta.nicknameVerified, undefined);
    assert.equal(meta.recoveryReview.candidateFingerprint, undefined);
  }
});
