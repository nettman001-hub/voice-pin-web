import type { CommentRecord } from "../types/comment.ts";
import type {
  SalesWorkflowProfile,
  WorkflowDecision,
  WorkflowTranscript,
} from "../types/salesWorkflow.ts";
import { extractSpeechPrice } from "./priceEvidence.ts";
import { hasCommentPurchaseIntent } from "./commentNicknameVerifier.ts";
import {
  commentWithdrawsPurchase,
  matchPurchaseRequest,
  type PurchaseRequest,
} from "./purchaseFirstSales.ts";
import {
  isQuestionUtterance,
  splitTranscriptClauses,
} from "./voiceUtteranceService.ts";

export const DEFAULT_WORKFLOW_PROFILE: SalesWorkflowProfile = {
  schemaVersion: 1,
  modules: ["DIRECT", "ORDER_CODE"],
  defaultQuantity: 1,
  requestWindowSeconds: 300,
  offerLifetimeSeconds: 600,
  purchaseExpressions: [],
  confirmationExpressions: [],
  exclusionExpressions: [],
};

export function validateWorkflowProfile(value: unknown): SalesWorkflowProfile {
  const p = value as SalesWorkflowProfile;
  if (
    !p || p.schemaVersion !== 1 || !Array.isArray(p.modules) ||
    !p.modules.length ||
    p.modules.some((m) => !["DIRECT", "ORDER_CODE"].includes(m)) ||
    !Number.isInteger(p.defaultQuantity) || p.defaultQuantity < 1 ||
    p.defaultQuantity > 99 ||
    !Number.isInteger(p.requestWindowSeconds) || p.requestWindowSeconds < 10 ||
    p.requestWindowSeconds > 300 ||
    !Number.isInteger(p.offerLifetimeSeconds) || p.offerLifetimeSeconds < 30 ||
    p.offerLifetimeSeconds > 1800
  ) {
    throw new Error("지원하지 않는 판매방식 또는 설정 범위입니다.");
  }
  for (
    const key of [
      "purchaseExpressions",
      "confirmationExpressions",
      "exclusionExpressions",
    ] as const
  ) {
    if (
      !Array.isArray(p[key]) || p[key].length > 30 ||
      p[key].some((s) =>
        typeof s !== "string" || s.trim().length < 2 || s.length > 80
      )
    ) {
      throw new Error("판매 표현은 2~80자, 종류별 최대 30개로 입력해 주세요.");
    }
  }
  return { ...p, modules: [...new Set(p.modules)] };
}

interface Offer {
  id: string;
  code?: string;
  at: number;
  price?: number;
  quote?: string;
  priceLog?: WorkflowTranscript;
  stock?: number;
  closed?: boolean;
}
const quantity = (text: string) => {
  const m = text.match(/(\d{1,2}|한|두|세|네)\s*개/u)?.[1];
  return m ? ({ 한: 1, 두: 2, 세: 3, 네: 4 }[m] || Number(m)) : undefined;
};
const account = (c: CommentRecord) =>
  c.buyerId || c.platformUserId || c.uniqueId || `unresolved:${c.id}`;
export function extractCommentOrderCode(text: string): string | undefined {
  const normalized = text.normalize("NFKC").trim();
  if (/^\d+[.,]\d/u.test(normalized)) return undefined;
  return normalized.match(
    /^(\d{1,3})(?:\s*번(?=$|[\s!,.~♡♥]|이요|요|저요|주세요|주세|살|구매|신청|\d+\s*개)|(?=$|[\s!,~]|\.$))/u,
  )?.[1];
}
export const isWorkflowAllocation = (
  text: string,
  profile: SalesWorkflowProfile,
) => {
  if (
    isQuestionUtterance(text) ||
    /(?:아니|않|말고|취소|드릴까요|주면|입금하시면|구매하시면|가능하면|아까|어제|지난번)/u
      .test(text) ||
    /(?:보여|재\s*|측정해|알려|설명해|캡처해|보내)\s*드|(?:가단|가슴\s*단면|총장).*(?:재|제)\s*드/u
      .test(text) ||
    profile.exclusionExpressions.some((s) => text.includes(s))
  ) return false;
  return /(?:챙겨\s*(?:드|줄)|넣어\s*(?:드|줄)|담아\s*(?:드|줄)|드리겠습니다|드릴[게께]요|드렸|구매\s*확정|주문\s*확정|낙찰|판매\s*완료)/u
    .test(text) ||
    profile.confirmationExpressions.some((s) => text.includes(s));
};
const names = (text: string) =>
  [...text.matchAll(
    /(?:^|[\s,，])([\p{L}\p{N}_♡♥~^]+)\s*(?:언니|님|씨)(?:께|에게|한테)?/gu,
  )]
    .map((m) => m[1]).filter((n) =>
      !["언니들", "여러분", "이거", "요거", "그거", "네", "자"].includes(n)
    );

/** Deterministic event replay: the same module powers live processing and admin verification. */
export function replaySalesWorkflow(input: {
  sessionId: string;
  profile: SalesWorkflowProfile;
  comments: CommentRecord[];
  transcripts: WorkflowTranscript[];
}): WorkflowDecision[] {
  const { sessionId } = input;
  const profile = validateWorkflowProfile(input.profile);
  const finalLogs = input.transcripts.filter((t) =>
    t.isFinal !== false && Number.isFinite(Date.parse(t.recognizedAt))
  );
  const latest = Math.max(...finalLogs.map((t) => Date.parse(t.recognizedAt)));
  const cutoff = latest -
    (profile.offerLifetimeSeconds + profile.requestWindowSeconds) * 1000;
  const comments = input.comments.filter((c) =>
    c.sessionId === sessionId && Date.parse(c.capturedAt) >= cutoff
  );
  const logs = finalLogs.filter((t) => Date.parse(t.recognizedAt) >= cutoff);
  const events = [
    ...comments.map((c) => ({
      at: Date.parse(c.capturedAt),
      c,
      t: null as WorkflowTranscript | null,
    })),
    ...logs.map((t) => ({
      at: Date.parse(t.recognizedAt),
      c: null as CommentRecord | null,
      t,
    })),
  ].filter((e) => Number.isFinite(e.at)).sort((a, b) =>
    a.at - b.at || (a.t ? 1 : -1)
  );
  const requests: Array<
    PurchaseRequest & { offerId?: string; option?: string }
  > = [];
  const used = new Set<string>();
  const decisions: WorkflowDecision[] = [];
  const seenComments = new Set<string>();
  let current: Offer | undefined;
  const openOffer = (at: number) =>
    current && !current.closed &&
      at - current.at <= profile.offerLifetimeSeconds * 1000
      ? current
      : undefined;
  const registerComment = (c: CommentRecord, at: number) => {
    if (seenComments.has(c.id)) return;
    seenComments.add(c.id);
    if (commentWithdrawsPurchase(c.content)) {
      requests.filter((r) => r.accountKey === account(c)).forEach((r) => {
        r.withdrawn = true;
      });
      return;
    }
    const offer = openOffer(at);
    const code = extractCommentOrderCode(c.content);
    const coded = profile.modules.includes("ORDER_CODE") && code &&
      offer?.code === code;
    const direct = profile.modules.includes("DIRECT") &&
      (hasCommentPurchaseIntent(c.content) ||
        profile.purchaseExpressions.some((s) => c.content.includes(s)));
    if (
      (!coded && !direct) || !c.nickname.trim() ||
      /(?:보여|입어|재어|알려)\s*주세요/u.test(c.content)
    ) return;
    if (code && offer?.code && code !== offer.code) return;
    const q = quantity(c.content) || profile.defaultQuantity;
    requests.push({
      id: `${sessionId}:${c.platformMessageId || c.id}`,
      sessionId,
      commentId: c.id,
      accountKey: account(c),
      buyerId: c.buyerId,
      nickname: c.nickname,
      content: c.content,
      capturedAt: c.capturedAt,
      requestedQuantity: q,
      offerId: offer?.id,
      conditional: /있으면|가능하면|맞으면/u.test(c.content),
      option: c.content.match(/(?:빨강|파랑|검정|흰색|사이즈|옵션)/u)?.[0],
    });
  };
  for (const event of events) {
    if (event.c) {
      registerComment(event.c, event.at);
      continue;
    }
    const t = event.t!;
    if (
      current && event.at - current.at > profile.offerLifetimeSeconds * 1000
    ) current = undefined;
    const announcement =
      t.text.match(/(?:댓글에?|주문\s*번호|상품\s*번호)\s*(\d{1,3})\s*번/u) ||
      t.text.match(/(\d{1,3})\s*번(?:으로|을|입력|\s*입력|\s*주문)/u);
    const change =
      /(?:다음\s*(?:상품|제품)|새\s*(?:상품|제품)|요거는|이거는|이\s*제품)/u
        .test(t.text);
    if (announcement || change) {
      if (current) current.closed = true;
      current = {
        id: `${sessionId}:${t.id}`,
        code: announcement?.[1],
        at: event.at,
      };
    }
    const priceText = splitTranscriptClauses(t.text).filter((s) =>
      !isQuestionUtterance(s)
    ).join("\n");
    const price = extractSpeechPrice(priceText);
    if (price && !current) {
      current = { id: `${sessionId}:${t.id}`, at: event.at };
    }
    if (price && openOffer(event.at)) {
      current!.price = price.amount;
      current!.quote = price.quote;
      current!.priceLog = t;
      // A dedicated price continuation completes the preceding unpriced allocation.
      if (
        /^\s*(?:가격|금액|단가|판매가)/u.test(t.text) && !names(t.text).length
      ) {
        const waiting = decisions.filter((d) =>
          d.offerId === current!.id && d.unitPrice === 0 &&
          event.at - Date.parse(d.recognizedAt) <= 70_000
        );
        for (const d of waiting) {
          d.unitPrice = price.amount;
          d.amount = price.amount * d.quantity;
          d.priceTranscriptId = t.id;
          d.priceQuote = price.quote;
          d.rawTranscript += `\n${t.text}`;
          d.reasons = d.reasons.filter((r) => r !== "가격 확인 필요");
          d.status = d.reasons.length ? "REVIEW" : "CONFIRMED";
        }
        const allocated = decisions.filter((d) =>
          d.offerId === current!.id && d.status === "CONFIRMED"
        ).reduce((n, d) => n + d.quantity, 0);
        if (current!.stock !== undefined && allocated > current!.stock) {
          waiting.forEach((d) => {
            d.status = "REVIEW";
            d.reasons.push("판매자가 안내한 재고 초과");
          });
        }
      }
    }
    const stock = t.text.match(
      /(?:재고(?:는|가)?|수량(?:은|이)?|남은\s*수량(?:은)?)\s*(\d{1,3}|한|두|세|네)\s*개/u,
    ) ||
      t.text.match(/(\d{1,3}|한|두|세|네)\s*개\s*(?:있|뿐|밖에|남)/u);
    if (stock && openOffer(event.at)) {
      current!.stock = quantity(`${stock[1]}개`);
    }
    if (/(?:주문\s*마감|판매\s*마감|품절|이\s*상품\s*끝)/u.test(t.text)) {
      if (current) current.closed = true;
      continue;
    }
    for (const clause of splitTranscriptClauses(t.text)) {
      if (!isWorkflowAllocation(clause, profile)) continue;
      const spokenNames = [...new Set(names(clause))];
      if (!spokenNames.length) continue;
      if (!current) current = { id: `${sessionId}:${t.id}`, at: event.at };
      // Platform comment timestamps can lag speech capture slightly. Replaying
      // after that comment arrives resolves the same stable pending decision.
      for (const c of comments) {
        if (
          Date.parse(c.capturedAt) > event.at &&
          Date.parse(c.capturedAt) <= event.at + 10_000 &&
          !commentWithdrawsPurchase(c.content) &&
          !logs.some((next) =>
            Date.parse(next.recognizedAt) > event.at &&
            Date.parse(next.recognizedAt) <= Date.parse(c.capturedAt) &&
            /(?:댓글에?|주문\s*번호|상품\s*번호|다음\s*(?:상품|제품)|새\s*(?:상품|제품)|요거는|이거는|이\s*제품)/u
              .test(next.text)
          )
        ) registerComment(c, event.at);
      }
      const offer = openOffer(event.at);
      const group: WorkflowDecision[] = [];
      for (const spoken of spokenNames) {
        const eligible = requests.filter((r) =>
          event.at - Date.parse(r.capturedAt) <=
            profile.requestWindowSeconds * 1000 &&
          (!r.offerId || r.offerId === offer?.id)
        );
        const match = matchPurchaseRequest(
          spoken,
          eligible,
          t.recognizedAt,
          used,
        );
        const request = match.kind === "MATCH" ? match.request : undefined;
        // Repeated naming for an already allocated comment is not a new sale.
        if (!request) {
          const prior = matchPurchaseRequest(spoken, eligible, t.recognizedAt);
          if (prior.kind === "MATCH" && used.has(prior.request.id)) continue;
        }
        const q = request?.requestedQuantity || profile.defaultQuantity;
        const unitPrice = offer?.price || 0;
        const reasons: string[] = [];
        if (!request) {
          reasons.push(
            match.kind === "AMBIGUOUS"
              ? "닉네임 후보 중복"
              : "구매 댓글 연결 필요",
          );
        }
        if (!unitPrice) reasons.push("가격 확인 필요");
        if (unitPrice * q > 99_999_999) reasons.push("총액 범위 확인 필요");
        if (request && eligible.find((r) => r.id === request.id)?.option) {
          reasons.push("옵션 확인 필요");
        }
        group.push({
          id: `${t.id}:${spoken}`,
          sessionId,
          offerId: offer?.id || `${sessionId}:${t.id}`,
          orderCode: offer?.code,
          requestId: request?.id,
          commentId: request?.commentId,
          buyerId: request?.buyerId || undefined,
          nickname: request?.nickname || spoken,
          spokenNickname: spoken,
          quantity: q,
          unitPrice,
          amount: unitPrice * q,
          recognizedAt: t.recognizedAt,
          transcriptId: t.id,
          priceTranscriptId: offer?.priceLog?.id,
          priceQuote: offer?.quote,
          rawTranscript: offer?.priceLog && offer.priceLog.id !== t.id
            ? `${offer.priceLog.text}\n${t.text}`
            : t.text,
          stock: offer?.stock,
          reasons,
          status: reasons.length ? "REVIEW" : "CONFIRMED",
        });
      }
      const allocated = decisions.filter((d) =>
        d.offerId === offer?.id && d.status === "CONFIRMED"
      ).reduce((n, d) => n + d.quantity, 0);
      if (
        offer?.stock !== undefined &&
        allocated + group.reduce((n, d) => n + d.quantity, 0) > offer.stock
      ) {
        group.forEach((d) => {
          d.reasons.push("판매자가 안내한 재고 초과");
          d.status = "REVIEW";
        });
      }
      for (const d of group) {
        if (d.requestId) used.add(d.requestId);
        decisions.push(d);
      }
    }
  }
  return decisions;
}
