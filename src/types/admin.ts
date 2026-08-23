export interface AdminKpis {
  dailyNewUsers: number;
  activeSubscribers: number;
  openReportsCount: number;
  systemErrorsCount: number;
  sttAccuracyAvg: number;
  totalSalesToday: number;
}

export interface ReportItem {
  id: string;
  memberEmail: string;
  memberNickname: string;
  reason: string;
  detail: string;
  createdAt: string;
  status: '접수' | '처리 중' | '완료';
  processedAt?: string;
  actionTaken?: string;
}

export interface SystemErrorLog {
  id: string;
  timestamp: string;
  level: 'ERROR' | 'WARN' | 'INFO';
  message: string;
  source: string;
  stackTrace?: string;
}

export interface NotificationSetting {
  id: string;
  eventType: '판매 내역 저장 실패' | '보류 건 발생' | '구독 만료 예정' | '인식 오류';
  pushEnabled: boolean;
  emailEnabled: boolean;
}
