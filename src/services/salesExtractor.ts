import type { SaleRecord, SaleStatus } from '../types/live.ts';
import { extractSpeechPrice } from './priceEvidence.ts';
import { isQuestionUtterance, splitTranscriptClauses } from './voiceUtteranceService.ts';
import { CAPTURE_INSTRUCTION_PATTERN, hasCaptureCancellationText, hasCaptureInstructionText } from './saleCapturePairing.ts';

/**
 * 한국어 금액 표현(예: "35,000원", "3만 5천원", "3만원", "42000원", "5천원")을 숫자(number)로 변환
 *
 * 라이브 판매에서 자주 쓰는 축약 발화도 지원한다.
 * "가격 0.8"은 0.8만 원, 즉 8,000원으로 해석한다.
 * 따라서 1.5 → 15,000원, 2.9 → 29,000원이다.
 */
const KOREAN_DIGIT_WORDS: Record<string, number> = {
  영: 0, 공: 0,
  일: 1, 하나: 1, 한: 1,
  이: 2, 둘: 2, 두: 2,
  삼: 3, 셋: 3, 세: 3,
  사: 4, 넷: 4, 네: 4,
  오: 5, 다섯: 5,
  육: 6, 여섯: 6,
  칠: 7, 일곱: 7,
  팔: 8, 여덟: 8,
  구: 9, 아홉: 9,
  십: 10
};

export function parseKoreanAmount(text: string): number | null {
  if (!text) return null;
  const evidenced = extractSpeechPrice(text);
  if (evidenced) return evidenced.amount;
  if (/\d+\s*(?:\.|점)\s*\d+|[영공일이삼사오육칠팔구]\s*점\s*[영공일이삼사오육칠팔구]/u.test(text)) return null;

  // 0. 사용자 명시 규칙: "소숫점 숫자가 나오면 무조건 가격을 말하는 것으로 확정한다. 예를 들어 '1.7' 이면 17,000원 이다."
  // 0-1) 한글 발음 소수 표현 (예: "일점칠", "이점오", "삼점오", "영점팔" 등)
  const koWordMatch = text.match(/([영공일이삼사오육칠팔구십]+)\s*(?:[.]|점)\s*([영공일이삼사오육칠팔구]+)/u);
  if (koWordMatch) {
    const wholeVal = KOREAN_DIGIT_WORDS[koWordMatch[1]];
    const fracVal = KOREAN_DIGIT_WORDS[koWordMatch[2]];
    if (wholeVal !== undefined && fracVal !== undefined) {
      const compactValue = wholeVal + fracVal / 10;
      return Math.round(compactValue * 10000);
    }
  }

  // 0-2) 숫자 소수 표현 (예: "1.7", "0.8", "2.5", "15.5", "1점7", "1.7만", "1.7원" 등)
  // 단, 날짜(2026.09.10)나 버전(1.2.3), 시/분/초 등은 제외
  const decimalMatch = text.match(/(?<!\d\.)(?<!\d)(\d{1,3})\s*(?:[.]|점)\s*(\d{1,2})(?!\.\d)(?!\s*(?:월|일|시|분|초|버전|ver))\b/u);
  if (decimalMatch) {
    const compactValue = Number(`${decimalMatch[1]}.${decimalMatch[2]}`);
    if (Number.isFinite(compactValue) && compactValue > 0) {
      const decimalStart = decimalMatch.index ?? 0;
      const decimalEnd = decimalStart + decimalMatch[0].length;
      const followingUnit = text.slice(decimalEnd).match(/^\s*(만|천|백)/u);
      const multiplier = followingUnit?.[1] === '천'
        ? 1000
        : followingUnit?.[1] === '백'
          ? 100
          : 10000;
      return Math.round(compactValue * multiplier);
    }
  }

  // 1. 순수 숫자 + 쉼표 형식 (예: 35,000원, 35000원)
  const directNumMatch = text.match(/([0-9,]+)\s*원/);
  if (directNumMatch) {
    const cleanNum = parseInt(directNumMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(cleanNum) && cleanNum > 0) {
      return cleanNum;
    }
  }

  // 2. 만원, 천원 복합 형식 (예: 3만 5천원, 3만원, 5천원, 2만500원)
  let total = 0;
  let hasUnit = false;

  const manMatch = text.match(/(\d+)\s*만/);
  if (manMatch) {
    total += parseInt(manMatch[1], 10) * 10000;
    hasUnit = true;
  }

  const cheonMatch = text.match(/(\d+)\s*천/);
  if (cheonMatch) {
    total += parseInt(cheonMatch[1], 10) * 1000;
    hasUnit = true;
  }

  const baekMatch = text.match(/(\d+)\s*백/);
  if (baekMatch) {
    total += parseInt(baekMatch[1], 10) * 100;
    hasUnit = true;
  }

  const wonRemainMatch = text.match(/(\d+)\s*원/);
  if (wonRemainMatch && !manMatch && !cheonMatch && !baekMatch) {
    total += parseInt(wonRemainMatch[1], 10);
    hasUnit = true;
  }

  if (hasUnit && total > 0) {
    return total;
  }

  // 3. 숫자만 추출 (날짜나 버전 표시는 제외)
  const isDateOrVersion = /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/.test(text) || /\bv?\d+\.\d+\.\d+\b/i.test(text);
  if (!isDateOrVersion) {
    const fallbackNum = text.match(/\b\d{3,7}\b/);
    if (fallbackNum) {
      return parseInt(fallbackNum[0], 10);
    }
  }

  return null;
}

const NON_BUYER_NAMES = new Set([
  '보여', '입어', '설명', '안내', '말씀', '네', '있는데', '잠시', '박시하게', '언니들',
  '구매하신', '구매자', '고객', '손', '다음', '이번',
  '이거', '요거', '그거', '저거', '이것', '요것', '그것', '저것',
  '이건', '요건', '그건', '저건', '여기', '거기', '저기',
]);

function distinctBuyerNames(candidates: string[]): string[] {
  const names = new Map<string, string>();
  for (const value of candidates) {
    const candidate = value.trim();
    const key = candidate.replace(/\s+/gu, '').toLowerCase();
    if (key && !NON_BUYER_NAMES.has(key) && !names.has(key)) names.set(key, candidate);
  }
  return [...names.values()];
}

function honorificBuyerNames(text: string): string[] {
  // Live allocation: "네, 햇살언니께 드리겠습니다" / "뒷자리1234언니께".
  // Preserve the position word so the account matcher can verify the suffix.
  return distinctBuyerNames([...text.matchAll(/(?:^|[\s,，])((?:뒷\s*자리|뒷\s*번호|끝\s*번호)?\s*[가-힣a-zA-Z0-9_]{1,20})\s*(?:언니|님|씨)(?:께|에게|한테|는|은|도|을|를)?(?=\s|[,.!?]|드리|챙겨|$)/gu)]
    .map((match) => match[1]));
}

// Words that open an allocation sentence but are never part of a nickname.
const LEADING_NON_NAME_WORDS = new Set([
  ...NON_BUYER_NAMES, '자', '아', '어', '음', '예', '넵', '그', '저', '우리', '그럼', '그러면', '그리고',
  '이제', '이거는', '요거는', '닉네임', '닉네임은', '구매확정', '구매', '확정',
]);

/** A display name may contain a space ("성훈 맘"), but the spoken-name parser
 * keeps only the word next to the honorific ("맘"). Return that name with up
 * to two words spoken right before it, so the purchase matcher can check the
 * longer reading against real comment nicknames. Never an identity by itself. */
export function getBuyerNicknamePhrase(text: string, nickname: string | null): string | null {
  if (!text || !nickname || /\s/u.test(nickname)) return nickname;
  const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = text.match(new RegExp(`(?:^|[\\s,，.!?])((?:[가-힣a-zA-Z0-9_]{1,20}\\s+){1,2})${escaped}\\s*(?:언니|님|씨)`, 'u'));
  if (!match) return nickname;
  let words = match[1].trim().split(/\s+/u);
  // "루비 언니 블루 언니": a word after another honorific is a new name.
  for (let i = words.length - 1; i >= 0; i--) {
    if (/(?:언니|님)(?:께|에게|한테|는|은|도|을|를)?$/u.test(words[i])) { words = words.slice(i + 1); break; }
  }
  while (words.length && (LEADING_NON_NAME_WORDS.has(words[0]) || /\d/u.test(words[0]))) words.shift();
  return words.length ? `${words.join(' ')} ${nickname}` : nickname;
}

/** Spoken name candidates only; canonical identity comes from the comment. */
export function getBuyerNicknameCandidates(text: string): string[] {
  if (!text) return [];

  const allocationNames = honorificBuyerNames(text);
  if (allocationNames.length) return allocationNames;

  // 패턴 0: 접미부/접두부 위치 호칭 (예: "뒷번호 0517님", "뒷자리 에스엠디아이님", "끝번호 smdi님", "앞자리 지아이이님")
  const p0 = distinctBuyerNames([...text.matchAll(
    /(?:마지막\s*자리|마지막\s*번호|전화\s*번호\s*뒤|핸드폰\s*뒤|폰\s*뒤|전화\s*뒤|뒷\s*자리|뒷\s*번호|뒤\s*번호|끝\s*자리|끝\s*번호|마지막|처음\s*자리|앞\s*자리|앞\s*번호|첫\s*자리|첫\s*번호|처음)\s*[:：#]?\s*([가-힣a-zA-Z0-9_]{1,16})(?:\s*번)?(?:\s*님|\s*이|\s*씨|\s*고객)?/gu
  )].map((match) => match[0].replace(/(?:\s*번)?(?:\s*님|\s*이|\s*씨|\s*고객)$/u, '')));
  if (p0.length) return p0;

  // 패턴 1: "닉네임은 [xxx]님", "닉네임 [xxx]님", "[xxx]님 이시구요", "[xxx]님이"
  const p1 = distinctBuyerNames([...text.matchAll(/(?:닉네임은?|구매하신\s*분은?|구매자(?:는)?)\s*([가-힣a-zA-Z0-9_]{1,15})(?:\s*님|\s*이|\s*씨|\s*고객)/gu)]
    .map((match) => match[1]));
  if (p1.length) return p1;

  // 패턴 2: "[xxx]님 구매확정", "[xxx]님 결제"
  const p2 = distinctBuyerNames([...text.matchAll(/([가-힣a-zA-Z0-9_]{2,12})\s*님/gu)]
    .map((match) => match[1]));
  if (p2.length) return p2;

  // 패턴 3: "닉네임 [xxx]" (예: "닉네임 러블리", "닉네임은 민트초코")
  const p3 = distinctBuyerNames([...text.matchAll(/닉네임(?:은)?\s*([가-힣a-zA-Z0-9_]{1,16})(?=\s|[,.!?]|이거|요거|드릴|확정|$)/gu)]
    .map((match) => match[1].replace(/(?:언니|님|씨)(?:께|에게|한테)?$/u, '')));
  return p3;
}

/** Never pick the first/last candidate when more than one real name remains. */
export function parseBuyerNickname(text: string): string | null {
  const candidates = getBuyerNicknameCandidates(text);
  return candidates.length === 1 ? candidates[0] : null;
}

export interface ExtractedSaleResult {
  isSaleMent: boolean;
  buyerNickname: string;
  amount: number;
  status: SaleStatus;
  rawTranscript: string;
  isPending: boolean;
  matchedKeywords: string[];
  intent: 'ALLOCATION' | 'UNCERTAIN';
  allocationTranscript?: string;
  /** buyerNickname with the words spoken right before it ("성훈 맘"). */
  buyerNicknamePhrase?: string;
  /** 판매자 4단 멘트(고객 닉네임 + 확정멘트 + 소수점/일반가격 + 캡처멘트) 완전 일치 여부 */
  isFourPointConfirmed?: boolean;
}

/**
 * 4대 필수 멘트 패턴 정의:
 * 1. 확정 멘트: 드릴게요, 드릴께요, 이거 드릴게요, 이거 드릴께요, 확정이요, 확정이에요, 확정입니다, 가져가세요, 낙찰
 * 2. 캡처 멘트: 캡처하세요, 캡처해주세요, 캡처요, 캡쳐하세요, 캡쳐해주세요, 캡쳐요, 화면 캡처
 */
export const FOUR_POINT_CONFIRMATION_PATTERN =
  /(?:이거\s*|요거\s*|상품\s*)?(?:드릴[게께]요|드리겠습니다|확정(?:이[요야]|입니다)?|가져가세요|낙찰(?:이[요야]|입니다)?)/u;

export const FOUR_POINT_CAPTURE_PATTERN = CAPTURE_INSTRUCTION_PATTERN;

export interface FourPointSaleCheck {
  isFourPointSale: boolean;
  buyerNickname: string | null;
  amount: number | null;
  hasNickname: boolean;
  hasConfirmation: boolean;
  hasPrice: boolean;
  hasCapture: boolean;
  /** Buyer/allocation/price evidence for this transaction, excluding later sales. */
  allocationTranscript?: string;
}

export function checkFourPointSaleCriteria(text: string): FourPointSaleCheck {
  if (!text || text.trim().length < 3) {
    return {
      isFourPointSale: false,
      buyerNickname: null,
      amount: null,
      hasNickname: false,
      hasConfirmation: false,
      hasPrice: false,
      hasCapture: false,
    };
  }

  const evidence = findFourPointEvidence(text);
  // Keep price evidence separate from the connected capture clauses: an
  // explicit price clause may also contain measurements or a capture request.
  const buyerNickname = parseBuyerNickname(evidence.allocationTranscript);
  const hasNickname = Boolean(buyerNickname && buyerNickname.trim().length >= 1);

  // 2. 확정 멘트
  const hasConfirmation = evidence.validAllocation
    && FOUR_POINT_CONFIRMATION_PATTERN.test(evidence.allocationTranscript);

  // 3. 가격 (소수점 1.5 -> 15,000원 및 일반 금액)
  const speechPrice = extractSpeechPrice(evidence.allocationTranscript);
  // The permissive display parser also reads bare IDs/counts. Confirmation
  // requires a quoted decimal or currency amount from this transaction.
  const amount = speechPrice?.amount ?? null;
  const hasPrice = Boolean(amount && amount > 0);

  // 4. 캡처 멘트
  const hasCapture = evidence.hasCapture;

  const isFourPointSale = hasNickname && hasConfirmation && hasPrice && hasCapture;

  return {
    isFourPointSale,
    buyerNickname,
    amount,
    hasNickname,
    hasConfirmation,
    hasPrice,
    hasCapture,
    allocationTranscript: evidence.allocationTranscript,
  };
}

const ALLOCATION_ACTION = /(?:드리겠습니다|드릴게요|드릴께요|챙겨\s*드릴게요|챙겨\s*드리겠습니다|챙겨\s*줄(?:게|께)(?:요)?(?=\s|[,.!?]|$)|(?:넣어|담아|배정해)\s*드(?:릴(?:게|께)요|렸(?:어요|습니다))|구매\s*확정(?:입니다|할게요)?|낙찰(?:입니다)?|판매\s*완료|주문\s*확정|결제\s*완료|캡처(?:해주세요|해\s*주시고|하세요|부탁)?|먼저\s*(?:하셨네요|하셨어요|하셨|잡으셨|가져가셨)|가져가(?:세요|실게요|셨어요)|가실게요)/u;
const NON_ALLOCATION = /(?:드릴까요|드릴\s*수\s*있|드리는\s*거\s*아니|안\s*드리|못\s*드리|(?:안|못)\s*챙겨|챙겨\s*(?:안|못)\s*줄|챙겨\s*줄(?:게|께)(?:요)?[\s,，]*(?:라고|라는|아니|취소|(?:하고|고)\s*(?:말|했)|했(?:잖|어|다)|하기로)|(?:입금|결제|구매|원)(?:하시면|하면)|사시면|있으면|남으면|가능하면|아까\s*.*(?:드렸|드린)|(?:보여|입어|설명|안내|알려|비춰|찍어|읽어|확인해|보내|재|제|재어|측정해)\s*(?:드(?:릴(?:게|께)요|리겠습니다|립니다|려요)|줄(?:게|께)(?:요)?))/u;

/** A price declaration may continue an allocation, but measurements and a
 * second buyer/product/price must never become its transaction evidence. */
export function findExplicitPriceTranscript(text: string): string | null {
  // A stammered label is still one declaration: "가격은, 가격은 0.5" → "가격은 0.5".
  const clause = text.trim()
    .replace(/^((?:가격|금액|단가|판매가)(?:은|는|이|가)?)(?:[\s,，]+\1)+(?=[\s,，:：]|$)/u, '$1')
    .replace(/^((?:가격|금액|단가|판매가)(?:은|는|이|가)?)[,，]\s*/u, '$1 ');
  if (splitTranscriptClauses(clause).length !== 1 || isQuestionUtterance(clause)
    || getBuyerNicknameCandidates(clause).length > 0
    || /(?:아니|말고|정정|수정|변경|취소|이면|라면|다면|하시면|다음|다른|이전|새\s*상품)/u.test(clause)) return null;
  const prefix = clause.match(/^(?:가격|금액|단가|판매가)(?:은|는|이|가)?\s*[:：]?\s*/u);
  if (!prefix || (clause.match(/(?:가격|금액|단가|판매가)/gu)?.length || 0) !== 1) return null;
  // Keep the explicit price separate even when STT puts decimal measurements
  // into the same sentence: "금액은 1.0, 가단 60.5에 총장 89.5".
  // A measurement label must introduce a value; do not strip a unit suffix
  // like "1.5 사이즈" and accidentally turn that dimension into money.
  const body = clause.slice(prefix[0].length)
    .split(/(?:가단|가슴\s*단면|총장|기장|길이|높이|폭|사이즈)(?:은|는|이|가)?\s*[:：]?\s*(?=[\d영공일이삼사오육칠팔구])/u)[0]
    .replace(/[.!。\s]+$/u, '').trim();
  const price = extractSpeechPrice(body);
  if (!price) return null;
  return `${prefix[0]}${price.quote}`;
}

/** A standalone currency/decimal answer can finish a split price declaration.
 * Do not treat measurements, product descriptions or a second number as price. */
export function findStandalonePriceTranscript(text: string): string | null {
  const clause = text.trim().replace(/[.!。\s]+$/u, '');
  const price = extractSpeechPrice(clause);
  if (!price || !clause.startsWith(price.quote)) return null;
  const suffix = clause.slice(price.quote.length).trim()
    .replace(/^(?:입니다|이에요|이요|요)(?=$|[\s,，.!。])/u, '').replace(/^[\s,，.!。]+/u, '');
  if (!suffix || /^(?:화면\s*)?캡[처쳐](?:\s*(?:하세요|해\s*주세요|해\s*주시고(?:요)?|요))?[.!。\s]*$/u.test(suffix)) {
    return price.quote;
  }
  return null;
}

const ALLOCATION_FILLER = /^(?:네|넵|예|자|아|어|음|이거|요거)(?:[,，\s]*(?:네|넵|예|자|아|어|음|이거|요거))*$/u;
const PRODUCT_TRANSITION = /(?:다음|새|다른)\s*(?:상품|물건|옷|거(?=[는은\s,.!?]|$))/u;
const TRANSACTION_INTERRUPTION = /(?:취소|정정|수정|변경|말고|아니|이면|라면|다면|하시면|하지\s*마)/u;

const PRICE_LABEL_ONLY = /^(?:가격|금액|단가|판매가)(?:은|는|이|가)?요?$/u;

function allocationClauses(text: string): string[] {
  const clauses = splitTranscriptClauses(text)
    .map((part) => part.replace(/[.!。\s]+$/u, '').trim()).filter(Boolean);
  // STT often ends a sentence at the pause after the label: "가격은. 2.0."
  // Rejoin it only when the result is one explicit price declaration.
  const joined: string[] = [];
  for (let i = 0; i < clauses.length; i++) {
    const next = clauses[i + 1];
    const merged = next && PRICE_LABEL_ONLY.test(clauses[i]) ? `${clauses[i].replace(/요$/u, '')} ${next}` : null;
    if (merged && findExplicitPriceTranscript(merged)) {
      joined.push(merged);
      i++;
    } else {
      joined.push(clauses[i]);
    }
  }
  return joined;
}

function beforeProductChange(text: string, allowLeadingAnnouncement = false): string {
  for (const match of text.matchAll(new RegExp(PRODUCT_TRANSITION.source, 'gu'))) {
    const prefix = text.slice(0, match.index).trim();
    // An introduction before any buyer/allocation/price belongs to the new
    // sale, including "네, 다음 상품은 햇살님 ...".
    if (allowLeadingAnnouncement && !getBuyerNicknameCandidates(prefix).length
      && !ALLOCATION_ACTION.test(prefix) && !FOUR_POINT_CONFIRMATION_PATTERN.test(prefix)
      && !extractSpeechPrice(prefix)) continue;
    return prefix;
  }
  return text;
}

function hasTransactionInterruption(text: string): boolean {
  // A buyer called "수정" or "아니카" is not a correction/negative command.
  let speech = text;
  for (const name of getBuyerNicknameCandidates(text)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    speech = speech.replace(new RegExp(`${escaped}(?=\\s*(?:님|언니|씨))`, 'gu'), '')
      .replace(new RegExp(`닉네임(?:은)?\\s*${escaped}(?=\\s|[,.!?]|$)`, 'gu'), '');
  }
  return TRANSACTION_INTERRUPTION.test(speech);
}

function isSafeFourPointClause(text: string): boolean {
  return !isQuestionUtterance(text) && !NON_ALLOCATION.test(text) && !hasTransactionInterruption(text);
}

interface AllocationClause {
  text: string;
  index: number;
  start: number;
}

/** Select the first allocation once; both sale paths keep the single-sale contract. */
function findAllocationClause(clauses: string[], includeFourPoint = false): AllocationClause | null {
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    const hasAction = ALLOCATION_ACTION.test(clause) || (includeFourPoint && FOUR_POINT_CONFIRMATION_PATTERN.test(clause));
    if (isQuestionUtterance(clause) || !hasAction || NON_ALLOCATION.test(clause)) continue;
    // A clear allocation with several possible names must stay visible for
    // review, even without a price; never promote one of those names by order.
    if (getBuyerNicknameCandidates(clause).length > 0) return { text: clause, index: i, start: i };
    let previousIndex = i - 1;
    while (previousIndex >= 0 && ALLOCATION_FILLER.test(clauses[previousIndex])) previousIndex--;
    const previous = clauses[previousIndex];
    // A short, stand-alone vocative can be a separate STT sentence.
    if (previous && /^(?:네[,，]?\s*)?[가-힣a-zA-Z0-9_]{2,20}\s*(?:언니|님|씨)(?:께|에게|한테)?$/u.test(previous)
      && parseBuyerNickname(previous)) return { text: clauses.slice(previousIndex, i + 1).join('. '), index: i, start: previousIndex };
    if (/구매\s*확정|낙찰|판매\s*완료|주문\s*확정|결제\s*완료|(?:넣어|담아|배정해)\s*드/u.test(clause)) return { text: clause, index: i, start: i };
    if (/캡처/u.test(clause)) {
      const precedingClauses = clauses.slice(Math.max(0, i - 2), i);
      const preceding = precedingClauses.join('. ');
      if (getBuyerNicknameCandidates(preceding).length > 0
        && precedingClauses.every((part) => isSafeFourPointClause(part) && !PRODUCT_TRANSITION.test(part))) {
        return { text: `${preceding}. ${clause}`, index: i, start: Math.max(0, i - 2) };
      }
    }
    // Keep a priced allocation as pending when STT loses the buyer's name.
    // Must be an active allocation action like 챙겨/넣어/담아/배정, not a general host price offer (드릴게요/해드릴게요).
    if (/(?:챙겨|넣어|담아|배정해)\s*드|챙겨\s*줄/u.test(clause) && extractSpeechPrice(clause)) return { text: clause, index: i, start: i };
  }
  return null;
}

/** Judge the verb and its own clause, rather than joining unrelated speech. */
export function findAllocationTranscript(text: string): string | null {
  const clauses = allocationClauses(text);
  const allocation = findAllocationClause(clauses);
  if (!allocation) return null;
  const initial = beforeProductChange(allocation.text, true);
  if (initial !== allocation.text) return initial;
  if (extractSpeechPrice(allocation.text)) return allocation.text;
  const names = new Set(getBuyerNicknameCandidates(allocation.text).map((name) => name.replace(/\s+/gu, '')));
  // Preserve the existing bounded follow-up price rules for ordinary sales.
  for (let j = allocation.index + 1; j < Math.min(clauses.length, allocation.index + 8); j++) {
    const next = clauses[j];
    if (PRODUCT_TRANSITION.test(next)) break;
    const priceClause = findExplicitPriceTranscript(next) || findStandalonePriceTranscript(next);
    if (priceClause) return `${allocation.text}. ${priceClause}`;
    const nextNames = getBuyerNicknameCandidates(next).map((name) => name.replace(/\s+/gu, ''));
    const repeatsAllocation = ALLOCATION_ACTION.test(next) && !NON_ALLOCATION.test(next) && !isQuestionUtterance(next)
      && !extractSpeechPrice(next) && nextNames.every((name) => names.has(name));
    if (!repeatsAllocation && !ALLOCATION_FILLER.test(next)) break;
  }
  return allocation.text;
}

function findFourPointEvidence(text: string): {
  allocationTranscript: string;
  validAllocation: boolean;
  hasCapture: boolean;
} {
  const clauses = allocationClauses(text);
  const allocation = findAllocationClause(clauses, true);
  if (!allocation) return { allocationTranscript: clauses[0] || '', validAllocation: false, hasCapture: false };

  // A product change can occur inside one STT sentence, without punctuation.
  const initial = beforeProductChange(allocation.text, true);
  const validAllocation = allocationClauses(initial).every(isSafeFourPointClause);
  const evidence = { allocationTranscript: initial, validAllocation, hasCapture: false };
  if (!validAllocation) return evidence;
  evidence.hasCapture = hasCaptureInstructionText(initial, { saleContext: true });

  const names = new Set(getBuyerNicknameCandidates(initial).map((name) => name.replace(/\s+/gu, '').toLowerCase()));
  let price = extractSpeechPrice(initial);
  // Capture may precede the first allocation, but never borrow a capture from
  // an earlier buyer/allocation. Only an initial standalone instruction qualifies.
  if (allocation.start === 1 && hasCaptureInstructionText(clauses[0], { saleContext: true })
    && isSafeFourPointClause(clauses[0]) && !PRODUCT_TRANSITION.test(clauses[0])
    && getBuyerNicknameCandidates(clauses[0]).length === 0 && !extractSpeechPrice(clauses[0])) {
    evidence.hasCapture = true;
  }
  if (initial !== allocation.text) return evidence;
  for (let j = allocation.index + 1; j < Math.min(clauses.length, allocation.index + 8); j++) {
    const next = beforeProductChange(clauses[j]);
    if (!next) break;
    const nextNames = getBuyerNicknameCandidates(next).map((name) => name.replace(/\s+/gu, '').toLowerCase());
    if (nextNames.some((name) => !names.has(name))) break;
    if (hasCaptureCancellationText(next)) {
      evidence.hasCapture = false;
      break;
    }
    if (!isSafeFourPointClause(next)) break;
    const priceClause = findExplicitPriceTranscript(next) || findStandalonePriceTranscript(next);
    const nextPrice = extractSpeechPrice(priceClause || next);
    // Preserve the existing rejection of an ambiguous first price declaration
    // that also introduces another product in the same clause.
    if (!price && nextPrice && next !== clauses[j]) break;
    // A second, different price is not a continuation of the selected sale.
    if (price && nextPrice && price.amount !== nextPrice.amount) break;
    const capture = hasCaptureInstructionText(next, { saleContext: true });
    const repeatsAllocation = (ALLOCATION_ACTION.test(next) || FOUR_POINT_CONFIRMATION_PATTERN.test(next))
      && (!nextPrice || nextNames.length === 1);
    if (!priceClause && !repeatsAllocation && !(capture && !nextPrice) && !ALLOCATION_FILLER.test(next)) break;
    if (!price && (priceClause || (repeatsAllocation && nextPrice))) {
      evidence.allocationTranscript += `. ${priceClause || next}`;
      price = nextPrice;
    } else if (repeatsAllocation && FOUR_POINT_CONFIRMATION_PATTERN.test(next)
      && !FOUR_POINT_CONFIRMATION_PATTERN.test(evidence.allocationTranscript)) {
      evidence.allocationTranscript += `. ${next}`;
    }
    evidence.hasCapture ||= capture;
    if (next !== clauses[j]) break;
  }
  return evidence;
}

/**
 * 실시간 전사 문장을 분석하여 판매 내역 정보 추출
 */
export function extractSaleFromTranscript(transcript: string, activeKeywords: string[] = []): ExtractedSaleResult | null {
  if (!transcript || transcript.trim().length < 3) return null;

  const text = splitTranscriptClauses(transcript).filter((part) => !isQuestionUtterance(part)).join('\n').trim();
  if (!text) return null;
  
  // 판매 멘트 감지 키워드 목록
  const saleTriggers = ['구매확정', '구매 확정', '구매하신 분', '구매하신분', '결제완료', '결제 완료', '주문확정', '낙찰', '판매완료'];
  const hasDecimal = /(?<!\d\.)(?<!\d)\d{1,3}\s*(?:[.]|점)\s*\d{1,2}(?!\.\d)(?!\s*(?:월|일|시|분|초|버전|ver))\b/u.test(text) ||
    /([영공일이삼사오육칠팔구십]+)\s*(?:[.]|점)\s*([영공일이삼사오육칠팔구]+)/u.test(text);

  // Keep intervening questions as boundaries when linking a following price.
  const fourPoint = checkFourPointSaleCriteria(transcript);
  const allocationTranscript = fourPoint.hasConfirmation && fourPoint.hasNickname
    ? fourPoint.allocationTranscript || null : findAllocationTranscript(transcript);
  const explicitConfirmation = /(?:구매\s*확정|낙찰|판매\s*완료|주문\s*확정|결제\s*완료)/u.test(text);
  const hasTrigger = Boolean(allocationTranscript) ||
    (text.includes('닉네임') && (hasDecimal || text.includes('원') || text.includes('금액') || text.includes('가격'))) ||
    (hasDecimal && Boolean(parseBuyerNickname(text)));

  const isMeasurementDescription = /(?:가단|가슴\s*단면|기장|길이|높이|폭|사이즈|센티|미터|\bcm\b)/iu.test(text)
    && !/(?:가격|금액)/u.test(text);

  if (!hasTrigger || (!allocationTranscript && (NON_ALLOCATION.test(text) || isMeasurementDescription))) {
    return null;
  }

  const evidenceText = allocationTranscript || text;
  const nickname = parseBuyerNickname(evidenceText) || parseBuyerNickname(text);

  // 1. 배정 문맥도 없고 확정도 없는데 닉네임까지 없으면 판매 아님
  if (!allocationTranscript && !nickname && !explicitConfirmation) {
    return null;
  }

  // 2. 닉네임과 명시적 확정이 없는 단순 호스트 가격 제안/안내 멘트는 적재 방지
  const isPureHostOffer = !nickname && !explicitConfirmation &&
    !/(?:챙겨|넣어|담아|배정해|가져가|먼저\s*하셨|캡처)/u.test(evidenceText) &&
    /(?:드릴게요|드릴께요|해드릴게요|해드릴께요|구매\s*가격이|구매가가)/u.test(evidenceText);
  if (isPureHostOffer) {
    return null;
  }

  const matchedKeywords: string[] = [];
  [...saleTriggers, '닉네임', '금액', '가격', '원', '캡처', ...activeKeywords].forEach(kw => {
    if (text.includes(kw) && !matchedKeywords.includes(kw)) {
      matchedKeywords.push(kw);
    }
  });
  if (hasDecimal && !matchedKeywords.includes('소수점가격')) {
    matchedKeywords.push('소수점가격');
  }

  // 4대 필수 멘트(고객 닉네임 + 확정멘트 + 가격 + 캡처멘트) 완벽 일치 우선 검사
  if (fourPoint.isFourPointSale && fourPoint.buyerNickname && fourPoint.amount && fourPoint.amount > 0) {
    const matchedKeywords: string[] = ['4단확정'];
    [...saleTriggers, '닉네임', '금액', '가격', '원', '캡처', '확정', '드릴게요', ...activeKeywords].forEach(kw => {
      if (text.includes(kw) && !matchedKeywords.includes(kw)) {
        matchedKeywords.push(kw);
      }
    });

    return {
      isSaleMent: true,
      buyerNickname: fourPoint.buyerNickname,
      amount: fourPoint.amount,
      status: '확정',
      rawTranscript: transcript.trim(),
      isPending: false,
      matchedKeywords,
      intent: 'ALLOCATION',
      allocationTranscript: fourPoint.allocationTranscript,
      buyerNicknamePhrase: getBuyerNicknamePhrase(fourPoint.allocationTranscript || '', fourPoint.buyerNickname) || undefined,
      isFourPointConfirmed: true,
    };
  }

  // 타 구문/타인 가격 오염 방지: 반드시 evidenceText에서만 가격 추출
  const amount = extractSpeechPrice(evidenceText)?.amount || null;

  // 닉네임이나 금액 중 하나라도 없으면 '보류' 상태로 지정
  const isPending = !allocationTranscript || !nickname || !amount || amount <= 0;
  const status: SaleStatus = isPending ? '보류' : '자동저장';

  return {
    isSaleMent: true,
    buyerNickname: nickname || '미확인(보류)',
    amount: amount || 0,
    status,
    rawTranscript: transcript.trim(),
    isPending,
    matchedKeywords,
    intent: allocationTranscript ? 'ALLOCATION' : 'UNCERTAIN',
    allocationTranscript: allocationTranscript || undefined,
    buyerNicknamePhrase: nickname
      ? getBuyerNicknamePhrase(evidenceText, nickname) || undefined : undefined,
    isFourPointConfirmed: false,
  };
}

/**
 * 단건 금액을 만 원 단위 소수점으로 변환 (예: 9,000원 -> "0.9", 17,000원 -> "1.7", 20,000원 -> "2.0")
 */
export function formatAmountAsDecimal(amount: number): string {
  if (!amount || amount <= 0) return '0.0';
  const val = amount / 10000;
  return val % 1 === 0 ? val.toFixed(1) : parseFloat(val.toFixed(2)).toString();
}

export interface MultiSaleAmountFormat {
  isMulti: boolean;
  itemDecimals: string[];
  decimalExpression: string;
  totalAmount: number;
  totalFormatted: string;
  displayFull: string;
}

/**
 * 다건/단건 구매자의 건당 소수점 금액 및 합계 금액 포맷팅
 * - 다건: 건당 금액은 소숫점으로 (예: 0.9) 표시하고 "+"를 붙이고 맨 뒤에 합계금액은 정상적인 금액표시로 쓴다. (예: "0.9 + 1.5 = 24,000원")
 * - 단건: "17,000원"
 */
export function formatMultiSaleAmount(amounts: number[]): MultiSaleAmountFormat {
  const validAmounts = (amounts || []).filter((a) => typeof a === 'number' && a > 0);
  const totalAmount = validAmounts.reduce((sum, a) => sum + a, 0);
  const totalFormatted = totalAmount > 0 ? `${totalAmount.toLocaleString()}원` : '금액 미확인';

  if (validAmounts.length <= 1) {
    return {
      isMulti: false,
      itemDecimals: validAmounts.map(formatAmountAsDecimal),
      decimalExpression: validAmounts.map(formatAmountAsDecimal).join(' + '),
      totalAmount,
      totalFormatted,
      displayFull: totalFormatted
    };
  }

  const itemDecimals = validAmounts.map(formatAmountAsDecimal);
  const decimalExpression = itemDecimals.join(' + ');
  const displayFull = `${decimalExpression} = ${totalFormatted}`;

  return {
    isMulti: true,
    itemDecimals,
    decimalExpression,
    totalAmount,
    totalFormatted,
    displayFull
  };
}
