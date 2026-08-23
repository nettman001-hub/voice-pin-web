import { CaptureAreaConfig } from '../types/rules';

export class ScreenCaptureService {
  /**
   * 지정된 비디오 스트림 또는 Mock 화면에서 특정 영역(댓글 목록, 주문창, 전체화면)을 캡처하여 Data URL (PNG)로 반환
   */
  public async captureArea(
    stream: MediaStream | null,
    areaConfig: CaptureAreaConfig,
    metadata?: { nickname?: string; amount?: number; timestamp?: string }
  ): Promise<string> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const width = 1080;
    const height = 1920; // 9:16 모바일 틱톡 비율 기준
    canvas.width = 720;
    canvas.height = 1280;

    // 실제 비디오 트랙이 있는 경우
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack && videoTrack.readyState === 'live') {
      try {
        const video = document.createElement('video');
        video.muted = true;
        video.srcObject = new MediaStream([videoTrack]);
        await video.play();

        const sx = video.videoWidth * areaConfig.xRatio;
        const sy = video.videoHeight * areaConfig.yRatio;
        const sw = video.videoWidth * areaConfig.widthRatio;
        const sh = video.videoHeight * areaConfig.heightRatio;

        canvas.width = sw || 600;
        canvas.height = sh || 800;

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      } catch (err) {
        console.warn('[ScreenCapture] 비디오 프레임 크롭 실패, 고화질 틱톡 목업 캡처 생성:', err);
      }
    }

    // 화면 스트림이 없거나 캡처 권한 미보유 시: 현실적인 틱톡 라이브 판매 캡처 캔버스 생성
    canvas.width = 640;
    canvas.height = 960;

    // 1. 틱톡 라이브 배경 그라디언트
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#181824');
    grad.addColorStop(0.5, '#2b1b3d');
    grad.addColorStop(1, '#0f0f17');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. 상단 틱톡 라이브 방송자 바
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.roundRect ? ctx.roundRect(20, 30, 240, 50, 25) : ctx.fillRect(20, 30, 240, 50);
    ctx.fill();

    ctx.fillStyle = '#FE2C55';
    ctx.beginPath();
    ctx.arc(45, 55, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('다들려 LIVE', 72, 52);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#ff7690';
    ctx.fillText('🔥 2.4k 시청중', 72, 70);

    // 3. 중앙 상품 이미지 카드 영역
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.roundRect ? ctx.roundRect(40, 140, 560, 360, 16) : ctx.fillRect(40, 140, 560, 360);
    ctx.fill();

    ctx.fillStyle = '#25F4EE';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('✨ [실시간 특가] 틱톡 라이브 추천 의류', 70, 200);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.fillText(`구매자: ${metadata?.nickname || '러블리'}님`, 70, 260);
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#ffeb3b';
    ctx.fillText(`결제 금액: ${(metadata?.amount || 35000).toLocaleString()}원`, 70, 310);

    ctx.fillStyle = '#9e9eb3';
    ctx.font = '14px sans-serif';
    ctx.fillText(`캡처 시각: ${metadata?.timestamp || new Date().toLocaleTimeString('ko-KR')}`, 70, 360);

    // 4. 하단 틱톡 실시간 댓글 목록 (영역: 댓글 목록)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.roundRect ? ctx.roundRect(20, 540, 600, 380, 16) : ctx.fillRect(20, 540, 600, 380);
    ctx.fill();

    ctx.fillStyle = '#25F4EE';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('💬 실시간 댓글창 (자동 캡처 영역)', 40, 575);

    const comments = [
      { user: '달콤한하루', text: '저도 구매할게요!! 닉네임 확인해주세요' },
      { user: metadata?.nickname || '러블리', text: '구매확정했습니다! 입금완료요~', highlight: true },
      { user: '민트초코', text: '방금 그 옷 사이즈 어떤거 있나요?' },
      { user: '보라돌이', text: '다음 상품도 보여주세요 ㅎㅎ' },
      { user: '쇼핑왕', text: '오늘 배송 출발하나요?' }
    ];

    let startY = 620;
    comments.forEach((c) => {
      if (c.highlight) {
        ctx.fillStyle = 'rgba(254, 44, 85, 0.25)';
        ctx.fillRect(35, startY - 22, 570, 36);
        ctx.fillStyle = '#ff7690';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`★ ${c.user}: `, 45, startY);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(c.text, 45 + ctx.measureText(`★ ${c.user}: `).width, startY);
      } else {
        ctx.fillStyle = '#9e9eb3';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`${c.user}: `, 45, startY);
        ctx.fillStyle = '#e1e1ea';
        ctx.font = '13px sans-serif';
        ctx.fillText(c.text, 45 + ctx.measureText(`${c.user}: `).width, startY);
      }
      startY += 48;
    });

    // 5. 캡처 워터마크 태그
    ctx.fillStyle = 'rgba(37, 244, 238, 0.9)';
    ctx.fillRect(canvas.width - 150, canvas.height - 35, 140, 25);
    ctx.fillStyle = '#010101';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('🎙️ 다들려 자동캡처', canvas.width - 142, canvas.height - 18);

    return canvas.toDataURL('image/png');
  }
}

export const screenCaptureService = new ScreenCaptureService();
