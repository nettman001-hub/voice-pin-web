import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoicePendingReview, evaluateVoicePendingReview, applyVoicePendingReview } from '../src/services/voicePendingReviewCore.ts';
import { confirmVoiceTextReviewSale, getVoiceTextReviewTargetPrice } from '../src/services/voicePendingReviewService.ts';

// The reported broadcast: separate sky, star and spring trades in one minute.
const at = hms => new Date(`2026-10-21T${hms}+09:00`).toISOString();
const sale = { id: 'star-sale', sessionId: 'test-5', source: 'WEB_VOICE', status: '보류', syncStatus: 'SYNCED',
  revision: 1, recognizedAt: at('00:49:32'), buyerNickname: '별이', buyerId: 'star',
  purchaseRequestId: 'test-5:star-request', sourceCommentIds: ['star-request'], amount: 0, quantity: 1,
  rawTranscript: '네, 이거 별이님 드릴게요. 감사합니다.', note: '구매 댓글 "저요" · 판매자 발화 "별이" 연결 (100점)' };
const comment = (id, time, nickname, buyerId, content = '저요') => ({ id, platformMessageId: id,
  sessionId: 'test-5', capturedAt: at(time), nickname, buyerId, content });
const comments = [comment('sky-request', '00:49:07', '하늘', 'sky'),
  comment('star-request', '00:49:27', '별이', 'star'), comment('sky-later', '00:49:32', '하늘', 'sky'),
  comment('star-later', '00:49:52', '별이', 'star'), comment('spring-request', '00:49:47', '봄이', 'spring')];
const log = (id, time, text) => ({ id, sessionId: 'test-5', recognizedAt: at(time), text, isFinal: true });
const logs = [log('sky', '00:49:13', '오늘도 하늘님 드리겠습니다.'),
  log('sky-price', '00:49:18', '6.0 가격 5.0 캡처해주세요.'),
  log('star', '00:49:32', sale.rawTranscript), log('star-duplicate', '00:49:32', sale.rawTranscript),
  log('star-price', '00:49:35', '가격 1.2 캡처해주세요.'),
  log('spring', '00:50:02', '네, 이거 봄이님 드릴게요.'), log('spring-price', '00:50:05', '가격 5.0 캡처해주세요.')];

function review(nickname = '별이', amount = 12000, options = {}) {
  const record = { ...sale, ...options.sale };
  const records = options.comments || comments, transcript = options.logs || logs;
  const prepared = prepareVoicePendingReview(record, records, transcript, '', 'workspace');
  const task = { taskId: 'task', saleId: record.id, sessionId: record.sessionId, saleRevision: record.revision,
    activeSlot: 1, status: 'RESOLVED', attempts: [], resolutionResult: { targetSaleId: record.id,
      evidenceSummary: `닉네임: ${nickname}\n가격: ${amount}원` }, ...options.task };
  const meta = evaluateVoicePendingReview(record, records, transcript, '', task, prepared.fingerprint, options.error);
  const applied = applyVoicePendingReview(record, records, transcript, '', meta, task);
  return { record, prepared, task, meta, applied, confirmed: confirmVoiceTextReviewSale(applied) };
}

function unchanged(result) {
  assert.equal(result.applied.buyerNickname, result.record.buyerNickname);
  assert.equal(result.applied.buyerId, result.record.buyerId);
  assert.equal(result.applied.amount, result.record.amount);
  assert.equal(result.applied.purchaseRequestId, result.record.purchaseRequestId);
  assert.deepEqual(result.applied.sourceCommentIds, result.record.sourceCommentIds);
  assert.equal(result.applied.revision, result.record.revision);
  assert.equal(result.applied.status, '보류');
  assert.equal(result.confirmed, null);
}

test('the actual wrong sky/50000 answer cannot rewrite the star sale or confirm it', () => {
  const result = review('하늘', 50000);
  unchanged(result);
  assert.equal(result.meta.nicknameVerified, false);
  assert.equal(result.meta.saleConfirmed, false);
  assert.equal(result.meta.aiStatus, 'NEEDS_SELLER_CONFIRM');
  const prompt = result.prepared.request.plainTextPrompt;
  assert.match(prompt, /<검토 대상 판매>\n판매 ID: star-sale/u);
  assert.ok(prompt.includes(sale.recognizedAt));
  assert.ok(prompt.includes(`원본 발화: ${sale.rawTranscript}`));
  assert.equal(prompt.split('<판매자멘트>')[1].split(sale.rawTranscript).length - 1, 1, 'Archive duplicates are removed');
});

test('even a correct star nickname cannot import the sky/spring price', () => {
  const result = review('별이', 50000);
  unchanged(result);
  assert.match(result.meta.resolutionSummary, /가격/u);
});

test('the target star/12000 answer uses its own split price and preserves the original request', () => {
  const result = review();
  assert.equal(result.meta.aiStatus, 'RESOLVED');
  assert.equal(result.confirmed.status, '확정');
  assert.equal(result.confirmed.buyerNickname, '별이');
  assert.equal(result.confirmed.buyerId, 'star');
  assert.equal(result.confirmed.amount, 12000);
  assert.equal(result.confirmed.purchaseRequestId, sale.purchaseRequestId, 'A later star purchase must not replace this request');
  assert.deepEqual(result.confirmed.sourceCommentIds, sale.sourceCommentIds);
  assert.equal(result.confirmed.rawTranscript, sale.rawTranscript);
  assert.equal(result.confirmed.note, sale.note);
  assert.equal(result.meta.textReviewEvidence.priceQuote, '1.2');
});

test('earlier and later trades cannot supply a missing target price', () => {
  unchanged(review('별이', 50000, { logs: logs.filter(l => l.id !== 'star-price') }));
});

test('a different buyer, another allocation for the same buyer, and a product change each end target price evidence', () => {
  for (const boundary of ['하늘님 드릴게요.', '별이님 드릴게요.', sale.rawTranscript, '다음 상품입니다.', '이 가격이면 살까요?']) {
    const result = review('별이', 12000, { logs: [log('boundary', '00:49:33', boundary), log('price', '00:49:35', '가격 1.2')] });
    unchanged(result);
  }
});

test('interim, another session and stale prices cannot supply target evidence', () => {
  for (const price of [{ ...log('price', '00:49:35', '가격 1.2'), isFinal: false },
    { ...log('price', '00:49:35', '가격 1.2'), sessionId: 'other-session' }, log('late', '00:50:03', '가격 1.2')]) {
    unchanged(review('별이', 12000, { logs: [price] }));
  }
});

test('existing purchase identity and price cannot be replaced even by a matching nickname', () => {
  unchanged(review('별이', 12000, { comments: comments.map(c => c.buyerId === 'star' ? { ...c, buyerId: 'other-star-account' } : c) }));
  unchanged(review('별이', 12000, { sale: { amount: 13000 } }));
  unchanged(review('별이', 12000, { sale: { sourceCommentIds: ['unavailable-original'], purchaseRequestId: 'test-5:unavailable-original' } }));
});

test('an exact spoken commenter wins over a similar but different nickname; two possible accounts stay held', () => {
  const noLink = { buyerId: undefined, purchaseRequestId: undefined, sourceCommentIds: [] };
  const similar = comment('similar-request', '00:49:29', '별희', 'other');
  unchanged(review('별희', 12000, { sale: noLink, comments: [...comments, similar] }));
  unchanged(review('별이', 12000, { sale: noLink, comments: [...comments, { ...similar, nickname: '별이' }] }));
});

test('a real purchase comment is required; ordinary chat, withdrawal and future requests stay held', () => {
  unchanged(review('별이', 12000, { comments: [comment('star-request', '00:49:27', '별이', 'star', '예뻐요')] }));
  unchanged(review('별이', 12000, { comments: [...comments, comment('withdraw', '00:49:30', '별이', 'star', '취소할게요')] }));
  unchanged(review('별이', 12000, { sale: { buyerId: undefined, purchaseRequestId: undefined, sourceCommentIds: [] },
    comments: [comment('future', '00:49:35', '별이', 'star')] }));
});

test('a returned task for a different sale, session or revision never applies', () => {
  for (const task of [{ saleId: 'sky-sale' }, { sessionId: 'other-session' }, { saleRevision: 2 },
    { resolutionResult: { targetSaleId: 'sky-sale', evidenceSummary: '닉네임: 별이\n가격: 12000원' } }]) {
    unchanged(review('별이', 12000, { task }));
  }
  unchanged(review('별이', 12000, { error: 'AI transport failed' }));
});

test('confirmation rejects legacy unvalidated metadata, a copied proof, and a seller edit after review', () => {
  const { meta, applied } = review();
  assert.equal(confirmVoiceTextReviewSale({ ...applied, aiVerification: { ...meta, textReviewEvidence: undefined } }), null);
  for (const edit of [{ id: 'another-sale' }, { sessionId: 'another-session' }, { recognizedAt: at('00:49:33') },
    { rawTranscript: '하늘님 드릴게요.' }, { buyerNickname: '하늘' }, { amount: 50000 }, { purchaseRequestId: 'another-request' },
    { revision: applied.revision + 1 }, { quantity: 2 }]) {
    assert.equal(confirmVoiceTextReviewSale({ ...applied, ...edit }), null);
  }
  const legacy = { ...meta, textReviewEvidence: undefined };
  const result = applyVoicePendingReview(sale, comments, logs, '', legacy, null);
  assert.equal(result.amount, 0);
  assert.equal(result.buyerNickname, '별이');
});

test('a target price with decimal measurements is validated using its price clause', () => {
  const result = review('별이', 12000, { logs: [log('price', '00:49:35', '금액은 1.2 가단 60.5 총장 89.5')] });
  assert.equal(result.confirmed.amount, 12000);
  assert.equal(getVoiceTextReviewTargetPrice(sale, []), null);
});
