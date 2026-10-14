import { AudioCaptureService } from './audioCaptureService';
import { CommentStreamService } from './commentStreamService';
import type { CommentRecord } from '../types/comment';
import type { WorkflowTranscript } from '../types/salesWorkflow';
import { screenCaptureService } from './screenCaptureService';
import type { SonioxResponse, SonioxToken, SttConfig } from '../types/deepgram';
import { recentSellerLogicNicknames, sellerLogicNicknameTerms, type SellerLogicNicknameSource } from './sellerLogicVocabulary';
import {
  buildNicknameHintTerms,
  findUnsentNicknames,
  LIVE_HINT_MIN_INTERVAL_MS,
  LIVE_HINT_ROUTINE_CHECK_MS,
  selectHintNicknames,
} from './liveSttHints';
import { buildCloudSttTerms } from './sttVocabularyService';
import { HintRotationScheduler } from './logicOpus/opusHintPlanner';

export interface SellerLogicTranscript extends WorkflowTranscript {
  id: string;
  text: string;
  capturedAt: string;
  receivedAt: string;
  startedAt: string;
  endedAt: string;
  utteranceId: string;
  utteranceEnded: boolean;
  revision: number;
  endReason: NonNullable<WorkflowTranscript['endReason']>;
  /** Absolute capture-clock milliseconds, not arrival time after a rotation. */
  startMs: number;
  endMs: number;
}

export interface SellerLogicCaptureOptions {
  username: string;
  serverUrl: string;
  stt: SttConfig;
  sessionId: string;
  comment: (comment: CommentRecord) => void;
  transcript: (transcript: SellerLogicTranscript) => void;
  status: (message: string) => void;
  interim?: (text: string) => void;
  level?: (level: number) => void;
  initialComments?: SellerLogicNicknameSource[];
  /** 1순위: 판매자 등록 고정 발음 힌트 (nettman006@gmail.com 계정 값) */
  presetWords?: string[];
  /** 3순위: 단어 치환 규칙 단어 (nettman006@gmail.com 계정 값) */
  ruleWords?: string[];
  onKeytermsChanged?: (keyterms: string[]) => void;
}

interface AudioChunk { data: ArrayBuffer; capturedAt: number }
interface Connection {
  socket: WebSocket;
  nicknames: string[];
  keyterms: string[];
  origin: number | null;
  sentMs: number;
  finalTokens: SonioxToken[];
  draining: boolean;
  timeout: number | null;
  closed?: () => void;
  firstFinalAt?: number;
  utteranceId?: string;
  lastTranscript?: SellerLogicTranscript;
  drainReason?: 'stream_end' | 'rotation';
  onPromoted?: (success: boolean) => void;
}

const CONNECT_TIMEOUT_MS = 12_000;
const MAX_BUFFER_BYTES = 16000 * 2 * 60;
const SAME_NAMES = (a: string[], b: string[]) => a.length === b.length && a.every((name) => b.includes(name));

/** Dedicated admin-page capture. No purchase, product, nickname-match or sale classification happens here. */
export class SellerLogicCapture {
  private audio = new AudioCaptureService();
  private comments = new CommentStreamService();
  private options: SellerLogicCaptureOptions | null = null;
  private active: Connection | null = null;
  private pending: Connection | null = null;
  private connections = new Set<Connection>();
  private buffered: AudioChunk[] = [];
  private bufferedBytes = 0;
  private recent: SellerLogicNicknameSource[] = [];
  // Keep identity evidence separate from the compact recent-50 window so
  // delayed AI intent can still prioritize a previously seen buyer.
  private seenNicknames = new Set<string>();
  private priority: string[] = [];
  private seenComments = new Set<string>();
  private disposers: Array<() => void> = [];
  private timer: number | null = null;
  private routineTimer: number | null = null;
  private scheduler: HintRotationScheduler | null = null;
  private activeKeyterms: string[] = [];
  private generation = 0;
  private sequence = 0;
  private utteranceSequence = 0;
  private runId = '';
  private lastRotationAt = 0;
  private retryAfter = 0;
  private ownsScreen = false;
  private lastAudioEndMs = 0;
  private stopping = false;
  private stopPromise: Promise<void> | null = null;
  private startRequest = 0;
  private selectingScreen = false;

  private report(status: string, message: string): void {
    this.options?.status(status === 'ERROR' ? `청취 중지: ${message}`
      : status.startsWith('COMMENTS_') ? `댓글: ${message}`
      : status === 'WARNING' ? `주의: ${message}` : message);
  }

  async start(options: SellerLogicCaptureOptions): Promise<void> {
    const request = ++this.startRequest;
    await this.stop(false);
    if (request !== this.startRequest) return;
    if (options.stt.provider !== 'SONIOX' || !options.stt.apiKey?.trim()) throw new Error('Soniox API 키를 설정해 주세요.');
    if (!options.username.trim()) throw new Error('틱톡 방송 ID를 입력해 주세요.');
    const generation = ++this.generation;
    this.runId = crypto.randomUUID();
    this.options = options;
    this.stopping = false;
    this.recent = [...(options.initialComments || [])];
    this.seenNicknames = new Set(this.recent.map((item) => item.nickname));
    this.report('CONNECTING', '방송 탭과 탭 오디오 공유를 선택해 주세요.');
    this.disposers.push(this.comments.onComment((comment) => {
      if (generation !== this.generation) return;
      const key = comment.id || `${comment.userId || comment.uniqueId}|${comment.receivedAt}|${comment.content}`;
      if (this.seenComments.has(key)) return;
      this.seenComments.add(key);
      if (this.seenComments.size > 10_000) this.seenComments.delete(this.seenComments.values().next().value!);
      this.recent.push({ nickname: comment.nickname, receivedAt: comment.receivedAt });
      this.seenNicknames.add(comment.nickname);
      // Only latest distinct names are needed by the transport; full evidence lives in the page.
      if (this.recent.length > 500) this.recent = recentSellerLogicNicknames(this.recent).reverse().map((nickname) => ({ nickname }));
      options.comment({
        id: `${options.sessionId}:comment:${comment.id || key}`,
        platformMessageId: comment.id, sessionId: options.sessionId,
        nickname: comment.nickname, uniqueId: comment.uniqueId,
        platformUserId: comment.userId, content: comment.content,
        capturedAt: comment.receivedAt,
      });
    }));
    this.disposers.push(this.comments.onStatus((status, message) => {
      if (generation === this.generation) this.report(`COMMENTS_${status}`, message || status);
    }));
    this.comments.connect(options.serverUrl);
    this.comments.startCollecting(options.username.trim().replace(/^@/u, ''));
    try {
      this.selectingScreen = true;
      const display = await screenCaptureService.getOrCreateStream(true);
      if (generation !== this.generation) {
        display?.getTracks().forEach((track) => track.stop());
        return;
      }
      this.selectingScreen = false;
      if (!display) throw new Error('방송 탭 공유가 취소되었습니다.');
      this.ownsScreen = true;
      const stream = await this.audio.startCapture('TAB_AUDIO', (data) => {
        if (generation !== this.generation || this.stopping) return;
        const duration = data.byteLength / 32;
        const capturedAt = this.lastAudioEndMs || Date.now() - duration;
        this.lastAudioEndMs = capturedAt + duration;
        this.routeAudio({ data, capturedAt });
      }, (_waveform, level) => options.level?.(level));
      if (generation !== this.generation) return;
      stream.getAudioTracks().forEach((track) => {
        const ended = () => this.fail('탭 오디오 공유가 종료되었습니다.');
        track.addEventListener('ended', ended);
        this.disposers.push(() => track.removeEventListener('ended', ended));
      });

      // 힌트 교체 스케줄러: 청취 홈과 동일하게 5초 버퍼링/즉시 교체
      this.scheduler = new HintRotationScheduler({
        now: () => Date.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
        rotate: () => new Promise<boolean | 'skipped'>((resolve) => {
          if (this.stopping || !this.options) { resolve('skipped'); return; }
          if (this.pending) { resolve(false); return; }
          const desired = this.desiredNames();
          const nextTerms = this.buildKeyterms(desired);
          const now = Date.now();
          const providerLimitReached = now - this.lastRotationAt >= 4 * 60 * 60 * 1000;
          if (!providerLimitReached && this.active && nextTerms.join('\n') === this.activeKeyterms.join('\n')) {
            resolve('skipped');
            return;
          }
          this.openConnection((promoted) => resolve(promoted));
        }),
        minIntervalMs: LIVE_HINT_MIN_INTERVAL_MS,
      });

      // 평상시: 10초마다 아직 STT에 안 보낸 닉네임이 있는지 확인해 보냄
      this.routineTimer = window.setInterval(() => {
        if (this.stopping || !this.options || !this.active) return;
        const desired = this.desiredNames();
        const providerLimitReached = Date.now() - this.lastRotationAt >= 4 * 60 * 60 * 1000;
        if (providerLimitReached || findUnsentNicknames(desired, this.active.nicknames).length > 0) {
          this.scheduler?.request();
        }
      }, LIVE_HINT_ROUTINE_CHECK_MS);
      if (typeof this.routineTimer === 'object' && this.routineTimer && 'unref' in (this.routineTimer as any)) {
        (this.routineTimer as any).unref();
      }

      this.openConnection();
      this.timer = window.setInterval(() => this.tick(), 2_000);
      if (typeof this.timer === 'object' && this.timer && 'unref' in (this.timer as any)) {
        (this.timer as any).unref();
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.message : '방송 오디오 연결 실패');
      throw error;
    }
  }

  /** 구매의사 댓글자 발생 시 즉시/5초 버퍼링 스케줄러 요청 */
  prioritizeNicknames(names: string[]): void {
    const missing = names.filter((name) => this.seenNicknames.has(name) && !this.active?.nicknames.includes(name));
    if (!missing.length) return;
    this.priority = [...new Set([...missing, ...this.priority])].slice(0, 50);
    const now = Date.now();
    const wait = this.lastRotationAt + LIVE_HINT_MIN_INTERVAL_MS - now;
    if (!this.pending && wait <= 0 && this.active) {
      this.openConnection();
    } else {
      this.scheduler?.request();
    }
  }

  /** 청취 홈과 동일: 구매의사자 최신순 우선 + 최근 댓글 작성자 (최대 50명, 원문 닉네임 유지) */
  private desiredNames(): string[] {
    return recentSellerLogicNicknames(this.recent, this.priority);
  }

  /**
   * 힌트 단어 전송 조합 (최대 200개):
   * 1순위: 판매자 등록 고정 발음 힌트 (nettman006@gmail.com 계정 값)
   * 2순위: 닉네임 원문 + 영문 한국어 발음 표기 (sellerLogicNicknameTerms)
   * 3순위: 단어 치환 규칙 단어 (nettman006@gmail.com 계정 값)
   */
  private buildKeyterms(nicknames: string[]): string[] {
    const nicknameTerms = sellerLogicNicknameTerms(nicknames);
    return buildCloudSttTerms(
      this.options?.presetWords || [],
      nicknameTerms,
      this.options?.ruleWords || [],
    );
  }

  private tick(): void {
    if (!this.options || this.stopping) return;
    const now = Date.now();
    for (const connection of this.connections) {
      if (connection.firstFinalAt && now - connection.firstFinalAt >= 3_000) this.emitTranscript(connection);
      if (!connection.draining && connection.socket.readyState === WebSocket.OPEN) {
        try { connection.socket.send(JSON.stringify({ type: 'keepalive' })); }
        catch { this.connectionFailed(connection, 'STT 연결 유지 실패'); }
      }
    }
  }

  private routeAudio(chunk: AudioChunk): void {
    if (this.pending || !this.active) {
      this.buffered.push(chunk);
      this.bufferedBytes += chunk.data.byteLength;
      if (this.bufferedBytes > MAX_BUFFER_BYTES) {
        this.fail('STT 연결 지연이 60초를 초과해 청취를 중지했습니다. 미전사 음성이 있을 수 있습니다.');
        return;
      }
      if (this.pending?.socket.readyState === WebSocket.OPEN) this.send(this.pending, chunk);
    } else this.send(this.active, chunk);
  }

  private send(connection: Connection, chunk: AudioChunk): void {
    try {
      if (connection.socket.readyState !== WebSocket.OPEN) throw new Error('closed');
      connection.origin ??= chunk.capturedAt;
      connection.socket.send(chunk.data);
      connection.sentMs += chunk.data.byteLength / 32;
    } catch { this.connectionFailed(connection, 'STT 오디오 전송 실패'); }
  }

  private openConnection(onPromoted?: (promoted: boolean) => void): void {
    if (!this.options || this.pending || this.stopping) return;
    let socket: WebSocket;
    try { socket = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket'); }
    catch {
      if (this.active) {
        this.retryAfter = Date.now() + 3_000;
        this.report('WARNING', 'Soniox 갱신 연결 실패. 기존 연결로 계속 청취합니다.');
      } else this.fail('Soniox 연결을 시작하지 못했습니다.');
      onPromoted?.(false);
      return;
    }
    const nicknames = this.desiredNames();
    const keyterms = this.buildKeyterms(nicknames);
    const connection: Connection = {
      socket, nicknames, keyterms, origin: null, sentMs: 0,
      finalTokens: [], draining: false, timeout: null, onPromoted,
    };
    this.pending = connection;
    this.connections.add(connection);
    connection.timeout = window.setTimeout(() => this.connectionFailed(connection, 'Soniox 응답 대기 시간 초과'), CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (!this.connections.has(connection) || !this.options) return;
      try {
        socket.send(JSON.stringify({
          api_key: this.options.stt.apiKey!.trim(), model: 'stt-rt-v5',
          audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
          language_hints: ['ko'], enable_endpoint_detection: true, max_endpoint_delay_ms: 2000,
          context: { terms: connection.keyterms },
        }));
        for (const chunk of this.buffered) {
          if (this.pending !== connection) break;
          this.send(connection, chunk);
        }
      } catch { this.connectionFailed(connection, 'Soniox 연결 설정 전송 실패'); }
    };
    socket.onmessage = (event) => {
      if (!this.connections.has(connection)) return;
      let response: SonioxResponse;
      try { response = JSON.parse(event.data); }
      catch { this.connectionFailed(connection, 'Soniox 응답을 읽을 수 없습니다.'); return; }
      if (response.error_code || response.error_type || response.error_message) {
        this.connectionFailed(connection, `Soniox 요청 실패 (${response.error_code || response.error_type || '오류'})`);
        return;
      }
      // Socket open is not authentication success. Retain the journal until a valid provider response.
      if (this.pending === connection && !this.stopping) this.promote(connection);
      for (const token of response.tokens || []) {
        if (!token.is_final) continue;
        if (token.text === '<end>') this.emitTranscript(connection, 'endpoint');
        else if (token.text === '<fin>') this.emitTranscript(connection, 'finalize');
        else {
          connection.finalTokens.push(token);
          connection.firstFinalAt ??= Date.now();
        }
      }
      const interim = (response.tokens || []).filter((token) => !token.is_final && token.text !== '<end>' && token.text !== '<fin>').map((token) => token.text).join('');
      if (connection === this.active) this.options?.interim?.(connection.finalTokens.map((token) => token.text).join('') + interim);
      if (response.finished) {
        this.emitTranscript(connection, connection.drainReason || 'stream_end');
        const expected = connection.draining;
        this.close(connection);
        if (!expected) this.fail('Soniox 세션이 예기치 않게 종료되었습니다. 청취를 다시 시작해 주세요.');
      }
    };
    socket.onerror = () => this.connectionFailed(connection, 'Soniox 연결 오류');
    socket.onclose = () => this.connectionFailed(connection, 'Soniox 연결이 종료되었습니다.');
  }

  private promote(connection: Connection): void {
    const previous = this.active;
    this.active = connection;
    this.pending = null;
    this.buffered = [];
    this.bufferedBytes = 0;
    this.lastRotationAt = Date.now();
    this.activeKeyterms = connection.keyterms;
    this.options?.onKeytermsChanged?.(connection.keyterms);
    connection.onPromoted?.(true);
    connection.onPromoted = undefined;
    if (connection.timeout !== null) window.clearTimeout(connection.timeout);
    connection.timeout = null;
    this.priority = this.priority.filter((name) => !connection.nicknames.includes(name));
    const pCount = this.options?.presetWords?.length || 0;
    const rCount = this.options?.ruleWords?.length || 0;
    if (!this.stopping) {
      this.report('CONNECTED', `Soniox 연결됨 · 힌트 단어 ${connection.keyterms.length}개 (1순위 고정 ${pCount}개, 2순위 닉네임 ${connection.nicknames.length}명, 3순위 규칙 ${rCount}개)`);
    }
    if (previous) this.drain(previous, 'rotation');
  }

  private drain(connection: Connection, reason: 'stream_end' | 'rotation' = 'stream_end'): void {
    connection.draining = true;
    connection.drainReason = reason;
    try {
      // Soniox's reference client uses an empty text frame for end-of-audio.
      // Keep the result handler until finished:true, including the final buffered tokens.
      connection.socket.send('');
      connection.timeout = window.setTimeout(() => {
        this.emitTranscript(connection, reason);
        this.report('WARNING', '이전 STT 세션의 최종 응답이 지연되어 일부 미확정 음성이 누락될 수 있습니다.');
        this.close(connection);
      }, 12_000);
    } catch { this.connectionFailed(connection, '이전 STT 세션 최종 응답 실패'); }
  }

  private emitTranscript(connection: Connection, reason: SellerLogicTranscript['endReason'] = 'flush'): void {
    const tokens = connection.finalTokens;
    connection.finalTokens = [];
    connection.firstFinalAt = undefined;
    const text = tokens.map((token) => token.text).join('').trim();
    if (!this.options) return;
    const utteranceEnded = reason === 'endpoint';
    if (text) {
      const origin = connection.origin ?? Date.now();
      const startMs = origin + (tokens.find((token) => typeof token.start_ms === 'number')?.start_ms ?? 0);
      const endMs = origin + ([...tokens].reverse().find((token) => typeof token.end_ms === 'number')?.end_ms ?? connection.sentMs);
      const startedAt = new Date(startMs).toISOString();
      connection.utteranceId ??= `${this.options.sessionId}:utterance:${this.runId}:${++this.utteranceSequence}`;
      const transcript: SellerLogicTranscript = {
        id: `${this.options.sessionId}:soniox:${this.runId}:${++this.sequence}`, text,
        recognizedAt: startedAt, isFinal: true,
        capturedAt: startedAt, startedAt, endedAt: new Date(endMs).toISOString(),
        receivedAt: new Date().toISOString(), startMs, endMs,
        utteranceId: connection.utteranceId, utteranceEnded, revision: 1, endReason: reason,
      };
      connection.lastTranscript = transcript;
      this.options.transcript(transcript);
    } else if (reason !== 'flush' && connection.lastTranscript) {
      const previous = connection.lastTranscript;
      if (previous.endReason !== reason || previous.utteranceEnded !== utteranceEnded) {
        // A late boundary can arrive after a timed flush. Revise the existing
        // fragment instead of emitting an empty row or duplicating its text.
        const transcript = { ...previous, receivedAt: new Date().toISOString(),
          utteranceEnded, revision: previous.revision + 1, endReason: reason };
        connection.lastTranscript = transcript;
        this.options.transcript(transcript);
      }
    }
    if (utteranceEnded) {
      connection.utteranceId = undefined;
      connection.lastTranscript = undefined;
    }
  }

  private connectionFailed(connection: Connection, message: string): void {
    if (!this.connections.has(connection)) return;
    if (connection === this.pending && this.active?.socket.readyState === WebSocket.OPEN) {
      this.close(connection);
      this.pending = null;
      const journal = this.buffered;
      this.buffered = [];
      this.bufferedBytes = 0;
      for (const chunk of journal) {
        if (!this.active) break;
        this.send(this.active, chunk);
      }
      this.retryAfter = Date.now() + 3_000;
      this.report('WARNING', `${message}. 보관한 음성을 기존 연결에 전달하고 갱신을 재시도합니다.`);
      return;
    }
    if (connection.draining) {
      this.emitTranscript(connection, connection.drainReason || 'stream_end');
      this.close(connection);
      this.report('WARNING', `${message} 미확정 음성이 누락될 수 있습니다.`);
      return;
    }
    this.fail(`${message} 미전사 음성이 있을 수 있습니다. 청취를 다시 시작해 주세요.`);
  }

  private close(connection: Connection): void {
    if (connection.timeout !== null) window.clearTimeout(connection.timeout);
    connection.timeout = null;
    this.connections.delete(connection);
    const socket = connection.socket;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    connection.closed?.();
  }

  private fail(message: string): void {
    const callback = this.options?.status;
    void this.stop();
    callback?.(`청취 중지: ${message}`);
  }

  stop(cancelPendingStart = true): Promise<void> {
    if (cancelPendingStart) ++this.startRequest;
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    ++this.generation;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.routineTimer !== null) window.clearInterval(this.routineTimer);
    this.routineTimer = null;
    this.scheduler = null;
    this.audio.stopCapture();
    this.disposers.splice(0).forEach((dispose) => dispose());
    try {
      this.comments.stopCollecting();
    } catch {
      // ignore
    }
    this.comments.disconnect();
    if (this.selectingScreen) screenCaptureService.cancelPendingRequest();
    this.selectingScreen = false;
    if (this.ownsScreen) screenCaptureService.stopStream();
    this.ownsScreen = false;
    // A candidate that has not been acknowledged can safely return its journal to the old socket.
    if (this.pending && this.active?.socket.readyState === WebSocket.OPEN) {
      this.connectionFailed(this.pending, '청취 종료로 닉네임 갱신 취소');
    }
    const finished = [...this.connections].map((connection) => new Promise<void>((resolve) => {
      connection.closed = resolve;
      if (connection.socket.readyState === WebSocket.OPEN) {
        if (!connection.draining) {
          if (connection.timeout !== null) window.clearTimeout(connection.timeout);
          this.drain(connection);
        }
      } else {
        this.emitTranscript(connection, 'stream_end');
        this.close(connection);
        if (this.bufferedBytes) this.report('WARNING', 'STT 연결 전에 종료되어 보관 중인 음성은 전사되지 않았습니다.');
      }
    }));
    this.stopPromise = Promise.all(finished).then(() => {
      this.active = this.pending = null;
      this.options = null;
      this.buffered = [];
      this.bufferedBytes = 0;
      this.recent = [];
      this.seenNicknames.clear();
      this.priority = [];
      this.seenComments.clear();
      this.activeKeyterms = [];
      this.lastAudioEndMs = 0;
      this.sequence = 0;
      this.utteranceSequence = 0;
      this.retryAfter = 0;
      this.stopPromise = null;
    });
    return this.stopPromise;
  }
}
