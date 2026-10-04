import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/services/sellerLogicInput.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: 'sellerLogicInput.ts' });
const { parseSellerLogicText, koreanCalendarDate } = module.exports;
const parse = (text, date = '2026-10-05') => parseSellerLogicText(text, date, 'broadcast-test');

test('both input streams cross Korean midnight independently on the same broadcast day', () => {
  const result = parse(`[고객 댓글]
오후 11:59:59 · 루비: ㅈㅇ
오전 12:00:10 · 루비: 네
[판매자 멘트]
오후 11:59:57 · 가격은 1.8입니다.
오전 12:00:18 · 루비 언니 드릴게요.`);
  assert.equal(result.comments[0].capturedAt, '2026-10-05T14:59:59.000Z');
  assert.equal(result.comments[1].capturedAt, '2026-10-05T15:00:10.000Z');
  assert.equal(result.transcripts[0].recognizedAt, '2026-10-05T14:59:57.000Z');
  assert.equal(result.transcripts[1].recognizedAt, '2026-10-05T15:00:18.000Z');
});

for (const laterStream of ['comments', 'transcripts']) {
  test(`a ${laterStream} stream first observed after midnight aligns with the other stream`, () => {
    const commentTime = laterStream === 'comments' ? '오전 12:00:05' : '오후 11:59:55';
    const speechTime = laterStream === 'transcripts' ? '오전 12:00:05' : '오후 11:59:55';
    const result = parse(`[고객 댓글]\n${commentTime} · u: 저여\n[판매자 멘트]\n${speechTime} · 말씀해 주세요.`);
    assert.equal(result.comments[0].capturedAt,
      laterStream === 'comments' ? '2026-10-05T15:00:05.000Z' : '2026-10-05T14:59:55.000Z');
    assert.equal(result.transcripts[0].recognizedAt,
      laterStream === 'transcripts' ? '2026-10-05T15:00:05.000Z' : '2026-10-05T14:59:55.000Z');
  });
}

test('noon, midnight and a sole postmidnight stream use the selected start date', () => {
  const result = parse(`[고객 댓글]
오전 12:01:00 · 첫번째: 1
오전 11:59:59 · 두번째: 6
오후 12:00:00 · 세번째: 66
23:59:59 · 네번째: 0.9`);
  assert.equal(result.comments[0].capturedAt, '2026-10-04T15:01:00.000Z');
  assert.equal(result.comments[1].capturedAt, '2026-10-05T02:59:59.000Z');
  assert.equal(result.comments[2].capturedAt, '2026-10-05T03:00:00.000Z');
  assert.equal(result.comments[3].capturedAt, '2026-10-05T14:59:59.000Z');
  assert.equal(result.transcripts.length, 0);
});

test('calendar date validation rejects impossible days and accepts leap day', () => {
  const text = '[판매자 멘트]\n00:00:00 · 시작합니다.';
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-01', 'not-a-date']) {
    assert.throws(() => parse(text, date), /날짜/, date);
  }
  assert.equal(parse(text, '2024-02-29').transcripts[0].recognizedAt, '2024-02-28T15:00:00.000Z');
});

test('Korean calendar date does not depend on the host timezone', () => {
  assert.equal(koreanCalendarDate(new Date('2026-10-04T14:59:59Z')), '2026-10-04');
  assert.equal(koreanCalendarDate(new Date('2026-10-04T15:00:00Z')), '2026-10-05');
});

test('invalid timestamps fail with a source line instead of silently losing evidence', () => {
  for (const time of ['오후 0:00:00', '오전 13:00:00', '24:00:00', '12:60:00', '12:00:60', '12:00', 'yesterday']) {
    assert.throws(() => parse(`[고객 댓글]\n${time} · 루비: 저요`), /2행.*시각/, time);
  }
  assert.throws(() => parse('[고객 댓글]\n오후 11:00:00 · 닉네임 없는 행'), /2행.*닉네임/);
  assert.throws(() => parse('[고객 댓글]\n오후 11:00:00 · : 내용'), /2행.*닉네임/);
  assert.throws(() => parse('[고객 댓글]\n오후 11:00:00 · 루비: '), /2행.*닉네임/);
  assert.throws(() => parse('안내문만 있고 데이터가 없습니다.'), /대화를 붙여넣어/);
});

test('platform nickname spelling, emoji and punctuation remain intact', () => {
  const nicknames = ['😚JJEONG😚', '지성이👻', '민영🩷( 육투비 )', '🐽', '🍞', 'xou.3z', '쏠아양🎀'];
  const text = '[고객 댓글]\r\n' + nicknames.map((nickname) => `오후 11:50:36 • ${nickname}: 저용: 아이보리`).join('\r\n');
  const result = parse(text);
  assert.equal(result.comments.length, nicknames.length);
  result.comments.forEach((comment, index) => {
    assert.equal(comment.nickname, nicknames[index]);
    assert.equal(comment.content, '저용: 아이보리');
    assert.equal(comment.sessionId, 'broadcast-test');
  });
});

test('identical evidence on separate source rows receives distinct stable IDs', () => {
  const text = `[고객 댓글]
오후 11:50:36 · 루비: 저요
오후 11:50:36 · 루비: 저요
[판매자 멘트]
오후 11:50:40 · 드릴게요.
오후 11:50:40 · 드릴게요.`;
  const result = parse(text);
  const ids = [...result.comments, ...result.transcripts].map((event) => event.id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(JSON.stringify(ids), JSON.stringify([...parse(text).comments, ...parse(text).transcripts].map((event) => event.id)));
  assert.equal(result.comments[0].content, result.comments[1].content);
  assert.equal(result.transcripts[0].text, result.transcripts[1].text);
});

test('transport parsing preserves numeric offers, sizes and shorthand without sales classification', () => {
  const comments = ['1 베이지', '6', '66 가능?', '1.0 -> 0.8', '배송비 0.4', 'ㅈㅇ', '타코 나도 콜'];
  const speech = '이 제품 숫자 1번 입니다. 가격은 0.9. 베이지, 검정 두 가지 있어요';
  const result = parse('요청 설명은 데이터가 아니다.\n[고객 댓글]\n' +
    comments.map((content) => `23:50:36 · 루비: ${content}`).join('\n') +
    '\n[판매자 멘트]\n23:50:40 · ' + speech);
  result.comments.forEach((comment, index) => {
    assert.equal(comment.content, comments[index]);
    assert.equal(Object.keys(comment).sort().join(','), 'capturedAt,content,id,nickname,sessionId');
  });
  assert.equal(result.transcripts[0].text, speech);
  assert.equal(result.transcripts[0].isFinal, true);
  assert.equal(Object.keys(result.transcripts[0]).sort().join(','), 'id,isFinal,recognizedAt,text');
});
