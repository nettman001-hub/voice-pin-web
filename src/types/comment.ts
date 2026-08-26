import { CaptureAreaConfig } from './rules';

// 댓글 캡처 기록 1건 (OCR로 읽어낸 댓글)
export interface CommentRecord {
  id: string;
  sessionId: string;          // 방송 회차 (YYYYMMDD_HH)
  nickname: string;           // 댓글 작성자 닉네임
  content: string;            // 댓글 내용
  capturedAt: string;         // 캡처 시각 (ISO)
  matchedAlertWord?: string;  // 알림 단어에 걸린 경우 해당 단어
}

// 댓글 자동 캡처 설정
export interface CommentCaptureConfig {
  area: CaptureAreaConfig;    // 댓글 영역 (공유 화면 기준 비율)
  intervalSec: number;        // 자동 캡처 주기 (초)
  alertWords: string[];       // 알림 표시 단어 목록 (예: "저요")
  alertDurationSec: number;   // 알림창 자동 닫힘 시간 (초)
  alertVoiceCommand: string;  // 알림창을 음성으로 닫는 명령 단어 (예: "닫아")
}

export const DEFAULT_COMMENT_CAPTURE_CONFIG: CommentCaptureConfig = {
  area: {
    preset: 'COMMENTS',
    name: '댓글 캡처 영역',
    xRatio: 0.70,
    yRatio: 0.20,
    widthRatio: 0.28,
    heightRatio: 0.75
  },
  intervalSec: 10,
  alertWords: ['저요'],
  alertDurationSec: 15,
  alertVoiceCommand: '닫아'
};
