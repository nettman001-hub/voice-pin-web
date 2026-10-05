import test from "node:test";
import assert from "node:assert/strict";
import { OpusSttManager } from "../src/services/logicOpus/opusSttManager.ts";

/**
 * 가짜 Soniox: 전체 오디오 기준 단어 대본을 갖고, 소켓이 실제로 받은 오디오 구간만큼만 단어를 낸다.
 * 소켓이 단어 중간부터 듣기 시작했거나 중간에 끊겼으면 "~"가 붙은 깨진 단어를 낸다.
 * 토큰 시각은 실제 Soniox처럼 그 소켓이 받은 첫 오디오 기준이다.
 */
const CHUNK_MS = 100;
const SAMPLES = 16000 * CHUNK_MS / 1000;

const chunkStart = new WeakMap();
function chunk(loud, startMs) {
  const pcm = new Int16Array(SAMPLES);
  if (loud) for (let i = 0; i < pcm.length; i++) pcm[i] = i % 2 ? 6000 : -6000;
  chunkStart.set(pcm.buffer, startMs);
  return pcm.buffer;
}

function makeScript(words) {
  // words: [text, startMs, endMs, endOfSentence?]
  return words.map(([text, startMs, endMs, eos]) => ({ text, startMs, endMs, eos: !!eos }));
}

function fakeSoniox(script) {
  const sockets = [];
  const create = () => {
    const s = {
      readyState: 0,
      config: null,
      firstGlobal: null,
      heardTo: 0,
      emitted: new Set(),
      onopen: null, onmessage: null, onerror: null, onclose: null,
      send(data) {
        if (typeof data === "string") { s.config = JSON.parse(data); return; }
        if (data.byteLength === 0) { s.finish(); return; }
        const at = chunkStart.get(data);
        if (s.firstGlobal === null) s.firstGlobal = at;
        s.heardTo = at + CHUNK_MS;
        s.emitUpTo(false);
      },
      emitUpTo(final) {
        const heardFrom = s.firstGlobal;
        const heardTo = s.heardTo;
        if (heardFrom === null) return;
        const tokens = [];
        for (const w of script) {
          if (s.emitted.has(w) || w.endMs <= heardFrom || w.startMs >= heardTo) continue;
          const startsBefore = w.startMs < heardFrom;
          const endsAfter = w.endMs > heardTo;
          if (endsAfter && !final) continue;
          s.emitted.add(w);
          const complete = !startsBefore && !endsAfter;
          tokens.push({
            text: complete ? w.text : `~${w.text.trim()}`,
            start_ms: Math.max(w.startMs, heardFrom) - heardFrom,
            end_ms: Math.min(w.endMs, heardTo) - heardFrom,
            is_final: true,
          });
          if (w.eos && complete) tokens.push({ text: "<end>", is_final: true });
        }
        if (tokens.length) s.onmessage?.({ data: JSON.stringify({ tokens }) });
      },
      finish() {
        s.emitUpTo(true);
        s.onmessage?.({ data: JSON.stringify({ tokens: [{ text: "<fin>", is_final: true }], finished: true }) });
        s.readyState = 3;
      },
      close() { s.readyState = 3; },
      die() { s.readyState = 3; s.onclose?.(); },
    };
    sockets.push(s);
    setTimeout(() => { s.readyState = 1; s.onopen?.(); }, 5);
    return s;
  };
  return { create, sockets };
}

async function tick() {
  await new Promise((r) => setImmediate(r));
}

async function runScenario({ script, totalMs, loudAt, rotateAtMs = [], dieAtMs = null }) {
  const clock = { audioMs: 0 };
  const fake = fakeSoniox(script);
  const utterances = [];
  const statuses = [];
  const m = new OpusSttManager({
    apiKey: "test-key-123456",
    createSocket: fake.create,
    onUtterance: (u) => utterances.push(u),
    onStatus: (s) => statuses.push(s),
  });
  assert.equal(await m.start(["초기"]), true);
  const rotations = [];
  for (let t = 0; t < totalMs; t += CHUNK_MS) {
    clock.audioMs = t + CHUNK_MS;
    m.pushAudio(chunk(loudAt(t), t));
    if (rotateAtMs.includes(t)) rotations.push(m.rotate(["새닉네임", `회차${t}`]));
    if (dieAtMs === t) fake.sockets.find((s) => s.readyState === 1 && s.firstGlobal !== null)?.die();
    // 소켓 열림(5ms)을 기다리는 동안 실제 방송처럼 오디오가 계속 들어온다
    await tick();
    if (t % 500 === 0) await new Promise((r) => setTimeout(r, 6));
  }
  const rotated = await Promise.all(rotations);
  await m.stop();
  return { utterances, statuses, rotated, fake, text: utterances.map((u) => u.text).join(" ") };
}

// 쉬지 않고 이어지는 판매 멘트 (단어 사이 무음 거의 없음)
const continuous = [];
{
  const words = "그다음에 이거 언니 가디건이에요 사이즈 널널하고요 가격 18,000원 갈게요 필요하신 언니 계시면 저요라고 말씀해 주세요 체리 나무 언니 드릴게요 가격은 18,000원".split(" ");
  let t = 200;
  words.forEach((w, i) => {
    const len = 300 + (i % 3) * 60;
    continuous.push([i ? ` ${w}` : w, t, t + len, i % 7 === 6]);
    t += len + 20;
  });
}
const expected = continuous.map(([w]) => w.trim()).join(" ");
const lastEnd = continuous[continuous.length - 1][2];

test("겹침 교체: 멘트가 끊기지 않아도 단어 유실·중복 없이 새 힌트 세션으로 넘어간다", async () => {
  const r = await runScenario({
    script: makeScript(continuous),
    totalMs: lastEnd + 1500,
    loudAt: (t) => t < lastEnd,
    rotateAtMs: [1500, 6000],
  });
  assert.deepEqual(r.rotated, [true, true]);
  assert.equal(r.text, expected);
  assert.ok(!r.text.includes("~"), "깨진 단어가 섞이면 안 됨");
  const last = r.statuses.filter((s) => s.rotations > 0).at(-1);
  assert.equal(last.rotations, 2);
  assert.ok(last.lastOverlapMs >= 600 && last.lastOverlapMs <= 3100, `겹침 ${last.lastOverlapMs}ms`);
  const configs = r.fake.sockets.map((s) => s.config?.context?.terms?.[0]);
  assert.deepEqual(configs, ["초기", "새닉네임", "새닉네임"]);
});

test("겹침 교체: 무음이 오면 3초를 기다리지 않고 바로 자른다", async () => {
  const words = makeScript([["가격은", 200, 600], [" 만", 650, 800], [" 원", 820, 1000, true], [" 루비", 2400, 2800], [" 언니", 2850, 3100, true]]);
  const r = await runScenario({
    script: words,
    totalMs: 4500,
    loudAt: (t) => (t >= 200 && t < 1000) || (t >= 2400 && t < 3100),
    rotateAtMs: [1100],
  });
  assert.deepEqual(r.rotated, [true]);
  assert.equal(r.text, "가격은 만 원 루비 언니");
  const last = r.statuses.filter((s) => s.rotations > 0).at(-1);
  assert.ok(last.lastOverlapMs < 1500, `무음에서 잘라야 함: ${last.lastOverlapMs}ms`);
});

test("끊김 복구: 세션이 갑자기 끊겨도 링버퍼에서 다시 보내 멘트를 잃지 않는다", async () => {
  const r = await runScenario({
    script: makeScript(continuous),
    totalMs: lastEnd + 1500,
    loudAt: (t) => t < lastEnd,
    dieAtMs: 4000,
  });
  const words = r.text.split(" ").filter((w) => !w.startsWith("~"));
  assert.equal(words.join(" "), expected);
  const last = r.statuses.filter((s) => s.recoveries > 0).at(-1);
  assert.equal(last.recoveries, 1);
  assert.ok(last.lastReplayMs > 0);
});

test("겹침 교체: 교체 시점을 바꿔 가며 반복해도 결과 멘트가 같다", async () => {
  for (let at = 700; at <= 9100; at += 600) {
    const r = await runScenario({
      script: makeScript(continuous),
      totalMs: lastEnd + 1500,
      loudAt: (t) => t < lastEnd,
      rotateAtMs: [at, at + 4000],
    });
    assert.equal(r.text, expected, `교체 시점 ${at}ms`);
  }
});

test("겹침 교체 중 옛 세션이 끊기면 새 세션으로 바로 넘어가 멘트를 잃지 않는다", async () => {
  const r = await runScenario({
    script: makeScript(continuous),
    totalMs: lastEnd + 1500,
    loudAt: (t) => t < lastEnd,
    rotateAtMs: [3000],
    dieAtMs: 3400,
  });
  assert.deepEqual(r.rotated, [true]);
  assert.equal(r.text, expected);
  assert.equal(r.statuses.at(-1).recoveries, 0);
});
