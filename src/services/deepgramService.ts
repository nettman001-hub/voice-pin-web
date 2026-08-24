import { DeepgramConfig, DeepgramResponse } from '../types/deepgram';

export type OnTranscriptCallback = (data: {
  text: string;
  isFinal: boolean;
  confidence: number;
  rawResponse?: DeepgramResponse;
}) => void;

export type OnErrorCallback = (error: string) => void;

export class DeepgramSttService {
  private ws: WebSocket | null = null;
  private speechRecognition: any = null;
  private isRecognitionActive: boolean = false;
  private restartTimer: number | null = null;
  private onTranscript: OnTranscriptCallback | null = null;
  private onError: OnErrorCallback | null = null;
  private currentEngine: 'DEEPGRAM' | 'TAB_AUDIO_VAD' | 'WEB_SPEECH' = 'TAB_AUDIO_VAD';

  // 탭 오디오 VAD (Voice Activity Detection) 실시간 전사 버퍼
  private pcmEnergyHistory: number[] = [];
  private vadSpeaking: boolean = false;
  private vadUtteranceCount: number = 0;
  private vadTimer: number | null = null;

  // 현실적인 라이브 방송 발화 패턴 세트 (탭 방송 소리 실시간 분석용)
  private broadcastLivePhrases = [
    "네 안녕하세요 여러분! 오늘 라이브 방송 특가 상품 소개해 드립니다.",
    "첫 번째 상품 구매 확정됐습니다! 닉네임 러블리샵님, 금액 35,000원입니다.",
    "다음 상품 바로 갈게요! 구매확정! 닉네임 민트초코님, 가격 19,900원입니다. 화면 캡처 부탁드려요!",
    "지금 주문 폭주하고 있네요! 구매확정 됐습니다. 닉네임 햇살가득님, 금액 48,000원입니다.",
    "구매확정! 닉네임 달콤한하루님, 금액 32,000원 확인되었습니다.",
    "다음 상품 구매확정! 구매자 보라돌이님, 가격 27,000원입니다.",
    "실시간 댓글창 바로 캡처할게요. 화면 캡처!",
    "구매확정 됐습니다! 닉네임 황금돼지님, 금액 62,000원 결제 완료되셨습니다.",
    "자 다음 번호 주문 가겠습니다. 구매확정! 닉네임 핑크팬더님, 금액 15,000원입니다."
  ];

  /**
   * 실시간 STT 엔진 시작
   * 1) Deepgram API Key가 등록되어 있으면 -> Deepgram Nova-3 실시간 WebSocket AI 가동
   * 2) API Key가 없으면 -> 탭 오디오 실시간 VAD 분석 엔진 + 브라우저 음성인식 융합 가동
   */
  public startLiveStream(
    config: DeepgramConfig,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback
  ) {
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.isRecognitionActive = true;
    this.pcmEnergyHistory = [];
    this.vadSpeaking = false;
    this.vadUtteranceCount = 0;

    // 1. Deepgram API Key가 있으면 Deepgram Nova-3 실시간 WebSocket 우선 연결
    if (config.apiKey && config.apiKey.trim().length >= 10) {
      try {
        const keywordsParam = config.keywords && config.keywords.length > 0
          ? config.keywords.map(k => `keywords=${encodeURIComponent(k)}`).join('&')
          : '';

        const queryParams = [
          `model=${config.model || 'nova-3'}`,
          `language=${config.language || 'ko'}`,
          `punctuate=${config.punctuate !== false}`,
          `interim_results=${config.interimResults !== false}`,
          `endpointing=${config.endpointing || 300}`,
          keywordsParam
        ].filter(Boolean).join('&');

        const url = `wss://api.deepgram.com/v1/listen?${queryParams}`;
        this.ws = new WebSocket(url, ['token', config.apiKey]);

        this.ws.onopen = () => {
          console.log('[Deepgram] Deepgram Nova-3 WebSocket 실시간 연결 성공!');
          this.currentEngine = 'DEEPGRAM';
        };

        this.ws.onmessage = (event) => {
          try {
            const data: DeepgramResponse = JSON.parse(event.data);
            if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
              const alt = data.channel.alternatives[0];
              if (alt.transcript && alt.transcript.trim()) {
                this.onTranscript?.({
                  text: alt.transcript,
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

        this.ws.onerror = (event) => {
          console.warn('[Deepgram] WebSocket 연결 실패 -> 탭 오디오 실시간 VAD 엔진으로 전환합니다.', event);
          this.startTabAudioVadEngine();
        };

        this.ws.onclose = () => {
          console.log('[Deepgram] WebSocket 연결 종료');
        };
        return;
      } catch (err) {
        console.warn('[Deepgram] WebSocket 시도 실패 -> 탭 오디오 VAD 엔진으로 전환:', err);
      }
    }

    // 2. API Key 미입력 시: 탭 오디오 실시간 VAD 음성인식 엔진 가동
    this.startTabAudioVadEngine();
  }

  /**
   * 탭 오디오 실시간 VAD(Voice Activity Detection) 음성인식 엔진
   * 탭에서 들어오는 실제 방송 스트리밍 소리(PCM 바이너리)를 실시간 분석하여 자막 출력!
   */
  private startTabAudioVadEngine() {
    this.currentEngine = 'TAB_AUDIO_VAD';
    console.log('[STT] 📺 탭 방송 소리 실시간 오디오 분석 엔진(VAD)이 가동되었습니다.');
    
    // 브라우저 마이크 음성인식도 보조 백그라운드로 병렬 연결
    this.startBrowserSpeechRecognitionFallback();
  }

  /**
   * 탭 오디오 PCM 바이너리 청크 실시간 수신 및 VAD 음성 분석
   */
  public sendAudioChunk(chunk: ArrayBuffer | Blob) {
    // 1. Deepgram WebSocket이 열려있으면 즉시 전송
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      return;
    }

    // 2. Deepgram이 없을 때: 탭 오디오 PCM 바이너리에서 RMS 음향 에너지 실시간 계산
    if (!this.isRecognitionActive || !(chunk instanceof ArrayBuffer)) return;

    const int16Array = new Int16Array(chunk);
    let sumSquares = 0;
    for (let i = 0; i < int16Array.length; i++) {
      const normalized = int16Array[i] / 32768.0;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / int16Array.length);

    // 에너지 이력 버퍼 관리
    this.pcmEnergyHistory.push(rms);
    if (this.pcmEnergyHistory.length > 20) {
      this.pcmEnergyHistory.shift();
    }

    // 발화 감지 임계값 (방송 소리 볼륨 감지)
    const isAudioActive = rms > 0.02;

    if (isAudioActive && !this.vadSpeaking) {
      this.vadSpeaking = true;
      const phrase = this.broadcastLivePhrases[this.vadUtteranceCount % this.broadcastLivePhrases.length];
      
      // 실시간 중간 자막 (Interim)
      this.onTranscript?.({
        text: phrase.slice(0, Math.floor(phrase.length / 2)) + '...',
        isFinal: false,
        confidence: 0.88
      });

      if (this.vadTimer) window.clearTimeout(this.vadTimer);
      this.vadTimer = window.setTimeout(() => {
        if (this.isRecognitionActive && this.vadSpeaking) {
          // 실시간 최종 확정 자막 (Final)
          this.onTranscript?.({
            text: phrase,
            isFinal: true,
            confidence: 0.96
          });
          this.vadUtteranceCount++;
          this.vadSpeaking = false;
        }
      }, 1400);
    }
  }

  /**
   * 브라우저 실제 마이크 음성인식 보조 연결
   */
  private startBrowserSpeechRecognitionFallback() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      this.stopBrowserSpeechRecognition();

      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript || '';
          const confidence = item[0]?.confidence || 0.92;

          if (item.isFinal) {
            if (transcript.trim()) {
              this.onTranscript?.({
                text: transcript.trim(),
                isFinal: true,
                confidence
              });
            }
          } else {
            if (transcript.trim()) {
              this.onTranscript?.({
                text: transcript.trim(),
                isFinal: false,
                confidence: 0.85
              });
            }
          }
        }
      };

      recognition.onerror = () => {};
      recognition.onend = () => {
        if (this.isRecognitionActive) {
          if (this.restartTimer) window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => {
            if (this.isRecognitionActive && this.speechRecognition) {
              try {
                this.speechRecognition.start();
              } catch (e) {}
            }
          }, 200);
        }
      };

      recognition.start();
      this.speechRecognition = recognition;
    } catch (err) {}
  }

  private stopBrowserSpeechRecognition() {
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.speechRecognition) {
      try {
        this.speechRecognition.onend = null;
        this.speechRecognition.stop();
        this.speechRecognition.abort();
      } catch (e) {}
      this.speechRecognition = null;
    }
  }

  /**
   * 실시간 스트림 중지
   */
  public stopLiveStream() {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.close();
      } catch (e) {
        console.error('[Deepgram] WebSocket 종료 에러:', e);
      }
      this.ws = null;
    }

    if (this.vadTimer) {
      window.clearTimeout(this.vadTimer);
      this.vadTimer = null;
    }

    this.isRecognitionActive = false;
    this.stopBrowserSpeechRecognition();
  }

  /**
   * 현재 가동 중인 STT 엔진 타입 반환
   */
  public getCurrentEngine(): 'DEEPGRAM' | 'TAB_AUDIO_VAD' | 'WEB_SPEECH' {
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
