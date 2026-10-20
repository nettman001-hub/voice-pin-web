const koreanPeriod = value => value.replace(/\bAM\b/gu, '오전').replace(/\bPM\b/gu, '오후');
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceTextReviewPrompt, parseVoiceTextReviewAnswer, validateVoiceTextReviewAnswer,
  confirmVoiceTextReviewSale, VOICE_TEXT_REVIEW_INSTRUCTIONS, isVoiceTextReviewReady, shouldReviewVoiceSaleText,
} from '../src/services/voicePendingReviewService.ts';

// 2026-09-15 오후 9:41:10 KST, the seller's example broadcast.
const kst = (hms) => new Date(`2026-09-15T${hms}+09:00`).toISOString();
const sale = { id: 'held', sessionId: 'broadcast', source: 'WEB_VOICE', status: '보류', syncStatus: 'SYNCED',
  buyerNickname: '케이치', amount: 0, revision: 1, recognizedAt: kst('21:41:10'),
  rawTranscript: '케이치 언니는 연핑 넣어드릴게요' };
const comment = (id, hms, nickname, content, extra = {}) => ({ id, platformMessageId: id, sessionId: 'broadcast',
  nickname, content, capturedAt: kst(hms), ...extra });
const comments = [
  comment('c0', '21:40:05', '너무이른', '1분 넘게 전 댓글'),
  comment('c1', '21:40:13', '하늘', '예뻐요'),
  comment('c2', '21:40:19', 'KH', '연핑 저요', { buyerId: 'account-kh' }),
  comment('c3', '21:41:40', '별님', 'ㅈㅇ'),
  comment('c4', '21:42:20', '너무늦은', '1분 넘게 뒤 댓글'),
];
const logs = [
  { id: 'l1', recognizedAt: kst('21:41:10'), text: '케이치 언니는 연핑 넣어드릴게요', isFinal: true },
  { id: 'l2', recognizedAt: kst('21:41:26'), text: '가격은 1.5', isFinal: true },
  { id: 'l3', recognizedAt: kst('21:41:30'), text: '말하는 중', isFinal: false },
  { id: 'l4', recognizedAt: kst('21:42:30'), text: '1분 넘게 뒤 멘트', isFinal: true },
];

test('the prompt is the seller\'s exact text plus the two lists from one minute either side, never JSON', () => {
  const prompt = koreanPeriod(buildVoiceTextReviewPrompt(sale, comments, logs));
  assert.ok(prompt.startsWith(VOICE_TEXT_REVIEW_INSTRUCTIONS));
  assert.equal(prompt.slice(VOICE_TEXT_REVIEW_INSTRUCTIONS.length), [
    '', '', '',
    '<고객댓글>',
    '시각\t닉네임\t멘트',
    '2026. 9. 15. 오후 9:40:13\t하늘\t예뻐요',
    '2026. 9. 15. 오후 9:40:19\tKH\t연핑 저요',
    '2026. 9. 15. 오후 9:41:40\t별님\tㅈㅇ',
    '',
    '<판매자멘트>',
    '시각 멘트 ',
    '[오후 9:41:10] 케이치 언니는 연핑 넣어드릴게요',
    '[오후 9:41:26] 가격은 1.5',
  ].join('\n'));
  assert.match(VOICE_TEXT_REVIEW_INSTRUCTIONS, /답변은 아래와 같은 식으로 한다\.\n닉네임: xxx\n가격: 000원$/u);
});

test('the answer "닉네임: KH / 가격: 15,000원" is read in the usual model spellings', () => {
  assert.deepEqual(parseVoiceTextReviewAnswer('닉네임: KH\n가격: 15,000원'), { nickname: 'KH', amount: 15000 });
  assert.deepEqual(parseVoiceTextReviewAnswer('분석 결과입니다.\n\n**닉네임:** KH님\n**가격:** 15000원'), { nickname: 'KH', amount: 15000 });
  assert.deepEqual(parseVoiceTextReviewAnswer('닉네임：성훈 맘\n가격：1.5'), { nickname: '성훈 맘', amount: 15000 });
  assert.equal(parseVoiceTextReviewAnswer('판매가 결정된 구매자를 찾지 못했습니다.'), null);
  assert.equal(parseVoiceTextReviewAnswer('닉네임: KH'), null);
});

test('a nickname from the comment list with a price confirms the sale for that comment account', () => {
  const meta = validateVoiceTextReviewAnswer(sale, comments, '닉네임: KH\n가격: 15,000원', 2, 'task', 'fp');
  assert.equal(meta.aiStatus, 'RESOLVED');
  assert.equal(meta.reviewMode, 'TEXT_PROMPT');
  assert.equal(meta.saleConfirmed, true);
  assert.equal(meta.nicknameVerified, true);
  assert.deepEqual(meta.candidateBuyer, { buyerId: 'account-kh', nickname: 'KH' });
  assert.equal(meta.candidateAmount, 15000);
  assert.equal(meta.candidatePurchaseRequestId, 'broadcast:c2');

  const confirmed = confirmVoiceTextReviewSale({ ...sale, revision: 2, aiVerification: meta }, kst('21:42:11'));
  assert.equal(confirmed.status, '확정');
  assert.equal(confirmed.buyerNickname, 'KH');
  assert.equal(confirmed.amount, 15000);
  assert.equal(confirmed.unitPrice, 15000);
  assert.equal(confirmed.revision, 3);
  assert.equal(confirmed.purchaseRequestId, 'broadcast:c2');
  assert.equal(confirmed.history.at(-1).changeType, 'AI_RESOLVE');
  assert.equal(confirmVoiceTextReviewSale(confirmed), null, 'An already confirmed sale is not confirmed twice');
});

test('a nickname spelled differently by the model still finds the comment account; spaces are ignored', () => {
  const meta = validateVoiceTextReviewAnswer(sale, [...comments, comment('c5', '21:41:00', '성훈 맘', '저요')],
    '닉네임: 성훈맘\n가격: 12,000원', 1, 'task', 'fp');
  assert.equal(meta.aiStatus, 'RESOLVED');
  assert.equal(meta.candidateBuyer.nickname, '성훈 맘');
});

test('an unknown nickname, an empty answer or a non-text review never confirms', () => {
  const unknown = validateVoiceTextReviewAnswer(sale, comments, '닉네임: 네스트\n가격: 15,000원', 1, 'task', 'fp');
  assert.equal(unknown.aiStatus, 'NEEDS_SELLER_CONFIRM');
  assert.equal(unknown.nicknameVerified, false);
  assert.equal(unknown.candidateAmount, 15000);
  assert.equal(confirmVoiceTextReviewSale({ ...sale, aiVerification: unknown }), null);
  const empty = validateVoiceTextReviewAnswer(sale, comments, '모르겠습니다', 1, 'task', 'fp');
  assert.equal(empty.aiStatus, 'INSUFFICIENT_DATA');
  assert.equal(confirmVoiceTextReviewSale({ ...sale, aiVerification: empty }), null);
  const resolved = validateVoiceTextReviewAnswer(sale, comments, '닉네임: KH\n가격: 15,000원', 1, 'task', 'fp');
  assert.equal(confirmVoiceTextReviewSale({ ...sale, aiVerification: { ...resolved, reviewMode: undefined } }), null);
  assert.equal(confirmVoiceTextReviewSale({ ...sale, syncStatus: 'PENDING', aiVerification: resolved }), null);
});

test('the review is asked one minute after the held sale, only when comments exist around it', () => {
  assert.equal(isVoiceTextReviewReady(sale, Date.parse(kst('21:42:09'))), false);
  assert.equal(isVoiceTextReviewReady(sale, Date.parse(kst('21:42:10'))), true);
  assert.equal(shouldReviewVoiceSaleText(sale, comments), true);
  assert.equal(shouldReviewVoiceSaleText(sale, [comments[0], comments[4]]), false);
  assert.equal(shouldReviewVoiceSaleText({ ...sale, status: '확정' }, comments), false);
});
