/** Shared deterministic rules; no voice model, STT, network or UI dependency. */
export function parseTouchPrice(input: string): { amount: number | null; error: string | null } {
  if (!/^(?:\d{1,8}(?:\.\d{0,4})?|\.\d{1,4})$/.test(input)) return { amount: null, error: '가격을 숫자로 입력해 주세요.' };
  const value = Number(input);
  if (value <= 0) return { amount: null, error: '0원보다 큰 가격을 입력해 주세요.' };
  if (value >= 100 && value < 1000) return { amount: null, error: '단위를 확인해 주세요. 1.5 또는 15000처럼 입력하세요.' };
  if (value >= 1000 && !Number.isInteger(value)) return { amount: null, error: '원 단위 가격은 정수로 입력해 주세요.' };
  const amount = value < 100 ? Math.round(value * 10000) : value;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 99999999) return { amount: null, error: '가격 범위를 확인해 주세요.' };
  return { amount, error: null };
}
export function validateTouchCommit(body: Record<string, any>): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(body.operationId || '') || !uuid.test(body.sessionId || '')) return '작업 번호와 방송 회차가 필요합니다.';
  if (!body.comment || typeof body.comment !== 'object') return '선택한 댓글이 필요합니다.';
  for (const field of ['platformMessageId', 'nickname', 'content', 'capturedAt']) {
    if (typeof body.comment[field] !== 'string' || !body.comment[field].trim()) return '선택한 댓글 원문과 계정 정보를 확인해 주세요.';
  }
  if (body.comment.content.length > 4000 || body.comment.nickname.length > 200 || body.comment.platformMessageId.length > 250) return '댓글 정보가 너무 깁니다.';
  for (const field of ['platformUserId', 'uniqueId']) if (body.comment[field] != null
    && (typeof body.comment[field] !== 'string' || body.comment[field].length > 250)) return '계정 정보를 확인해 주세요.';
  const parsed = parseTouchPrice(String(body.inputPrice || ''));
  if (parsed.error || parsed.amount !== body.unitPrice) return parsed.error || '입력한 가격과 저장 금액이 다릅니다.';
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 999
    || body.quantity * body.unitPrice > 99999999) return '수량 또는 총금액 범위를 확인해 주세요.';
  if (!Number.isFinite(Date.parse(body.confirmedAt)) || !Number.isFinite(Date.parse(body.comment.capturedAt))) return '판매·댓글 시각이 올바르지 않습니다.';
  if (body.productId && !uuid.test(body.productId)) return '상품 번호가 올바르지 않습니다.';
  return null;
}
