import React, { createContext, useContext, useState, useEffect } from 'react';
import { RecognitionWordRule, CaptureAreaConfig, CaptureAreaPreset } from '../types/rules';
import { TrainingSentence } from '../types/training';
import { PlanTier, PlanInfo, PaymentHistoryItem, PaymentCard } from '../types/subscription';
import { AdminKpis, ReportItem, SystemErrorLog, NotificationSetting } from '../types/admin';
import { User } from '../types/auth';
import { storageService, DEFAULT_RULES, DEFAULT_TRAINING_SENTENCES } from '../services/storageService';
import { remoteWorkspaceService } from '../services/remoteWorkspaceService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { useAuth } from './AuthContext';
import confetti from 'canvas-confetti';

export const SUBSCRIPTION_PLANS: PlanInfo[] = [
  {
    id: '베이직',
    name: '베이직 플랜',
    priceMonth: 9900,
    voiceHours: '월 30시간',
    salesCapacity: '500건 저장',
    captureCapacity: '100장 캡처',
    concurrentSessions: 1,
    features: ['실시간 Deepgram STT (월 30시간)', '판매 내역 500건 자동 저장', '댓글창 캡처 100장', 'CSV 내보내기', '이메일 고객지원']
  },
  {
    id: '프로',
    name: '프로 플랜 (추천)',
    priceMonth: 19900,
    voiceHours: '월 100시간',
    salesCapacity: '무제한 저장',
    captureCapacity: '500장 캡처',
    concurrentSessions: 1,
    isPopular: true,
    features: ['실시간 Deepgram Nova-3 (월 100시간)', '키워드 바이어싱 강화', '판매 내역 무제한 저장', '댓글창/주문창 캡처 500장', '방송 중 음성 명령 수정', '방송 후 원클릭 일괄 확정', '정산 CSV 통계']
  },
  {
    id: '프리미엄',
    name: '프리미엄 플랜',
    priceMonth: 29900,
    voiceHours: '무제한',
    salesCapacity: '무제한 저장',
    captureCapacity: '무제한 캡처',
    concurrentSessions: 2,
    features: ['Deepgram Nova-3 무제한 청취', '개인화 음성 학습 모델 무제한', '모든 기능 무제한 지원', '다중 기기 세션 2대', '우선 기술 지원 & 전담 매니저']
  }
];

export const CAPTURE_PRESETS: CaptureAreaConfig[] = [
  { preset: 'COMMENTS', name: '틱톡 스튜디오 댓글창 (우측)', xRatio: 0.70, yRatio: 0.20, widthRatio: 0.28, heightRatio: 0.75 },
  { preset: 'ORDERS', name: 'OBS/스튜디오 라이브 화면 (중앙)', xRatio: 0.25, yRatio: 0.15, widthRatio: 0.45, heightRatio: 0.75 },
  { preset: 'COMMENTS', name: '주문/채팅 알림 영역 (하단)', xRatio: 0.25, yRatio: 0.65, widthRatio: 0.45, heightRatio: 0.28 },
  { preset: 'FULL_SCREEN', name: '윈도우 데스크톱 전체 (1920x1080)', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }
];

interface AppDataContextType {
  // 규칙
  rules: RecognitionWordRule[];
  addRule: (word: string, action: RecognitionWordRule['action']) => { success: boolean; message?: string };
  updateRule: (rule: RecognitionWordRule) => void;
  deleteRule: (id: string) => { success: boolean; message?: string };
  toggleRule: (id: string) => void;
  captureAreaConfig: CaptureAreaConfig;
  setCaptureAreaConfig: (cfg: CaptureAreaConfig) => void;

  // 음성 학습
  trainingSentences: TrainingSentence[];
  recordTrainingSentence: (id: string) => void;
  trainVoiceModel: (id: string) => void;
  completedTrainingCount: number;

  // 구독
  currentPlan: PlanTier;
  subscriptionExpiresAt: string;
  isTrialActive: boolean;
  selectedPlanForCheckout: PlanTier;
  setSelectedPlanForCheckout: (plan: PlanTier) => void;
  paymentHistory: PaymentHistoryItem[];
  processPayment: (card: PaymentCard) => { success: boolean; message?: string };
  cancelSubscription: () => void;
  startFreeTrial: () => void;

  // 알림
  notifications: NotificationSetting[];
  toggleNotification: (id: string, channel: 'push' | 'email') => void;
  sendTestNotification: () => void;

  // 관리자
  adminKpis: AdminKpis;
  allMembers: User[];
  isSyncingMembers: boolean;
  memberSyncError: string | null;
  refreshMembers: () => Promise<boolean>;
  suspendMember: (userId: string, reason: string) => Promise<boolean>;
  unsuspendMember: (userId: string) => Promise<boolean>;
  setMemberSttAccess: (userId: string, allow: boolean) => Promise<boolean>;
  reports: ReportItem[];
  updateReportStatus: (reportId: string, status: ReportItem['status'], actionTaken?: string) => void;
  errorLogs: SystemErrorLog[];
}

const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, updateProfile } = useAuth();

  // 규칙 상태
  const [rules, setRules] = useState<RecognitionWordRule[]>([]);
  const [captureAreaConfig, setCaptureAreaConfigState] = useState<CaptureAreaConfig>(() => {
    return storageService.getCaptureAreaConfig() || CAPTURE_PRESETS[0];
  });

  const setCaptureAreaConfig = (cfg: CaptureAreaConfig) => {
    setCaptureAreaConfigState(cfg);
    storageService.saveCaptureAreaConfig(cfg);
  };

  // 학습 상태
  const [trainingSentences, setTrainingSentences] = useState<TrainingSentence[]>([]);

  // 구독 상태
  const [currentPlan, setCurrentPlan] = useState<PlanTier>('프로');
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string>('2026-09-24');
  const [isTrialActive, setIsTrialActive] = useState<boolean>(true);
  const [selectedPlanForCheckout, setSelectedPlanForCheckout] = useState<PlanTier>('프로');
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);

  // 알림 상태
  const [notifications, setNotifications] = useState<NotificationSetting[]>([]);

  // 관리자 상태
  const [allMembers, setAllMembers] = useState<User[]>([]);
  const [isSyncingMembers, setIsSyncingMembers] = useState<boolean>(false);
  const [memberSyncError, setMemberSyncError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [errorLogs, setErrorLogs] = useState<SystemErrorLog[]>([]);

  const refreshMembers = async () => {
    setIsSyncingMembers(true);
    setMemberSyncError(null);
    try {
      if (!isSupabaseConfigured) {
        setAllMembers([]);
        throw new Error('클라우드 회원 서버가 설정되지 않았습니다.');
      }

      const cloudSellers = await remoteWorkspaceService.fetchVoicecapSellers();
      setAllMembers(cloudSellers);
      return true;
    } catch (err) {
      console.error('[AppDataContext] 회원 동기화 오류:', err);
      setMemberSyncError(err instanceof Error ? err.message : '클라우드 회원 동기화에 실패했습니다.');
      return false;
    } finally {
      setIsSyncingMembers(false);
    }
  };

  useEffect(() => {
    storageService.init();
    setRules(storageService.getRules());
    const savedArea = storageService.getCaptureAreaConfig();
    if (savedArea) {
      setCaptureAreaConfigState(savedArea);
    }
    setTrainingSentences(storageService.getTrainingSentences());
    setPaymentHistory(storageService.getPayments());
    setNotifications(storageService.getNotifications());
    setAllMembers([]);
    setReports(storageService.getReports());
    setErrorLogs(storageService.getLogs());

    if (user?.subscriptionPlan) {
      setCurrentPlan(user.subscriptionPlan);
    }

    // 로그인된 동안에만 클라우드 회원을 메모리에 유지하고, 로그아웃 즉시 비운다.
    if (user?.role === '관리자') void refreshMembers();
    else {
      setAllMembers([]);
      setMemberSyncError(null);
    }
  }, [user]);

  // --- 규칙 메서드 ---
  const addRule = (word: string, action: RecognitionWordRule['action']) => {
    const cleanWord = word.trim();
    if (!cleanWord) return { success: false, message: '단어를 입력해주세요.' };

    const current = storageService.getRules();
    if (current.some((r) => r.word.toLowerCase() === cleanWord.toLowerCase())) {
      return { success: false, message: '이미 등록된 단어입니다.' };
    }

    const newRule: RecognitionWordRule = {
      id: `r-${Date.now()}`,
      word: cleanWord,
      action,
      isEnabled: true,
      isEssential: false,
      priority: current.length + 1
    };

    const updated = [...current, newRule];
    storageService.saveRules(updated);
    setRules(updated);
    return { success: true };
  };

  const updateRule = (updated: RecognitionWordRule) => {
    const list = storageService.getRules().map((r) => (r.id === updated.id ? updated : r));
    storageService.saveRules(list);
    setRules(list);
  };

  const deleteRule = (id: string) => {
    const target = rules.find((r) => r.id === id);
    if (target?.isEssential) {
      return { success: false, message: '구매자, 닉네임, 가격, 금액 등 필수 단어는 삭제할 수 없습니다.' };
    }
    const updated = rules.filter((r) => r.id !== id);
    storageService.saveRules(updated);
    setRules(updated);
    return { success: true };
  };

  const toggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, isEnabled: !r.isEnabled } : r));
    storageService.saveRules(updated);
    setRules(updated);
  };

  // --- 음성 학습 메서드 ---
  const recordTrainingSentence = (id: string) => {
    const list = trainingSentences.map((s) => {
      if (s.id === id) {
        const nextCount = s.recordCount + 1;
        const isCompleted = nextCount >= 3;
        const nextAccuracy = Math.min(99, Math.round(s.expectedAccuracy + (100 - s.expectedAccuracy) * 0.4));
        if (isCompleted && !s.isCompleted) {
          try {
            confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
          } catch {}
        }
        return {
          ...s,
          recordCount: nextCount,
          isCompleted,
          expectedAccuracy: nextAccuracy,
          lastTrainedAt: new Date().toISOString().split('T')[0]
        };
      }
      return s;
    });

    storageService.saveTrainingSentences(list);
    setTrainingSentences(list);
  };

  const trainVoiceModel = (id: string) => {
    recordTrainingSentence(id);
  };

  const completedTrainingCount = trainingSentences.filter((s) => s.isCompleted).length;

  // --- 구독 결제 메서드 ---
  const processPayment = (card: PaymentCard) => {
    if (!card.cardNumberMasked || card.cardNumberMasked.length < 15) {
      return { success: false, message: '유효한 카드번호 16자리를 입력해주세요.' };
    }

    const selected = SUBSCRIPTION_PLANS.find((p) => p.id === selectedPlanForCheckout) || SUBSCRIPTION_PLANS[1];
    setCurrentPlan(selected.id);
    setIsTrialActive(false);

    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);
    const expireStr = nextMonth.toISOString().split('T')[0];
    setSubscriptionExpiresAt(expireStr);

    const newPayment: PaymentHistoryItem = {
      id: `pay-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      planName: `${selected.name}`,
      amount: selected.priceMonth,
      status: '결제 완료',
      paymentMethod: `카드 (${card.cardNumberMasked.slice(-4)})`
    };

    storageService.addPayment(newPayment);
    setPaymentHistory(storageService.getPayments());

    if (user) {
      const updatedUser: User = {
        ...user,
        subscriptionPlan: selected.id,
        subscriptionExpiresAt: expireStr,
        isTrial: false
      };
      updateProfile(updatedUser.nickname, updatedUser.phone);
    }

    try {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    } catch {}

    return { success: true };
  };

  const cancelSubscription = () => {
    setIsTrialActive(false);
  };

  const startFreeTrial = () => {
    setIsTrialActive(true);
    setCurrentPlan('프로');
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);
    setSubscriptionExpiresAt(trialEnd.toISOString().split('T')[0]);
  };

  // --- 알림 설정 ---
  const toggleNotification = (id: string, channel: 'push' | 'email') => {
    const updated = notifications.map((n) => {
      if (n.id === id) {
        return {
          ...n,
          pushEnabled: channel === 'push' ? !n.pushEnabled : n.pushEnabled,
          emailEnabled: channel === 'email' ? !n.emailEnabled : n.emailEnabled
        };
      }
      return n;
    });
    storageService.saveNotifications(updated);
    setNotifications(updated);
  };

  const sendTestNotification = () => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('VoiceCAP 알림 테스트', {
        body: 'VoiceCAP 테스트 알림이 정상적으로 수신되었습니다! 🎙️'
      });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  };

  // --- 관리자 기능 ---
  const suspendMember = async (userId: string, reason: string) => {
    try {
      await remoteWorkspaceService.setVoicecapMemberStatus(userId, '정지', reason);
      setAllMembers((members) => members.map((member) => member.id === userId
        ? { ...member, status: '정지' as const, suspendedReason: reason }
        : member));
      return true;
    } catch (error) {
      setMemberSyncError(error instanceof Error ? error.message : '회원 상태를 저장하지 못했습니다.');
      return false;
    }
  };

  const unsuspendMember = async (userId: string) => {
    try {
      await remoteWorkspaceService.setVoicecapMemberStatus(userId, '활성');
      setAllMembers((members) => members.map((member) => member.id === userId
        ? { ...member, status: '활성' as const, suspendedReason: undefined }
        : member));
      return true;
    } catch (error) {
      setMemberSyncError(error instanceof Error ? error.message : '회원 상태를 저장하지 못했습니다.');
      return false;
    }
  };

  const setMemberSttAccess = async (userId: string, allow: boolean) => {
    try {
      if (isSupabaseConfigured) await remoteWorkspaceService.setVoicecapSellerSttAccess(userId, allow);
      const updated = allMembers.map((m) => (m.id === userId ? { ...m, allowAdminSttKey: allow } : m));
      setAllMembers(updated);
      return true;
    } catch (error) {
      console.error('[AppDataContext] STT 지원 권한 저장 오류:', error);
      setMemberSyncError(error instanceof Error ? error.message : 'STT 지원 권한을 저장하지 못했습니다.');
      return false;
    }
  };

  const updateReportStatus = (reportId: string, status: ReportItem['status'], actionTaken?: string) => {
    const updated = reports.map((r) =>
      r.id === reportId
        ? {
            ...r,
            status,
            processedAt: status === '완료' ? new Date().toISOString().replace('T', ' ').slice(0, 16) : r.processedAt,
            actionTaken: actionTaken || r.actionTaken
          }
        : r
    );
    storageService.saveReports(updated);
    setReports(updated);
  };

  const adminKpis: AdminKpis = {
    dailyNewUsers: 3,
    activeSubscribers: allMembers.filter((m) => m.status === '활성' && m.subscriptionPlan).length + 42,
    openReportsCount: reports.filter((r) => r.status !== '완료').length,
    systemErrorsCount: errorLogs.filter((e) => e.level === 'ERROR').length,
    sttAccuracyAvg: 96.4,
    totalSalesToday: 1420000
  };

  return (
    <AppDataContext.Provider
      value={{
        rules,
        addRule,
        updateRule,
        deleteRule,
        toggleRule,
        captureAreaConfig,
        setCaptureAreaConfig,
        trainingSentences,
        recordTrainingSentence,
        trainVoiceModel,
        completedTrainingCount,
        currentPlan,
        subscriptionExpiresAt,
        isTrialActive,
        selectedPlanForCheckout,
        setSelectedPlanForCheckout,
        paymentHistory,
        processPayment,
        cancelSubscription,
        startFreeTrial,
        notifications,
        toggleNotification,
        sendTestNotification,
        adminKpis,
        allMembers,
        isSyncingMembers,
        memberSyncError,
        refreshMembers,
        suspendMember,
        unsuspendMember,
        setMemberSttAccess,
        reports,
        updateReportStatus,
        errorLogs
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
};

export const useAppData = () => {
  const context = useContext(AppDataContext);
  if (!context) throw new Error('useAppData must be used within an AppDataProvider');
  return context;
};
