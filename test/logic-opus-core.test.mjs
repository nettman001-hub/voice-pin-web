import test from "node:test";
import assert from "node:assert/strict";
import { parseJudgement, needsPronunciation, parsePronunciations } from "../src/services/logicOpus/opusPrompt.ts";
import { findSpokenNameCandidates } from "../src/services/logicOpus/opusNicknameCandidates.ts";
import { applyJudgement, applyManualEdit } from "../src/services/logicOpus/opusLedger.ts";
import { mergeRotationTokens, joinTokens } from "../src/services/logicOpus/opusTokenMerge.ts";
import { buildHintTerms, HintRotationScheduler } from "../src/services/logicOpus/opusHintPlanner.ts";
import { parseTranscript, mergeTimeline, replayWindows } from "../src/services/logicOpus/opusReplay.ts";

const judgement = (ops, classifications = []) => ({ classifications, productState: null, ledgerOps: ops, sttHintRequest: false });
const create = (over = {}) => ({
  op: "CREATE", buyerNickname: "체리나무", product: "가디건", price: 18000, quantity: 1,
  confidence: 0.92, evidence: ["s_1"], reason: "판매자가 체리 나무 언니 드릴게요", alternatives: [], ...over,
});
const ctx = (over = {}) => ({
  now: "2026-10-04T14:40:14.000Z",
  knownNicknames: ["체리나무", "루비", "😚JJEONG😚", "제갈", "네네"],
  sellerNicknames: ["네네"],
  ...over,
});

test("AI 응답 파서: 코드블록·문자열 숫자·필수 배열 검사", () => {
  const parsed = parseJudgement("```json\n" + JSON.stringify({
    classifications: [{ eventId: "c_1", type: "PURCHASE_INTENT", confidence: "0.9" }, { eventId: "c_2", type: "모름" }],
    productState: { name: "스판 폴라", price: "3,000", options: [{ no: "1", label: "화이트" }], salesMode: "NUMBER_CALL" },
    ledgerOps: [{ op: "CREATE", buyerNickname: "강아디", product: "스판 폴라", price: "3000", confidence: 1.4, evidence: ["s_2"] }, { op: "BAD" }],
  }) + "\n```");
  assert.equal(parsed.classifications[0].confidence, 0.9);
  assert.equal(parsed.classifications[1].type, "CHATTER");
  assert.equal(parsed.productState.price, 3000);
  assert.equal(parsed.productState.options[0].no, 1);
  assert.equal(parsed.ledgerOps.length, 1);
  assert.equal(parsed.ledgerOps[0].price, 3000);
  assert.equal(parsed.ledgerOps[0].confidence, 1);
  assert.equal(parsed.sttHintRequest, true, "구매의사가 있으면 힌트 갱신 요청");
  assert.throws(() => parseJudgement("판단할 수 없습니다"));
  assert.throws(() => parseJudgement('{"foo":1}'));
});

test("발음 파서와 발음 필요 판정", () => {
  assert.deepEqual(parsePronunciations('{"pronunciations":{"xou.3z":["엑소","엑스오유"],"🐯":["호랑이"]}}'), {
    "xou.3z": ["엑소", "엑스오유"],
    "🐯": ["호랑이"],
  });
  assert.equal(needsPronunciation("xou.3z"), true);
  assert.equal(needsPronunciation("🐯"), true);
  assert.equal(needsPronunciation("체리나무"), false);
});

const style2Pool = [
  "은하수용인", "강아디", "생강♡까꿍사랑♡", "크림이123", "도도리", "액셔니", "레오", "녜옹", "쭈쭈공주님",
  "곰곰🐼", "엘진", "rammmmm", "됴하됴하", "효효효", "zz2", "🐯", "표수니", "얀녕", "돼랑이 ♡", "준히", "장미^^", "코스모스", "둉",
].map((nickname, i) => ({ nickname, lastAt: 1000 + i, recentIntent: false }));

function topFor(speech, spoken, pool = style2Pool) {
  const groups = findSpokenNameCandidates("s_1", speech, pool);
  const g = groups.find((x) => x.spoken.includes(spoken));
  return g?.candidates[0]?.nickname;
}

test("닉네임 후보: STT 오인식 이름이 댓글 닉네임 1순위로 잡힌다 (샘플 방식2)", () => {
  assert.equal(topFor("RAM 도와도와, 효효효까지 품절.", "도와도와"), "됴하됴하");
  assert.equal(topFor("RAM 도와도와, 효효효까지 품절.", "효효효"), "효효효");
  assert.equal(topFor("RAM 도와도와, 효효효까지 품절.", "RAM"), "rammmmm");
  assert.equal(topFor("3번은 액셔니 레오, 품절입니다. 3,000원씩.", "액셔니"), "액셔니");
  assert.equal(topFor("1번, 얌냥.", "얌냥"), "얀녕");
  assert.equal(topFor("5,000원, 2번. 77까지. 1번 대랑이.", "대랑이"), "돼랑이 ♡");
  assert.equal(topFor("1번 준희 언니.", "준희"), "준히");
  assert.equal(topFor("1번은 표순이 언니 드릴게요.", "표순이"), "표수니");
  assert.equal(topFor("2번 공곰 언니도 드릴게요.", "공곰"), "곰곰🐼");
  assert.equal(topFor("ZZ2.", "ZZ2"), "zz2");
});

test("닉네임 후보: 띄어쓰기·부분이름·AI 발음 (샘플 방식1)", () => {
  const pool = [
    { nickname: "체리나무", lastAt: 1, recentIntent: true },
    { nickname: "한호윤", lastAt: 2, recentIntent: false },
    { nickname: "xou.3z", lastAt: 3, recentIntent: true, pronunciations: ["엑소", "엑스오유"] },
    { nickname: "🐯", lastAt: 4, recentIntent: false, pronunciations: ["호랑이"] },
    { nickname: "지성이👻", lastAt: 5, recentIntent: false },
    { nickname: "루비", lastAt: 6, recentIntent: false },
  ];
  assert.equal(topFor("체리 나무 언니 드릴게요.", "체리", pool), "체리나무");
  assert.equal(topFor("1번. 호연 언니 넣어드릴게요.", "호연", pool), "한호윤");
  assert.equal(topFor("맨투맨 드릴게요. 엑소 언니.", "엑소", pool), "xou.3z");
  assert.equal(topFor("은하수 용인. 호랑이 이모티콘.", "호랑이", pool), "🐯");
  assert.equal(topFor("지성이 언니 드릴게요.", "지성이", pool), "지성이👻");
});

test("원장: 정상 확정은 바로 인쇄 대상", () => {
  const r = applyJudgement([], judgement([create()]), ctx());
  assert.equal(r.sales.length, 1);
  assert.equal(r.sales[0].id, "L-0001");
  assert.equal(r.sales[0].status, "CONFIRMED");
  assert.deepEqual(r.printIds, ["L-0001"]);
  assert.equal(r.sales[0].printStatus, "QUEUED");
  assert.equal(r.sales[0].printRevision, 1);
});

test("원장: 댓글에 없는 닉네임·판매자 계정·가격 없음·낮은 신뢰도는 검토 필요", () => {
  const r = applyJudgement([], judgement([
    create({ buyerNickname: "체리 나무" }),
    create({ buyerNickname: "정원이" }),
    create({ buyerNickname: "네네" }),
    create({ buyerNickname: "루비", price: null }),
    create({ buyerNickname: "제갈", confidence: 0.6, alternatives: ["😚JJEONG😚"] }),
  ]), ctx());
  const [a, b, c, d, e] = r.sales;
  assert.equal(a.status, "CONFIRMED", "띄어쓰기만 다른 이름은 댓글 원문으로 정규화");
  assert.equal(a.buyerNickname, "체리나무");
  assert.equal(b.status, "REVIEW");
  assert.ok(b.reviewReasons.includes("댓글에 없는 닉네임"));
  assert.ok(c.reviewReasons.includes("판매자 계정"));
  assert.ok(d.reviewReasons.includes("가격 불명확"));
  assert.ok(e.reviewReasons.some((x) => x.startsWith("AI 신뢰도")));
  assert.deepEqual(e.candidates, ["제갈", "😚JJEONG😚"]);
  assert.deepEqual(r.printIds, ["L-0001"]);
});

test("원장: 같은 구매자·같은 상품 반복 확정은 중복 의심", () => {
  let r = applyJudgement([], judgement([create({ buyerNickname: "루비", product: "반목티", option: "차콜", price: 8000 })]), ctx({ now: "2026-10-04T15:04:03.000Z" }));
  r = applyJudgement(r.sales, judgement([create({ buyerNickname: "루비", product: "반목티", option: "차콜", price: 8000 })]), ctx({ now: "2026-10-04T15:04:10.000Z" }));
  assert.equal(r.sales[1].status, "REVIEW");
  assert.equal(r.sales[1].duplicateOf, "L-0001");
  assert.deepEqual(r.printIds, []);
});

test("원장: 인쇄 후 가격 정정은 정정 전표, 옵션만 바뀌면 다시 찍지 않음", () => {
  let r = applyJudgement([], judgement([create({ buyerNickname: "루비", product: "기본티", price: 11000 })]), ctx());
  let sales = r.sales.map((s) => ({ ...s, printStatus: "PRINTED" }));
  r = applyJudgement(sales, judgement([{ op: "UPDATE", saleId: "L-0001", price: 10000, reason: "만 원에 가져가" }]), ctx());
  assert.deepEqual(r.printIds, ["L-0001"]);
  assert.equal(r.sales[0].price, 10000);
  assert.equal(r.sales[0].corrected, true);
  assert.equal(r.sales[0].printRevision, 2);
  sales = r.sales.map((s) => ({ ...s, printStatus: "PRINTED" }));
  r = applyJudgement(sales, judgement([{ op: "UPDATE", saleId: "L-0001", option: "아이보리", reason: "색상" }]), ctx());
  assert.deepEqual(r.printIds, []);
  assert.equal(r.sales[0].option, "아이보리");
  r = applyJudgement(r.sales, judgement([{ op: "CANCEL", saleId: "L-0001", reason: "안 돼요" }, { op: "UPDATE", saleId: "L-9999", reason: "x" }]), ctx());
  assert.equal(r.sales[0].status, "CANCELLED");
  assert.equal(r.rejected.length, 1);
});

test("원장: 관리자가 후보를 눌러 확정하면 인쇄 대상", () => {
  const r1 = applyJudgement([], judgement([create({ buyerNickname: "제갈", confidence: 0.55, alternatives: ["😚JJEONG😚"] })]), ctx());
  assert.equal(r1.sales[0].status, "REVIEW");
  const r2 = applyManualEdit(r1.sales, "L-0001", { buyerNickname: "😚JJEONG😚" }, ctx());
  assert.equal(r2.sales[0].status, "CONFIRMED");
  assert.equal(r2.sales[0].buyerNickname, "😚JJEONG😚");
  assert.deepEqual(r2.printIds, ["L-0001"]);
  const r3 = applyManualEdit(r2.sales, "L-0001", { buyerNickname: "없는사람" }, ctx());
  assert.equal(r3.sales[0].status, "REVIEW", "관리자 수정도 댓글 닉네임이어야 확정");
});

const tok = (text, startMs, endMs, session) => ({ text, startMs, endMs, session });

test("겹침 병합: 자르는 지점에 걸친 단어는 새 세션 것을 쓰고 중복은 없다", () => {
  const a = [tok("가격은", 0, 400, 1), tok(" 만", 450, 600, 1), tok(" 원", 620, 700, 1), tok(" 이거", 1950, 2300, 1), tok(" 루", 3100, 3200, 1)];
  // B는 2000ms부터 들어서 '이거'를 반만 들었다
  const b = [tok("~거", 2000, 2300, 2), tok(" 루비", 3100, 3400, 2), tok(" 언니", 3450, 3700, 2)];
  // A는 3200ms까지 들었고, '루비'를 '루'까지만 들었다
  const m = mergeRotationTokens(a, b, 3150, -Infinity);
  assert.equal(joinTokens([...m.keptA, ...m.keptB]), "가격은 만 원 이거 루비 언니");
});

test("겹침 병합: 옛 세션이 이미 내보낸 단어는 새 세션에서 다시 쓰지 않는다", () => {
  const b = [tok("드릴게요", 1000, 1500, 2), tok(" 그다음에", 2600, 3000, 2)];
  const m = mergeRotationTokens([], b, 3000, 1500);
  assert.equal(joinTokens(m.keptB), "그다음에");
});

test("힌트 단어: 구매의사 닉네임 우선, 이모지 닉네임은 발음만, 최대 50명", () => {
  const recent = Array.from({ length: 70 }, (_, i) => `시청자${i}`);
  const r = buildHintTerms({
    fixedWords: ["가디건"],
    recentNicknames: ["🐯", ...recent],
    intentNicknames: ["xou.3z", "🐯"],
    pronunciations: { "xou.3z": ["엑소"], "🐯": ["호랑이"] },
  });
  assert.deepEqual(r.terms.slice(0, 4), ["가디건", "xou.3z", "엑소", "호랑이"]);
  assert.ok(!r.terms.includes("🐯"));
  assert.equal(r.nicknames.length, 50);
  assert.ok(r.terms.length <= 100);
});

test("힌트 교체: 여러 명이 동시에 구매의사를 밝혀도 5초에 한 번만 교체", async () => {
  let now = 0;
  const timers = [];
  const deps = {
    now: () => now,
    setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    rotate: async () => true,
  };
  const s = new HintRotationScheduler(deps);
  const advance = async (to) => {
    while (true) {
      timers.sort((x, y) => x.at - y.at);
      const t = timers[0];
      if (!t || t.at > to) break;
      timers.shift();
      now = t.at;
      t.fn();
      await new Promise((r) => setImmediate(r));
    }
    now = to;
  };
  s.request(); s.request(); s.request();
  await advance(100);
  for (let ms = 500; ms <= 4500; ms += 500) { now = ms; s.request(); }
  await advance(4999);
  assert.deepEqual(s.starts, [0]);
  await advance(5000);
  assert.deepEqual(s.starts, [0, 5000]);
  await advance(20000);
  assert.deepEqual(s.starts, [0, 5000], "새 요청이 없으면 더 교체하지 않음");
  now = 21000; s.request();
  await advance(21000);
  assert.deepEqual(s.starts, [0, 5000, 21000]);
  s.stop();
});

test("재생 테스트 파서: 자정 넘김과 닉네임 분리", () => {
  const base = new Date("2026-10-04T00:00:00+09:00");
  const comments = parseTranscript("오후 11:59:48 · 🐽: 내스타일?\n\n오전 12:00:05 · xou.3z: 저여 맨투맨\n잘못된 줄", "COMMENT", base);
  assert.equal(comments.length, 2);
  assert.equal(comments[1].nickname, "xou.3z");
  assert.equal(comments[1].text, "저여 맨투맨");
  assert.ok(Date.parse(comments[1].at) > Date.parse(comments[0].at));
  const speech = parseTranscript("오후 11:59:57 · 그다음 언니 이거 내소 제품 맨투맨이고요.\n오전 12:00:18 · 맨투맨 드릴게요. 엑소 언니.", "SPEECH", base);
  const timeline = mergeTimeline(comments, speech);
  assert.deepEqual(timeline.map((e) => e.kind), ["COMMENT", "SPEECH", "COMMENT", "SPEECH"]);
  assert.equal(replayWindows(timeline, 10000).length, 3);
});
