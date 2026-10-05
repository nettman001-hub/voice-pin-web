import { LOGIC_OPUS_LIMITS } from "../../types/logicOpus.ts";
import { plainForm } from "./opusNicknameCandidates.ts";

/**
 * STT 힌트 단어 구성과 세션 교체 간격 조절.
 * - 구매의사를 보인 닉네임을 먼저, 그다음 최근 댓글 닉네임 순으로 최대 50명
 * - 영어·이모지 닉네임은 AI가 만든 한국어 발음을 함께 넣는다
 * - 교체 요청은 최소 5초 간격으로 모아서 한 번에 처리한다
 */

export interface HintTermInput {
  fixedWords: string[];
  /** 최근 댓글 작성자, 최신 순 */
  recentNicknames: string[];
  /** 구매의사 댓글 작성자, 최신 순 */
  intentNicknames: string[];
  pronunciations: Record<string, string[]>;
  maxNicknames?: number;
  maxTerms?: number;
}

export interface HintTermResult {
  terms: string[];
  nicknames: string[];
}

function isSpeakable(nickname: string): boolean {
  // 이모지·기호만 있는 닉네임은 원문을 보내도 STT에 의미가 없다
  return /[\p{L}\p{N}]/u.test(plainForm(nickname));
}

export function buildHintTerms(input: HintTermInput): HintTermResult {
  const maxNicknames = input.maxNicknames ?? LOGIC_OPUS_LIMITS.HINT_NICKNAMES;
  const maxTerms = input.maxTerms ?? LOGIC_OPUS_LIMITS.HINT_TERMS;
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (word: string) => {
    const w = word.replace(/[\u0000-\u001f]/g, " ").trim().replace(/\s+/g, " ");
    if (!w || [...w].length > 40 || terms.length >= maxTerms) return;
    const key = w.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(w);
  };
  for (const w of input.fixedWords) push(w);

  const ordered: string[] = [];
  const added = new Set<string>();
  for (const n of [...input.intentNicknames, ...input.recentNicknames]) {
    const key = plainForm(n) || n;
    if (!n || added.has(key)) continue;
    added.add(key);
    ordered.push(n);
    if (ordered.length >= maxNicknames) break;
  }
  const nicknames: string[] = [];
  for (const n of ordered) {
    if (terms.length >= maxTerms) break;
    const before = terms.length;
    if (isSpeakable(n)) push(n.replace(/\p{Extended_Pictographic}|️|‍/gu, "").trim() || n);
    for (const p of input.pronunciations[n] || []) push(p);
    if (terms.length > before) nicknames.push(n);
  }
  return { terms, nicknames };
}

export interface HintSchedulerDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** 실제 세션 교체. 성공 여부를 돌려준다 */
  rotate: () => Promise<boolean>;
  minIntervalMs?: number;
  onSkip?: (waitMs: number) => void;
}

/**
 * 구매의사가 몰려도 교체는 minInterval(기본 5초)에 한 번만 시작한다.
 * 대기 중에 들어온 요청은 하나로 합쳐지고, 교체가 시작되는 순간의 최신 닉네임을 쓴다.
 */
export class HintRotationScheduler {
  private lastStartAt = -Infinity;
  private busy = false;
  private pending = false;
  private timer: unknown = null;
  private stopped = false;
  readonly starts: number[] = [];
  private deps: HintSchedulerDeps;

  constructor(deps: HintSchedulerDeps) {
    this.deps = deps;
  }

  private get interval() {
    return this.deps.minIntervalMs ?? LOGIC_OPUS_LIMITS.HINT_MIN_INTERVAL_MS;
  }

  request(): void {
    if (this.stopped) return;
    this.pending = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.busy || this.timer !== null || !this.pending || this.stopped) return;
    const wait = Math.max(0, this.lastStartAt + this.interval - this.deps.now());
    if (wait > 0) this.deps.onSkip?.(wait);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run();
    }, wait);
  }

  private async run(): Promise<void> {
    if (this.busy || !this.pending || this.stopped) return;
    this.busy = true;
    this.pending = false;
    this.lastStartAt = this.deps.now();
    this.starts.push(this.lastStartAt);
    let ok = false;
    try {
      ok = await this.deps.rotate();
    } catch {
      ok = false;
    } finally {
      this.busy = false;
    }
    if (!ok) this.pending = true; // 실패하면 다음 간격에 다시 시도
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }
}
