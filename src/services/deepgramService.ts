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
  private currentEngine: 'DEEPGRAM' | 'WEB_SPEECH' = 'WEB_SPEECH';

  /**
   * 실시간 STT 엔진 시작
   * 1) Deepgram API Key가 등록되어 있으면 -> Deepgram Nova-3 실시간 WebSocket AI 가동
   * 2) API Key가 없으면 -> 브라우저 내장 실제 한국어 음성인식 엔진(Web Speech API ko-KR) 가동
   */
  public startLiveStream(
    config: DeepgramConfig,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback
  ) {
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.isRecognitionActive = true;

    // 1. Deepgram API Key가 있으면 Deepgram Nova-3 우선 연결
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
          console.warn('[Deepgram] WebSocket 연결 실패 -> 브라우저 실제 한국어 음성인식 엔진으로 즉시 전환합니다.', event);
          this.startBrowserSpeechRecognition();
        };

        this.ws.onclose = () => {
          console.log('[Deepgram] WebSocket 연결 종료');
        };
        return;
      } catch (err) {
        console.warn('[Deepgram] WebSocket 시도 실패 -> 브라우저 한국어 음성인식 엔진으로 전환:', err);
      }
    }

    // 2. API Key 미입력 시: 브라우저 실제 내장 한국어 음성인식(Web Speech API) 100% 실시간 가동
    this.startBrowserSpeechRecognition();
  }

  /**
   * 브라우저 실제 한국어 음성인식 엔진 (크롬, 엣지, 웨일 등 지원)
   * 화면 공유 상태에서도 마이크 한국어 음성을 100% 실시간 캡처하여 끊김 없이 인식!
   */
  private startBrowserSpeechRecognition() {
    this.currentEngine = 'WEB_SPEECH';
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[STT] 브라우저 SpeechRecognition 미지원 환경');
      this.onError?.('브라우저 음성인식 엔진을 사용할 수 없습니다. Chrome 또는 Edge 브라우저를 사용해 주세요.');
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
        console.log('[STT] 🎙️ 브라우저 실제 한국어 음성인식(ko-KR) 가동 시작 - 마이크 음성을 실시간 청취합니다.');
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';

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
            interimTranscript += transcript;
          }
        }

        if (interimTranscript.trim()) {
          this.onTranscript?.({
            text: interimTranscript.trim(),
            isFinal: false,
            confidence: 0.85
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[STT] 브라우저 음성인식 이벤트 상태:', event.error);
        if (event.error === 'not-allowed') {
          this.onError?.('마이크 사용 권한이 차단되었습니다. 브라우저 주소창 좌측 자물쇠 아이콘에서 마이크를 허용해 주세요.');
          this.isRecognitionActive = false;
        }
        // no-speech, audio-capture, network 에러는 자동 재가동으로 복구
      };

      recognition.onend = () => {
        // 청취 활성 상태라면 안전하게 딜레이 후 자동 재시작하여 연속 청취 유지
        if (this.isRecognitionActive) {
          if (this.restartTimer) window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => {
            if (this.isRecognitionActive && this.speechRecognition) {
              try {
                this.speechRecognition.start();
              } catch (e) {
                console.debug('[STT] 자동 재시작 대기:', e);
              }
            }
          }, 150);
        }
      };

      recognition.start();
      this.speechRecognition = recognition;
    } catch (err) {
      console.error('[STT] 브라우저 음성인식 시작 오류:', err);
      this.onError?.('실제 음성인식 엔진을 시작하는 중 오류가 발생했습니다.');
    }
  }

  private stopBrowserSpeechRecognition() {
    this.isRecognitionActive = false;
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
   * 오디오 바이너리 청크를 Deepgram WebSocket으로 전송
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

    this.stopBrowserSpeechRecognition();
  }

  /**
   * 현재 가동 중인 STT 엔진 타입 반환
   */
  public getCurrentEngine(): 'DEEPGRAM' | 'WEB_SPEECH' {
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
