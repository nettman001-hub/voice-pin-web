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

export interface AdminSaleItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  sellerUserId: string;
  sellerEmail: string;
  sellerNickname: string;
  sessionId: string;
  buyerNickname: string;
  amount: number;
  recognizedAt: string;
  rawTranscript: string;
  status: '자동저장' | '수동수정' | '확정' | '보류';
  productName?: string;
  note?: string;
  printStatus?: 'NOT_REQUESTED' | 'PRINTED' | 'FAILED';
  createdAt: string;
}

export interface SellerSalesGroup {
  sellerUserId: string;
  sellerEmail: string;
  sellerNickname: string;
  workspaceName: string;
  totalAmount: number;
  totalCount: number;
  sessionCount: number;
  lastSaleAt: string;
  sessions: SessionSalesGroup[];
}

export interface SessionSalesGroup {
  sessionId: string;
  sessionTime: string;
  totalAmount: number;
  totalCount: number;
  sales: AdminSaleItem[];
}

export interface SellerSttUsageSummary {
  userId: string;
  email: string;
  nickname: string;
  workspaceId: string | null;
  workspaceName: string | null;
  deepgramSeconds: number;
  sonioxSeconds: number;
  totalSeconds: number;
  sessionCount: number;
  lastUsedAt: string | null;
}

export interface SttUsageLogItem {
  id: string;
  sessionId: string;
  provider: 'DEEPGRAM' | 'SONIOX';
  durationSeconds: number;
  startedAt: string;
  endedAt: string;
  createdAt: string;
}

export interface SttUsageRecordPayload {
  sessionId: string;
  provider: 'DEEPGRAM' | 'SONIOX';
  durationSeconds: number;
  startedAt: string;
  endedAt: string;
}
