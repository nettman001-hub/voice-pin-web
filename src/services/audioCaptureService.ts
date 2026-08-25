import { screenCaptureService } from './screenCaptureService';

export type AudioDataCallback = (chunk: ArrayBuffer) => void;
export type WaveformCallback = (waveform: Uint8Array, volume: number) => void;

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private animationFrameId: number | null = null;
  private isCapturing: boolean = false;
  private isPaused: boolean = false;
  private captureGeneration = 0;
  private onAudioChunk: AudioDataCallback | null = null;
  private onWaveform: WaveformCallback | null = null;

  private createCancelledError(): DOMException {
    return new DOMException('오디오 캡처 시작이 취소되었습니다.', 'AbortError');
  }

  /**
   * 화면공유 원본 트랙은 screenCaptureService가 소유한다.
   * 청취 파이프라인에서는 clone만 사용해 중지 시 원본 공유 연결을 보존한다.
   */
  private createDisplayAudioStream(displayStream: MediaStream): MediaStream | null {
    const sourceTrack = displayStream
      .getAudioTracks()
      .find((track) => track.readyState === 'live');

    return sourceTrack ? new MediaStream([sourceTrack.clone()]) : null;
  }

  /**
   * 오디오 캡처 시작 (크롬 탭 방송 소리 또는 마이크)
   */
  public async startCapture(
    mode: 'TAB_AUDIO' | 'MIC' = 'TAB_AUDIO',
    onAudioChunk?: AudioDataCallback,
    onWaveform?: WaveformCallback
  ): Promise<MediaStream> {
    this.stopCapture();
    const captureGeneration = this.captureGeneration;
    this.onAudioChunk = onAudioChunk ?? null;
    this.onWaveform = onWaveform ?? null;
    this.isPaused = false;

    let stream: MediaStream | null = null;

    try {
      if (mode === 'TAB_AUDIO') {
        // 1. 이미 연결된 화면/탭 공유 스트림에 오디오 트랙이 있는지 확인
        const activeScreenStream = screenCaptureService.getActiveStream();
        if (activeScreenStream) {
          stream = this.createDisplayAudioStream(activeScreenStream);
        }

        if (stream) {
          console.log('[AudioCapture] 기존 연결된 탭 방송 오디오 스트림 재사용');
        } else {
          // 공유가 없으면 최초 연결, 화면만 남고 오디오가 끝났다면 새 연결을 요청한다.
          const newScreenStream = await screenCaptureService.getOrCreateStream(!!activeScreenStream);
          if (newScreenStream) {
            stream = this.createDisplayAudioStream(newScreenStream);
          }

          if (stream) {
            console.log('[AudioCapture] 새 탭 방송 오디오 스트림 획득 성공!');
          }
        }

        if (!stream) {
          throw new Error('방송 탭 오디오가 공유되지 않았습니다. 방송 탭과 「탭 오디오 공유」를 선택해 주세요.');
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
            sampleRate: 16000,
          },
          video: false,
        });
      }
    } catch (err) {
      console.warn('[AudioCapture] 오디오 연결 실패:', err);
      throw err;
    }

    if (captureGeneration !== this.captureGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw this.createCancelledError();
    }

    this.mediaStream = stream;
    this.isCapturing = true;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioContextClass({ sampleRate: 16000 });
      this.audioContext = audioContext;

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (captureGeneration !== this.captureGeneration) {
        if (audioContext.state !== 'closed') void audioContext.close();
        stream.getTracks().forEach((track) => track.stop());
        throw this.createCancelledError();
      }

      const source = audioContext.createMediaStreamSource(stream);

      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

      // PCM 오디오 청크 추출용 ScriptProcessor
      this.scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(audioContext.destination);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isCapturing || captureGeneration !== this.captureGeneration) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Float32 -> 16bit Linear PCM 변환
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.onAudioChunk?.(pcm16.buffer);
      };

      this.startWaveformLoop();
    } catch (e) {
      if (captureGeneration !== this.captureGeneration || (e instanceof DOMException && e.name === 'AbortError')) {
        stream.getTracks().forEach((track) => track.stop());
        throw this.createCancelledError();
      }
      console.warn('[AudioCapture] AudioContext 시각화 연결 실패:', e);
    }

    if (captureGeneration !== this.captureGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw this.createCancelledError();
    }

    return stream;
  }

  /**
   * 파형 및 볼륨 시각화 루프 시작
   */
  private startWaveformLoop(): void {
    if (!this.analyser) return;

    const analyser = this.analyser;
    const rawDataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastTimestamp = 0;

    const updateWaveform = (timestamp: number) => {
      if (!this.isCapturing || !this.analyser || this.analyser !== analyser) return;

      if (timestamp - lastTimestamp >= 16) {
        lastTimestamp = timestamp;
        analyser.getByteFrequencyData(rawDataArray);

        // 볼륨 RMS 계산
        let sum = 0;
        for (let i = 0; i < rawDataArray.length; i++) {
          sum += rawDataArray[i] * rawDataArray[i];
        }
        const rms = Math.sqrt(sum / rawDataArray.length);
        const normalizedVolume = Math.min(100, Math.round((rms / 255) * 100));

        this.onWaveform?.(new Uint8Array(rawDataArray), normalizedVolume);
      }

      this.animationFrameId = requestAnimationFrame(updateWaveform);
    };

    this.animationFrameId = requestAnimationFrame(updateWaveform);
  }

  /**
   * 청취 파이프라인(오디오 트랙·AudioContext)은 유지한 채 전송만 일시정지한다.
   * Chrome은 탭 공유 오디오의 clone을 stop하면 원본 오디오 트랙도 종료시키므로,
   * 방송 탭 공유 연결을 보존하려면 트랙을 끝내지 말고 파이프라인을 일시정지해야 한다.
   */
  public pauseCapture(): void {
    if (!this.mediaStream && !this.audioContext) return;

    this.isPaused = true;
    this.isCapturing = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioContext && this.audioContext.state === 'running') {
      try {
        void this.audioContext.suspend();
      } catch {}
    }
  }

  /**
   * 일시정지된 청취 파이프라인 재개.
   * 콜백을 최신 세션 기준으로 교체하고 오디오 컨텍스트를 재가동한다.
   * 파이프라인이 없거나 트랙이 종료된 경우 false를 반환한다.
   */
  public async resumeCapture(
    onAudioChunk?: AudioDataCallback,
    onWaveform?: WaveformCallback
  ): Promise<boolean> {
    if (!this.mediaStream || !this.audioContext || !this.scriptProcessor) {
      return false;
    }

    const hasLiveTrack = this.mediaStream
      .getAudioTracks()
      .some((track) => track.readyState === 'live');

    if (!hasLiveTrack || this.audioContext.state === 'closed') {
      return false;
    }

    if (onAudioChunk) this.onAudioChunk = onAudioChunk;
    if (onWaveform) this.onWaveform = onWaveform;

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch {
      return false;
    }

    this.isPaused = false;
    this.isCapturing = true;
    this.startWaveformLoop();
    return true;
  }

  /**
   * 오디오 캡처 중지
   */
  public stopCapture() {
    this.captureGeneration += 1;
    this.isCapturing = false;
    this.isPaused = false;
    this.onAudioChunk = null;
    this.onWaveform = null;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {}
      this.scriptProcessor = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {}
      this.analyser = null;
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        try {
          void this.audioContext.close();
        } catch {}
      }
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  public getActiveStream(): MediaStream | null {
    return this.mediaStream;
  }
}

export const audioCaptureService = new AudioCaptureService();
