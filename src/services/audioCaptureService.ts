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

  /**
   * 오디오 캡처 시작 (크롬 탭 방송 소리 또는 마이크)
   */
  public async startCapture(
    mode: 'TAB_AUDIO' | 'MIC' = 'TAB_AUDIO',
    onAudioChunk?: AudioDataCallback,
    onWaveform?: WaveformCallback
  ): Promise<MediaStream> {
    this.stopCapture();

    let stream: MediaStream | null = null;

    try {
      if (mode === 'TAB_AUDIO') {
        // 1. 이미 연결된 화면/탭 공유 스트림에 오디오 트랙이 있는지 확인
        const activeScreenStream = screenCaptureService.getActiveStream();
        if (activeScreenStream && activeScreenStream.getAudioTracks().some(t => t.readyState === 'live')) {
          stream = new MediaStream(activeScreenStream.getAudioTracks());
          console.log('[AudioCapture] 기존 연결된 탭 방송 오디오 스트림 재사용');
        } else {
          // 새로 화면/탭 오디오 공유 요청
          const newScreenStream = await screenCaptureService.getOrCreateStream(true);
          if (newScreenStream && newScreenStream.getAudioTracks().length > 0) {
            stream = new MediaStream(newScreenStream.getAudioTracks());
            console.log('[AudioCapture] 새 탭 방송 오디오 스트림 획득 성공!');
          }
        }
      }

      // 탭 오디오가 없거나 마이크 모드일 경우
      if (!stream || stream.getAudioTracks().length === 0) {
        if (mode === 'TAB_AUDIO') {
          console.info('[AudioCapture] 탭 오디오 트랙이 없어 마이크 오디오로 보조 전환합니다.');
        }
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
      console.warn('[AudioCapture] 장치 오디오 요청 예외, 가상 스트림 폴백:', err);
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

        if (timestamp - lastTimestamp >= 16) {
          lastTimestamp = timestamp;
          this.analyser.getByteFrequencyData(rawDataArray);

          // 볼륨 RMS 계산
          let sum = 0;
          for (let i = 0; i < rawDataArray.length; i++) {
            sum += rawDataArray[i] * rawDataArray[i];
          }
          const rms = Math.sqrt(sum / rawDataArray.length);
          const normalizedVolume = Math.min(100, Math.round((rms / 255) * 100));

          onWaveform?.(new Uint8Array(rawDataArray), normalizedVolume);
        }

        this.animationFrameId = requestAnimationFrame(updateWaveform);
      };

      this.animationFrameId = requestAnimationFrame(updateWaveform);
    } catch (e) {
      console.warn('[AudioCapture] AudioContext 시각화 연결 실패:', e);
    }

    return stream;
  }

  /**
   * 오디오 캡처 중지
   */
  public stopCapture() {
    this.isCapturing = false;

    if (this.animationFrameId) {
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

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
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
