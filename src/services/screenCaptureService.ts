import { CaptureAreaConfig } from '../types/rules';

export interface ScreenCaptureConnectionState {
  isConnected: boolean;
  hasAudio: boolean;
}

// 전역 window 객체에 스트림 레퍼런스 유지 (페이지 이동/언마운트 시 유실 방지)
declare global {
  interface Window {
    __VOICECAP_SCREEN_STREAM__?: MediaStream | null;
  }
}

export class ScreenCaptureService {
  private connectionListeners = new Set<(state: ScreenCaptureConnectionState) => void>();
  private boundStreams = new WeakSet<MediaStream>();
  private captureRequestGeneration = 0;

  private ensureStreamListeners(stream: MediaStream): void {
    if (this.boundStreams.has(stream)) return;
    this.boundStreams.add(stream);

    const handleVideoEnded = () => {
      if (typeof window === 'undefined' || window.__VOICECAP_SCREEN_STREAM__ !== stream) return;

      // 브라우저의 [공유 중지]로 비디오가 끝나면 남아 있는 오디오도 함께 정리한다.
      window.__VOICECAP_SCREEN_STREAM__ = null;
      stream.getTracks().forEach((track) => {
        if (track.readyState === 'live') track.stop();
      });
      this.emitConnectionState();
    };

    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', handleVideoEnded, { once: true });
    });

    stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (typeof window !== 'undefined' && window.__VOICECAP_SCREEN_STREAM__ === stream) {
          this.emitConnectionState();
        }
      }, { once: true });
    });
  }

  private emitConnectionState(): void {
    const state = this.getConnectionState();
    this.connectionListeners.forEach((listener) => listener(state));
  }

  public getConnectionState(): ScreenCaptureConnectionState {
    const stream = this.getActiveStream();
    return {
      isConnected: !!stream,
      hasAudio: !!stream?.getAudioTracks().some((track) => track.readyState === 'live')
    };
  }

  public subscribeConnection(
    listener: (state: ScreenCaptureConnectionState) => void
  ): () => void {
    this.connectionListeners.add(listener);
    listener(this.getConnectionState());
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /**
   * 현재 연결되어 살아있는 비디오 스트림이 있는지 확인
   */
  public getActiveStream(): MediaStream | null {
    if (typeof window !== 'undefined' && window.__VOICECAP_SCREEN_STREAM__) {
      const stream = window.__VOICECAP_SCREEN_STREAM__;
      if (stream.getVideoTracks().some(t => t.readyState === 'live')) {
        this.ensureStreamListeners(stream);
        return stream;
      }

      window.__VOICECAP_SCREEN_STREAM__ = null;
      stream.getTracks().forEach((track) => {
        if (track.readyState === 'live') track.stop();
      });
    }
    return null;
  }

  /**
   * 현재 연결된 스트림에서 방송 오디오 트랙 추출
   */
  public getActiveAudioTrack(): MediaStreamTrack | null {
    const stream = this.getActiveStream();
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      const liveTrack = audioTracks.find(t => t.readyState === 'live');
      if (liveTrack) return liveTrack;
    }
    return null;
  }

  /**
   * 화면/창/특정 크롬 탭 스트림 요청 (화면 비디오 + 방송 소리 오디오 동시 획득)
   */
  public async getOrCreateStream(forceNew = false): Promise<MediaStream | null> {
    if (!forceNew) {
      const active = this.getActiveStream();
      if (active) return active;
    }

    const previousStream = forceNew ? this.getActiveStream() : null;
    const requestGeneration = ++this.captureRequestGeneration;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      return null;
    }

    try {
      // 특정 크롬 탭 / 윈도우 창의 영상 및 방송 소리(오디오) 동시 요청
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } as any,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as any
      });

      // 연결 해제/로그아웃 또는 더 최근의 공유 요청이 이 요청을 무효화했다.
      // 뒤늦게 선택된 스트림이 전역 캐시에 살아남지 않도록 즉시 종료한다.
      if (requestGeneration !== this.captureRequestGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }

      if (typeof window !== 'undefined') {
        window.__VOICECAP_SCREEN_STREAM__ = stream;
      }
      this.ensureStreamListeners(stream);

      // 새 공유 선택에 성공한 뒤에만 이전 연결을 종료한다.
      // 사용자가 변경 창을 취소하면 기존 공유는 그대로 유지된다.
      if (previousStream && previousStream !== stream) {
        previousStream.getTracks().forEach((track) => track.stop());
      }

      this.emitConnectionState();
      return stream;
    } catch (err) {
      console.warn('[ScreenCapture] 화면/탭 공유 취소 또는 거부:', err);
      return null;
    }
  }

  /**
   * 현재 공유 원본은 유지하면서 아직 열려 있는 공유 선택 요청만 무효화한다.
   * 로그아웃 도중 선택창이 뒤늦게 완료되는 경우에 사용한다.
   */
  public cancelPendingRequest(): void {
    this.captureRequestGeneration += 1;
  }

  /**
   * 스트림 연결 해제
   */
  public stopStream(): void {
    // 아직 완료되지 않은 공유 선택 요청도 함께 무효화한다.
    this.cancelPendingRequest();

    if (typeof window !== 'undefined' && window.__VOICECAP_SCREEN_STREAM__) {
      const stream = window.__VOICECAP_SCREEN_STREAM__;
      window.__VOICECAP_SCREEN_STREAM__ = null;
      stream.getTracks().forEach(t => t.stop());
      this.emitConnectionState();
    }
  }

  /**
   * 지정된 비디오 스트림 또는 캐시된 윈도우 화면 공유에서 특정 영역을 잘라낸 순수 캔버스를 반환한다.
   * 워터마크를 넣지 않으므로 댓글 OCR 등 이미지 분석 용도로 사용한다.
   */
  public async captureAreaCanvas(
    stream: MediaStream | null,
    areaConfig: CaptureAreaConfig
  ): Promise<HTMLCanvasElement | null> {
    let activeStream = stream || this.getActiveStream();

    // 스트림이 아직 없다면 최초 1회 화면 공유 요청
    if (!activeStream) {
      activeStream = await this.getOrCreateStream(false);
      if (!activeStream) return null;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 실제 비디오 트랙이 있는 경우 (화면 공유 / 윈도우 창 캡처)
    const videoTrack = activeStream.getVideoTracks()[0];
    if (videoTrack && videoTrack.readyState === 'live') {
      let video: HTMLVideoElement | null = null;
      try {
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = new MediaStream([videoTrack]);

        // 브라우저 렌더러가 프레임을 실제로 디코딩하도록 DOM에 일시 부착
        video.style.position = 'fixed';
        video.style.top = '-9999px';
        video.style.left = '-9999px';
        video.style.width = '640px';
        video.style.height = '360px';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        document.body.appendChild(video);

        await video.play();

        // 비디오 프레임이 실제로 렌더링되도록 대기
        await new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          const timeout = setTimeout(done, 300);

          if ('requestVideoFrameCallback' in video!) {
            (video as any).requestVideoFrameCallback(() => {
              clearTimeout(timeout);
              setTimeout(done, 60);
            });
          } else {
            video!.onloadeddata = () => {
              clearTimeout(timeout);
              setTimeout(done, 80);
            };
          }
        });

        const vw = video.videoWidth || 1920;
        const vh = video.videoHeight || 1080;

        const sx = Math.max(0, Math.floor(vw * areaConfig.xRatio));
        const sy = Math.max(0, Math.floor(vh * areaConfig.yRatio));
        const sw = Math.min(vw - sx, Math.max(50, Math.floor(vw * areaConfig.widthRatio)));
        const sh = Math.min(vh - sy, Math.max(50, Math.floor(vh * areaConfig.heightRatio)));

        canvas.width = sw;
        canvas.height = sh;

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

        // 정리 작업
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }

        return canvas;
      } catch (err) {
        console.warn('[ScreenCapture] 비디오 프레임 크롭 실패:', err);
        if (video && video.parentNode) {
          video.parentNode.removeChild(video);
        }
      }
    }

    return null;
  }

  /**
   * 지정된 비디오 스트림 또는 캐시된 윈도우 화면 공유에서 특정 영역(댓글창, OBS 송출창, 전체화면)을 캡처하여 Data URL (PNG)로 반환
   */
  public async captureArea(
    stream: MediaStream | null,
    areaConfig: CaptureAreaConfig,
    metadata?: { nickname?: string; amount?: number; timestamp?: string }
  ): Promise<string> {
    const canvas = await this.captureAreaCanvas(stream, areaConfig);
    if (!canvas) return '';

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // 캡처 워터마크 태그 부착
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      const badgeW = Math.min(160, Math.max(110, canvas.width * 0.35));
      const badgeH = 26;
      ctx.fillRect(canvas.width - badgeW - 8, canvas.height - badgeH - 8, badgeW, badgeH);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('🎙️ VoiceCAP 캡처', canvas.width - badgeW, canvas.height - 10);
    }

    return canvas.toDataURL('image/png');
  }
}

export const screenCaptureService = new ScreenCaptureService();
