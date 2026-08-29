import { CustomerPurchaseClaim, FieldMatchResult, MatchStatus, SmsMessage } from '../types/commerce';
import { SaleRecord } from '../types/live';

const normalize = (value: string) => value.replace(/\s+/g, '').replace(/님$/u, '').toLowerCase();

const readField = (body: string, labels: string[]): string => {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = body.match(new RegExp(`(?:${escaped})\\s*[:：]?\\s*([^\\n,]+)`, 'iu'));
  return match?.[1]?.trim() || '';
};

const readAmount = (body: string): number | null => {
  const field = readField(body, ['가격', '금액', '입금액', '구매금액']);
  const source = field || body;
  const numeric = source.match(/([0-9][0-9,]*)\s*원?/u);
  if (!numeric) return null;
  const amount = Number(numeric[1].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
};

export interface ParsedCustomerMessage {
  nickname: string;
  address: string;
  productName: string;
  amount: number | null;
}

export function parseCustomerMessage(body: string): ParsedCustomerMessage {
  return {
    nickname: readField(body, ['닉네임', '구매자', '이름']),
    address: readField(body, ['주소', '배송지', '받는곳']),
    productName: readField(body, ['구매상품', '상품명', '상품', '제품']),
    amount: readAmount(body)
  };
}

export function chooseMatchingSales(parsed: ParsedCustomerMessage, sales: SaleRecord[]): SaleRecord[] {
  const ranked = sales
    .map((sale) => {
      let score = 0;
      if (parsed.nickname && normalize(sale.buyerNickname) === normalize(parsed.nickname)) score += 8;
      if (parsed.amount !== null && sale.amount === parsed.amount) score += 5;
      if (parsed.productName && sale.productName && normalize(sale.productName) === normalize(parsed.productName)) score += 3;
      return { sale, score };
    })
    .filter(({ score }) => score >= 5)
    .sort((a, b) => b.score - a.score || new Date(b.sale.recognizedAt).getTime() - new Date(a.sale.recognizedAt).getTime());

  if (ranked.length === 0) return [];
  const best = ranked[0];
  return ranked
    .filter(({ score, sale }) => score === best.score && sale.sessionId === best.sale.sessionId)
    .map(({ sale }) => sale);
}

export function compareClaimWithSales(
  claim: Pick<CustomerPurchaseClaim, 'nickname' | 'amount' | 'captureImageUrls'>,
  sales: SaleRecord[]
): { status: MatchStatus; fields: FieldMatchResult } {
  if (sales.length === 0) {
    return {
      status: 'NEEDS_REVIEW',
      fields: { nickname: null, amount: null, capture: null }
    };
  }

  const expectedNickname = sales[0].buyerNickname;
  const expectedAmount = sales.reduce((sum, sale) => sum + (sale.amount || 0), 0);
  const expectedHasCapture = sales.some((sale) => (sale.captureImageUrls?.length || 0) > 0);
  const nickname = claim.nickname ? normalize(claim.nickname) === normalize(expectedNickname) : null;
  const amount = claim.amount !== null ? claim.amount === expectedAmount : null;
  const capture = claim.captureImageUrls.length > 0 ? expectedHasCapture : null;
  const compared = [nickname, amount, capture].filter((value): value is boolean => value !== null);
  const status: MatchStatus = compared.length === 0
    ? 'NEEDS_REVIEW'
    : compared.every(Boolean)
      ? 'MATCHED'
      : 'MISMATCH';

  return { status, fields: { nickname, amount, capture } };
}

export function buildClaimFromMessage(message: SmsMessage, sales: SaleRecord[]): CustomerPurchaseClaim {
  const parsed = parseCustomerMessage(message.body);
  const matchedSales = chooseMatchingSales(parsed, sales);
  const captureImageUrls = message.attachments
    .filter((attachment) => attachment.mimeType.startsWith('image/'))
    .map((attachment) => attachment.dataUrl);
  const comparison = compareClaimWithSales({ ...parsed, captureImageUrls }, matchedSales);
  const now = new Date().toISOString();

  return {
    id: `claim-${message.id}`,
    messageId: message.id,
    phoneNumber: message.phoneNumber,
    nickname: parsed.nickname,
    address: parsed.address,
    productName: parsed.productName,
    amount: parsed.amount,
    captureImageUrls,
    saleIds: matchedSales.map((sale) => sale.id),
    matchStatus: comparison.status,
    fieldMatches: comparison.fields,
    sellerNote: '',
    createdAt: message.receivedAt || message.createdAt || now,
    updatedAt: now
  };
}

