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

class CommentStreamService {
  private socket: Socket | null = null;
  private url = '';
  private socketConnected = false;
  private lastServerState: StreamStatsPayload['state'] = 'idle';
  private lastMessage = '';
  private statusListeners = new Set<StatusListener>();
  private commentListeners = new Set<CommentListener>();

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
    this.socket?.emit('collect:start', { username });
  }

  public stopCollecting(): void {
    this.socket?.emit('collect:stop');
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

/** 닉네임+내용 조합 기준 중복 판별 키 (기존 OCR 시절 키 규격과 동일하게 유지) */
const normalizeForDedupe = (text: string) => text.replace(/\s+/g, ' ').trim();

export const commentDedupeKey = (nickname: string, content: string) =>
  `${normalizeForDedupe(nickname)}␟${normalizeForDedupe(content)}`;
