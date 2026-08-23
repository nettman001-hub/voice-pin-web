export type PlanTier = '베이직' | '프로' | '프리미엄';

export interface PlanInfo {
  id: PlanTier;
  name: string;
  priceMonth: number;
  voiceHours: string;
  salesCapacity: string;
  captureCapacity: string;
  concurrentSessions: number;
  features: string[];
  isPopular?: boolean;
}

export interface PaymentCard {
  cardNumberMasked: string;
  expiryMonthYear: string;
  cvc: string;
  birthDate: string;
}

export interface PaymentHistoryItem {
  id: string;
  date: string;
  planName: string;
  amount: number;
  status: '결제 완료' | '결제 실패' | '환불';
  paymentMethod: string;
}
