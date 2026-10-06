import {
  DeepgramResponse,
  SonioxResponse,
  SttConfig,
  SttProvider
} from '../types/deepgram';

export type OnTranscriptCallback = (data: {
  text: string;
  isFinal: boolean;
  confidence: number;
  provider?: ActiveSttEngine;
  confirmedTextDelta?: string;
  rawResponse?: DeepgramResponse | SonioxResponse;
  isAbnormal?: boolean;
  abnormalReason?: string;
}) => void;

export type OnErrorCallback = (error: string) => void;
export type OnStatusCallback = (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR', message?: string) => void;

export type ActiveSttEngine = SttProvider | 'WEB_SPEECH' | 'LOCAL_WHISPER' | 'NONE';

export interface SttStreamDiagnostics {
  engine: ActiveSttEngine;
  audioSeconds: number;
  receivedResponses: number;
  receivedTextCharacters: number;
  lastResponseAt: number;
}

export class DeepgramSttService {
  private ws: WebSocket | null = null;
  private speechRecognition: any = null;
  private isRecognitionActive: boolean = false;
  private restartTimer: number | null = null;
  private onTranscript: OnTranscriptCallback | null = null;
  private onError: OnErrorCallback | null = null;
  private onStatus: OnStatusCallback | null = null;
  private currentEngine: ActiveSttEngine = 'NONE';
  private socketProvider: SttProvider | null = null;
  private sonioxFinalText: string = '';
  private sonioxHasSpeechSinceFinalize: boolean = false;
  private sonioxSilenceMs: number = 0;
  private sonioxFinalizeRequested: boolean = false;
  private sonioxAudioMsSinceFinalize: number = 0;
  private lastFinalText: string = '';
  private sessionGeneration: number = 0;
  private activeDelegate: DeepgramSttService | null = null;
  private pendingRotation: DeepgramSttService | null = null;
  private rotationAttemptId: number = 0;
  private quietAudioMs: number = 0;
  private deepgramHasUnfinalizedTranscript: boolean = false;
  private sentAudioBytes = 0;
  private receivedResponses = 0;
  private receivedTextCharacters = 0;
  private lastResponseAt = 0;

  private isCurrentGeneration(generation: number): boolean {
    return this.sessionGeneration === generation;
  }

  private isActiveSession(generation: number): boolean {
    return this.isCurrentGeneration(generation) && this.isRecognitionActive;
  }

  private closeWebSocket(
    socket: WebSocket | null = this.ws,
    providerOverride?: SttProvider | null,
  ): void {
    if (!socket) return;

    const provider = providerOverride ?? this.socketProvider;

    if (this.ws === socket) {
      this.ws = null;
      this.socketProvider = null;
    }

    // 이미 큐에 들어온 이전 세션 이벤트라도 현재 콜백을 건드리지 못하게 먼저 분리한다.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    try {
      if (socket.readyState === WebSocket.OPEN) {
        if (provider === 'SONIOX') {
          // 남은 토큰을 확정 요청한 뒤 Soniox 정상 종료 신호인 빈 프레임을 보낸다.
          socket.send(JSON.stringify({ type: 'finalize' }));
          socket.send(new ArrayBuffer(0));
        } else {
          socket.send(JSON.stringify({ type: 'CloseStream' }));
        }
      }
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close();
      }
    } catch (e) {
      console.error('[STT] WebSocket 종료 에러:', e);
    }
  }

  /**
   * 현재 엔진을 외부 상태 알림 없이 폐기하고 다음 세션 generation을 발급한다.
   */
  private resetSessionSilently(): number {
    this.rotationAttemptId += 1;
    if (this.pendingRotation) {
      const pending = this.pendingRotation;
      this.pendingRotation = null;
      pending.resetSessionSilently();
    }
    if (this.activeDelegate) {
      const active = this.activeDelegate;
      this.activeDelegate = null;
      active.resetSessionSilently();
    }
    this.sessionGeneration += 1;
    this.isRecognitionActive = false;
    this.currentEngine = 'NONE';

    this.closeWebSocket();
    this.stopBrowserSpeechRecognition();

    this.onTranscript = null;
    this.onError = null;
    this.onStatus = null;
    this.lastFinalText = '';
    this.sonioxFinalText = '';
    this.sonioxHasSpeechSinceFinalize = false;
    this.sonioxSilenceMs = 0;
    this.sonioxFinalizeRequested = false;
    this.sonioxAudioMsSinceFinalize = 0;
    this.quietAudioMs = 0;
    this.deepgramHasUnfinalizedTranscript = false;
    this.sentAudioBytes = 0;
    this.receivedResponses = 0;
    this.receivedTextCharacters = 0;
    this.lastResponseAt = 0;

    return this.sessionGeneration;
  }

  /**
   * 실시간 STT 엔진 시작
   * 1) 관리자가 선택한 STT API Key가 등록되어 있으면 -> 해당 클라우드 STT 가동
   * 2) API Key가 없으면 -> 브라우저 내장 실제 마이크 음성인식(Web Speech API ko-KR) 가동
   */
  public startLiveStream(
    config: SttConfig,
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

    const provider = config.provider || 'DEEPGRAM';
    const providerName = provider === 'SONIOX' ? 'Soniox' : 'Deepgram';

    const handleCloudFailure = (socket: WebSocket, message: string) => {
      if (!this.isActiveSession(generation) || this.ws !== socket) return;

      const troubleshootingHint = provider === 'DEEPGRAM'
        ? 'API 키 또는 요청 설정을 확인해 주세요'
        : 'API 키를 확인해 주세요';
      sessionOnStatus?.('ERROR', `${providerName} 연결 실패 (${troubleshootingHint})`);
      if (allowBrowserSpeechFallback) {
        onError(`${providerName} WebSocket 연결 실패. 브라우저 마이크 음성인식으로 전환합니다.`);
        this.closeWebSocket(socket);
        if (!this.isActiveSession(generation)) return;
        this.startBrowserSpeechRecognition(generation, onTranscript, onError, sessionOnStatus);
      } else {
        this.closeWebSocket(socket);
        this.isRecognitionActive = false;
        this.currentEngine = 'NONE';
        onError(`${message} 방송 탭 청취를 중지했습니다. 마이크로 자동 전환하지 않습니다.`);
      }
    };

    // 1. API Key가 있는 경우: 관리자가 선택한 클라우드 STT WebSocket 연결
    if (cleanApiKey.length >= 10) {
      try {
        sessionOnStatus?.('CONNECTING', `${providerName} AI 서버에 연결 중...`);
        if (!this.isActiveSession(generation)) return;

        if (provider === 'SONIOX') {
          const socket = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
          this.ws = socket;
          this.socketProvider = 'SONIOX';
          this.sonioxFinalText = '';
          this.sonioxHasSpeechSinceFinalize = false;
          this.sonioxSilenceMs = 0;
          this.sonioxFinalizeRequested = false;
          this.sonioxAudioMsSinceFinalize = 0;

          socket.onopen = () => {
            if (!this.isActiveSession(generation) || this.ws !== socket) return;

            // 공식 지원 언어표에서 한국어 ISO 코드는 ko이다(국가 코드 kr이 아님).
            socket.send(JSON.stringify({
              api_key: cleanApiKey,
              model: 'stt-rt-v5',
              audio_format: 'pcm_s16le',
              sample_rate: 16000,
              num_channels: 1,
              language_hints: ['ko'],
              language_hints_strict: true,
              enable_speaker_diarization: false,
              enable_endpoint_detection: true,
              max_endpoint_delay_ms: 2000,
              ...(config.keyterms.length > 0 ? { context: { terms: config.keyterms } } : {})
            }));

            this.currentEngine = 'SONIOX';
            sessionOnStatus?.('CONNECTED', 'Soniox v5 연결 성공! 한국어 전용으로 실시간 전사합니다.');
          };

          socket.onmessage = (event) => {
            if (!this.isActiveSession(generation) || this.ws !== socket) return;

            try {
              const data: SonioxResponse = JSON.parse(event.data);
              this.receivedResponses++;
              this.lastResponseAt = Date.now();
              if (this.receivedResponses === 1) console.log('[Soniox] 첫 서버 응답 수신:', {
                tokens: data.tokens?.length || 0,
                processedAudioMs: data.total_audio_proc_ms || 0,
                errorCode: data.error_code,
              });
              if (data.error_code || data.error_type || data.error_message) {
                console.warn('[Soniox] STT 오류:', data.error_code, data.error_type, data.request_id);
                handleCloudFailure(socket, 'Soniox 처리 오류로');
                return;
              }

              const tokens = data.tokens || [];
              this.receivedTextCharacters += tokens.filter((token) => token.text !== '<end>' && token.text !== '<fin>')
                .reduce((count, token) => count + token.text.length, 0);
              const finalizationReached = tokens.some((token) => (
                token.is_final && (token.text === '<fin>' || token.text === '<end>')
              ));
              const finalTokens = tokens.filter((token) => (
                token.is_final && token.text !== '<fin>' && token.text !== '<end>'
              ));
              const nonFinalTokens = tokens.filter((token) => (
                !token.is_final && token.text !== '<fin>' && token.text !== '<end>'
              ));
              const confirmedTextDelta = finalTokens.map((token) => token.text).join('');

              if (confirmedTextDelta) {
                this.sonioxFinalText += confirmedTextDelta;
                // A long utterance must retain its original text for the log and
                // purchase evidence. Ask for a boundary instead of dropping words.
                if (!finalizationReached && this.sonioxFinalText.length >= 1200 && !this.sonioxFinalizeRequested) {
                  this.sonioxFinalizeRequested = true;
                  socket.send(JSON.stringify({ type: 'finalize' }));
                }
              }

              const interimText = `${this.sonioxFinalText}${nonFinalTokens.map((token) => token.text).join('')}`.trim();
              const confidenceTokens = finalizationReached ? finalTokens : nonFinalTokens;
              const confidenceValues = confidenceTokens
                .map((token) => token.confidence)
                .filter((value): value is number => typeof value === 'number');
              const confidence = confidenceValues.length > 0
                ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
                : 0.95;

              if (finalizationReached) {
                const finalText = this.sonioxFinalText.trim();
                this.sonioxFinalText = '';
                this.sonioxHasSpeechSinceFinalize = false;
                this.sonioxSilenceMs = 0;
                this.sonioxFinalizeRequested = false;
                this.sonioxAudioMsSinceFinalize = 0;
                if (finalText) {
                  onTranscript({
                    text: finalText,
                    isFinal: true,
                    confidence,
                    provider: 'SONIOX',
                    confirmedTextDelta,
                    rawResponse: data
                  });
                }
              } else if (interimText || confirmedTextDelta) {
                onTranscript({
                  text: interimText,
                  isFinal: false,
                  confidence,
                  provider: 'SONIOX',
                  confirmedTextDelta,
                  rawResponse: data
                });
              }
            } catch (e) {
              console.error('[Soniox] 응답 파싱 실패:', e);
            }
          };

          socket.onerror = () => {
            console.warn('[Soniox] WebSocket 연결 실패');
            handleCloudFailure(socket, 'Soniox 연결에 실패해');
          };

          socket.onclose = (event) => {
            if (!this.isActiveSession(generation) || this.ws !== socket) return;

            console.log('[Soniox] WebSocket 연결 종료 코드:', event.code, event.reason);
            this.ws = null;
            this.socketProvider = null;
            this.isRecognitionActive = false;
            this.currentEngine = 'NONE';
            sessionOnStatus?.('DISCONNECTED', 'Soniox 연결이 종료되었습니다.');
          };
          return;
        }

        const queryParams = [
          `model=${config.model || 'nova-3'}`,
          `language=ko`,
          `smart_format=true`,
          `punctuate=true`,
          `interim_results=true`,
          `encoding=linear16`,
          `sample_rate=16000`,
          `channels=1`,
          `endpointing=300`,
          config.keyterms && config.keyterms.length > 0
            ? config.keyterms.map((term) => `keyterm=${encodeURIComponent(term)}`).join('&')
            : ''
        ].filter(Boolean).join('&');

        const url = `wss://api.deepgram.com/v1/listen?${queryParams}`;
        // The URL contains seller-entered vocabulary; never log the full query string.
        console.log('[Deepgram] WebSocket 연결 시도 (발음 힌트 개수):', config.keyterms?.length || 0);
        const socket = new WebSocket(url, ['token', cleanApiKey]);
        this.ws = socket;
        this.socketProvider = 'DEEPGRAM';

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
            this.receivedResponses++;
            this.lastResponseAt = Date.now();
            if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
              const alt = data.channel.alternatives[0];
              this.receivedTextCharacters += alt.transcript?.length || 0;
              if (data.is_final || data.speech_final) {
                this.deepgramHasUnfinalizedTranscript = false;
              } else if (alt.transcript && alt.transcript.trim()) {
                this.deepgramHasUnfinalizedTranscript = true;
              }
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
          console.warn('[Deepgram] 🔴 WebSocket 연결 실패:', event);
          handleCloudFailure(socket, 'Deepgram 연결에 실패해');
        };

        socket.onclose = (event) => {
          if (!this.isActiveSession(generation) || this.ws !== socket) return;

          console.log('[Deepgram] WebSocket 연결 종료 코드:', event.code, event.reason);
          this.ws = null;
          this.socketProvider = null;
          this.isRecognitionActive = false;
          this.currentEngine = 'NONE';
          sessionOnStatus?.('DISCONNECTED', 'Deepgram 연결이 종료되었습니다.');
        };
        return;
      } catch (err) {
        if (!this.isActiveSession(generation)) return;

        console.warn(`[${providerName}] WebSocket 초기화 실패:`, err);
        if (!allowBrowserSpeechFallback) {
          this.isRecognitionActive = false;
          this.currentEngine = 'NONE';
          sessionOnStatus?.('ERROR', `${providerName} 연결 초기화 실패`);
          if (!this.isCurrentGeneration(generation)) return;
          onError(`${providerName} 연결 초기화에 실패해 방송 탭 청취를 중지했습니다.`);
          return;
        }
      }
    }

    // 2. 선택한 공급자의 API Key가 없는 경우: 마이크 모드에서만 브라우저 STT로 대체
    if (!allowBrowserSpeechFallback) {
      this.isRecognitionActive = false;
      this.currentEngine = 'NONE';
      sessionOnStatus?.('ERROR', `방송 탭 청취에는 ${providerName} API Key가 필요합니다.`);
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

  private measurePcmChunk(chunk: ArrayBuffer): { rms: number; durationMs: number } {
    const sampleCount = Math.floor(chunk.byteLength / 2);
    if (sampleCount === 0) return { rms: 0, durationMs: 0 };

    const pcm = new Int16Array(chunk, 0, sampleCount);
    let squareSum = 0;
    let measuredSamples = 0;
    for (let i = 0; i < pcm.length; i += 8) {
      const normalized = pcm[i] / 32768;
      squareSum += normalized * normalized;
      measuredSamples += 1;
    }
    return {
      rms: measuredSamples > 0 ? Math.sqrt(squareSum / measuredSamples) : 0,
      durationMs: (sampleCount / 16000) * 1000,
    };
  }

  private observeRotationBoundary(chunk: ArrayBuffer): void {
    const { rms, durationMs } = this.measurePcmChunk(chunk);
    if (rms >= 0.012) {
      this.quietAudioMs = 0;
    } else {
      this.quietAudioMs += durationMs;
    }
  }

  /**
   * Soniox 자동 엔드포인트 대신 로컬 PCM의 실제 무음을 보수적으로 감지한다.
   * 공식 권장 최소 무음(약 200ms)보다 긴 750ms를 사용해 문장 중간의 짧은 쉼을
   * 판매 멘트 종료로 오인할 가능성을 낮춘다.
   */
  private shouldFinalizeSonioxAfterChunk(chunk: ArrayBuffer): boolean {
    const { rms, durationMs: chunkDurationMs } = this.measurePcmChunk(chunk);
    if (chunkDurationMs === 0) return false;
    this.sonioxAudioMsSinceFinalize += chunkDurationMs;

    if (rms >= 0.012) {
      if (!this.sonioxFinalizeRequested) {
        this.sonioxHasSpeechSinceFinalize = true;
        this.sonioxSilenceMs = 0;
      }
      return false;
    }

    if (!this.sonioxHasSpeechSinceFinalize || this.sonioxFinalizeRequested) {
      return false;
    }

    this.sonioxSilenceMs += chunkDurationMs;
    if (this.sonioxSilenceMs < 750 || this.sonioxAudioMsSinceFinalize < 2000) {
      return false;
    }

    this.sonioxFinalizeRequested = true;
    return true;
  }

  /**
   * 탭 방송 소리 또는 마이크 오디오 바이너리 청크를 선택된 STT WebSocket으로 실시간 전송
   */
  public sendAudioChunk(chunk: ArrayBuffer | Blob) {
    if (this.activeDelegate) {
      this.activeDelegate.sendAudioChunk(chunk);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      const bytes = chunk instanceof ArrayBuffer ? chunk.byteLength : chunk.size;
      if (this.sentAudioBytes === 0 && bytes > 0) console.log('[STT] 첫 오디오 전송:', {
        engine: this.currentEngine, bytes,
      });
      this.sentAudioBytes += bytes;

      if (chunk instanceof ArrayBuffer) {
        this.observeRotationBoundary(chunk);
      }

      if (
        this.socketProvider === 'SONIOX' &&
        chunk instanceof ArrayBuffer &&
        this.shouldFinalizeSonioxAfterChunk(chunk)
      ) {
        this.ws.send(JSON.stringify({ type: 'finalize' }));
      }
    }
  }

  /**
   * STT 소켓만 교체해도 되는 발화 경계인지 확인한다.
   * 방송 회차와 상위 판매 문맥은 이 서비스 밖에 있으므로 건드리지 않는다.
   */
  public isSafeToRotateLiveStream(): boolean {
    if (this.activeDelegate) return this.activeDelegate.isSafeToRotateLiveStream();
    if (
      !this.isRecognitionActive ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      (this.currentEngine !== 'SONIOX' && this.currentEngine !== 'DEEPGRAM') ||
      this.quietAudioMs < 1_000
    ) return false;

    if (this.currentEngine === 'SONIOX') {
      return !this.sonioxFinalizeRequested &&
        !this.sonioxHasSpeechSinceFinalize &&
        this.sonioxFinalText.length === 0;
    }
    return !this.deepgramHasUnfinalizedTranscript;
  }

  /**
   * 기존 소켓으로 오디오를 계속 보내면서 새 소켓을 먼저 준비한다.
   * 새 소켓이 열린 뒤에도 발화 경계가 유지된 경우에만 전송 대상을 원자적으로 바꾼다.
   */
  public async rotateLiveStream(config: SttConfig): Promise<boolean> {
    if (!this.isSafeToRotateLiveStream() || this.pendingRotation) return false;

    const transcriptCallback = this.onTranscript;
    const errorCallback = this.onError;
    const statusCallback = this.onStatus;
    if (!transcriptCallback || !errorCallback) return false;

    const attemptId = ++this.rotationAttemptId;
    const candidate = new DeepgramSttService();
    this.pendingRotation = candidate;
    let promoted = false;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => finish(false), 5_000);

      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        if (this.pendingRotation === candidate) this.pendingRotation = null;
        if (!success) candidate.resetSessionSilently();
        resolve(success);
      };

      const promote = () => {
        if (
          settled ||
          attemptId !== this.rotationAttemptId ||
          !this.isRecognitionActive ||
          !this.isSafeToRotateLiveStream()
        ) {
          finish(false);
          return;
        }

        const oldDelegate = this.activeDelegate;
        const oldSocket = oldDelegate ? null : this.ws;
        const oldProvider = oldDelegate ? null : this.socketProvider;

        promoted = true;
        this.activeDelegate = candidate;
        this.currentEngine = config.provider;
        if (oldDelegate) {
          oldDelegate.resetSessionSilently();
        } else if (oldSocket) {
          this.closeWebSocket(oldSocket, oldProvider);
          this.currentEngine = config.provider;
        }
        statusCallback?.('CONNECTED', `${config.provider === 'SONIOX' ? 'Soniox' : 'Deepgram'} STT 연결을 안전하게 갱신했습니다.`);
        finish(true);
      };

      candidate.startLiveStream(
        { ...config, allowBrowserSpeechFallback: false },
        (data) => {
          if (promoted) transcriptCallback(data);
        },
        (message) => {
          if (promoted) errorCallback(message);
          else finish(false);
        },
        (status, message) => {
          if (!promoted && status === 'CONNECTED') {
            promote();
            return;
          }
          if (!promoted && (status === 'ERROR' || status === 'DISCONNECTED')) {
            finish(false);
            return;
          }
          if (promoted && status !== 'CONNECTED') statusCallback?.(status, message);
        },
      );
    });
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
  public getCurrentEngine(): ActiveSttEngine {
    if (this.activeDelegate) return this.activeDelegate.getCurrentEngine();
    return this.currentEngine;
  }

  public getDiagnostics(): SttStreamDiagnostics {
    if (this.activeDelegate) return this.activeDelegate.getDiagnostics();
    return {
      engine: this.currentEngine,
      audioSeconds: this.sentAudioBytes / (16000 * 2),
      receivedResponses: this.receivedResponses,
      receivedTextCharacters: this.receivedTextCharacters,
      lastResponseAt: this.lastResponseAt,
    };
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
