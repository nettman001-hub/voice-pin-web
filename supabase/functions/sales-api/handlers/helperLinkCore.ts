/**
 * Windows 댓글도우미 ↔ Android 판매 앱 연결의 순수 로직(시험 가능).
 * 계약 문서: docs/helper-android-link/CONTRACT.md
 */

/** 로그인 없이 부르는 등록 시작·완료 확인. 비밀값과 확인코드로만 진행한다. */
export const HELPER_PUBLIC_ACTIONS = new Set(['helper-register-begin', 'helper-register-poll']);

/** 등록된 도우미 기기(x-voicecap-device-token, HELPER_COMMENTS)만 부를 수 있는 액션. */
export const HELPER_DEVICE_ACTIONS = new Set([
  'helper-heartbeat',
  'helper-set-enabled',
  'helper-pair-issue',
  'helper-pair-cancel',
  'helper-pair-decide',
  'helper-unlink',
  'helper-push',
  'helper-comment-key',
  'helper-unregister',
]);

/** 로그인한 판매자(웹·폰)가 부르는 액션. */
export const HELPER_USER_ACTIONS = new Set([
  'helper-register-approve',
  'helper-pair-claim',
  'helper-phone-status',
  'helper-attach',
  'helper-detach',
  'helper-pull',
  'helper-phone-unlink',
]);

export const HELPER_CAPABILITY = 'HELPER_COMMENTS';

const REG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomBytes(n: number) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** PC 등록 확인코드: 혼동 글자 없는 8자, "ABCD-EFGH". */
export function newRegistrationCode() {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += REG_ALPHABET[b % REG_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeRegistrationCode(input: unknown) {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8 || [...s].some((c) => !REG_ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 폰 연결 인증번호: 6자리 숫자. */
export function newPairCode() {
  const bytes = randomBytes(4);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

export function normalizePairCode(input: unknown) {
  const s = String(input ?? '').replace(/\D/g, '');
  return s.length === 6 ? s : null;
}

/** 서버가 발급하는 비밀 토큰(기기·폰 연결). 원문은 한 번만 돌려주고 해시만 저장한다. */
export function newSecretToken(prefix: string) {
  const bytes = randomBytes(32);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${prefix}_${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export const registrationCodeHashInput = (code: string) => `helper-reg:${code}`;
export const pairCodeHashInput = (workspaceId: string, code: string) => `helper-pair:${workspaceId}:${code}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const cleanText = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

export function cleanHelperName(v: unknown) {
  return cleanText(v, 60) || 'Windows PC';
}

export function cleanPhoneName(v: unknown) {
  return cleanText(v, 60) || 'Android';
}

export function cleanInstallId(v: unknown) {
  const s = cleanText(v, 80);
  return /^[A-Za-z0-9._:-]{8,80}$/.test(s) ? s : null;
}

export function isSecret(v: unknown, prefix: string): v is string {
  return typeof v === 'string' && v.startsWith(`${prefix}_`) && v.length >= prefix.length + 40 && v.length <= 120;
}

/** 도우미가 보내는 수집 상태(폰에 그대로 보여 준다). 알 수 없는 키는 버린다. */
export function cleanCollectorState(input: any) {
  const state = ['idle', 'connecting', 'collecting', 'waiting_live', 'ended', 'error', 'blocked'].includes(input?.tiktok)
    ? input.tiktok : 'idle';
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), 1e9) : 0);
  return {
    tiktok: state,
    username: cleanText(input?.username, 40).replace(/^@/, ''),
    message: cleanText(input?.message, 160),
    lastCommentAt: typeof input?.lastCommentAt === 'string' ? input.lastCommentAt.slice(0, 40) : null,
    pending: num(input?.pending),
    dropped: num(input?.dropped),
    queueError: cleanText(input?.queueError, 160),
    version: cleanText(input?.version, 20),
  };
}

export type HelperPushComment = {
  platformMessageId: string;
  platformUserId?: string;
  uniqueId?: string;
  nickname: string;
  content: string;
  capturedAt: string;
};

/** 댓글 배치 검사. 잘못된 항목은 거르지 않고 배치 전체를 거절한다(도우미가 고쳐 보낼 수 없으므로 이유를 남긴다). */
export function validatePushBatch(body: any): { error: string } | { comments: HelperPushComment[] } {
  if (!isUuid(body?.sessionId)) return { error: 'sessionId가 올바르지 않습니다.' };
  if (!Number.isInteger(body?.generation) || body.generation < 1) return { error: 'generation이 올바르지 않습니다.' };
  if (!isUuid(body?.batchId)) return { error: 'batchId가 올바르지 않습니다.' };
  if (!Array.isArray(body?.comments) || body.comments.length < 1 || body.comments.length > 200)
    return { error: '댓글은 한 번에 1~200건입니다.' };
  const comments: HelperPushComment[] = [];
  for (const c of body.comments) {
    const id = cleanText(c?.platformMessageId, 120);
    const content = cleanText(c?.content, 500);
    const capturedAt = typeof c?.capturedAt === 'string' && !Number.isNaN(Date.parse(c.capturedAt)) ? c.capturedAt : '';
    if (!id || !content || !capturedAt) return { error: '댓글 ID·내용·수신 시각은 필수입니다.' };
    comments.push({
      platformMessageId: id,
      platformUserId: cleanText(c?.platformUserId, 80) || undefined,
      uniqueId: cleanText(c?.uniqueId, 80).replace(/^@/, '') || undefined,
      nickname: cleanText(c?.nickname, 120) || cleanText(c?.uniqueId, 80) || '알 수 없음',
      content,
      capturedAt,
    });
  }
  return { comments };
}

/** RPC 결과 코드 → HTTP 상태와 재시도 가능 여부. */
export const HELPER_ERRORS: Record<string, { status: number; message: string; retryable?: boolean }> = {
  RATE_LIMITED: { status: 429, message: '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.', retryable: true },
  CODE_COLLISION: { status: 409, message: '코드를 다시 만들어 주세요.', retryable: true },
  CODE_INVALID: { status: 400, message: '인증번호가 맞지 않거나 시간이 지났습니다.' },
  REGISTRATION_NOT_FOUND: { status: 404, message: '등록 요청을 찾을 수 없습니다.' },
  REGISTRATION_EXPIRED: { status: 410, message: '등록 요청 시간이 지났습니다. 도우미에서 다시 시작해 주세요.' },
  HELPER_NOT_FOUND: { status: 401, message: '도우미 등록이 해제되었습니다. 다시 등록해 주세요.' },
  REQUEST_NOT_FOUND: { status: 404, message: '폰 연결 요청을 찾을 수 없습니다.' },
  REQUEST_CLOSED: { status: 409, message: '이미 처리된 폰 연결 요청입니다.' },
  REQUEST_EXPIRED: { status: 410, message: '폰 연결 요청 시간이 지났습니다. 인증번호를 다시 발급해 주세요.' },
  PHONE_ALREADY_LINKED: { status: 409, message: '이미 연결된 폰이 있습니다. 먼저 기존 폰 연결을 해제해 주세요.' },
  LINK_NOT_FOUND: { status: 404, message: '폰 연결을 찾을 수 없습니다.' },
  LINK_NOT_ACTIVE: { status: 403, message: 'PC 댓글도우미 연결이 승인되지 않았거나 해제되었습니다.' },
  RUN_NOT_ACTIVE: { status: 409, message: '이 폰의 판매가 시작되지 않았습니다.', retryable: true },
  HELPER_DISABLED: { status: 409, message: '댓글 연결이 꺼져 있습니다.' },
  STALE_GENERATION: { status: 409, message: '전달 세대가 바뀌었습니다.' },
  SESSION_INACTIVE: { status: 409, message: '전달 중인 판매 회차가 없습니다.' },
  VALIDATION_ERROR: { status: 400, message: '요청 형식이 올바르지 않습니다.' },
};
