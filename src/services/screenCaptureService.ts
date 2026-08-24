import { CaptureAreaConfig } from '../types/rules';

// 전역 window 객체에 스트림 레퍼런스 유지 (페이지 이동/언마운트 시 유실 방지)
declare global {
  interface Window {
    __VOICECAP_SCREEN_STREAM__?: MediaStream | null;
  }
}

export class ScreenCaptureService {
  /**
   * 현재 연결되어 살아있는 비디오 스트림이 있는지 확인
   */
  public getActiveStream(): MediaStream | null {
    if (typeof window !== 'undefined' && window.__VOICECAP_SCREEN_STREAM__) {
      const stream = window.__VOICECAP_SCREEN_STREAM__;
      if (stream.getVideoTracks().some(t => t.readyState === 'live')) {
        return stream;
      }
      window.__VOICECAP_SCREEN_STREAM__ = null;
    }
    return null;
  }

  /**
   * 화면/창 스트림 요청 (이미 연결된 스트림이 있다면 재사용)
   */
  public async getOrCreateStream(forceNew = false): Promise<MediaStream | null> {
    if (!forceNew) {
      const active = this.getActiveStream();
      if (active) return active;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      return null;
    }

    try {
      // 기존 스트림 정리
      if (typeof window !== 'undefined' && window.__VOICECAP_SCREEN_STREAM__) {
        window.__VOICECAP_SCREEN_STREAM__.getTracks().forEach(t => t.stop());
        window.__VOICECAP_SCREEN_STREAM__ = null;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } as any,
        audio: false
      });

      // 사용자가 브라우저 상단에서 공유 중지를 눌렀을 때 핸들링
      stream.getVideoTracks().forEach(track => {
        track.onended = () => {
          if (typeof window !== 'undefined') {
            window.__VOICECAP_SCREEN_STREAM__ = null;
          }
        };
      });

      if (typeof window !== 'undefined') {
        window.__VOICECAP_SCREEN_STREAM__ = stream;
      }
      return stream;
    } catch (err) {
      console.warn('[ScreenCapture] 화면 공유 취소 또는 거부:', err);
      return null;
    }
  }

  /**
   * 스트림 연결 해제
   */
  public stopStream(): void {
    if (typeof window !== 'undefined' && window.__VOICECAP_SCREEN_STREAM__) {
      window.__VOICECAP_SCREEN_STREAM__.getTracks().forEach(t => t.stop());
      window.__VOICECAP_SCREEN_STREAM__ = null;
    }
  }

  /**
   * 지정된 비디오 스트림 또는 캐시된 윈도우 화면 공유에서 특정 영역(댓글창, OBS 송출창, 전체화면)을 캡처하여 Data URL (PNG)로 반환
   */
  public async captureArea(
    stream: MediaStream | null,
    areaConfig: CaptureAreaConfig,
    metadata?: { nickname?: string; amount?: number; timestamp?: string }
  ): Promise<string> {
    let activeStream = stream || this.getActiveStream();

    // 스트림이 아직 없다면 최초 1회 화면 공유 요청
    if (!activeStream) {
      activeStream = await this.getOrCreateStream(false);
      if (!activeStream) return '';
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

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
          const timeout = setTimeout(done, 400);

          if ('requestVideoFrameCallback' in video!) {
            (video as any).requestVideoFrameCallback(() => {
              clearTimeout(timeout);
              setTimeout(done, 80);
            });
          } else {
            video!.onloadeddata = () => {
              clearTimeout(timeout);
              setTimeout(done, 100);
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

        // 캡처 워터마크 태그 부착
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        const badgeW = Math.min(160, Math.max(110, sw * 0.35));
        const badgeH = 26;
        ctx.fillRect(canvas.width - badgeW - 8, canvas.height - badgeH - 8, badgeW, badgeH);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('🎙️ VoiceCAP 캡처', canvas.width - badgeW, canvas.height - 10);

        // 정리 작업 (비디오 엘리먼트만 DOM에서 제거하고, 스트림은 다음 캡처를 위해 유지!)
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }

        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl;
      } catch (err) {
        console.warn('[ScreenCapture] 비디오 프레임 크롭 실패:', err);
        if (video && video.parentNode) {
          video.parentNode.removeChild(video);
        }
      }
    }

    return '';
  }
}

export const screenCaptureService = new ScreenCaptureService();
