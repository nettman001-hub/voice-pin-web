import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResolutionPrompt } from '../supabase/functions/sales-api/handlers/aiAdapters/common.ts';
import { buildVoiceReviewRequest, shouldReviewVoiceSale, validateVoiceReviewResult, voiceReviewFingerprint,
  getVoiceReviewWindows, isVoiceReviewReady, getVoiceReviewUtterances } from '../src/services/voicePendingReviewService.ts';

const sale = { id: 's-one', sessionId: 'session', source: 'WEB_VOICE', status: '보류', amount: 15000,
  buyerNickname: '햇살', rawTranscript: '햇살언니 1.5', recognizedAt: '2026-10-01T01:00:03Z', revision: 1 };
const comment = (nickname = '햇살', content = 'ㅈㅇ', id = 'comment', buyerId = 'account') => ({ id,
  platformMessageId: id, buyerId, nickname, content, sessionId: 'session', capturedAt: '2026-10-01T01:00:00Z' });
const result = (overrides = {}) => ({ resolvable: true, targetSaleId: sale.id, action: 'UPDATE_SALE',
  changes: { buyerNickname: { to: '햇살' }, amount: { to: 15000, quantity: 1 } },
  evidenceIds: ['voice:s-one', 'comment'], evidenceSummary: '실제 구매 댓글과 발화 비교', missingInfo: [], conflictReason: null,
  execution: { adapterType: 'CLOUD', routingMode: 'SERVER_DIRECT', provider: 'CUSTOM', model: 'test', latencyMs: 10 }, ...overrides });
const review = (current = sale, comments = [comment()], ai = result(), followingText = '') =>
  validateVoiceReviewResult(current, comments, ai, 2, 'task', voiceReviewFingerprint(current, comments, followingText), followingText);

test('only plausible pending voice sales with real purchase comments are sent to AI', () => {
  assert.equal(shouldReviewVoiceSale(sale, [comment()]), true);
  assert.equal(shouldReviewVoiceSale(sale, []), false);
  assert.equal(shouldReviewVoiceSale(sale, [comment('햇살', '가단 보여주세요')]), false);
  assert.equal(shouldReviewVoiceSale(sale, [comment('다른사람')]), true, 'A badly recognized name must reach AI instead of being prefiltered');
  assert.equal(shouldReviewVoiceSale({ ...sale, rawTranscript: '햇살언니 1.5 가단 재 드릴게요' }, [comment()]), false);
  assert.equal(shouldReviewVoiceSale({ ...sale, status: '확정' }, [comment()]), false);
  assert.equal(shouldReviewVoiceSale(sale, [{ ...comment(), sessionId: 'other' }]), false);
  assert.equal(shouldReviewVoiceSale(sale, [{ ...comment(), capturedAt: '2026-10-01T00:50:00Z' }]), false);
});

test('AI receives original speech, stable evidence IDs and the target sale, without a made-up product price', () => {
  const request = buildVoiceReviewRequest(sale, [comment()], '가격 1.5요');
  assert.equal(request.saleCandidates[0].saleId, sale.id);
  assert.equal(request.priorUtterances[0].id, 'voice:s-one');
  assert.equal(request.relevantComments[0].commentId, 'comment');
  assert.equal(request.followingUtterances[0].id, 'following:s-one');
  assert.equal(request.activeProduct, undefined);
});

test('the canonical buyer ID survives a duplicate local comment without account metadata', () => {
  const canonical = { ...comment(), id: 'server-id', platformMessageId: 'same-message' };
  const local = { ...comment(), id: 'local-id', platformMessageId: 'same-message', buyerId: undefined };
  const request = buildVoiceReviewRequest(sale, [canonical, local]);
  assert.equal(request.relevantComments.length, 1);
  assert.equal(request.relevantComments[0].commentId, 'server-id');
});

test('verified AI candidates remain pending for seller confirmation and retain the actual account', () => {
  const meta = review(sale, [comment()], result({ evidenceSummary: '' }));
  assert.equal(meta.aiStatus, 'NEEDS_SELLER_CONFIRM');
  assert.equal(meta.candidateBuyer.buyerId, 'account');
  assert.equal(meta.candidateAmount, 15000);
  assert.match(meta.resolutionSummary, /댓글 닉네임과 발화 가격을 확인/);
  assert.doesNotMatch(meta.resolutionSummary, /AI 응답을 확인하지 못/);
  assert.equal(sale.status, '보류');
});

test('AI cannot invent an account, a price, a target, or resolve duplicate accounts by recency', () => {
  assert.equal(review(sale, [comment()], result({ changes: { buyerNickname: { to: '없는이름' } } })).aiStatus, 'INSUFFICIENT_DATA');
  assert.equal(review(sale, [comment()], result({ changes: { amount: { to: 13000 } } })).aiStatus, 'INSUFFICIENT_DATA');
  assert.equal(review(sale, [comment()], result({ targetSaleId: 'other' })).aiStatus, 'INSUFFICIENT_DATA');
  assert.equal(review(sale, [comment()], result({ evidenceIds: ['comment'] })).aiStatus, 'INSUFFICIENT_DATA');
  const two = [comment(), comment('햇살', 'ㅈㅇ', 'comment2', 'other-account')];
  assert.equal(review(sale, two, result({ evidenceIds: ['voice:s-one', 'comment', 'comment2'] })).aiStatus, 'INSUFFICIENT_DATA');
  assert.equal(review(sale, two).aiStatus, 'INSUFFICIENT_DATA');
});

test('non-sale decisions need voice evidence, and cannot discard a clear allocation', () => {
  const rejected = result({ action: 'NOT_SALE', changes: null, evidenceIds: ['voice:s-one'] });
  assert.equal(review(sale, [comment()], rejected).reviewDecision, 'NOT_SALE');
  assert.notEqual(review({ ...sale, rawTranscript: '햇살언니께 1.5 드리겠습니다' }, [comment()], rejected).reviewDecision, 'NOT_SALE');
});

test('a cited short following price can be proposed, but missing price evidence remains pending', () => {
  const missingPrice = { ...sale, rawTranscript: '햇살언니께 드리겠습니다', amount: 0 };
  assert.equal(review(missingPrice).aiStatus, 'INSUFFICIENT_DATA');
  const cited = result({ evidenceIds: ['voice:s-one', 'comment', 'following:s-one'] });
  assert.equal(review(missingPrice, [comment()], cited, '가격 1.5요').aiStatus, 'NEEDS_SELLER_CONFIRM');
});

test('AI can verify the cloud buyer price even when the following price sentence contains measurements', () => {
  const current = { ...sale, buyerNickname: '구름', amount: 0,
    rawTranscript: '택배 많을걸? 이제 언박싱 하십시오. 구름 언니, 이거 챙겨드릴게요. 금액은 1.0, 가단 60에 총장 89. 이렇게. 허리 스트링 채워도 돼?' };
  const ai = result({ changes: { buyerNickname: { to: '구름' }, amount: { to: 10000, quantity: 1 } } });
  const meta = review(current, [comment('구름', '저요')], ai);
  assert.equal(meta.nicknameVerified, true);
  assert.equal(meta.candidateBuyer.nickname, '구름');
  assert.equal(meta.candidateAmount, 10000);
  assert.equal(meta.saleConfirmed, true);

  const split = { ...current, rawTranscript: '구름 언니, 이거 챙겨드릴게요.' };
  const cited = { ...ai, evidenceIds: [...ai.evidenceIds, 'following:s-one'] };
  const price = '금액은 1.0, 가단 60.5에 총장 89.5.';
  assert.equal(review(split, [comment('구름')], cited, price).candidateAmount, 10000);
  assert.equal(review(split, [comment('구름')], cited, '금액은 1.0.').candidateAmount, 10000);
  assert.equal(review(split, [comment('구름')], ai, price).aiStatus, 'INSUFFICIENT_DATA', 'uncited prices are still rejected');
  assert.equal(review(split, [comment('구름')], cited, '가단 60.5에 총장 89.5.').aiStatus, 'INSUFFICIENT_DATA');
});

const windowComment = { ...comment('KH', '연핑 저요'), capturedAt: '2026-09-15T12:40:19Z' };
const windowSale = { ...sale, buyerNickname: '케이치', amount: 0,
  rawTranscript: '케이치 언니는 연핑 넣어드릴게요', recognizedAt: '2026-09-15T12:41:10Z' };
const utterance = (id, when, text, extra = {}) => ({ id, timestamp: when, recognizedAt: when, text,
  isFinal: true, confidence: 0.99, sessionId: 'session', ...extra });
const windowLogs = [
  utterance('before', '2026-09-15T12:39:48Z', '이전 상품 2.5'),
  utterance('start', '2026-09-15T12:39:49Z', '연핑 소개'),
  utterance('allocation', '2026-09-15T12:41:10Z', 'KH 언니는 연핑 넣어드릴게요'),
  utterance('repeat', '2026-09-15T12:41:13Z', 'KH 언니는 연핑'),
  utterance('description', '2026-09-15T12:41:20Z', '원단이 부드러워요'),
  utterance('price', '2026-09-15T12:41:26Z', 'KH 언니는 연핑 1.5에 넣어드렸어요'),
  utterance('end', '2026-09-15T12:41:29Z', '마감입니다'),
  utterance('after', '2026-09-15T12:41:30Z', '다음 상품 3.5'),
  utterance('interim', '2026-09-15T12:41:27Z', '2.5', { isFinal: false }),
  utterance('other', '2026-09-15T12:41:27Z', '다른 회차 4.5', { sessionId: 'other' }),
];

test('the complete 100-second purchase-comment window includes the price at +67s and excludes unrelated speech', () => {
  assert.deepEqual(getVoiceReviewWindows(windowSale, [windowComment]), [{
    commentId: 'comment', nickname: 'KH', capturedAt: windowComment.capturedAt,
    startAt: '2026-09-15T12:39:49.000Z', endAt: '2026-09-15T12:41:29.000Z',
  }]);
  assert.equal(isVoiceReviewReady(windowSale, [windowComment], Date.parse('2026-09-15T12:41:28Z')), false);
  assert.equal(isVoiceReviewReady(windowSale, [windowComment], Date.parse('2026-09-15T12:41:29Z')), true);
  const request = buildVoiceReviewRequest(windowSale, [windowComment], '', windowLogs);
  assert.deepEqual(request.sellerUtterances.map((u) => u.id),
    ['timeline:start', 'timeline:allocation', 'timeline:repeat', 'timeline:description', 'timeline:price', 'timeline:end']);
  assert.equal(request.relevantComments[0].nickname, 'KH');
  const answer = result({ changes: { buyerNickname: { to: 'KH' }, amount: { to: 15000, quantity: 1 } },
    evidenceIds: ['comment', 'timeline:allocation', 'timeline:price'] });
  const meta = validateVoiceReviewResult(windowSale, [windowComment], answer, 2, 'task', 'fp', '', windowLogs);
  assert.equal(meta.nicknameVerified, true);
  assert.equal(meta.candidateBuyer.nickname, 'KH');
  assert.equal(meta.candidateAmount, 15000);
});

test('a sales answer must explicitly provide both the nickname and the price', () => {
  for (const changes of [{ buyerNickname: { to: '햇살' } }, { amount: { to: 15000 } },
    { buyerNickname: { to: '햇살' }, amount: { to: 0 } }]) {
    const meta = review(sale, [comment()], result({ changes }));
    assert.equal(meta.aiStatus, 'INSUFFICIENT_DATA');
    assert.equal(meta.candidateBuyer, undefined);
    assert.equal(meta.candidateAmount, undefined);
  }
});

test('a clear sale with an unverified nickname keeps its proven price for seller judgment', () => {
  const confirmedSpeech = { ...sale, buyerNickname: '네스트', rawTranscript: '네스트언니 1.5 넣어드릴게요' };
  const answer = result({ action: 'KEEP_PENDING', resolvable: false,
    changes: { buyerNickname: { to: '네스트' }, amount: { to: 15000 } },
    evidenceIds: ['voice:s-one'], missingInfo: ['댓글 닉네임 연결 필요'] });
  const meta = review(confirmedSpeech, [comment('전혀다른이름')], answer);
  assert.equal(meta.saleConfirmed, true);
  assert.equal(meta.nicknameVerified, false);
  assert.equal(meta.candidateAmount, 15000);
  assert.equal(meta.candidateBuyer, undefined);
  assert.equal(meta.aiStatus, 'NEEDS_SELLER_CONFIRM');
  assert.equal(confirmedSpeech.status, '보류');
});

test('AI cannot borrow a price outside the purchase window or from an uncited measurement', () => {
  const answer = result({ changes: { buyerNickname: { to: 'KH' }, amount: { to: 25000 } },
    evidenceIds: ['comment', 'timeline:allocation', 'timeline:before'] });
  assert.equal(validateVoiceReviewResult(windowSale, [windowComment], answer, 2, 'task', 'fp', '', windowLogs).candidateAmount, undefined);
  const measured = [...windowLogs, utterance('measure', '2026-09-15T12:41:25Z', '가슴단면 2.5 재드릴게요')];
  answer.evidenceIds = ['comment', 'timeline:allocation', 'timeline:measure'];
  assert.equal(validateVoiceReviewResult(windowSale, [windowComment], answer, 2, 'task', 'fp', '', measured).candidateAmount, undefined);
});

test('the fingerprint notices new in-window speech but ignores future products', () => {
  const first = voiceReviewFingerprint(windowSale, [windowComment], '', windowLogs.slice(0, 5));
  const complete = voiceReviewFingerprint(windowSale, [windowComment], '', windowLogs);
  assert.notEqual(first, complete);
  assert.equal(complete, voiceReviewFingerprint(windowSale, [windowComment], '', [...windowLogs,
    utterance('later', '2026-09-15T12:42:00Z', '다음 상품 9.9입니다')]));
});

test('the model prompt retains all window commenters and requires both output values without a selection narrative', () => {
  const comments = Array.from({ length: 30 }, (_, i) => comment(`닉네임${i}`, 'ㅈㅇ', `c${i}`, `buyer${i}`));
  const request = buildVoiceReviewRequest(sale, comments);
  const prompt = buildResolutionPrompt(request);
  const content = JSON.parse(prompt.userPrompt);
  assert.equal(content.relevantComments.length, 30);
  assert.equal(content.purchaseWindows.length, 30);
  assert.match(prompt.systemPrompt, /buyerNickname\.to와 amount\.to를 모두/);
  assert.match(prompt.systemPrompt, /선정 이유는 서술하지/);
});
