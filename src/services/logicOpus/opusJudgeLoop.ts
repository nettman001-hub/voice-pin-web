import type {
  LogicOpusClassification,
  LogicOpusEvent,
  LogicOpusJudgeRequest,
  LogicOpusJudgeResponse,
  LogicOpusOpenIntent,
  LogicOpusProductState,
  LogicOpusSale,
  LogicOpusSalesMode,
  LogicOpusSlot,
  LogicOpusSpokenNameCandidates,
} from "../../types/logicOpus.ts";
import { LOGIC_OPUS_LIMITS } from "../../types/logicOpus.ts";
import { applyJudgement, applyManualEdit, type LedgerApplyResult } from "./opusLedger.ts";
import { findSpokenNameCandidates } from "./opusNicknameCandidates.ts";
import { buildHintTerms, type HintTermResult } from "./opusHintPlanner.ts";
import { needsPronunciation } from "./opusPrompt.ts";

/**
 * 실시간 판단 루프.
 * 새 댓글·멘트를 1.2초 단위로 묶어 AI에게 보내고, 결과를 판매 원장에 반영한다.
 * 한 번에 한 요청만 보내고, 그동안 들어온 이벤트는 다음 묶음으로 합친다.
 */

export interface JudgeLoopConfig {
  runId: string;
  slotNumber: LogicOpusSlot;
  autoFallback: boolean;
  salesMode: LogicOpusSalesMode;
  sellerNicknames: string[];
}

export interface JudgeLoopDeps {
  judge: (req: LogicOpusJudgeRequest) => Promise<LogicOpusJudgeResponse>;
  pronounce?: (nicknames: string[]) => Promise<Record<string, string[]>>;
  /** 원장 변경 알림 (인쇄할 판매 id 포함) */
  onLedger: (result: LedgerApplyResult) => void;
  onChange?: () => void;
  /** AI가 구매의사를 감지해 STT 힌트 갱신이 필요할 때 */
  /** 새 구매의사자(처음 구매의사를 밝힌 닉네임)가 감지됐을 때 */
  onHintRequest?: (newPurchasers: string[]) => void;
  onError?: (message: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  debounceMs?: number;
}

export interface JudgeLogEntry {
  at: string;
  newEvents: number;
  usedSlot: LogicOpusSlot | null;
  latencyMs: number;
  ops: number;
  error?: string;
  attempts: LogicOpusJudgeResponse["attempts"];
}

const ms = (iso: string) => Date.parse(iso) || 0;

export class OpusJudgeLoop {
  events: LogicOpusEvent[] = [];
  classifications = new Map<string, LogicOpusClassification>();
  productState: LogicOpusProductState | null = null;
  sales: LogicOpusSale[] = [];
  pronunciations: Record<string, string[]> = {};
  log: JudgeLogEntry[] = [];
  /** 닉네임 → 마지막 댓글 시각 */
  private lastSeen = new Map<string, number>();
  private intentOrder: string[] = [];
  private pendingIds: string[] = [];
  private retries = new Map<string, number>();
  private inflight: Promise<void> | null = null;
  private timer: unknown = null;
  private pronounceQueue = new Set<string>();
  private pronounceAsked = new Set<string>();
  private pronounceTimer: unknown = null;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];
  private config: JudgeLoopConfig;
  private deps: JudgeLoopDeps;

  constructor(config: JudgeLoopConfig, deps: JudgeLoopDeps) {
    this.config = config;
    this.deps = deps;
  }

  private setTimer(fn: () => void, wait: number) {
    return (this.deps.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, wait);
  }

  private clearTimer(h: unknown) {
    (this.deps.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h);
  }

  updateConfig(patch: Partial<JudgeLoopConfig>) {
    this.config = { ...this.config, ...patch };
  }

  get knownNicknames(): string[] {
    return [...this.lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }

  get intentNicknames(): string[] {
    return [...this.intentOrder];
  }

  addEvent(e: LogicOpusEvent) {
    if (this.stopped || this.events.some((x) => x.id === e.id)) return;
    this.events.push(e);
    if (e.kind === "COMMENT") {
      this.lastSeen.set(e.nickname, Math.max(this.lastSeen.get(e.nickname) || 0, ms(e.at)));
      if (needsPronunciation(e.nickname) && !this.pronounceAsked.has(e.nickname) && this.deps.pronounce) {
        this.pronounceQueue.add(e.nickname);
        this.schedulePronounce();
      }
    }
    this.pendingIds.push(e.id);
    this.deps.onChange?.();
    this.schedule(this.deps.debounceMs ?? LOGIC_OPUS_LIMITS.JUDGE_DEBOUNCE_MS);
  }

  private schedulePronounce() {
    if (this.pronounceTimer !== null) return;
    this.pronounceTimer = this.setTimer(async () => {
      this.pronounceTimer = null;
      const batch = [...this.pronounceQueue].slice(0, 40);
      batch.forEach((n) => {
        this.pronounceQueue.delete(n);
        this.pronounceAsked.add(n);
      });
      if (!batch.length || !this.deps.pronounce) return;
      try {
        const map = await this.deps.pronounce(batch);
        this.pronunciations = { ...this.pronunciations, ...map };
        this.deps.onChange?.();
      } catch (e) {
        batch.forEach((n) => this.pronounceAsked.delete(n));
        this.deps.onError?.(`닉네임 발음 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (this.pronounceQueue.size) this.schedulePronounce();
    }, 2000);
  }

  private schedule(wait: number) {
    if (this.stopped || this.inflight || this.timer !== null || !this.pendingIds.length) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.inflight = this.runOnce().finally(() => {
        this.inflight = null;
        if (this.pendingIds.length) this.schedule(0);
        else this.notifyIdle();
      });
    }, wait);
  }

  private notifyIdle() {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    w.forEach((f) => f());
  }

  /** 대기 중인 이벤트를 즉시 판단하고 모두 끝날 때까지 기다린다 (재생 테스트용) */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    while (!this.stopped && (this.pendingIds.length || this.inflight)) {
      if (this.inflight) {
        await this.inflight;
        continue;
      }
      this.inflight = this.runOnce().finally(() => {
        this.inflight = null;
      });
      await this.inflight;
    }
  }

  private eventById(id: string) {
    return this.events.find((e) => e.id === id);
  }

  buildRequest(newEvents: LogicOpusEvent[]): LogicOpusJudgeRequest {
    const batchStart = Math.min(...newEvents.map((e) => ms(e.at)));
    const batchEnd = Math.max(...newEvents.map((e) => ms(e.at)));
    const newIds = new Set(newEvents.map((e) => e.id));
    const recentEvents = this.events.filter((e) =>
      !newIds.has(e.id) && ms(e.at) >= batchStart - LOGIC_OPUS_LIMITS.RECENT_WINDOW_MS && this.classifications.has(e.id)
    );
    const openIntents: LogicOpusOpenIntent[] = [];
    for (const e of this.events) {
      if (e.kind !== "COMMENT" || ms(e.at) < batchEnd - LOGIC_OPUS_LIMITS.RECENT_WINDOW_MS) continue;
      const c = this.classifications.get(e.id);
      if (c?.type !== "PURCHASE_INTENT") continue;
      const served = this.sales.some((s) => s.buyerNickname === e.nickname && s.status !== "CANCELLED" && ms(s.createdAt) >= ms(e.at));
      if (!served) openIntents.push({ eventId: e.id, nickname: e.nickname, text: e.text, at: e.at, target: c.target });
    }
    const intentSet = new Set(openIntents.map((i) => i.nickname));
    const candidatePool = [...this.lastSeen.entries()]
      .filter(([, t]) => t >= batchEnd - LOGIC_OPUS_LIMITS.CANDIDATE_WINDOW_MS)
      .filter(([n]) => !this.config.sellerNicknames.includes(n))
      .map(([nickname, lastAt]) => ({
        nickname,
        lastAt,
        recentIntent: intentSet.has(nickname),
        pronunciations: this.pronunciations[nickname],
      }));
    const nicknameCandidates: LogicOpusSpokenNameCandidates[] = newEvents
      .filter((e) => e.kind === "SPEECH")
      .flatMap((e) => findSpokenNameCandidates(e.id, e.text, candidatePool));
    return {
      runId: this.config.runId,
      slotNumber: this.config.slotNumber,
      autoFallback: this.config.autoFallback,
      salesMode: this.config.salesMode,
      sellerNicknames: this.config.sellerNicknames,
      newEvents,
      recentEvents: recentEvents.slice(-LOGIC_OPUS_LIMITS.MAX_RECENT_EVENTS),
      productState: this.productState,
      openIntents: openIntents.slice(-40),
      ledger: this.sales.slice(-LOGIC_OPUS_LIMITS.MAX_LEDGER_CONTEXT).map((s) => ({
        id: s.id,
        buyerNickname: s.buyerNickname,
        product: s.product,
        option: s.option,
        price: s.price,
        quantity: s.quantity,
        status: s.status,
        createdAt: s.createdAt,
      })),
      nicknameCandidates,
      knownNicknames: this.knownNicknames.slice(0, 300),
    };
  }

  private async runOnce(): Promise<void> {
    const ids = this.pendingIds.splice(0, LOGIC_OPUS_LIMITS.MAX_NEW_EVENTS);
    const newEvents = ids.map((id) => this.eventById(id)).filter((e): e is LogicOpusEvent => !!e)
      .sort((a, b) => ms(a.at) - ms(b.at));
    if (!newEvents.length) return;
    const request = this.buildRequest(newEvents);
    const started = Date.now();
    let response: LogicOpusJudgeResponse;
    try {
      response = await this.deps.judge(request);
    } catch (e) {
      response = { judgement: null, usedSlot: null, attempts: [], error: e instanceof Error ? e.message : String(e) };
    }
    if (this.stopped) return;
    const entry: JudgeLogEntry = {
      at: new Date().toISOString(),
      newEvents: newEvents.length,
      usedSlot: response.usedSlot,
      latencyMs: Date.now() - started,
      ops: response.judgement?.ledgerOps.length ?? 0,
      error: response.error,
      attempts: response.attempts,
    };
    this.log = [...this.log.slice(-99), entry];
    const judgement = response.judgement;
    if (!judgement) {
      // 한 번은 다음 묶음에 다시 넣고, 두 번째 실패면 판단 없이 문맥에만 남긴다
      const retry = ids.filter((id) => (this.retries.get(id) || 0) < 1);
      retry.forEach((id) => this.retries.set(id, (this.retries.get(id) || 0) + 1));
      this.pendingIds.unshift(...retry);
      this.deps.onError?.(response.error || "AI 판단 실패");
      this.deps.onChange?.();
      return;
    }
    const newPurchasers: string[] = [];
    for (const c of judgement.classifications) {
      if (!this.eventById(c.eventId)) continue;
      this.classifications.set(c.eventId, c);
      const ev = this.eventById(c.eventId);
      if (c.type === "PURCHASE_INTENT" && ev?.kind === "COMMENT") {
        if (!this.intentOrder.includes(ev.nickname) && !newPurchasers.includes(ev.nickname) &&
          !this.config.sellerNicknames.includes(ev.nickname)) newPurchasers.push(ev.nickname);
        this.intentOrder = [ev.nickname, ...this.intentOrder.filter((n) => n !== ev.nickname)].slice(0, 200);
      }
    }
    // 분류가 빠진 이벤트는 잡담으로 둔다 (문맥에는 남김)
    for (const e of newEvents) {
      if (!this.classifications.has(e.id)) this.classifications.set(e.id, { eventId: e.id, type: "CHATTER", confidence: 0 });
    }
    if (judgement.productState) this.productState = judgement.productState;
    const result = applyJudgement(this.sales, judgement, {
      now: newEvents[newEvents.length - 1].at,
      knownNicknames: this.knownNicknames,
      sellerNicknames: this.config.sellerNicknames,
    });
    this.sales = result.sales;
    if (result.changedIds.length || result.rejected.length) this.deps.onLedger(result);
    // 같은 사람이 다시 구매의사를 밝힌 것은 힌트가 바뀌지 않으므로 요청하지 않는다
    if (newPurchasers.length) this.deps.onHintRequest?.(newPurchasers);
    this.deps.onChange?.();
  }

  manualEdit(saleId: string, edit: Parameters<typeof applyManualEdit>[2], now = new Date().toISOString()) {
    const result = applyManualEdit(this.sales, saleId, edit, {
      now,
      knownNicknames: this.knownNicknames,
      sellerNicknames: this.config.sellerNicknames,
    });
    this.sales = result.sales;
    this.deps.onLedger(result);
    this.deps.onChange?.();
    return result;
  }

  updateSale(saleId: string, patch: Partial<LogicOpusSale>) {
    this.sales = this.sales.map((s) => (s.id === saleId ? { ...s, ...patch } : s));
    this.deps.onChange?.();
  }

  hintTerms(fixedWords: string[]): HintTermResult {
    return buildHintTerms({
      fixedWords,
      recentNicknames: this.knownNicknames.filter((n) => !this.config.sellerNicknames.includes(n)),
      intentNicknames: this.intentOrder.filter((n) => !this.config.sellerNicknames.includes(n)),
      pronunciations: this.pronunciations,
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    if (this.pronounceTimer !== null) this.clearTimer(this.pronounceTimer);
    this.timer = null;
    this.pronounceTimer = null;
    this.notifyIdle();
  }
}
