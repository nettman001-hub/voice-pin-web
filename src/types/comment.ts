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
  serverUrl: string;          // 설치된 댓글 도우미 연결 주소 (사용자에게 노출하지 않음)
  alertWords: string[];       // 알림 표시 단어 목록 (예: "저요")
  alertDurationSec: number;   // 알림창 자동 닫힘 시간 (초)
  alertVoiceCommand: string;  // 쉼표로 구분한 알림창 닫기 음성 명령 (예: "닫아, 알림 닫기")
}

export const DEFAULT_COMMENT_SERVER_URL = 'http://127.0.0.1:2137';

// 댓글 도우미 최신 안정 릴리스 버전 및 다운로드 URL
// GitHub releases/latest는 Android 등 타 플랫폼 릴리스 등록 시 404가 발생하므로 명시적 안정 릴리스 태그를 지정합니다.
export const COMMENT_HELPER_VERSION = '1.3.5';
export const COMMENT_HELPER_DOWNLOAD_URL =
  'https://github.com/nettman001-hub/voice-pin-web/releases/download/comment-helper-v1.3.5/VoiceCAP-Comment-Helper-Setup.exe';
export const COMMENT_HELPER_RELEASES_URL =
  'https://github.com/nettman001-hub/voice-pin-web/releases';

export const DEFAULT_COMMENT_CAPTURE_CONFIG: CommentCaptureConfig = {
  tiktokUsername: '',
  serverUrl: DEFAULT_COMMENT_SERVER_URL,
  alertWords: ['저요'],
  alertDurationSec: 15,
  alertVoiceCommand: '닫아'
};
