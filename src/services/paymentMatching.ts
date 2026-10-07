// 입금 내역을 정산서에 연결하는 규칙. 웹과 sms-bridge Edge Function이 같은 코드를 쓴다.
// 금액만 같고 이름 근거가 없으면 자동 확정하지 않는다: 판매자 계좌에는 관계없는 입금도
// 들어오므로, 잘못 확정되면 미입금 주문이 입금완료로 바뀌어 그대로 발송될 수 있다.

export const UNKNOWN_PAYER = '미확인';
export const MATCH_WINDOW_DAYS = 14;
const OPEN_INVOICE_STATUSES = new Set(['QUEUED', 'SENT']);
// 0/O, 1/I/L처럼 헷갈리는 글자는 뺀다.
const DEPOSIT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEPOSIT_CODE_LENGTH = 4;

export interface MatchableInvoice {
  id: string;
  customerNickname: string;
  amount: number;
  status: string;
  saleIds: string[];
  depositCode?: string | null;
  createdAt: string;
}

export interface MatchablePayment {
  payerName: string;
  amount: number;
  paidAt: string;
}

export type PaymentMatchReason =
  | 'DEPOSIT_CODE'
  | 'NICKNAME'
  | 'ALIAS'
  | 'AMOUNT_ONLY'
  | 'MULTIPLE'
  | 'CODE_AMOUNT_MISMATCH'
  | 'COMBINED'
  | 'NONE';

export interface PaymentMatchResult {
  status: 'MATCHED' | 'NEEDS_REVIEW' | 'UNMATCHED';
  reason: PaymentMatchReason;
  /** MATCHED일 때 연결된 정산서 */
  invoiceId?: string;
  saleIds: string[];
  /** NEEDS_REVIEW일 때 판매자가 고를 정산서 후보 (첫 번째가 추천) */
  candidateIds: string[];
}

/** 이름 비교용: 공백·괄호 등 기호와 끝의 "님"을 무시하고 소문자로. 괄호 안 글자(입금코드 등)는 남긴다. */
export const normalizePayerName = (value: string | null | undefined): string =>
  String(value ?? '')
    .replace(/[\s()[\]{}<>._\-/·*]+/gu, '')
    .replace(/님$/u, '')
    .toLowerCase();

export const isUnknownPayer = (value: string | null | undefined): boolean => {
  const normalized = normalizePayerName(value);
  return !normalized || normalized === normalizePayerName(UNKNOWN_PAYER);
};

export function generateDepositCode(usedCodes: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(Array.from(usedCodes, (code) => code.toUpperCase()));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = '';
    for (let index = 0; index < DEPOSIT_CODE_LENGTH; index += 1) {
      code += DEPOSIT_CODE_ALPHABET[Math.floor(random() * DEPOSIT_CODE_ALPHABET.length) % DEPOSIT_CODE_ALPHABET.length];
    }
    if (!used.has(code)) return code;
  }
  throw new Error('입금코드를 만들 수 없습니다. 미결 정산서를 정리한 뒤 다시 시도해 주세요.');
}

export const isOpenInvoice = (invoice: Pick<MatchableInvoice, 'status'>): boolean =>
  OPEN_INVOICE_STATUSES.has(invoice.status);

const withinWindow = (invoice: MatchableInvoice, paidAt: string, windowDays: number): boolean => {
  const paidTime = new Date(paidAt).getTime();
  const createdTime = new Date(invoice.createdAt).getTime();
  if (!Number.isFinite(paidTime) || !Number.isFinite(createdTime)) return true;
  return createdTime >= paidTime - windowDays * 86_400_000;
};

const byNewest = (left: MatchableInvoice, right: MatchableInvoice) =>
  new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();

const matched = (invoice: MatchableInvoice, reason: PaymentMatchReason): PaymentMatchResult => ({
  status: 'MATCHED',
  reason,
  invoiceId: invoice.id,
  saleIds: [...invoice.saleIds],
  candidateIds: [],
});

const review = (invoices: MatchableInvoice[], reason: PaymentMatchReason): PaymentMatchResult => ({
  status: 'NEEDS_REVIEW',
  reason,
  saleIds: [],
  candidateIds: invoices.map((invoice) => invoice.id),
});

const decide = (invoices: MatchableInvoice[], reason: PaymentMatchReason): PaymentMatchResult | null => {
  if (invoices.length === 1) return matched(invoices[0], reason);
  if (invoices.length > 1) return review(invoices, reason);
  return null;
};

/**
 * @param aliases 정규화한 입금자명 → 구매 닉네임 (depositor_aliases)
 */
export function matchPayment(
  payment: MatchablePayment,
  invoices: MatchableInvoice[],
  aliases: ReadonlyMap<string, string> = new Map(),
  windowDays = MATCH_WINDOW_DAYS,
): PaymentMatchResult {
  const open = invoices
    .filter((invoice) => isOpenInvoice(invoice) && withinWindow(invoice, payment.paidAt, windowDays))
    .sort(byNewest);
  const sameAmount = open.filter((invoice) => invoice.amount === payment.amount);
  const payer = normalizePayerName(payment.payerName);
  const knownPayer = !isUnknownPayer(payment.payerName);
  const aliasNickname = knownPayer ? normalizePayerName(aliases.get(payer)) : '';
  const isBuyer = (invoice: MatchableInvoice) => {
    const nickname = normalizePayerName(invoice.customerNickname);
    return Boolean(nickname) && (nickname === payer || nickname === aliasNickname);
  };
  const hasCode = (invoice: MatchableInvoice) =>
    Boolean(invoice.depositCode) && payer.includes(normalizePayerName(invoice.depositCode));

  if (knownPayer) {
    const byCode = decide(sameAmount.filter(hasCode), 'DEPOSIT_CODE');
    if (byCode) return byCode;
    const byNickname = decide(
      sameAmount.filter((invoice) => normalizePayerName(invoice.customerNickname) === payer),
      'NICKNAME',
    );
    if (byNickname) return byNickname;
    if (aliasNickname) {
      const byAlias = decide(
        sameAmount.filter((invoice) => normalizePayerName(invoice.customerNickname) === aliasNickname),
        'ALIAS',
      );
      if (byAlias) return byAlias;
    }
  }

  if (sameAmount.length === 1) return review(sameAmount, 'AMOUNT_ONLY');
  if (sameAmount.length > 1) {
    // 이름이 비슷한 후보를 앞에 둔다(추천 순서).
    const ranked = [...sameAmount].sort((left, right) => Number(isBuyer(right)) - Number(isBuyer(left)));
    return review(ranked, 'MULTIPLE');
  }

  if (knownPayer) {
    const coded = open.filter(hasCode);
    if (coded.length > 0) return review(coded, 'CODE_AMOUNT_MISMATCH');
    const buyerInvoices = open.filter(isBuyer);
    const total = buyerInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
    if (buyerInvoices.length > 1 && total === payment.amount) return review(buyerInvoices, 'COMBINED');
  }

  return { status: 'UNMATCHED', reason: 'NONE', saleIds: [], candidateIds: [] };
}

/** 판매자가 확인 필요 입금을 정산서(들)에 직접 연결할 때 저장할 값. */
export function confirmPaymentInvoices(invoices: MatchableInvoice[]): Pick<PaymentMatchResult, 'invoiceId' | 'saleIds'> {
  return {
    invoiceId: invoices[0]?.id,
    saleIds: Array.from(new Set(invoices.flatMap((invoice) => invoice.saleIds))),
  };
}

/**
 * 입금자명 별칭을 새로 알게 됐을 때 할 일. 같은 입금자명이 이미 다른 닉네임에 묶여 있으면(동명이인)
 * 'ambiguous': 닉네임을 빈 값으로 바꿔 이후 그 이름의 입금은 자동 확정하지 않는다.
 */
export function decideAliasUpdate(
  existingNickname: string | null | undefined,
  buyerNickname: string,
): 'insert' | 'keep' | 'ambiguous' {
  if (existingNickname === null || existingNickname === undefined) return 'insert';
  const known = normalizePayerName(existingNickname);
  if (!known) return 'keep';
  return known === normalizePayerName(buyerNickname) ? 'keep' : 'ambiguous';
}
