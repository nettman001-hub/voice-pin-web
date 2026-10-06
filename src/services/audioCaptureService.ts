import { screenCaptureService } from './screenCaptureService';

export type AudioDataCallback = (chunk: ArrayBuffer) => void;
export type WaveformCallback = (waveform: Uint8Array, volume: number) => void;

export interface AudioCaptureDiagnostics {
  processor: 'NONE' | 'AUDIO_WORKLET' | 'SCRIPT_PROCESSOR';
  contextState: string;
  chunks: number;
  audioSeconds: number;
  lastChunkAt: number;
  lastSignalAt: number;
  trackMuted: boolean;
  trackEnabled: boolean;
}

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private diagnosticChunks = 0;
  private diagnosticSamples = 0;
  private lastChunkAt = 0;
  private lastSignalAt = 0;
  private animationFrameId: number | null = null;
  private isCapturing: boolean = false;
  private isPaused: boolean = false;
  private captureGeneration = 0;
  private captureMode: 'TAB_AUDIO' | 'MIC' = 'TAB_AUDIO';
  private onAudioChunk: AudioDataCallback | null = null;
  private onWaveform: WaveformCallback | null = null;

  private createCancelledError(): DOMException {
    return new DOMException('오디오 캡처 시작이 취소되었습니다.', 'AbortError');
  }

  /**
   * 화면공유 원본 트랙은 screenCaptureService가 소유한다.
   * 원본 오디오 트랙을 stop시키지 않고 새 MediaStream으로 감싸 반환한다.
   */
  private createDisplayAudioStream(displayStream: MediaStream): MediaStream | null {
    const sourceTrack = displayStream
      .getAudioTracks()
      .find((track) => track.readyState === 'live');

    return sourceTrack ? new MediaStream([sourceTrack]) : null;
  }

  /**
   * AudioContext와 오디오 처리 노드들을 정리한다.
   * 미디어 스트림 트랙은 종료(stop)하지 않는다.
   */
  private cleanupAudioNodes(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.onaudioprocess = null;
        this.scriptProcessor.disconnect();
      } catch {}
      this.scriptProcessor = null;
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.onprocessorerror = null;
      this.workletNode.port.close();
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {}
      this.analyser = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        try {
          void this.audioContext.close();
        } catch {}
      }
      this.audioContext = null;
    }
  }

  /**
   * 새 AudioContext와 오디오 파이프라인(Source -> Analyser -> PCM 처리기)을 구성한다.
   */
  private async setupAudioPipeline(
    stream: MediaStream,
    captureGeneration: number
  ): Promise<void> {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext: AudioContext = new AudioContextClass({ sampleRate: 16000 });
    this.audioContext = audioContext;

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (captureGeneration !== this.captureGeneration) {
      void audioContext.close();
      throw this.createCancelledError();
    }
    if (audioContext.state !== 'running') throw new Error('오디오 처리가 시작되지 않았습니다. 청취를 다시 시작해 주세요.');

    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;

    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    source.connect(this.analyser);

    this.diagnosticChunks = 0;
    this.diagnosticSamples = 0;
    this.lastChunkAt = 0;
    this.lastSignalAt = 0;
    const deliverPcm = (buffer: ArrayBuffer) => {
      if (!this.isCapturing || captureGeneration !== this.captureGeneration) return;
      const pcm = new Int16Array(buffer);
      this.diagnosticChunks++;
      this.diagnosticSamples += pcm.length;
      this.lastChunkAt = Date.now();
      if (pcm.some((value) => Math.abs(value) > 32)) this.lastSignalAt = this.lastChunkAt;
      if (this.diagnosticChunks === 1) console.log('[AudioCapture] 첫 PCM 청크 생성:', this.getDiagnostics());
      this.onAudioChunk?.(buffer);
    };

    const WorkletNode = window.AudioWorkletNode;
    if (audioContext.audioWorklet && WorkletNode) {
      await audioContext.audioWorklet.addModule(new URL('./voicecapPcmWorklet.js?no-inline', import.meta.url));
      if (captureGeneration !== this.captureGeneration) throw this.createCancelledError();
      const worklet = new WorkletNode(audioContext, 'voicecap-pcm', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.workletNode = worklet;
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => deliverPcm(event.data);
      worklet.onprocessorerror = () => {
        console.error('[AudioCapture] AudioWorklet 오디오 처리 오류');
      };
      this.analyser.connect(worklet);
      worklet.connect(audioContext.destination);
    } else {
      // Compatibility only; supported Chrome versions use the audio thread.
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessor = scriptProcessor;
      this.analyser.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const value = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = value < 0 ? value * 32768 : value * 32767;
        }
        deliverPcm(pcm16.buffer);
      };
    }

    console.log('[AudioCapture] PCM 처리 준비:', {
      processor: this.workletNode ? 'AUDIO_WORKLET' : 'SCRIPT_PROCESSOR',
      contextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
    });
    this.startWaveformLoop();
  }

  public getDiagnostics(): AudioCaptureDiagnostics {
    const track = this.mediaStream?.getAudioTracks()[0];
    return {
      processor: this.workletNode ? 'AUDIO_WORKLET' : this.scriptProcessor ? 'SCRIPT_PROCESSOR' : 'NONE',
      contextState: this.audioContext?.state || 'closed',
      chunks: this.diagnosticChunks,
      audioSeconds: this.diagnosticSamples / 16000,
      lastChunkAt: this.lastChunkAt,
      lastSignalAt: this.lastSignalAt,
      trackMuted: Boolean(track?.muted),
      trackEnabled: Boolean(track?.enabled),
    };
  }

  /**
   * 오디오 캡처 시작 (크롬 탭 방송 소리 또는 마이크)
   */
  public async startCapture(
    mode: 'TAB_AUDIO' | 'MIC' = 'TAB_AUDIO',
    onAudioChunk?: AudioDataCallback,
    onWaveform?: WaveformCallback
  ): Promise<MediaStream> {
    this.stopCaptureInternal(true);
    const captureGeneration = ++this.captureGeneration;
    this.onAudioChunk = onAudioChunk ?? null;
    this.onWaveform = onWaveform ?? null;
    this.isPaused = false;
    this.captureMode = mode;

    let stream: MediaStream | null = null;

    try {
      if (mode === 'TAB_AUDIO') {
        // 1. 이미 연결된 화면/탭 공유 스트림에 오디오 트랙이 있는지 확인
        const activeAudioTrack = screenCaptureService.getActiveAudioTrack();
        if (activeAudioTrack && activeAudioTrack.readyState === 'live') {
          stream = new MediaStream([activeAudioTrack]);
          console.log('[AudioCapture] 기존 연결된 탭 방송 오디오 트랙 재사용');
        } else {
          const activeScreenStream = screenCaptureService.getActiveStream();
          if (activeScreenStream) {
            stream = this.createDisplayAudioStream(activeScreenStream);
          }
        }

        if (!stream) {
          // 공유가 없거나 오디오가 없으면 새 연결 요청
          const activeScreenStream = screenCaptureService.getActiveStream();
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
      if (mode === 'MIC') {
        stream.getTracks().forEach((track) => track.stop());
      }
      throw this.createCancelledError();
    }

    this.mediaStream = stream;
    this.isCapturing = true;

    try {
      await this.setupAudioPipeline(stream, captureGeneration);
    } catch (e) {
      if (captureGeneration !== this.captureGeneration || (e instanceof DOMException && e.name === 'AbortError')) {
        if (mode === 'MIC') {
          stream.getTracks().forEach((track) => track.stop());
        }
        throw this.createCancelledError();
      }
      console.warn('[AudioCapture] AudioContext 파이프라인 연결 실패:', e);
      this.isCapturing = false;
      this.cleanupAudioNodes();
      if (mode === 'MIC') stream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
      throw e;
    }

    if (captureGeneration !== this.captureGeneration) {
      if (mode === 'MIC') {
        stream.getTracks().forEach((track) => track.stop());
      }
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
   * 청취 파이프라인을 일시정지한다.
   * Chrome의 AudioContext suspend/resume 먹통 버그를 방지하기 위해
   * AudioContext 및 오디오 노드들을 깨끗하게 close/disconnect하여 정리한다.
   * 단, 방송 탭 공유 트랙(screenCaptureService 소유)은 절대 stop하지 않고 live로 보존한다.
   */
  public pauseCapture(): void {
    this.captureGeneration += 1;
    this.isPaused = true;
    this.isCapturing = false;
    this.cleanupAudioNodes();
  }

  /**
   * 일시정지된 청취 파이프라인 재개.
   * 원본 방송 탭 오디오 트랙이 살아있다면, 신선한 AudioContext와 오디오 파이프라인을 즉시 생성하여
   * 닫힌 AudioContext를 재사용하지 않고 재개한다.
   */
  public async resumeCapture(
    onAudioChunk?: AudioDataCallback,
    onWaveform?: WaveformCallback
  ): Promise<boolean> {
    const captureGeneration = ++this.captureGeneration;

    // 1. 현재 mediaStream의 트랙 또는 screenCaptureService의 오디오 트랙이 살아있는지 확인
    let liveTrack: MediaStreamTrack | null = null;
    if (this.mediaStream) {
      liveTrack = this.mediaStream.getAudioTracks().find((t) => t.readyState === 'live') || null;
    }
    if (!liveTrack) {
      liveTrack = screenCaptureService.getActiveAudioTrack();
    }

    if (!liveTrack || liveTrack.readyState !== 'live') {
      return false;
    }

    // 새 MediaStream 객체 구성 (기존 live 트랙 재사용)
    this.mediaStream = new MediaStream([liveTrack]);
    this.captureMode = 'TAB_AUDIO';

    if (onAudioChunk) this.onAudioChunk = onAudioChunk;
    if (onWaveform) this.onWaveform = onWaveform;

    this.cleanupAudioNodes();

    try {
      this.isCapturing = true;
      this.isPaused = false;
      await this.setupAudioPipeline(this.mediaStream, captureGeneration);
      console.log('[AudioCapture] 방송 탭 오디오 파이프라인 성공적으로 재개됨');
      return true;
    } catch (err) {
      if (captureGeneration !== this.captureGeneration) return false;
      console.warn('[AudioCapture] 파이프라인 재개 실패:', err);
      this.isCapturing = false;
      this.isPaused = true;
      this.cleanupAudioNodes();
      return false;
    }
  }

  /**
   * 오디오 캡처 중지
   */
  public stopCapture(keepTabAudioTrack = true): void {
    this.stopCaptureInternal(keepTabAudioTrack);
  }

  private stopCaptureInternal(keepTabAudioTrack = true): void {
    this.captureGeneration += 1;
    this.isCapturing = false;
    this.isPaused = false;
    this.onAudioChunk = null;
    this.onWaveform = null;

    this.cleanupAudioNodes();

    if (this.mediaStream) {
      // TAB_AUDIO 모드일 때는 화면공유 원본 트랙을 보존하기 위해 트랙을 stop하지 않음
      if (this.captureMode === 'MIC' || !keepTabAudioTrack) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      }
      this.mediaStream = null;
    }
  }

  public getActiveStream(): MediaStream | null {
    return this.mediaStream;
  }
}

export const audioCaptureService = new AudioCaptureService();
