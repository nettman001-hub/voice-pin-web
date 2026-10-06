import type {
  LogicOpusClassification,
  LogicOpusEventType,
  LogicOpusJudgeRequest,
  LogicOpusJudgement,
  LogicOpusLedgerOp,
  LogicOpusProductState,
} from "../../types/logicOpus.ts";

/**
 * AI 판단 프롬프트와 응답 파서.
 * 무엇이 구매의사인지, 무엇이 확정 멘트인지, 구매자·가격·상품·옵션이 무엇인지는
 * 전부 AI가 판단한다. 이 파일은 질문을 만들고 답의 형식만 검사한다.
 */

const EVENT_TYPES: LogicOpusEventType[] = [
  "PURCHASE_INTENT",
  "PRODUCT_ANNOUNCE",
  "PRICE_CHANGE",
  "SELLER_CONFIRM",
  "OPTION_CHANGE",
  "SOLD_OUT",
  "CANCEL",
  "QUESTION",
  "ANSWER",
  "CHATTER",
];

export const LOGIC_OPUS_SYSTEM_PROMPT = `당신은 한국어 라이브커머스(틱톡 라이브 판매방송)의 실시간 판매 기록 담당자입니다.
판매자 멘트(STT 음성인식 결과라 오타·띄어쓰기 오류가 있음)와 시청자 댓글을 시간순으로 읽고, 판매가 확정된 건을 기록합니다.

[판단할 것]
1. 새 이벤트마다 종류를 분류합니다.
   - PURCHASE_INTENT: 시청자의 구매의사. "저요", "ㅈㅇ", "저여", "저용", "제가살께요", "저주세요", "OO 주세요", "캡할게요", 판매자가 부른 번호를 그대로 친 숫자("1", "5", ".1") 등. 형태는 다양하니 문맥으로 판단하세요.
   - PRODUCT_ANNOUNCE: 판매자가 상품·가격·옵션·번호를 안내 ("가격은 18,000원", "5,000원, 7번", "이 제품 숫자 1번 입니다. 가격은 0.9").
   - PRICE_CHANGE: 판매자가 가격을 바꿈 ("4,000원 드릴게요 그냥", "만 원에 가져가").
   - SELLER_CONFIRM: 판매자가 특정 구매자에게 판매를 확정 ("체리 나무 언니 드릴게요", "1번은 강아디", "3번은 액셔니 레오, 품절", "루비 언니 넣어드릴게요").
   - OPTION_CHANGE: 확정된 건의 색상·번호가 바뀜 ("블랙, 블랙. 오케이").
   - SOLD_OUT, CANCEL: 품절 안내, 판매 취소·거절 ("안 돼요", "누구 마음대로").
   - QUESTION / ANSWER / CHATTER: 질문, 질문에 대한 답, 인사·잡담. 판매가 아닙니다.
2. 현재 판매 중인 상품 상태(productState)를 갱신합니다. 상품명, 기본가격, 옵션 목록(번호·색상·가격·수량 제한), 판매방식을 유지하세요.
   판매방식: FREE_TALK(저요형), NUMBER_CALL(판매자가 "번호 5번 주세요"라고 하고 시청자가 숫자를 댓글로 침), NUMBERED_PRODUCT(판매자가 상품번호를 붙여 안내).
3. 판매 원장 변경(ledgerOps)을 냅니다.
   - CREATE: 판매자가 확정한 새 판매. 판매자가 이름을 말하지 않고 "그레이 드릴게요"처럼 확정했다면, 직전에 그 상품/옵션에 구매의사를 밝힌 댓글 작성자를 구매자로 보되 confidence를 낮추세요.
   - UPDATE: 이미 기록된 판매(saleId)의 가격·옵션·구매자 수정. 같은 구매자에게 같은 상품을 다시 "드릴게요"라고 반복한 것은 새 판매가 아니라 UPDATE 또는 무시입니다.
   - CANCEL: 판매자가 취소·거절한 판매.

[구매자 규칙 — 매우 중요]
- buyerNickname은 반드시 댓글에 실제로 나온 닉네임 원문(knownNicknames 중 하나)을 그대로 쓰세요. 이모지·특수문자도 그대로 씁니다.
- STT는 닉네임을 잘못 받아 적습니다. nicknameCandidates(유사도 점수 참고자료)와 구매의사 댓글(openIntents)을 함께 보고 가장 그럴듯한 댓글 닉네임을 고르세요.
  예: "체리 나무"→"체리나무", "호연"→"한호윤", "엑소"→"xou.3z", "도와도와"→"됴하됴하", "호랑이 이모티콘"→"🐯", "LG"→"엘진", "얌냥"→"얀녕", "대랑이"→"돼랑이 ♡".
- 번호형에서는 그 번호를 댓글로 친 사람만 후보입니다. 판매자가 말한 인원 제한("4명만")을 넘는 사람은 제외하세요.
- 후보가 둘 이상이거나 근거가 약하면 confidence를 0.8 미만으로 주고 alternatives에 다른 후보 닉네임을 넣으세요.
- sellerNicknames(판매자·매니저 계정)는 구매자가 될 수 없습니다.

[가격 규칙]
- 원 단위 정수로 쓰세요. "0.9"→9000, "1.5"→15000, "2.0"→20000, "만 원"→10000, "18,000원"→18000, "2만 원"→20000.
- 여러 가격이 나오면 판매자가 마지막으로 확정한 가격을 쓰세요. 모르면 null.

[신뢰도]
- 판매자가 이름(또는 분명한 별칭)과 상품을 말했고 가격이 분명하면 0.85 이상.
- 이름이 불분명·후보 다수·가격 불명확이면 0.5~0.79.

[출력]
설명 없이 JSON 객체 하나만 출력하세요. 형식:
{"classifications":[{"eventId":"...","type":"PURCHASE_INTENT","target":"번호 7 또는 상품/옵션","confidence":0.9}],
 "productState":{"name":"...","price":18000,"options":[{"no":1,"label":"화이트","price":5000,"limit":2}],"salesMode":"FREE_TALK","note":"..."},
 "ledgerOps":[{"op":"CREATE","buyerNickname":"...","spokenName":"...","product":"...","option":"...","price":18000,"quantity":1,"confidence":0.9,"evidence":["eventId"],"reason":"...","alternatives":[]},
              {"op":"UPDATE","saleId":"...","price":4000,"reason":"..."},
              {"op":"CANCEL","saleId":"...","reason":"..."}],
 "sttHintRequest":true}
- classifications에는 newEvents의 모든 이벤트를 넣으세요.
- 새 판매가 없으면 ledgerOps는 빈 배열입니다.
- 새 구매의사 댓글이 있으면 sttHintRequest를 true로 하세요.`;

function compactEvent(e: LogicOpusJudgeRequest["newEvents"][number]) {
  return e.kind === "COMMENT"
    ? { id: e.id, t: e.at.slice(11, 19), who: e.nickname, comment: e.text }
    : { id: e.id, t: e.at.slice(11, 19), seller: e.text };
}

export function buildJudgeUserPrompt(req: LogicOpusJudgeRequest): string {
  const payload = {
    salesModeHint: req.salesMode,
    sellerNicknames: req.sellerNicknames,
    productState: req.productState,
    ledger: req.ledger,
    openIntents: req.openIntents,
    nicknameCandidates: req.nicknameCandidates.map((c) => ({
      eventId: c.eventId,
      spoken: c.spoken,
      candidates: c.candidates.map((x) =>
        `${x.nickname}(${x.score.toFixed(2)}${x.recentIntent ? ",구매의사" : ""})`
      ),
    })),
    knownNicknames: req.knownNicknames,
    recentEvents: req.recentEvents.map(compactEvent),
    newEvents: req.newEvents.map(compactEvent),
  };
  return `아래 JSON을 읽고 규칙에 따라 판단하세요. recentEvents는 이미 판단한 문맥, newEvents가 이번에 판단할 이벤트입니다.\n${JSON.stringify(payload)}`;
}

export function buildJudgeRepairPrompt(
  original: string,
  badContent: string,
  error: string,
): string {
  return `${original}\n\n[이전 답변이 형식에 맞지 않았습니다: ${error}]\n이전 답변 앞부분: ${badContent.slice(0, 600)}\n설명 없이 지정한 JSON 객체 하나만 다시 출력하세요.`;
}

export function extractJsonObject(content: string): unknown {
  const text = content.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 객체가 없습니다.");
  return JSON.parse(text.slice(start, end + 1));
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[,원\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clamp01(value: unknown, fallback = 0.5): number {
  const n = num(value);
  if (n === null) return fallback;
  return Math.max(0, Math.min(1, n));
}

function price(value: unknown): number | null {
  const n = num(value);
  if (n === null || n < 0) return null;
  return Math.round(n);
}

function strList(value: unknown, max = 10): string[] {
  return Array.isArray(value)
    ? value.map((v) => str(v, 120)).filter(Boolean).slice(0, max)
    : [];
}

function parseProductState(raw: any): LogicOpusProductState | null {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, 120);
  if (!name) return null;
  const modes = ["FREE_TALK", "NUMBER_CALL", "NUMBERED_PRODUCT"];
  return {
    name,
    price: price(raw.price),
    options: Array.isArray(raw.options)
      ? raw.options.slice(0, 20).map((o: any) => ({
        no: num(o?.no) ?? undefined,
        label: str(o?.label, 60),
        price: price(o?.price) ?? undefined,
        limit: num(o?.limit) ?? undefined,
      })).filter((o: any) => o.label || o.no !== undefined)
      : [],
    salesMode: modes.includes(raw.salesMode) ? raw.salesMode : null,
    note: str(raw.note, 300) || undefined,
  };
}

function parseOp(raw: any): LogicOpusLedgerOp | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.op === "CREATE") {
    const buyerNickname = str(raw.buyerNickname, 80);
    if (!buyerNickname) return null;
    return {
      op: "CREATE",
      buyerNickname,
      spokenName: str(raw.spokenName, 80) || undefined,
      product: str(raw.product, 120) || "상품",
      option: str(raw.option, 80) || undefined,
      price: price(raw.price),
      quantity: Math.max(1, Math.min(99, Math.round(num(raw.quantity) ?? 1))),
      confidence: clamp01(raw.confidence),
      evidence: strList(raw.evidence, 20),
      reason: str(raw.reason, 300),
      alternatives: strList(raw.alternatives, 5),
    };
  }
  if (raw.op === "UPDATE") {
    const saleId = str(raw.saleId, 80);
    if (!saleId) return null;
    const op: LogicOpusLedgerOp = { op: "UPDATE", saleId, reason: str(raw.reason, 300) };
    if (raw.buyerNickname !== undefined) op.buyerNickname = str(raw.buyerNickname, 80) || undefined;
    if (raw.product !== undefined) op.product = str(raw.product, 120) || undefined;
    if (raw.option !== undefined) op.option = str(raw.option, 80) || undefined;
    if (raw.price !== undefined) op.price = price(raw.price);
    if (raw.quantity !== undefined) op.quantity = Math.max(1, Math.round(num(raw.quantity) ?? 1));
    if (raw.confidence !== undefined) op.confidence = clamp01(raw.confidence);
    if (raw.evidence !== undefined) op.evidence = strList(raw.evidence, 20);
    return op;
  }
  if (raw.op === "CANCEL") {
    const saleId = str(raw.saleId, 80);
    if (!saleId) return null;
    return { op: "CANCEL", saleId, reason: str(raw.reason, 300), evidence: strList(raw.evidence, 20) };
  }
  return null;
}

/** AI 응답을 판단 결과로 바꾼다. 형식이 틀리면 예외를 던진다(교정 요청용). */
export function parseJudgement(content: string): LogicOpusJudgement {
  const raw = extractJsonObject(content) as any;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("최상위가 JSON 객체가 아닙니다.");
  }
  if (!Array.isArray(raw.classifications) && !Array.isArray(raw.ledgerOps)) {
    throw new Error("classifications 또는 ledgerOps 배열이 없습니다.");
  }
  const classifications: LogicOpusClassification[] = (Array.isArray(raw.classifications) ? raw.classifications : [])
    .map((c: any) => ({
      eventId: str(c?.eventId, 80),
      type: EVENT_TYPES.includes(c?.type) ? c.type : "CHATTER",
      target: str(c?.target, 120) || undefined,
      confidence: clamp01(c?.confidence, 0.6),
    }))
    .filter((c: LogicOpusClassification) => c.eventId);
  const ledgerOps = (Array.isArray(raw.ledgerOps) ? raw.ledgerOps : [])
    .map(parseOp)
    .filter((op: LogicOpusLedgerOp | null): op is LogicOpusLedgerOp => op !== null);
  return {
    classifications,
    productState: parseProductState(raw.productState),
    ledgerOps,
    sttHintRequest: raw.sttHintRequest === true ||
      classifications.some((c) => c.type === "PURCHASE_INTENT"),
  };
}

export const LOGIC_OPUS_PRONOUNCE_SYSTEM_PROMPT = `라이브방송 판매자가 시청자 닉네임을 소리 내어 부를 때의 한국어 발음을 적습니다.
영어·숫자·이모지가 들어간 닉네임마다 판매자가 실제로 읽을 법한 한국어 발음을 1~3개 적으세요.
예: "xou.3z"→["엑소","엑스오유"], "😚JJEONG😚"→["쩡","정","제이"], "🐯"→["호랑이"], "🍞"→["빵"], "rammmmm"→["람","램"], "zz2"→["지지투","제트제트투"], "u"→["유"].
설명 없이 JSON 객체 하나만 출력하세요: {"pronunciations":{"닉네임 원문":["발음1","발음2"]}}`;

export function buildPronounceUserPrompt(nicknames: string[]): string {
  return JSON.stringify({ nicknames });
}

export function parsePronunciations(content: string): Record<string, string[]> {
  const raw = extractJsonObject(content) as any;
  const map = raw?.pronunciations;
  if (!map || typeof map !== "object") throw new Error("pronunciations 객체가 없습니다.");
  const out: Record<string, string[]> = {};
  for (const [nick, list] of Object.entries(map)) {
    const words = strList(list, 3).filter((w) => w.length <= 20);
    if (nick && words.length) out[nick] = words;
  }
  return out;
}

/** 영어·숫자·이모지가 있어 발음이 필요한 닉네임인지 (질문 대상 선별용, 판단 아님) */
export function needsPronunciation(nickname: string): boolean {
  return /[A-Za-z0-9]|\p{Extended_Pictographic}/u.test(nickname);
}
