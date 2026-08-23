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
  private isSimulating: boolean = false;
  private simulationInterval: number | null = null;
  private onTranscript: OnTranscriptCallback | null = null;
  private onError: OnErrorCallback | null = null;

  // 현실적인 틱톡 라이브 판매 멘트 시나리오 세트
  private simulationScenarios = [
    { text: "네 안녕하세요 여러분! 오늘 라이브 특가 상품 소개해 드립니다.", isSale: false, delay: 3000 },
    { text: "첫 번째 상품 구매 확정됐습니다! 구매하신 분은 러블리님 이시구요, 금액은 35,000원입니다.", isSale: true, delay: 5000 },
    { text: "다음 상품 가볼게요. 구매확정! 닉네임 민트초코님, 가격 19,900원입니다. 캡처 부탁드려요!", isSale: true, isCapture: true, delay: 6000 },
    { text: "와 지금 주문 폭주하고 있네요! 구매확정 됐습니다. 닉네임 햇살가득님, 금액 48,000원입니다.", isSale: true, delay: 5000 },
    { text: "어? 방금 닉네임을 잘못 말씀드렸네요. 수정 시작!", isSale: false, delay: 4000 },
    { text: "닉네임은 달콤한하루님, 금액은 48,000원!", isSale: false, delay: 3500 },
    { text: "네 확인됐습니다. 수정 완료!", isSale: false, delay: 3000 },
    { text: "다음 상품 구매확정! 구매자 보라돌이님, 가격 삼만오천원입니다.", isSale: true, delay: 5000 },
    { text: "지금 댓글창 바로 캡처할게요. 화면 캡처!", isSale: false, isCapture: true, delay: 4000 },
    { text: "구매확정 됐습니다! 이번엔 닉네임만 확인되고 금액이 빠졌네요.", isSale: true, delay: 5000 }, // 보류 테스트용
    { text: "구매확정! 닉네임 황금돼지님, 금액 62,000원 결제 완료되셨습니다.", isSale: true, delay: 5000 },
  ];

  /**
   * Deepgram Nova-3 실시간 WebSocket 연결 시작 (API Key 있을 시 실제 스트리밍, 없을 시 지능형 시뮬레이터)
   */
  public startLiveStream(
    config: DeepgramConfig,
    onTranscript: OnTranscriptCallback,
    onError: OnErrorCallback
  ) {
    this.onTranscript = onTranscript;
    this.onError = onError;

    if (!config.apiKey || config.apiKey.trim().length === 0) {
      console.info('[Deepgram] API Key가 설정되지 않아 지능형 Nova-3 시뮬레이터 모드로 작동합니다.');
      this.startSimulation();
      return;
    }

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
        console.log('[Deepgram] WebSocket Nova-3 연결 성공');
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
        console.error('[Deepgram] WebSocket 에러 발생, 시뮬레이터 모드로 대체합니다.', event);
        this.onError?.('Deepgram WebSocket 연결 오류가 발생하여 시뮬레이터 모드로 전환합니다.');
        this.startSimulation();
      };

      this.ws.onclose = () => {
        console.log('[Deepgram] WebSocket 연결 종료');
      };
    } catch (err: any) {
      console.error('[Deepgram] WebSocket 초기화 실패:', err);
      this.onError?.(err?.message || 'Deepgram 초기화 실패');
      this.startSimulation();
    }
  }

  /**
   * 오디오 바이너리 청크 (Linear PCM 또는 WebM)를 Deepgram WebSocket으로 전송
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

    if (this.simulationInterval) {
      window.clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.isSimulating = false;
  }

  /**
   * 틱톡 라이브 판매 음성 인식 시뮬레이터
   */
  private startSimulation() {
    this.isSimulating = true;
    let index = 0;

    const playNext = () => {
      if (!this.isSimulating) return;

      const item = this.simulationScenarios[index % this.simulationScenarios.length];
      index++;

      // 1. 중간(Interim) 전사 자막 시뮬레이션
      const words = item.text.split(' ');
      let currentWordIndex = 0;

      const interimInterval = window.setInterval(() => {
        if (!this.isSimulating) {
          clearInterval(interimInterval);
          return;
        }

        currentWordIndex += 2;
        if (currentWordIndex < words.length) {
          const partialText = words.slice(0, currentWordIndex).join(' ');
          this.onTranscript?.({
            text: partialText,
            isFinal: false,
            confidence: 0.85
          });
        } else {
          clearInterval(interimInterval);
          // 2. 최종(Final) 전사 텍스트 발행
          this.onTranscript?.({
            text: item.text,
            isFinal: true,
            confidence: 0.96
          });

          // 다음 시나리오 대기 후 실행
          this.simulationInterval = window.setTimeout(playNext, item.delay || 4000);
        }
      }, 400);
    };

    this.simulationInterval = window.setTimeout(playNext, 1500);
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
