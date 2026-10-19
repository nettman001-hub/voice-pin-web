import type { SaleRecord } from '../types/live.ts';

/** 서버가 이미 같은 판매 ID를 갖고 있다는 거절: 덮어쓰면 서버의 판매가 바뀌므로 대체하지 않는다. */
const SERVER_HAS_SALE = new Set(['SALE_ALREADY_FINAL', 'OPERATION_PAYLOAD_MISMATCH']);

/** 서버 장애나 인증·권한 오류는 판매 근거 거절이 아니므로 일반 저장으로 우회하지 않는다. */
const NON_EVIDENCE_ERRORS = new Set(['DATABASE_ERROR', 'TEMPORARILY_UNAVAILABLE', 'AUTH_REQUIRED', 'CAPABILITY_DENIED']);

/** 구매 댓글 업로드를 기다리는 동안은 재시도하고, 이 시간이 지나면 검토 표시를 붙여 서버에 남긴다. */
export const COMMENT_SYNC_WAIT_MS = 10 * 60 * 1000;

interface SaveError {
  code?: string;
  message?: string;
  retryable?: boolean;
}

export const SERVER_REVIEW_MARK = '[서버 확인 필요]';

/** 서버가 근거를 문제 삼았지만 판매자 검토용으로 그대로 저장된 판매인지 */
export const needsServerReview = (sale: Pick<SaleRecord, 'note'>): boolean =>
  Boolean(sale.note?.includes(SERVER_REVIEW_MARK));

/** 판매자가 확인한 기록과 서버 사유는 남기고, 검토 대기 표시만 완료로 바꾼다. */
export function markServerReviewCompleted(sale: SaleRecord): SaleRecord {
  if (!needsServerReview(sale)) return sale;
  return { ...sale, note: sale.note!.split(SERVER_REVIEW_MARK).join('[판매자 확인 완료]') };
}

/**
 * 서버가 자동 판매의 근거를 받아들이지 않아도 판매를 이 브라우저에만 "서버 저장 대기"로
 * 남기지 않는다. 화면에 보이는 상태(자동저장·확정) 그대로 일반 판매로 서버에 저장하고
 * "서버 확인 필요" 사유를 붙여 판매자가 검토하게 한다. 다른 컴퓨터에서도 보이고 합계에도 들어간다.
 * 대체할 대상이 아니면 null (예전처럼 재시도하거나 대기).
 */
export function heldAfterServerRejection(sale: SaleRecord, error: unknown, now = Date.now()): SaleRecord | null {
  if (sale.source !== 'WEB_VOICE' || !sale.purchaseRequestId) return null;
  if (sale.status !== '자동저장' && sale.status !== '확정') return null;
  const failure = (error && typeof error === 'object' ? error : {}) as SaveError;
  const code = failure.code;
  if (code && (SERVER_HAS_SALE.has(code) || NON_EVIDENCE_ERRORS.has(code))) return null;
  if (failure.retryable !== false) {
    // 네트워크·서버 오류는 계속 재시도한다. 댓글 업로드 대기만 오래되면 검토 표시를 붙여 저장한다.
    if (code !== 'COMMENT_NOT_SYNCED') return null;
    const age = now - Date.parse(sale.recognizedAt);
    if (!(age > COMMENT_SYNC_WAIT_MS)) return null;
  }
  const reason = `${SERVER_REVIEW_MARK} ${failure.message || '서버가 판매 근거를 확인하지 못했습니다.'}${code ? ` (${code})` : ''}`;
  return {
    ...sale,
    // 늦게 저장되는 판매가 갑자기 전표로 출력되지 않게 한다. 필요하면 판매자가 다시 출력한다.
    printStatus: 'NOT_REQUESTED',
    // 같은 구매 요청으로 이미 저장된 판매가 있으면 서버의 중복 방지 색인에 걸리므로 연결을 풀고 일반 저장으로 보낸다.
    purchaseRequestId: undefined,
    note: sale.note ? `${sale.note} / ${reason}` : reason,
  };
}
