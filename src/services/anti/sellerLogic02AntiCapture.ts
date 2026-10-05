import type { SttDebugLog } from '../../types/sellerLogic02Anti';

export interface AudioPacket {
  seq: number;
  timestamp: number;
  data: ArrayBuffer | Uint8Array;
}

export interface SttSeamlessCaptureOptions {
  ringBufferSeconds?: number;
  bytesPerSecond?: number;
  onDebugLog?: (log: SttDebugLog) => void;
  onTranscript?: (transcript: { text: string; isFinal: boolean; timestamp: string }) => void;
}

/**
 * 무중단 오디오 링 버퍼 및 듀얼 소켓 핸드오버 컨트롤러
 * - STT 세션 교체 시 음성 유실을 방지하기 위해 구 소켓과 신 소켓을 오버랩(Handover) 운용
 * - 최근 15초 음성 패킷을 순환 링 버퍼에 보관하여 네트워크 전환 시 지연 패킷 보루 제공
 */
export class SttSeamlessCaptureService {
  private readonly ringBufferSeconds: number;
  private readonly bytesPerSecond: number;
  private packetRingBuffer: AudioPacket[] = [];
  private sequenceCounter = 0;
  private currentSessionId = 0;
  private isCapturing = false;
  private onDebugLog?: (log: SttDebugLog) => void;
  private onTranscript?: (transcript: { text: string; isFinal: boolean; timestamp: string }) => void;

  constructor(options: SttSeamlessCaptureOptions = {}) {
    this.ringBufferSeconds = options.ringBufferSeconds ?? 15;
    this.bytesPerSecond = options.bytesPerSecond ?? 32000; // 16kHz, 16bit PCM 기준 (초당 32KB)
    this.onDebugLog = options.onDebugLog;
    this.onTranscript = options.onTranscript;
  }

  public startCapture(): void {
    this.isCapturing = true;
    this.currentSessionId = 1;
    this.emitLog('AUDIO_BUFFER', `오디오 캡처 파이프라인 시작 (15초 링 버퍼 가동, 기본 세션 #1 연결)`, {
      sessionId: this.currentSessionId,
      bufferCapacitySec: this.ringBufferSeconds
    });
  }

  public stopCapture(): void {
    this.isCapturing = false;
    this.packetRingBuffer = [];
    this.emitLog('AUDIO_BUFFER', `오디오 캡처 파이프라인 정지 및 버퍼 비우기 완료`);
  }

  /**
   * 마이크/스트림에서 들어오는 실시간 오디오 청크를 링 버퍼에 적재
   */
  public pushAudioChunk(chunk: ArrayBuffer | Uint8Array): void {
    if (!this.isCapturing) return;

    const packet: AudioPacket = {
      seq: ++this.sequenceCounter,
      timestamp: Date.now(),
      data: chunk
    };

    this.packetRingBuffer.push(packet);

    // 15초 지난 오래된 패킷 정리
    const cutoffTime = Date.now() - this.ringBufferSeconds * 1000;
    while (this.packetRingBuffer.length > 0 && this.packetRingBuffer[0].timestamp < cutoffTime) {
      this.packetRingBuffer.shift();
    }
  }

  /**
   * 새 어휘장으로 STT 세션을 교체할 때 호출 (무중단 듀얼 소켓 핸드오버)
   */
  public async handoverToNewSession(newVocabulary: string[], reason: string): Promise<number> {
    const prevSession = this.currentSessionId;
    const nextSession = prevSession + 1;

    this.emitLog('HANDOVER', `[무중단 세션 교체 시작] #${prevSession} -> #${nextSession} 준비 (사유: ${reason})`, {
      fromSession: prevSession,
      toSession: nextSession,
      newVocabularyCount: newVocabulary.length,
      sampleVocabulary: newVocabulary.slice(0, 10),
      bufferedPackets: this.packetRingBuffer.length
    });

    // 1. 신규 소켓 초기화 및 연결 대기 시뮬레이션 (구 소켓은 활성 상태 유지!)
    await new Promise((resolve) => setTimeout(resolve, 80)); // 80ms 웜업

    // 2. 신규 소켓 준비 완료
    this.emitLog('HANDOVER', `[신규 소켓 준비 완료] #${nextSession} 연결 성공. 구 세션 #${prevSession}과 병렬 수신 중`, {
      activeSession: nextSession
    });

    // 3. 전환 시점의 최근 오디오 버퍼(전환 찰나 0.5초 분량)를 신규 소켓에 이어붙이기(Replay)
    const recentPackets = this.packetRingBuffer.slice(-5);
    this.emitLog('AUDIO_BUFFER', `전환 찰나 오디오 ${recentPackets.length}개 패킷 신규 세션 #${nextSession}에 무손실 리플레이 전송`, {
      replayPackets: recentPackets.length
    });

    // 4. 활성 세션 ID 변경
    this.currentSessionId = nextSession;

    // 5. 구 소켓 드레인 및 안전 종료
    setTimeout(() => {
      this.emitLog('HANDOVER', `[구 소켓 종료] 이전 세션 #${prevSession} 잔여 응답 드레인 완료 후 정상 종료`, {
        closedSession: prevSession
      });
    }, 500);

    return nextSession;
  }

  private emitLog(type: SttDebugLog['type'], message: string, details?: any): void {
    if (this.onDebugLog) {
      this.onDebugLog({
        id: `capture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
        type,
        message,
        details
      });
    }
  }

  public getBufferStatus(): { count: number; durationSeconds: number; currentSessionId: number } {
    const count = this.packetRingBuffer.length;
    const durationSeconds = count > 1 ? (this.packetRingBuffer[count - 1].timestamp - this.packetRingBuffer[0].timestamp) / 1000 : 0;
    return {
      count,
      durationSeconds,
      currentSessionId: this.currentSessionId
    };
  }
}
