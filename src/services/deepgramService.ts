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
  private currentEngine: 'DEEPGRAM' | 'WEB_SPEECH' | 'NONE' = 'NONE';
  private lastFinalText: string = '';

  /**
   * 실시간 STT 엔진 시작
   * 1) Deepgram API Key가 등록되어 있으면 -> Deepgram Nova-3 실시간 WebSocket AI 가동
   * 2) API Key가 없으면 -> 브라우저 내장 실제 마이크 음성인식(Web Speech API ko-KR) 가동
   */
  public startLiveStream(
    config: DeepgramConfig,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback
  ) {
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.isRecognitionActive = true;
    this.lastFinalText = '';

    // 1. Deepgram API Key가 있는 경우: Deepgram Nova-3 실시간 WebSocket 연결
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
          console.log('[Deepgram] Deepgram Nova-3 WebSocket 실시간 AI 연결 성공!');
          this.currentEngine = 'DEEPGRAM';
        };

        this.ws.onmessage = (event) => {
          try {
            const data: DeepgramResponse = JSON.parse(event.data);
            if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
              const alt = data.channel.alternatives[0];
              if (alt.transcript && alt.transcript.trim()) {
                this.onTranscript?.({
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

        this.ws.onerror = (event) => {
          console.warn('[Deepgram] WebSocket 연결 실패 -> 브라우저 실제 음성인식으로 전환합니다.', event);
          this.startBrowserSpeechRecognition();
        };

        this.ws.onclose = () => {
          console.log('[Deepgram] WebSocket 연결 종료');
        };
        return;
      } catch (err) {
        console.warn('[Deepgram] WebSocket 초기화 실패:', err);
      }
    }

    // 2. Deepgram API Key가 없는 경우: 브라우저 실제 마이크 한국어 음성인식 100% 가동
    this.startBrowserSpeechRecognition();
  }

  /**
   * 브라우저 실제 한국어 음성인식 엔진 (크롬, 엣지, 웨일 등)
   */
  private startBrowserSpeechRecognition() {
    this.currentEngine = 'WEB_SPEECH';
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[STT] 브라우저 SpeechRecognition 미지원');
      this.onError?.('브라우저 음성인식이 지원되지 않는 환경입니다. Chrome 또는 Edge 브라우저를 권장합니다.');
      this.currentEngine = 'NONE';
      return;
    }

    try {
      this.stopBrowserSpeechRecognition();

      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      this.isRecognitionActive = true;

      recognition.onstart = () => {
        console.log('[STT] 🎙️ 브라우저 실제 한국어 음성인식(ko-KR) 시작됨 - 음성을 실시간 청취합니다.');
      };

      recognition.onresult = (event: any) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          const confidence = res[0]?.confidence || 0.92;

          if (res.isFinal) {
            finalText += transcript;
            if (transcript.trim()) {
              this.lastFinalText = transcript.trim();
              this.onTranscript?.({
                text: transcript.trim(),
                isFinal: true,
                confidence
              });
            }
          } else {
            interimText += transcript;
          }
        }

        if (interimText.trim()) {
          this.onTranscript?.({
            text: interimText.trim(),
            isFinal: false,
            confidence: 0.85
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[STT] 음성인식 상태 이벤트:', event.error);
        if (event.error === 'not-allowed') {
          this.onError?.('마이크 사용 권한이 차단되었습니다. 브라우저 주소창 좌측 자물쇠에서 마이크를 허용해 주세요.');
          this.isRecognitionActive = false;
        }
      };

      recognition.onend = () => {
        if (this.isRecognitionActive) {
          if (this.restartTimer) window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => {
            if (this.isRecognitionActive && this.speechRecognition) {
              try {
                this.speechRecognition.start();
              } catch (e) {}
            }
          }, 150);
        }
      };

      recognition.start();
      this.speechRecognition = recognition;
    } catch (err) {
      console.warn('[STT] 브라우저 음성인식 시작 예외:', err);
    }
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

    this.isRecognitionActive = false;
    this.stopBrowserSpeechRecognition();
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
