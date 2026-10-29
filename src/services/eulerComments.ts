/**
 * 폰 단독 판매의 댓글 받기: Euler 클라우드 웹소켓(JSON 모드)에 폰이 직접 붙는다.
 * 연결 정보(짧은 토큰 또는 키)는 sales-api touch-comment-token에서 연결할 때마다 받고 저장하지 않는다.
 * JSON 모양은 실제 방송에서 아직 확인하지 않아 여러 모양을 받아 준다(시험 화면에 원문을 보여 준다).
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
      const state = str(data?.state);
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
}

/** 다시 붙기: 일반 끊김은 2·4·8…최대 30초, 방송 전/종료는 15초, 토큰 만료는 새 토큰으로 바로. */
export class EulerCommentStream {
  private socket: WebSocket | null = null;
  private stopped = true;
  private token: CommentToken | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private seen = new Set<string>();
  lastMessageAt = 0;
  private options: EulerStreamOptions;
  constructor(options: EulerStreamOptions) {
    this.options = options;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  private status(s: EulerStatus) {
    this.options.onStatus?.(s);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), ms);
  }

  private async connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.status({ state: 'connecting' });
    try {
      if (!this.token || (this.token.expiresAt && this.token.expiresAt - Date.now() < 60000))
        this.token = await this.options.getToken();
    } catch (e) {
      if (generation !== this.generation) return;
      const code = (e as any)?.code;
      this.status({ state: 'error', message: (e as Error).message || '댓글 연결 정보를 받지 못했습니다.' });
      if (code === 'TIKTOK_ID_MISSING' || code === 'COMMENT_KEY_MISSING') return;
      this.schedule(Math.min(30000, 2000 * 2 ** this.retry++));
      return;
    }
    if (generation !== this.generation || this.stopped) return;
    const url = eulerSocketUrl(this.token);
    const socket = this.options.socketFactory ? this.options.socketFactory(url) : new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.retry = 0;
      this.status({ state: 'connected' });
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      this.lastMessageAt = Date.now();
      if (typeof event.data !== 'string') {
        this.options.onRaw?.(`(이진 데이터 ${(event.data as Blob)?.size ?? '?'}B)`);
        return;
      }
      this.options.onRaw?.(event.data.slice(0, 600));
      const parsed = parseEulerPayload(event.data);
      const fresh = parsed.comments.filter((c) => {
        if (this.seen.has(c.id)) return false;
        this.seen.add(c.id);
        return true;
      });
      while (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
      if (fresh.length) this.options.onComments(fresh);
      const last = parsed.roomStates[parsed.roomStates.length - 1];
      if (last === 'connected') this.status({ state: 'connected' });
      else if (last === 'offline' || last === 'ended')
        this.status({ state: 'waiting', message: last === 'ended' ? '방송이 끝났습니다' : '아직 방송 중이 아닙니다' });
    };
    socket.onclose = (event) => {
      if (generation !== this.generation || this.stopped) return;
      this.socket = null;
      const info = eulerCloseInfo(event.code);
      if (info.action === 'stop') {
        this.status({ state: 'error', message: info.message });
        return;
      }
      if (info.action === 'token') this.token = null;
      if (info.action === 'later') {
        this.status({ state: 'waiting', message: info.message });
        this.schedule(15000);
        return;
      }
      this.status({ state: 'connecting' });
      this.schedule(info.action === 'token' ? 500 : Math.min(30000, 2000 * 2 ** this.retry++));
    };
    socket.onerror = () => {};
  }

  stop() {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.socket?.close(1000);
    } catch {}
    this.socket = null;
    this.status({ state: 'stopped' });
  }
}
