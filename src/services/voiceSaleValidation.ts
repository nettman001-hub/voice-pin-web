const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared request validation; never reconstruct missing buyer/speech evidence. */
export function invalidVoiceSaleFields(operationId: unknown, value: unknown): string[] {
  const sale = value as Record<string, unknown> | null;
  if (!sale || typeof sale !== 'object') return ['sale'];
  const fields: string[] = [];
  if (typeof operationId !== 'string' || !UUID.test(operationId)) fields.push('operationId');
  if (typeof sale.id !== 'string' || !sale.id.startsWith('s-') || !UUID.test(sale.id.slice(2))) fields.push('sale.id');
  if (typeof sale.sessionId !== 'string' || !UUID.test(sale.sessionId)) fields.push('sale.sessionId');
  const prefix = `${sale.sessionId}:`;
  if (typeof sale.purchaseRequestId !== 'string' || !sale.purchaseRequestId.startsWith(prefix)
      || !sale.purchaseRequestId.slice(prefix.length).trim()) fields.push('sale.purchaseRequestId');
  if (typeof sale.rawTranscript !== 'string' || sale.rawTranscript.trim().length < 3) fields.push('sale.rawTranscript');
  return fields;
}

export function voiceSaleValidationMessage(fields: string[]): string {
  const labels: Record<string, string> = {
    sale: '판매 데이터',
    operationId: '판매 요청 ID',
    'sale.id': '판매 ID',
    'sale.sessionId': '서버 방송 회차 ID',
    'sale.purchaseRequestId': '해당 회차의 구매 댓글 연결',
    'sale.rawTranscript': '판매자 발화 근거',
  };
  return `음성 판매 저장 근거를 확인해 주세요: ${fields.map((field) => labels[field] || field).join(', ')}.`;
}
