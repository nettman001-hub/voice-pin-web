import { io, Socket } from 'socket.io-client';
import { DEFAULT_COMMENT_SERVER_URL } from '../types/comment';
import {
  LocalSttModel,
  LocalSttState,
  LocalSttStatusPayload,
  LocalSttTranscriptEvent
} from '../types/stt';
import { OnTranscriptCallback, OnErrorCallback, OnStatusCallback } from './deepgramService';

export class LocalSttService {
  private socket: Socket | null = null;
  private currentSessionId: string = '';
  private currentGeneration: number = 0;
  private isListening: boolean = false;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

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
    error: null,
    hardwareProfile: null
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
        if (this.isListening) this.failListening(this.status.message, 'DISCONNECTED');
      });

      this.socket.on('stt:status', (payload: LocalSttStatusPayload) => {
        this.status = { ...this.status, ...payload };
        this.notifyStatusListeners();

        if (this.isListening) {
          if (payload.state === 'ERROR') {
            const errMsg = payload.error || payload.message || '로컬 STT 엔진 오류';
            this.failListening(errMsg);
          }
        }
      });

      this.socket.on('stt:listening_started', (data: { session_id: string; generation: number; model?: string }) => {
        if (this.isListening && data.session_id === this.currentSessionId && data.generation === this.currentGeneration) {
          this.clearStartupTimer();
          this.isListening = true;
          this.status.state = 'LISTENING';
          if (data.model) this.status.model = data.model;
          this.notifyStatusListeners();
          this.onStatusCallback?.('CONNECTED', `로컬 STT 청취 준비 완료 (${data.model || this.status.model})`);
        }
      });

      this.socket.on('stt:listening_stopped', (data: { session_id: string }) => {
        if (data.session_id === this.currentSessionId) {
          this.clearStartupTimer();
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

        if (this.isListening) {
          this.failListening(errMsg);
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

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private failListening(message: string, status: 'ERROR' | 'DISCONNECTED' = 'ERROR'): void {
    this.clearStartupTimer();
    this.isListening = false;
    this.currentGeneration += 1;
    if (this.socket?.connected) this.socket.emit('stt:stop', { sessionId: this.currentSessionId });
    this.status.state = status === 'ERROR' ? 'ERROR' : 'HELPER_OFFLINE';
    this.status.error = message;
    this.status.message = message;
    this.notifyStatusListeners();
    const onError = this.onErrorCallback;
    const onStatus = this.onStatusCallback;
    this.onTranscriptCallback = null;
    this.onErrorCallback = null;
    this.onStatusCallback = null;
    onError?.(message);
    onStatus?.(status, message);
  }

  public subscribeStatus(listener: (status: LocalSttStatusPayload) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  public detectDevices(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('stt:detect_devices');
    }
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

    const targetDevice = device || (model === 'large-v3-turbo' ? 'cuda' : (this.status.device || 'cuda'));
    const targetCompute = computeType || (targetDevice === 'cuda' ? (this.status.hardwareProfile?.recommended_compute_type || 'float16') : 'int8');

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
    this.clearStartupTimer();
    this.currentSessionId = sessionId;
    this.currentGeneration = generation;
    this.isListening = true;
    this.onTranscriptCallback = onTranscript;
    this.onErrorCallback = onError;
    this.onStatusCallback = onStatus ?? null;

    // Socket.IO는 연결이 없어도 emit을 큐에 넣는다. 이를 청취 성공으로
    // 취급하면 파형만 나오고 전사는 영원히 시작되지 않을 수 있다.
    if (!this.socket?.connected) {
      this.failListening('내 PC STT에 연결할 수 없습니다. 댓글 도우미를 실행하거나 판매자 설정에서 클라우드 STT를 선택해 주세요.');
      return;
    }

    const targetModel = model || this.status.requestedModel || this.status.model || 'base';

    onStatus?.('CONNECTING', `로컬 STT 워커 준비 확인 중 (${targetModel})...`);

    this.startupTimer = setTimeout(() => {
      if (this.isListening && this.currentSessionId === sessionId && this.currentGeneration === generation) {
        this.failListening('내 PC STT가 60초 안에 청취 준비를 완료하지 못했습니다. 댓글 도우미의 엔진 상태를 확인하거나 클라우드 STT를 선택해 주세요.');
      }
    }, 60_000);
    console.log('[LocalSTT] 청취 시작 요청', { model: targetModel });

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
    this.clearStartupTimer();
    const wasListening = this.isListening;
    this.isListening = false;
    this.currentGeneration += 1; // 늦게 도착하는 패킷 폐기용
    if (wasListening && this.socket?.connected) {
      this.socket.emit('stt:stop', { sessionId: this.currentSessionId });
    }
    this.onTranscriptCallback = null;
    this.onErrorCallback = null;
    this.onStatusCallback?.('DISCONNECTED', '로컬 STT 청취 중지됨');
    this.onStatusCallback = null;
  }
}

export const localSttService = new LocalSttService();
