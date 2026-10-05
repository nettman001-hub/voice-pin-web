import type {
  LogicOpusJudgement,
  LogicOpusLedgerCreateOp,
  LogicOpusSale,
  LogicOpusSaleHistory,
} from "../../types/logicOpus.ts";
import { LOGIC_OPUS_LIMITS } from "../../types/logicOpus.ts";
import { plainForm } from "./opusNicknameCandidates.ts";

/**
 * 판매 원장. AI가 낸 CREATE/UPDATE/CANCEL을 적용하고,
 * 결과가 실제 댓글 닉네임·가격·신뢰도 기준을 만족하는지 검사해서 확정/검토 상태를 정한다.
 */

export interface LedgerContext {
  now: string;
  knownNicknames: string[];
  sellerNicknames: string[];
  confirmConfidence?: number;
}

export interface LedgerApplyResult {
  sales: LogicOpusSale[];
  changedIds: string[];
  /** 새로 인쇄하거나 다시 인쇄해야 하는 판매 */
  printIds: string[];
  rejected: string[];
}

export function formatSaleId(seq: number): string {
  return `L-${String(seq).padStart(4, "0")}`;
}

function resolveKnown(name: string, known: string[]): string | null {
  if (!name) return null;
  if (known.includes(name)) return name;
  const p = plainForm(name);
  if (!p) return null;
  const hit = known.filter((k) => plainForm(k) === p);
  return hit.length === 1 ? hit[0] : null;
}

function productKey(s: Pick<LogicOpusSale, "product" | "option">): string {
  return `${plainForm(s.product)}|${plainForm(s.option || "")}`;
}

function evaluate(sale: LogicOpusSale, ctx: LedgerContext, all: LogicOpusSale[]): LogicOpusSale {
  if (sale.status === "CANCELLED") return sale;
  const reasons: string[] = [];
  const threshold = ctx.confirmConfidence ?? LOGIC_OPUS_LIMITS.CONFIRM_CONFIDENCE;
  const known = resolveKnown(sale.buyerNickname, ctx.knownNicknames);
  if (!known) reasons.push("댓글에 없는 닉네임");
  else sale = { ...sale, buyerNickname: known };
  if (ctx.sellerNicknames.some((s) => plainForm(s) === plainForm(sale.buyerNickname))) {
    reasons.push("판매자 계정");
  }
  if (sale.price === null) reasons.push("가격 불명확");
  if (sale.confidence < threshold) reasons.push(`AI 신뢰도 ${Math.round(sale.confidence * 100)}%`);
  if (sale.candidates.filter((c) => c !== sale.buyerNickname).length > 0 && sale.confidence < threshold) {
    reasons.push("후보 여러 명");
  }
  const created = Date.parse(sale.createdAt);
  const dup = all.find((o) =>
    o.id !== sale.id && o.status !== "CANCELLED" && o.seq < sale.seq &&
    plainForm(o.buyerNickname) === plainForm(sale.buyerNickname) &&
    productKey(o) === productKey(sale) &&
    Math.abs(created - Date.parse(o.createdAt)) <= LOGIC_OPUS_LIMITS.DUPLICATE_WINDOW_MS
  );
  const duplicateOf = dup?.id;
  if (duplicateOf) reasons.push(`중복 의심 (${duplicateOf})`);

  // 관리자가 직접 확정한 건은 형식 오류(닉네임·가격)가 없으면 확정을 유지한다.
  const manual = sale.history.some((h) => h.by === "ADMIN" && h.action === "MANUAL");
  const blocking = reasons.filter((r) => r === "댓글에 없는 닉네임" || r === "판매자 계정" || r === "가격 불명확");
  const status = manual
    ? (blocking.length ? "REVIEW" : "CONFIRMED")
    : (reasons.length ? "REVIEW" : "CONFIRMED");
  return { ...sale, status, reviewReasons: manual ? blocking : reasons, duplicateOf };
}

function history(at: string, action: LogicOpusSaleHistory["action"], summary: string, by: LogicOpusSaleHistory["by"]): LogicOpusSaleHistory {
  return { at, action, summary, by };
}

function money(v: number | null): string {
  return v === null ? "가격 미정" : `${v.toLocaleString("ko-KR")}원`;
}

function createSale(op: LogicOpusLedgerCreateOp, seq: number, now: string): LogicOpusSale {
  return {
    id: formatSaleId(seq),
    seq,
    createdAt: now,
    updatedAt: now,
    buyerNickname: op.buyerNickname,
    spokenName: op.spokenName,
    product: op.product,
    option: op.option,
    price: op.price,
    quantity: op.quantity ?? 1,
    confidence: op.confidence,
    status: "REVIEW",
    reviewReasons: [],
    candidates: [op.buyerNickname, ...(op.alternatives || [])].filter((v, i, a) => v && a.indexOf(v) === i),
    evidence: op.evidence,
    reason: op.reason,
    corrected: false,
    printStatus: "NOT_REQUESTED",
    printRevision: 0,
    history: [history(now, "CREATE", `${op.buyerNickname} · ${op.product}${op.option ? ` (${op.option})` : ""} · ${money(op.price)}`, "AI")],
  };
}

/** 전표에는 구매자와 금액만 찍히므로, 인쇄 후에는 이 둘이 바뀔 때만 다시 인쇄한다. */
function needsPrint(before: LogicOpusSale | undefined, after: LogicOpusSale): boolean {
  if (after.status !== "CONFIRMED") return false;
  if (after.printRevision === 0) return true;
  return !!before && (before.buyerNickname !== after.buyerNickname || before.price !== after.price);
}

function finalize(
  original: LogicOpusSale[],
  next: LogicOpusSale[],
  touched: Set<string>,
  ctx: LedgerContext,
  rejected: string[],
): LedgerApplyResult {
  let sales = next;
  for (const id of touched) {
    sales = sales.map((s) => (s.id === id ? evaluate(s, ctx, sales) : s));
  }
  const before = new Map(original.map((s) => [s.id, s]));
  const printIds: string[] = [];
  sales = sales.map((s) => {
    if (!touched.has(s.id) || !needsPrint(before.get(s.id), s)) return s;
    printIds.push(s.id);
    const reprint = s.printRevision > 0;
    return {
      ...s,
      printStatus: "QUEUED",
      printRevision: s.printRevision + 1,
      printError: undefined,
      corrected: s.corrected || reprint,
    };
  });
  return { sales, changedIds: [...touched], printIds, rejected };
}

export function applyJudgement(
  sales: LogicOpusSale[],
  judgement: LogicOpusJudgement,
  ctx: LedgerContext,
): LedgerApplyResult {
  let next = [...sales];
  const touched = new Set<string>();
  const rejected: string[] = [];
  let seq = sales.reduce((m, s) => Math.max(m, s.seq), 0);

  for (const op of judgement.ledgerOps) {
    if (op.op === "CREATE") {
      seq += 1;
      const sale = createSale(op, seq, ctx.now);
      next.push(sale);
      touched.add(sale.id);
      continue;
    }
    const target = next.find((s) => s.id === op.saleId);
    if (!target) {
      rejected.push(`${op.op} ${op.saleId}: 원장에 없는 판매`);
      continue;
    }
    if (op.op === "CANCEL") {
      next = next.map((s) => s.id === op.saleId
        ? { ...s, status: "CANCELLED", updatedAt: ctx.now, history: [...s.history, history(ctx.now, "CANCEL", op.reason || "취소", "AI")] }
        : s);
      touched.add(op.saleId);
      continue;
    }
    const changes: string[] = [];
    const patch: Partial<LogicOpusSale> = {};
    if (op.buyerNickname !== undefined && op.buyerNickname !== target.buyerNickname) {
      patch.buyerNickname = op.buyerNickname; changes.push(`구매자 ${target.buyerNickname}→${op.buyerNickname}`);
    }
    if (op.product !== undefined && op.product !== target.product) {
      patch.product = op.product; changes.push(`상품 ${op.product}`);
    }
    if (op.option !== undefined && op.option !== target.option) {
      patch.option = op.option; changes.push(`옵션 ${target.option || "-"}→${op.option}`);
    }
    if (op.price !== undefined && op.price !== target.price) {
      patch.price = op.price; changes.push(`가격 ${money(target.price)}→${money(op.price)}`);
    }
    if (op.quantity !== undefined && op.quantity !== target.quantity) {
      patch.quantity = op.quantity; changes.push(`수량 ${op.quantity}`);
    }
    if (op.confidence !== undefined) patch.confidence = op.confidence;
    if (op.evidence?.length) patch.evidence = [...new Set([...target.evidence, ...op.evidence])];
    if (!changes.length && op.confidence === undefined) continue;
    next = next.map((s) => s.id === op.saleId
      ? {
        ...s,
        ...patch,
        corrected: s.corrected || changes.length > 0,
        updatedAt: ctx.now,
        history: [...s.history, history(ctx.now, "UPDATE", `${changes.join(", ") || "신뢰도 갱신"}${op.reason ? ` · ${op.reason}` : ""}`, "AI")],
      }
      : s);
    touched.add(op.saleId);
  }
  return finalize(sales, next, touched, ctx, rejected);
}

/** 관리자 수동 조작: 후보 선택 확정, 수정, 취소, 복구 */
export function applyManualEdit(
  sales: LogicOpusSale[],
  saleId: string,
  edit: Partial<Pick<LogicOpusSale, "buyerNickname" | "product" | "option" | "price" | "quantity">> & { cancel?: boolean; restore?: boolean },
  ctx: LedgerContext,
): LedgerApplyResult {
  const target = sales.find((s) => s.id === saleId);
  if (!target) return { sales, changedIds: [], printIds: [], rejected: [`${saleId}: 원장에 없는 판매`] };
  const parts: string[] = [];
  let updated: LogicOpusSale = { ...target, updatedAt: ctx.now };
  if (edit.cancel) {
    updated.status = "CANCELLED";
    parts.push("관리자 취소");
  } else {
    if (edit.restore || target.status === "CANCELLED") updated.status = "REVIEW";
    for (const key of ["buyerNickname", "product", "option", "price", "quantity"] as const) {
      if (edit[key] !== undefined && edit[key] !== target[key]) {
        (updated as any)[key] = edit[key];
        parts.push(`${key}=${String(edit[key])}`);
      }
    }
    updated.confidence = 1;
    updated.corrected = target.corrected || parts.length > 0;
    parts.unshift("관리자 확정");
  }
  updated.history = [...target.history, history(ctx.now, edit.cancel ? "CANCEL" : "MANUAL", parts.join(" · "), "ADMIN")];
  const next = sales.map((s) => (s.id === saleId ? updated : s));
  return finalize(sales, next, new Set([saleId]), ctx, []);
}

export function ledgerTotals(sales: LogicOpusSale[]) {
  const live = sales.filter((s) => s.status === "CONFIRMED");
  return {
    confirmed: live.length,
    review: sales.filter((s) => s.status === "REVIEW").length,
    amount: live.reduce((sum, s) => sum + (s.price ?? 0) * s.quantity, 0),
  };
}
