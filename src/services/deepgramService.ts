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
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onStatus = onStatus || null;
    this.isRecognitionActive = true;
    this.lastFinalText = '';

    const cleanApiKey = (config.apiKey || '').trim();

    // 1. Deepgram API Key가 있는 경우: Deepgram Nova-2/Nova-3 실시간 WebSocket 연결
    if (cleanApiKey.length >= 10) {
      try {
        this.onStatus?.('CONNECTING', 'Deepgram AI 서버에 연결 중...');

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
        this.ws = new WebSocket(url, ['token', cleanApiKey]);

        this.ws.onopen = () => {
          console.log('[Deepgram] 🟢 Deepgram WebSocket 실시간 연결 성공!');
          this.currentEngine = 'DEEPGRAM';
          this.onStatus?.('CONNECTED', 'Deepgram AI 연결 성공! 방송 소리를 실시간 전사합니다.');
        };

        this.ws.onmessage = (event) => {
          try {
            const data: DeepgramResponse = JSON.parse(event.data);
            if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
              const alt = data.channel.alternatives[0];
              if (alt.transcript && alt.transcript.trim()) {
                console.log('[Deepgram] 🎯 전사 결과 수신:', alt.transcript);
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
          console.warn('[Deepgram] 🔴 WebSocket 연결 실패:', event);
          this.onStatus?.('ERROR', 'Deepgram 연결 실패 (API 키를 확인해 주세요)');
          this.onError?.('Deepgram WebSocket 연결 실패. 브라우저 마이크 음성인식으로 전환합니다.');
          this.startBrowserSpeechRecognition();
        };

        this.ws.onclose = (event) => {
          console.log('[Deepgram] WebSocket 연결 종료 코드:', event.code, event.reason);
          if (this.isRecognitionActive && this.currentEngine === 'DEEPGRAM') {
            this.onStatus?.('DISCONNECTED', 'Deepgram 연결이 종료되었습니다.');
          }
        };
        return;
      } catch (err: any) {
        console.warn('[Deepgram] WebSocket 초기화 실패 -> 마이크 음성인식으로 전환:', err);
      }
    }

    // 2. Deepgram API Key가 없는 경우: 브라우저 실제 마이크 한국어 음성인식 100% 가동
    this.startBrowserSpeechRecognition();
  }

  /**
   * 브라우저 실제 한국어 음성인식 엔진
   */
  private startBrowserSpeechRecognition() {
    this.currentEngine = 'WEB_SPEECH';
    this.onStatus?.('CONNECTED', '브라우저 마이크 음성인식 가동 중 (ko-KR)');
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[STT] 브라우저 SpeechRecognition 미지원');
      this.onError?.('브라우저 음성인식이 지원되지 않는 환경입니다. Chrome 또는 Edge 브라우저를 권장합니다.');
      this.currentEngine = 'NONE';
      this.onStatus?.('ERROR', '음성인식 미지원 브라우저');
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
        console.log('[STT] 🎙️ 브라우저 실제 한국어 음성인식 시작');
      };

      recognition.onresult = (event: any) => {
        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          const confidence = res[0]?.confidence || 0.92;

          if (res.isFinal) {
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
        console.warn('[STT] 음성인식 에러:', event.error);
        if (event.error === 'not-allowed') {
          this.onError?.('마이크 사용 권한이 차단되었습니다. 브라우저 주소창 좌측에서 마이크를 허용해 주세요.');
          this.onStatus?.('ERROR', '마이크 권한 거부됨');
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
      console.warn('[STT] 브라우저 음성인식 시작 실패:', err);
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
    this.onStatus?.('DISCONNECTED', '청취 중지됨');
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
