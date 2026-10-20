import {
  checkFourPointSaleCriteria, extractSaleFromTranscript, findExplicitPriceTranscript, findStandalonePriceTranscript,
  FOUR_POINT_CONFIRMATION_PATTERN, getBuyerNicknameCandidates, parseBuyerNickname,
  type ExtractedSaleResult,
} from './salesExtractor.ts';
import { extractSpeechPrice } from './priceEvidence.ts';
import { hasCaptureCancellationText, hasCaptureInstructionText } from './saleCapturePairing.ts';
import { isQuestionUtterance, isStandaloneBuyerAddress, splitTranscriptClauses } from './voiceUtteranceService.ts';

export const VOICE_SALE_TRANSACTION_WINDOW_MS = 30_000;
/** A price-less allocation takes the seller's next price answer even when
 * other talk follows it in the same STT fragment. */
export const VOICE_SALE_PRICE_FOLLOWUP_MS = 15_000;

export interface VoiceSaleTransactionInput {
  sessionId: string;
  eventId: string;
  text: string;
  recognizedAt: string;
  activeKeywords?: string[];
  diagnostics?: import('./sttDiagnostics.ts').SttDiagnosticSink;
}

export interface VoiceSaleTransactionFragment {
  eventId: string;
  text: string;
  recognizedAt: string;
}

export interface VoiceSaleTransactionState {
  id: string;
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  fragments: VoiceSaleTransactionFragment[];
  /** All original fragments, including a restatement's introductory words. */
  evidenceText: string;
  /** Contiguous original speech actually used to derive result. */
  analysisText: string;
  result: ExtractedSaleResult | null;
  captureSeen: boolean;
  /** A boundary-free repeat still gets its own id so a fresh purchase request
   * can distinguish it from a repeated confirmation of the previous sale. */
  precedingTransactionId?: string;
  precedingTransactionAmount?: number;
  /** Neutral talk arrived after updatedAt; the sale stays open only 15s. */
  talkSince?: string;
}

export interface VoiceSaleTransactionEmission {
  transactionId: string;
  startedAt: string;
  evidenceText: string;
  result: ExtractedSaleResult;
  continuation: boolean;
  captureRequested: boolean;
  precedingTransactionId?: string;
}

export interface VoiceSaleTransactionAdvance {
  state: VoiceSaleTransactionState | null;
  emission: VoiceSaleTransactionEmission | null;
}

const nameKey = (name: string) => name.replace(/\s/gu, '').toLowerCase();
const PRODUCT_CHANGE = /(?:다음|새|다른)\s*(?:상품|제품|물건|옷|거(?=[는은\s,.!?]|$))|(?:다음|새)\s*주문/u;
/** "다음 상품" ends every earlier sale; nothing after it restates them. */
export function isProductChangeUtterance(text: string): boolean {
  return PRODUCT_CHANGE.test(text);
}
const FILLER = /^(?:네|넵|예|자|아|어|음|이거|요거)(?:[\s,，.!。]*(?:네|넵|예|자|아|어|음|이거|요거))*[.!。\s]*$/u;

function withoutBuyerNames(text: string): string {
  let speech = text;
  for (const name of getBuyerNicknameCandidates(text)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    speech = speech.replace(new RegExp(`${escaped}(?=\\s*(?:님|언니|씨))`, 'gu'), '')
      .replace(new RegExp(`닉네임(?:은)?\\s*${escaped}(?=\\s|[,.!?]|$)`, 'gu'), '');
  }
  return speech;
}

function saleInterruption(text: string): boolean {
  return hasCaptureCancellationText(text)
    || /(?:취소|정정|수정|변경|말고|아니고|아니라|드리는\s*거\s*아니|(?:안|못)\s*(?:드리|드릴|챙겨|넣어|담아)|하지\s*(?:마|않))/u.test(withoutBuyerNames(text));
}

function softBoundary(text: string): boolean {
  return splitTranscriptClauses(text).some(isQuestionUtterance)
    || /(?:이면|라면|다면|하시면|맞으시면|있으면|남으면|가능하면)/u.test(withoutBuyerNames(text));
}

function standaloneAddress(text: string): boolean {
  // "우아한 유령님": a two-word display name said on its own.
  return isStandaloneBuyerAddress(text)
    || /^(?:네[,，]?\s*)?[가-힣a-zA-Z0-9_]{1,20}\s+[가-힣a-zA-Z0-9_]{1,20}\s*(?:언니|님|씨)[.!。\s]*$/u.test(text.trim())
    || /^닉네임(?:은)?\s*[가-힣a-zA-Z0-9_]{1,20}(?:님|언니|씨)?[.!。\s]*$/u.test(text.trim());
}

function sameResult(left: ExtractedSaleResult | null, right: ExtractedSaleResult | null): boolean {
  return Boolean(left && right && left.buyerNickname === right.buyerNickname
    && left.buyerNicknamePhrase === right.buyerNicknamePhrase
    && left.amount === right.amount && left.intent === right.intent
    && Boolean(left.isFourPointConfirmed) === Boolean(right.isFourPointConfirmed));
}

/** "어, 가격은 1.8" → "가격은 1.8": an interjection before a step is not a new topic. */
function withoutLeadingFiller(clause: string): string {
  return clause.replace(/^(?:(?:네|넵|예|자|아|어|음)[\s,，]+)+(?=\S)/u, '');
}

function canContinueWith(text: string, incoming: ExtractedSaleResult | null, hasSaleContext: boolean): boolean {
  if (incoming || standaloneAddress(text) || FILLER.test(text)) return true;
  return splitTranscriptClauses(text).map(withoutLeadingFiller).every((clause) =>
    FILLER.test(clause) || standaloneAddress(clause) || PRICE_LABEL_ONLY.test(clause)
    || Boolean(findExplicitPriceTranscript(clause) || findStandalonePriceTranscript(clause))
    || FOUR_POINT_CONFIRMATION_PATTERN.test(clause)
    || hasCaptureInstructionText(clause, { saleContext: hasSaleContext }));
}

const PRICE_LABEL_ONLY = /^(?:가격|금액|단가|판매가)(?:은|는|이|가)?요?[.!。\s]*$/u;

/** "색깔 너무 예뻐요": talk that adds, ends or corrects nothing in a sale.
 * Questions, numbers and any capture mention are never neutral. */
function isNeutralTalk(text: string): boolean {
  return !FILLER.test(text) && !/\d/u.test(text) && !/[캡갭켑][처쳐챠]/u.test(text)
    && !splitTranscriptClauses(text).some(isQuestionUtterance)
    && !getBuyerNicknameCandidates(text).length && !extractSpeechPrice(text)
    && !extractSaleFromTranscript(text) && !saleInterruption(text) && !softBoundary(text)
    && !PRODUCT_CHANGE.test(text) && !FOUR_POINT_CONFIRMATION_PATTERN.test(text)
    && !/(?:드릴|드리|드려|챙겨|넣어|담아|가져가|가격|금액|만\s*원|천\s*원)/u.test(text);
}

function isPriceAnswer(clause: string): boolean {
  return Boolean(findExplicitPriceTranscript(clause) || findStandalonePriceTranscript(clause));
}

/** "1.0이고요. 색깔 너무 예뻐요." → "1.0이고요": the price answer leading a
 * fragment, when the talk after it names no buyer, sale, price or correction. */
function leadingPriceAnswer(text: string): { answer: string; rest: string } | null {
  const clauses = splitTranscriptClauses(text);
  let index = 0;
  while (index < clauses.length && FILLER.test(clauses[index])) index++;
  if (index >= clauses.length || !isPriceAnswer(clauses[index])) return null;
  // A capture instruction later in the fragment still belongs to this sale.
  const later = clauses.slice(index + 1);
  const captures = later.filter((clause) => hasCaptureInstructionText(clause, { saleContext: true }));
  const rest = later.filter((clause) => !captures.includes(clause)).join(' ');
  if (rest && (getBuyerNicknameCandidates(rest).length || extractSaleFromTranscript(rest)
    || extractSpeechPrice(rest) || saleInterruption(rest))) return null;
  return { answer: [...clauses.slice(0, index + 1), ...captures].join(' '), rest };
}

/** Assemble only a single bounded transaction. The caller owns persistence and
 * maps the stable transactionId to its sale row. Never infer identity from price. */
export function advanceVoiceSaleTransaction(
  previous: VoiceSaleTransactionState | null,
  input: VoiceSaleTransactionInput,
): VoiceSaleTransactionAdvance {
  const text = input.text.trim();
  const at = Date.parse(input.recognizedAt);
  const boundaries: string[] = [];
  const finish = (reason: string, advance: VoiceSaleTransactionAdvance): VoiceSaleTransactionAdvance => {
    if (input.diagnostics) try {
      input.diagnostics({ stage: 'transaction.decision', detail: { eventId: input.eventId, text,
        reason, boundaries, previousTransactionId: previous?.id, transactionId: advance.state?.id || advance.emission?.transactionId,
        price: { detected: extractSpeechPrice(text), explicit: findExplicitPriceTranscript(text), standalone: findStandalonePriceTranscript(text) },
        capture: { detected: hasCaptureInstructionText(text, { saleContext: Boolean(previous?.result) }),
          previouslySeen: previous?.captureSeen, requested: advance.emission?.captureRequested || false },
        before: previous, after: advance.state, emission: advance.emission } });
    } catch { /* Observation never changes transaction behavior. */ }
    return advance;
  };
  if (!text || !input.eventId || !input.sessionId || !Number.isFinite(at)) {
    return finish('INVALID_INPUT', { state: previous, emission: null });
  }
  let prior = previous;
  if (prior && (prior.sessionId !== input.sessionId
    || at < Date.parse(prior.updatedAt)
    || at - Date.parse(prior.startedAt) > VOICE_SALE_TRANSACTION_WINDOW_MS)) { prior = null; boundaries.push('SESSION_OR_TIME_BOUNDARY'); }
  if (prior?.fragments.some((fragment) => fragment.eventId === input.eventId)) return finish('DUPLICATE_EVENT', { state: prior, emission: null });
  if (prior?.talkSince && at - Date.parse(prior.updatedAt) > VOICE_SALE_PRICE_FOLLOWUP_MS) { prior = null; boundaries.push('FOLLOWUP_TIMEOUT'); }

  // STT ended the sentence at the seller's pause ("유령님 드릴게요. 가격은.").
  // Read the price that opens the next fragment and ignore the talk after it.
  if (prior?.result?.intent === 'ALLOCATION' && prior.result.amount === 0
    && at - Date.parse(prior.updatedAt) <= VOICE_SALE_PRICE_FOLLOWUP_MS) {
    const priceAnswer = leadingPriceAnswer(text);
    if (priceAnswer?.rest && !FILLER.test(priceAnswer.rest)) {
      const advanced = advanceVoiceSaleTransaction(prior, { ...input, text: priceAnswer.answer });
      return finish('LEADING_PRICE_WITH_FOLLOWING_TALK', PRODUCT_CHANGE.test(priceAnswer.rest) ? { ...advanced, state: null } : advanced);
    }
  }

  // Talk between the steps ("1.0이고요." / "색깔 너무 예뻐요." / "캡처하세요.")
  // keeps the allocation open for 15s (user rule 2026-10-19); it adds nothing.
  if (prior?.result?.intent === 'ALLOCATION' && !prior.captureSeen
    && at - Date.parse(prior.updatedAt) <= VOICE_SALE_PRICE_FOLLOWUP_MS && isNeutralTalk(text)) {
    return finish('NEUTRAL_TALK_NOT_APPENDED', { state: { ...prior, talkSince: prior.talkSince || input.recognizedAt }, emission: null });
  }

  const incoming = extractSaleFromTranscript(text, input.activeKeywords);
  const names = getBuyerNicknameCandidates(text);
  const priorName = prior?.result?.buyerNickname || (prior ? parseBuyerNickname(prior.analysisText) : null);
  const sameBuyer = Boolean(priorName && names.length === 1 && nameKey(names[0]) === nameKey(priorName));
  const otherBuyer = Boolean(priorName && names.some((name) => nameKey(name) !== nameKey(priorName)));
  // Corrections and cancellations are handled by their own command path. They
  // must not reopen the canceled transaction as a new pending allocation.
  if (saleInterruption(text)) return finish('CORRECTION_OR_CANCELLATION', { state: null, emission: null });
  const hard = PRODUCT_CHANGE.test(text);
  // "맞으시면 ㅇ 한번만. 하니님 드릴게요. 가격은 1.2" supplies its own
  // complete evidence; the conditional prelude supplies no missing sale fact.
  const independentRestatement = Boolean(prior?.result && prior.result.amount === 0 && sameBuyer
    && incoming?.intent === 'ALLOCATION' && incoming.amount > 0 && !hard);
  const pricedAllocation = Boolean(prior?.result?.intent === 'ALLOCATION' && prior.result.amount > 0);
  const newAllocation = Boolean(incoming?.intent === 'ALLOCATION' && incoming.amount > 0 && names.length);
  const differentPrice = Boolean(prior?.result?.amount && incoming?.amount && prior.result.amount !== incoming.amount);
  let precedingTransactionId = prior?.precedingTransactionId;
  let precedingTransactionAmount = prior?.precedingTransactionAmount;
  const repeatedAllocation = Boolean(prior && pricedAllocation && sameBuyer && !hard && !softBoundary(text)
    && ((newAllocation && !differentPrice) || standaloneAddress(text)));
  if (repeatedAllocation && prior?.result) {
    precedingTransactionId = prior.id;
    precedingTransactionAmount = prior.result.amount;
  }

  if (prior && (hard || otherBuyer || (softBoundary(text) && !independentRestatement)
    || (pricedAllocation && (newAllocation || standaloneAddress(text)))
    || differentPrice || !canContinueWith(text, incoming, Boolean(prior.result
      || (priorName && FOUR_POINT_CONFIRMATION_PATTERN.test(text)))))) {
    boundaries.push(hard ? 'PRODUCT_CHANGED' : otherBuyer ? 'BUYER_CHANGED' : differentPrice ? 'PRICE_CHANGED'
      : softBoundary(text) ? 'QUESTION_OR_CONDITIONAL' : 'CONTINUATION_REJECTED');
    prior = null;
    if (!repeatedAllocation) {
      precedingTransactionId = undefined;
      precedingTransactionAmount = undefined;
    }
  }

  // A boundary without a new independently valid statement cannot keep the old
  // recipient alive for a later price/capture. A different buyer can start anew.
  // A 4-step confirmation may start with any step ("캡처하세요." / "가격은 1.0.").
  const fourPointStep = !incoming && !FILLER.test(text) && canContinueWith(text, null, true);
  if (!prior && (!incoming && !standaloneAddress(text) && !fourPointStep)) return finish('NO_VALID_SALE_STEP', { state: null, emission: null });
  if (!prior && (softBoundary(text) || hard) && !incoming) return finish('QUESTION_OR_PRODUCT_BOUNDARY', { state: null, emission: null });

  const fragment = { eventId: input.eventId, text, recognizedAt: input.recognizedAt };
  const fragments = prior ? [...prior.fragments, fragment] : [fragment];
  const evidenceText = fragments.map((part) => part.text).join('\n');
  let analysisText = prior ? `${prior.analysisText}\n${text}` : text;
  let result = extractSaleFromTranscript(analysisText, input.activeKeywords);
  if (prior && independentRestatement && incoming
    && (!result || result.amount !== incoming.amount || result.buyerNickname !== incoming.buyerNickname)) {
    // Keep all original fragments in evidenceText, but use the self-contained
    // restatement as the canonical speech so server re-extraction agrees.
    analysisText = text;
    result = incoming;
  }
  if (result?.amount && precedingTransactionAmount && result.amount !== precedingTransactionAmount) {
    precedingTransactionId = undefined;
    precedingTransactionAmount = undefined;
  }
  // A later product/buyer's capture in this same input does not belong to the
  // first allocation returned by the extractor's single-sale contract.
  const connectedCapture = checkFourPointSaleCriteria(analysisText).hasCapture;
  const capturesNow = connectedCapture && hasCaptureInstructionText(text, { saleContext: Boolean(result?.intent === 'ALLOCATION') });
  const captureSeen = Boolean(prior?.captureSeen || connectedCapture);
  const state: VoiceSaleTransactionState = {
    id: prior?.id || `${input.sessionId}:${input.eventId}`,
    sessionId: input.sessionId,
    startedAt: prior?.startedAt || input.recognizedAt,
    updatedAt: input.recognizedAt,
    fragments, evidenceText, analysisText, result, captureSeen,
    precedingTransactionId, precedingTransactionAmount,
  };
  const changed = result && (!prior?.result || !sameResult(prior.result, result) || (capturesNow && !prior.captureSeen));
  const productChange = PRODUCT_CHANGE.exec(text);
  const closesTransaction = Boolean((productChange && extractSaleFromTranscript(text.slice(0, productChange.index)))
    || (result?.buyerNickname && names.some((name) => nameKey(name) !== nameKey(result.buyerNickname))));
  return finish(changed ? 'SALE_RESULT_EMITTED' : result ? 'SALE_FACTS_UNCHANGED' : 'WAITING_FOR_SALE_FACTS', {
    state: closesTransaction ? null : state,
    emission: changed && result ? {
      transactionId: state.id, startedAt: state.startedAt, evidenceText, result,
      continuation: Boolean(prior?.result), captureRequested: capturesNow && !Boolean(prior?.captureSeen),
      precedingTransactionId: state.precedingTransactionId,
    } : null,
  });
}
