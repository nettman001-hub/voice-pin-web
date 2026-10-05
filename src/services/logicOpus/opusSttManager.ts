import { LOGIC_OPUS_LIMITS } from "../../types/logicOpus.ts";
import {
  ENDPOINT_TEXTS,
  type GlobalToken,
  joinTokens,
  mergeRotationTokens,
  type RawSonioxToken,
  toGlobalTokens,
} from "./opusTokenMerge.ts";

/**
 * Soniox 실시간 STT 세션 관리 (판매자 로직분석01opus 전용).
 *
 * 1) 겹침 교체: 새 힌트 단어로 세션 B를 연 뒤 같은 오디오를 A와 B에 동시에 보내고,
 *    무음(또는 최대 3초) 지점에서 A를 끝낸다. 토큰은 오디오 시각 기준으로 이어 붙인다.
 * 2) 끊김 복구: 쓰던 세션이 갑자기 끊기면 최근 15초 오디오(링버퍼)에서
 *    마지막으로 확정된 단어 뒤부터 새 세션에 다시 보낸다.
 *
 * 기존 청취 홈의 DeepgramSttService는 1초 무음이 올 때만 교체하는데,
 * 판매 멘트는 거의 끊기지 않아 교체가 계속 밀릴 수 있어 별도 구현한다.
 */

export interface SpeechUtterance {
  text: string;
  audioStartMs: number;
  audioEndMs: number;
  sessionNo: number;
}

export interface SttManagerStatus {
  state: "IDLE" | "CONNECTING" | "LIVE" | "ROTATING" | "RECOVERING" | "ERROR" | "STOPPED";
  sessionNo: number;
  rotations: number;
  recoveries: number;
  lastOverlapMs: number;
  lastReplayMs: number;
  lastMergeDropped: number;
  hintTermCount: number;
  message?: string;
}

export interface SocketLike {
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}

export interface SttManagerDeps {
  apiKey: string;
  createSocket?: () => SocketLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  onUtterance: (u: SpeechUtterance) => void;
  onInterim?: (text: string) => void;
  onStatus?: (s: SttManagerStatus) => void;
}

const OPEN = 1;
const SAMPLE_RATE = 16000;
const QUIET_RMS = 0.012;
const MIN_OVERLAP_MS = 600;
const DRAIN_TIMEOUT_MS = 4000;
const MAX_UTTERANCE_CHARS = 300;

interface RingChunk {
  startMs: number;
  endMs: number;
  data: ArrayBuffer;
}

class SonioxSession {
  socket: SocketLike | null = null;
  ready = false;
  finished = false;
  tokens: GlobalToken[] = [];
  interim = "";
  offsetMs = 0;
  private finishWaiters: Array<() => void> = [];

  readonly no: number;
  private apiKey: string;
  private terms: string[];
  private createSocket: () => SocketLike;
  private handlers: {
    onFinal: (session: SonioxSession, tokens: GlobalToken[], endpoint: boolean) => void;
    onInterim: (session: SonioxSession, text: string) => void;
    onDead: (session: SonioxSession, reason: string) => void;
  };

  constructor(
    no: number,
    apiKey: string,
    terms: string[],
    createSocket: () => SocketLike,
    handlers: SonioxSession["handlers"],
  ) {
    this.no = no;
    this.apiKey = apiKey;
    this.terms = terms;
    this.createSocket = createSocket;
    this.handlers = handlers;
  }

  open(offsetMs: number, timeoutMs: number, setTimer: SttManagerDeps["setTimer"], clearTimer: SttManagerDeps["clearTimer"]): Promise<boolean> {
    this.offsetMs = offsetMs;
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimer!(timer);
        resolve(ok);
      };
      const timer = setTimer!(() => done(false), timeoutMs);
      const socket = this.createSocket();
      this.socket = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({
          api_key: this.apiKey,
          model: "stt-rt-v5",
          audio_format: "pcm_s16le",
          sample_rate: SAMPLE_RATE,
          num_channels: 1,
          language_hints: ["ko"],
          language_hints_strict: true,
          enable_speaker_diarization: false,
          enable_endpoint_detection: true,
          max_endpoint_delay_ms: 1500,
          ...(this.terms.length ? { context: { terms: this.terms } } : {}),
        }));
        this.ready = true;
        done(true);
      };
      socket.onmessage = (ev) => {
        let data: { tokens?: RawSonioxToken[]; finished?: boolean; error_code?: number; error_message?: string };
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (data.error_code || data.error_message) {
          this.handlers.onDead(this, `Soniox 오류 ${data.error_code ?? ""} ${data.error_message ?? ""}`.trim());
          return;
        }
        const tokens = data.tokens || [];
        const finals = toGlobalTokens(tokens, this.offsetMs, this.no);
        const endpoint = tokens.some((t) => t.is_final && ENDPOINT_TEXTS.has(t.text));
        if (finals.length || endpoint) {
          this.tokens.push(...finals);
          this.handlers.onFinal(this, finals, endpoint);
        }
        this.interim = tokens.filter((t) => !t.is_final && !ENDPOINT_TEXTS.has(t.text)).map((t) => t.text).join("");
        this.handlers.onInterim(this, this.interim);
        if (data.finished) this.markFinished();
      };
      socket.onerror = () => {
        if (!settled) done(false);
        else if (!this.finished) this.handlers.onDead(this, "연결 오류");
      };
      socket.onclose = () => {
        if (!settled) done(false);
        if (!this.finished) {
          this.markFinished();
          this.handlers.onDead(this, "연결 종료");
        }
      };
    });
  }

  send(chunk: ArrayBuffer) {
    if (this.socket && this.ready && this.socket.readyState === OPEN) this.socket.send(chunk);
  }

  /** 남은 오디오를 확정하고 정상 종료(빈 프레임). finished 응답 또는 시간 초과까지 기다린다. */
  drain(timeoutMs: number, setTimer: SttManagerDeps["setTimer"], clearTimer: SttManagerDeps["clearTimer"]): Promise<void> {
    if (this.finished) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimer!(() => {
        this.markFinished();
      }, timeoutMs);
      this.finishWaiters.push(() => {
        clearTimer!(timer);
        resolve();
      });
      try {
        if (this.socket?.readyState === OPEN) this.socket.send(new ArrayBuffer(0));
        else this.markFinished();
      } catch {
        this.markFinished();
      }
    });
  }

  private markFinished() {
    if (this.finished) return;
    this.finished = true;
    const waiters = this.finishWaiters;
    this.finishWaiters = [];
    waiters.forEach((w) => w());
  }

  close() {
    this.finished = true;
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
    try { s.close(); } catch { /* ignore */ }
  }
}

export class OpusSttManager {
  private active: SonioxSession | null = null;
  private candidate: SonioxSession | null = null;
  private draining: SonioxSession | null = null;
  private sessionCounter = 0;
  private globalMs = 0;
  private ring: RingChunk[] = [];
  private pending: GlobalToken[] = [];
  /** 교체 중 새 세션에서 받은 토큰·끝점 (병합 전 대기) */
  private holding: Array<{ tokens: GlobalToken[]; endpoint: boolean }> = [];
  private overlapStartMs = 0;
  private quietMs = 0;
  private cutResolver: ((cutMs: number) => void) | null = null;
  private lastFinalEndMs = 0;
  /** 옛 세션이 이미 발화로 내보낸 마지막 단어 끝 */
  private emittedEndMs = -Infinity;
  /** 끊김 복구로 다시 보낸 구간 중 이미 확정된 부분을 걸러내는 기준 */
  private replayFilter: { session: number; fromMs: number } | null = null;
  private stopped = false;
  private terms: string[] = [];
  private status: SttManagerStatus = {
    state: "IDLE", sessionNo: 0, rotations: 0, recoveries: 0,
    lastOverlapMs: 0, lastReplayMs: 0, lastMergeDropped: 0, hintTermCount: 0,
  };
  private deps: Required<Omit<SttManagerDeps, "onInterim" | "onStatus">> & Pick<SttManagerDeps, "onInterim" | "onStatus">;

  constructor(deps: SttManagerDeps) {
    this.deps = {
      createSocket: () => new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket") as unknown as SocketLike,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    };
  }

  getStatus(): SttManagerStatus {
    return { ...this.status };
  }

  /** 청취 시작 기준 현재 오디오 위치(ms) */
  get audioMs(): number {
    return this.globalMs;
  }

  private setStatus(patch: Partial<SttManagerStatus>) {
    this.status = { ...this.status, ...patch };
    this.deps.onStatus?.(this.getStatus());
  }

  private newSession(terms: string[]): SonioxSession {
    this.sessionCounter += 1;
    return new SonioxSession(this.sessionCounter, this.deps.apiKey, terms, this.deps.createSocket, {
      onFinal: (s, tokens, endpoint) => this.handleFinal(s, tokens, endpoint),
      onInterim: (s, text) => {
        if (s === this.active) this.deps.onInterim?.(text);
      },
      onDead: (s, reason) => void this.handleDead(s, reason),
    });
  }

  async start(terms: string[]): Promise<boolean> {
    this.stopped = false;
    this.terms = terms;
    this.setStatus({ state: "CONNECTING", hintTermCount: terms.length, message: "Soniox 연결 중" });
    const s = this.newSession(terms);
    const ok = await s.open(this.globalMs, LOGIC_OPUS_LIMITS.ROTATION_OPEN_TIMEOUT_MS, this.deps.setTimer, this.deps.clearTimer);
    if (!ok || this.stopped) {
      s.close();
      if (!this.stopped) this.setStatus({ state: "ERROR", message: "Soniox 연결 실패. API 키와 네트워크를 확인해 주세요." });
      return false;
    }
    this.active = s;
    this.setStatus({ state: "LIVE", sessionNo: s.no, message: "청취 중" });
    return true;
  }

  pushAudio(chunk: ArrayBuffer) {
    if (this.stopped) return;
    const samples = Math.floor(chunk.byteLength / 2);
    const durationMs = (samples / SAMPLE_RATE) * 1000;
    const startMs = this.globalMs;
    this.globalMs += durationMs;
    this.ring.push({ startMs, endMs: this.globalMs, data: chunk });
    while (this.ring.length && this.ring[0].endMs < this.globalMs - LOGIC_OPUS_LIMITS.RING_BUFFER_MS) this.ring.shift();

    const rms = measureRms(chunk);
    this.quietMs = rms < QUIET_RMS ? this.quietMs + durationMs : 0;

    this.active?.send(chunk);
    if (this.candidate?.ready) {
      this.candidate.send(chunk);
      const overlap = this.globalMs - this.overlapStartMs;
      if (this.cutResolver && overlap >= MIN_OVERLAP_MS &&
        (this.quietMs >= LOGIC_OPUS_LIMITS.OVERLAP_SILENCE_MS || overlap >= LOGIC_OPUS_LIMITS.OVERLAP_MAX_MS)) {
        const resolve = this.cutResolver;
        this.cutResolver = null;
        resolve(this.globalMs);
      }
    }
  }

  private handleFinal(s: SonioxSession, tokens: GlobalToken[], endpoint: boolean) {
    if (this.stopped) return;
    if (s === this.candidate) {
      this.holding.push({ tokens, endpoint });
      return;
    }
    if (s !== this.active && s !== this.draining) return;
    if (this.replayFilter?.session === s.no) {
      const from = this.replayFilter.fromMs;
      tokens = tokens.filter((t) => t.startMs >= from - 40);
    }
    this.pending.push(...tokens);
    if (tokens.length) this.lastFinalEndMs = Math.max(this.lastFinalEndMs, ...tokens.map((t) => t.endMs));
    // 교체 중인 옛 세션의 끝점은 병합 뒤에 처리한다
    if (s === this.draining) return;
    if (endpoint || joinTokens(this.pending).length >= MAX_UTTERANCE_CHARS) this.flushUtterance();
  }

  private flushUtterance() {
    const tokens = this.pending;
    this.pending = [];
    const text = joinTokens(tokens);
    if (!text) return;
    this.emittedEndMs = Math.max(this.emittedEndMs, ...tokens.map((t) => t.endMs));
    this.deps.onUtterance({
      text,
      audioStartMs: Math.min(...tokens.map((t) => t.startMs)),
      audioEndMs: Math.max(...tokens.map((t) => t.endMs)),
      sessionNo: tokens[tokens.length - 1].session,
    });
  }

  /**
   * 새 힌트 단어로 세션을 교체한다. 실패하면 기존 세션을 그대로 쓴다.
   */
  async rotate(terms: string[]): Promise<boolean> {
    if (this.stopped || !this.active || this.candidate || this.draining) return false;
    const old = this.active;
    const next = this.newSession(terms);
    this.candidate = next;
    this.holding = [];
    this.setStatus({ state: "ROTATING", message: `세션 #${next.no} 준비 중 (힌트 ${terms.length}개)` });
    const ok = await next.open(this.globalMs, LOGIC_OPUS_LIMITS.ROTATION_OPEN_TIMEOUT_MS, this.deps.setTimer, this.deps.clearTimer);
    if (!ok || this.stopped || this.active !== old) {
      next.close();
      if (this.candidate === next) this.candidate = null;
      if (!this.stopped) this.setStatus({ state: "LIVE", message: "새 세션 연결 실패 — 기존 세션 유지" });
      return false;
    }
    // 이 시점부터 같은 오디오가 두 세션에 함께 간다
    next.offsetMs = this.globalMs;
    this.overlapStartMs = this.globalMs;
    const cutMs = await new Promise<number>((resolve) => {
      this.cutResolver = resolve;
      // 오디오가 멈춘 경우에도 끝나도록 안전장치
      this.deps.setTimer(() => {
        if (this.cutResolver === resolve) {
          this.cutResolver = null;
          resolve(this.globalMs);
        }
      }, LOGIC_OPUS_LIMITS.OVERLAP_MAX_MS + 2000);
    });
    if (this.stopped) return false;
    // 옛 세션은 더 이상 오디오를 받지 않는다
    this.active = next;
    this.candidate = null;
    this.draining = old;
    await old.drain(DRAIN_TIMEOUT_MS, this.deps.setTimer, this.deps.clearTimer);
    old.close();
    this.draining = null;
    if (this.stopped) return false;

    const aTokens = this.pending;
    const bHeld = this.holding;
    this.holding = [];
    const merged = mergeRotationTokens(aTokens, bHeld.flatMap((h) => h.tokens), cutMs, this.emittedEndMs);
    this.pending = merged.keptA;
    // 옛 세션 몫은 하나의 발화로 마무리
    const keptB = new Set(merged.keptB);
    this.flushUtterance();
    for (const h of bHeld) {
      const kept = h.tokens.filter((t) => keptB.has(t));
      this.pending.push(...kept);
      if (h.endpoint && this.pending.length) this.flushUtterance();
    }
    if (merged.keptB.length) this.lastFinalEndMs = Math.max(this.lastFinalEndMs, ...merged.keptB.map((t) => t.endMs));
    this.terms = terms;
    this.setStatus({
      state: "LIVE",
      sessionNo: next.no,
      rotations: this.status.rotations + 1,
      lastOverlapMs: Math.round(cutMs - this.overlapStartMs),
      lastMergeDropped: merged.droppedA + merged.droppedB,
      hintTermCount: terms.length,
      message: `세션 #${next.no}로 교체 완료`,
    });
    return true;
  }

  private async handleDead(s: SonioxSession, reason: string) {
    if (this.stopped) return;
    if (s === this.candidate || s === this.draining) return; // 교체 흐름에서 처리
    if (s !== this.active) return;
    // 겹침 교체 중 옛 세션이 끊기면, 이미 같은 오디오를 듣고 있는 새 세션으로 바로 넘긴다
    if (this.candidate?.ready && this.cutResolver) {
      const resolve = this.cutResolver;
      this.cutResolver = null;
      resolve(this.globalMs);
      return;
    }
    this.active = null;
    s.close();
    // 끊긴 세션에 남은 확정 단어는 발화로 내보낸다
    this.flushUtterance();
    const fromMs = Math.max(0, this.lastFinalEndMs - 300);
    for (let attempt = 1; attempt <= 3 && !this.stopped; attempt++) {
      this.setStatus({ state: "RECOVERING", message: `${reason} — 재연결 ${attempt}회차` });
      const next = this.newSession(this.terms);
      const replay = this.ring.filter((c) => c.endMs > fromMs);
      const offset = replay.length ? replay[0].startMs : this.globalMs;
      const ok = await next.open(offset, LOGIC_OPUS_LIMITS.ROTATION_OPEN_TIMEOUT_MS, this.deps.setTimer, this.deps.clearTimer);
      if (!ok || this.stopped) {
        next.close();
        continue;
      }
      // 링버퍼에서 마지막 확정 단어 이후 오디오를 먼저 보내고 실시간으로 이어간다
      const toSend = this.ring.filter((c) => c.startMs >= offset);
      toSend.forEach((c) => next.send(c.data));
      next.offsetMs = offset;
      // 다시 들은 구간 중 이미 확정된 단어와 겹치는 부분은 버린다
      this.replayFilter = { session: next.no, fromMs: this.lastFinalEndMs };
      this.active = next;
      const replayMs = toSend.length ? toSend[toSend.length - 1].endMs - toSend[0].startMs : 0;
      this.setStatus({
        state: "LIVE",
        sessionNo: next.no,
        recoveries: this.status.recoveries + 1,
        lastReplayMs: Math.round(replayMs),
        message: `재연결 완료 (오디오 ${Math.round(replayMs / 100) / 10}초 다시 보냄)`,
      });
      return;
    }
    if (!this.stopped) this.setStatus({ state: "ERROR", message: `${reason} — 재연결 실패. 청취를 다시 시작해 주세요.` });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    const active = this.active;
    if (active) {
      this.draining = active;
      this.active = null;
      await active.drain(1500, this.deps.setTimer, this.deps.clearTimer);
      this.draining = null;
    }
    this.flushUtterance();
    this.stopped = true;
    active?.close();
    this.candidate?.close();
    this.candidate = null;
    this.ring = [];
    this.setStatus({ state: "STOPPED", message: "청취 중지" });
  }
}

export function measureRms(chunk: ArrayBuffer): number {
  const count = Math.floor(chunk.byteLength / 2);
  if (!count) return 0;
  const pcm = new Int16Array(chunk, 0, count);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pcm.length; i += 8) {
    const v = pcm[i] / 32768;
    sum += v * v;
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : 0;
}
