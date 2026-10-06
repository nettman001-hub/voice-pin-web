import { isSupabaseConfigured, requireSupabase } from "../supabaseClient";
import type {
  LogicOpusJudgeRequest,
  LogicOpusJudgeResponse,
  LogicOpusRunSummary,
  LogicOpusSale,
  LogicOpusSalesMode,
  LogicOpusSlot,
  LogicOpusSlotInfo,
} from "../../types/logicOpus";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class LogicOpusApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "LogicOpusApiError";
  }
}

async function invoke<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isSupabaseConfigured) throw new LogicOpusApiError("서버 연결 설정이 없습니다.");
  const { data, error } = await requireSupabase().functions.invoke<Envelope<T>>("sales-api", {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message;
    let code: string | undefined;
    try {
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        const body = await context.json() as Envelope<unknown>;
        message = body.error?.message || message;
        code = body.error?.code;
      }
    } catch {
      /* 서버 응답 본문이 없으면 전송 오류를 그대로 쓴다 */
    }
    throw new LogicOpusApiError(message || "서버에 연결하지 못했습니다.", code);
  }
  if (!data?.ok || !data.data) {
    throw new LogicOpusApiError(data?.error?.message || "요청을 처리하지 못했습니다.", data?.error?.code);
  }
  return data.data;
}

export const logicOpusApi = {
  slots: () =>
    invoke<{ slots: LogicOpusSlotInfo[]; primarySlot: LogicOpusSlot; autoFallbackEnabled: boolean }>("logic-opus-slots"),
  startRun: (p: {
    mode: "LIVE" | "REPLAY";
    broadcastUsername: string;
    slotNumber: LogicOpusSlot;
    salesMode: LogicOpusSalesMode;
    sellerNicknames: string[];
    settings?: Record<string, unknown>;
  }) => invoke<{ runId: string; startedAt: string }>("logic-opus-run-start", p),
  endRun: (runId: string) => invoke<{ runId: string; endedAt: string }>("logic-opus-run-end", { runId }),
  judge: (request: LogicOpusJudgeRequest) => invoke<LogicOpusJudgeResponse>("logic-opus-judge", { request }),
  pronounce: (slotNumber: LogicOpusSlot, nicknames: string[], autoFallback: boolean) =>
    invoke<{ pronunciations: Record<string, string[]> }>("logic-opus-pronounce", { slotNumber, nicknames, autoFallback }),
  saveLedger: (runId: string, sales: LogicOpusSale[], allSales: LogicOpusSale[]) =>
    invoke<{ saved: number }>("logic-opus-ledger-save", { runId, sales, allSales }),
  listRuns: () => invoke<{ runs: LogicOpusRunSummary[] }>("logic-opus-run-list"),
  getRun: (runId: string) => invoke<{ run: Record<string, unknown>; sales: LogicOpusSale[] }>("logic-opus-run-get", { runId }),
};
