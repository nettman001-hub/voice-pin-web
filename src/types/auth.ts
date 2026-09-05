export type UserRole = '비회원' | '판매자' | '관리자';

export interface User {
  id: string;
  email: string;
  nickname: string;
  phone?: string;
  role: UserRole;
  status: '활성' | '정지' | '삭제대기';
  suspendedReason?: string;
  createdAt: string;
  subscriptionPlan?: '베이직' | '프로' | '프리미엄';
  subscriptionExpiresAt?: string;
  isTrial?: boolean;
  /** 관리자가 등록한 공용 STT API 키 무료 이용 허락 여부 */
  allowAdminSttKey?: boolean;
  /** Supabase 클라우드 서버에 실제로 등록된 판매자 여부 */
  isCloudUser?: boolean;
  /** 연결된 작업공간 이름 */
  workspaceName?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  autoLogin: boolean;
  loginAttempts: number;
  isLocked: boolean;
  lockUntil: number | null;
}
