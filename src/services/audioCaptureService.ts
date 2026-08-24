export type AudioDataCallback = (chunk: ArrayBuffer) => void;
export type WaveformCallback = (waveform: Uint8Array, volume: number) => void;

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private animationFrameId: number | null = null;
  private isCapturing: boolean = false;

  /**
   * 오디오 캡처 시작 (마이크 또는 화면/시스템 오디오 루프백)
   */
  public async startCapture(
    mode: 'MIC' | 'SYSTEM_LOOPBACK' = 'MIC',
    onAudioChunk?: AudioDataCallback,
    onWaveform?: WaveformCallback
  ): Promise<MediaStream> {
    this.stopCapture();

    let stream: MediaStream;
    try {
      if (mode === 'SYSTEM_LOOPBACK' && navigator.mediaDevices.getDisplayMedia) {
        // 시스템 오디오 / 창 오디오 캡처 (화면 공유 API)
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as any
        });
      } else {
        // 기본 마이크 캡처
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
    } catch (err: any) {
      console.warn('[AudioCapture] 장치 오디오 요청 실패, 가상 마이크 모드로 폴백합니다:', err);
      // 가상 미디어 스트림 생성 (AudioContext oscillator)
      const fakeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = fakeCtx.createOscillator();
      const dst = fakeCtx.createMediaStreamDestination();
      osc.connect(dst);
      osc.start();
      stream = dst.stream;
    }

    this.mediaStream = stream;
    this.isCapturing = true;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });

      // 브라우저 자동재생 정책으로 suspended 된 경우 즉시 resume
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(stream);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

      // PCM 오디오 청크 추출용 ScriptProcessor
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isCapturing) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Float32 -> 16bit Linear PCM 변환
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        onAudioChunk?.(pcm16.buffer);
      };

      // 파형 및 볼륨 시각화 루프
      const rawDataArray = new Uint8Array(this.analyser.frequencyBinCount);
      let lastTimestamp = 0;

      const updateWaveform = (timestamp: number) => {
        if (!this.isCapturing || !this.analyser) return;

        // 약 60fps로 React State 갱신
        if (timestamp - lastTimestamp >= 16) {
          lastTimestamp = timestamp;
          this.analyser.getByteFrequencyData(rawDataArray);

          let sum = 0;
          for (let i = 0; i < rawDataArray.length; i++) {
            sum += rawDataArray[i];
          }
          const avg = sum / rawDataArray.length;
          const volume = Math.min(100, Math.round((avg / 255) * 100 * 2.5));

          // React가 상태 변화를 감지할 수 있도록 새 Uint8Array 인스턴스로 복사 전달
          onWaveform?.(new Uint8Array(rawDataArray), volume);
        }

        this.animationFrameId = requestAnimationFrame(updateWaveform);
      };

      this.animationFrameId = requestAnimationFrame(updateWaveform);
    } catch (err) {
      console.error('[AudioCapture] 오디오 컨텍스트 초기화 에러:', err);
    }

    return stream;
  }

  public stopCapture() {
    this.isCapturing = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
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
