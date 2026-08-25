import { DeepgramConfig, DeepgramResponse } from '../types/deepgram';

export type OnTranscriptCallback = (data: {
  text: string;
  isFinal: boolean;
  confidence: number;
  rawResponse?: DeepgramResponse;
}) => void;

export type OnErrorCallback = (error: string) => void;
export type OnStatusCallback = (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR', message?: string) => void;

export class DeepgramSttService {
  private ws: WebSocket | null = null;
  private speechRecognition: any = null;
  private isRecognitionActive: boolean = false;
  private restartTimer: number | null = null;
  private onTranscript: OnTranscriptCallback | null = null;
  private onError: OnErrorCallback | null = null;
  private onStatus: OnStatusCallback | null = null;
  private currentEngine: 'DEEPGRAM' | 'WEB_SPEECH' | 'NONE' = 'NONE';
  private lastFinalText: string = '';
  private sessionGeneration: number = 0;

  private isCurrentGeneration(generation: number): boolean {
    return this.sessionGeneration === generation;
  }

  private isActiveSession(generation: number): boolean {
    return this.isCurrentGeneration(generation) && this.isRecognitionActive;
  }

  private closeWebSocket(socket: WebSocket | null = this.ws): void {
    if (!socket) return;

    if (this.ws === socket) {
      this.ws = null;
    }

    // 이미 큐에 들어온 이전 세션 이벤트라도 현재 콜백을 건드리지 못하게 먼저 분리한다.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'CloseStream' }));
      }
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close();
      }
    } catch (e) {
      console.error('[Deepgram] WebSocket 종료 에러:', e);
    }
  }

  /**
   * 현재 엔진을 외부 상태 알림 없이 폐기하고 다음 세션 generation을 발급한다.
   */
  private resetSessionSilently(): number {
    this.sessionGeneration += 1;
    this.isRecognitionActive = false;
    this.currentEngine = 'NONE';

    this.closeWebSocket();
    this.stopBrowserSpeechRecognition();

    this.onTranscript = null;
    this.onError = null;
    this.onStatus = null;
    this.lastFinalText = '';

    return this.sessionGeneration;
  }

  /**
   * 실시간 STT 엔진 시작
   * 1) Deepgram API Key가 등록되어 있으면 -> Deepgram Nova-3 실시간 WebSocket AI 가동
   * 2) API Key가 없으면 -> 브라우저 내장 실제 마이크 음성인식(Web Speech API ko-KR) 가동
   */
  public startLiveStream(
    config: DeepgramConfig,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback,
    onStatus?: OnStatusCallback
  ) {
    // 중복 start나 직전 stop의 비동기 이벤트가 새 세션을 오염시키지 않도록 먼저 조용히 정리한다.
    const generation = this.resetSessionSilently();
    const sessionOnStatus = onStatus || null;

    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onStatus = sessionOnStatus;
    this.isRecognitionActive = true;
    this.lastFinalText = '';

    const cleanApiKey = (config.apiKey || '').trim();
    const allowBrowserSpeechFallback = config.allowBrowserSpeechFallback !== false;

    // 1. Deepgram API Key가 있는 경우: Deepgram Nova-2/Nova-3 실시간 WebSocket 연결
    if (cleanApiKey.length >= 10) {
      try {
        sessionOnStatus?.('CONNECTING', 'Deepgram AI 서버에 연결 중...');
        if (!this.isActiveSession(generation)) return;

        const queryParams = [
          `model=${config.model || 'nova-2'}`,
          `language=ko`,
          `smart_format=true`,
          `punctuate=true`,
          `interim_results=true`,
          `encoding=linear16`,
          `sample_rate=16000`,
          `channels=1`,
          `endpointing=300`,
          config.keywords && config.keywords.length > 0
            ? config.keywords.map(k => `keywords=${encodeURIComponent(k)}`).join('&')
            : ''
        ].filter(Boolean).join('&');

        const url = `wss://api.deepgram.com/v1/listen?${queryParams}`;
        console.log('[Deepgram] WebSocket 연결 시도:', url);
        const socket = new WebSocket(url, ['token', cleanApiKey]);
        this.ws = socket;

        socket.onopen = () => {
          if (!this.isActiveSession(generation) || this.ws !== socket) return;

          console.log('[Deepgram] 🟢 Deepgram WebSocket 실시간 연결 성공!');
          this.currentEngine = 'DEEPGRAM';
          sessionOnStatus?.('CONNECTED', 'Deepgram AI 연결 성공! 방송 소리를 실시간 전사합니다.');
        };

        socket.onmessage = (event) => {
          if (!this.isActiveSession(generation) || this.ws !== socket) return;

          try {
            const data: DeepgramResponse = JSON.parse(event.data);
            if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
              const alt = data.channel.alternatives[0];
              if (alt.transcript && alt.transcript.trim()) {
                console.log('[Deepgram] 🎯 전사 결과 수신:', alt.transcript);
                if (!this.isActiveSession(generation) || this.ws !== socket) return;
                onTranscript({
                  text: alt.transcript.trim(),
                  isFinal: !!data.is_final,
                  confidence: alt.confidence || 0.95,
                  rawResponse: data
                });
              }
            }
          } catch (e) {
            console.error('[Deepgram] 응답 파싱 실패:', e);
          }
        };

        socket.onerror = (event) => {
          if (!this.isActiveSession(generation) || this.ws !== socket) return;

          console.warn('[Deepgram] 🔴 WebSocket 연결 실패:', event);
          sessionOnStatus?.('ERROR', 'Deepgram 연결 실패 (API 키를 확인해 주세요)');
          if (!this.isActiveSession(generation) || this.ws !== socket) return;

          if (allowBrowserSpeechFallback) {
            onError('Deepgram WebSocket 연결 실패. 브라우저 마이크 음성인식으로 전환합니다.');
            if (!this.isActiveSession(generation) || this.ws !== socket) return;

            this.closeWebSocket(socket);
            if (!this.isActiveSession(generation)) return;
            this.startBrowserSpeechRecognition(
              generation,
              onTranscript,
              onError,
              sessionOnStatus
            );
          } else {
            this.closeWebSocket(socket);
            this.isRecognitionActive = false;
            this.currentEngine = 'NONE';
            onError('Deepgram 연결에 실패해 방송 탭 청취를 중지했습니다. 마이크로 자동 전환하지 않습니다.');
          }
        };

        socket.onclose = (event) => {
          if (!this.isActiveSession(generation) || this.ws !== socket) return;

          console.log('[Deepgram] WebSocket 연결 종료 코드:', event.code, event.reason);
          this.ws = null;
          this.isRecognitionActive = false;
          this.currentEngine = 'NONE';
          sessionOnStatus?.('DISCONNECTED', 'Deepgram 연결이 종료되었습니다.');
        };
        return;
      } catch (err) {
        if (!this.isActiveSession(generation)) return;

        console.warn('[Deepgram] WebSocket 초기화 실패:', err);
        if (!allowBrowserSpeechFallback) {
          this.isRecognitionActive = false;
          this.currentEngine = 'NONE';
          sessionOnStatus?.('ERROR', 'Deepgram 연결 초기화 실패');
          if (!this.isCurrentGeneration(generation)) return;
          onError('Deepgram 연결 초기화에 실패해 방송 탭 청취를 중지했습니다.');
          return;
        }
      }
    }

    // 2. Deepgram API Key가 없는 경우: 브라우저 실제 마이크 한국어 음성인식 100% 가동
    if (!allowBrowserSpeechFallback) {
      this.isRecognitionActive = false;
      this.currentEngine = 'NONE';
      sessionOnStatus?.('ERROR', '방송 탭 청취에는 Deepgram API Key가 필요합니다.');
      if (!this.isCurrentGeneration(generation)) return;
      onError('방송 탭 모드에서는 브라우저 마이크로 자동 전환하지 않습니다.');
      return;
    }

    if (!this.isActiveSession(generation)) return;
    this.startBrowserSpeechRecognition(
      generation,
      onTranscript,
      onError,
      sessionOnStatus
    );
  }

  /**
   * 브라우저 실제 한국어 음성인식 엔진
   */
  private startBrowserSpeechRecognition(
    generation: number,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback,
    onStatus: OnStatusCallback | null
  ) {
    if (!this.isActiveSession(generation)) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[STT] 브라우저 SpeechRecognition 미지원');
      this.isRecognitionActive = false;
      this.currentEngine = 'NONE';
      onError('브라우저 음성인식이 지원되지 않는 환경입니다. Chrome 또는 Edge 브라우저를 권장합니다.');
      if (!this.isCurrentGeneration(generation)) return;
      onStatus?.('ERROR', '음성인식 미지원 브라우저');
      return;
    }

    try {
      this.stopBrowserSpeechRecognition();
      if (!this.isActiveSession(generation)) return;

      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      const isCurrentRecognition = () => (
        this.isActiveSession(generation) &&
        this.speechRecognition === recognition
      );

      recognition.onstart = () => {
        if (!isCurrentRecognition()) return;
        console.log('[STT] 🎙️ 브라우저 실제 한국어 음성인식 시작');
      };

      recognition.onresult = (event: any) => {
        if (!isCurrentRecognition()) return;

        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (!isCurrentRecognition()) return;

          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          const confidence = res[0]?.confidence || 0.92;

          if (res.isFinal) {
            if (transcript.trim()) {
              this.lastFinalText = transcript.trim();
              onTranscript({
                text: transcript.trim(),
                isFinal: true,
                confidence
              });
            }
          } else {
            interimText += transcript;
          }
        }

        if (interimText.trim() && isCurrentRecognition()) {
          onTranscript({
            text: interimText.trim(),
            isFinal: false,
            confidence: 0.85
          });
        }
      };

      recognition.onerror = (event: any) => {
        if (!isCurrentRecognition()) return;

        console.warn('[STT] 음성인식 에러:', event.error);
        if (event.error === 'not-allowed') {
          this.isRecognitionActive = false;
          this.currentEngine = 'NONE';
          onError('마이크 사용 권한이 차단되었습니다. 브라우저 주소창 좌측에서 마이크를 허용해 주세요.');
          if (!this.isCurrentGeneration(generation)) return;
          onStatus?.('ERROR', '마이크 권한 거부됨');
        }
      };

      recognition.onend = () => {
        if (!isCurrentRecognition()) return;

        if (this.restartTimer) window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => {
          if (!isCurrentRecognition()) return;

          try {
            recognition.start();
          } catch (e) {}
        }, 150);
      };

      // identity를 먼저 등록해야 매우 빠른 onstart/onerror도 현재 세션으로 판별할 수 있다.
      this.speechRecognition = recognition;
      this.currentEngine = 'WEB_SPEECH';
      recognition.start();
      if (!isCurrentRecognition()) return;
      onStatus?.('CONNECTED', '브라우저 마이크 음성인식 가동 중 (ko-KR)');
    } catch (err) {
      if (!this.isCurrentGeneration(generation)) return;

      console.warn('[STT] 브라우저 음성인식 시작 실패:', err);
      this.stopBrowserSpeechRecognition();
      this.isRecognitionActive = false;
      this.currentEngine = 'NONE';
      onError('브라우저 음성인식을 시작하지 못했습니다.');
      if (!this.isCurrentGeneration(generation)) return;
      onStatus?.('ERROR', '브라우저 음성인식 시작 실패');
    }
  }

  private stopBrowserSpeechRecognition() {
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.speechRecognition) {
      const recognition = this.speechRecognition;
      this.speechRecognition = null;

      try {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
        recognition.abort();
      } catch (e) {}
    }
  }

  /**
   * 탭 방송 소리 또는 마이크 오디오 바이너리 청크를 Deepgram WebSocket으로 실시간 전송
   */
  public sendAudioChunk(chunk: ArrayBuffer | Blob) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  /**
   * 실시간 스트림 중지
   */
  public stopLiveStream() {
    const statusCallback = this.onStatus;

    // generation을 먼저 무효화하고 핸들러/콜백을 분리한 뒤, 기존 소비자에게만 1회 알린다.
    this.resetSessionSilently();
    statusCallback?.('DISCONNECTED', '청취 중지됨');
  }

  /**
   * 현재 가동 중인 STT 엔진 타입 반환
   */
  public getCurrentEngine(): 'DEEPGRAM' | 'WEB_SPEECH' | 'NONE' {
    return this.currentEngine;
  }

  /**
   * 수동 단문 테스트 전사 (텍스트 직접 주입 테스트용)
   */
  public injectTestTranscript(text: string) {
    if (this.onTranscript) {
      this.onTranscript({
        text,
        isFinal: true,
        confidence: 0.99
      });
    }
  }
}

export const deepgramService = new DeepgramSttService();
