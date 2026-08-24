import { User } from '../types/auth';
import { SaleRecord, CaptureItem, LiveSession } from '../types/live';
import { RecognitionWordRule, CaptureAreaConfig } from '../types/rules';
import { TrainingSentence } from '../types/training';
import { PaymentHistoryItem, PaymentCard } from '../types/subscription';
import { ReportItem, SystemErrorLog, NotificationSetting } from '../types/admin';

// 기본 방송 회차 생성 (YYYYMMDD_HH 형식)
export function generateSessionId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  return `${y}${m}${d}_${h}`;
}

// 초기 기본 인식 단어 규칙
export const DEFAULT_RULES: RecognitionWordRule[] = [
  { id: 'r1', word: '구매확정', action: 'DB_SAVE', isEnabled: true, isEssential: true, priority: 1, description: '판매 확정 감지 및 DB 자동 저장' },
  { id: 'r2', word: '닉네임', action: 'DB_SAVE', isEnabled: true, isEssential: true, priority: 2, description: '구매자 닉네임 파싱' },
  { id: 'r3', word: '가격', action: 'DB_SAVE', isEnabled: true, isEssential: true, priority: 3, description: '판매 가격 파싱' },
  { id: 'r4', word: '금액', action: 'DB_SAVE', isEnabled: true, isEssential: true, priority: 4, description: '결제 금액 파싱' },
  { id: 'r5', word: '캡처', action: 'SCREEN_CAPTURE', isEnabled: true, isEssential: false, priority: 5, description: '댓글/주문 화면 영역 자동 캡처' },
  { id: 'r6', word: '결제완료', action: 'DB_SAVE_AND_CAPTURE', isEnabled: true, isEssential: false, priority: 6, description: 'DB 저장 및 화면 캡처 동시 실행' },
];

// 초기 음성 학습 문장
export const DEFAULT_TRAINING_SENTENCES: TrainingSentence[] = [
  { id: 't1', sentence: '구매 확정됐습니다', category: '멘트', recordCount: 3, isCompleted: true, expectedAccuracy: 98, lastTrainedAt: '2026-08-20' },
  { id: 't2', sentence: '구매하신 분은 닉네임님입니다', category: '닉네임', recordCount: 3, isCompleted: true, expectedAccuracy: 96, lastTrainedAt: '2026-08-21' },
  { id: 't3', sentence: '가격은 삼만 오천원입니다', category: '금액', recordCount: 2, isCompleted: false, expectedAccuracy: 88, lastTrainedAt: '2026-08-22' },
  { id: 't4', sentence: '결제 완료되셨습니다', category: '멘트', recordCount: 1, isCompleted: false, expectedAccuracy: 82, lastTrainedAt: '2026-08-23' },
  { id: 't5', sentence: '캡처 부탁드립니다', category: '명령', recordCount: 0, isCompleted: false, expectedAccuracy: 75 },
  { id: 't6', sentence: '수정 시작', category: '명령', recordCount: 0, isCompleted: false, expectedAccuracy: 70 },
  { id: 't7', sentence: '수정 완료', category: '명령', recordCount: 0, isCompleted: false, expectedAccuracy: 70 },
];

// 초기 기본 판매 내역 목업 데이터
export const INITIAL_SALES: SaleRecord[] = [
  {
    id: 's1',
    sessionId: '20260823_20',
    buyerNickname: '러블리샵',
    amount: 32000,
    recognizedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    rawTranscript: '구매확정 됐습니다. 닉네임 러블리샵님 금액은 32,000원입니다.',
    status: '확정',
    captureImageUrls: ['https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=600&q=80']
  },
  {
    id: 's2',
    sessionId: '20260823_20',
    buyerNickname: '달콤한하루',
    amount: 45000,
    recognizedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    rawTranscript: '구매확정! 구매하신 분은 달콤한하루님 이시구요 가격 4만 5천원입니다.',
    status: '확정',
  },
  {
    id: 's3',
    sessionId: '20260824_01',
    buyerNickname: '미확인(보류)',
    amount: 0,
    recognizedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    rawTranscript: '구매확정 됐습니다! 이번 제품 가져가실 분 확인해주세요.',
    status: '보류',
    note: '닉네임 및 금액 미추출'
  },
  {
    id: 's4',
    sessionId: '20260824_01',
    buyerNickname: '민트초코',
    amount: 19900,
    recognizedAt: new Date(Date.now() - 1800000).toISOString(),
    rawTranscript: '구매확정입니다 닉네임 민트초코님 가격 만구천구백원 캡처해주세요',
    status: '자동저장',
  },
  {
    id: 's5',
    sessionId: '20260824_02',
    buyerNickname: '황금돼지',
    amount: 58000,
    recognizedAt: new Date(Date.now() - 900000).toISOString(),
    rawTranscript: '수정 완료! 닉네임 황금돼지님 금액 58000원입니다.',
    status: '수동수정',
  }
];

// 초기 회원 목업 데이터
export const INITIAL_USERS: User[] = [
  {
    id: 'u-seller-1',
    email: 'seller@dadryeo.com',
    nickname: '김미정 (의류판매)',
    phone: '010-1234-5678',
    role: '판매자',
    status: '활성',
    createdAt: '2026-08-01',
    subscriptionPlan: '프로',
    subscriptionExpiresAt: '2026-09-01',
    isTrial: false
  },
  {
    id: 'u-admin-1',
    email: 'admin@dadryeo.com',
    nickname: '운영총괄 관리자',
    phone: '010-9999-8888',
    role: '관리자',
    status: '활성',
    createdAt: '2026-07-01'
  },
  {
    id: 'u-seller-2',
    email: 'baduser@dadryeo.com',
    nickname: '스팸판매자',
    phone: '010-4444-5555',
    role: '판매자',
    status: '정지',
    suspendedReason: '음성 학습을 통한 부적절한 단어 오남용 신고 접수',
    createdAt: '2026-08-10'
  }
];

// 초기 결제 내역 목업 데이터
export const INITIAL_PAYMENTS: PaymentHistoryItem[] = [
  { id: 'p1', date: '2026-08-01', planName: '프로 플랜', amount: 19900, status: '결제 완료', paymentMethod: '신한카드 (4820)' },
  { id: 'p2', date: '2026-07-01', planName: '프로 플랜', amount: 19900, status: '결제 완료', paymentMethod: '신한카드 (4820)' }
];

// 초기 신고 목업 데이터
export const INITIAL_REPORTS: ReportItem[] = [
  {
    id: 'rep-1',
    memberEmail: 'baduser@dadryeo.com',
    memberNickname: '스팸판매자',
    reason: '부적절한 음성 학습 및 허위 판매',
    detail: '학습 멘트에 욕설 및 타사 비방성 단어를 반복 등록하여 신고합니다.',
    createdAt: '2026-08-22 15:30',
    status: '완료',
    processedAt: '2026-08-23 10:00',
    actionTaken: '회원 계정 30일 이용 정지 조치 완료'
  },
  {
    id: 'rep-2',
    memberEmail: 'seller2@example.com',
    memberNickname: '뷰티라이브',
    reason: '오류 신고 및 인식 문의',
    detail: '금액 인식 시 만원 단위가 가끔 늦게 반영됩니다.',
    createdAt: '2026-08-24 01:10',
    status: '처리 중'
  }
];

// 초기 시스템 에러 로그 목업
export const INITIAL_ERROR_LOGS: SystemErrorLog[] = [
  { id: 'err-1', timestamp: '2026-08-24 01:45:12', level: 'WARN', message: '오디오 캡처 버퍼 지연 감지 (50ms)', source: 'AudioCaptureService' },
  { id: 'err-2', timestamp: '2026-08-23 22:15:00', level: 'INFO', message: 'Deepgram Nova-3 WebSocket 정상 연결 및 세션 생성', source: 'DeepgramSttService' },
  { id: 'err-3', timestamp: '2026-08-23 18:30:22', level: 'ERROR', message: '네트워크 일시 단절로 인한 STT 재연결 시도 (1/3)', source: 'NetworkWatcher' }
];

// 로컬 스토리지 키
const KEYS = {
  USERS: 'dadryeo_users',
  CURRENT_USER: 'dadryeo_current_user',
  TOKEN: 'dadryeo_token',
  RULES: 'dadryeo_rules',
  TRAINING: 'dadryeo_training',
  SALES: 'dadryeo_sales',
  CAPTURES: 'dadryeo_captures',
  PAYMENTS: 'dadryeo_payments',
  REPORTS: 'dadryeo_reports',
  LOGS: 'dadryeo_logs',
  NOTIFICATIONS: 'dadryeo_notifications',
  DEEPGRAM_API_KEY: 'dadryeo_deepgram_api_key'
};

export class StorageService {
  private getItem<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`[Storage] Failed to save key: ${key}`, e);
    }
  }

  // 초기화 및 시딩
  public init() {
    if (!localStorage.getItem(KEYS.USERS)) {
      this.setItem(KEYS.USERS, INITIAL_USERS);
    }
    if (!localStorage.getItem(KEYS.RULES)) {
      this.setItem(KEYS.RULES, DEFAULT_RULES);
    }
    if (!localStorage.getItem(KEYS.TRAINING)) {
      this.setItem(KEYS.TRAINING, DEFAULT_TRAINING_SENTENCES);
    }
    if (!localStorage.getItem(KEYS.SALES)) {
      this.setItem(KEYS.SALES, INITIAL_SALES);
    }
    if (!localStorage.getItem(KEYS.PAYMENTS)) {
      this.setItem(KEYS.PAYMENTS, INITIAL_PAYMENTS);
    }
    if (!localStorage.getItem(KEYS.REPORTS)) {
      this.setItem(KEYS.REPORTS, INITIAL_REPORTS);
    }
    if (!localStorage.getItem(KEYS.LOGS)) {
      this.setItem(KEYS.LOGS, INITIAL_ERROR_LOGS);
    }
  }

  // Deepgram API Key
  public getDeepgramApiKey(): string {
    return localStorage.getItem(KEYS.DEEPGRAM_API_KEY) || '';
  }
  public setDeepgramApiKey(key: string): void {
    localStorage.setItem(KEYS.DEEPGRAM_API_KEY, key);
  }

  // 전체 데이터 백업 (JSON 파일 다운로드용)
  public exportFullBackup(): string {
    const backupData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      sales: this.getSales(),
      captures: this.getCaptures(),
      rules: this.getRules(),
      trainingSentences: this.getTrainingSentences(),
      payments: this.getPayments(),
      notifications: this.getNotifications(),
      deepgramApiKey: this.getDeepgramApiKey()
    };
    return JSON.stringify(backupData, null, 2);
  }

  // 백업 데이터 복원
  public importFullBackup(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data.sales) this.saveSales(data.sales);
      if (data.captures) localStorage.setItem(KEYS.CAPTURES, JSON.stringify(data.captures));
      if (data.rules) this.saveRules(data.rules);
      if (data.trainingSentences) this.saveTrainingSentences(data.trainingSentences);
      if (data.payments) localStorage.setItem(KEYS.PAYMENTS, JSON.stringify(data.payments));
      if (data.notifications) localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(data.notifications));
      if (data.deepgramApiKey) this.setDeepgramApiKey(data.deepgramApiKey);
      return true;
    } catch (e) {
      console.error('[Storage] 백업 복원 실패:', e);
      return false;
    }
  }

  // 회원 및 인증
  public getUsers(): User[] { return this.getItem(KEYS.USERS, INITIAL_USERS); }
  public saveUsers(users: User[]) { this.setItem(KEYS.USERS, users); }

  public getCurrentUser(): User | null { return this.getItem(KEYS.CURRENT_USER, INITIAL_USERS[0]); }
  public setCurrentUser(user: User | null) { this.setItem(KEYS.CURRENT_USER, user); }

  public getToken(): string | null { return localStorage.getItem(KEYS.TOKEN); }
  public setToken(token: string | null) {
    if (token) localStorage.setItem(KEYS.TOKEN, token);
    else localStorage.removeItem(KEYS.TOKEN);
  }

  // 규칙
  public getRules(): RecognitionWordRule[] { return this.getItem(KEYS.RULES, DEFAULT_RULES); }
  public saveRules(rules: RecognitionWordRule[]) { this.setItem(KEYS.RULES, rules); }

  // 음성 학습
  public getTrainingSentences(): TrainingSentence[] { return this.getItem(KEYS.TRAINING, DEFAULT_TRAINING_SENTENCES); }
  public saveTrainingSentences(sentences: TrainingSentence[]) { this.setItem(KEYS.TRAINING, sentences); }

  // 판매 내역
  public getSales(): SaleRecord[] { return this.getItem(KEYS.SALES, INITIAL_SALES); }
  public saveSales(sales: SaleRecord[]) { this.setItem(KEYS.SALES, sales); }

  public addSale(sale: SaleRecord) {
    const list = this.getSales();
    list.unshift(sale);
    this.saveSales(list);
  }

  public updateSale(updated: SaleRecord) {
    const list = this.getSales().map(s => s.id === updated.id ? updated : s);
    this.saveSales(list);
  }

  public deleteSale(id: string) {
    const list = this.getSales().filter(s => s.id !== id);
    this.saveSales(list);
  }

  // 캡처 목록
  public getCaptures(): CaptureItem[] { return this.getItem(KEYS.CAPTURES, []); }
  public addCapture(item: CaptureItem) {
    const list = this.getCaptures();
    list.unshift(item);
    this.setItem(KEYS.CAPTURES, list);
  }

  // 결제 내역
  public getPayments(): PaymentHistoryItem[] { return this.getItem(KEYS.PAYMENTS, INITIAL_PAYMENTS); }
  public addPayment(item: PaymentHistoryItem) {
    const list = this.getPayments();
    list.unshift(item);
    this.setItem(KEYS.PAYMENTS, list);
  }

  // 신고 내역
  public getReports(): ReportItem[] { return this.getItem(KEYS.REPORTS, INITIAL_REPORTS); }
  public saveReports(reports: ReportItem[]) { this.setItem(KEYS.REPORTS, reports); }

  // 에러 로그
  public getLogs(): SystemErrorLog[] { return this.getItem(KEYS.LOGS, INITIAL_ERROR_LOGS); }
  public addLog(log: SystemErrorLog) {
    const list = this.getLogs();
    list.unshift(log);
    this.setItem(KEYS.LOGS, list.slice(0, 100));
  }

  // 알림 설정
  public getNotifications(): NotificationSetting[] {
    return this.getItem(KEYS.NOTIFICATIONS, [
      { id: 'n1', eventType: '판매 내역 저장 실패', pushEnabled: true, emailEnabled: true },
      { id: 'n2', eventType: '보류 건 발생', pushEnabled: true, emailEnabled: false },
      { id: 'n3', eventType: '구독 만료 예정', pushEnabled: true, emailEnabled: true },
      { id: 'n4', eventType: '인식 오류', pushEnabled: true, emailEnabled: false },
    ]);
  }
  public saveNotifications(notis: NotificationSetting[]) { this.setItem(KEYS.NOTIFICATIONS, notis); }
}

export const storageService = new StorageService();
