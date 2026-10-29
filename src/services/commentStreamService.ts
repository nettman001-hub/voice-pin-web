import { io, Socket } from 'socket.io-client';

/**
 * 설치된 VoiceCAP 댓글 도우미와의 Socket.IO 통신 래퍼.
 * 서버가 TikTok-Live-Connector로 받은 댓글을 그대로 중계받는다.
 */

export type CommentStreamStatus =
  | 'DISCONNECTED'      // 댓글 도우미에 소켓 연결 안 됨 (앱 미실행 등)
  | 'CONNECTING'        // 댓글 도우미 소켓 연결 시도 중
  | 'CONNECTED'         // 서버 연결됨 · 틱톡 수집 대기
  | 'CONNECTING_TIKTOK' // 틱톡 라이브 연결 시도 중
  | 'COLLECTING'        // 댓글 실시간 수집 중
  | 'WAITING_LIVE'      // 대상 방송이 오프라인이라 시작 대기 중
  | 'ENDED'             // 틱톡 방송 정상 종료
  | 'ERROR';            // 오류

export interface StreamedComment {
  id: string;
  uniqueId: string;
  nickname: string;
  userId?: string;
  content: string;
  receivedAt: string;
}

export interface StreamStatsPayload {
  state?: string;
  username?: string;
  message?: string;
  viewerCount?: number;
  totalComments?: number;
  lastCommentAt?: string;
  reconnects?: number;
  hasEulerApiKey?: boolean;
}

export interface SalePrintRequest {
  saleId: string;
  printRevision: number;
  buyerNickname: string;
  amount: number;
  recognizedAt: string;
  sessionId?: string;
}

export interface SalePrintResult {
  ok: boolean;
  status: 'PRINTED' | 'FAILED';
  printedAt?: string;
  error?: string;
}

export interface CloudCommentPublishingConfig {
  sessionId?: string | null;
}

type StatusListener = (status: CommentStreamStatus, message?: string) => void;
type CommentListener = (comment: StreamedComment) => void;

function mapServerState(state?: string): CommentStreamStatus {
  switch (state) {
    case 'connecting':
      return 'CONNECTING_TIKTOK';
    case 'collecting':
      return 'COLLECTING';
    case 'waiting_live':
      return 'WAITING_LIVE';
    case 'ended':
      return 'ENDED';
    case 'error':
      return 'ERROR';
    default:
      return 'CONNECTED';
  }
}

export class CommentStreamService {
  private socket: Socket | null = null;
  private url = '';
  private socketConnected = false;
  private lastServerState: StreamStatsPayload['state'] = 'idle';
  private lastMessage = '';
  private targetUsername: string | null = null;
  private statusListeners = new Set<StatusListener>();
  private commentListeners = new Set<CommentListener>();
  private serverKey: { key: string; at: number } | null = null;
  private serverKeyFlight: Promise<string> | null = null;

  /**
   * 관리자 메뉴 "댓글 연결 키 (Euler)"의 키를 서버에서 받아 도우미에 넘긴다(폰 단독 판매와 같은 키).
   * 도우미는 메모리에만 두고, 키가 없거나 로그인 전이면 도우미의 예전 키(또는 무료 한도)로 돈다.
   */
  private fetchServerKey(): Promise<string> {
    if (this.serverKey && Date.now() - this.serverKey.at < 10 * 60 * 1000)
      return Promise.resolve(this.serverKey.key);
    if (!this.serverKeyFlight)
      this.serverKeyFlight = import('./productSalesApi')
        .then(({ invokeSalesApi }) => invokeSalesApi<{ apiKey: string }>('comment-helper-key'))
        .then((r) => {
          this.serverKey = { key: r.apiKey || '', at: Date.now() };
          return this.serverKey.key;
        })
        .catch(() => '')
        .finally(() => {
          this.serverKeyFlight = null;
        });
    return this.serverKeyFlight;
  }

  /** 서버 키를 먼저 넘기고(최대 3초 기다림) 수집을 시작한다. */
  private emitCollect(username: string) {
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000));
    void Promise.race([this.fetchServerKey(), timeout]).then((key) => {
      if (!this.socket || !this.socketConnected || this.targetUsername !== username) return;
      if (key) this.socket.emit('euler:key', { apiKey: key });
      this.socket.emit('collect:start', { username });
    });
  }

  public get isConnectedToServer(): boolean {
    return this.socketConnected && Boolean(this.socket);
  }

  /** 로컬 수집 서버에 연결한다. 같은 URL로 이미 연결된 경우 무시한다. */
  public connect(url: string): void {
    const target = url.trim().replace(/\/+$/, '');
    if (!target) return;
    if (this.socket && this.url === target) return;

    this.disconnect();
    this.lastServerState = 'idle';
    this.lastMessage = '';
    this.url = target;

    this.emitStatus('CONNECTING', 'VoiceCAP 댓글 도우미에 연결 중...');

    this.socket = io(target, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 5000
    });

    this.socket.on('connect', () => {
      this.socketConnected = true;
      this.emitStatus(mapServerState(this.lastServerState), this.lastMessage || 'VoiceCAP 댓글 도우미 연결됨');
      if (this.targetUsername) this.emitCollect(this.targetUsername);
    });

    this.socket.on('disconnect', () => {
      this.socketConnected = false;
      this.emitStatus('DISCONNECTED', 'VoiceCAP 댓글 도우미가 꺼져 있습니다. Windows 시작 메뉴에서 실행해 주세요.');
    });

    this.socket.on('connect_error', () => {
      if (!this.socketConnected) {
        this.emitStatus('DISCONNECTED', 'VoiceCAP 댓글 도우미가 설치되어 있는지 확인해 주세요.');
      }
    });

    this.socket.on('tiktok:status', (payload: StreamStatsPayload) => {
      this.lastServerState = payload.state || 'idle';
      this.lastMessage = payload.message || '';
      if (this.socketConnected) {
        this.emitStatus(mapServerState(this.lastServerState), this.lastMessage);
      }
    });

    this.socket.on('tiktok:stats', (payload: StreamStatsPayload) => {
      this.lastServerState = payload.state || this.lastServerState;
      if (payload.message !== undefined) this.lastMessage = payload.message || '';
    });

    this.socket.on('comment:new', (comment: StreamedComment) => {
      this.commentListeners.forEach((listener) => listener(comment));
    });
  }

  public startCollecting(username: string): void {
    const clean = username.trim().replace(/^@/u, '');
    this.targetUsername = clean;
    if (this.socket && this.socketConnected && clean) this.emitCollect(clean);
  }

  public stopCollecting(): void {
    this.targetUsername = null;
    if (this.socket && this.socketConnected) {
      this.socket.emit('collect:stop');
    }
  }

  /**
   * 댓글 도우미가 수집한 댓글을 현재 방송 회차의 클라우드 원본에 적재하도록 설정한다.
   * 인증 정보는 도우미의 설치 설정을 사용하며, 웹에서는 회차 ID만 전달한다.
   */
  public configureCloudPublishing(config: CloudCommentPublishingConfig): void {
    this.socket?.emit('cloud:config', { sessionId: config.sessionId || null });
  }

  /**
   * 댓글 도우미의 Windows 인쇄 큐에 판매 전표를 전달한다.
   * 도우미가 꺼져 있거나 프린터가 설정되지 않은 경우도 응답을 받아 웹 목록에 표시한다.
   */
  public printSale(payload: SalePrintRequest): Promise<SalePrintResult> {
    if (!this.socket || !this.socketConnected) {
      return Promise.resolve({ ok: false, status: 'FAILED', error: '댓글 도우미가 실행 중이 아닙니다.' });
    }
    return new Promise((resolve) => {
      this.socket!.timeout(15000).emit('print:sale', payload, (error: Error | null, response?: SalePrintResult) => {
        if (error) {
          resolve({ ok: false, status: 'FAILED', error: '댓글 도우미의 인쇄 응답 시간이 초과되었습니다.' });
          return;
        }
        if (!response || response.ok !== true) {
          resolve({ ok: false, status: 'FAILED', error: response?.error || '인쇄 요청을 처리하지 못했습니다.' });
          return;
        }
        resolve(response);
      });
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.socketConnected = false;
    this.url = '';
  }

  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public onComment(listener: CommentListener): () => void {
    this.commentListeners.add(listener);
    return () => this.commentListeners.delete(listener);
  }

  private emitStatus(status: CommentStreamStatus, message?: string): void {
    this.statusListeners.forEach((listener) => listener(status, message));
  }
}

export const commentStreamService = new CommentStreamService();

/** 댓글 중복 판별 키 (고유 메시지 ID가 있으면 최우선 사용, 없을 시 닉네임+내용+타임스탬프 fallback) */
const normalizeForDedupe = (text: string) => text.replace(/\s+/g, ' ').trim();

export const commentDedupeKey = (
  nickname: string,
  content: string,
  messageId?: string,
  timestamp?: string
) => {
  if (messageId && messageId.trim()) {
    return `msg:${messageId.trim()}`;
  }
  return `${normalizeForDedupe(nickname)}␟${normalizeForDedupe(content)}␟${timestamp || ''}`;
};
