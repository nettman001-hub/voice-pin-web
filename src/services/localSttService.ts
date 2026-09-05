import { io, Socket } from 'socket.io-client';
import { DEFAULT_COMMENT_SERVER_URL } from '../types/comment';
import {
  LocalSttModel,
  LocalSttState,
  LocalSttStatusPayload,
  LocalSttTranscriptEvent
} from '../types/stt';
import { OnTranscriptCallback, OnErrorCallback, OnStatusCallback } from './deepgramService';

class LocalSttService {
  private socket: Socket | null = null;
  private currentSessionId: string = '';
  private currentGeneration: number = 0;
  private isListening: boolean = false;

  private onTranscriptCallback: OnTranscriptCallback | null = null;
  private onErrorCallback: OnErrorCallback | null = null;
  private onStatusCallback: OnStatusCallback | null = null;
  private statusListeners: Set<(status: LocalSttStatusPayload) => void> = new Set();

  private status: LocalSttStatusPayload = {
    available: false,
    state: 'DISCONNECTED',
    model: 'base',
    requestedModel: 'base',
    device: 'cpu',
    computeType: 'int8',
    message: '댓글 도우미 연결 대기 중',
    error: null
  };

  constructor() {
    this.connect();
  }

  public connect(): void {
    if (this.socket) return;

    try {
      this.socket = io(DEFAULT_COMMENT_SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        timeout: 5000
      });

      this.socket.on('connect', () => {
        this.status.state = 'LOADING';
        this.status.message = '로컬 STT 연결됨';
        this.socket?.emit('stt:get_status');
        this.notifyStatusListeners();
      });

      this.socket.on('disconnect', () => {
        this.status.state = 'HELPER_OFFLINE';
        this.status.available = false;
        this.status.message = 'VoiceCAP 댓글 도우미 미실행 (127.0.0.1:2137 연결 끊김)';
        this.notifyStatusListeners();
        this.onStatusCallback?.('DISCONNECTED', this.status.message);
      });

      this.socket.on('stt:status', (payload: LocalSttStatusPayload) => {
        this.status = { ...this.status, ...payload };
        this.notifyStatusListeners();

        if (this.isListening) {
          if (payload.state === 'ERROR') {
            const errMsg = payload.error || payload.message || '로컬 STT 엔진 오류';
            this.onErrorCallback?.(errMsg);
            this.onStatusCallback?.('ERROR', errMsg);
          } else if (payload.state === 'LISTENING') {
            this.onStatusCallback?.('CONNECTED', `로컬 STT 청취 중 (${this.status.model})`);
          }
        }
      });

      this.socket.on('stt:listening_started', (data: { session_id: string; generation: number; model?: string }) => {
        if (data.session_id === this.currentSessionId && data.generation === this.currentGeneration) {
          this.isListening = true;
          this.status.state = 'LISTENING';
          if (data.model) this.status.model = data.model;
          this.notifyStatusListeners();
          this.onStatusCallback?.('CONNECTED', `로컬 STT 청취 준비 완료 (${data.model || this.status.model})`);
        }
      });

      this.socket.on('stt:listening_stopped', (data: { session_id: string }) => {
        if (data.session_id === this.currentSessionId) {
          this.isListening = false;
          this.status.state = 'READY';
          this.notifyStatusListeners();
          this.onStatusCallback?.('DISCONNECTED', '로컬 STT 청취 정상 종료');
        }
      });

      this.socket.on('stt:transcript', (data: LocalSttTranscriptEvent) => {
        // 이전 세션이나 종료된 세션의 지연된 전사는 폐기
        if (
          !this.isListening ||
          data.session_id !== this.currentSessionId ||
          data.generation !== this.currentGeneration
        ) {
          return;
        }

        if (this.onTranscriptCallback && data.text) {
          this.onTranscriptCallback({
            text: data.text,
            isFinal: data.is_final ?? true,
            confidence: data.confidence ?? 0.9,
            provider: 'LOCAL_WHISPER' as any,
            isAbnormal: data.is_abnormal,
            abnormalReason: data.abnormal_reason
          });
        }
      });

      this.socket.on('stt:error', (data: { message?: string; error_code?: string; failed_model?: string }) => {
        const errMsg = data?.message || '로컬 STT 오류 발생';
        this.status.state = 'ERROR';
        this.status.error = errMsg;
        this.notifyStatusListeners();

        this.onErrorCallback?.(errMsg);
        if (this.isListening) {
          this.onStatusCallback?.('ERROR', errMsg);
        }
      });
    } catch (err) {
      console.warn('[LocalSTT] 소켓 연결 실패:', err);
      this.status.state = 'HELPER_OFFLINE';
      this.notifyStatusListeners();
    }
  }

  public getStatus(): LocalSttStatusPayload {
    return this.status;
  }

  public subscribeStatus(listener: (status: LocalSttStatusPayload) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatusListeners(): void {
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch (_) {}
    }
  }

  public loadModel(model: LocalSttModel | string, device?: string, computeType?: string): void {
    this.connect();
    this.status.state = 'LOADING';
    this.status.requestedModel = model;
    this.status.message = `모델 (${model}) 로딩 요청 중...`;
    this.notifyStatusListeners();

    const targetDevice = device || this.status.device || 'cuda';
    const targetCompute = computeType || this.status.computeType || (targetDevice === 'cuda' ? 'float16' : 'int8');

    this.socket?.emit('stt:load_model', {
      model,
      device: targetDevice,
      computeType: targetCompute
    });
  }

  public startListening(
    sessionId: string,
    generation: number,
    prompt: string,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback,
    onStatus?: OnStatusCallback,
    model?: LocalSttModel | string
  ): void {
    this.connect();
    this.currentSessionId = sessionId;
    this.currentGeneration = generation;
    this.isListening = true;
    this.onTranscriptCallback = onTranscript;
    this.onErrorCallback = onError;
    this.onStatusCallback = onStatus ?? null;

    const targetModel = model || this.status.requestedModel || this.status.model || 'base';

    onStatus?.('CONNECTING', `로컬 STT 워커 준비 확인 중 (${targetModel})...`);

    this.socket?.emit('stt:start', {
      sessionId,
      generation,
      prompt,
      model: targetModel
    });
  }

  public sendAudioChunk(chunk: ArrayBuffer): void {
    if (!this.isListening || !this.socket || !this.socket.connected) return;

    // ArrayBuffer를 그대로 바이너리 전송 (Socket.IO 바이너리 패킷 가속)
    this.socket.emit('stt:audio', chunk);
  }

  public stopListening(): void {
    this.isListening = false;
    this.currentGeneration += 1; // 늦게 도착하는 패킷 폐기용
    this.socket?.emit('stt:stop', {
      sessionId: this.currentSessionId
    });
    this.onTranscriptCallback = null;
    this.onErrorCallback = null;
    this.onStatusCallback?.('DISCONNECTED', '로컬 STT 청취 중지됨');
    this.onStatusCallback = null;
  }
}

export const localSttService = new LocalSttService();
