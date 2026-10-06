import type { LogicOpusEvent } from "../../types/logicOpus.ts";

/**
 * 재생 테스트: "오후 11:30:57 · 루비: 저요" 형식의 댓글 기록과
 * "오후 11:30:55 · 멘트" 형식의 판매자 멘트 기록을 시간순 이벤트로 바꾼다.
 */

const LINE = /^\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[·•|-]\s*(.*)$/iu;

function toDate(base: Date, ampm: string | undefined, h: number, m: number, s: number): Date {
  let hour = h;
  const p = (ampm || "").toUpperCase();
  if (p === "오후" || p === "PM") hour = h === 12 ? 12 : h + 12;
  else if (p === "오전" || p === "AM") hour = h === 12 ? 0 : h;
  const d = new Date(base);
  d.setHours(hour, m, s, 0);
  return d;
}

export function parseTranscript(
  text: string,
  kind: "COMMENT" | "SPEECH",
  baseDate = new Date(),
): LogicOpusEvent[] {
  const out: LogicOpusEvent[] = [];
  let dayShift = 0;
  let prev = -Infinity;
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const [, ampm, hh, mm, ss, rest] = m;
    let d = toDate(baseDate, ampm, Number(hh), Number(mm), Number(ss || 0));
    d = new Date(d.getTime() + dayShift * 86_400_000);
    // 자정을 넘기면 (예: 오후 11:59 → 오전 12:00) 다음 날로 본다
    if (d.getTime() < prev - 6 * 3_600_000) {
      dayShift += 1;
      d = new Date(d.getTime() + 86_400_000);
    }
    prev = d.getTime();
    const at = d.toISOString();
    n += 1;
    if (kind === "COMMENT") {
      const idx = rest.indexOf(": ");
      const sep = idx >= 0 ? idx : rest.indexOf(":");
      if (sep <= 0) continue;
      const nickname = rest.slice(0, sep).trim();
      const body = rest.slice(sep + (idx >= 0 ? 2 : 1)).trim();
      if (!nickname || !body) continue;
      out.push({ id: `c_${String(n).padStart(4, "0")}`, kind: "COMMENT", at, nickname, text: body });
    } else {
      const body = rest.trim();
      if (!body) continue;
      out.push({ id: `s_${String(n).padStart(4, "0")}`, kind: "SPEECH", at, text: body });
    }
  }
  return out;
}

export function mergeTimeline(...lists: LogicOpusEvent[][]): LogicOpusEvent[] {
  return lists.flat().sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === "COMMENT" ? -1 : 1));
}

/** 방송 시간 기준 windowMs 단위 묶음 (실방송의 1~2초 묶음보다 크게 잡아 AI 호출 수를 줄인다) */
export function replayWindows(events: LogicOpusEvent[], windowMs = 8000): LogicOpusEvent[][] {
  const out: LogicOpusEvent[][] = [];
  let current: LogicOpusEvent[] = [];
  let start = 0;
  for (const e of events) {
    const t = Date.parse(e.at);
    if (current.length && t - start >= windowMs) {
      out.push(current);
      current = [];
    }
    if (!current.length) start = t;
    current.push(e);
  }
  if (current.length) out.push(current);
  return out;
}
