import { admin, type AuthContext, successResponse } from "../../_shared/productSales.ts";
import type {
  LogicOpusAttempt,
  LogicOpusJudgeRequest,
  LogicOpusJudgement,
  LogicOpusSale,
  LogicOpusSlot,
  LogicOpusSlotInfo,
} from "../../../../src/types/logicOpus.ts";
import { LOGIC_OPUS_LIMITS } from "../../../../src/types/logicOpus.ts";
import {
  buildJudgeRepairPrompt,
  buildJudgeUserPrompt,
  buildPronounceUserPrompt,
  LOGIC_OPUS_PRONOUNCE_SYSTEM_PROMPT,
  LOGIC_OPUS_SYSTEM_PROMPT,
  parseJudgement,
  parsePronunciations,
} from "../../../../src/services/logicOpus/opusPrompt.ts";
import { getOperationalAiSetting } from "./aiOperationalSettings.ts";
import { executeAiPrompt } from "./aiAdapters/index.ts";
import { requireAnalysisAdmin } from "./workflowAuthorization.ts";

/**
 * 판매자 로직분석01opus 서버 액션 (관리자 전용).
 * AI 호출은 관리자 대시보드의 슬롯1/슬롯2 설정(운영 적용본)과 비밀키를 그대로 쓴다.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: string, message: string, status = 400): never {
  throw { code, message, status };
}

function slotOf(value: unknown): LogicOpusSlot {
  if (value !== 1 && value !== 2) fail("VALIDATION_ERROR", "AI 슬롯은 1번 또는 2번을 선택해 주세요.");
  return value;
}

function runIdOf(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail("VALIDATION_ERROR", "기록 ID가 올바르지 않습니다.");
  return value;
}

async function loadSlots() {
  const setting = await getOperationalAiSetting();
  if (!setting) fail("AI_NOT_CONFIGURED", "관리자 대시보드에서 AI 설정을 먼저 운영에 적용해 주세요.", 409);
  const { data: secrets, error } = await admin.from("ai_secrets").select("slot_number,secret_value").eq(
    "setting_id",
    setting.id,
  );
  if (error) throw error;
  return { setting, secrets: secrets || [] };
}

function slotInfo(setting: any, secrets: any[], slot: LogicOpusSlot): LogicOpusSlotInfo {
  const config = setting[`slot${slot}`] || {};
  const hasSecret = secrets.some((s) => s.slot_number === slot && s.secret_value);
  let ready = Boolean(config.model && config.provider);
  let note: string | undefined;
  if (config.type === "LOCAL" && config.routingMode === "PC_HELPER") {
    ready = false;
    note = "PC 도우미 경유 슬롯은 서버에서 직접 호출할 수 없습니다.";
  } else if (config.type === "CLOUD" && config.authType !== "NONE" && !hasSecret) {
    ready = false;
    note = "API 키가 저장되지 않았습니다.";
  }
  return { slot, type: config.type || "", provider: config.provider || "", model: config.model || "", ready, note };
}

interface PromptRun<T> {
  value: T | null;
  attempts: LogicOpusAttempt[];
  usedSlot: LogicOpusSlot | null;
}

/** 선택한 슬롯 → (자동 전환이면) 다른 슬롯. 형식 오류는 같은 슬롯에서 1회 교정 요청. */
async function runWithSlots<T>(
  setting: any,
  secrets: any[],
  primary: LogicOpusSlot,
  autoFallback: boolean,
  systemPrompt: string,
  userPrompt: string,
  parse: (content: string) => T,
  timeoutSeconds: number,
): Promise<PromptRun<T>> {
  const attempts: LogicOpusAttempt[] = [];
  const order: LogicOpusSlot[] = autoFallback ? [primary, primary === 1 ? 2 : 1] : [primary];
  for (const slot of order) {
    const config = setting[`slot${slot}`];
    if (!config?.model) {
      attempts.push({ slot, provider: config?.provider || "", model: "", latencyMs: 0, error: "슬롯 설정 없음", errorCode: "NOT_CONFIGURED" });
      continue;
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    let prompt = userPrompt;
    for (let round = 0; round < 2; round++) {
      const remaining = (deadline - Date.now()) / 1000;
      if (remaining < 2) break;
      const started = Date.now();
      const result = await executeAiPrompt({ systemPrompt, userPrompt: prompt }, {
        slotConfig: { ...config, timeoutSeconds: remaining },
        secretValue: secrets.find((s) => s.slot_number === slot)?.secret_value,
      });
      const attempt: LogicOpusAttempt = {
        slot,
        provider: config.provider,
        model: config.model,
        latencyMs: Date.now() - started,
      };
      if (!result.content) {
        attempt.error = result.error || "AI 응답 없음";
        attempt.errorCode = result.errorCode || "PROVIDER_ERROR";
        attempts.push(attempt);
        break;
      }
      try {
        const value = parse(result.content);
        attempts.push(attempt);
        return { value, attempts, usedSlot: slot };
      } catch (e) {
        attempt.error = e instanceof Error ? e.message : String(e);
        attempt.errorCode = "INVALID_FORMAT";
        attempts.push(attempt);
        prompt = buildJudgeRepairPrompt(userPrompt, result.content, attempt.error);
      }
    }
  }
  return { value: null, attempts, usedSlot: null };
}

function trimRequest(req: LogicOpusJudgeRequest): LogicOpusJudgeRequest {
  const arr = <T>(v: T[] | undefined, n: number) => (Array.isArray(v) ? v.slice(-n) : []);
  return {
    ...req,
    newEvents: arr(req.newEvents, LOGIC_OPUS_LIMITS.MAX_NEW_EVENTS),
    recentEvents: arr(req.recentEvents, LOGIC_OPUS_LIMITS.MAX_RECENT_EVENTS),
    ledger: arr(req.ledger, LOGIC_OPUS_LIMITS.MAX_LEDGER_CONTEXT),
    openIntents: arr(req.openIntents, 40),
    nicknameCandidates: arr(req.nicknameCandidates, 30),
    knownNicknames: arr(req.knownNicknames, 300),
    sellerNicknames: arr(req.sellerNicknames, 10),
  };
}

function totals(sales: LogicOpusSale[]) {
  const live = sales.filter((s) => s.status === "CONFIRMED");
  return {
    sale_count: live.length,
    total_amount: live.reduce((sum, s) => sum + (s.price ?? 0) * (s.quantity || 1), 0),
  };
}

export async function handleLogicOpus(auth: AuthContext, body: any) {
  requireAnalysisAdmin(auth);
  const now = new Date().toISOString();

  switch (body.action) {
    case "logic-opus-slots": {
      const { setting, secrets } = await loadSlots();
      return successResponse({
        slots: [slotInfo(setting, secrets, 1), slotInfo(setting, secrets, 2)],
        primarySlot: setting.primary_slot === 2 ? 2 : 1,
        autoFallbackEnabled: setting.auto_fallback_enabled !== false,
      });
    }

    case "logic-opus-run-start": {
      const slot = slotOf(body.slotNumber);
      const { data, error } = await admin.from("logic_opus_runs").insert({
        mode: body.mode === "REPLAY" ? "REPLAY" : "LIVE",
        broadcast_username: String(body.broadcastUsername || "").slice(0, 100),
        slot_number: slot,
        sales_mode: String(body.salesMode || "AUTO").slice(0, 30),
        seller_nicknames: Array.isArray(body.sellerNicknames) ? body.sellerNicknames.slice(0, 10) : [],
        settings: body.settings && typeof body.settings === "object" ? body.settings : {},
        created_by: auth.actorId,
      }).select("id,started_at").single();
      if (error) throw error;
      return successResponse({ runId: data.id, startedAt: data.started_at });
    }

    case "logic-opus-run-end": {
      const runId = runIdOf(body.runId);
      const { error } = await admin.from("logic_opus_runs").update({ ended_at: now, updated_at: now }).eq("id", runId);
      if (error) throw error;
      return successResponse({ runId, endedAt: now });
    }

    case "logic-opus-judge": {
      const req = trimRequest(body.request as LogicOpusJudgeRequest);
      const runId = runIdOf(req?.runId);
      const slot = slotOf(req.slotNumber);
      if (!req.newEvents.length) fail("VALIDATION_ERROR", "판단할 새 이벤트가 없습니다.");
      const { setting, secrets } = await loadSlots();
      const run = await runWithSlots<LogicOpusJudgement>(
        setting,
        secrets,
        slot,
        req.autoFallback !== false,
        LOGIC_OPUS_SYSTEM_PROMPT,
        buildJudgeUserPrompt(req),
        parseJudgement,
        LOGIC_OPUS_LIMITS.JUDGE_TIMEOUT_SECONDS,
      );
      const byId = new Map((run.value?.classifications || []).map((c) => [c.eventId, c]));
      const rows = req.newEvents.map((e) => {
        const c = byId.get(e.id);
        return {
          run_id: runId,
          event_id: e.id,
          kind: e.kind,
          occurred_at: e.at,
          nickname: e.kind === "COMMENT" ? e.nickname : null,
          body: e.text.slice(0, 2000),
          classification: c?.type ?? null,
          classification_target: c?.target ?? null,
          classification_confidence: c?.confidence ?? null,
          judged_slot: run.usedSlot,
        };
      });
      // 기록 실패가 실시간 판단을 막지 않도록 결과는 그대로 돌려준다
      const { error } = await admin.from("logic_opus_events").upsert(rows, { onConflict: "run_id,event_id" });
      if (error) console.warn("[logic-opus] 이벤트 기록 실패", error.message);
      return successResponse({
        judgement: run.value,
        usedSlot: run.usedSlot,
        attempts: run.attempts,
        error: run.value ? undefined : run.attempts.map((a) => `${a.slot}번슬롯: ${a.error}`).join(" / ") || "AI 판단 실패",
      });
    }

    case "logic-opus-pronounce": {
      const slot = slotOf(body.slotNumber);
      const nicknames = (Array.isArray(body.nicknames) ? body.nicknames : [])
        .filter((n: unknown) => typeof n === "string" && n.trim())
        .slice(0, 40);
      if (!nicknames.length) return successResponse({ pronunciations: {} });
      const { setting, secrets } = await loadSlots();
      const run = await runWithSlots(
        setting,
        secrets,
        slot,
        body.autoFallback !== false,
        LOGIC_OPUS_PRONOUNCE_SYSTEM_PROMPT,
        buildPronounceUserPrompt(nicknames),
        parsePronunciations,
        LOGIC_OPUS_LIMITS.JUDGE_TIMEOUT_SECONDS,
      );
      return successResponse({ pronunciations: run.value || {}, attempts: run.attempts });
    }

    case "logic-opus-ledger-save": {
      const runId = runIdOf(body.runId);
      const sales = (Array.isArray(body.sales) ? body.sales : []).slice(0, 2000) as LogicOpusSale[];
      if (sales.length) {
        const rows = sales.map((s) => ({
          run_id: runId,
          sale_id: String(s.id).slice(0, 40),
          seq: Number(s.seq) || 0,
          status: s.status,
          buyer_nickname: String(s.buyerNickname || "").slice(0, 120),
          product: String(s.product || "").slice(0, 200),
          option: s.option ? String(s.option).slice(0, 120) : null,
          price: typeof s.price === "number" ? Math.round(s.price) : null,
          quantity: Number(s.quantity) || 1,
          confidence: Number(s.confidence) || 0,
          print_status: s.printStatus || "NOT_REQUESTED",
          document: s,
          created_at: s.createdAt,
          updated_at: now,
        }));
        const { error } = await admin.from("logic_opus_ledger").upsert(rows, { onConflict: "run_id,sale_id" });
        if (error) throw error;
      }
      const all = Array.isArray(body.allSales) ? body.allSales as LogicOpusSale[] : sales;
      const { error } = await admin.from("logic_opus_runs").update({ ...totals(all), updated_at: now }).eq("id", runId);
      if (error) throw error;
      return successResponse({ saved: sales.length });
    }

    case "logic-opus-run-list": {
      const { data, error } = await admin.from("logic_opus_runs")
        .select("id,mode,broadcast_username,slot_number,started_at,ended_at,sale_count,total_amount")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return successResponse({
        runs: (data || []).map((r) => ({
          id: r.id,
          mode: r.mode,
          broadcastUsername: r.broadcast_username,
          slotNumber: r.slot_number,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          saleCount: r.sale_count,
          totalAmount: Number(r.total_amount) || 0,
        })),
      });
    }

    case "logic-opus-run-get": {
      const runId = runIdOf(body.runId);
      const [{ data: run, error: runError }, { data: ledger, error: ledgerError }] = await Promise.all([
        admin.from("logic_opus_runs").select("*").eq("id", runId).maybeSingle(),
        admin.from("logic_opus_ledger").select("document").eq("run_id", runId).order("seq"),
      ]);
      if (runError) throw runError;
      if (ledgerError) throw ledgerError;
      if (!run) fail("NOT_FOUND", "기록을 찾지 못했습니다.", 404);
      return successResponse({ run, sales: (ledger || []).map((r) => r.document) });
    }
  }
  fail("VALIDATION_ERROR", "지원하지 않는 요청입니다.");
}
