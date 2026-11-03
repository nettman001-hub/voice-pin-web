/**
 * 폰 단독 판매의 댓글 받기: Euler 클라우드 웹소켓(JSON 모드)에 폰이 직접 붙는다.
 * 연결 정보(짧은 토큰 또는 키)는 sales-api touch-comment-token에서 연결할 때마다 받고 저장하지 않는다.
 * JSON 댓글 묶음과 문자열/숫자 형태의 방송 연결 상태를 해석한다.
 */
export const EULER_WS_URL = 'wss://ws.eulerstream.com';

export type EulerComment = {
  id: string;
  uniqueId: string;
  nickname: string;
  userId?: string;
  content: string;
  receivedAt: string;
};
export type EulerParsed = {
  comments: EulerComment[];
  /** connecting · connected · reconnecting · offline · ended · error */
  roomStates: string[];
  types: string[];
};
export type CommentToken = {
  mode: 'JWT' | 'KEY';
  uniqueId: string;
  jwtKey?: string;
  apiKey?: string;
  expiresAt?: number;
};

export function eulerSocketUrl(token: CommentToken) {
  const params = new URLSearchParams({ uniqueId: token.uniqueId });
  if (token.jwtKey) params.set('jwtKey', token.jwtKey);
  else if (token.apiKey) params.set('apiKey', token.apiKey);
  params.set('features.bundleEvents', 'true');
  params.set('features.rawMessages', 'false');
  return `${EULER_WS_URL}?${params.toString()}`;
}

/** 닫힘 코드 뜻. terminal이면 같은 정보로 다시 붙어도 소용없다. */
export function eulerCloseInfo(code: number) {
  const map: Record<number, [string, 'retry' | 'later' | 'token' | 'stop']> = {
    1000: ['정상 종료', 'retry'],
    1006: ['연결 끊김', 'retry'],
    1011: ['댓글 서버 오류', 'retry'],
    4005: ['방송이 끝났습니다', 'later'],
    4006: ['한동안 댓글이 없어 끊겼습니다', 'retry'],
    4400: ['연결 정보가 올바르지 않습니다', 'stop'],
    4401: ['댓글 연결 키가 맞지 않습니다', 'token'],
    4403: ['이 틱톡 ID에 연결할 권한이 없습니다', 'stop'],
    4404: ['아직 방송 중이 아닙니다', 'later'],
    4408: ['응답이 없어 끊겼습니다', 'retry'],
    4429: ['동시에 연결한 기기가 너무 많습니다', 'later'],
    4500: ['틱톡이 연결을 끊었습니다', 'retry'],
    4555: ['연결 시간이 다 됐습니다', 'token'],
    4556: ['틱톡 댓글을 읽지 못했습니다', 'retry'],
    4557: ['방송 정보를 읽지 못했습니다', 'later'],
  };
  const [message, action] = map[code] || [`연결 끊김 (${code})`, 'retry'];
  return { code, message, action };
}

const str = (v: unknown) =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' ? String(v) : '';

function parseJsonString(value: unknown) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function chatFrom(data: any, fallbackId: string): EulerComment | null {
  if (!data || typeof data !== 'object') return null;
  const content = str(data.content ?? data.comment ?? data.text).trim();
  if (!content) return null;
  const user = data.user || data.userInfo || data.author || {};
  const uniqueId = str(user.uniqueId ?? user.displayId ?? user.unique_id ?? data.uniqueId).replace(/^@/, '');
  const nickname = str(user.nickname ?? user.nickName ?? data.nickname) || uniqueId || '알 수 없음';
  const userId = str(user.userId ?? user.id ?? user.id_str ?? data.userId) || undefined;
  const id =
    str(data.common?.msgId ?? data.common?.msg_id ?? data.msgId ?? data.event?.msgId ?? data.id) ||
    fallbackId;
  return { id, uniqueId, nickname, userId, content, receivedAt: new Date().toISOString() };
}

const isChatType = (type: string) => /chat/i.test(type) && !/emote|sticker/i.test(type);
const roomState = (value: unknown) => {
  const numeric = ['unspecified', 'connecting', 'connected', 'reconnecting', 'offline', 'ended', 'error'];
  if (typeof value === 'number') return numeric[value] || '';
  return str(value).toLowerCase().replace(/^room_status_state_/, '');
};

/** 한 메시지(JSON 문자열 또는 객체)에서 댓글과 방 상태를 꺼낸다. */
export function parseEulerPayload(input: unknown, seed = Date.now()): EulerParsed {
  const out: EulerParsed = { comments: [], roomStates: [], types: [] };
  const root = parseJsonString(input) as any;
  if (!root || typeof root !== 'object') return out;
  let n = 0;
  const visit = (item: any, depth: number) => {
    if (!item || typeof item !== 'object' || depth > 4) return;
    if (Array.isArray(item)) {
      for (const x of item) visit(x, depth + 1);
      return;
    }
    if (Array.isArray(item.messages)) {
      for (const x of item.messages) visit(x, depth + 1);
      return;
    }
    if (Array.isArray(item.events)) {
      for (const x of item.events) visit(x, depth + 1);
      return;
    }
    if (item.roomStatusEvent) return visit({ type: 'roomStatus', data: item.roomStatusEvent }, depth + 1);
    if (item.customEvent) return visit(item.customEvent, depth + 1);
    const type = str(item.type ?? item.event ?? item.name ?? item.method);
    if (type) out.types.push(type);
    const data =
      item.data !== undefined
        ? parseJsonString(item.data)
        : item.json !== undefined
          ? parseJsonString(item.json)
          : item.payload !== undefined && typeof item.payload !== 'string'
            ? item.payload
            : item;
    if (/roomstatus|room_status/i.test(type) || (data && typeof data.state === 'string' && !type)) {
      const state = roomState(data?.state);
      if (state) out.roomStates.push(state);
      return;
    }
    if (isChatType(type) || (!type && data && (data.comment || data.content) && data.user)) {
      const chat = chatFrom(data, `${seed}-${n++}`);
      if (chat) out.comments.push(chat);
    }
  };
  visit(root, 0);
  return out;
}

export type EulerStatus =
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'waiting'; message: string }
  | { state: 'error'; message: string }
  | { state: 'stopped' };

export interface EulerStreamOptions {
  getToken: () => Promise<CommentToken>;
  onComments: (comments: EulerComment[]) => void;
  onStatus?: (status: EulerStatus) => void;
  /** 시험 화면용: 받은 원문 앞부분. */
  onRaw?: (text: string) => void;
  socketFactory?: (url: string) => WebSocket;
  /** Connection metadata only: no token, URL, nickname or comment contents. */
  onDiagnostic?: (event: { reason: string; at: number; closeCode?: number; idleMs: number }) => void;
}

export const EULER_HEALTH = { tokenTimeoutMs: 15000, connectTimeoutMs: 20000, idleTimeoutMs: 90000, roomTimeoutMs: 20000, checkEveryMs: 5000 };

/** 다시 붙기: 일반 끊김은 2·4·8…최대 30초, 방송 전/종료는 15초, 토큰 만료는 새 토큰으로 바로. */
export class EulerCommentStream {
  private socket: WebSocket | null = null;
  private stopped = true;
  private terminal = false;
  private token: CommentToken | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private monitor: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private seen = new Set<string>();
  private phase: 'token' | 'opening' | 'open' | 'retry' | 'stopped' = 'stopped';
  private phaseSince = 0;
  private roomStalledAt: number | null = null;
  lastMessageAt = 0;
  private options: EulerStreamOptions;
  constructor(options: EulerStreamOptions) { this.options = options; }

  private diagnostic(reason: string, closeCode?: number) {
    this.options.onDiagnostic?.({ reason, closeCode, at: Date.now(), idleMs: Math.max(0, Date.now() - this.lastMessageAt) });
  }
  private status(s: EulerStatus) { this.options.onStatus?.(s); }
  private resume = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') this.checkHealth(); };
  private online = () => { if (!this.stopped && !this.terminal) this.recover('NETWORK_ONLINE', 0); };

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.terminal = false;
    this.monitor = setInterval(() => this.checkHealth(), EULER_HEALTH.checkEveryMs);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.online);
      window.addEventListener('focus', this.resume);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.resume);
    void this.connect();
  }

  private disposeSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try { socket.close(1000); } catch { /* Closing a half-open connection may throw. */ }
  }
  private schedule(ms: number) {
    if (this.stopped || this.terminal) return;
    if (this.timer) clearTimeout(this.timer);
    this.phase = 'retry';
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, ms);
  }
  private delay() { return Math.min(30000, 2000 * 2 ** this.retry++); }
  private recover(reason: string, ms = this.delay(), closeCode?: number) {
    if (this.stopped || this.terminal) return;
    this.diagnostic(reason, closeCode);
    this.generation++;
    this.disposeSocket();
    this.roomStalledAt = null;
    this.status({ state: 'waiting', message: '댓글 연결을 다시 시도하고 있습니다.' });
    this.schedule(ms);
  }

  private checkHealth() {
    if (this.stopped || this.terminal) return;
    const age = Date.now() - this.phaseSince;
    if (this.phase === 'token' && age >= EULER_HEALTH.tokenTimeoutMs) {
      this.token = null;
      this.recover('TOKEN_TIMEOUT');
    } else if (this.phase === 'opening' && age >= EULER_HEALTH.connectTimeoutMs) {
      this.recover('CONNECT_TIMEOUT');
    } else if (this.phase === 'open') {
      if (this.roomStalledAt !== null && Date.now() - this.roomStalledAt >= EULER_HEALTH.roomTimeoutMs)
        this.recover('ROOM_STALLED');
      else if (Date.now() - this.lastMessageAt >= EULER_HEALTH.idleTimeoutMs)
        this.recover('NO_FRAMES');
    }
  }

  /** Explicit repair replaces only the comment connection, preserving sales and receipts. */
  reconnect() {
    if (this.stopped) return;
    this.terminal = false;
    this.token = null;
    this.retry = 0;
    this.recover('MANUAL_RECONNECT', 0);
  }

  private async connect() {
    if (this.stopped || this.terminal) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const generation = ++this.generation;
    this.disposeSocket();
    this.roomStalledAt = null;
    this.phase = 'token';
    this.phaseSince = Date.now();
    this.status({ state: 'connecting' });
    try {
      let token = this.token;
      if (!token || (token.expiresAt && token.expiresAt - Date.now() < 60000)) token = await this.options.getToken();
      if (generation !== this.generation || this.stopped) return;
      this.token = token;
      this.phase = 'opening';
      this.phaseSince = Date.now();
      const url = eulerSocketUrl(token);
      const socket = this.options.socketFactory ? this.options.socketFactory(url) : new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.generation || this.stopped) return;
        this.retry = 0;
        this.phase = 'open';
        this.phaseSince = this.lastMessageAt = Date.now();
        this.diagnostic('OPEN');
        this.status({ state: 'connected' });
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation || this.stopped) return;
        this.lastMessageAt = Date.now();
        if (typeof event.data !== 'string') {
          this.options.onRaw?.(`(이진 데이터 ${(event.data as Blob)?.size ?? '?'}B)`);
          return;
        }
        this.options.onRaw?.(event.data.slice(0, 600));
        const parsed = parseEulerPayload(event.data);
        const fresh = parsed.comments.filter(c => {
          if (this.seen.has(c.id)) return false;
          this.seen.add(c.id);
          return true;
        });
        while (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
        if (fresh.length) this.options.onComments(fresh);
        const last = parsed.roomStates[parsed.roomStates.length - 1];
        if (last === 'connected' || fresh.length) {
          this.roomStalledAt = null;
          this.status({ state: 'connected' });
        } else if (last && ['connecting', 'reconnecting', 'disconnected', 'error', 'offline', 'ended'].includes(last)) {
          // Repeated room-status frames must not indefinitely reset recovery.
          this.roomStalledAt ??= Date.now();
          this.status({ state: 'waiting', message: last === 'ended' ? '방송이 끝났습니다' : last === 'offline' ? '아직 방송 중이 아닙니다' : '댓글 연결을 복구하고 있습니다.' });
        }
      };
      socket.onclose = (event) => {
        if (generation !== this.generation || this.stopped) return;
        const info = eulerCloseInfo(event.code);
        this.diagnostic('CLOSE', event.code);
        if (info.action === 'stop') {
          this.terminal = true;
          this.generation++;
          this.disposeSocket();
          this.status({ state: 'error', message: info.message });
          return;
        }
        if (info.action === 'token') this.token = null;
        this.recover('CLOSE_RETRY', info.action === 'later' ? 15000 : info.action === 'token' ? 500 : this.delay(), event.code);
      };
      // Some WebViews report an error without ever delivering a close event.
      socket.onerror = () => { if (generation === this.generation && !this.stopped) this.recover('SOCKET_ERROR'); };
    } catch (e) {
      if (generation !== this.generation || this.stopped) return;
      const code = (e as { code?: string })?.code;
      if (code === 'TIKTOK_ID_MISSING' || code === 'COMMENT_KEY_MISSING') this.terminal = true;
      this.status({ state: 'error', message: (e as Error).message || '댓글 연결 정보를 받지 못했습니다.' });
      this.diagnostic('CONNECT_ERROR');
      this.generation++;
      this.disposeSocket();
      if (!this.terminal) this.schedule(this.delay());
    }
  }

  stop() {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    if (this.monitor) clearInterval(this.monitor);
    this.timer = null;
    this.monitor = null;
    this.phase = 'stopped';
    this.disposeSocket();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.online);
      window.removeEventListener('focus', this.resume);
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.resume);
    this.status({ state: 'stopped' });
  }
}
