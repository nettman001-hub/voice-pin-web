// 댓글 수집 기록 1건 (로컬 수집 서버가 TikTok LIVE API로 받은 실시간 댓글)
export interface CommentRecord {
  id: string;
  sessionId: string;          // 방송 회차 (YYYYMMDD_HH)
  nickname: string;           // 댓글 작성자 닉네임
  uniqueId?: string;          // 틱톡 고유 ID (@ 제외)
  content: string;            // 댓글 내용
  capturedAt: string;         // 수집 시각 (ISO)
  matchedAlertWord?: string;  // 알림 단어에 걸린 경우 해당 단어
}

// 댓글 실시간 수집 설정
export interface CommentCaptureConfig {
  tiktokUsername: string;     // 수집 대상 틱톡 ID (@ 제외)
  serverUrl: string;          // 로컬 댓글 수집 서버 URL
  alertWords: string[];       // 알림 표시 단어 목록 (예: "저요")
  alertDurationSec: number;   // 알림창 자동 닫힘 시간 (초)
  alertVoiceCommand: string;  // 알림창을 음성으로 닫는 명령 단어 (예: "닫아")
}

export const DEFAULT_COMMENT_CAPTURE_CONFIG: CommentCaptureConfig = {
  tiktokUsername: '',
  serverUrl: 'http://127.0.0.1:2137',
  alertWords: ['저요'],
  alertDurationSec: 15,
  alertVoiceCommand: '닫아'
};
