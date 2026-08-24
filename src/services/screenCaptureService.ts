import { CaptureAreaConfig } from '../types/rules';

export class ScreenCaptureService {
  /**
   * 지정된 비디오 스트림 또는 실제 윈도우 화면 공유에서 특정 영역(댓글창, OBS 송출창, 전체화면)을 캡처하여 Data URL (PNG)로 반환
   */
  public async captureArea(
    stream: MediaStream | null,
    areaConfig: CaptureAreaConfig,
    metadata?: { nickname?: string; amount?: number; timestamp?: string }
  ): Promise<string> {
    let activeStream = stream;
    let needToCloseStream = false;

    // 스트림이 없고 브라우저 getDisplayMedia 지원 시 실제 윈도우 화면 공유 스트림 요청
    if (!activeStream || !activeStream.getVideoTracks().some(t => t.readyState === 'live')) {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
        try {
          activeStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'window',
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            } as any,
            audio: false
          });
          needToCloseStream = true;
        } catch (e) {
          console.warn('[ScreenCapture] 화면 공유 취소 또는 권한 거부:', e);
          return '';
        }
      }
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // 실제 비디오 트랙이 있는 경우 (화면 공유 / 윈도우 창 캡처)
    const videoTrack = activeStream?.getVideoTracks()[0];
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

        // 비디오 프레임이 실제로 렌더링되도록 확실히 대기 (최대 600ms)
        await new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          const timeout = setTimeout(done, 500);

          if ('requestVideoFrameCallback' in video!) {
            (video as any).requestVideoFrameCallback(() => {
              clearTimeout(timeout);
              setTimeout(done, 150);
            });
          } else {
            video!.onloadeddata = () => {
              clearTimeout(timeout);
              setTimeout(done, 200);
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

        // 정리 작업
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }
        if (needToCloseStream) {
          activeStream?.getTracks().forEach((t) => t.stop());
        }

        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl;
      } catch (err) {
        console.warn('[ScreenCapture] 실제 비디오 프레임 크롭 실패:', err);
        if (video && video.parentNode) {
          video.parentNode.removeChild(video);
        }
        if (needToCloseStream) {
          activeStream?.getTracks().forEach((t) => t.stop());
        }
      }
    }

    return '';
  }
}

export const screenCaptureService = new ScreenCaptureService();
